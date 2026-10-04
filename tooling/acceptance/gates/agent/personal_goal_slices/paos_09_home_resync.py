#!/usr/bin/env python3
"""Run the PAOS-09 native Home reconnect and resync Development Journey."""

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[5]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tooling.acceptance.gates.agent.personal_goal_home_e2e import run
from tooling.acceptance.gates.agent.personal_goal_slices.paos_01_home_draft import (
    require,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-09 requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-09 requires Station readback",
    )
    return run(
        artifact_name="paos-09-home-resync",
        include_resync=True,
        generator_path=Path(__file__),
    )


if __name__ == "__main__":
    raise SystemExit(main())
