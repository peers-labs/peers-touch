#!/usr/bin/env python3
"""Stable Gate entrypoint for the Personal Goal ready frontier."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tooling.acceptance.gates.agent.personal_goal_slices.paos_15_ready_frontier import (
    main,
)


if __name__ == "__main__":
    raise SystemExit(main())
