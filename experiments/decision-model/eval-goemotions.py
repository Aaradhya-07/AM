"""Once-only non-intent transfer test on official GoEmotions single-label rows."""

from __future__ import annotations

import hashlib
import json
import os
import runpy
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def normalize(text):
    return " ".join(text.lower().split())


def sample(rows, per_label):
    by_label = defaultdict(dict)
    for text, label in rows:
        by_label[label].setdefault(normalize(text), text)
    chosen = []
    for label in sorted(by_label):
        entries = list(by_label[label].items())
        entries.sort(key=lambda item: hashlib.sha256(
            (label + "\0" + item[0]).encode("utf-8")
        ).hexdigest())
        chosen.extend((text, label) for _, text in entries[:per_label])
    return chosen


def load_tasks():
    source = runpy.run_path(str(ROOT / "fetch-goemotions.py"))
    for name, expected in source["HASHES"].items():
        if hashlib.sha256((source["DATA"] / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"GoEmotions {name} hash changed")
    emotions = (source["DATA"] / "emotions.txt").read_text().splitlines()
    mapping = json.loads((source["DATA"] / "sentiment_mapping.json").read_text())
    sentiment_for = {emotion: sentiment for sentiment in ("positive", "negative")
                     for emotion in mapping[sentiment]}
    single = []
    with (source["DATA"] / "test.tsv").open(encoding="utf-8") as handle:
        for line in handle:
            text, label_ids, _ = line.rstrip("\n").split("\t")
            ids = label_ids.split(",")
            if len(ids) == 1 and text.strip():
                single.append((text, emotions[int(ids[0])]))
    emotion_rows = sample(single, 50)
    sentiment_rows = sample(
        [(text, sentiment_for[label]) for text, label in single
         if label in sentiment_for], 1000
    )
    return source, single, {
        "emotion_28_way": (emotion_rows, emotions),
        "binary_sentiment_from_emotion_mapping": (
            sentiment_rows, ["negative", "positive"]
        ),
    }


def main():
    import numpy as np
    from sklearn.metrics import f1_score

    prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
    trainer = runpy.run_path(str(ROOT / "train-multidomain.py"))
    reranker = runpy.run_path(str(ROOT / "train-reranker.py"))
    hwu_eval = runpy.run_path(str(ROOT / "eval-hwu.py"))
    source, single, tasks = load_tasks()
    _, bank = prototype["load_data"](30)
    training_texts = {normalize(text) for text, _ in bank["rows"]["train"]} | {
        normalize(text) for text, _ in trainer["massive_rows"]("train")
    }
    torch, tokenizer, encoder = prototype["load_encoder"]()
    torch.set_num_threads(4)
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable")
    checkpoint = torch.load(ROOT / ".cache" / "label-aware-reranker.pt",
                            map_location="cpu", weights_only=True)
    if checkpoint["encoder_revision"] != prototype["MODEL_REVISION"]:
        raise ValueError("checkpoint encoder revision changed")
    prepared = {}
    for name, (all_rows, labels) in tasks.items():
        overlap = sum(normalize(text) in training_texts for text, _ in all_rows)
        rows = [(text, label) for text, label in all_rows
                if normalize(text) not in training_texts]
        started = time.perf_counter()
        domain = reranker["prepare_domain"](torch, tokenizer, encoder, rows, labels)
        prepared[name] = (domain, len(all_rows), overlap,
                          round(time.perf_counter() - started, 3))
    encoder.load_state_dict(checkpoint["encoder_state"])
    encoder.to("cuda")
    head = torch.nn.Linear(encoder.config.hidden_size, 1)
    head.load_state_dict(checkpoint["head_state"])
    head.to("cuda")

    results = {}
    for name, (domain, sampled_count, overlap, retrieval_seconds) in prepared.items():
        started = time.perf_counter()
        logits = reranker["pair_scores"](
            torch, encoder, head, domain["pair_inputs"], "cuda"
        ).reshape(domain["candidate_index"].shape)
        reranking_seconds = round(time.perf_counter() - started, 3)
        choices = domain["candidate_index"]
        true = domain["targets"].numpy()
        base = choices[:, 0].numpy()
        pure_column = reranker["fused_choice"](
            torch, logits, domain["candidate_values"], 1.0
        )
        pure = choices.gather(1, pure_column[:, None]).flatten().numpy()
        selected_column = reranker["fused_choice"](
            torch, logits, domain["candidate_values"],
            checkpoint["fusion_weight"],
        )
        selected = choices.gather(1, selected_column[:, None]).flatten().numpy()
        def metrics(pred):
            return {
                "accuracy": round(float((pred == true).mean()), 6),
                "macro_f1": round(float(f1_score(
                    true, pred, labels=list(range(len(domain["labels"]))),
                    average="macro", zero_division=0,
                )), 6),
            }
        results[name] = {
            "sampled_before_overlap_filter": sampled_count,
            "exact_training_text_overlaps_excluded": overlap,
            "examples": len(true), "labels": len(domain["labels"]),
            "shortlist_recall": domain["retrieval_top8_recall"],
            "retrieval": metrics(base),
            "pure_reranker": metrics(pure),
            "selected_fusion": metrics(selected),
            "selected_vs_retrieval": hwu_eval["paired_interval"](
                base == true, selected == true
            ),
            "timing_seconds_excluding_load": {
                "retrieval_and_pair_tokenization": retrieval_seconds,
                "reranker_forward_pass": reranking_seconds,
            },
        }
    report = {
        "format": "anvilmark-goemotions-transfer/1",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "protocol": "NEXT-PROTOCOL.md supplemental non-intent check",
        "source": "https://github.com/google-research/google-research/tree/master/goemotions",
        "source_commit": source["COMMIT"], "source_hashes": source["HASHES"],
        "source_license": "CC-BY-4.0 (original repository statement)",
        "official_test_rows": 5427,
        "single_label_rows": len(single),
        "selected_epoch": checkpoint["selected_epoch"],
        "fusion_weight": checkpoint["fusion_weight"],
        "device": "cuda", "tasks": results,
        "binary_label_note": "Publisher emotion-to-sentiment mapping, not independently annotated binary sentiment",
        "test_usage_note": "fixed checkpoint; no GoEmotions data used for training or model selection",
    }
    output = ROOT / "results" / f"goemotions-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print(json.dumps(report, indent=2))
    print(f"Report: {output}")


if __name__ == "__main__":
    main()
