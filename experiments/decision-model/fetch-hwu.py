"""Fetch and hash-check the original HWU home-domain annotated corpus."""

from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
COMMIT = "f6071b496b17d71e6eb43f543af0707f4ff30557"
SHA256 = "5f6dbf6d38fc111217924945ac59c554e0b926d5aa836ecdd0d089d2ca48e1d9"
URL = ("https://raw.githubusercontent.com/xliuhw/NLU-Evaluation-Data/"
       f"{COMMIT}/AnnotatedData/NLU-Data-Home-Domain-Annotated-All.csv")
OUTPUT = ROOT / ".cache" / "hwu64" / "source.csv"


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if not OUTPUT.exists():
        with urlopen(URL, timeout=90) as response:
            content = response.read()
        if hashlib.sha256(content).hexdigest() != SHA256:
            raise ValueError("downloaded HWU source hash did not match")
        OUTPUT.write_bytes(content)
    if hashlib.sha256(OUTPUT.read_bytes()).hexdigest() != SHA256:
        raise ValueError("cached HWU source hash did not match")
    print(f"Verified {OUTPUT}: SHA-256 {SHA256}")


if __name__ == "__main__":
    main()
