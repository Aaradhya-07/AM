"""Fine-tune a question-conditioned MiniLM query encoder for dynamic labels.

The label encoder stays frozen. A teacher penalty anchors the trainable query
encoder to its pretrained representation. Validation labels are disjoint from
training labels; the test is exploratory because BANKING77 has been inspected
in previous experiments. Use --smoke for a small CPU wiring check.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import runpy
import time
from contextlib import nullcontext
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
QUESTION = "Which intent best describes this message?"


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--anchor-weight", type=float, default=2.0)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--smoke", action="store_true", help="one CPU training step, no test scoring or saved model")
    return parser.parse_args()


def query(text: str) -> str:
    return f"Question: {QUESTION}\nMessage: {text}"


def forward(torch, tokenizer, model, texts: list[str], device: str):
    import torch.nn.functional as F

    inputs = tokenizer(
        texts, padding=True, truncation=True, max_length=128, return_tensors="pt"
    ).to(device)
    hidden = model(**inputs).last_hidden_state
    mask = inputs["attention_mask"].unsqueeze(-1)
    pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1)
    return F.normalize(pooled, dim=-1)


def evaluate(torch, tokenizer, model, texts, device, batch_size, label_vectors):
    model.eval()
    vectors = []
    with torch.inference_mode():
        for start in range(0, len(texts), batch_size):
            vectors.append(forward(torch, tokenizer, model, texts[start:start + batch_size], device).cpu())
    return 20.0 * torch.cat(vectors) @ label_vectors.T


def main() -> None:
    args = arguments()
    if min(args.epochs, args.batch_size, args.threads) < 1:
        raise ValueError("epochs, batch size, and threads must be positive")
    if args.learning_rate <= 0 or args.anchor_weight < 0:
        raise ValueError("learning rate must be positive and anchor weight nonnegative")
    prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
    torch, tokenizer, model = prototype["load_encoder"]()
    torch.set_num_threads(args.threads)
    torch.manual_seed(prototype["SEED"])
    if args.smoke:
        device = "cpu"
    else:
        device = "cuda" if args.device == "auto" and torch.cuda.is_available() else args.device
        if device == "auto":
            device = "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable; run gpu-preflight.py before GPU training")
    categories, data = prototype["load_data"](30)
    label_vectors_all = prototype["encode"](
        torch, tokenizer, model, [prototype["readable_label"](x) for x in categories]
    ).clone()
    vector_for = {label: label_vectors_all[index] for index, label in enumerate(categories)}
    texts = {}
    targets = {}
    label_vectors = {}
    teacher = {}
    for split in ("train", "validation", "test"):
        names = data["labels"][split]
        rows = data["rows"][split]
        texts[split] = [query(text) for text, _ in rows]
        targets[split] = torch.tensor([names.index(label) for _, label in rows])
        label_vectors[split] = torch.stack([vector_for[name] for name in names])
        if split != "test" or not args.smoke:
            teacher[split] = prototype["encode"](torch, tokenizer, model, texts[split]).clone()
    base_valid = 20.0 * teacher["validation"] @ label_vectors["validation"].T
    if args.smoke:
        texts["train"] = texts["train"][:args.batch_size]
        targets["train"] = targets["train"][:args.batch_size]
        teacher["train"] = teacher["train"][:args.batch_size]

    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    scaler = torch.amp.GradScaler("cuda", enabled=device == "cuda")
    best = {
        "epoch": 0,
        "metrics": prototype["metrics"](torch, base_valid, targets["validation"]),
        "state": copy.deepcopy({key: value.cpu() for key, value in model.state_dict().items()}),
    }
    start = time.perf_counter()
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = torch.randperm(len(texts["train"]))
        losses = []
        for indexes in order.split(args.batch_size):
            selected = indexes.tolist()
            optimizer.zero_grad(set_to_none=True)
            context = torch.autocast("cuda", dtype=torch.float16) if device == "cuda" else nullcontext()
            with context:
                vectors = forward(torch, tokenizer, model, [texts["train"][i] for i in selected], device)
                logits = 20.0 * vectors @ label_vectors["train"].to(device).T
                classification = torch.nn.functional.cross_entropy(logits, targets["train"][indexes].to(device))
                anchor = (1 - torch.nn.functional.cosine_similarity(
                    vectors, teacher["train"][indexes].to(device)
                )).mean()
                loss = classification + args.anchor_weight * anchor
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            losses.append(float(loss.detach().cpu()))
            if args.smoke:
                break
        valid_logits = evaluate(
            torch, tokenizer, model, texts["validation"], device, args.batch_size,
            label_vectors["validation"]
        )
        valid = prototype["metrics"](torch, valid_logits, targets["validation"])
        if (valid["accuracy"], -valid["nll"]) > (
            best["metrics"]["accuracy"], -best["metrics"]["nll"]
        ):
            best = {
                "epoch": epoch, "metrics": valid,
                "state": copy.deepcopy({key: value.detach().cpu() for key, value in model.state_dict().items()}),
            }
        print(json.dumps({"epoch": epoch, "mean_train_loss": sum(losses) / len(losses),
                          "validation": valid}), flush=True)
        if args.smoke:
            print("CPU smoke check complete; no test was scored or checkpoint saved.")
            return

    seconds = time.perf_counter() - start
    model.load_state_dict(best["state"])
    test_logits = evaluate(
        torch, tokenizer, model, texts["test"], device, args.batch_size,
        label_vectors["test"]
    )
    base_test = 20.0 * teacher["test"] @ label_vectors["test"].T
    report = {
        "format": "anvilmark-question-encoder-experiment/1",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "device": device,
        "torch": torch.__version__,
        "model": prototype["MODEL_ID"],
        "model_revision": prototype["MODEL_REVISION"],
        "dataset": "BANKING77",
        "dataset_revision": "57ec275d8078af65b7731c2a98be812d844a6d6b",
        "seed": prototype["SEED"],
        "question": QUESTION,
        "epochs_requested": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.learning_rate,
        "anchor_weight": args.anchor_weight,
        "best_epoch": best["epoch"],
        "training_seconds": round(seconds, 3),
        "validation": {
            "untouched": prototype["metrics"](torch, base_valid, targets["validation"]),
            "selected": best["metrics"],
        },
        "test_exploratory": {
            "untouched": prototype["metrics"](torch, base_test, targets["test"]),
            "selected": prototype["metrics"](torch, test_logits, targets["test"]),
        },
        "test_note": "BANKING77 test labels were inspected in earlier experiments; this is exploratory, not a new untouched test",
    }
    output = ROOT / "results" / f"question-encoder-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    checkpoint = ROOT / ".cache" / "question-encoder.pt"
    prototype["save_private"](torch, checkpoint, {
        "state_dict": best["state"], "encoder_revision": prototype["MODEL_REVISION"],
        "question": QUESTION,
    })
    print(json.dumps(report, indent=2))
    print(f"Report: {output}")
    print(f"Checkpoint: {checkpoint}")


if __name__ == "__main__":
    main()
