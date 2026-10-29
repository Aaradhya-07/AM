"""Once-only original-source HWU evaluation of a validation-selected reranker."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import runpy
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SEED = 20261017


def normalize(text: str) -> str:
    return " ".join(text.lower().split())


def original_hwu_rows():
    source = runpy.run_path(str(ROOT / "fetch-hwu.py"))
    path = source["OUTPUT"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != source["SHA256"]:
        raise ValueError("HWU source hash changed")
    with path.open(encoding="utf-8-sig", newline="") as handle:
        entries = list(csv.DictReader(handle, delimiter=";"))
    if len(entries) != 25716:
        raise ValueError("unexpected HWU source row count")
    owners = defaultdict(set)
    per_label = defaultdict(dict)
    for row in entries:
        if row["status"].startswith("IRR") or not row["answer"].strip():
            continue
        label = f"{row['scenario']} {row['intent']}"
        key = normalize(row["answer"])
        owners[key].add(label)
        per_label[label].setdefault(key, row["answer"].strip())
    ambiguous = {key for key, labels in owners.items() if len(labels) > 1}
    rows = []
    for label in sorted(per_label):
        choices = [(text, label, key) for key, text in per_label[label].items()
                   if key not in ambiguous]
        choices.sort(key=lambda item: hashlib.sha256(
            (label + "\0" + item[2]).encode("utf-8")
        ).hexdigest())
        rows.extend((text, label) for text, label, _ in choices[:30])
    return rows, sorted(per_label), {
        "source_rows": len(entries),
        "ambiguous_normalized_texts_excluded": len(ambiguous),
        "sampled_rows_before_training_overlap_filter": len(rows),
    }


def accuracy_and_f1(predicted, targets, label_count):
    from sklearn.metrics import f1_score

    return {
        "accuracy": round(float((predicted == targets).mean()), 6),
        "macro_f1": round(float(f1_score(
            targets, predicted, labels=list(range(label_count)),
            average="macro", zero_division=0
        )), 6),
    }


def paired_interval(baseline_correct, candidate_correct, samples=2000):
    import numpy as np

    difference = candidate_correct.astype(float) - baseline_correct.astype(float)
    rng = np.random.default_rng(SEED)
    draws = [float(difference[rng.integers(len(difference), size=len(difference))].mean())
             for _ in range(samples)]
    return {"delta": round(float(difference.mean()), 6),
            "bootstrap_95_percent_interval": [round(float(x), 6)
                                               for x in np.quantile(draws, [0.025, 0.975])],
            "bootstrap_samples": samples}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    args = parser.parse_args()
    prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
    trainer = runpy.run_path(str(ROOT / "train-multidomain.py"))
    reranker = runpy.run_path(str(ROOT / "train-reranker.py"))
    torch, tokenizer, encoder = prototype["load_encoder"]()
    torch.set_num_threads(4)
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable")
    checkpoint = torch.load(
        ROOT / ".cache" / "label-aware-reranker.pt",
        map_location="cpu", weights_only=True,
    )
    if checkpoint["encoder_revision"] != prototype["MODEL_REVISION"]:
        raise ValueError("reranker encoder revision changed")
    if checkpoint["shortlist_k"] != reranker["TOP_K"]:
        raise ValueError("reranker shortlist size changed")

    rows, labels, source_summary = original_hwu_rows()
    _, banking = prototype["load_data"](30)
    training_texts = {
        normalize(text) for text, _ in banking["rows"]["train"]
    } | {
        normalize(text) for text, _ in trainer["massive_rows"]("train")
    }
    overlap_count = sum(normalize(text) in training_texts for text, _ in rows)
    rows = [(text, label) for text, label in rows
            if normalize(text) not in training_texts]
    if not rows:
        raise ValueError("no nonoverlapping HWU rows")
    started = time.perf_counter()
    prepared = reranker["prepare_domain"](torch, tokenizer, encoder, rows, labels)
    retrieval_seconds = time.perf_counter() - started

    encoder.load_state_dict(checkpoint["encoder_state"])
    encoder.to(args.device)
    head = torch.nn.Linear(encoder.config.hidden_size, 1)
    head.load_state_dict(checkpoint["head_state"])
    head.to(args.device)
    started = time.perf_counter()
    pair_logits = reranker["pair_scores"](
        torch, encoder, head, prepared["pair_inputs"], args.device
    )
    reranking_seconds = time.perf_counter() - started
    pair_logits = pair_logits.reshape(prepared["candidate_index"].shape)
    import numpy as np

    true = prepared["targets"].numpy()
    candidates = prepared["candidate_index"]
    retrieval_prediction = candidates[:, 0].numpy()
    pure_column = reranker["fused_choice"](
        torch, pair_logits, prepared["candidate_values"], 1.0
    )
    pure_prediction = candidates.gather(1, pure_column[:, None]).flatten().numpy()
    selected_column = reranker["fused_choice"](
        torch, pair_logits, prepared["candidate_values"],
        checkpoint["fusion_weight"],
    )
    selected_prediction = candidates.gather(
        1, selected_column[:, None]
    ).flatten().numpy()
    source = runpy.run_path(str(ROOT / "fetch-hwu.py"))
    report = {
        "format": "anvilmark-original-hwu-heldout/1",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "protocol": "NEXT-PROTOCOL.md",
        "source_url": source["URL"],
        "source_commit": source["COMMIT"],
        "source_sha256": source["SHA256"],
        "source_license": "CC-BY-4.0 (original repository)",
        "source_summary": source_summary,
        "exact_training_text_overlaps_excluded": overlap_count,
        "normalization": "lowercase and collapse whitespace",
        "test_examples": len(rows), "labels": len(labels),
        "label_count_note": "Original-source scenario+intent labels; not the canonical HWU64 preprocessing",
        "checkpoint_epoch": checkpoint["selected_epoch"],
        "fusion_weight_selected_on_other_validation": checkpoint["fusion_weight"],
        "shortlist_k": checkpoint["shortlist_k"],
        "device": args.device,
        "retrieval_top8_recall": prepared["retrieval_top8_recall"],
        "retrieval": accuracy_and_f1(retrieval_prediction, true, len(labels)),
        "pure_reranker": accuracy_and_f1(pure_prediction, true, len(labels)),
        "selected_fusion": accuracy_and_f1(selected_prediction, true, len(labels)),
        "paired_selected_vs_retrieval": paired_interval(
            retrieval_prediction == true, selected_prediction == true
        ),
        "paired_pure_vs_retrieval": paired_interval(
            retrieval_prediction == true, pure_prediction == true
        ),
        "timing_seconds": {
            "retrieval_and_pair_tokenization": round(retrieval_seconds, 3),
            "reranker_forward_pass": round(reranking_seconds, 3),
            "excludes_model_loading": True,
        },
        "test_usage_note": "first completed HWU report; initial invocation failed during macro-F1 formatting and was rerun with unchanged checkpoint and protocol; no HWU data used for training or selection",
    }
    output = ROOT / "results" / f"hwu-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print(json.dumps(report, indent=2))
    print(f"Report: {output}")


if __name__ == "__main__":
    main()
