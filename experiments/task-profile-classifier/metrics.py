"""Shared, fixed issue-type metrics and validation-only suggestion threshold."""

from __future__ import annotations

import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support

from data import LABELS


def class_metrics(truth: np.ndarray, predictions: np.ndarray) -> dict:
    precision, recall, f1, support = precision_recall_fscore_support(
        truth, predictions, labels=list(range(len(LABELS))), zero_division=0
    )
    return {
        "accuracy": float(accuracy_score(truth, predictions)),
        "micro_f1": float(f1_score(truth, predictions, average="micro")),
        "macro_f1": float(f1_score(truth, predictions, average="macro")),
        "classes": {label: {"precision": float(precision[i]), "recall": float(recall[i]),
                            "f1": float(f1[i]), "support": int(support[i])}
                    for i, label in enumerate(LABELS)},
        "confusion_matrix": confusion_matrix(truth, predictions, labels=list(range(len(LABELS)))).tolist(),
    }


def suggestion_threshold(truth: np.ndarray, probabilities: np.ndarray) -> float | None:
    predicted = probabilities.argmax(1)
    confidence = probabilities.max(1)
    candidates = [(float(confidence[i]), int(predicted[i] == truth[i]))
                  for i in range(len(truth)) if predicted[i] in (0, 1)]
    candidates.sort(reverse=True)
    correct = 0
    best = None
    for index, (score, is_correct) in enumerate(candidates):
        correct += is_correct
        if index + 1 < 100:
            continue
        if index + 1 < len(candidates) and candidates[index + 1][0] == score:
            continue
        if correct / (index + 1) >= 0.95:
            best = score
    return best


def suggestion_metrics(truth: np.ndarray, probabilities: np.ndarray, threshold: float | None) -> dict:
    if threshold is None:
        return {"threshold": None, "coverage": 0.0, "emitted": 0, "precision": None}
    predicted = probabilities.argmax(1)
    emitted = np.isin(predicted, [0, 1]) & (probabilities.max(1) >= threshold)
    count = int(emitted.sum())
    return {"threshold": threshold, "coverage": count / len(truth), "emitted": count,
            "precision": float((predicted[emitted] == truth[emitted]).mean()) if count else None}
