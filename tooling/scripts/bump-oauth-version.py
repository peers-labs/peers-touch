#!/usr/bin/env python3
"""Bump the OAuth broker semantic version patch component by one.

The VERSION file is the single source of truth exposed by /api/healthz.
This script validates the major.minor.patch format, increments patch
(0.0.1), writes the result, and prints the new version.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_VERSION_FILE = (
    REPO_ROOT
    / "apps/oauth2-client/internal/version/VERSION"
)
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def parse_version(raw: str) -> tuple[int, int, int]:
    text = raw.strip()
    match = SEMVER.fullmatch(text)
    if not match:
        raise ValueError(
            f"invalid version {text!r}: expected major.minor.patch (digits only)"
        )
    return tuple(int(group) for group in match.groups())


def bump_patch(major: int, minor: int, patch: int) -> str:
    return f"{major}.{minor}.{patch + 1}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--version-file",
        type=Path,
        default=DEFAULT_VERSION_FILE,
        help="path to the VERSION file",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate format only; do not write",
    )
    args = parser.parse_args()

    try:
        raw = args.version_file.read_text(encoding="utf-8")
        major, minor, patch = parse_version(raw)
        if args.check:
            print(f"{major}.{minor}.{patch}")
            return 0
        new_version = bump_patch(major, minor, patch)
    except (OSError, ValueError) as error:
        print(f"version bump failed: {error}", file=sys.stderr)
        return 1

    args.version_file.write_text(new_version + "\n", encoding="utf-8")
    print(new_version)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
