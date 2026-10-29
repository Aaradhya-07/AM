"""Exploratory cross-domain check of the BANKING77-trained query encoder."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import runpy
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REVISION = "940fd47a81eaa7f2cc7b129674d945d618ac38c2"
FILE_SHA256 = "6dd692a9c188f395956b0534b70486c8ed959fd6d7e50d26d419ff169d213894"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cuda")
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()
    if args.batch_size < 1:
        raise ValueError("batch size must be positive")

    from huggingface_hub import hf_hub_download

    source = hf_hub_download(
        "mteb/amazon_massive_intent", filename="test/en.json.gz",
        repo_type="dataset", revision=REVISION,
        cache_dir=ROOT / ".cache" / "huggingface",
    )
    if hashlib.sha256(Path(source).read_bytes()).hexdigest() != FILE_SHA256:
        raise ValueError("MASSIVE file hash changed")
    with gzip.open(source, "rt") as handle:
        examples = [json.loads(line) for line in handle]
    labels = sorted({row["label_text"] for row in examples})
    if not examples or len(labels) < 2:
        raise ValueError("MASSIVE test file is empty")

    prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
    candidate = runpy.run_path(str(ROOT / "train-question-encoder.py"))
    torch, tokenizer, model = prototype["load_encoder"]()
    torch.set_num_threads(4)
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable in this process")
    checkpoint = torch.load(
        ROOT / ".cache" / "question-encoder.pt",
        map_location="cpu", weights_only=True,
    )
    if checkpoint["encoder_revision"] != prototype["MODEL_REVISION"]:
        raise ValueError("checkpoint uses a different encoder revision")
    if checkpoint["question"] != candidate["QUESTION"]:
        raise ValueError("checkpoint uses a different question")

    labels_as_text = [prototype["readable_label"](label) for label in labels]
    label_vectors = prototype["encode"](torch, tokenizer, model, labels_as_text)
    texts = [candidate["query"](row["text"]) for row in examples]
    raw_texts = [row["text"] for row in examples]
    targets = torch.tensor([labels.index(row["label_text"]) for row in examples])
    model.to(args.device)
    started = time.perf_counter()
    baseline = candidate["evaluate"](
        torch, tokenizer, model, texts, args.device, args.batch_size, label_vectors
    )
    baseline_seconds = time.perf_counter() - started
    raw_baseline = candidate["evaluate"](
        torch, tokenizer, model, raw_texts, args.device, args.batch_size, label_vectors
    )
    model.load_state_dict(checkpoint["state_dict"])
    started = time.perf_counter()
    trained = candidate["evaluate"](
        torch, tokenizer, model, texts, args.device, args.batch_size, label_vectors
    )
    trained_seconds = time.perf_counter() - started
    raw_trained = candidate["evaluate"](
        torch, tokenizer, model, raw_texts, args.device, args.batch_size, label_vectors
    )

    report = {
        "format": "anvilmark-question-encoder-cross-domain/1",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "dataset": "MASSIVE English intent test via MTEB",
        "dataset_revision": REVISION,
        "dataset_file_sha256": FILE_SHA256,
        "encoder": prototype["MODEL_ID"],
        "encoder_revision": prototype["MODEL_REVISION"],
        "trained_on": "BANKING77 training label split only",
        "question": candidate["QUESTION"],
        "device": args.device,
        "examples": len(examples),
        "labels": len(labels),
        "batch_size": args.batch_size,
        "baseline_seconds": round(baseline_seconds, 3),
        "trained_seconds": round(trained_seconds, 3),
        "results": {
            "untouched_encoder": prototype["metrics"](torch, baseline, targets),
            "banking_trained_encoder": prototype["metrics"](torch, trained, targets),
            "untouched_encoder_raw_input": prototype["metrics"](torch, raw_baseline, targets),
            "banking_trained_encoder_raw_input": prototype["metrics"](torch, raw_trained, targets),
        },
        "note": "Exploratory: MASSIVE test results were inspected in earlier experiments; scores are uncalibrated",
    }
    output = ROOT / "results" / f"question-encoder-massive-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print(json.dumps(report, indent=2))
    print(f"Report: {output}")


if __name__ == "__main__":
    main()
