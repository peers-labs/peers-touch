#!/usr/bin/env python3
"""One-pass operational knowledge matching and canonical architecture validation."""

from __future__ import annotations

import argparse
import fnmatch
import re
import subprocess
import sys
from pathlib import Path

import yaml


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--range", default="HEAD", dest="diff_range")
    parser.add_argument("--changed-file", action="append", default=[])
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    root = Path(subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], check=True, text=True,
        capture_output=True, timeout=3,
    ).stdout.strip())
    changed = set(args.changed_file)
    if not changed:
        changed.update(subprocess.run(
            ["git", "-c", "core.quotePath=false", "diff", "--name-only", args.diff_range, "--"],
            cwd=root, check=True, text=True, capture_output=True, timeout=3,
        ).stdout.splitlines())
        if args.diff_range == "HEAD":
            changed.update(subprocess.run(
                ["git", "-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"],
                cwd=root, check=True, text=True, capture_output=True, timeout=3,
            ).stdout.splitlines())
    matches = []
    failures = []
    paths = sorted(
        path for directory in ("invariants", "pitfalls", "playbooks")
        for path in (root / "docs/knowledge" / directory).rglob("*.md")
    )
    for path in paths:
        text = path.read_text()
        relative = path.relative_to(root).as_posix()
        block = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|\Z)", text, re.S)
        try:
            front = yaml.safe_load(block.group(1)) if block else {}
        except yaml.YAMLError:
            front = {}
        if not isinstance(front, dict):
            front = {}
        if args.strict:
            missing = {"kind", "title", "status", "owns", "detected"} - front.keys()
            if missing:
                failures.append(f"[knowledge-schema] {relative} missing frontmatter: {sorted(missing)}")
            kind = front.get("kind")
            lower = text.lower()
            if kind == "invariant" and "how to verify" not in lower:
                failures.append(f"[knowledge-freshness] {relative} invariant missing How to verify")
            elif kind == "pitfall" and not re.search(
                r"detect.*recurrence|recurrence.*detect|how to detect", text, re.I
            ):
                failures.append(f"[knowledge-freshness] {relative} pitfall missing recurrence detection")
            elif kind == "playbook" and not re.search(
                r"^- \[ \]|^## Steps|^#{2,3} [0-9]+\.", text, re.M
            ):
                failures.append(f"[knowledge-freshness] {relative} playbook missing ordered procedure")
            elif kind not in {"invariant", "pitfall", "playbook"}:
                failures.append(f"[knowledge-schema] {relative} invalid kind")
        owns = front.get("owns") or []
        if not isinstance(owns, list) or any(not isinstance(item, str) for item in owns):
            failures.append(f"[knowledge-schema] {relative} owns must be a path list")
            continue
        for owned in owns:
            normalized = owned.rstrip("/")
            target = root / normalized
            if args.strict and not target.exists():
                # The old shell contract also accepts existing path prefixes.
                prefix_exists = target.parent.is_dir() and any(
                    fnmatch.fnmatch(candidate.name, target.name + "*")
                    for candidate in target.parent.iterdir()
                )
                if owned.endswith("/") or not prefix_exists:
                    failures.append(f"[knowledge-owns] {relative} owns missing path or prefix: {owned}")
            for item in sorted(changed):
                if item == normalized or item.startswith(normalized + "/"):
                    matches.append(f"- {relative} owns {owned} and matches {item}")
    print("Matched operational knowledge:" + ("" if matches else " none"))
    for match in matches:
        print(match)
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    command = ["node", str(root / "tooling/scripts/architecture/module-governance.mjs"),
               "changed-paths", "--repo-root", str(root)]
    for item in sorted(changed):
        command.extend(["--changed-file", item])
    completed = subprocess.run(command, cwd=root, timeout=5)
    if completed.returncode:
        return completed.returncode
    print("knowledge-match: pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
