"""Once-only fixed-checkpoint test on an ordered human-judged question score."""

from __future__ import annotations

import hashlib
import json
import math
import os
import runpy
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LABELS = [
    "0/5: not a well-formed natural language question",
    "1/5: barely a well-formed natural language question",
    "2/5: poorly formed natural language question",
    "3/5: moderately well-formed natural language question",
    "4/5: mostly well-formed natural language question",
    "5/5: fully well-formed natural language question",
]
SEED = 20261017


def normalize(text):
    return " ".join(text.lower().split())


def paired_mae_interval(base, selected, true, samples=2000):
    import numpy as np

    difference = np.abs(selected - true) - np.abs(base - true)
    rng = np.random.default_rng(SEED)
    draws = [float(difference[rng.integers(len(difference), size=len(difference))].mean())
             for _ in range(samples)]
    return {"delta_mae_negative_is_better": round(float(difference.mean()), 6),
            "bootstrap_95_percent_interval": [round(float(x), 6)
                                               for x in np.quantile(draws, [0.025, 0.975])],
            "bootstrap_samples": samples}


def main():
    import numpy as np

    source = runpy.run_path(str(ROOT / "fetch-wellformedness.py"))
    if hashlib.sha256(source["OUTPUT"].read_bytes()).hexdigest() != source["SHA256"]:
        raise ValueError("wellformedness source hash changed")
    source_rows = []
    with source["OUTPUT"].open(encoding="utf-8") as handle:
        for line in handle:
            text, raw_score = line.rstrip("\n").rsplit("\t", 1)
            score = float(raw_score)
            index = math.floor(5 * score + 0.5)
            if index not in range(6):
                raise ValueError(f"unexpected score {score}")
            source_rows.append((text, LABELS[index], score))
    if len(source_rows) != 3850:
        raise ValueError("unexpected test split size")
    prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
    trainer = runpy.run_path(str(ROOT / "train-multidomain.py"))
    reranker = runpy.run_path(str(ROOT / "train-reranker.py"))
    _, bank = prototype["load_data"](30)
    training_texts = {normalize(text) for text, _ in bank["rows"]["train"]} | {
        normalize(text) for text, _ in trainer["massive_rows"]("train")
    }
    overlap = sum(normalize(text) in training_texts for text, _, _ in source_rows)
    source_rows = [(text, label, score) for text, label, score in source_rows
                   if normalize(text) not in training_texts]
    rows = [(text, label) for text, label, _ in source_rows]

    torch, tokenizer, encoder = prototype["load_encoder"]()
    torch.set_num_threads(4)
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable")
    checkpoint = torch.load(ROOT / ".cache" / "label-aware-reranker.pt",
                            map_location="cpu", weights_only=True)
    if checkpoint["encoder_revision"] != prototype["MODEL_REVISION"]:
        raise ValueError("checkpoint encoder revision changed")
    started = time.perf_counter()
    domain = reranker["prepare_domain"](torch, tokenizer, encoder, rows, LABELS)
    retrieval_seconds = time.perf_counter() - started
    encoder.load_state_dict(checkpoint["encoder_state"])
    encoder.to("cuda")
    head = torch.nn.Linear(encoder.config.hidden_size, 1)
    head.load_state_dict(checkpoint["head_state"])
    head.to("cuda")
    started = time.perf_counter()
    logits = reranker["pair_scores"](
        torch, encoder, head, domain["pair_inputs"], "cuda"
    ).reshape(domain["candidate_index"].shape)
    reranker_seconds = time.perf_counter() - started
    choices = domain["candidate_index"]
    true_binned = domain["targets"].numpy() / 5
    true = np.asarray([score for _, _, score in source_rows])
    base = choices[:, 0].numpy() / 5
    pure_column = reranker["fused_choice"](
        torch, logits, domain["candidate_values"], 1.0
    )
    pure = choices.gather(1, pure_column[:, None]).flatten().numpy() / 5
    selected_column = reranker["fused_choice"](
        torch, logits, domain["candidate_values"], checkpoint["fusion_weight"]
    )
    selected = choices.gather(1, selected_column[:, None]).flatten().numpy() / 5
    def metrics(predicted):
        return {"exact_binned_accuracy": round(float(np.mean(predicted == true_binned)), 6),
                "mae": round(float(np.mean(np.abs(predicted - true))), 6),
                "within_one_step": round(float(np.mean(np.abs(predicted - true) <= 0.200001)), 6)}
    report = {
        "format": "anvilmark-wellformedness-score-transfer/1",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "protocol": "NEXT-PROTOCOL.md supplemental ordered-score check",
        "source_url": source["URL"],
        "source_commit": source["COMMIT"],
        "source_sha256": source["SHA256"],
        "source_license": "CC BY-SA 4.0 (original repository)",
        "official_test_examples": 3850,
        "exact_training_text_overlaps_excluded": overlap,
        "evaluated_examples": len(rows),
        "score_labels": LABELS,
        "score_provenance": "publisher describes mean of five human binary well-formedness judgments; 13 source ratings are off the 0.2 grid",
        "non_grid_source_ratings": sum(abs(score - round(5 * score) / 5) > 1e-6
                                       for _, _, score in source_rows),
        "exact_accuracy_rule": "nearest 0.2 bin; MAE uses original fractional rating",
        "selected_epoch": checkpoint["selected_epoch"],
        "fusion_weight": checkpoint["fusion_weight"],
        "shortlist_recall": domain["retrieval_top8_recall"],
        "constant_0_5_mae": round(float(np.mean(np.abs(0.5 - true))), 6),
        "retrieval": metrics(base),
        "pure_reranker": metrics(pure),
        "selected_fusion": metrics(selected),
        "paired_selected_vs_retrieval": paired_mae_interval(base, selected, true),
        "timing_seconds_excluding_model_load": {
            "retrieval_and_pair_tokenization": round(retrieval_seconds, 3),
            "reranker_forward_pass": round(reranker_seconds, 3),
        },
        "test_usage_note": "fixed checkpoint and labels; no wellformedness data used for training or selection",
    }
    output = ROOT / "results" / f"wellformedness-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print(json.dumps(report, indent=2))
    print(f"Report: {output}")


if __name__ == "__main__":
    main()
