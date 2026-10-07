#!/usr/bin/env python3
"""Validate the Station/Relay runtime-role and security baseline."""

from __future__ import annotations

import hashlib
import os
import re
import socket
import ssl
import subprocess
from collections.abc import Iterable
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    load_runtime_manifest,
    require_runtime_service,
)


GATE_ID = "relay-role-security-contract"
ENVIRONMENT_ID = "station-access-relay-role"
RUNTIME_MANIFEST_ENV = "PT_ACCEPTANCE_RUNTIME_MANIFEST"
FORBIDDEN_EGRESS = "http://192.0.2.12:7784/event"
ISOLATED_ROUTES = (
    "/actor",
    "/api/oauth/providers",
    "/conversation/list",
    "/debug",
)
_TLS12_PROTOCOL_REJECTION_MARKERS = (
    "alert protocol version",
    "tlsv1_alert_protocol_version",
)
_RELAY_SECRET_FILES = frozenset(
    {
        "auth-secret",
        "relay-operator.key",
        "relay-signing.key",
        "relay-tls.key",
        "relay.crt",
    }
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


def _http_status(url: str) -> int:
    request = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=8) as response:
            response.read(1)
            return response.status
    except HTTPError as error:
        return error.code
    except (OSError, TimeoutError, URLError) as error:
        raise GateError(f"HTTP probe failed for {url}: {error}") from error


def _is_explicit_tls12_protocol_rejection(detail: str) -> bool:
    normalized = detail.lower()
    return any(
        marker in normalized
        for marker in _TLS12_PROTOCOL_REJECTION_MARKERS
    )


