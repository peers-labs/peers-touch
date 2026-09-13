from __future__ import annotations

import os

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.drivers.native import resolve_native_desktop_runtime
from tooling.acceptance.gates.chat.native_two_client_runner import (
    NativeTwoClientGate,
    SUBMITTED_COMMAND_RECOVERY_GATE_ID,
    runtime_manifest,
)


class NativeSubmittedCommandRecoveryEntrypoint(NativeTwoClientGate):
    """Prove retained command convergence on source-equal Native clients."""

    gate_id = SUBMITTED_COMMAND_RECOVERY_GATE_ID

    def __init__(self) -> None:
        cell_id = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()
        if cell_id != "desktop-macos-native":
            raise GateError(
                "submitted-command recovery requires desktop-macos-native"
            )
        manifest, actor_manifest = runtime_manifest(self.gate_id)
        source = manifest.get("source")
        source_commit = str(
            source.get("commit") if isinstance(source, dict) else ""
        )
        if not source_commit:
            raise GateError("runtime manifest source commit is required")
        runtime_binding = resolve_native_desktop_runtime(
            cell_id,
            gate_id=self.gate_id,
            source_commit=source_commit,
        )
        runtime_binding.set_runtime_manifest(manifest)
        super().__init__(
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=runtime_binding,
            gate_id=self.gate_id,
            allow_existing_fixture=True,
        )


def main() -> int:
    gate: AcceptanceGate = NativeSubmittedCommandRecoveryEntrypoint()
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
