"""Reproducible warm, single-message latency for 77 cached label choices."""

from __future__ import annotations

import json
import runpy
import statistics
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
    candidate = runpy.run_path(str(ROOT / "predict-reranker.py"))
    labels, _ = prototype["load_data"](30)
    started = time.perf_counter()
    classifier = candidate["DynamicLabelClassifier"]("cuda")
    load_seconds = time.perf_counter() - started
    started = time.perf_counter()
    classifier.set_labels(labels)
    setup_seconds = time.perf_counter() - started
    messages = [
        "my card has not arrived yet",
        "how do I change my card pin",
        "the transfer was declined",
        "can I exchange my money into another currency",
        "why was I charged twice",
    ]
    for index in range(10):
        classifier.predict(messages[index % len(messages)])
    timings = [classifier.predict(messages[index % len(messages)])[
        "elapsed_ms_excluding_model_load_and_label_setup"
    ] for index in range(100)]
    timings.sort()
    report = {
        "format": "anvilmark-label-aware-reranker-latency/1",
        "device": "RTX 4050 laptop GPU",
        "label_count": len(labels), "shortlist_count": classifier.top_k,
        "warmup_predictions": 10, "measured_predictions": len(timings),
        "model_load_seconds": round(load_seconds, 3),
        "label_setup_seconds": round(setup_seconds, 3),
        "warm_latency_ms": {
            "mean": round(statistics.mean(timings), 3),
            "p50": round(statistics.median(timings), 3),
            "p95_nearest_rank": timings[94],
            "min": timings[0], "max": timings[-1],
        },
        "torch_peak_allocated_mib": round(
            classifier.torch.cuda.max_memory_allocated() / 2**20, 1
        ),
        "caveat": "one process, fixed cached label set, repeated short messages; ranking only, no quality claim",
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
