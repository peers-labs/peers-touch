#!/usr/bin/env python3
"""Validate the Station Access ownership, wire, and client parity contract."""

from __future__ import annotations

import json
import re
import subprocess
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

CANONICAL_ACCESS_ROUTES = {
    ("POST", "/actor/access/start"),
    ("OPTIONS", "/actor/access/start"),
    ("POST", "/actor/access/submit"),
    ("OPTIONS", "/actor/access/submit"),
    ("POST", "/actor/access/decision"),
    ("OPTIONS", "/actor/access/decision"),
    ("POST", "/actor/access/cancel"),
    ("OPTIONS", "/actor/access/cancel"),
}

CLIENT_OUTCOMES = (
    "STATION_ACCESS_UNKNOWN_GATE",
    "STATION_ACCESS_IDENTITY_MISMATCH",
    "STATION_ACCESS_ATTEMPT_EXPIRED",
)

CLIENT_ACCESS_COMMANDS = {
    "Desktop": {
        "access_start",
        "access_submit_invite_code",
        "access_submit_login",
        "access_decision",
        "access_cancel",
    },
    "Mobile": {
        "access_start",
        "access_submit",
        "access_decision",
        "access_cancel",
    },
}

CLIENT_ACCESS_COMMAND_CONTRACTS = {
    "Desktop frontend": {
        "path": "apps/desktop/src/services/desktop_api.ts",
        "pattern": re.compile(
            r"\b(?:invoke|invokeAccessCommand|invokeAuthCommand)"
            r"(?:<[^>]+>)?\(\s*['\"](access_[a-z0-9_]+)['\"]"
        ),
        "allowed": CLIENT_ACCESS_COMMANDS["Desktop"],
    },
    "Desktop native commands": {
        "path": "apps/desktop/src-tauri/src/interface/tauri_commands/auth.rs",
        "pattern": re.compile(
            r"^\s*pub\s+fn\s+(access_[a-z0-9_]+)\s*\(",
            re.MULTILINE,
        ),
        "allowed": CLIENT_ACCESS_COMMANDS["Desktop"],
    },
    "Desktop Tauri handlers": {
        "path": "apps/desktop/src-tauri/src/main.rs",
        "pattern": re.compile(r"\bauth::(access_[a-z0-9_]+)\b"),
        "allowed": CLIENT_ACCESS_COMMANDS["Desktop"],
    },
    "Desktop HTTP gateway": {
        "path": "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
        "pattern": re.compile(
            r"^\s*['\"](access_[a-z0-9_]+)['\"]\s*=>",
            re.MULTILINE,
        ),
        "allowed": CLIENT_ACCESS_COMMANDS["Desktop"],
    },
    "Mobile frontend": {
        "path": "apps/mobile/src/services/mobileCommands.ts",
        "pattern": re.compile(
            r"\binvoke(?:<[^>]+>)?\(\s*['\"](access_[a-z0-9_]+)['\"]"
        ),
        "allowed": CLIENT_ACCESS_COMMANDS["Mobile"],
    },
    "Mobile native commands": {
        "path": "apps/mobile/src-tauri/src/commands/oauth.rs",
        "pattern": re.compile(
            r"^\s*pub\s+async\s+fn\s+(access_[a-z0-9_]+)\s*\(",
            re.MULTILINE,
        ),
        "allowed": CLIENT_ACCESS_COMMANDS["Mobile"],
    },
    "Mobile Tauri handlers": {
        "path": "apps/mobile/src-tauri/src/commands/mod.rs",
        "pattern": re.compile(r"\boauth::(access_[a-z0-9_]+)\b"),
        "allowed": CLIENT_ACCESS_COMMANDS["Mobile"],
    },
}

CLIENT_ACCESS_ROOTS = {
    "Desktop": (
        Path("apps/desktop/src"),
        Path("apps/desktop/src-tauri/src"),
    ),
    "Mobile": (
        Path("apps/mobile/src"),
        Path("apps/mobile/src-tauri/src"),
    ),
}
CLIENT_ACCESS_SUFFIXES = frozenset({".rs", ".ts", ".tsx"})
CLIENT_ACCESS_SKIP_PARTS = frozenset(
    {"acceptance", "gen", "node_modules", "target"}
)
CLIENT_ACCESS_DISCOVERY_PATTERNS = (
    re.compile(
        r"\b(?:invoke[A-Za-z0-9_]*)"
        r"(?:<[^>]+>)?\(\s*['\"`](access_[a-z0-9_]+)['\"`]"
    ),
    re.compile(
        r"\b(?:operationId:\s*|case\s+)['\"`](access_[a-z0-9_]+)['\"`]"
    ),
    re.compile(r"^\s*['\"`](access_[a-z0-9_]+)['\"`]\s*=>", re.MULTILINE),
    re.compile(
        r"^\s*pub(?:\s+async)?\s+fn\s+(access_[a-z0-9_]+)\s*\(",
        re.MULTILINE,
    ),
    re.compile(r"\b(?:auth|oauth)::(access_[a-z0-9_]+)\b"),
    re.compile(
        r"\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*"
        r"\s*=\s*['\"`](access_[a-z0-9_]+)['\"`]"
    ),
)


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
    access_routes = {
        (
            str(route.get("method") or ""),
            str(route.get("path") or ""),
        )
        for item in raw_capabilities
        if isinstance(item, Mapping)
        for route in [item.get("canonical_route")]
        if isinstance(route, Mapping)
        and str(route.get("path") or "").startswith("/actor/access/")
    }
    if access_routes != CANONICAL_ACCESS_ROUTES:
        raise GateError(
            "Station Access route inventory must exactly match the current "
            f"capability registry: {sorted(access_routes)!r}"
        )


