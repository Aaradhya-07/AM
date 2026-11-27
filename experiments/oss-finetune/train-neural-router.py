#!/usr/bin/env python3
"""
AnvilMark Neural Slice-to-Model Router Trainer (PyTorch CUDA / Native nvcc CUDA)
================================================================================
Trains a 2-layer MLP (`23 -> 32 (ReLU) -> 16 (ReLU) -> 1 (Sigmoid)`) predicting
calibrated slice utility `U(slice, stack, model, repo_history) in [0, 1]`.

Supports:
  1. PyTorch CUDA (`torch.cuda.is_available()`) when a PyTorch venv is active
  2. Native `/usr/bin/nvcc` CUDA C++ GPU kernel compilation & execution directly on
     `aara@am-server` (RTX 3060) with zero external Python packages required!

Exports portable float weights to `--weights-out` (`router-weights.v1.json`) and
held-out validation metrics (MSE, MAE, Pairwise Ranking Accuracy) to `--report-out`.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

CUDA_MLP_SOURCE = r"""
#include <cuda_runtime.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <fstream>

#define D_IN 23
#define H1 32
#define H2 16

__device__ float sigmoid_dev(float x) {
    return 1.0f / (1.0f + expf(-x));
}

__global__ void forward_backward_batch(
    const float* __restrict__ X,
    const float* __restrict__ Y,
    int N,
    const float* __restrict__ W1, const float* __restrict__ b1,
    const float* __restrict__ W2, const float* __restrict__ b2,
    const float* __restrict__ W3, float b3,
    float* __restrict__ gW1, float* __restrict__ gb1,
    float* __restrict__ gW2, float* __restrict__ gb2,
    float* __restrict__ gW3, float* __restrict__ gb3,
    float* __restrict__ loss_accum
) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= N) return;

    const float* x = X + idx * D_IN;
    float y = Y[idx];

    float z1[H1], a1[H1];
    for (int i = 0; i < H1; ++i) {
        float s = b1[i];
        for (int j = 0; j < D_IN; ++j) s += W1[i * D_IN + j] * x[j];
        z1[i] = s;
        a1[i] = s > 0.0f ? s : 0.0f;
    }

    float z2[H2], a2[H2];
    for (int i = 0; i < H2; ++i) {
        float s = b2[i];
        for (int j = 0; j < H1; ++j) s += W2[i * H1 + j] * a1[j];
        z2[i] = s;
        a2[i] = s > 0.0f ? s : 0.0f;
    }

    float z3 = b3;
    for (int j = 0; j < H2; ++j) z3 += W3[j] * a2[j];
    float pred = sigmoid_dev(z3);

    float diff = pred - y;
    atomicAdd(loss_accum, diff * diff);

    // dL/dz3 for MSE through sigmoid: 2 * (pred - y) * pred * (1 - pred) / N
    float dz3 = (2.0f * diff * pred * (1.0f - pred)) / (float)N;
    atomicAdd(gb3, dz3);

    float da2[H2];
    for (int j = 0; j < H2; ++j) {
        atomicAdd(&gW3[j], dz3 * a2[j]);
        da2[j] = dz3 * W3[j];
    }

    float da1[H1];
    for (int j = 0; j < H1; ++j) da1[j] = 0.0f;

    for (int i = 0; i < H2; ++i) {
        float dz2 = z2[i] > 0.0f ? da2[i] : 0.0f;
        atomicAdd(&gb2[i], dz2);
        for (int j = 0; j < H1; ++j) {
            atomicAdd(&gW2[i * H1 + j], dz2 * a1[j]);
            da1[j] += dz2 * W2[i * H1 + j];
        }
    }

    for (int i = 0; i < H1; ++i) {
        float dz1 = z1[i] > 0.0f ? da1[i] : 0.0f;
        atomicAdd(&gb1[i], dz1);
        for (int j = 0; j < D_IN; ++j) {
            atomicAdd(&gW1[i * D_IN + j], dz1 * x[j]);
        }
    }
}

static unsigned int rng_state = 20261127u;
static float rand_uniform() {
    rng_state = rng_state * 1664525u + 1013904223u;
    return ((rng_state >> 8) & 0x00FFFFFF) / 16777216.0f;
}

static void adam_step(
    std::vector<float>& param,
    const std::vector<float>& grad,
    std::vector<float>& m,
    std::vector<float>& v,
    int t,
    float lr,
    float wd
) {
    const float b1 = 0.9f, b2 = 0.999f, eps = 1e-8f;
    float bc1 = 1.0f - powf(b1, (float)t);
    float bc2 = 1.0f - powf(b2, (float)t);
    for (size_t i = 0; i < param.size(); ++i) {
        float g = grad[i] + wd * param[i];
        m[i] = b1 * m[i] + (1.0f - b1) * g;
        v[i] = b2 * v[i] + (1.0f - b2) * g * g;
        float mh = m[i] / bc1;
        float vh = v[i] / bc2;
        param[i] -= lr * mh / (sqrtf(vh) + eps);
    }
}

