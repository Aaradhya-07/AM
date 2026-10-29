"""Measure a pinned GLiClass checkpoint against the shared task-profile questions.

This is an external open-weight baseline, not Anvilmark's trained model. Its
probabilities have not been calibrated for these tasks.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SHARED = ROOT.parent / "jev-task-profile"
MODEL_ID = "knowledgator/gliclass-edge-v3.0"
MODEL_REVISION = "df03993a2ed98e5e4a0d2dd7efbbd105abe874cf"


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=SHARED / "cases.sample.json")
    parser.add_argument("--model", default=MODEL_ID)
    parser.add_argument("--revision", default=MODEL_REVISION)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--report", type=Path)
    return parser.parse_args()


def score_rows(rows: list[dict], source: str) -> dict:
    selected = [row for row in rows if row.get("label_source") == source and "predicted" in row]
    if not selected:
        return {"count": 0, "kind": None, "risk": None, "both": None,
                "brier_kind": None, "brier_risk": None}

    def accuracy(question: str) -> float:
        return sum(row["expected"][question] == row["predicted"][question] for row in selected) / len(selected)

    def brier(question: str) -> float:
        return sum(
            sum((p - (label == row["expected"][question])) ** 2
                for label, p in row["probabilities"][question].items())
            for row in selected
        ) / len(selected)

    return {
        "count": len(selected),
        "kind": accuracy("kind"),
        "risk": accuracy("risk"),
        "both": sum(row["expected"] == row["predicted"] for row in selected) / len(selected),
        "brier_kind": brier("kind"),
        "brier_risk": brier("risk"),
    }


def main() -> None:
    args = arguments()
    if args.threads < 1:
        raise ValueError("--threads must be positive")
    cases = json.loads(args.cases.read_text())
    questions = json.loads((SHARED / "questions.json").read_text())
    if not isinstance(cases, list) or not cases:
        raise ValueError("cases must be a nonempty JSON array")

    # Store model files in the ignored experiment directory, not in a user-wide cache.
    cache = ROOT / ".cache" / "huggingface"
    cache.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(cache)

    import torch
    from gliclass import GLiClassModel, ZeroShotClassificationPipeline
    from transformers import AutoTokenizer

    torch.set_num_threads(args.threads)
    load_started = time.perf_counter()
    model = GLiClassModel.from_pretrained(args.model, revision=args.revision, cache_dir=cache)
    tokenizer = AutoTokenizer.from_pretrained(
        args.model, revision=args.revision, cache_dir=cache, add_prefix_space=True
    )
    pipeline = ZeroShotClassificationPipeline(
        model, tokenizer, classification_type="single-label", device="cpu", progress_bar=False
    )
    load_ms = (time.perf_counter() - load_started) * 1000

    results = []
    for case in cases:
        if not isinstance(case, dict) or not isinstance(case.get("summary"), str):
            raise ValueError("every case needs a summary")
        # Keep this byte-for-byte aligned with taskProfileState in the Jev harness.
        state = f"Task: {case['summary']}\nArchitecture: {case.get('architecture_summary', '')}"
        started = time.perf_counter()
        predicted = {}
        distributions = {}
        for question_id, question in questions.items():
            descriptions = question["criteria"]
            labels = [f"{name}: {description}" for name, description in descriptions.items()]
            raw = pipeline(
                state, labels, prompt=question["instructions"], return_hierarchical=True
            )[0]
            values = {name: float(raw[label]) for name, label in zip(descriptions, labels)}
            if not all(math.isfinite(value) and value >= 0 for value in values.values()):
                raise ValueError(f"invalid {question_id} probabilities")
            total = sum(values.values())
            if total <= 0:
                raise ValueError(f"empty {question_id} probability distribution")
            distribution = {name: value / total for name, value in values.items()}
            distributions[question_id] = distribution
            predicted[question_id] = max(distribution, key=distribution.get)

        results.append({
            "id": case["id"],
            "label_source": case["label_source"],
            "expected": case["expected"],
            "predicted": predicted,
            "probabilities": distributions,
            "duration_ms": round((time.perf_counter() - started) * 1000, 3),
        })

    durations = sorted(row["duration_ms"] for row in results)
    summary = {
        "cases": len(results),
        "completed": len(results),
        "failed": 0,
        "human_reviewed_accuracy": score_rows(results, "human_reviewed"),
        "illustrative_agreement": score_rows(results, "illustrative"),
        "model_load_ms": round(load_ms, 3),
        "latency_ms": {
            "mean": statistics.mean(durations),
            "median": statistics.median(durations),
            "p95": durations[math.ceil(len(durations) * 0.95) - 1],
        },
        "estimated_usd": None,
    }
    observed_revision = getattr(model.config, "_commit_hash", None)
    if observed_revision and observed_revision != args.revision:
        raise ValueError(f"loaded revision {observed_revision} differs from requested {args.revision}")
    report = {
        "format": "anvilmark-decision-model-experiment/1",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "dataset": str(args.cases.resolve()),
        "model": args.model,
        "model_revision_requested": args.revision,
        "model_revision_observed": observed_revision,
        "device": "cpu",
        "threads": args.threads,
        "probability_status": "uncalibrated",
        "cost_basis": "local CPU cost not measured",
        "summary": summary,
        "results": results,
    }
    target = args.report or ROOT / "results" / f"gliclass-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print(json.dumps(summary, indent=2))
    print(f"Report: {target}")


if __name__ == "__main__":
    main()
