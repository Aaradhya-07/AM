"""Exploratory two-stage CLINC150 baseline: MiniLM shortlist, GLiClass rerank."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import runpy
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CLINC_SHA256 = "36923c3705a59e08fe9c3883d8bc2dd966ef93e22cb78ac41171782a698d56e0"
GLICLASS_ID = "knowledgator/gliclass-edge-v3.0"
GLICLASS_REVISION = "df03993a2ed98e5e4a0d2dd7efbbd105abe874cf"
K = 20


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--split", choices=("train", "test"), default="train")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--prompt", action="store_true", help="pass the intent question to GLiClass")
    args = parser.parse_args()
    if args.batch_size < 1:
        raise ValueError("batch size must be positive")
    path = ROOT / ".cache" / "clinc150" / "data_full.json"
    if hashlib.sha256(path.read_bytes()).hexdigest() != CLINC_SHA256:
        raise ValueError("CLINC150 file hash changed")
    data = json.loads(path.read_text())
    labels = sorted({label for _, label in data["train"]})
    if len(labels) != 150:
        raise ValueError("expected 150 CLINC150 labels")
    readable = [label.replace("_", " ") for label in labels]
    if len(set(readable)) != len(readable):
        raise ValueError("label names collide after normalization")
    lookup = dict(zip(readable, labels))
    if args.split == "train":
        seen = set()
        rows = []
        for row in data["train"]:
            if row[1] not in seen:
                rows.append(row)
                seen.add(row[1])
        unknown = []
    else:
        rows = data["test"]
        unknown = data["oos_test"]

    prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
    candidate = runpy.run_path(str(ROOT / "train-question-encoder.py"))
    torch, tokenizer, encoder = prototype["load_encoder"]()
    torch.set_num_threads(4)
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable in this process")
    label_vectors = prototype["encode"](torch, tokenizer, encoder, readable)
    encoder.to(args.device)

    def shortlist(batch):
        logits = candidate["evaluate"](
            torch, tokenizer, encoder, [text for text, _ in batch],
            args.device, 64, label_vectors,
        )
        indexes = logits.topk(K, dim=-1).indices.tolist()
        return [[readable[index] for index in group] for group in indexes]

    started = time.perf_counter()
    known_candidates = shortlist(rows)
    unknown_candidates = shortlist(unknown) if unknown else []
    shortlist_seconds = time.perf_counter() - started
    shortlist_recall = sum(label in [lookup[name] for name in group]
                           for (_, label), group in zip(rows, known_candidates)) / len(rows)
    retriever_accuracy = sum(lookup[group[0]] == label
                             for (_, label), group in zip(rows, known_candidates)) / len(rows)

    cache = ROOT / ".cache" / "huggingface"
    os.environ["HF_HOME"] = str(cache)
    from gliclass import GLiClassModel, ZeroShotClassificationPipeline
    from sklearn.metrics import roc_auc_score
    from transformers import AutoTokenizer

    started = time.perf_counter()
    model = GLiClassModel.from_pretrained(
        GLICLASS_ID, revision=GLICLASS_REVISION, cache_dir=cache
    )
    label_tokenizer = AutoTokenizer.from_pretrained(
        GLICLASS_ID, revision=GLICLASS_REVISION, cache_dir=cache,
        add_prefix_space=True,
    )
    pipeline = ZeroShotClassificationPipeline(
        model, label_tokenizer, max_classes=K, max_length=512,
        classification_type="single-label", device=args.device,
        progress_bar=False,
    )
    load_seconds = time.perf_counter() - started

    def rerank(batch, candidates):
        if not batch:
            return []
        answers = pipeline(
            [text for text, _ in batch], candidates, batch_size=args.batch_size,
            prompt=candidate["QUESTION"] if args.prompt else None,
        )
        return [(lookup[answer[0]["label"]], answer[0]["score"])
                for answer in answers]

    started = time.perf_counter()
    known_predictions = rerank(rows, known_candidates)
    unknown_predictions = rerank(unknown, unknown_candidates)
    rerank_seconds = time.perf_counter() - started
    accuracy = sum(predicted == expected for (predicted, _), (_, expected)
                   in zip(known_predictions, rows)) / len(rows)
    report = {
        "format": "anvilmark-clinc150-shortlist-experiment/1",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "split": args.split,
        "external_model": True,
        "retriever": prototype["MODEL_ID"],
        "retriever_revision": prototype["MODEL_REVISION"],
        "reranker": GLICLASS_ID,
        "reranker_revision": GLICLASS_REVISION,
        "clinc_sha256": CLINC_SHA256,
        "device": args.device,
        "candidates": K,
        "batch_size": args.batch_size,
        "prompt": candidate["QUESTION"] if args.prompt else None,
        "in_scope_examples": len(rows),
        "out_of_scope_examples": len(unknown),
        "shortlist_recall": round(shortlist_recall, 6),
        "retriever_accuracy": round(retriever_accuracy, 6),
        "accuracy": round(accuracy, 6),
        "shortlist_seconds": round(shortlist_seconds, 3),
        "rerank_seconds": round(rerank_seconds, 3),
        "reranker_load_seconds": round(load_seconds, 3),
        "score_note": "GLiClass single-label confidence is uncalibrated for CLINC150",
    }
    if unknown_predictions:
        import numpy as np

        known_conf = np.array([score for _, score in known_predictions])
        unknown_conf = np.array([score for _, score in unknown_predictions])
        report["oos_auroc_from_max_probability"] = round(float(roc_auc_score(
            np.r_[np.zeros(len(known_conf)), np.ones(len(unknown_conf))],
            -np.r_[known_conf, unknown_conf],
        )), 6)
    if args.split == "test":
        output = ROOT / "results" / f"shortlist-clinc150-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
            json.dump(report, handle, indent=2)
            handle.write("\n")
        print(f"Report: {output}")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
