from __future__ import annotations

import hashlib
import json
import os
import secrets
import subprocess
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    EphemeralCapabilityBlocked,
    EphemeralCapabilityHandler,
    EphemeralGateClient,
    EphemeralHandlerCleanup,
    GateError,
    REPO_ROOT,
    current_artifact_ref,
    load_runtime_manifest,
)
from tooling.acceptance.transports.ssh import SshTransport, SshTunnel
from tooling.scripts.deploy.windows_runtime import WindowsRuntimeConfig


GATE_ID = "relay-opaque-tunnel-e2e"
CAPABILITY_ID = "station-access.relay-opaque-tunnel"
RUN_OPERATION = "verify-opaque-tunnel"
_PROBE_MARKER = "PT_OPAQUE_TUNNEL_PROBE="


def validate_opaque_tunnel_source_contract() -> None:
    required_tokens = {
        "model/domain/federation/relay_transport.proto": (
            "message RelayTunnelOpen",
            "message RelayTunnelOpened",
            "bytes relay_nonce",
            "message RelayTunnelData",
            "message RelayTunnelCancel",
            "message RelayTunnelClose",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay/"
            "handler.go"
        ): (
            '"/.well-known/peers-touch/tunnel"',
            "h.handleTunnel",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay/"
            "handler_tunnel.go"
        ): (
            "AuthorizeClientTunnel",
            "AuthorizePeerTunnel",
            "MaxConnectionBytes",
            "entry.rateLimiter",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay/"
            "stream.go"
        ): (
            "rateLimiter:",
            "newTunnelRateLimiter(rateBytesPerSecond)",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay/relay.go"
        ): (
            "mount.MaxClients",
            "mount.BandwidthLimit",
            "streamLimits",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay-client/"
            "inner_tls.go"
        ): (
            "tls.VersionTLS13",
            "SPKISHA256",
            "DialContext",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay-client/"
            "peer_tunnel.go"
        ): (
            "VerifyStationRouteAttestation",
            "verifyPinnedSPKI",
            "PeerCapabilityManifestDigest",
            "EnableCompression: false",
        ),
        "apps/station/frame/core/federation/routes.go": (
            "PeerCapabilityManifestDigest",
            "peerRouteSpecs",
        ),
        "apps/station/frame/core/federation/transport.go": (
            "RoundTrip",
            "relay.Available()",
        ),
    }
    for relative_path, tokens in required_tokens.items():
        source = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
        missing = [token for token in tokens if token not in source]
        if missing:
            raise GateError(
                f"{relative_path} is missing: {', '.join(missing)}"
            )

    forbidden_roots = (
        REPO_ROOT / "apps/station/frame/core/plugin/native/subserver/relay",
        REPO_ROOT / "apps/station/frame/core/plugin/native/subserver/relay-client",
        REPO_ROOT / "apps/station/frame/core/federation",
        REPO_ROOT / "apps/station/app/subserver/key_exchange",
        REPO_ROOT / "apps/station/app/subserver/actor_identity",
        REPO_ROOT / "apps/station/frame/touch/federation/resolver",
    )
    forbidden = (
        "/relay/forward",
        "ForwardAuthorizationHeader",
        "relay-client-token",
        "WriteRequestFrame",
        "WriteResponseFrame",
    )
    violations: list[str] = []
    for root in forbidden_roots:
        for path in root.rglob("*.go"):
            source = path.read_text(encoding="utf-8")
            for token in forbidden:
                if token in source:
                    violations.append(
                        f"{path.relative_to(REPO_ROOT)}:{token}"
                    )
    if violations:
        raise GateError(
            "retired transparent Relay transport remains: "
            + ", ".join(sorted(violations))
        )


