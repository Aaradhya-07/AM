"""Load publisher archives and make the predeclared training/validation sample."""

from __future__ import annotations

import argparse
import csv
import hashlib
import heapq
import io
import json
import tarfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
LABELS = ("bug", "feature", "question", "documentation")
SEED_PREFIX = b"anvilmark-nlbse23-v1:"
TRAIN_N = 60_000
VALID_N = 8_000
HASH_BUFFER = 1_000
TRAIN_SHA256 = "090d64c456b47b26314ac3abac559928167e0f0830da68e1461de2fcb355d42d"
TEST_SHA256 = "f625dc78af6139b94623004dcbe575b5dfb6dc3293b7e9fa2fa109352d1cdf0e"
TRANSFER_SHA256 = "4f7d8619d4e5adbea126e548fd8c214449288f3a93bb3bc130c54cd307af7e85"


def verify_sha256(path: Path, expected: str) -> None:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while data := source.read(1024 * 1024):
            digest.update(data)
    if digest.hexdigest() != expected:
        raise ValueError(f"SHA-256 mismatch for {path}")


def archive_rows(path: Path):
    with tarfile.open(path, "r:gz") as archive:
        member = archive.next()
        if member is None or not member.name.endswith(".csv"):
            raise ValueError("expected one CSV in archive")
        binary = archive.extractfile(member)
        if binary is None:
            raise ValueError("cannot read archived CSV")
        with io.TextIOWrapper(binary, encoding="utf-8", errors="replace", newline="") as stream:
            csv.field_size_limit(20_000_000)
            reader = csv.DictReader(stream)
            for row in reader:
                yield row


def row_text(row: dict[str, str]) -> str:
    return ((row.get("title") or "").strip() + "\n" + (row.get("body") or "")[:2000].strip()).strip()


def normalized_text(text: str) -> str:
    return " ".join(text.lower().split())


def prepare() -> None:
    verify_sha256(CACHE / "nlbse-train.csv.tar.gz", TRAIN_SHA256)
    heap = []
    total = 0
    source_counts = Counter()
    seen_ids = {}
    repeated_ids = 0
    conflicting_labels = 0
    conflicting_ids = set()
    for row in archive_rows(CACHE / "nlbse-train.csv.tar.gz"):
        total += 1
        label = row["labels"].strip().lower()
        source_counts[label] += 1
        issue_id = row["id"].strip()
        if issue_id in seen_ids:
            repeated_ids += 1
            if seen_ids[issue_id] != label:
                conflicting_labels += 1
                conflicting_ids.add(issue_id)
            continue
        seen_ids[issue_id] = label
        key = int.from_bytes(hashlib.sha256(SEED_PREFIX + issue_id.encode()).digest(), "big")
        if len(heap) >= TRAIN_N + VALID_N + HASH_BUFFER and key >= -heap[0][0]:
            continue
        item = (-key, issue_id, {"id": issue_id, "label": label, "text": row_text(row)})
        if len(heap) < TRAIN_N + VALID_N + HASH_BUFFER:
            heapq.heappush(heap, item)
        else:
            heapq.heapreplace(heap, item)
        if total % 250_000 == 0:
            print(f"read {total} training rows", flush=True)

    if total != 1_275_881:
        raise ValueError(f"unexpected train row count: {total}")
    if set(source_counts) != set(LABELS):
        raise ValueError(f"unexpected labels: {source_counts}")
    selected = []
    seen_text = set()
    duplicate_text_skipped = 0
    for item in sorted(heap, key=lambda item: -item[0]):
        if item[1] in conflicting_ids:
            continue
        text_key = normalized_text(item[2]["text"])
        if text_key in seen_text:
            duplicate_text_skipped += 1
            continue
        seen_text.add(text_key)
        selected.append(item[2])
        if len(selected) == TRAIN_N + VALID_N:
            break
    if len(selected) != TRAIN_N + VALID_N:
        raise ValueError("hash-rank buffer was too small after conflict exclusion")
    CACHE.mkdir(exist_ok=True)
    for name, rows in (("train", selected[:TRAIN_N]), ("validation", selected[TRAIN_N:])):
        with (CACHE / f"{name}.jsonl").open("w", encoding="utf-8") as output:
            for row in rows:
                output.write(json.dumps(row, ensure_ascii=False) + "\n")
    metadata = {
        "source_rows": total,
        "source_counts": dict(source_counts),
        "unique_train_ids": len(seen_ids),
        "repeated_id_rows_skipped": repeated_ids,
        "duplicate_id_conflicting_label_rows": conflicting_labels,
        "conflicting_ids_excluded": len(conflicting_ids),
        "duplicate_text_rows_skipped_during_selection": duplicate_text_skipped,
        "train_rows": TRAIN_N,
        "train_counts": dict(Counter(row["label"] for row in selected[:TRAIN_N])),
        "validation_rows": VALID_N,
        "validation_counts": dict(Counter(row["label"] for row in selected[TRAIN_N:])),
        "seed_prefix": SEED_PREFIX.decode(),
    }
    (CACHE / "sample-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2), flush=True)


def read_sample(name: str) -> list[dict[str, str]]:
    with (CACHE / f"{name}.jsonl").open(encoding="utf-8") as source:
        return [json.loads(line) for line in source]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["prepare"])
    args = parser.parse_args()
    if args.command == "prepare":
        prepare()
