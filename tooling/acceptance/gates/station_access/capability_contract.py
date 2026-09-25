#!/usr/bin/env python3
"""Validate the Station Access ownership, wire, and client parity contract."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

import yaml

from tooling.acceptance.core import AcceptanceGate, GateError, REPO_ROOT


GATE_ID = "station-access-capability-contract"
OWNERSHIP_REGISTRY = (
    REPO_ROOT
    / "docs"
    / "architecture"
    / "api-ownership"
    / "station-api-capabilities.yaml"
)
ACCESS_PROTO = REPO_ROOT / "model" / "domain" / "access_gate" / "access_gate.proto"
STATION_IDENTITY_PROTO = (
    REPO_ROOT / "model" / "domain" / "peer" / "station_identity.proto"
)

CANONICAL_CAPABILITIES = {
    "station.identity.verify": (
        "POST",
        "/sub-bootstrap/station-identity",
        "peers_touch.model.peer.v1.StationIdentityRequest",
        "peers_touch.model.peer.v1.StationIdentityResponse",
    ),
    "access.gate.start": (
        "POST",
        "/actor/access/start",
        "peers_touch.model.access_gate.v1.StartAccessAttemptRequest",
        "peers_touch.model.access_gate.v1.StartAccessAttemptResponse",
    ),
    "access.gate.submit": (
        "POST",
        "/actor/access/submit",
        "peers_touch.model.access_gate.v1.SubmitAccessGateRequest",
        "peers_touch.model.access_gate.v1.SubmitAccessGateResponse",
    ),
    "access.gate.decision": (
        "POST",
        "/actor/access/decision",
        "peers_touch.model.access_gate.v1.GetAccessDecisionRequest",
        "peers_touch.model.access_gate.v1.GetAccessDecisionResponse",
    ),
    "access.gate.cancel": (
        "POST",
        "/actor/access/cancel",
        "peers_touch.model.access_gate.v1.CancelAccessAttemptRequest",
        "peers_touch.model.access_gate.v1.CancelAccessAttemptResponse",
    ),
}

CLIENT_OUTCOMES = (
    "STATION_ACCESS_UNKNOWN_GATE",
    "STATION_ACCESS_IDENTITY_MISMATCH",
    "STATION_ACCESS_ATTEMPT_EXPIRED",
)

PRODUCTION_SCAN_ROOTS = (
    Path("apps/station/frame/touch"),
    Path("apps/desktop/src"),
    Path("apps/desktop/src-tauri/src"),
    Path("apps/mobile/src"),
    Path("apps/mobile/src-tauri/src"),
)

TEXT_SUFFIXES = frozenset({".go", ".rs", ".ts", ".tsx"})
SKIP_PARTS = frozenset({"node_modules", "target", "dist", "__pycache__"})


def _read(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def _require_tokens(
    source: str,
    required: Iterable[str],
    label: str,
) -> None:
    missing = [token for token in required if token not in source]
    if missing:
        raise GateError(f"{label} is missing: {', '.join(missing)}")


def _load_ownership_registry() -> dict[str, Any]:
    loaded = yaml.safe_load(OWNERSHIP_REGISTRY.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise GateError("Station API ownership registry must be an object")
    return loaded


def _validate_api_ownership(registry: Mapping[str, Any]) -> None:
    raw_capabilities = registry.get("capabilities")
    if not isinstance(raw_capabilities, list):
        raise GateError("Station API ownership capabilities are missing")
    capabilities = {
        str(item.get("id")): item
        for item in raw_capabilities
        if isinstance(item, Mapping)
    }
    for capability_id, expected in CANONICAL_CAPABILITIES.items():
        item = capabilities.get(capability_id)
        if not isinstance(item, Mapping):
            raise GateError(
                f"Station API capability {capability_id!r} is missing"
            )
        route = item.get("canonical_route")
        actual = (
            str(route.get("method") or "") if isinstance(route, Mapping) else "",
            str(route.get("path") or "") if isinstance(route, Mapping) else "",
            str(item.get("request_proto") or ""),
            str(item.get("response_proto") or ""),
        )
        if actual != expected:
            raise GateError(
                f"Station API capability {capability_id!r} drifted: {actual!r}"
            )

    retired_route = "/actor/" + "login"
    target_absent = registry.get("target_absent_routes")
    if not isinstance(target_absent, list) or not any(
        isinstance(route, Mapping)
        and route.get("method") == "POST"
        and route.get("path") == retired_route
        for route in target_absent
    ):
        raise GateError("retired direct login route is not denied by ownership")


def _validate_proto_contracts() -> None:
    identity_proto = STATION_IDENTITY_PROTO.read_text(encoding="utf-8")
    _require_tokens(
        identity_proto,
        (
            "message StationIdentityRequest",
            "bytes challenge = 1;",
            "message StationIdentityStatement",
            "string station_peer_id = 2;",
            "string canonical_origin = 3;",
            "repeated string capabilities = 4;",
            "message StationIdentityResponse",
            "bytes statement_bytes = 1;",
            "bytes host_public_key = 2;",
            "bytes signature = 3;",
        ),
        "Station identity Proto contract",
    )

    access_proto = ACCESS_PROTO.read_text(encoding="utf-8")
    _require_tokens(
        access_proto,
        (
            "message StartAccessAttemptRequest",
            "message StartAccessAttemptResponse",
            "message SubmitAccessGateRequest",
            "message SubmitAccessGateResponse",
            "message GetAccessDecisionRequest",
            "message GetAccessDecisionResponse",
            "message CancelAccessAttemptRequest",
            "message CancelAccessAttemptResponse",
            "string station_peer_id = 8;",
            "string device_id = 9;",
            "uint64 lifecycle_generation = 10;",
            "uint32 schema_revision = 11;",
            "string schema_digest = 12;",
            "string submission_id = 13;",
        ),
        "Access Gate Proto contract",
    )


def _validate_transport_owners() -> None:
    station_router = _read("apps/station/frame/touch/router.go")
    station_handler = _read("apps/station/frame/touch/actor_handler.go")
    desktop = _read("apps/desktop/src-tauri/src/application/auth/service.rs")
    mobile_transport = _read(
        "apps/mobile/src-tauri/src/runtime/oauth/transport.rs"
    )
    mobile_access = _read(
        "apps/mobile/src-tauri/src/runtime/oauth/access_gate.rs"
    )

    _require_tokens(
        station_router,
        (
            "func bindAccessProto(",
            "model.ContentTypeProtobuf",
            "model.AcceptProtobuf",
            "proto.Unmarshal",
        ),
        "Station Access transport",
    )
    _require_tokens(
        station_handler,
        (
            "bindAccessProto(ctx, &req)",
            "StartAccessAttemptResponse",
            "SubmitAccessGateResponse",
            "GetAccessDecisionResponse",
            "CancelAccessAttemptResponse",
        ),
        "Station Access handlers",
    )
    _require_tokens(
        desktop,
        (
            "post_peers_proto_no_auth",
            "StartAccessAttemptRequest",
            "SubmitAccessGateRequest",
            "GetAccessDecisionRequest",
            "CancelAccessAttemptRequest",
            '"/actor/access/start"',
            '"/actor/access/submit"',
            '"/actor/access/decision"',
            '"/actor/access/cancel"',
        ),
        "Desktop Access transport",
    )
    _require_tokens(
        mobile_transport,
        (
            'PROTOBUF_CONTENT_TYPE: &str = "application/protobuf"',
            ".header(CONTENT_TYPE, PROTOBUF_CONTENT_TYPE)",
            ".header(ACCEPT, PROTOBUF_CONTENT_TYPE)",
            "PeersResponse::decode",
        ),
        "Mobile Access transport",
    )
    _require_tokens(
        mobile_access,
        (
            "StartAccessAttemptRequest",
            "SubmitAccessGateRequest",
            "GetAccessDecisionRequest",
            "CancelAccessAttemptRequest",
            '"/actor/access/start"',
            '"/actor/access/submit"',
            '"/actor/access/decision"',
            '"/actor/access/cancel"',
        ),
        "Mobile Access client",
    )


def _validate_client_outcome_parity() -> None:
    desktop = _read("apps/desktop/src/services/accessGate.ts")
    mobile = _read("apps/mobile/src/features/auth/authSession.ts")
    for outcome in CLIENT_OUTCOMES:
        desktop_count = desktop.count(outcome)
        mobile_count = mobile.count(outcome)
        if desktop_count == 0 or mobile_count == 0:
            raise GateError(
                f"typed Access outcome {outcome!r} is not shared by both clients"
            )


def _source_files() -> Iterable[Path]:
    for relative_root in PRODUCTION_SCAN_ROOTS:
        root = REPO_ROOT / relative_root
        for path in root.rglob("*"):
            if (
                path.is_file()
                and path.suffix in TEXT_SUFFIXES
                and not (set(path.relative_to(REPO_ROOT).parts) & SKIP_PARTS)
                and not path.name.endswith(".pb.go")
                and not path.name.endswith("_pb.ts")
            ):
                yield path


def _validate_retired_access_surface_absent() -> None:
    forbidden = (
        "/actor/" + "login",
        "auth_" + "login",
        "direct_" + "login_fallback",
        "Validate" + "LegacySubmission",
    )
    violations: list[str] = []
    for path in _source_files():
        text = path.read_text(encoding="utf-8")
        for token in forbidden:
            if token in text:
                relative = path.relative_to(REPO_ROOT).as_posix()
                violations.append(f"{relative}: {token}")
    if violations:
        raise GateError(
            "retired Station Access surface remains: "
            + ", ".join(violations[:20])
        )


def validate_station_access_capability_contract() -> None:
    _validate_api_ownership(_load_ownership_registry())
    _validate_proto_contracts()
    _validate_transport_owners()
    _validate_client_outcome_parity()
    _validate_retired_access_surface_absent()


class StationAccessCapabilityContractGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-01"
    bom = ("SAL-G00", "SAL-G01", "SAL-G02")
    spec = ("SAL-C01", "SAL-C02", "SAL-C03")

    def run(self) -> dict[str, object]:
        validate_station_access_capability_contract()
        self.assert_condition(
            "station_access_capability_contract",
            True,
            "Station identity, protobuf Access Gate, scope fields, typed "
            "outcomes, and retired-path absence are valid",
        )
        return {
            "proven_scope": [
                "Station Access API ownership and generated protobuf wire",
                "Desktop and Mobile typed failure parity",
                "retired direct-login production surface absence",
            ],
            "unproven_scope": [
                "native Desktop and Mobile receiver behavior",
                "Federation and Relay client boundary",
            ],
        }


def main() -> int:
    return StationAccessCapabilityContractGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
