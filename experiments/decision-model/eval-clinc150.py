"""Once-only held-out CLINC150 test for the BANKING77+MASSIVE model."""

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
CLINC_COMMIT = "828f8093932c8fe6ca7936c3d2e52903b1c523de"
CLINC_SHA256 = "36923c3705a59e08fe9c3883d8bc2dd966ef93e22cb78ac41171782a698d56e0"
SEED = 20261017


def paired_accuracy_interval(baseline, trained, targets, samples: int = 2000):
    import numpy as np

    difference = ((trained.argmax(-1) == targets).numpy().astype(float)
                  - (baseline.argmax(-1) == targets).numpy().astype(float))
    rng = np.random.default_rng(SEED)
    draws = [float(difference[rng.integers(len(difference), size=len(difference))].mean())
             for _ in range(samples)]
    return {
        "delta": round(float(difference.mean()), 6),
        "bootstrap_95_percent_interval": [round(float(x), 6)
                                           for x in np.quantile(draws, [0.025, 0.975])],
        "bootstrap_samples": samples,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()
    if args.batch_size < 1:
        raise ValueError("batch size must be positive")

    path = ROOT / ".cache" / "clinc150" / "data_full.json"
    if hashlib.sha256(path.read_bytes()).hexdigest() != CLINC_SHA256:
        raise ValueError("CLINC150 file hash changed")
    data = json.loads(path.read_text())
    labels = sorted({label for _, label in data["train"]})
    if len(labels) != 150 or len(data["test"]) != 4500 or len(data["oos_test"]) != 1000:
        raise ValueError("unexpected CLINC150 schema or split counts")
    if {label for _, label in data["test"]} != set(labels):
        raise ValueError("CLINC150 test labels differ from training label names")

    prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
    candidate = runpy.run_path(str(ROOT / "train-question-encoder.py"))
    trainer = runpy.run_path(str(ROOT / "train-multidomain.py"))
    _, banking = prototype["load_data"](30)
    normalize = lambda value: " ".join(value.lower().split())
    training_texts = {
        normalize(text) for text, _ in banking["rows"]["train"]
    } | {
        normalize(text) for text, _ in trainer["massive_rows"]("train")
    }
    torch, tokenizer, model = prototype["load_encoder"]()
    torch.set_num_threads(4)
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable in this process")
    checkpoint = torch.load(
        ROOT / ".cache" / "multidomain-query-encoder.pt",
        map_location="cpu", weights_only=True,
    )
    if checkpoint["encoder_revision"] != prototype["MODEL_REVISION"]:
        raise ValueError("checkpoint uses a different encoder revision")

    label_vectors = prototype["encode"](
        torch, tokenizer, model,
        [prototype["readable_label"](label) for label in labels],
    )
    lookup = {label: i for i, label in enumerate(labels)}
    targets = torch.tensor([lookup[label] for _, label in data["test"]])
    nonoverlap = torch.tensor([normalize(text) not in training_texts
                               for text, _ in data["test"]])
    oos_overlap = sum(normalize(text) in training_texts
                      for text, _ in data["oos_test"])
    model.to(args.device)
    from sklearn.metrics import roc_auc_score

    def evaluate_weights():
        output = {}
        for prompted in (False, True):
            mode = "prompted" if prompted else "raw"
            known = [candidate["query"](text) if prompted else text
                     for text, _ in data["test"]]
            unknown = [candidate["query"](text) if prompted else text
                       for text, _ in data["oos_test"]]
            started = time.perf_counter()
            known_logits = candidate["evaluate"](
                torch, tokenizer, model, known, args.device, args.batch_size,
                label_vectors,
            )
            unknown_logits = candidate["evaluate"](
                torch, tokenizer, model, unknown, args.device, args.batch_size,
                label_vectors,
            )
            known_conf = known_logits.softmax(-1).max(-1).values.numpy()
            unknown_conf = unknown_logits.softmax(-1).max(-1).values.numpy()
            import numpy as np

            auroc = roc_auc_score(
                np.r_[np.zeros(len(known_conf)), np.ones(len(unknown_conf))],
                -np.r_[known_conf, unknown_conf],
            )
            output[mode] = {
                "in_scope": prototype["metrics"](torch, known_logits, targets),
                "in_scope_excluding_exact_training_text_overlaps": prototype["metrics"](
                    torch, known_logits[nonoverlap], targets[nonoverlap]
                ),
                "oos_detection_auroc_from_max_probability": round(float(auroc), 6),
                "evaluation_seconds_for_5500": round(time.perf_counter() - started, 3),
                "logits": known_logits,
            }
        return output

    baseline = evaluate_weights()
    model.load_state_dict(checkpoint["state_dict"])
    trained = evaluate_weights()
    comparisons = {
        mode: paired_accuracy_interval(
            baseline[mode]["logits"], trained[mode]["logits"], targets
        ) for mode in ("raw", "prompted")
    }
    nonoverlap_comparisons = {
        mode: paired_accuracy_interval(
            baseline[mode]["logits"][nonoverlap],
            trained[mode]["logits"][nonoverlap], targets[nonoverlap]
        ) for mode in ("raw", "prompted")
    }
    for result in (baseline, trained):
        for mode in ("raw", "prompted"):
            del result[mode]["logits"]
    report = {
        "format": "anvilmark-clinc150-heldout/2",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "clinc_commit": CLINC_COMMIT,
        "clinc_sha256": CLINC_SHA256,
        "clinc_license": "CC-BY-3.0 (original repository)",
        "encoder": prototype["MODEL_ID"],
        "encoder_revision": prototype["MODEL_REVISION"],
        "trained_on": "BANKING77 and MASSIVE training splits only",
        "checkpoint_selection": "BANKING77 and MASSIVE validation splits only",
        "selected_epoch": checkpoint["selected_epoch"],
        "question": candidate["QUESTION"],
        "device": args.device,
        "batch_size": args.batch_size,
        "labels": len(labels),
        "in_scope_test_examples": len(data["test"]),
        "out_of_scope_test_examples": len(data["oos_test"]),
        "exact_training_text_overlap": {
            "normalization": "lowercase and collapse whitespace",
            "in_scope": int((~nonoverlap).sum()),
            "out_of_scope": oos_overlap,
            "in_scope_nonoverlap_count": int(nonoverlap.sum()),
        },
        "untouched_encoder": baseline,
        "trained_encoder": trained,
        "paired_accuracy_comparison": comparisons,
        "paired_accuracy_comparison_excluding_overlaps": nonoverlap_comparisons,
        "audit_note": "Fixed checkpoint rerun after identifying exact cross-dataset text matches; no training or selection changes",
        "probabilities_note": "softmax scores have not been calibrated for CLINC150",
    }
    output = ROOT / "results" / f"clinc150-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print(json.dumps(report, indent=2))
    print(f"Report: {output}")


if __name__ == "__main__":
    main()
