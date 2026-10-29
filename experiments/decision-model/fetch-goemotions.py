"""Fetch and hash-check official GoEmotions test and label files."""

from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
COMMIT = "3ef52111c1fabc301880818f5a547570e926a76b"
HASHES = {
    "test.tsv": "0587b2dd8b27b97352adbfc3fb083d46005c8946657fdc2b1ca8b1cc7f1f8be4",
    "emotions.txt": "45c3ef86782d2a4d7fedcd6d8c111aa0d0e94720689bd164fac94fefb4495a89",
    "sentiment_mapping.json": "801f6f028082141bd38541a4b14d65b33bdc55d29c7b2aaa029fefecf206f76b",
}
DATA = ROOT / ".cache" / "goemotions"


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    for name, expected in HASHES.items():
        path = DATA / name
        if not path.exists():
            url = ("https://raw.githubusercontent.com/google-research/google-research/"
                   f"{COMMIT}/goemotions/data/{name}")
            with urlopen(url, timeout=90) as response:
                content = response.read()
            if hashlib.sha256(content).hexdigest() != expected:
                raise ValueError(f"downloaded {name} hash did not match")
            path.write_bytes(content)
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"cached {name} hash did not match")
        print(f"Verified {path}: SHA-256 {expected}")


if __name__ == "__main__":
    main()
