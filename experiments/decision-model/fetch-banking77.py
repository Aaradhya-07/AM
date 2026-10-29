"""Fetch the pinned BANKING77 benchmark into this experiment's ignored cache."""

from __future__ import annotations

import hashlib
import urllib.request
from pathlib import Path

REVISION = "57ec275d8078af65b7731c2a98be812d844a6d6b"
BASE = f"https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/{REVISION}/banking_data"
CACHE = Path(__file__).resolve().parent / ".cache" / "banking77"
FILES = {
    "categories.json": "53261da888122daf2d120d925458631d9619e15d82e56052e7a42e535ce32b63",
    "train.csv": "b06e26ac675513959a63135f11b94ea7786ed02da65db93a5650d8838cbc664b",
    "test.csv": "d12d6e3bc4c3103966ae786dc435913c0c563dfa328f5a3646d0e62cfeeb474d",
}


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, expected_hash in FILES.items():
        path = CACHE / name
        if not path.exists():
            with urllib.request.urlopen(f"{BASE}/{name}", timeout=30) as response:
                data = response.read()
            actual_hash = hashlib.sha256(data).hexdigest()
            if expected_hash and actual_hash != expected_hash:
                raise ValueError(f"unexpected SHA-256 for {name}: {actual_hash}")
            path.write_bytes(data)
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if expected_hash and actual_hash != expected_hash:
            raise ValueError(f"cached {name} has unexpected SHA-256: {actual_hash}")
        print(f"{name}: {actual_hash}")


if __name__ == "__main__":
    main()
