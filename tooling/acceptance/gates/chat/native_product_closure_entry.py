from __future__ import annotations

import os

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.drivers.native import resolve_native_desktop_runtime
from tooling.acceptance.gates.chat.native_product_closure_runner import (
    NativeProductClosureGate,
    runtime_manifest,
)


class NativeProductClosureEntrypoint(NativeProductClosureGate):
    """Composition root for the platform-neutral Chat product Gate."""

    def __init__(self) -> None:
        cell_id = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()
        if not cell_id:
            raise GateError("PT_ACCEPTANCE_RUNTIME_CELL is required")
        manifest, actor_manifest = runtime_manifest()
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
        super().__init__(
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=runtime_binding,
        )


def main() -> int:
    gate: AcceptanceGate = NativeProductClosureEntrypoint()
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
