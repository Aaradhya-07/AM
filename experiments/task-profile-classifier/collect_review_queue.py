"""Export local Anvilmark development plans for independent task-kind review.

The output is a review queue, not training data. Existing plan kinds are shown
as suggestions and never copied into the reviewed label field.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from data import CACHE, normalized_text

KINDS = {"architecture", "bug", "feature", "refactor", "test", "review"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plans-dir", type=Path, help="Anvilmark .anvilmark/development/plans directory")
    parser.add_argument("--plan", type=Path, action="append", default=[], help="Additional plan JSON file")
    parser.add_argument("--output", type=Path, default=CACHE / "anvilmark-review-queue.json")
    args = parser.parse_args()
    paths = list(args.plan)
    if args.plans_dir:
        paths.extend(sorted(args.plans_dir.glob("*.json")))
    if not paths:
        raise SystemExit("provide --plans-dir or at least one --plan")

    cases = {}
    skipped = 0
    for path in paths:
        plan = json.loads(path.read_text(encoding="utf-8"))
        task = plan.get("task") or {}
        architecture = plan.get("architecture") or {}
        summary = task.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            skipped += 1
            continue
        architecture_summary = architecture.get("summary") or ""
        identity = normalized_text(summary) + "\0" + normalized_text(architecture_summary)
        case_id = hashlib.sha256(identity.encode()).hexdigest()[:16]
        profile = task.get("profile") or {}
        declared_kind = profile.get("kind")
        if declared_kind not in KINDS:
            declared_kind = None
        if case_id in cases:
            cases[case_id]["source_files"].append(str(path))
            continue
        cases[case_id] = {
            "id": case_id,
            "task_id": task.get("id"),
            "summary": summary.strip(),
            "architecture_summary": architecture_summary.strip(),
            "declared_kind": declared_kind,
            "reviewed_kind": None,
            "reviewed_by": None,
            "reviewed_at": None,
            "source_files": [str(path)],
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(list(cases.values()), indent=2, ensure_ascii=False) + "\n",
                           encoding="utf-8")
    print(json.dumps({"output": str(args.output), "cases": len(cases),
                      "skipped_without_summary": skipped, "reviewed_cases": 0}))


if __name__ == "__main__":
    main()
