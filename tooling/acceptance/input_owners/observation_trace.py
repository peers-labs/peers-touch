"""Input-owner liveness through the existing bounded operation observer."""

from contextlib import nullcontext
import time
from typing import Any, Mapping

from tooling.acceptance.core.operation_observer import OperationObserver


class InputOwnerTrace:
    """Observe one declared probe; never enforce or renew its parent deadline."""

    def __init__(self, gate_id: str, context: Mapping[str, Any]) -> None:
        probe = context.get("gate", {}).get("executionInputs", {}).get("identityProbe")
        self.observer = OperationObserver(gate_id) if probe else None
        self.end = time.monotonic() + probe["timeoutSeconds"] if probe else None

    def stage(self, name: str):
        return (
            self.observer.observe(f"input-owner-{name}", "work", self.end)
            if self.observer is not None else nullcontext()
        )
