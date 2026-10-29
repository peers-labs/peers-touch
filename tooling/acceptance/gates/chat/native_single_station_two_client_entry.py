#!/usr/bin/env python3
"""Composition root for the single-Station same-Station Direct Chat Gate.

Both Native clients bind the one reviewed Station profile. The Station derives
the Direct Local scope from the matching Home Stations, so no Federation
context is selected or sent by either client.
"""

from __future__ import annotations

import os

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.drivers.native import resolve_native_desktop_runtime
from tooling.acceptance.gates.chat.native_two_client_runner import (
    SINGLE_STATION_GATE_ID,
    NativeTwoClientGate,
    runtime_manifest,
)


class NativeSingleStationTwoClientEntrypoint(NativeTwoClientGate):
    """Run the Direct two-client journey against one same-Station profile."""

    def __init__(self) -> None:
        cell_id = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()
        if not cell_id:
            raise GateError("PT_ACCEPTANCE_RUNTIME_CELL is required")
        manifest, actor_manifest = runtime_manifest(SINGLE_STATION_GATE_ID)
        source = manifest.get("source")
        source_commit = str(
            source.get("commit") if isinstance(source, dict) else ""
        )
        if not source_commit:
            raise GateError("runtime manifest source commit is required")
        runtime_binding = resolve_native_desktop_runtime(
            cell_id,
            gate_id=SINGLE_STATION_GATE_ID,
            source_commit=source_commit,
        )
        runtime_binding.set_runtime_manifest(manifest)
        super().__init__(
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=runtime_binding,
            gate_id=SINGLE_STATION_GATE_ID,
        )


def main() -> int:
    gate: AcceptanceGate = NativeSingleStationTwoClientEntrypoint()
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
