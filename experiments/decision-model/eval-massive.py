"""Evaluate the frozen BANKING77 candidate on a separate MASSIVE intent domain."""

from __future__ import annotations

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
    from huggingface_hub import hf_hub_download

    source = hf_hub_download(
        "mteb/amazon_massive_intent",
        filename="test/en.json.gz",
        repo_type="dataset",
        revision=REVISION,
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
    torch, tokenizer, encoder = prototype["load_encoder"]()
    torch.set_num_threads(4)
    checkpoint = torch.load(ROOT / ".cache" / "dynamic-label-head.pt", map_location="cpu", weights_only=True)
    if checkpoint["encoder_revision"] != prototype["MODEL_REVISION"]:
        raise ValueError("checkpoint uses another encoder revision")
    started = time.perf_counter()
    label_vectors = prototype["encode"](
        torch, tokenizer, encoder, [prototype["readable_label"](x) for x in labels]
    )
    text_vectors = prototype["encode"](
        torch, tokenizer, encoder, [row["text"] for row in examples]
    )
    targets = torch.tensor([labels.index(row["label_text"]) for row in examples])
    embed_seconds = time.perf_counter() - started
    score = prototype["scores"]
    metric = prototype["metrics"]
    with torch.no_grad():
        baseline = score(torch, text_vectors, label_vectors, torch.eye(text_vectors.shape[1]), 0.0)
        trained = score(torch, text_vectors, label_vectors, checkpoint["weight"], 1.0)
        selected = score(torch, text_vectors, label_vectors, checkpoint["weight"], checkpoint["alpha"])
        results = {
            "untouched_encoder": metric(torch, baseline, targets),
            "trained_projection_only": metric(torch, trained, targets),
            "banking_validation_selected": metric(torch, selected, targets),
        }
    report = {
        "format": "anvilmark-cross-domain-experiment/1",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "dataset": "MASSIVE English intent test via MTEB",
        "dataset_revision": REVISION,
        "dataset_file_sha256": FILE_SHA256,
        "dataset_license": "CC-BY-4.0 (AmazonScience original dataset card)",
        "encoder": prototype["MODEL_ID"],
        "encoder_revision": prototype["MODEL_REVISION"],
        "trained_on": "BANKING77 training label split only",
        "model_selection_on": "BANKING77 validation label split only",
        "examples": len(examples),
        "labels": len(labels),
        "embedding_seconds": round(embed_seconds, 3),
        "calibration_status": "not calibrated for MASSIVE; accuracy and macro-F1 are primary",
        "results": results,
    }
    output = ROOT / "results" / f"massive-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print(json.dumps({"examples": len(examples), "labels": len(labels), "embedding_seconds": embed_seconds,
                      "results": results}, indent=2))
    print(f"Report: {output}")


if __name__ == "__main__":
    main()
