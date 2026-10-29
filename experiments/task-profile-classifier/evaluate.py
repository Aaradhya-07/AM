"""Score the fixed candidate models on the entire untouched NLBSE test set."""

from __future__ import annotations

import hashlib
import json
import statistics
import time
from collections import Counter
from pathlib import Path

import joblib
import numpy as np

from data import CACHE, LABELS, TEST_SHA256, TRAIN_SHA256, archive_rows, normalized_text, read_sample, row_text, verify_sha256
from metrics import class_metrics, suggestion_metrics
from train import RESULTS, arrays, pooled, predict_minilm


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while data := source.read(1024 * 1024):
            digest.update(data)
    return digest.hexdigest()


def latency_stats(samples: list[float]) -> dict:
    ordered = sorted(samples)
    return {"median_ms": statistics.median(ordered) * 1000,
            "p95_ms": ordered[int(0.95 * (len(ordered) - 1))] * 1000,
            "mean_ms": statistics.mean(ordered) * 1000,
            "requests": len(samples)}


def main() -> None:
    verify_sha256(CACHE / "nlbse-train.csv.tar.gz", TRAIN_SHA256)
    verify_sha256(CACHE / "nlbse-test.csv.tar.gz", TEST_SHA256)
    linear_validation = json.loads((RESULTS / "linear-validation.json").read_text())
    minilm_validation = json.loads((RESULTS / "minilm-validation.json").read_text())
    selected = "linear" if linear_validation["metrics"]["macro_f1"] >= minilm_validation["metrics"]["macro_f1"] else "minilm"

    training_rows = read_sample("train")
    train_text_hashes = {hashlib.sha256(normalized_text(row["text"]).encode()).digest()
                         for row in training_rows}
    train_ids = {row["id"] for row in training_rows}
    records = []
    for row in archive_rows(CACHE / "nlbse-test.csv.tar.gz"):
        label = row["labels"].strip().lower()
        if label not in LABELS:
            raise ValueError(f"unexpected test label: {label}")
        records.append({"id": row["id"], "label": label, "text": row_text(row)})
    if len(records) != 142_320:
        raise ValueError(f"unexpected test row count: {len(records)}")
    test_texts, truth = arrays(records)
    overlapping = np.array([hashlib.sha256(normalized_text(text).encode()).digest() in train_text_hashes
                            for text in test_texts], dtype=bool)
    overlap = int(overlapping.sum())
    nonoverlap = ~overlapping
    print(f"Loaded {len(records)} untouched test rows; exact selected-train overlap {overlap}", flush=True)

    majority_index = int(np.bincount(arrays(training_rows)[1], minlength=len(LABELS)).argmax())
    report = {
        "dataset": "NLBSE23 issue-report classification official test split",
        "train_archive_sha256": sha256(CACHE / "nlbse-train.csv.tar.gz"),
        "test_archive_sha256": sha256(CACHE / "nlbse-test.csv.tar.gz"),
        "test_rows": len(records),
        "test_counts": dict(Counter(row["label"] for row in records)),
        "exact_normalized_test_overlaps_with_selected_train": overlap,
        "test_id_overlaps_with_selected_train": sum(row["id"] in train_ids for row in records),
        "selected_by_validation_macro_f1": selected,
        "majority": {"label": LABELS[majority_index],
                     "metrics": class_metrics(truth, np.full_like(truth, majority_index))},
    }

    bundle = joblib.load(CACHE / "linear.joblib")
    vectorizer, classifier = bundle["vectorizer"], bundle["classifier"]
    linear_chunks = []
    started = time.perf_counter()
    for start in range(0, len(test_texts), 512):
        linear_chunks.append(classifier.predict_proba(vectorizer.transform(test_texts[start:start + 512])))
    linear_probability = np.concatenate(linear_chunks)
    linear_seconds = time.perf_counter() - started
    linear_latencies = []
    for text in test_texts[:100]:
        before = time.perf_counter()
        classifier.predict_proba(vectorizer.transform([text]))
        linear_latencies.append(time.perf_counter() - before)
    report["linear"] = {
        "metrics": class_metrics(truth, linear_probability.argmax(1)),
        "nonoverlap_metrics": class_metrics(truth[nonoverlap], linear_probability.argmax(1)[nonoverlap]),
        "suggestions": suggestion_metrics(truth, linear_probability,
                                           linear_validation["suggestions"]["threshold"]),
        "full_test_inference_seconds": linear_seconds,
        "warm_single_request": latency_stats(linear_latencies),
    }
    del linear_probability, linear_chunks, bundle, vectorizer, classifier
    print(f"Linear full-test macro-F1 {report['linear']['metrics']['macro_f1']:.4f}", flush=True)

    import torch
    from transformers import AutoModel, AutoTokenizer

    torch.set_num_threads(4)
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable: GPU evaluation was requested")
    device = "cuda"
    model_path = CACHE / "minilm-selected"
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
    model = AutoModel.from_pretrained(model_path, local_files_only=True).to(device)
    head = torch.nn.Linear(model.config.hidden_size, len(LABELS)).to(device)
    head.load_state_dict(torch.load(model_path / "head.pt", map_location=device, weights_only=True))
    torch.cuda.synchronize()
    started = time.perf_counter()
    minilm_probability = predict_minilm(torch, model, head, tokenizer, test_texts, device, batch_size=128)
    torch.cuda.synchronize()
    minilm_seconds = time.perf_counter() - started
    model.eval()
    head.eval()
    minilm_latencies = []
    for text in test_texts[:100]:
        torch.cuda.synchronize()
        before = time.perf_counter()
        predict_minilm(torch, model, head, tokenizer, [text], device, batch_size=1)
        torch.cuda.synchronize()
        minilm_latencies.append(time.perf_counter() - before)
    report["minilm"] = {
        "metrics": class_metrics(truth, minilm_probability.argmax(1)),
        "nonoverlap_metrics": class_metrics(truth[nonoverlap], minilm_probability.argmax(1)[nonoverlap]),
        "suggestions": suggestion_metrics(truth, minilm_probability,
                                           minilm_validation["suggestions"]["threshold"]),
        "full_test_inference_seconds": minilm_seconds,
        "warm_single_request": latency_stats(minilm_latencies),
        "selected_epoch": minilm_validation["selected_epoch"],
    }
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / "official-test.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(path), "selected": selected,
                      "majority_macro_f1": report["majority"]["metrics"]["macro_f1"],
                      "linear_macro_f1": report["linear"]["metrics"]["macro_f1"],
                      "minilm_macro_f1": report["minilm"]["metrics"]["macro_f1"]}), flush=True)


if __name__ == "__main__":
    main()
