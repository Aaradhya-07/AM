"""Train a small dynamic-label scorer and test on unseen BANKING77 labels.

This is a research prototype. MiniLM supplies frozen text embeddings; our
trainable projection learns how to match a state to caller-supplied label text.
Train, validation, and test labels are disjoint. No test labels guide training
or model selection.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / ".cache" / "banking77"
HF_CACHE = ROOT / ".cache" / "huggingface"
MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
SEED = 20261017
SCALE = 20.0
ALPHAS = (0.0, 0.25, 0.5, 0.75, 1.0)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--examples-per-label", type=int, default=30)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--predict", type=str)
    parser.add_argument("--labels", type=str, help="JSON array of caller-defined labels")
    parser.add_argument("--checkpoint", type=Path, default=ROOT / ".cache" / "dynamic-label-head.pt")
    return parser.parse_args()


def load_data(examples_per_label: int) -> tuple[list[str], dict]:
    categories = json.loads((DATA / "categories.json").read_text())
    if len(categories) != 77 or len(set(categories)) != 77:
        raise ValueError("expected 77 unique BANKING77 categories")
    shuffled = list(categories)
    random.Random(SEED).shuffle(shuffled)
    label_sets = {
        "train": shuffled[:50],
        "validation": shuffled[50:63],
        "test": shuffled[63:],
    }
    rows = {}
    for split in ("train", "test"):
        with (DATA / f"{split}.csv").open(newline="") as handle:
            rows[split] = list(csv.DictReader(handle))
    for split, labels in label_sets.items():
        source = rows["train" if split == "train" else "test"]
        selected = []
        for label in labels:
            options = [(row["text"], label) for row in source if row["category"] == label]
            if len(options) < examples_per_label:
                raise ValueError(f"only {len(options)} examples for {label}")
            selected.extend(options[:examples_per_label])
        label_sets[split] = labels
        rows[split] = selected
    return categories, {"labels": label_sets, "rows": rows}


def readable_label(label: str) -> str:
    return label.replace("_", " ").replace("?", "")


def load_encoder():
    HF_CACHE.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(HF_CACHE)
    import torch
    from transformers import AutoModel, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID, revision=MODEL_REVISION, cache_dir=HF_CACHE
    )
    model = AutoModel.from_pretrained(MODEL_ID, revision=MODEL_REVISION, cache_dir=HF_CACHE)
    model.eval()
    observed = getattr(model.config, "_commit_hash", None)
    if observed and observed != MODEL_REVISION:
        raise ValueError(f"loaded revision {observed} differs from requested {MODEL_REVISION}")
    return torch, tokenizer, model


def encode(torch, tokenizer, model, texts: list[str], batch_size: int = 64):
    import torch.nn.functional as F

    vectors = []
    with torch.inference_mode():
        for start in range(0, len(texts), batch_size):
            inputs = tokenizer(
                texts[start:start + batch_size],
                padding=True,
                truncation=True,
                max_length=128,
                return_tensors="pt",
            )
            hidden = model(**inputs).last_hidden_state
            mask = inputs["attention_mask"].unsqueeze(-1)
            pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1)
            vectors.append(F.normalize(pooled, dim=-1))
    return torch.cat(vectors)


def scores(torch, text_vectors, label_vectors, weight, alpha: float):
    import torch.nn.functional as F

    projected = text_vectors @ weight.T
    mixed = F.normalize((1 - alpha) * text_vectors + alpha * projected, dim=-1)
    return SCALE * mixed @ label_vectors.T


def metrics(torch, logits, targets, temperature: float = 1.0) -> dict:
    import torch.nn.functional as F

    probabilities = (logits / temperature).softmax(-1)
    predictions = probabilities.argmax(-1)
    label_count = logits.shape[1]
    f1 = []
    for label in range(label_count):
        true_positive = int(((predictions == label) & (targets == label)).sum())
        false_positive = int(((predictions == label) & (targets != label)).sum())
        false_negative = int(((predictions != label) & (targets == label)).sum())
        denominator = 2 * true_positive + false_positive + false_negative
        f1.append(2 * true_positive / denominator if denominator else 0.0)
    correct = (predictions == targets).float()
    confidences = probabilities.max(-1).values
    accepted = confidences >= 0.8
    return {
        "count": len(targets),
        "labels": label_count,
        "accuracy": round(float(correct.mean()), 6),
        "macro_f1": round(statistics.mean(f1), 6),
        "nll": round(float(F.cross_entropy(logits / temperature, targets)), 6),
        "brier": round(float(((probabilities - F.one_hot(targets, label_count)) ** 2).sum(-1).mean()), 6),
        "coverage_at_0_8": round(float(accepted.float().mean()), 6),
        "accuracy_at_0_8": round(float(correct[accepted].mean()), 6) if accepted.any() else None,
    }


def calibration_temperature(torch, logits, targets) -> float:
    import torch.nn.functional as F

    candidates = [0.25 * 64 ** (i / 80) for i in range(81)]
    return min(candidates, key=lambda value: float(F.cross_entropy(logits / value, targets)))


def save_private(torch, path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as handle:
        torch.save(payload, handle)


def predict(args: argparse.Namespace) -> None:
    if not args.labels:
        raise ValueError("--predict requires --labels with a JSON array")
    labels = json.loads(args.labels)
    if not isinstance(labels, list) or len(labels) < 2 or any(
        not isinstance(label, str) or not label.strip() for label in labels
    ) or len(set(labels)) != len(labels):
        raise ValueError("--labels needs at least two distinct nonempty strings")
    torch, tokenizer, encoder = load_encoder()
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    if checkpoint["encoder_revision"] != MODEL_REVISION:
        raise ValueError("checkpoint uses another encoder revision")
    vectors = encode(torch, tokenizer, encoder, [args.predict] + labels)
    logits = scores(torch, vectors[:1], vectors[1:], checkpoint["weight"], checkpoint["alpha"])
    probabilities = (logits / checkpoint["temperature"]).softmax(-1)[0]
    choice = labels[int(probabilities.argmax())]
    print(json.dumps({"choice": choice, "probabilities": dict(zip(labels, probabilities.tolist())),
                      "calibration_domain": "BANKING77 validation labels"}, indent=2))


def train(args: argparse.Namespace) -> None:
    if min(args.epochs, args.examples_per_label, args.threads) < 1:
        raise ValueError("epochs, examples per label, and threads must be positive")
    categories, data = load_data(args.examples_per_label)
    torch, tokenizer, encoder = load_encoder()
    import torch.nn.functional as F

    torch.manual_seed(SEED)
    torch.set_num_threads(args.threads)
    started = time.perf_counter()
    label_vectors_all = encode(torch, tokenizer, encoder, [readable_label(x) for x in categories])
    label_to_vector = {label: label_vectors_all[index] for index, label in enumerate(categories)}
    features = {}
    targets = {}
    label_vectors = {}
    for split in ("train", "validation", "test"):
        labels = data["labels"][split]
        rows = data["rows"][split]
        features[split] = encode(torch, tokenizer, encoder, [text for text, _ in rows])
        targets[split] = torch.tensor([labels.index(label) for _, label in rows])
        label_vectors[split] = torch.stack([label_to_vector[label] for label in labels])
    embedding_seconds = time.perf_counter() - started

    dimension = features["train"].shape[1]
    weight = torch.nn.Parameter(torch.eye(dimension))
    optimizer = torch.optim.AdamW([weight], lr=0.001, weight_decay=0.01)
    best = {"accuracy": -1.0, "nll": math.inf}
    train_started = time.perf_counter()
    for epoch in range(1, args.epochs + 1):
        order = torch.randperm(len(features["train"]))
        for indexes in order.split(128):
            optimizer.zero_grad()
            logits = scores(torch, features["train"][indexes], label_vectors["train"], weight, 1.0)
            loss = F.cross_entropy(logits, targets["train"][indexes])
            loss.backward()
            optimizer.step()
        with torch.no_grad():
            for alpha in ALPHAS:
                logits = scores(torch, features["validation"], label_vectors["validation"], weight, alpha)
                result = metrics(torch, logits, targets["validation"])
                key = (result["accuracy"], -result["nll"])
                if key > (best["accuracy"], -best["nll"]):
                    best = {"accuracy": result["accuracy"], "nll": result["nll"],
                            "epoch": epoch, "alpha": alpha, "weight": weight.detach().clone()}
    training_seconds = time.perf_counter() - train_started

    with torch.no_grad():
        identity = torch.eye(dimension)
        baseline_validation = scores(torch, features["validation"], label_vectors["validation"], identity, 0.0)
        baseline_test = scores(torch, features["test"], label_vectors["test"], identity, 0.0)
        selected_validation = scores(torch, features["validation"], label_vectors["validation"], best["weight"], best["alpha"])
        selected_test = scores(torch, features["test"], label_vectors["test"], best["weight"], best["alpha"])
        trained_test = scores(torch, features["test"], label_vectors["test"], best["weight"], 1.0)
        baseline_temperature = calibration_temperature(torch, baseline_validation, targets["validation"])
        selected_temperature = calibration_temperature(torch, selected_validation, targets["validation"])
        report = {
            "format": "anvilmark-dynamic-label-experiment/1",
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "dataset": "BANKING77",
            "dataset_revision": "57ec275d8078af65b7731c2a98be812d844a6d6b",
            "dataset_license": "CC-BY-4.0 (Hugging Face dataset card)",
            "encoder": MODEL_ID,
            "encoder_revision": MODEL_REVISION,
            "device": "cpu",
            "seed": SEED,
            "threads": args.threads,
            "examples_per_label": args.examples_per_label,
            "split_labels": data["labels"],
            "embedding_seconds": round(embedding_seconds, 3),
            "training_seconds": round(training_seconds, 3),
            "selected_epoch": best["epoch"],
            "selected_alpha": best["alpha"],
            "baseline_temperature": baseline_temperature,
            "selected_temperature": selected_temperature,
            "validation": {
                "baseline": metrics(torch, baseline_validation, targets["validation"], baseline_temperature),
                "selected": metrics(torch, selected_validation, targets["validation"], selected_temperature),
            },
            "test": {
                "baseline": metrics(torch, baseline_test, targets["test"], baseline_temperature),
                "trained_projection_only": metrics(torch, trained_test, targets["test"], selected_temperature),
                "selected": metrics(torch, selected_test, targets["test"], selected_temperature),
            },
        }
    save_private(torch, args.checkpoint, {
        "weight": best["weight"], "alpha": best["alpha"],
        "temperature": selected_temperature, "encoder_revision": MODEL_REVISION,
    })
    output = ROOT / "results" / f"dynamic-label-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print(json.dumps({key: report[key] for key in (
        "embedding_seconds", "training_seconds", "selected_epoch", "selected_alpha", "validation", "test"
    )}, indent=2))
    print(f"Report: {output}")
    print(f"Checkpoint: {args.checkpoint}")


def main() -> None:
    args = arguments()
    if args.threads < 1:
        raise ValueError("--threads must be positive")
    if args.predict is not None:
        predict(args)
    else:
        train(args)


if __name__ == "__main__":
    main()
