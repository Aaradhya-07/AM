"""Train fixed linear and compact GPU baselines for NLBSE issue types."""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

from data import CACHE, LABELS, read_sample
from metrics import class_metrics, suggestion_metrics, suggestion_threshold

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
SEED = 17
BASE_ID = "sentence-transformers/all-MiniLM-L6-v2"
BASE_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"


def arrays(rows):
    index = {label: i for i, label in enumerate(LABELS)}
    return [row["text"] for row in rows], np.array([index[row["label"]] for row in rows])


def save_report(name: str, report: dict) -> None:
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{name}-validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"model": name, "validation": report["metrics"],
                      "suggestions": report["suggestions"]}), flush=True)


def train_linear() -> None:
    train_texts, train_labels = arrays(read_sample("train"))
    valid_texts, valid_labels = arrays(read_sample("validation"))
    started = time.perf_counter()
    vectorizer = TfidfVectorizer(max_features=200_000, min_df=2, ngram_range=(1, 2),
                                 sublinear_tf=True, dtype=np.float32, strip_accents="unicode")
    features = vectorizer.fit_transform(train_texts)
    classifier = LogisticRegression(max_iter=200, solver="lbfgs", random_state=SEED)
    classifier.fit(features, train_labels)
    train_seconds = time.perf_counter() - started
    probabilities = classifier.predict_proba(vectorizer.transform(valid_texts))
    threshold = suggestion_threshold(valid_labels, probabilities)
    report = {
        "source": "NLBSE23 training sample, validation holdout",
        "model": "word unigram/bigram TF-IDF + logistic regression",
        "train_seconds": train_seconds,
        "features": len(vectorizer.vocabulary_),
        "metrics": class_metrics(valid_labels, probabilities.argmax(1)),
        "suggestions": suggestion_metrics(valid_labels, probabilities, threshold),
    }
    joblib.dump({"vectorizer": vectorizer, "classifier": classifier}, CACHE / "linear.joblib")
    save_report("linear", report)


def pooled(torch, hidden, mask):
    mask = mask.unsqueeze(-1)
    return (hidden * mask).sum(1) / mask.sum(1).clamp(min=1)


def predict_minilm(torch, model, head, tokenizer, texts, device, batch_size=128):
    model.eval()
    head.eval()
    chunks = []
    with torch.inference_mode():
        for start in range(0, len(texts), batch_size):
            batch = tokenizer(texts[start:start + batch_size], padding=True,
                              truncation=True, max_length=192, return_tensors="pt")
            batch = {key: value.to(device) for key, value in batch.items()}
            with torch.autocast("cuda", dtype=torch.float16, enabled=device == "cuda"):
                hidden = model(**batch).last_hidden_state
                logits = head(pooled(torch, hidden, batch["attention_mask"]))
            chunks.append(torch.softmax(logits.float(), dim=-1).cpu().numpy())
    return np.concatenate(chunks)


def train_minilm() -> None:
    import torch
    from torch.utils.data import DataLoader
    from transformers import AutoModel, AutoTokenizer

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable: GPU training was requested")
    device = "cuda"
    torch.set_num_threads(4)
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    random.seed(SEED)
    torch.backends.cuda.matmul.allow_tf32 = True
    train_texts, train_labels = arrays(read_sample("train"))
    valid_texts, valid_labels = arrays(read_sample("validation"))
    base_cache = ROOT.parent / "decision-model" / ".cache" / "huggingface"
    tokenizer = AutoTokenizer.from_pretrained(BASE_ID, revision=BASE_REVISION, cache_dir=base_cache)
    model = AutoModel.from_pretrained(BASE_ID, revision=BASE_REVISION, cache_dir=base_cache).to(device)
    observed = getattr(model.config, "_commit_hash", None)
    if observed and observed != BASE_REVISION:
        raise ValueError(f"base revision mismatch: {observed}")
    head = torch.nn.Linear(model.config.hidden_size, len(LABELS)).to(device)
    optimizer = torch.optim.AdamW([*model.parameters(), *head.parameters()], lr=2e-5)
    scaler = torch.amp.GradScaler("cuda")
    records = list(zip(train_texts, train_labels.tolist()))

    def collate(items):
        texts, labels = zip(*items)
        batch = tokenizer(list(texts), padding=True, truncation=True,
                          max_length=192, return_tensors="pt")
        return batch, torch.tensor(labels, dtype=torch.long)

    loader = DataLoader(records, batch_size=32, shuffle=True, collate_fn=collate,
                        generator=torch.Generator().manual_seed(SEED))
    best_f1 = -1.0
    best_epoch = None
    history = []
    started = time.perf_counter()
    for epoch in (1, 2):
        model.train()
        head.train()
        running_loss = 0.0
        for step, (batch, labels) in enumerate(loader, 1):
            batch = {key: value.to(device) for key, value in batch.items()}
            labels = labels.to(device)
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast("cuda", dtype=torch.float16):
                hidden = model(**batch).last_hidden_state
                logits = head(pooled(torch, hidden, batch["attention_mask"]))
                loss = torch.nn.functional.cross_entropy(logits.float(), labels)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            running_loss += float(loss.detach().cpu())
            if step % 500 == 0:
                print(f"epoch {epoch}: {step}/{len(loader)} batches", flush=True)
        probabilities = predict_minilm(torch, model, head, tokenizer, valid_texts, device)
        metrics = class_metrics(valid_labels, probabilities.argmax(1))
        item = {"epoch": epoch, "mean_train_loss": running_loss / len(loader), "metrics": metrics}
        history.append(item)
        print(json.dumps({"epoch": epoch, "validation_macro_f1": metrics["macro_f1"],
                          "validation_accuracy": metrics["accuracy"]}), flush=True)
        if metrics["macro_f1"] > best_f1:
            best_f1 = metrics["macro_f1"]
            best_epoch = epoch
            selected_probabilities = probabilities
            model_path = CACHE / "minilm-selected"
            model.save_pretrained(model_path)
            tokenizer.save_pretrained(model_path)
            torch.save(head.state_dict(), model_path / "head.pt")
    train_seconds = time.perf_counter() - started
    threshold = suggestion_threshold(valid_labels, selected_probabilities)
    report = {
        "source": "NLBSE23 training sample, validation holdout",
        "base_model": BASE_ID,
        "base_revision": BASE_REVISION,
        "selected_epoch": best_epoch,
        "train_seconds": train_seconds,
        "history": history,
        "metrics": history[best_epoch - 1]["metrics"],
        "suggestions": suggestion_metrics(valid_labels, selected_probabilities, threshold),
    }
    save_report("minilm", report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("model", choices=("linear", "minilm"))
    args = parser.parse_args()
    if args.model == "linear":
        train_linear()
    else:
        train_minilm()