def _probe_tls_with_openssl(host: str, port: int) -> dict[str, str]:
    target = f"{host}:{port}"
    base_command = [
        "openssl",
        "s_client",
        "-connect",
        target,
        "-servername",
        host,
    ]
    try:
        modern = subprocess.run(
            [*base_command, "-tls1_3", "-showcerts"],
            input="",
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise GateError(
            f"OpenSSL TLS 1.3 probe failed for {target}: {error}"
        ) from error
    modern_output = f"{modern.stdout}\n{modern.stderr}"
    begin = "-----BEGIN CERTIFICATE-----"
    end = "-----END CERTIFICATE-----"
    begin_index = modern_output.find(begin)
    end_index = modern_output.find(end, begin_index)
    if (
        modern.returncode != 0
        or "TLSv1.3" not in modern_output
        or begin_index < 0
        or end_index < 0
    ):
        raise GateError(f"Relay TLS 1.3 handshake failed at tls://{target}")
    pem = modern_output[begin_index : end_index + len(end)]
    try:
        certificate = ssl.PEM_cert_to_DER_cert(pem)
    except ValueError as error:
        raise GateError("Relay TLS certificate is invalid") from error

    try:
        legacy = subprocess.run(
            [*base_command, "-tls1_2"],
            input="",
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise GateError(
            f"OpenSSL TLS 1.2 rejection probe failed for {target}: {error}"
        ) from error
    legacy_output = f"{legacy.stdout}\n{legacy.stderr}"
    if not _is_explicit_tls12_protocol_rejection(legacy_output):
        if (
            legacy.returncode == 0
            and re.search(
                r"(?im)^\s*Protocol(?:\s+version)?\s*:\s*TLSv1\.2\s*$",
                legacy_output,
            )
        ):
            raise GateError("Relay stream accepted forbidden TLS 1.2")
        detail = legacy_output.strip()[-1000:] or "no OpenSSL diagnostic"
        raise GateError(
            "Relay TLS 1.2 rejection probe was inconclusive "
            f"at tls://{target} (exit {legacy.returncode}): {detail}"
        )
    return {
        "endpoint": f"tls://{target}",
        "protocol": "TLSv1.3",
        "certificateSha256": hashlib.sha256(certificate).hexdigest(),
        "tls12": "rejected",
    }


def _probe_tls(stream_endpoint: str) -> dict[str, str]:
    parsed = urlparse(stream_endpoint)
    if (
        parsed.scheme != "tls"
        or not parsed.hostname
        or parsed.port is None
    ):
        raise GateError("Relay stream endpoint must be a tls:// host and port")

    if not ssl.HAS_TLSv1_3:
        return _probe_tls_with_openssl(parsed.hostname, parsed.port)

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.maximum_version = ssl.TLSVersion.TLSv1_3
    try:
        with socket.create_connection(
            (parsed.hostname, parsed.port),
            timeout=8,
        ) as raw_socket:
            with context.wrap_socket(
                raw_socket,
                server_hostname=parsed.hostname,
            ) as tls_socket:
                version = tls_socket.version()
                certificate = tls_socket.getpeercert(binary_form=True)
    except (OSError, ssl.SSLError) as error:
        raise GateError(
            f"Relay TLS 1.3 handshake failed at {stream_endpoint}: {error}"
        ) from error
    if version != "TLSv1.3" or not certificate:
        raise GateError("Relay stream did not negotiate TLS 1.3 with a certificate")

    legacy = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    legacy.check_hostname = False
    legacy.verify_mode = ssl.CERT_NONE
    legacy.minimum_version = ssl.TLSVersion.TLSv1_2
    legacy.maximum_version = ssl.TLSVersion.TLSv1_2
    try:
        with socket.create_connection(
            (parsed.hostname, parsed.port),
            timeout=8,
        ) as raw_socket:
            with legacy.wrap_socket(
                raw_socket,
                server_hostname=parsed.hostname,
            ):
                pass
    except ssl.SSLError as error:
        if not _is_explicit_tls12_protocol_rejection(
            f"{getattr(error, 'reason', '')} {error}"
        ):
            raise GateError(
                "Relay TLS 1.2 rejection probe was inconclusive "
                f"at {stream_endpoint}: {error}"
            ) from error
        legacy_rejected = True
    except OSError as error:
        raise GateError(
            "Relay TLS 1.2 rejection probe failed "
            f"at {stream_endpoint}: {error}"
        ) from error
    else:
        legacy_rejected = False
    if not legacy_rejected:
        raise GateError("Relay stream accepted forbidden TLS 1.2")
    return {
        "endpoint": stream_endpoint,
        "protocol": version,
        "certificateSha256": hashlib.sha256(certificate).hexdigest(),
        "tls12": "rejected",
    }


def _required_object(
    value: object,
    field: str,
    label: str,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise GateError(f"{label} {field} must be an object")
    return value


def _required_protected_files(
    value: object,
) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) != len(_RELAY_SECRET_FILES):
        raise GateError("Relay storage security protected-file set is incomplete")
    files: list[dict[str, Any]] = []
    names: set[str] = set()
    for record_value in value:
        record = _required_object(
            record_value,
            "entry",
            "Relay protected-file evidence",
        )
        name = record.get("name")
        principals = record.get("principals")
        if (
            not isinstance(name, str)
            or name in names
            or record.get("exists") is not True
            or record.get("nonEmpty") is not True
            or record.get("aclProtected") is not True
            or record.get("expectedPrincipalsPresent") is not True
            or record.get("unexpectedPrincipals") != []
            or record.get("protected") is not True
            or not isinstance(principals, list)
            or not principals
            or any(not isinstance(principal, str) for principal in principals)
        ):
            raise GateError(
                f"Relay protected-file evidence is incomplete for {name}"
            )
        names.add(name)
        files.append(record)
    if names != _RELAY_SECRET_FILES:
        raise GateError("Relay storage security protected-file set is incomplete")
    return sorted(files, key=lambda record: str(record["name"]))


def _validate_runtime_evidence(
    manifest: dict[str, Any],
    relay_attestation: dict[str, Any],
) -> dict[str, Any]:
    if manifest.get("environmentId") != ENVIRONMENT_ID:
        raise GateError(
            f"Runtime manifest environment must be {ENVIRONMENT_ID}"
        )
    source = _required_object(
        manifest.get("source"),
        "source",
        "Runtime manifest",
    )
    source_commit = str(source.get("commit") or "")
    station = require_runtime_service(manifest, "station", "station")
    relay = require_runtime_service(manifest, "relay", "relay")
    for service_id, service in (("station", station), ("relay", relay)):
        live_commit = str(service.get("liveCommit") or "")
        if (
            service.get("workspaceDigest") != "clean"
            or len(live_commit) < 7
            or not (
                live_commit.startswith(source_commit)
                or source_commit.startswith(live_commit)
            )
        ):
            raise GateError(
                f"{service_id} service is not bound to the clean Gate source"
            )
    if station.get("protocolDigest") != relay.get("protocolDigest"):
        raise GateError("Station and Relay protocol identities differ")

    if (
        relay_attestation.get("artifactKind")
        != "service-deployment-attestation"
        or relay_attestation.get("serviceId") != "relay"
        or relay_attestation.get("serviceKind") != "relay"
        or relay_attestation.get("commit") != relay.get("liveCommit")
    ):
        raise GateError("Relay deployment attestation is invalid")
    security = _required_object(
        relay_attestation.get("runtimeSecurity"),
        "runtimeSecurity",
        "Relay attestation",
    )
    station_runtime = _required_object(
        security.get("stationRuntime"),
        "stationRuntime",
        "Relay runtime security",
    )
    relay_runtime = _required_object(
        security.get("relayRuntime"),
        "relayRuntime",
        "Relay runtime security",
    )
    storage_security = _required_object(
        security.get("relayStorageSecurity"),
        "relayStorageSecurity",
        "Relay runtime security",
    )
    _required_protected_files(
        storage_security.get("requiredProtectedFiles"),
    )
    if (
        security.get("attachmentMode") != "existing-owner-managed"
        or station_runtime.get("role") != "station"
        or relay_runtime.get("role") != "relay"
        or station_runtime.get("taskName") == relay_runtime.get("taskName")
        or station_runtime.get("runtimePath") == relay_runtime.get("runtimePath")
        or set(station_runtime.get("processIds") or ())
        & set(relay_runtime.get("processIds") or ())
        or storage_security.get("rootAclProtected") is not True
        or storage_security.get("unexpectedPrincipals") != []
        or storage_security.get("processBinaryMatches") is not True
        or storage_security.get("stationDatabaseExists") is not True
        or storage_security.get("relayDatabaseExists") is not True
        or storage_security.get("stationDatabasePath")
        == storage_security.get("relayDatabasePath")
    ):
        raise GateError("Attached Station/Relay runtime security is incomplete")
    stream_endpoint = str(security.get("streamEndpoint") or "")
    if not stream_endpoint:
        raise GateError("Relay stream endpoint is missing")
    return {
        "sourceCommit": source_commit,
        "station": station,
        "relay": relay,
        "stationRuntime": station_runtime,
        "relayRuntime": relay_runtime,
        "relayStorageSecurity": storage_security,
        "streamEndpoint": stream_endpoint,
    }


def validate_relay_role_runtime_contract() -> dict[str, Any]:
    manifest_path = os.environ.get(RUNTIME_MANIFEST_ENV, "").strip()
    if not manifest_path:
        raise GateError(f"{RUNTIME_MANIFEST_ENV} is required")
    try:
        manifest = load_runtime_manifest(Path(manifest_path), GATE_ID)
        relay = require_runtime_service(manifest, "relay", "relay")
        reference = ArtifactRef.from_dict(relay["attestationArtifact"])
        store = EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        relay_attestation = store.read_json(reference)
    except Exception as error:
        raise GateError(f"Relay runtime manifest is invalid: {error}") from error
    evidence = _validate_runtime_evidence(manifest, relay_attestation)

    station_endpoint = str(evidence["station"]["endpoint"]).rstrip("/")
    relay_endpoint = str(evidence["relay"]["endpoint"]).rstrip("/")
    station_version_status = _http_status(
        f"{station_endpoint}/app-meta/version"
    )
    relay_health_status = _http_status(f"{relay_endpoint}/healthz")
    metrics_status = _http_status(f"{relay_endpoint}/metrics")
    isolated_routes = {
        route: _http_status(f"{relay_endpoint}{route}")
        for route in ISOLATED_ROUTES
    }
    if station_version_status != 200:
        raise GateError("Station live version endpoint is unavailable")
    if relay_health_status != 200:
        raise GateError("Relay live health endpoint is unavailable")
    if metrics_status != 401:
        raise GateError("Relay metrics endpoint is not operator-protected")
    unexpected_routes = {
        route: status
        for route, status in isolated_routes.items()
        if status != 404
    }
    if unexpected_routes:
        raise GateError(
            f"Relay exposes forbidden Station routes: {unexpected_routes}"
        )
    tls = _probe_tls(str(evidence["streamEndpoint"]))
    return {
        "environmentId": ENVIRONMENT_ID,
        "sourceCommit": evidence["sourceCommit"],
        "stationRuntime": evidence["stationRuntime"],
        "relayRuntime": evidence["relayRuntime"],
        "relayStorageSecurity": evidence["relayStorageSecurity"],
        "http": {
            "stationVersion": station_version_status,
            "relayHealth": relay_health_status,
            "relayMetricsWithoutOperatorCredential": metrics_status,
            "isolatedRoutes": isolated_routes,
        },
        "tls": tls,
    }


class RelayRoleSecurityContractGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-REL-01"
    bom = ("SAL-D11",)
    spec = ("SAL-J08-ROLE",)

    def run(self) -> dict[str, object]:
        validate_relay_role_security_contract()
        runtime = validate_relay_role_runtime_contract()
        self.assert_condition(
            "relay_role_security_contract",
            True,
            "Relay composition, TLS, operator authentication, quotas, "
            "deployment wiring, and egress policy are valid",
        )
        return {
            "proven_scope": [
                "explicit Station/Relay process role and composition allowlists",
                "fail-closed Relay TLS, signing-key, operator-policy, and "
                "quota configuration",
                "dedicated operator credential issuer, audience, scope, and key",
                "Relay health and operator-protected metrics route inventory",
                "exact-source isolated Station and Relay processes on the "
                "attached profile",
                "live TLS 1.3 negotiation with TLS 1.2 rejection",
                "live Relay route isolation and Windows secret ACL ownership",
                "absence of the undeclared hardcoded Station debug egress",
            ],
            "unproven_scope": [
                "public CA certificate negotiation and hostile-client load behavior",
                "proof-of-possession enrollment, signed discovery, and "
                "opaque tunnel behavior",
            ],
            "runtime": runtime,
        }


def main() -> int:
    return RelayRoleSecurityContractGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
