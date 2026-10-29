"""Train a label-aware MiniLM reranker; select only on BANKING/MASSIVE validation."""

from __future__ import annotations

import argparse
import copy
import json
import os
import random
import runpy
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SEED = 20261017
TOP_K = 8
FUSION_WEIGHTS = (0.0, 0.25, 0.5, 0.75, 1.0)
MAX_LENGTH = 96


def readable_label(label: str) -> str:
    return label.replace("_", " ").replace("?", "").replace("/", " ")


def shortlist(torch, tokenizer, encoder, rows, labels, top_k=TOP_K):
    prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
    label_vectors = prototype["encode"](
        torch, tokenizer, encoder, [readable_label(label) for label in labels]
    )
    query_vectors = prototype["encode"](
        torch, tokenizer, encoder, [text for text, _ in rows]
    )
    scores = query_vectors @ label_vectors.T
    values, indexes = scores.topk(min(top_k, len(labels)), dim=-1)
    return values, indexes


def tokenize_pairs(tokenizer, texts, labels):
    return tokenizer(
        texts, labels, padding="max_length", truncation=True,
        max_length=MAX_LENGTH, return_tensors="pt",
    )


def pair_scores(torch, model, head, inputs, device, batch_size=128):
    model.eval()
    head.eval()
    outputs = []
    with torch.inference_mode():
        for start in range(0, len(inputs["input_ids"]), batch_size):
            batch = {key: value[start:start + batch_size].to(device)
                     for key, value in inputs.items()}
            with torch.autocast("cuda", dtype=torch.float16, enabled=device == "cuda"):
                hidden = model(**batch).last_hidden_state
                mask = batch["attention_mask"].unsqueeze(-1)
                pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1)
                outputs.append(head(pooled).flatten().float().cpu())
    return torch.cat(outputs)


def fused_choice(torch, reranker_scores, retrieval_scores, weight):
    # Shortlist columns start in retrieval rank order. Stable index ordering
    # also breaks rank-fusion ties in favor of the retriever.
    rerank_order = reranker_scores.argsort(dim=-1, descending=True)
    rerank_ranks = rerank_order.argsort(dim=-1).float()
    retrieval_ranks = torch.arange(
        retrieval_scores.shape[1], dtype=torch.float32
    ).expand_as(retrieval_scores)
    combined = (1 - weight) * retrieval_ranks + weight * rerank_ranks
    return combined.argmin(dim=-1)


def validation_accuracy(torch, domain, pair_logits, weight):
    reranker_scores = pair_logits.reshape(domain["candidate_index"].shape)
    predicted_column = fused_choice(
        torch, reranker_scores, domain["candidate_values"], weight
    )
    predicted_label = domain["candidate_index"].gather(
        1, predicted_column[:, None]
    ).flatten()
    return round(float((predicted_label == domain["targets"]).float().mean()), 6)


def prepare_domain(torch, tokenizer, retriever, rows, labels):
    labels = sorted(labels)
    index = {label: i for i, label in enumerate(labels)}
    values, candidate_index = shortlist(torch, tokenizer, retriever, rows, labels)
    targets = torch.tensor([index[label] for _, label in rows])
    candidate_labels = [readable_label(labels[i]) for i in candidate_index.flatten().tolist()]
    pair_inputs = tokenize_pairs(
        tokenizer,
        [text for text, _ in rows for _ in range(candidate_index.shape[1])],
        candidate_labels,
    )
    return {
        "rows": rows, "labels": labels, "targets": targets,
        "candidate_values": values, "candidate_index": candidate_index,
        "pair_inputs": pair_inputs,
        "retrieval_top1": round(float((candidate_index[:, 0] == targets).float().mean()), 6),
        "retrieval_top8_recall": round(float((candidate_index == targets[:, None]).any(-1).float().mean()), 6),
    }


