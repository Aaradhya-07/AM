"""Download one public archive with bounded HTTP range requests.

Used only for the NLBSE benchmark archives. This script does not execute
downloaded content. It verifies every Content-Range before assembling bytes.
"""

import argparse
import concurrent.futures
import hashlib
import os
import pathlib
import urllib.request


def fetch_range(url: str, start: int, end: int) -> bytes:
    request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                expected = f"bytes {start}-{end}/"
                actual = response.headers.get("Content-Range", "")
                if response.status != 206 or not actual.startswith(expected):
                    raise ValueError(f"invalid range response: {response.status} {actual}")
                data = response.read()
                if len(data) != end - start + 1:
                    raise ValueError(f"short range response: {len(data)}")
                return data
        except Exception:
            if attempt == 2:
                raise
    raise AssertionError("unreachable")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--chunk-mib", type=int, default=4)
    args = parser.parse_args()

    request = urllib.request.Request(args.url, method="HEAD")
    with urllib.request.urlopen(request, timeout=30) as response:
        size = int(response.headers["Content-Length"])
    chunk_size = args.chunk_mib * 1024 * 1024
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix(args.output.suffix + ".parts")
    temp.mkdir(exist_ok=True)
    ranges = [(start, min(start + chunk_size, size) - 1) for start in range(0, size, chunk_size)]

    def one_range(item: tuple[int, int]) -> None:
        start, end = item
        part = temp / f"{start:012d}-{end:012d}.part"
        if part.exists() and part.stat().st_size == end - start + 1:
            return
        data = fetch_range(args.url, start, end)
        staging = part.with_suffix(".tmp")
        staging.write_bytes(data)
        os.replace(staging, part)

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(one_range, item) for item in ranges]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            future.result()
            if index % 10 == 0 or index == len(ranges):
                print(f"{index}/{len(ranges)} ranges", flush=True)

    digest = hashlib.sha256()
    assembled = args.output.with_suffix(args.output.suffix + ".assembling")
    with assembled.open("wb") as output:
        for start, end in ranges:
            part = temp / f"{start:012d}-{end:012d}.part"
            with part.open("rb") as source:
                while data := source.read(1024 * 1024):
                    digest.update(data)
                    output.write(data)
    if assembled.stat().st_size != size:
        raise ValueError("assembled file size mismatch")
    os.replace(assembled, args.output)
    for start, end in ranges:
        (temp / f"{start:012d}-{end:012d}.part").unlink()
    temp.rmdir()
    print(f"{args.output}: {size} bytes sha256={digest.hexdigest()}", flush=True)


if __name__ == "__main__":
    main()
