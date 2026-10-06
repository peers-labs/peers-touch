#!/usr/bin/env python3
"""Validate the Station/Relay runtime-role and security baseline."""

from __future__ import annotations

import subprocess
from collections.abc import Iterable
from pathlib import Path

from tooling.acceptance.core import AcceptanceGate, GateError, REPO_ROOT


GATE_ID = "relay-role-security-contract"
FORBIDDEN_EGRESS = "http://192.0.2.12:7784/event"


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


def _reject_tokens(
    source: str,
    forbidden: Iterable[str],
    label: str,
) -> None:
    present = [token for token in forbidden if token in source]
    if present:
        raise GateError(f"{label} contains forbidden tokens: {', '.join(present)}")


def _find_forbidden_egress(root: Path) -> list[str]:
    matches: list[str] = []
    station_root = root / "apps" / "station"
    for path in station_root.rglob("*"):
        if not path.is_file() or path.suffix not in {".go", ".sh", ".yml", ".yaml"}:
            continue
        if FORBIDDEN_EGRESS in path.read_text(encoding="utf-8"):
            matches.append(str(path.relative_to(root)))
    return sorted(matches)


def _run(command: list[str], cwd: Path) -> None:
    completed = subprocess.run(
        command,
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode == 0:
        return
    output = "\n".join(
        part.strip()
        for part in (completed.stdout, completed.stderr)
        if part.strip()
    )
    raise GateError(
        f"command failed ({' '.join(command)}): {output[-4000:]}"
    )


def validate_relay_role_source_contract() -> None:
    role_source = _read("apps/station/frame/core/runtime/role/role.go")
    _require_tokens(
        role_source,
        (
            'EnvironmentVariable = "PEERS_NODE_ROLE"',
            'Station Role = "station"',
            'Relay   Role = "relay"',
            "IncludesApplicationSubservers",
            "IncludesTouch",
            "AllowsPluginSubserver",
            '"relay": {}',
        ),
        "runtime role owner",
    )

    main_source = _read("apps/station/app/main.go")
    _require_tokens(
        main_source,
        (
            "role.FromEnvironment()",
            "role.WithContext(context.Background(), processRole)",
            "processRole.IncludesApplicationSubservers()",
            "stationApplicationSubservers()",
        ),
        "Station binary composition root",
    )

    peers_source = _read("apps/station/frame/peers.go")
    _require_tokens(
        peers_source,
        (
            "role.FromContext(ctx)",
            "processRole.IncludesTouch()",
        ),
        "Touch composition root",
    )

    native_source = _read(
        "apps/station/frame/core/plugin/native/node/native_init_top_comp.go"
    )
    _require_tokens(
        native_source,
        (
            "role.FromContext(ctx)",
            "processRole.AllowsPluginSubserver(name)",
            "processRole == role.Relay",
        ),
        "native plugin composition root",
    )

    relay_source = _read(
        "apps/station/frame/core/plugin/native/subserver/relay/relay.go"
    )
    _require_tokens(
        relay_source,
        (
            "validateRelaySecurityOptions(s.opts)",
            "operatorAuthenticationWrapper(",
            "tls.VersionTLS13",
            "s.opts.AllowInsecureLoopback",
        ),
        "Relay security composition",
    )
    _reject_tokens(
        relay_source,
        ("tls.VersionTLS12",),
        "Relay TLS listener",
    )

    handler_source = _read(
        "apps/station/frame/core/plugin/native/subserver/relay/handler.go"
    )
    _require_tokens(
        handler_source,
        (
            '"relay-healthz", "/healthz"',
            '"relay-metrics", "/metrics"',
            "operatorJWT",
            'subj.Attributes["audience"]',
            'subj.Attributes["scope"]',
        ),
        "Relay operator routes",
    )

    config_source = _read("apps/station/app/conf/sub_relay.yml")
    _require_tokens(
        config_source,
        (
            "allow-insecure-loopback: false",
            'signing-key-file: ""',
            'operator-key-file: ""',
            'operator-issuer: ""',
            'operator-audience: ""',
            'operator-scope: ""',
        ),
        "Relay fail-closed configuration",
    )

    compose_source = _read("tooling/docker/compose.yml")
    _require_tokens(
        compose_source,
        (
            "PEERS_NODE_ROLE: station",
            "PEERS_NODE_ROLE: relay",
            "RELAY_TLS_CERT_FILE:",
            "RELAY_SIGNING_KEY_FILE:",
            "RELAY_OPERATOR_KEY_FILE:",
            '"http://127.0.0.1:18080/healthz"',
        ),
        "Docker role wiring",
    )

    entrypoint_source = _read("tooling/docker/entrypoint.sh")
    _require_tokens(
        entrypoint_source,
        (
            'case "${PEERS_NODE_ROLE:-}" in',
            "RELAY_TLS_CERT_FILE is required for relay role",
            "RELAY_SIGNING_KEY_FILE is required for relay role",
            "RELAY_OPERATOR_KEY_FILE is required for relay role",
            "relay role cannot enable relay-client",
        ),
        "Docker role preflight",
    )

    matches = _find_forbidden_egress(REPO_ROOT)
    if matches:
        raise GateError(
            "Station source contains undeclared debug egress: "
            + ", ".join(matches)
        )


def validate_relay_role_security_contract() -> None:
    validate_relay_role_source_contract()
    _run(
        [
            "go",
            "test",
            "-race",
            "-count=1",
            "./frame/core/runtime/role/...",
            "./frame/core/plugin/native/subserver/relay/...",
        ],
        REPO_ROOT / "apps" / "station",
    )
    _run(["sh", "-n", "tooling/docker/entrypoint.sh"], REPO_ROOT)
    _run(
        [
            "bash",
            "-n",
            "tooling/scripts/local-dev/station-dev.sh",
            "tooling/scripts/local-dev/relay-check.sh",
        ],
        REPO_ROOT,
    )


class RelayRoleSecurityContractGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-REL-01"
    bom = ("SAL-D11",)
    spec = ("SAL-J08-ROLE",)

    def run(self) -> dict[str, object]:
        validate_relay_role_security_contract()
        self.assert_condition(
            "relay_role_security_contract",
            True,
            "Relay composition, TLS, operator authentication, quotas, "
            "deployment wiring, and egress policy are valid",
        )
        return {
            "proven_scope": [
                "explicit Station/Relay process role and composition allowlists",
                "fail-closed Relay TLS, signing-key, operator-policy, and quota configuration",
                "dedicated operator credential issuer, audience, scope, and key",
                "Relay health and operator-protected metrics route inventory",
                "absence of the undeclared hardcoded Station debug egress",
            ],
            "unproven_scope": [
                "live public certificate negotiation and hostile-client behavior",
                "proof-of-possession enrollment, signed discovery, and opaque tunnel behavior",
            ],
        }


def main() -> int:
    return RelayRoleSecurityContractGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
