"""Fetch and hash-check the official Query-wellformedness test split."""

from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
COMMIT = "fb69c21416195cddc797277ea9e4d393226571d2"
SHA256 = "978574b96a37587845fd25e1cabc992a2d6f1bcab57750d1d04b60e2757a0ba2"
URL = ("https://raw.githubusercontent.com/google-research-datasets/"
       f"query-wellformedness/{COMMIT}/test.tsv")
OUTPUT = ROOT / ".cache" / "query-wellformedness" / "test.tsv"


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if not OUTPUT.exists():
        with urlopen(URL, timeout=90) as response:
            content = response.read()
        if hashlib.sha256(content).hexdigest() != SHA256:
            raise ValueError("downloaded wellformedness test hash did not match")
        OUTPUT.write_bytes(content)
    if hashlib.sha256(OUTPUT.read_bytes()).hexdigest() != SHA256:
        raise ValueError("cached wellformedness test hash did not match")
    print(f"Verified {OUTPUT}: SHA-256 {SHA256}")


if __name__ == "__main__":
    main()
