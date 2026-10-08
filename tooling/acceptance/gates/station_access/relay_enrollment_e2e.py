from __future__ import annotations

import base64
import concurrent.futures
import hashlib
import json
import os
import select
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Protocol
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
from tooling.scripts.deploy.windows_runtime import WindowsRuntimeConfig


GATE_ID = "relay-station-enrollment-e2e"
CAPABILITY_ID = "station-access.relay-enrollment-operator"
RUN_OPERATION = "run-lifecycle"
_MAX_RESPONSE_BYTES = 64 * 1024


class _RelayStream(Protocol):
    def sendall(self, data: bytes) -> None: ...

    def recv(self, size: int) -> bytes: ...

    def settimeout(self, timeout: float) -> None: ...

    def close(self) -> None: ...


class _OpenSSLRelayStream:
    def __init__(self, server_name: str, port: int) -> None:
        try:
            self._process = subprocess.Popen(
                [
                    "openssl",
                    "s_client",
                    "-quiet",
                    "-tls1_3",
                    "-connect",
                    f"127.0.0.1:{port}",
                    "-servername",
                    server_name,
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=0,
            )
        except OSError as error:
            raise GateError(
                "OpenSSL TLS 1.3 stream transport is unavailable"
            ) from error
        if self._process.stdin is None or self._process.stdout is None:
            self.close()
            raise GateError("OpenSSL TLS 1.3 stream transport is incomplete")
        self._timeout = 10.0

    def sendall(self, data: bytes) -> None:
        if self._process.poll() is not None or self._process.stdin is None:
            raise ConnectionError("OpenSSL TLS 1.3 stream is closed")
        try:
            self._process.stdin.write(data)
            self._process.stdin.flush()
        except (BrokenPipeError, OSError) as error:
            raise ConnectionError("OpenSSL TLS 1.3 stream write failed") from error

    def recv(self, size: int) -> bytes:
        if self._process.stdout is None:
            return b""
        ready, _, _ = select.select(
            [self._process.stdout],
            [],
            [],
            self._timeout,
        )
        if not ready:
            if self._process.poll() is not None:
                return b""
            raise socket.timeout
        return os.read(self._process.stdout.fileno(), size)

    def settimeout(self, timeout: float) -> None:
        self._timeout = timeout

    def close(self) -> None:
        process = getattr(self, "_process", None)
        if process is None:
            return
        if process.stdin is not None:
            try:
                process.stdin.close()
            except OSError:
                pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        if process.stdout is not None:
            process.stdout.close()


def validate_enrollment_source_contract() -> None:
    sources = {
        "domain": _read(
            "apps/station/frame/core/plugin/native/subserver/relay/domain/types.go"
        ),
        "service": _read(
            "apps/station/frame/core/plugin/native/subserver/relay/application/service.go"
        ),
        "credential": _read(
            "apps/station/frame/core/plugin/native/subserver/relay/application/credential.go"
        ),
        "repository": _read(
            "apps/station/frame/core/plugin/native/subserver/relay/infrastructure/repo.go"
        ),
        "handler": _read(
            "apps/station/frame/core/plugin/native/subserver/relay/handler_station.go"
        ),
        "relay": _read(
            "apps/station/frame/core/plugin/native/subserver/relay/relay.go"
        ),
        "client": _read(
            "apps/station/frame/core/plugin/native/subserver/relay-client/enrollment.go"
        ),
        "client_runtime": _read(
            "apps/station/frame/core/plugin/native/subserver/relay-client/subserver.go"
        ),
        "client_probe": _read(
            "apps/station/frame/core/plugin/native/subserver/relay-client/"
            "cmd/acceptance-probe/main.go"
        ),
    }
    required = {
        "domain": (
            "HostPublicKey",
            "Generation",
            "CredentialJTI",
            "MountStatusRevoked",
            "EnrollmentChallenge",
        ),
        "service": (
            "BeginEnrollmentChallenge",
            "VerifyStationIdentityProof",
            "ConsumeInviteAndActivateMount",
            "RotateCredential",
            "RevokeMount",
        ),
        "credential": (
            "jwt.SigningMethodEdDSA",
            "MountCredentialAudience",
            "ScopeMountConnect",
            "ScopeMountRotate",
        ),
        "repository": (
            "secret_digest",
            "ALTER TABLE relay_invite DROP COLUMN token",
            "credential_jti",
            "generation",
            "current.Generation + 1",
            "MountStatusRevoked",
        ),
        "handler": (
            "handleEnrollmentChallenge",
            "handleRotationChallenge",
            "StationIdentityProof",
        ),
        "relay": (
            "AuthenticateMountCredential",
            "ActivateMount",
            "AddValidated",
            "identity.Generation",
            "identity.ExpiresAt",
        ),
        "client": (
            "BootstrapIdentityURL",
            "loadCachedMountCredential",
            "loadInviteToken",
            "clearInviteToken",
            "ErrEnrollmentRequired",
            "plaintext Relay control is restricted to loopback",
            "Relay stream TLS is required",
        ),
        "client_runtime": (
            "server.StatusStarting",
            "ConnectionStateChanged",
            "CredentialRejected",
            "setMountReady",
        ),
        "client_probe": (
            "NewRelayClientSubServer",
            "server.StatusRunning",
            "CredentialCached",
        ),
    }
    for label, tokens in required.items():
        missing = [token for token in tokens if token not in sources[label]]
        if missing:
            raise GateError(
                f"{label} enrollment source is missing: {', '.join(missing)}"
            )
    forbidden = {
        "handler": ("X-Station-Peer-ID",),
        "credential": ("coreauth.Get().Secret", "SigningMethodHS256"),
    }
    for label, tokens in forbidden.items():
        present = [token for token in tokens if token in sources[label]]
        if present:
            raise GateError(
                f"{label} enrollment source contains forbidden paths: "
                + ", ".join(present)
            )


def _read(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


class RelayEnrollmentCapabilityHandler(EphemeralCapabilityHandler):
    def __init__(
        self,
        transport: SshTransport,
        station_config: WindowsRuntimeConfig,
        relay_config: WindowsRuntimeConfig,
    ) -> None:
        if relay_config.stream_port is None:
            raise ValueError("Relay stream port is required")
        self._transport = transport
        self._relay_config = relay_config
        self._sensitive: list[bytearray] = []
        self._closed = False
        self._tunnels: list[SshTunnel] = []
        self._probe_directory = tempfile.TemporaryDirectory(
            prefix="peers-touch-relay-client-probe-"
        )
        self._probe_binary = Path(self._probe_directory.name) / "probe"
        self._probe_token_store = (
            Path(self._probe_directory.name) / "mount-credential.json"
        )
        try:
            station = transport.start_local_forward(
                remote_port=station_config.http_port
            )
            self._tunnels.append(station)
            relay = transport.start_local_forward(
                remote_port=relay_config.http_port
            )
            self._tunnels.append(relay)
            stream = transport.start_local_forward(
                remote_port=relay_config.stream_port
            )
            self._tunnels.append(stream)
        except Exception:
            self.close()
            raise
        self._station_url = f"http://127.0.0.1:{station.local_port}"
        self._relay_url = f"http://127.0.0.1:{relay.local_port}"
        self._stream_port = stream.local_port

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return (RUN_OPERATION,)

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return tuple(
            value.decode("utf-8")
            for value in self._sensitive
            if value
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
                "Relay enrollment operator capability is unavailable",
                resource=CAPABILITY_ID,
            )
        return self._run_lifecycle(deadline_monotonic, cancellation)

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
        for value in self._sensitive:
            for index in range(len(value)):
                value[index] = 0
            value.clear()
        self._sensitive.clear()
        self._probe_directory.cleanup()
        self._closed = True
        return EphemeralHandlerCleanup(
            closed=not errors,
            secrets_zeroized=True,
        )

    def _remember_secret(self, value: str) -> str:
        self._sensitive.append(bytearray(value.encode("utf-8")))
        return value

    def _operator_token(self) -> str:
        script = r"""
import base64, hashlib, hmac, json, pathlib, sys, time
root = pathlib.Path.home() / sys.argv[1]
key = (root / "secrets" / "relay-operator.key").read_text(encoding="utf-8").strip().encode()
now = int(time.time())
header = {"alg": "HS256", "typ": "JWT"}
payload = {
    "iss": "peers-relay-operator",
    "sub": "operator:acceptance",
    "aud": ["peers-relay-admin"],
    "iat": now,
    "exp": now + 300,
    "scope": "relay.admin",
}
encode = lambda value: base64.urlsafe_b64encode(
    json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
).rstrip(b"=")
unsigned = encode(header) + b"." + encode(payload)
signature = base64.urlsafe_b64encode(
    hmac.new(key, unsigned, hashlib.sha256).digest()
).rstrip(b"=")
sys.stdout.write((unsigned + b"." + signature).decode())
"""
        completed = self._transport.run_argv(
            ["python", "-c", script, self._relay_config.runtime_path],
            timeout=15,
            check=True,
        )
        token = completed.stdout.strip()
        if token.count(".") != 2:
            raise EphemeralCapabilityBlocked(
                "Relay operator token minting failed",
                resource=CAPABILITY_ID,
            )
        return self._remember_secret(token)

    def _run_lifecycle(
        self,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        self._check_deadline(deadline_monotonic, cancellation)
        operator_token = self._operator_token()
        station_info = self._request_json(
            self._station_url + "/sub-bootstrap/info",
            method="GET",
        )
        station_data = station_info.get("data", station_info)
        station_peer_id = str(station_data.get("peer_id") or "")
        if not station_peer_id:
            raise GateError("Station identity endpoint returned no peer_id")

        first_invite = self._create_invite(operator_token, station_peer_id)
        first_credential = self._enroll(
            first_invite,
            label="acceptance-primary",
        )
        first_claims = self._credential_claims(first_credential["relay_token"])
        stream = self._open_stream(
            str(first_credential["relay_token"]),
            station_peer_id,
        )
        try:
            listed = self._request_json(
                self._relay_url + "/api/v1/relay/invites",
                method="GET",
                bearer=operator_token,
            )
            serialized_list = json.dumps(listed, sort_keys=True)
            invite_hidden = (
                str(first_invite["invite_token"]) not in serialized_list
                and '"token"' not in serialized_list
                and "secret_digest" not in serialized_list
            )

            rotation_challenge = self._request_json(
                self._relay_url
                + "/api/v1/relay/rotation/challenge",
                payload={},
                bearer=str(first_credential["relay_token"]),
            )
            rotation_proof = self._station_proof(rotation_challenge)
            rotated = self._request_json(
                self._relay_url + "/api/v1/relay/token/refresh",
                payload={"proof": rotation_proof},
                bearer=str(first_credential["relay_token"]),
            )
            rotated_claims = self._credential_claims(
                str(rotated["relay_token"])
            )
            old_after_rotate = self._request_status(
                self._relay_url + "/api/v1/relay/heartbeat",
                payload={},
                bearer=str(first_credential["relay_token"]),
            )
            new_after_rotate = self._request_status(
                self._relay_url + "/api/v1/relay/heartbeat",
                payload={},
                bearer=str(rotated["relay_token"]),
            )
            stream_closed_after_rotate = self._wait_for_stream_close(stream)
            stream.close()
            stream = self._open_stream(
                str(rotated["relay_token"]),
                station_peer_id,
            )

            revoke = self._request_json(
                self._relay_url + "/api/v1/relay/mount",
                method="DELETE",
                payload={"station_peer_id": station_peer_id},
                bearer=operator_token,
            )
            stream_closed = self._wait_for_stream_close(stream)
            revoked_refresh = self._request_status(
                self._relay_url + "/api/v1/relay/token/refresh",
                payload={"proof": {}},
                bearer=str(rotated["relay_token"]),
            )
            reconnect_rejected = not self._try_stream_handshake(
                str(rotated["relay_token"]),
                station_peer_id,
            )
        finally:
            stream.close()

        recovery_invite = self._create_invite(
            operator_token,
            station_peer_id,
        )
        recovered = self._enroll(
            recovery_invite,
            label="acceptance-recovery",
        )
        recovered_claims = self._credential_claims(
            str(recovered["relay_token"])
        )
        recovered_stream = self._open_stream(
            str(recovered["relay_token"]),
            station_peer_id,
        )
        recovered_stream.close()

        concurrent_invite = self._create_invite(
            operator_token,
            station_peer_id,
        )
        concurrent_challenges = [
            self._request_json(
                self._relay_url + "/api/v1/relay/enrollment/challenge",
                payload={
                    "invite_token": concurrent_invite["invite_token"],
                    "label": "acceptance-concurrent",
                },
            )
            for _ in range(2)
        ]
        concurrent_proofs = [
            self._station_proof(challenge)
            for challenge in concurrent_challenges
        ]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            concurrent_statuses = sorted(
                executor.map(
                    lambda proof: self._request_status(
                        self._relay_url + "/api/v1/relay/register",
                        payload={
                            "invite_token": concurrent_invite["invite_token"],
                            "proof": proof,
                        },
                        bearer="",
                    ),
                    concurrent_proofs,
                )
            )
        self._request_json(
            self._relay_url + "/api/v1/relay/mount",
            method="DELETE",
            payload={"station_peer_id": station_peer_id},
            bearer=operator_token,
        )

        relay_client_invite = self._create_invite(
            operator_token,
            station_peer_id,
        )
        relay_client_initial = self._run_relay_client_probe(
            str(relay_client_invite["invite_token"]),
            deadline_monotonic,
            cancellation,
        )
        self._request_json(
            self._relay_url + "/api/v1/relay/mount",
            method="DELETE",
            payload={"station_peer_id": station_peer_id},
            bearer=operator_token,
        )
        relay_client_recovery_invite = self._create_invite(
            operator_token,
            station_peer_id,
        )
        relay_client_recovered = self._run_relay_client_probe(
            str(relay_client_recovery_invite["invite_token"]),
            deadline_monotonic,
            cancellation,
        )
        self._request_json(
            self._relay_url + "/api/v1/relay/mount",
            method="DELETE",
            payload={"station_peer_id": station_peer_id},
            bearer=operator_token,
        )

        self._check_deadline(deadline_monotonic, cancellation)
        return {
            "stationPeerIdSha256": hashlib.sha256(
                station_peer_id.encode("utf-8")
            ).hexdigest(),
            "relayPeerIdSha256": hashlib.sha256(
                str(first_credential["relay_peer_id"]).encode("utf-8")
            ).hexdigest(),
            "invitePlaintextHidden": invite_hidden,
            "credentialAlgorithm": first_claims.get("_alg"),
            "credentialAudience": first_claims.get("aud"),
            "credentialScopes": first_claims.get("scope"),
            "credentialHasJti": bool(first_claims.get("jti")),
            "firstGeneration": int(first_credential["generation"]),
            "rotationGeneration": int(rotated["generation"]),
            "rotationChangedJti": (
                first_claims.get("jti") != rotated_claims.get("jti")
            ),
            "streamClosedAfterRotate": stream_closed_after_rotate,
            "oldCredentialAfterRotateStatus": old_after_rotate,
            "newCredentialAfterRotateStatus": new_after_rotate,
            "revokeStatus": revoke.get("status"),
            "streamClosedAfterRevoke": stream_closed,
            "reconnectRejectedAfterRevoke": reconnect_rejected,
            "revokedCredentialStatus": revoked_refresh,
            "recoveryGeneration": int(recovered["generation"]),
            "recoverySucceeded": True,
            "concurrentConsumeStatuses": concurrent_statuses,
            "relayClientInitialReady": (
                relay_client_initial.get("status") == "running"
                and relay_client_initial.get("credential_cached") is True
            ),
            "relayClientRecoveredReady": (
                relay_client_recovered.get("status") == "running"
                and relay_client_recovered.get("credential_cached") is True
            ),
        }

    def _run_relay_client_probe(
        self,
        invite_token: str,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        self._check_deadline(deadline_monotonic, cancellation)
        if not self._probe_binary.exists():
            remaining = max(1.0, deadline_monotonic - time.monotonic())
            completed = subprocess.run(
                [
                    "go",
                    "build",
                    "-o",
                    str(self._probe_binary),
                    "./subserver/relay-client/cmd/acceptance-probe",
                ],
                cwd=(
                    REPO_ROOT
                    / "apps/station/frame/core/plugin/native"
                ),
                capture_output=True,
                text=True,
                timeout=min(remaining, 120.0),
                check=False,
            )
            if completed.returncode != 0:
                raise GateError("Relay client probe build failed")

        remaining = max(1.0, deadline_monotonic - time.monotonic())
        completed = subprocess.run(
            [str(self._probe_binary)],
            input=json.dumps(
                {
                    "relay_url": self._relay_url,
                    "relay_stream_addr": f"127.0.0.1:{self._stream_port}",
                    "bootstrap_info_url": (
                        self._station_url + "/sub-bootstrap/info"
                    ),
                    "bootstrap_identity_url": (
                        self._station_url
                        + "/sub-bootstrap/station-identity"
                    ),
                    "invite_token": invite_token,
                    "token_store_path": str(self._probe_token_store),
                    "timeout_seconds": 30,
                },
                separators=(",", ":"),
            ),
            capture_output=True,
            text=True,
            timeout=min(remaining, 45.0),
            check=False,
        )
        if completed.returncode != 0:
            raise GateError("Relay client readiness probe failed")
        marker = "PT_RELAY_CLIENT_PROBE="
        encoded = next(
            (
                line[len(marker):]
                for line in completed.stdout.splitlines()
                if line.startswith(marker)
            ),
            "",
        )
        try:
            result = json.loads(encoded)
        except json.JSONDecodeError as error:
            raise GateError(
                "Relay client readiness probe returned invalid evidence"
            ) from error
        if not isinstance(result, dict):
            raise GateError(
                "Relay client readiness probe result must be an object"
            )
        return result

    def _create_invite(
        self,
        operator_token: str,
        station_peer_id: str,
    ) -> Mapping[str, object]:
        response = self._request_json(
            self._relay_url + "/api/v1/relay/invite",
            payload={
                "station_peer_id": station_peer_id,
                "label": "acceptance",
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

    def _enroll(
        self,
        invite: Mapping[str, object],
        *,
        label: str,
    ) -> Mapping[str, object]:
        invite_token = str(invite.get("invite_token") or "")
        challenge = self._request_json(
            self._relay_url + "/api/v1/relay/enrollment/challenge",
            payload={"invite_token": invite_token, "label": label},
        )
        proof = self._station_proof(challenge)
        credential = self._request_json(
            self._relay_url + "/api/v1/relay/register",
            payload={"invite_token": invite_token, "proof": proof},
        )
        token = str(credential.get("relay_token") or "")
        if not token:
            raise GateError("Relay registration omitted mount credential")
        self._remember_secret(token)
        return credential

    def _station_proof(
        self,
        challenge: Mapping[str, object],
    ) -> Mapping[str, object]:
        encoded = str(challenge.get("challenge") or "")
        challenge_id = str(challenge.get("challenge_id") or "")
        if not encoded or not challenge_id:
            raise GateError("Relay challenge response is incomplete")
        return {
            "challenge_id": challenge_id,
            **self._request_json(
                self._station_url + "/sub-bootstrap/station-identity",
                payload={"challenge": encoded},
            ),
        }

    def _request_status(
        self,
        url: str,
        *,
        payload: Mapping[str, object],
        bearer: str,
    ) -> int:
        return self._request_json(
            url,
            payload=payload,
            bearer=bearer,
            allow_error=True,
        )["_status"]

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
            raise GateError(f"Relay lifecycle request failed with status={status}")
        if allow_error:
            return {"_status": status}
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise GateError("Relay lifecycle response was not JSON") from error
        if not isinstance(value, dict):
            raise GateError("Relay lifecycle response must be an object")
        return value

    def _open_stream(
        self,
        token: str,
        station_peer_id: str,
    ) -> _RelayStream:
        stream: _RelayStream
        context: ssl.SSLContext | None = None
        if ssl.HAS_TLSv1_3:
            try:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE
                context.minimum_version = ssl.TLSVersion.TLSv1_3
                context.maximum_version = ssl.TLSVersion.TLSv1_3
            except (ValueError, ssl.SSLError):
                context = None
        if context is None:
            stream = _OpenSSLRelayStream(
                self._relay_config.host,
                self._stream_port,
            )
        else:
            raw = socket.create_connection(
                ("127.0.0.1", self._stream_port),
                timeout=10,
            )
            try:
                stream = context.wrap_socket(
                    raw,
                    server_hostname=self._relay_config.host,
                )
            except BaseException:
                raw.close()
                raise
        try:
            stream.settimeout(10)
            stream.sendall(
                json.dumps(
                    {
                        "relay_token": token,
                        "station_peer_id": station_peer_id,
                    },
                    separators=(",", ":"),
                ).encode("utf-8")
                + b"\n"
            )
            acknowledgement = json.loads(
                self._read_line(stream).decode("utf-8")
            )
            if acknowledgement.get("ok") is not True:
                raise GateError("Relay stream handshake rejected a valid mount")
        except BaseException:
            stream.close()
            raise
        return stream

    def _try_stream_handshake(
        self,
        token: str,
        station_peer_id: str,
    ) -> bool:
        try:
            stream = self._open_stream(token, station_peer_id)
        except GateError:
            return False
        stream.close()
        return True

    @staticmethod
    def _read_line(stream: _RelayStream) -> bytes:
        output = bytearray()
        while len(output) < 4096:
            chunk = stream.recv(1)
            if not chunk:
                break
            if chunk == b"\n":
                return bytes(output)
            output.extend(chunk)
        raise GateError("Relay stream returned an invalid handshake response")

    @staticmethod
    def _wait_for_stream_close(stream: _RelayStream) -> bool:
        stream.settimeout(5)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                if not stream.recv(4096):
                    return True
            except socket.timeout:
                return False
            except ssl.SSLWantReadError:
                continue
            except (ConnectionError, ssl.SSLError):
                return True
        return False

    @staticmethod
    def _credential_claims(token: object) -> dict[str, Any]:
        parts = str(token).split(".")
        if len(parts) != 3:
            raise GateError("Relay credential is not a JWT")
        try:
            header = json.loads(_decode_base64url(parts[0]))
            claims = json.loads(_decode_base64url(parts[1]))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise GateError("Relay credential claims are invalid") from error
        if not isinstance(header, dict) or not isinstance(claims, dict):
            raise GateError("Relay credential claims must be objects")
        claims["_alg"] = header.get("alg")
        return claims

    @staticmethod
    def _check_deadline(
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> None:
        if cancellation.is_set() or time.monotonic() >= deadline_monotonic:
            raise EphemeralCapabilityBlocked(
                "Relay enrollment lifecycle deadline expired",
                resource=CAPABILITY_ID,
            )


class RelayEnrollmentGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-REL-02"
    bom = ("SAL-REL-02-STATION-ENROLLMENT",)
    spec = ("SAL-J08", "SAL-D10", "D-13")

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

    def run(self) -> dict[str, Any]:
        validate_enrollment_source_contract()
        result = dict(
            self.capability_client.invoke(
                CAPABILITY_ID,
                RUN_OPERATION,
                {},
                timeout_seconds=240,
            )
        )
        expected_scopes = {
            "relay.mount.connect",
            "relay.mount.rotate",
            "relay.route.publish",
            "relay.peer.tunnel",
        }
        audience = result.get("credentialAudience")
        if isinstance(audience, str):
            audience = [audience]
        assertions = {
            "invite_plaintext_hidden": result.get("invitePlaintextHidden")
            is True,
            "credential_is_asymmetric": result.get("credentialAlgorithm")
            == "EdDSA",
            "credential_audience_bound": audience
            == ["peers-touch-relay-mount"],
            "credential_scope_bound": set(
                result.get("credentialScopes") or ()
            )
            == expected_scopes,
            "credential_has_jti": result.get("credentialHasJti") is True,
            "rotation_advances_generation": result.get("rotationGeneration")
            == int(result.get("firstGeneration") or 0) + 1,
            "rotation_changes_jti": result.get("rotationChangedJti") is True,
            "rotation_closes_stale_stream": result.get(
                "streamClosedAfterRotate"
            )
            is True,
            "old_credential_rejected": result.get(
                "oldCredentialAfterRotateStatus"
            )
            == 401,
            "rotated_credential_accepted": result.get(
                "newCredentialAfterRotateStatus"
            )
            == 200,
            "revoke_closes_stream": result.get("streamClosedAfterRevoke")
            is True,
            "revoke_rejects_reconnect": result.get(
                "reconnectRejectedAfterRevoke"
            )
            is True,
            "revoke_rejects_refresh": result.get("revokedCredentialStatus")
            == 401,
            "new_invite_recovers_mount": result.get("recoverySucceeded")
            is True
            and int(result.get("recoveryGeneration") or 0)
            > int(result.get("rotationGeneration") or 0),
            "concurrent_consume_has_one_winner": result.get(
                "concurrentConsumeStatuses"
            )
            == [200, 403],
            "relay_client_initial_readiness": result.get(
                "relayClientInitialReady"
            )
            is True,
            "relay_client_recovers_after_revocation": result.get(
                "relayClientRecoveredReady"
            )
            is True,
        }
        for name, passed in assertions.items():
            self.assert_condition(name, passed)
        return {
            "sourceContract": "passed",
            "runtimeCell": "sixwin-station-relay",
            "stationPeerIdSha256": result.get("stationPeerIdSha256"),
            "relayPeerIdSha256": result.get("relayPeerIdSha256"),
            "assertions": assertions,
        }


def _decode_base64url(value: str) -> str:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + padding).decode("utf-8")


def _required_environment(name: str) -> str:
    import os

    value = os.environ.get(name, "").strip()
    if not value:
        raise GateError(f"{name} is required")
    return value


def main() -> int:
    capability_client = EphemeralGateClient.from_environment()
    if capability_client is None:
        raise GateError("Relay enrollment operator capability is required")
    with capability_client:
        return RelayEnrollmentGate(capability_client).execute()


if __name__ == "__main__":
    raise SystemExit(main())