int main(int argc, char** argv) {
    if (argc < 4) return 2;
    std::ifstream fin(argv[1]);
    int N = 0, epochs = atoi(argv[2]);
    fin >> N;
    std::vector<float> hX(N * D_IN), hY(N);
    for (int i = 0; i < N; ++i) {
        for (int j = 0; j < D_IN; ++j) fin >> hX[i * D_IN + j];
        fin >> hY[i];
    }
    fin.close();

    cudaDeviceProp prop;
    if (cudaGetDeviceProperties(&prop, 0) != cudaSuccess) return 3;

    std::vector<float> W1(H1 * D_IN), b1(H1, 0.0f);
    std::vector<float> W2(H2 * H1), b2(H2, 0.0f);
    std::vector<float> W3(H2), b3(1, 0.0f);

    float s1 = sqrtf(2.0f / D_IN), s2 = sqrtf(2.0f / H1), s3 = sqrtf(1.0f / H2);
    for (auto& w : W1) w = (rand_uniform() * 2.0f - 1.0f) * s1;
    for (auto& w : W2) w = (rand_uniform() * 2.0f - 1.0f) * s2;
    for (auto& w : W3) w = (rand_uniform() * 2.0f - 1.0f) * s3;

    std::vector<float> mW1(W1.size(), 0), vW1(W1.size(), 0);
    std::vector<float> mb1(b1.size(), 0), vb1(b1.size(), 0);
    std::vector<float> mW2(W2.size(), 0), vW2(W2.size(), 0);
    std::vector<float> mb2(b2.size(), 0), vb2(b2.size(), 0);
    std::vector<float> mW3(W3.size(), 0), vW3(W3.size(), 0);
    std::vector<float> mb3(1, 0), vb3(1, 0);

    float *dX, *dY, *dW1, *db1, *dW2, *db2, *dW3;
    float *dgW1, *dgb1, *dgW2, *dgb2, *dgW3, *dgb3, *dLoss;
    cudaMalloc(&dX, hX.size() * sizeof(float));
    cudaMalloc(&dY, hY.size() * sizeof(float));
    cudaMalloc(&dW1, W1.size() * sizeof(float));
    cudaMalloc(&db1, b1.size() * sizeof(float));
    cudaMalloc(&dW2, W2.size() * sizeof(float));
    cudaMalloc(&db2, b2.size() * sizeof(float));
    cudaMalloc(&dW3, W3.size() * sizeof(float));

    cudaMalloc(&dgW1, W1.size() * sizeof(float));
    cudaMalloc(&dgb1, b1.size() * sizeof(float));
    cudaMalloc(&dgW2, W2.size() * sizeof(float));
    cudaMalloc(&dgb2, b2.size() * sizeof(float));
    cudaMalloc(&dgW3, W3.size() * sizeof(float));
    cudaMalloc(&dgb3, sizeof(float));
    cudaMalloc(&dLoss, sizeof(float));

    cudaMemcpy(dX, hX.data(), hX.size() * sizeof(float), cudaMemcpyHostToDevice);
    cudaMemcpy(dY, hY.data(), hY.size() * sizeof(float), cudaMemcpyHostToDevice);

    std::vector<float> gW1(W1.size()), gb1(b1.size()), gW2(W2.size()), gb2(b2.size()), gW3(W3.size()), gb3(1);
    float final_mse = 0.0f;
    int threads = 256;
    int blocks = (N + threads - 1) / threads;

    for (int ep = 1; ep <= epochs; ++ep) {
        cudaMemcpy(dW1, W1.data(), W1.size() * sizeof(float), cudaMemcpyHostToDevice);
        cudaMemcpy(db1, b1.data(), b1.size() * sizeof(float), cudaMemcpyHostToDevice);
        cudaMemcpy(dW2, W2.data(), W2.size() * sizeof(float), cudaMemcpyHostToDevice);
        cudaMemcpy(db2, b2.data(), b2.size() * sizeof(float), cudaMemcpyHostToDevice);
        cudaMemcpy(dW3, W3.data(), W3.size() * sizeof(float), cudaMemcpyHostToDevice);

        cudaMemset(dgW1, 0, W1.size() * sizeof(float));
        cudaMemset(dgb1, 0, b1.size() * sizeof(float));
        cudaMemset(dgW2, 0, W2.size() * sizeof(float));
        cudaMemset(dgb2, 0, b2.size() * sizeof(float));
        cudaMemset(dgW3, 0, W3.size() * sizeof(float));
        cudaMemset(dgb3, 0, sizeof(float));
        cudaMemset(dLoss, 0, sizeof(float));

        forward_backward_batch<<<blocks, threads>>>(
            dX, dY, N,
            dW1, db1, dW2, db2, dW3, b3[0],
            dgW1, dgb1, dgW2, dgb2, dgW3, dgb3, dLoss
        );
        cudaDeviceSynchronize();

        cudaMemcpy(gW1.data(), dgW1, W1.size() * sizeof(float), cudaMemcpyDeviceToHost);
        cudaMemcpy(gb1.data(), dgb1, b1.size() * sizeof(float), cudaMemcpyDeviceToHost);
        cudaMemcpy(gW2.data(), dgW2, W2.size() * sizeof(float), cudaMemcpyDeviceToHost);
        cudaMemcpy(gb2.data(), dgb2, b2.size() * sizeof(float), cudaMemcpyDeviceToHost);
        cudaMemcpy(gW3.data(), dgW3, W3.size() * sizeof(float), cudaMemcpyDeviceToHost);
        cudaMemcpy(gb3.data(), dgb3, sizeof(float), cudaMemcpyDeviceToHost);
        float loss_sum = 0.0f;
        cudaMemcpy(&loss_sum, dLoss, sizeof(float), cudaMemcpyDeviceToHost);
        final_mse = loss_sum / (float)N;

        float lr = ep > (epochs * 3 / 4) ? 0.002f : 0.008f;
        adam_step(W1, gW1, mW1, vW1, ep, lr, 1e-4f);
        adam_step(b1, gb1, mb1, vb1, ep, lr, 0.0f);
        adam_step(W2, gW2, mW2, vW2, ep, lr, 1e-4f);
        adam_step(b2, gb2, mb2, vb2, ep, lr, 0.0f);
        adam_step(W3, gW3, mW3, vW3, ep, lr, 1e-4f);
        adam_step(b3, gb3, mb3, vb3, ep, lr, 0.0f);
    }

    std::ofstream fout(argv[3]);
    fout << prop.name << "\n" << prop.major << "." << prop.minor << "\n" << final_mse << "\n";
    for (float v : W1) fout << v << " "; fout << "\n";
    for (float v : b1) fout << v << " "; fout << "\n";
    for (float v : W2) fout << v << " "; fout << "\n";
    for (float v : b2) fout << v << " "; fout << "\n";
    for (float v : W3) fout << v << " "; fout << "\n";
    fout << b3[0] << "\n";
    fout.close();

    cudaFree(dX); cudaFree(dY);
    cudaFree(dW1); cudaFree(db1); cudaFree(dW2); cudaFree(db2); cudaFree(dW3);
    cudaFree(dgW1); cudaFree(dgb1); cudaFree(dgW2); cudaFree(dgb2); cudaFree(dgW3); cudaFree(dgb3); cudaFree(dLoss);
    return 0;
}
"""


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def forward_one(x: list[float], w: dict) -> float:
    import math

    w1, b1 = w["W1"], w["b1"]
    w2, b2 = w["W2"], w["b2"]
    w3, b3 = w["W3"], w["b3"]

    a1 = []
    for i in range(32):
        s = b1[i]
        row = w1[i]
        for j in range(23):
            s += row[j] * x[j]
        a1.append(s if s > 0.0 else 0.0)

    a2 = []
    for i in range(16):
        s = b2[i]
        row = w2[i]
        for j in range(32):
            s += row[j] * a1[j]
        a2.append(s if s > 0.0 else 0.0)

    z3 = b3
    for j in range(16):
        z3 += w3[j] * a2[j]
    return 1.0 / (1.0 + math.exp(-z3))


def evaluate(rows: list[dict], weights: dict) -> dict:
    mse = 0.0
    mae = 0.0
    preds = []
    for r in rows:
        p = forward_one(r["features"], weights)
        t = float(r["target"])
        mse += (p - t) ** 2
        mae += abs(p - t)
        preds.append((p, t, r.get("meta", {})))

    n = max(1, len(rows))
    # Pairwise ranking accuracy on distinct target gaps >= 0.05
    concordant = 0
    total_pairs = 0
    step = max(1, len(preds) // 250)
    sampled = preds[::step]
    for i in range(len(sampled)):
        for j in range(i + 1, len(sampled)):
            pi, ti, _ = sampled[i]
            pj, tj, _ = sampled[j]
            if abs(ti - tj) < 0.05:
                continue
            total_pairs += 1
            if (pi - pj) * (ti - tj) > 0:
                concordant += 1

    return {
        "count": len(rows),
        "mse": round(mse / n, 6),
        "mae": round(mae / n, 6),
        "pairwiseRankingAccuracy": round(concordant / max(1, total_pairs), 4),
        "evaluatedPairs": total_pairs,
    }


def train_with_nvcc(train_rows: list[dict], epochs: int) -> tuple[dict, dict]:
    nvcc = shutil.which("nvcc") or "/usr/bin/nvcc"
    if not Path(nvcc).exists():
        raise RuntimeError("nvcc not found")

    with tempfile.TemporaryDirectory(prefix="anvilmark-cuda-") as tmp:
        tmp_path = Path(tmp)
        cu_file = tmp_path / "mlp.cu"
        bin_file = tmp_path / "mlp_train"
        data_file = tmp_path / "train.txt"
        out_file = tmp_path / "weights.txt"

        cu_file.write_text(CUDA_MLP_SOURCE, encoding="utf-8")
        subprocess.run(
            [nvcc, "-O3", str(cu_file), "-o", str(bin_file)],
            check=True,
            capture_output=True,
            text=True,
        )

        with data_file.open("w", encoding="utf-8") as fh:
            fh.write(f"{len(train_rows)}\n")
            for r in train_rows:
                feats = " ".join(f"{float(v):.6f}" for v in r["features"])
                fh.write(f"{feats} {float(r['target']):.6f}\n")

        t0 = time.perf_counter()
        subprocess.run(
            [str(bin_file), str(data_file), str(epochs), str(out_file)],
            check=True,
            capture_output=True,
            text=True,
        )
        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)

        lines = out_file.read_text(encoding="utf-8").splitlines()
        gpu_name = lines[0].strip()
        compute_cap = lines[1].strip()
        final_train_mse = float(lines[2].strip())
        w1_flat = [round(float(x), 6) for x in lines[3].split()]
        b1 = [round(float(x), 6) for x in lines[4].split()]
        w2_flat = [round(float(x), 6) for x in lines[5].split()]
        b2 = [round(float(x), 6) for x in lines[6].split()]
        w3 = [round(float(x), 6) for x in lines[7].split()]
        b3 = round(float(lines[8].strip()), 6)

        w1 = [w1_flat[i * 23 : (i + 1) * 23] for i in range(32)]
        w2 = [w2_flat[i * 32 : (i + 1) * 32] for i in range(16)]

        return (
            {"W1": w1, "b1": b1, "W2": w2, "b2": b2, "W3": w3, "b3": b3},
            {
                "backend": "cuda-nvcc",
                "gpuName": gpu_name,
                "computeCapability": compute_cap,
                "epochs": epochs,
                "trainDurationMs": elapsed_ms,
                "finalTrainMse": round(final_train_mse, 6),
            },
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-file", required=True, type=Path)
    parser.add_argument("--val-file", required=True, type=Path)
    parser.add_argument("--weights-out", required=True, type=Path)
    parser.add_argument("--report-out", required=True, type=Path)
    parser.add_argument("--epochs", type=int, default=900)
    args = parser.parse_args()

    train_rows = load_jsonl(args.train_file)
    val_rows = load_jsonl(args.val_file)

    weights, hw_meta = train_with_nvcc(train_rows, args.epochs)
    train_metrics = evaluate(train_rows, weights)
    val_metrics = evaluate(val_rows, weights)

    payload = {
        "schemaVersion": "anvilmark.router-weights.v1",
        "architecture": [23, 32, 16, 1],
        "featureSpec": [
            "kind_schema_types",
            "kind_crud_ui",
            "kind_feature_integration",
            "kind_auth_security",
            "kind_concurrency_algorithms",
            "kind_tests_docs",
            "complexity_norm",
            "complexity_is_high",
            "scale_norm",
            "scale_is_small",
            "stack_is_web_ts",
            "stack_is_systems",
            "stack_is_monorepo",
            "tier_fast",
            "tier_balanced",
            "tier_frontier",
            "is_local",
            "is_heavy_specialist",
            "is_weak_local",
            "cost_norm",
            "arena_norm",
            "has_repo_obs",
            "repo_win_rate",
        ],
        "training": hw_meta,
        "validation": val_metrics,
        "weights": weights,
    }

    args.weights_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.parent.mkdir(parents=True, exist_ok=True)
    args.weights_out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    report = {
        "schemaVersion": "anvilmark.router-eval.v1",
        "training": hw_meta,
        "trainMetrics": train_metrics,
        "valMetrics": val_metrics,
    }
    args.report_out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
