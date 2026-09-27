#!/usr/bin/env python3
"""Required Mobile Access proof on isolated iOS Simulator clients."""

from tooling.acceptance.core import AcceptanceGate
from tooling.acceptance.gates.mobile.simulator_e2e import (
    SimulatorCallbackRoutingGate,
)


class SimulatorAccessGate(SimulatorCallbackRoutingGate):
    """Stable Gate entrypoint over the shared simulator driver implementation."""


def main() -> int:
    gate: AcceptanceGate = SimulatorAccessGate()
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
