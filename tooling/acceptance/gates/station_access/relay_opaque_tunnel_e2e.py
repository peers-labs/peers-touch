from __future__ import annotations

import hashlib
import json
import os
import secrets
import select
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Mapping
from pathlib import Path
from typing import TYPE_CHECKING
from typing import Any
from urllib.request import ProxyHandler, build_opener

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

if TYPE_CHECKING:
    from tooling.acceptance.provisioners.posix_service_runtime import (
        PosixServiceRuntimeConfig,
    )


GATE_ID = "relay-opaque-tunnel-e2e"
CAPABILITY_ID = "station-access.relay-opaque-tunnel"
RUN_OPERATION = "verify-opaque-tunnel"
_PROBE_MARKER = "PT_OPAQUE_TUNNEL_PROBE="
_MAX_RESPONSE_BYTES = 64 * 1024


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
        (
            "apps/station/frame/core/plugin/native/subserver/relay-client/"
            "options.go"
        ): (
            "TLSCAFile",
            "WithTLSCAFile",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay-client/"
            "http_client.go"
        ): (
            "AppendCertsFromPEM",
            "RootCAs:",
        ),
        (
            "apps/station/frame/core/plugin/native/subserver/relay/client/"
            "relay_client.go"
        ): (
            "TLSRootCAs",
            "RootCAs:",
        ),
        "tooling/docker/entrypoint.sh": (
            "RELAY_CLIENT_TLS_CA_FILE",
            "tls-ca-file:",
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
        station_transport: SshTransport,
        relay_transport: SshTransport,
        station_config: PosixServiceRuntimeConfig,
        relay_config: PosixServiceRuntimeConfig,
        relay_trust_anchor: bytes,
    ) -> None:
        from tooling.acceptance.provisioners.posix_service_runtime import (
            inspect_posix_runtime,
        )

        if relay_config.public_port is None or relay_config.stream_port is None:
            raise ValueError("Relay public TLS and stream ports are required")
        self._relay_transport = relay_transport
        self._relay_config = relay_config
        self._closed = False
        self._tunnels: list[SshTunnel] = []
        self._sensitive: list[bytearray] = []
        self._marker = "opaque-" + secrets.token_hex(16)
        self._mount_process: subprocess.Popen[str] | None = None
        self._attached_existing_mount = False
        self._mount_operator_token = ""
        self._mount_station_peer_id = ""
        self._relay_public_url = ""
        self._probe_directory = tempfile.TemporaryDirectory(
            prefix="peers-touch-opaque-tunnel-probe-"
        )
        self._probe_binary = Path(self._probe_directory.name) / "probe"
        self._probe_token_store = (
            Path(self._probe_directory.name) / "mount-credential.json"
        )
        self._relay_ca_file = (
            Path(self._probe_directory.name) / "relay-ca.pem"
        )
        try:
            self._relay_container_id = str(
                inspect_posix_runtime(
                    relay_config,
                    transport=relay_transport,
                )["containerId"]
            )
            station = station_transport.start_local_forward(
                remote_port=station_config.http_port
            )
            self._tunnels.append(station)
            relay = relay_transport.start_local_forward(
                remote_port=relay_config.http_port
            )
            self._tunnels.append(relay)
            stream = relay_transport.start_local_forward(
                remote_port=relay_config.stream_port
            )
            self._tunnels.append(stream)
            self._relay_ca_file.write_bytes(relay_trust_anchor)
            os.chmod(self._relay_ca_file, 0o600)
            relay_public = relay_transport.start_local_forward(
                remote_port=relay_config.public_port
            )
            self._tunnels.append(relay_public)
        except Exception:
            self.close()
            raise
        self._station_url = f"http://127.0.0.1:{station.local_port}"
        self._station_port = station.local_port
        self._relay_url = f"http://127.0.0.1:{relay.local_port}"
        self._stream_port = stream.local_port
        self._relay_public_url = (
            f"https://127.0.0.1:{relay_public.local_port}"
        )

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return (RUN_OPERATION,)

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return (
            *(
                value.decode("utf-8")
                for value in self._sensitive
                if value
            ),
            self._station_url,
            self._relay_url,
            self._relay_public_url,
            self._marker,
        )

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
        self._ensure_mount(deadline_monotonic, cancellation)
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
                "PT_LIVE_TUNNEL_RELAY_URL": self._relay_public_url,
                "PT_LIVE_TUNNEL_RELAY_CA_FILE": str(self._relay_ca_file),
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
        process = self._mount_process
        self._mount_process = None
        if process is not None:
            try:
                if process.stdin is not None:
                    process.stdin.close()
                process.wait(timeout=10)
                if process.returncode != 0:
                    errors.append("Relay client mount probe exited unsuccessfully")
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            except Exception as error:
                errors.append(str(error))

        if (
            not getattr(self, "_attached_existing_mount", False)
            and self._mount_operator_token
            and self._mount_station_peer_id
        ):
            try:
                revoke = self._request_json(
                    self._relay_url + "/api/v1/relay/mount",
                    method="DELETE",
                    payload={
                        "station_peer_id": self._mount_station_peer_id,
                    },
                    bearer=self._mount_operator_token,
                    allow_error=True,
                )
                if revoke["_status"] not in {200, 404}:
                    errors.append(
                        "Relay mount cleanup returned "
                        f"status={revoke['_status']}"
                    )
            except Exception as error:
                errors.append(str(error))
        for tunnel in reversed(self._tunnels):
            try:
                tunnel.stop()
            except Exception as error:
                errors.append(str(error))
        self._tunnels.clear()
        for value in self._sensitive:
            for index in range(len(value)):
                value[index] = 0
            value.clear()
        self._sensitive.clear()
        self._probe_directory.cleanup()
        self._mount_operator_token = ""
        self._mount_station_peer_id = ""
        self._attached_existing_mount = False
        self._marker = ""
        self._closed = True
        return EphemeralHandlerCleanup(
            closed=not errors,
            secrets_zeroized=True,
        )

    def _remember_secret(self, value: str) -> str:
        self._sensitive.append(bytearray(value.encode("utf-8")))
        return value

    def _operator_token(self) -> str:
        from tooling.acceptance.provisioners.posix_service_runtime import (
            mint_posix_relay_operator_token,
        )

        token = mint_posix_relay_operator_token(
            self._relay_config,
            transport=self._relay_transport,
        )
        return self._remember_secret(token)

    def _create_invite(
        self,
        operator_token: str,
        station_peer_id: str,
    ) -> Mapping[str, object]:
        response = self._request_json(
            self._relay_url + "/api/v1/relay/invite",
            payload={
                "station_peer_id": station_peer_id,
                "label": "acceptance-opaque-tunnel",
                "max_clients": 2,
                "bandwidth_limit": 1048576,
                "expires_in": "5m",
            },
            bearer=operator_token,
        )
        secret = str(response.get("invite_token") or "")
        if not secret:
            raise GateError("Relay invite response omitted one-time secret")
        self._remember_secret(secret)
        return response

    def _request_json(
        self,
        url: str,
        *,
        method: str = "POST",
        payload: Mapping[str, object] | None = None,
        bearer: str = "",
        allow_error: bool = False,
    ) -> dict[str, Any]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Accept": "application/json",
                **(
                    {"Content-Type": "application/json"}
                    if data is not None
                    else {}
                ),
                **(
                    {"Authorization": "Bearer " + bearer}
                    if bearer
                    else {}
                ),
            },
        )
        try:
            with build_opener(ProxyHandler({})).open(
                request,
                timeout=15,
            ) as response:
                raw = response.read(_MAX_RESPONSE_BYTES)
                status = response.status
        except urllib.error.HTTPError as error:
            raw = error.read(_MAX_RESPONSE_BYTES)
            status = error.code
        if status >= 300 and not allow_error:
            raise GateError(
                f"Opaque tunnel fixture request failed with status={status}"
            )
        if allow_error:
            return {"_status": status}
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise GateError(
                "Opaque tunnel fixture response was not JSON"
            ) from error
        if not isinstance(value, dict):
            raise GateError(
                "Opaque tunnel fixture response must be an object"
            )
        return value

    def _ensure_probe_binary(self, deadline_monotonic: float) -> None:
        if self._probe_binary.exists():
            return
        remaining = max(1.0, deadline_monotonic - time.monotonic())
        completed = subprocess.run(
            [
                "go",
                "build",
                "-o",
                str(self._probe_binary),
                "./subserver/relay-client/cmd/acceptance-probe",
            ],
            cwd=REPO_ROOT / "apps/station/frame/core/plugin/native",
            capture_output=True,
            text=True,
            timeout=min(remaining, 120.0),
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise GateError(
                "Relay client mount probe build failed"
                + (f": {detail[-1000:]}" if detail else "")
            )

    def _ensure_mount(
        self,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> None:
        if getattr(self, "_attached_existing_mount", False):
            return
        process = self._mount_process
        if process is not None and process.poll() is None:
            return
        self._check_deadline(deadline_monotonic, cancellation)

        station_info = self._request_json(
            self._station_url + "/sub-bootstrap/info",
            method="GET",
        )
        station_data = station_info.get("data", station_info)
        station_peer_id = str(station_data.get("peer_id") or "")
        if not station_peer_id:
            raise GateError("Station identity endpoint returned no peer_id")
        operator_token = self._operator_token()
        listed = self._request_json(
            self._relay_url + "/api/v1/relay/mounts",
            method="GET",
            bearer=operator_token,
        )
        mounts = listed.get("mounts")
        if isinstance(mounts, list) and any(
            isinstance(mount, dict)
            and mount.get("station_peer_id") == station_peer_id
            and mount.get("status") == 1
            and not mount.get("revoked_at")
            for mount in mounts
        ):
            self._attached_existing_mount = True
            return

        self._ensure_probe_binary(deadline_monotonic)
        invite = self._create_invite(operator_token, station_peer_id)

        process = subprocess.Popen(
            [str(self._probe_binary)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._mount_process = process
        self._mount_operator_token = operator_token
        self._mount_station_peer_id = station_peer_id
        if process.stdin is None or process.stdout is None:
            raise GateError("Relay client mount probe pipes are unavailable")
        process.stdin.write(
            json.dumps(
                {
                    "relay_url": self._relay_public_url,
                    "relay_stream_addr": (
                        f"127.0.0.1:{self._stream_port}"
                    ),
                    "bootstrap_info_url": (
                        self._station_url + "/sub-bootstrap/info"
                    ),
                    "bootstrap_identity_url": (
                        self._station_url
                        + "/sub-bootstrap/station-identity"
                    ),
                    "invite_token": invite["invite_token"],
                    "token_store_path": str(self._probe_token_store),
                    "tls_ca_file": str(self._relay_ca_file),
                    "local_http_port": self._station_port,
                    "hold_until_eof": True,
                    "timeout_seconds": 30,
                },
                separators=(",", ":"),
            )
            + "\n"
        )
        process.stdin.flush()

        marker = "PT_RELAY_CLIENT_PROBE="
        while True:
            self._check_deadline(deadline_monotonic, cancellation)
            if process.poll() is not None:
                detail = ""
                if process.stderr is not None:
                    detail = process.stderr.read().strip()
                raise GateError(
                    "Relay client mount probe exited before readiness"
                    + (f": {detail[-1000:]}" if detail else "")
                )
            remaining = max(0.0, deadline_monotonic - time.monotonic())
            ready, _, _ = select.select(
                [process.stdout],
                [],
                [],
                min(remaining, 0.5),
            )
            if not ready:
                continue
            line = process.stdout.readline()
            if not line:
                continue
            if not line.startswith(marker):
                continue
            try:
                result = json.loads(line[len(marker) :])
            except json.JSONDecodeError as error:
                raise GateError(
                    "Relay client mount probe returned invalid evidence"
                ) from error
            if (
                not isinstance(result, dict)
                or result.get("status") != "running"
                or result.get("credential_cached") is not True
            ):
                raise GateError("Relay client mount probe did not become ready")
            return

    @staticmethod
    def _check_deadline(
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> None:
        if cancellation.is_set() or time.monotonic() >= deadline_monotonic:
            raise EphemeralCapabilityBlocked(
                "Opaque tunnel fixture deadline expired",
                resource=CAPABILITY_ID,
            )

    def _marker_absent_from_relay_log(self) -> bool:
        completed = self._relay_transport.run_argv(
            ["docker", "logs", self._relay_container_id],
            timeout=30,
            check=False,
        )
        logs = completed.stdout + "\n" + completed.stderr
        return completed.returncode == 0 and self._marker not in logs


class RelayOpaqueTunnelGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-REL-04"
    bom = ("SAL-REL-04-OPAQUE-TUNNEL",)
    spec = ("SAL-J06", "SAL-J07", "SAL-J09", "NCP-D03")

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
            "outer_relay_private_ca_validated": result.get(
                "outerRelayCAValidated"
            )
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
            "runtimeCell": "one-linux-relay",
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
