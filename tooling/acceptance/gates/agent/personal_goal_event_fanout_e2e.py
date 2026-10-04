#!/usr/bin/env python3
"""Run the PAOS-10C canonical Home and Atelier event fan-out Journey."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tooling.acceptance.gates.agent.personal_goal_home_e2e import run
from tooling.acceptance.gates.agent.personal_goal_slices.paos_01_home_draft import (
    require,
)

PRIVATE_CONSUMER_PATTERN = "|".join(
    (
        "agent_event_" + "stream",
        "agent_events_" + r"(subscribe|cancel)",
        "agent-events-" + r"(subscribe|stream)",
        "/sub-agent/agent/events/" + r"(subscribe|stream)",
    )
)


def run_source_and_atelier_checks() -> None:
    scan = subprocess.run(
        [
            "rg",
            "-n",
            PRIVATE_CONSUMER_PATTERN,
            "apps",
            "tooling",
            "packages",
            "model",
            "--glob",
            "!**/*_test.go",
            "--glob",
            "!**/migrations/**",
            "--glob",
            "!**/target/**",
            "--glob",
            "!**/node_modules/**",
        ],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    require(
        scan.returncode == 1,
        f"private event consumers remain:\n{scan.stdout}{scan.stderr}",
    )
    product_gate = subprocess.run(
        ["pnpm", "run", "applet:atelier-real-product-gate"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=1800,
    )
    require(
        product_gate.returncode == 0,
        "Atelier canonical product-path Gate failed:\n"
        f"{product_gate.stdout}{product_gate.stderr}",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.parse_args()
    run_source_and_atelier_checks()
    return run(
        artifact_name="paos-10c-event-consumer-hard-cut",
        include_resync=True,
        generator_path=Path(__file__),
    )


if __name__ == "__main__":
    raise SystemExit(main())