class RelayOpaqueTunnelCapabilityHandler(EphemeralCapabilityHandler):
    def __init__(
        self,
        transport: SshTransport,
        station_config: WindowsRuntimeConfig,
        relay_config: WindowsRuntimeConfig,
    ) -> None:
        self._transport = transport
        self._relay_config = relay_config
        self._closed = False
        self._tunnels: list[SshTunnel] = []
        self._marker = "opaque-" + secrets.token_hex(16)
        try:
            station = transport.start_local_forward(
                remote_port=station_config.http_port
            )
            self._tunnels.append(station)
            relay = transport.start_local_forward(
                remote_port=relay_config.http_port
            )
            self._tunnels.append(relay)
        except Exception:
            self.close()
            raise
        self._station_url = f"http://127.0.0.1:{station.local_port}"
        self._relay_url = f"http://127.0.0.1:{relay.local_port}"

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return (RUN_OPERATION,)

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return (self._station_url, self._relay_url, self._marker)

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        del payload
        if (
            self._closed
            or operation != RUN_OPERATION
            or cancellation.is_set()
            or time.monotonic() >= deadline_monotonic
        ):
            raise EphemeralCapabilityBlocked(
                "Opaque tunnel probe is unavailable",
                resource=CAPABILITY_ID,
            )
        remaining = max(1.0, deadline_monotonic - time.monotonic())
        completed = subprocess.run(
            [
                "go",
                "test",
                "-run",
                "^TestLiveOpaqueTunnelProbe$",
                "-count=1",
                "-v",
                "./frame/core/plugin/native/subserver/relay-client",
            ],
            cwd=REPO_ROOT / "apps/station",
            capture_output=True,
            text=True,
            timeout=min(remaining, 90.0),
            check=False,
            env={
                **os.environ,
                "HOME": str(Path.home()),
                "PT_LIVE_TUNNEL_STATION_URL": self._station_url,
                "PT_LIVE_TUNNEL_RELAY_URL": self._relay_url,
                "PT_LIVE_TUNNEL_MARKER": self._marker,
            },
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise GateError(
                "Opaque tunnel runtime probe failed"
                + (f": {detail[-1000:]}" if detail else "")
            )
        encoded = next(
            (
                line[len(_PROBE_MARKER) :]
                for line in completed.stdout.splitlines()
                if line.startswith(_PROBE_MARKER)
            ),
            "",
        )
        try:
            result = json.loads(encoded)
        except json.JSONDecodeError as error:
            raise GateError(
                "Opaque tunnel runtime probe returned invalid evidence"
            ) from error
        if not isinstance(result, dict):
            raise GateError("Opaque tunnel probe result must be an object")
        result["relayOpaqueMarkerAbsent"] = self._marker_absent_from_relay_log()
        result["markerSha256"] = hashlib.sha256(
            self._marker.encode("utf-8")
        ).hexdigest()
        return result

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        del operation
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason, deadline_monotonic
        self.close()
        return True

    def close(self) -> EphemeralHandlerCleanup:
        if self._closed:
            return EphemeralHandlerCleanup(
                closed=True,
                secrets_zeroized=True,
            )
        errors: list[str] = []
        for tunnel in reversed(self._tunnels):
            try:
                tunnel.stop()
            except Exception as error:
                errors.append(str(error))
        self._tunnels.clear()
        self._marker = ""
        self._closed = True
        return EphemeralHandlerCleanup(
            closed=not errors,
            secrets_zeroized=True,
        )

    def _marker_absent_from_relay_log(self) -> bool:
        runtime = self._relay_config.runtime_path.replace("/", "\\")
        log_path = runtime + "\\logs\\relay.log"
        marker = self._marker.replace("'", "''")
        script = (
            "$path=Join-Path $env:USERPROFILE '"
            + log_path.replace("'", "''")
            + "';"
            + "if(-not (Test-Path -LiteralPath $path -PathType Leaf)){"
            + "Write-Output 'missing'; exit 2};"
            + "$found=[bool](Select-String -LiteralPath $path "
            + "-SimpleMatch -Quiet '"
            + marker
            + "');"
            + "if($found){Write-Output 'present'; exit 3};"
            + "Write-Output 'absent'"
        )
        completed = self._transport.run_argv(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ],
            timeout=30,
            check=False,
        )
        return completed.returncode == 0 and completed.stdout.strip() == "absent"


class RelayOpaqueTunnelGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-REL-04"
    bom = ("SAL-REL-04-OPAQUE-TUNNEL",)
    spec = ("SAL-J06", "SAL-J07", "SAL-J09", "SAL-D09")

    def __init__(self, capability_client: EphemeralGateClient) -> None:
        super().__init__()
        self.capability_client = capability_client
        manifest_path = Path(
            _required_environment("PT_ACCEPTANCE_RUNTIME_MANIFEST")
        )
        self.manifest = dict(
            load_runtime_manifest(manifest_path, self.gate_id)
        )
        self.manifest["_manifest_ref"] = current_artifact_ref(
            "runtime/environment-manifest.json",
            repo_root=REPO_ROOT,
        ).to_dict()
        self.report.manifest = self.manifest

    def run(self) -> dict[str, object]:
        validate_opaque_tunnel_source_contract()
        source = subprocess.run(
            [
                "go",
                "test",
                "-race",
                "-count=1",
                "./frame/core/federation/...",
                "./frame/core/plugin/native/federation/...",
                "./frame/core/plugin/native/subserver/relay/...",
                "./frame/core/plugin/native/subserver/relay-client/...",
            ],
            cwd=REPO_ROOT / "apps/station",
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
            env={**os.environ, "HOME": str(Path.home())},
        )
        result = dict(
            self.capability_client.invoke(
                CAPABILITY_ID,
                RUN_OPERATION,
                {},
                timeout_seconds=180,
            )
        )
        assertions = {
            "source_contract_tests_pass": source.returncode == 0,
            "binary_tunnel_operational": result.get("binaryTunnel") is True,
            "inner_tls_13_operational": result.get("innerTLS13") is True,
            "station_spki_pinned": result.get("stationSPKIPinned") is True,
            "station_login_over_tunnel": result.get("stationLoginPassed")
            is True,
            "relay_nonce_is_bounded": result.get("relayNonceBounded") is True,
            "limits_are_advertised": result.get("limitsAdvertised") is True,
            "relay_log_has_no_inner_marker": result.get(
                "relayOpaqueMarkerAbsent"
            )
            is True,
        }
        for name, passed in assertions.items():
            self.assert_condition(name, passed)
        return {
            "runtimeCell": "sixwin-station-relay",
            "markerSha256": result.get("markerSha256"),
            "assertions": assertions,
        }


def _required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise GateError(f"missing required environment: {name}")
    return value


def main() -> int:
    capability_client = EphemeralGateClient.from_environment()
    if capability_client is None:
        raise GateError("Opaque tunnel probe capability is required")
    with capability_client:
        return RelayOpaqueTunnelGate(capability_client).execute()


if __name__ == "__main__":
    raise SystemExit(main())
