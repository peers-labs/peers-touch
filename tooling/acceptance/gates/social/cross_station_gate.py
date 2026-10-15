#!/usr/bin/env python3
"""Fail-closed dispatcher for the staged cross-Station Social Gates."""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from collections.abc import Callable, Sequence

from tooling.acceptance.core import AcceptanceGate, GateError


GATE_MODULES = {
    "social-cross-station-contract": (
        "tooling.acceptance.gates.social.cross_station_contract"
    ),
    "social-cross-station-eventbus-contract": (
        "tooling.acceptance.gates.social.cross_station_eventbus_contract"
    ),
    "social-cross-station-prekey": (
        "tooling.acceptance.gates.social.cross_station_prekey"
    ),
    "social-cross-station-delivery": (
        "tooling.acceptance.gates.social.cross_station_delivery"
    ),
    "social-cross-station-interaction": (
        "tooling.acceptance.gates.social.cross_station_interaction"
    ),
    "social-cross-station-revocation-recovery": (
        "tooling.acceptance.gates.social.cross_station_revocation_recovery"
    ),
    "social-cross-station-desktop-functional": (
        "tooling.acceptance.gates.social.cross_station_desktop_functional"
    ),
    "social-cross-station-native-e2e": (
        "tooling.acceptance.gates.social.cross_station_native_e2e"
    ),
    "browser-social-zero-registration": (
        "tooling.acceptance.gates.social.browser_zero_registration"
    ),
}


class CrossStationRegisteredGate(AcceptanceGate):
    """Framework-visible base for one closed, dynamically selected Gate."""

    gate_id = "social-cross-station-registered"
    phase = "Cross-Station Social"

    def run(self) -> dict[str, object]:
        raise GateError(
            "a concrete cross-Station Social Gate must be selected with --gate"
        )


def resolve_gate(gate_id: str) -> Callable[[], int]:
    module_name = GATE_MODULES.get(gate_id)
    if module_name is None:
        raise ValueError(f"unknown cross-Station Social Gate {gate_id!r}")
    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as error:
        if error.name != module_name:
            raise
        raise RuntimeError(
            f"{gate_id} is registered but its source closure is not implemented"
        ) from error
    main = getattr(module, "main", None)
    if not callable(main):
        raise RuntimeError(f"{gate_id} module has no callable main")
    return main


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gate", required=True, choices=tuple(GATE_MODULES))
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        return int(resolve_gate(arguments.gate)())
    except (RuntimeError, ValueError) as error:
        print(
            json.dumps(
                {
                    "status": "BLOCKED",
                    "code": "SOCIAL_CROSS_STATION_GATE_UNAVAILABLE",
                    "gateId": arguments.gate,
                    "message": str(error),
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
