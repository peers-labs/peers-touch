#!/usr/bin/env python3
"""Make entrypoint for the canonical Desktop Acceptance build owner."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tooling.acceptance.provisioners.desktop_acceptance_build import (  # noqa: E402
    DEFAULT_BUILD_SECONDS,
    DesktopAcceptanceBuild,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--timeout", type=float, default=DEFAULT_BUILD_SECONDS)
    args = parser.parse_args()
    build = DesktopAcceptanceBuild(ROOT, binary=args.binary, timeout_seconds=args.timeout)
    try:
        build.ensure()
    except Exception:
        print(json.dumps(build.observation, sort_keys=True))
        return 2
    print(json.dumps(build.observation, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