def training_pairs(torch, tokenizer, retriever, rows, labels, seed):
    labels = sorted(labels)
    index = {label: i for i, label in enumerate(labels)}
    _, candidate_index = shortlist(torch, tokenizer, retriever, rows, labels)
    rng = random.Random(seed)
    texts, candidate_labels = [], []
    for (text, true_label), candidates in zip(rows, candidate_index.tolist()):
        true_index = index[true_label]
        hard = [item for item in candidates if item != true_index][:2]
        if len(hard) < 2:
            raise ValueError("training domain needs at least three labels")
        remaining = [i for i in range(len(labels)) if i != true_index and i not in hard]
        negative = rng.choice(remaining)
        for label_id in [true_index, *hard, negative]:
            texts.append(text)
            candidate_labels.append(readable_label(labels[label_id]))
    return tokenize_pairs(tokenizer, texts, candidate_labels)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--query-batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--massive-per-label", type=int, default=60)
    args = parser.parse_args()
    if min(args.epochs, args.query_batch_size, args.massive_per_label) < 1:
        raise ValueError("positive epochs, batch size, and MASSIVE cap required")

    prototype = runpy.run_path(str(ROOT / "train-dynamic-label.py"))
    trainer = runpy.run_path(str(ROOT / "train-multidomain.py"))
    torch, tokenizer, retriever = prototype["load_encoder"]()
    torch.set_num_threads(4)
    torch.manual_seed(SEED)
    random.seed(SEED)
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable")

    _, banking = prototype["load_data"](30)
    massive_train_all = trainer["massive_rows"]("train")
    massive_valid = trainer["massive_rows"]("validation")
    massive_by_label = {}
    for text, label in massive_train_all:
        massive_by_label.setdefault(label, []).append((text, label))
    massive_train = []
    for label in sorted(massive_by_label):
        rows = massive_by_label[label]
        random.Random(f"{SEED}:{label}").shuffle(rows)
        massive_train.extend(rows[:args.massive_per_label])
    domains = {
        "banking": {
            "train_rows": banking["rows"]["train"],
            "train_labels": banking["labels"]["train"],
            "validation": prepare_domain(
                torch, tokenizer, retriever,
                banking["rows"]["validation"], banking["labels"]["validation"],
            ),
        },
        "massive": {
            "train_rows": massive_train,
            "train_labels": sorted(massive_by_label),
            "validation": prepare_domain(
                torch, tokenizer, retriever, massive_valid, sorted(massive_by_label)
            ),
        },
    }
    for name, domain in domains.items():
        domain["train_pairs"] = training_pairs(
            torch, tokenizer, retriever, domain["train_rows"],
            domain["train_labels"], SEED,
        )
        print(json.dumps({
            "domain": name, "train_queries": len(domain["train_rows"]),
            "validation_queries": len(domain["validation"]["rows"]),
            "retrieval_top1": domain["validation"]["retrieval_top1"],
            "retrieval_top8_recall": domain["validation"]["retrieval_top8_recall"],
        }), flush=True)

    # Initialize from the same pinned base encoder, now letting message and
    # label attend to each other within a single transformer pass.
    retriever.to(args.device)
    head = torch.nn.Linear(retriever.config.hidden_size, 1).to(args.device)
    optimizer = torch.optim.AdamW(
        list(retriever.parameters()) + list(head.parameters()),
        lr=args.learning_rate,
    )
    scaler = torch.amp.GradScaler("cuda", enabled=args.device == "cuda")
    best = {"epoch": 0, "weight": 0.0,
            "mean_accuracy": sum(d["validation"]["retrieval_top1"]
                                 for d in domains.values()) / len(domains)}
    history = []
    started = time.perf_counter()
    for epoch in range(1, args.epochs + 1):
        retriever.train()
        head.train()
        batches = []
        rng = random.Random(SEED + epoch)
        for name, domain in domains.items():
            order = list(range(len(domain["train_rows"])))
            rng.shuffle(order)
            batches.extend((name, order[start:start + args.query_batch_size])
                           for start in range(0, len(order), args.query_batch_size))
        rng.shuffle(batches)
        losses = []
        for name, indexes in batches:
            storage = domains[name]["train_pairs"]
            pair_indexes = torch.tensor([4 * i + j for i in indexes for j in range(4)])
            batch = {key: value[pair_indexes].to(args.device)
                     for key, value in storage.items()}
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast("cuda", dtype=torch.float16, enabled=args.device == "cuda"):
                hidden = retriever(**batch).last_hidden_state
                mask = batch["attention_mask"].unsqueeze(-1)
                pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1)
                logits = head(pooled).reshape(len(indexes), 4)
                loss = torch.nn.functional.cross_entropy(
                    logits.float(), torch.zeros(len(indexes), dtype=torch.long,
                                                device=args.device)
                )
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            losses.append(float(loss.detach().cpu()))

        logits_by_domain = {
            name: pair_scores(
                torch, retriever, head, domain["validation"]["pair_inputs"],
                args.device,
            ) for name, domain in domains.items()
        }
        options = []
        for weight in FUSION_WEIGHTS:
            accuracy = {
                name: validation_accuracy(
                    torch, domain["validation"], logits_by_domain[name], weight
                ) for name, domain in domains.items()
            }
            options.append({"weight": weight, "by_domain": accuracy,
                            "mean_accuracy": round(sum(accuracy.values()) / len(accuracy), 6)})
            score = options[-1]["mean_accuracy"]
            if score > best["mean_accuracy"]:
                best = {
                    "epoch": epoch, "weight": weight, "mean_accuracy": score,
                    "validation": accuracy,
                    "encoder_state": copy.deepcopy({k: v.detach().cpu()
                                                    for k, v in retriever.state_dict().items()}),
                    "head_state": copy.deepcopy({k: v.detach().cpu()
                                                 for k, v in head.state_dict().items()}),
                }
        item = {"epoch": epoch, "steps": len(batches),
                "mean_loss": round(sum(losses) / len(losses), 6), "options": options}
        history.append(item)
        print(json.dumps(item), flush=True)

    report = {
        "format": "anvilmark-label-aware-reranker/1",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "protocol": "NEXT-PROTOCOL.md", "seed": SEED,
        "encoder": prototype["MODEL_ID"],
        "encoder_revision": prototype["MODEL_REVISION"],
        "device": args.device, "torch": torch.__version__,
        "max_pair_tokens": MAX_LENGTH, "shortlist_k": TOP_K,
        "epochs": args.epochs, "query_batch_size": args.query_batch_size,
        "learning_rate": args.learning_rate,
        "massive_per_label": args.massive_per_label,
        "train_counts": {name: len(domain["train_rows"]) for name, domain in domains.items()},
        "validation_counts": {name: len(domain["validation"]["rows"])
                              for name, domain in domains.items()},
        "retrieval_validation": {
            name: {"top1": domain["validation"]["retrieval_top1"],
                   "top8_recall": domain["validation"]["retrieval_top8_recall"]}
            for name, domain in domains.items()
        },
        "selection_rule": "mean BANKING unseen-label and MASSIVE validation top-one; strict improvement; lower fusion weight wins ties",
        "history": history,
        "selected_epoch": best["epoch"],
        "selected_fusion_weight": best["weight"],
        "selected_mean_validation_accuracy": best["mean_accuracy"],
        "selected_validation": best.get("validation"),
        "training_seconds_including_validation": round(time.perf_counter() - started, 3),
        "excluded_evaluation": "CLINC150 and original-source HWU data",
    }
    output = ROOT / "results" / f"reranker-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    if best["epoch"]:
        prototype["save_private"](
            torch, ROOT / ".cache" / "label-aware-reranker.pt",
            {"encoder_revision": prototype["MODEL_REVISION"],
             "encoder_state": best["encoder_state"],
             "head_state": best["head_state"],
             "selected_epoch": best["epoch"],
             "fusion_weight": best["weight"],
             "shortlist_k": TOP_K, "max_pair_tokens": MAX_LENGTH},
        )
    print(json.dumps({"report": str(output), "selected_epoch": best["epoch"],
                      "fusion_weight": best["weight"],
                      "mean_validation_accuracy": best["mean_accuracy"],
                      "seconds": report["training_seconds_including_validation"]}, indent=2))


if __name__ == "__main__":
    main()
