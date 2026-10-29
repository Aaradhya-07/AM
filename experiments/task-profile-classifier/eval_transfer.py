"""Fixed-checkpoint transfer to the independent NLBSE'24 issue test."""

from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter

import joblib
import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support

from data import CACHE, LABELS, TRANSFER_SHA256, normalized_text, read_sample, row_text, verify_sha256
from metrics import suggestion_metrics
from train import RESULTS, arrays, predict_minilm

TRANSFER_LABELS = ("bug", "feature", "question")


def metrics(truth: np.ndarray, predicted: np.ndarray) -> dict:
    precision, recall, f1, support = precision_recall_fscore_support(
        truth, predicted, labels=[0, 1, 2], zero_division=0
    )
    return {
        "accuracy": float(accuracy_score(truth, predicted)),
        "macro_f1": float(np.mean(f1)),
        "per_class": {label: {"precision": float(precision[i]), "recall": float(recall[i]),
                              "f1": float(f1[i]), "support": int(support[i])}
                      for i, label in enumerate(TRANSFER_LABELS)},
        "confusion_matrix_rows_bug_feature_question_columns_bug_feature_question_documentation":
            confusion_matrix(truth, predicted, labels=[0, 1, 2, 3])[:3].tolist(),
    }


def model_report(records, truth, overlap_mask, probabilities, threshold):
    predicted = probabilities.argmax(1)
    repositories = sorted({row["repo"] for row in records})
    per_repo = {}
    for repo in repositories:
        mask = np.array([row["repo"] == repo for row in records])
        per_repo[repo] = metrics(truth[mask], predicted[mask])
    return {
        "full": metrics(truth, predicted),
        "without_exact_nlbse23_train_overlap": metrics(truth[~overlap_mask], predicted[~overlap_mask]),
        "per_repository": per_repo,
        "mean_repository_macro_f1": float(np.mean([item["macro_f1"] for item in per_repo.values()])),
        "bug_feature_suggestions": suggestion_metrics(truth, probabilities, threshold),
    }


def main() -> None:
    path = CACHE / "nlbse24-test.csv"
    verify_sha256(path, TRANSFER_SHA256)
    with path.open(encoding="utf-8", errors="replace", newline="") as source:
        csv.field_size_limit(20_000_000)
        rows = list(csv.DictReader(source))
    if len(rows) != 1500:
        raise ValueError(f"unexpected NLBSE24 test row count: {len(rows)}")
    if set(row["label"] for row in rows) != set(TRANSFER_LABELS):
        raise ValueError("unexpected NLBSE24 labels")
    records = [{"repo": row["repo"], "label": row["label"], "text": row_text(row)}
               for row in rows]
    texts, truth = arrays(records)
    selected_train = read_sample("train")
    train_hashes = {hashlib.sha256(normalized_text(row["text"]).encode()).digest()
                    for row in selected_train}
    overlaps = np.array([hashlib.sha256(normalized_text(text).encode()).digest() in train_hashes
                         for text in texts], dtype=bool)
    linear_validation = json.loads((RESULTS / "linear-validation.json").read_text())
    minilm_validation = json.loads((RESULTS / "minilm-validation.json").read_text())
    report = {
        "source": "NLBSE24 official issue test, zero-shot from NLBSE23 training",
        "source_commit": "2927bc67eb42db8affd16eaf3e5a6d74f3063961",
        "file_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "rows": len(records),
        "counts": dict(Counter(row["label"] for row in records)),
        "repositories": dict(Counter(row["repo"] for row in records)),
        "exact_text_overlap_with_selected_nlbse23_train": int(overlaps.sum()),
    }
    bundle = joblib.load(CACHE / "linear.joblib")
    linear_probability = bundle["classifier"].predict_proba(bundle["vectorizer"].transform(texts))
    report["linear"] = model_report(records, truth, overlaps, linear_probability,
                                    linear_validation["suggestions"]["threshold"])
    del bundle, linear_probability

    import torch
    from transformers import AutoModel, AutoTokenizer

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable for fixed GPU transfer evaluation")
    torch.set_num_threads(4)
    model_path = CACHE / "minilm-selected"
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
    model = AutoModel.from_pretrained(model_path, local_files_only=True).to("cuda")
    head = torch.nn.Linear(model.config.hidden_size, len(LABELS)).to("cuda")
    head.load_state_dict(torch.load(model_path / "head.pt", map_location="cuda", weights_only=True))
    probabilities = predict_minilm(torch, model, head, tokenizer, texts, "cuda")
    report["minilm"] = model_report(records, truth, overlaps, probabilities,
                                    minilm_validation["suggestions"]["threshold"])
    output = RESULTS / "external-nlbse24-test.json"
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(output), "rows": len(records), "overlap": int(overlaps.sum()),
                      "linear_macro_f1": report["linear"]["full"]["macro_f1"],
                      "minilm_macro_f1": report["minilm"]["full"]["macro_f1"],
                      "minilm_suggestion_precision": report["minilm"]["bug_feature_suggestions"]["precision"],
                      "minilm_suggestion_coverage": report["minilm"]["bug_feature_suggestions"]["coverage"]}), flush=True)


if __name__ == "__main__":
    main()
