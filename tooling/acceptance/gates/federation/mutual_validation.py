#!/usr/bin/env python3
"""Compatibility wrapper for the Federation acceptance domain profile."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def main() -> int:
    return subprocess.run(
        ["python3", "tooling/scripts/acceptance-validate.py", "--domain", "federation", "--require-proven"],
        cwd=ROOT,
        check=False,
    ).returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"mutual validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