def _load_route_report() -> dict[str, Any]:
    completed = subprocess.run(
        [
            "go",
            "run",
            "./apps/station/app/cmd/station_api_ownership",
            "--root",
            ".",
            "--registry",
            str(OWNERSHIP_REGISTRY.relative_to(REPO_ROOT)),
        ],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        report = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise GateError(
            "Station API ownership report is not valid JSON"
        ) from error
    if completed.returncode != 0 or report.get("status") != "PASS":
        raise GateError(
            "Station API ownership source analysis failed: "
            + json.dumps(report.get("diagnostics", []), sort_keys=True)
        )
    return report


def _validate_source_route_inventory(report: Mapping[str, Any]) -> None:
    routes = report.get("routes")
    if not isinstance(routes, list):
        raise GateError("Station API ownership report routes are missing")
    access_routes = {
        (str(item.get("method") or ""), str(item.get("path") or ""))
        for item in routes
        if isinstance(item, Mapping)
        and str(item.get("path") or "").startswith("/actor/access/")
    }
    if access_routes != CANONICAL_ACCESS_ROUTES:
        raise GateError(
            "Station Access implementation routes must exactly match the "
            f"current capability registry: {sorted(access_routes)!r}"
        )


def _validate_client_command_inventory(
    sources: Mapping[str, str] | None = None,
) -> dict[str, list[str]]:
    inspected = (
        dict(sources)
        if sources is not None
        else _client_access_command_sources()
    )
    inventories: dict[str, list[str]] = {}
    for surface, contract in CLIENT_ACCESS_COMMAND_CONTRACTS.items():
        path = str(contract["path"])
        source = inspected.get(path)
        if source is None:
            raise GateError(f"{surface} Access command source is missing: {path}")
        commands = set(contract["pattern"].findall(source))
        allowed = set(contract["allowed"])
        inventories[surface] = sorted(commands)
        if commands != allowed:
            raise GateError(
                f"{surface} Access command inventory drifted: "
                f"expected={sorted(allowed)!r}, actual={sorted(commands)!r}"
            )
    for platform, roots in CLIENT_ACCESS_ROOTS.items():
        commands = {
            command
            for path, source in inspected.items()
            if any(
                path == root.as_posix()
                or path.startswith(f"{root.as_posix()}/")
                for root in roots
            )
            for pattern in CLIENT_ACCESS_DISCOVERY_PATTERNS
            for command in pattern.findall(source)
        }
        allowed = CLIENT_ACCESS_COMMANDS[platform]
        inventories[f"{platform} production discovery"] = sorted(commands)
        if commands != allowed:
            raise GateError(
                f"{platform} production Access command inventory drifted: "
                f"expected={sorted(allowed)!r}, actual={sorted(commands)!r}"
            )
    return inventories


def _client_access_command_sources() -> dict[str, str]:
    sources: dict[str, str] = {}
    for roots in CLIENT_ACCESS_ROOTS.values():
        for relative_root in roots:
            for path in (REPO_ROOT / relative_root).rglob("*"):
                relative = path.relative_to(REPO_ROOT)
                if (
                    path.is_file()
                    and path.suffix in CLIENT_ACCESS_SUFFIXES
                    and not (set(relative.parts) & CLIENT_ACCESS_SKIP_PARTS)
                    and ".test." not in path.name
                    and ".spec." not in path.name
                ):
                    sources[relative.as_posix()] = path.read_text(
                        encoding="utf-8"
                    )
    return sources


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


def validate_station_access_capability_contract() -> None:
    _validate_api_ownership(_load_ownership_registry())
    _validate_source_route_inventory(_load_route_report())
    _validate_proto_contracts()
    _validate_transport_owners()
    _validate_client_command_inventory()
    _validate_client_outcome_parity()


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
            "outcomes, and current interface inventory are valid",
        )
        return {
            "proven_scope": [
                "Station Access API ownership and generated protobuf wire",
                "Desktop and Mobile typed failure parity",
                "complete current Access route and consumer inventory",
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
