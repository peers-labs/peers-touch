from __future__ import annotations

from collections.abc import Callable
from typing import Any, Optional
import uuid


GatewayCommand = Callable[[str, str, Optional[dict[str, Any]]], dict[str, Any]]


def gateway_access_login(
    command: GatewayCommand,
    gateway: str,
    account: str,
    password: str,
) -> dict[str, Any]:
    started = command(gateway, "access_start", None)
    decision = _dict(started.get("decision"), "access_start.decision")
    attempt_id = _text(decision.get("attemptId"), "access_start.attemptId")
    current_gate_id = _text(
        decision.get("currentGateId"),
        "access_start.currentGateId",
    )
    gates = decision.get("gates")
    if not isinstance(gates, list):
        raise RuntimeError("access_start.gates is invalid")
    gate = next(
        (
            candidate
            for candidate in gates
            if isinstance(candidate, dict)
            and candidate.get("gateId") == current_gate_id
        ),
        None,
    )
    gate = _dict(gate, "access_start.currentGate")
    if gate.get("gateType") != "ACCESS_GATE_TYPE_AUTH_LOGIN":
        raise RuntimeError("canonical password gate is unavailable")

    return command(
        gateway,
        "access_submit_login",
        {
            "attempt_id": attempt_id,
            "gate_id": current_gate_id,
            "gate_type": 2,
            "action_id": _text(gate.get("actionId"), "access gate actionId"),
            "schema_revision": _positive_int(
                gate.get("schemaRevision"),
                "access gate schemaRevision",
            ),
            "schema_digest": _text(
                gate.get("schemaDigest"),
                "access gate schemaDigest",
            ),
            "submission_id": str(uuid.uuid4()),
            "account": account,
            "password": password,
        },
    )


def _dict(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeError(f"{field} is missing")
    return value


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"{field} is missing")
    return value


def _positive_int(value: Any, field: str) -> int:
    if not isinstance(value, int) or value <= 0:
        raise RuntimeError(f"{field} is invalid")
    return value
