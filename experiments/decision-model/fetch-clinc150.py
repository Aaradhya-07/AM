"""Fetch and verify the original CLINC150 data at a pinned commit."""

from __future__ import annotations

import hashlib
import os
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMMIT = "828f8093932c8fe6ca7936c3d2e52903b1c523de"
SHA256 = "36923c3705a59e08fe9c3883d8bc2dd966ef93e22cb78ac41171782a698d56e0"
URL = f"https://raw.githubusercontent.com/clinc/oos-eval/{COMMIT}/data/data_full.json"
DESTINATION = ROOT / ".cache" / "clinc150" / "data_full.json"


def main() -> None:
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    if DESTINATION.exists() and hashlib.sha256(DESTINATION.read_bytes()).hexdigest() == SHA256:
        print(f"Verified cached CLINC150: {DESTINATION}")
        return
    temporary = None
    try:
        with urllib.request.urlopen(URL, timeout=60) as source:
            with tempfile.NamedTemporaryFile(
                mode="wb", dir=DESTINATION.parent, prefix="clinc150-", delete=False
            ) as handle:
                temporary = Path(handle.name)
                while chunk := source.read(1024 * 1024):
                    handle.write(chunk)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != SHA256:
            raise ValueError("CLINC150 SHA-256 differs from the pinned file")
        os.replace(temporary, DESTINATION)
        temporary = None
        print(f"Downloaded and verified CLINC150: {DESTINATION}")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
