"""Report whether this environment can actually train on the local NVIDIA GPU."""

from __future__ import annotations

import json
import platform
import subprocess


def command(*args: str) -> tuple[int, str]:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=10, check=False)
        return result.returncode, (result.stdout or result.stderr).strip()
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        return 1, str(error)


def main() -> None:
    import torch

    status, output = command(
        "nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"
    )
    report = {
        "kernel": platform.release(),
        "nvidia_smi_ok": status == 0,
        "nvidia_smi": output,
        "torch_version": torch.__version__,
        "torch_cuda_build": torch.version.cuda,
        "torch_cuda_available": torch.cuda.is_available(),
        "torch_device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
    }
    print(json.dumps(report, indent=2))
    if not (report["nvidia_smi_ok"] and report["torch_cuda_available"]):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
