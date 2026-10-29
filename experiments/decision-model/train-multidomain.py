"""Train a dynamic-label query encoder on BANKING77 and MASSIVE, without CLINC data.

BANKING77 validation labels are disjoint from its training labels. MASSIVE
validation comes from its official split. The checkpoint is selected by the
mean raw-input validation accuracy across the two domains. CLINC150 is reserved
for a separate, once-only held-out evaluation.
"""

from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import os
import random
import runpy
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MASSIVE_REVISION = "940fd47a81eaa7f2cc7b129674d945d618ac38c2"
MASSIVE_HASHES = {
    "train": "65e77f0f2596931671074e3d031a481bc798e5800daa2c886ce7aa26cc16cf22",
    "validation": "90707b81c3d1b70d6992b41d641a79f66874fdbf6c8a1cc4ccd97c246738fa67",
}
SEED = 20261017


def massive_rows(split: str) -> list[tuple[str, str]]:
    from huggingface_hub import hf_hub_download

    path = Path(hf_hub_download(
        "mteb/amazon_massive_intent", filename=f"{split}/en.json.gz",
        repo_type="dataset", revision=MASSIVE_REVISION,
        cache_dir=ROOT / ".cache" / "huggingface",
    ))
    if hashlib.sha256(path.read_bytes()).hexdigest() != MASSIVE_HASHES[split]:
        raise ValueError(f"MASSIVE {split} file hash changed")
    with gzip.open(path, "rt") as handle:
        rows = [json.loads(line) for line in handle]
    if any(row["lang"] != "en" for row in rows):
        raise ValueError("expected English MASSIVE rows")
    return [(row["text"], row["label_text"]) for row in rows]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=32, help="raw messages per step; prompts double this")
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    parser.add_argument("--banking-repeats", type=int, default=4)
    args = parser.parse_args()
    if min(args.epochs, args.batch_size, args.banking_repeats) < 1 or args.learning_rate <= 0:
        raise ValueError("epochs, batch size, banking repeats, and learning rate must be positive")

    prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
    candidate = runpy.run_path(str(ROOT / "train-question-encoder.py"))
    torch, tokenizer, model = prototype["load_encoder"]()
    torch.set_num_threads(4)
    torch.manual_seed(SEED)
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable in this process")

    _, banking = prototype["load_data"](30)
    massive_train = massive_rows("train")
    massive_valid = massive_rows("validation")
    domains = {
        "banking": {
            "train": banking["rows"]["train"],
            "validation": banking["rows"]["validation"],
            "train_labels": banking["labels"]["train"],
            "validation_labels": banking["labels"]["validation"],
        },
        "massive": {
            "train": massive_train,
            "validation": massive_valid,
            "train_labels": sorted({label for _, label in massive_train}),
            "validation_labels": sorted({label for _, label in massive_train}),
        },
    }
    if {label for _, label in massive_valid} - set(domains["massive"]["train_labels"]):
        raise ValueError("MASSIVE validation has a label absent from training")
    for name, data in domains.items():
        labels = sorted(set(data["train_labels"] + data["validation_labels"]))
        embeddings = prototype["encode"](
            torch, tokenizer, model,
            [prototype["readable_label"](label) for label in labels],
        ).clone()
        lookup = dict(zip(labels, embeddings))
        data["train_vectors"] = torch.stack([lookup[label] for label in data["train_labels"]])
        data["validation_vectors"] = torch.stack([lookup[label] for label in data["validation_labels"]])
        data["target_index"] = {label: i for i, label in enumerate(data["train_labels"])}

    model.to(args.device)
    for data in domains.values():
        data["train_vectors_device"] = data["train_vectors"].to(args.device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    scaler = torch.amp.GradScaler("cuda", enabled=args.device == "cuda")

    def evaluate_all():
        result = {}
        for name, data in domains.items():
            result[name] = {}
            for prompted in (False, True):
                texts = [candidate["query"](text) if prompted else text
                         for text, _ in data["validation"]]
                logits = candidate["evaluate"](
                    torch, tokenizer, model, texts, args.device, args.batch_size,
                    data["validation_vectors"],
                )
                index = {label: i for i, label in enumerate(data["validation_labels"])}
                targets = torch.tensor([index[label] for _, label in data["validation"]])
                result[name]["prompted" if prompted else "raw"] = prototype["metrics"](
                    torch, logits, targets
                )
        return result

    baseline = evaluate_all()
    best = {
        "epoch": 0, "validation": baseline,
        "state": copy.deepcopy({key: value.detach().cpu() for key, value in model.state_dict().items()}),
    }
    def selection_key(validation):
        banking_score = validation["banking"]["raw"]
        massive_score = validation["massive"]["raw"]
        return ((banking_score["accuracy"] + massive_score["accuracy"]) / 2,
                -(banking_score["nll"] + massive_score["nll"]) / 2)

    history = []
    started = time.perf_counter()
    for epoch in range(1, args.epochs + 1):
        model.train()
        rng = random.Random(SEED + epoch)
        batches = []
        for name, data in domains.items():
            repeats = args.banking_repeats if name == "banking" else 1
            for _ in range(repeats):
                order = list(range(len(data["train"])))
                rng.shuffle(order)
                batches.extend((name, order[start:start + args.batch_size])
                               for start in range(0, len(order), args.batch_size))
        rng.shuffle(batches)
        losses = []
        for name, indexes in batches:
            data = domains[name]
            rows = [data["train"][i] for i in indexes]
            raw = [text for text, _ in rows]
            texts = raw + [candidate["query"](text) for text in raw]
            targets = torch.tensor(
                [data["target_index"][label] for _, label in rows] * 2,
                device=args.device,
            )
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast("cuda", dtype=torch.float16, enabled=args.device == "cuda"):
                encoded = candidate["forward"](torch, tokenizer, model, texts, args.device)
                logits = 20.0 * encoded @ data["train_vectors_device"].T
                loss = torch.nn.functional.cross_entropy(logits, targets)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            losses.append(float(loss.detach().cpu()))
        validation = evaluate_all()
        item = {
            "epoch": epoch, "steps": len(batches),
            "mean_train_loss": round(sum(losses) / len(losses), 6),
            "validation": validation,
        }
        history.append(item)
        print(json.dumps(item), flush=True)
        if selection_key(validation) > selection_key(best["validation"]):
            best = {
                "epoch": epoch, "validation": validation,
                "state": copy.deepcopy({key: value.detach().cpu()
                                        for key, value in model.state_dict().items()}),
            }

    report = {
        "format": "anvilmark-multidomain-question-encoder/1",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "model": prototype["MODEL_ID"],
        "model_revision": prototype["MODEL_REVISION"],
        "banking_revision": "57ec275d8078af65b7731c2a98be812d844a6d6b",
        "massive_revision": MASSIVE_REVISION,
        "massive_hashes": MASSIVE_HASHES,
        "device": args.device,
        "torch": torch.__version__,
        "seed": SEED,
        "epochs": args.epochs,
        "batch_size_raw": args.batch_size,
        "banking_repeats": args.banking_repeats,
        "learning_rate": args.learning_rate,
        "training_seconds_including_validation": round(time.perf_counter() - started, 3),
        "train_counts": {name: len(data["train"]) for name, data in domains.items()},
        "validation_counts": {name: len(data["validation"]) for name, data in domains.items()},
        "selection_rule": "mean raw-input validation accuracy across BANKING77 and MASSIVE, NLL tie-break",
        "baseline_validation": baseline,
        "history": history,
        "selected_epoch": best["epoch"],
        "selected_validation": best["validation"],
        "excluded_domain": "CLINC150; no CLINC data used for training or selection",
    }
    output = ROOT / "results" / f"multidomain-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    checkpoint = ROOT / ".cache" / "multidomain-query-encoder.pt"
    prototype["save_private"](torch, checkpoint, {
        "state_dict": best["state"], "encoder_revision": prototype["MODEL_REVISION"],
        "selected_epoch": best["epoch"], "input_modes": ["raw", "prompted"],
    })
    print(json.dumps({"selected_epoch": best["epoch"],
                      "selected_validation": best["validation"],
                      "seconds": report["training_seconds_including_validation"]}, indent=2))
    print(f"Report: {output}")
    print(f"Checkpoint: {checkpoint}")


if __name__ == "__main__":
    main()
