#!/usr/bin/env python3
"""Verify the PAOS-10B Station publisher hard cut."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tooling.acceptance.gates.agent.personal_goal_home_e2e import run
from tooling.acceptance.gates.agent.personal_goal_slices.paos_01_home_draft import (
    require,
)


def run_source_checks() -> None:
    scan = subprocess.run(
        [
            "rg",
            "-n",
            r"NewMemoryEventBus|MemoryEventBus|domain\.EventBus|SetEventBus",
            "apps/station/app/subserver/agent",
            "--glob",
            "!**/migrations/**",
        ],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    require(
        scan.returncode == 1,
        f"Agent-private publisher references remain:\n{scan.stdout}{scan.stderr}",
    )
    test = subprocess.run(
        [
            "go",
            "test",
            "./app/subserver/agent/...",
            "./app/subserver/events/...",
            "-count=1",
        ],
        cwd=ROOT / "apps" / "station",
        check=False,
        capture_output=True,
        text=True,
        timeout=1200,
    )
    require(
        test.returncode == 0,
        f"Station event hard-cut tests failed:\n{test.stdout}{test.stderr}",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    run_source_checks()
    require(args.require_ui, "PAOS-10B requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-10B requires Station readback",
    )
    return run(
        artifact_name="paos-10b-event-hard-cut",
        include_resync=False,
        generator_path=Path(__file__),
    )


if __name__ == "__main__":
    raise SystemExit(main())
