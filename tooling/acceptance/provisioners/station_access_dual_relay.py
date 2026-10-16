from __future__ import annotations

import base64
import dataclasses
import hashlib
import hmac
import json
import re
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    EphemeralCapabilityBlocked,
    EphemeralCapabilityHandler,
    EphemeralGateLaunchContext,
    EphemeralHandlerCleanup,
)
from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.attestation import (
    persist_service_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ProvisioningState,
    RuntimeManifest,
    ServiceAttestation,
    utc_now,
)
from tooling.acceptance.provisioners.posix_service_runtime import (
    PosixServiceRuntimeConfig,
)
from tooling.acceptance.transports.ssh import SshTransport
from tooling.scripts.deploy.posix_relay_runtime import prepare as prepare_relay


GATE_ID = "RAL-G01"
ENVIRONMENT_ID = "station-access-dual-relay"
CAPABILITY_ID = "station-access.dual-relay-control"
COMPOSE_RELATIVE_PATH = (
    "tooling/acceptance/runtime/station-access-dual-relay.compose.yml"
)
SOURCE_ARCHIVE_NAME = "source.tar.gz"
PROJECT_PREFIX = "pt-ral-"
REMOTE_ROOT_PREFIX = "peers-touch/acceptance/ral-"
SAFE_RUN_ID = re.compile(r"^[0-9a-f]{16}$")
RELAY_IDS = ("relay-a", "relay-b")
RELAY_SERVICES = {
    "relay-a": "relay-a",
    "relay-b": "relay-b",
}
RELAY_POSTGRES_SERVICES = {
    "relay-a": "relay-a-postgres",
    "relay-b": "relay-b-postgres",
}
ALLOWED_OPERATIONS = (
    "initial-state",
    "active-invite-delete",
    "target-mismatch",
    "attach-relay",
    "attachments",
    "relay-state",
    "station-restart",
    "delete-attachment",
    "retry-attachment",
    "delete-consumed-invites",
    "durable-state",
)


def _mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ProvisioningError(f"{label} must be an object")
    return dict(value)


def _source_archive(destination: Path) -> str:
    completed = subprocess.run(
        (
            "git",
            "archive",
            "--format=tar.gz",
            f"--output={destination}",
            "HEAD",
        ),
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if completed.returncode != 0 or not destination.is_file():
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise ProvisioningError(
            f"exact-source archive failed: {detail or completed.returncode}"
        )
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def _wait_json(
    url: str,
    *,
    ca_pem: bytes | None = None,
    timeout_seconds: float = 180,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            return _request_json(
                url,
                method="GET",
                ca_pem=ca_pem,
                timeout_seconds=5,
            )[1]
        except Exception as error:  # noqa: BLE001
            last_error = error
            time.sleep(1)
    raise ProvisioningError(f"service did not become ready at {url}: {last_error}")


def _request_json(
    url: str,
    *,
    method: str,
    body: Mapping[str, object] | None = None,
    token: str = "",
    ca_pem: bytes | None = None,
    timeout_seconds: float = 15,
) -> tuple[int, dict[str, Any]]:
    headers = {"Accept": "application/json"}
    payload: bytes | None = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(dict(body), separators=(",", ":")).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        url,
        data=payload,
        headers=headers,
        method=method,
    )
    context: ssl.SSLContext | None = None
    if ca_pem is not None:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        context.load_verify_locations(cadata=ca_pem.decode("ascii"))
    try:
        with urllib.request.urlopen(
            request,
            context=context,
            timeout=timeout_seconds,
        ) as response:
            raw = response.read(1 << 20)
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read(1 << 20)
        status = error.code
    try:
        value = json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProvisioningError(
            f"endpoint returned invalid JSON: {url}"
        ) from error
    if not isinstance(value, dict):
        raise ProvisioningError(f"endpoint returned no object: {url}")
    data = value.get("data")
    return status, dict(data) if isinstance(data, Mapping) else value


def _operator_token(key: bytes) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": "peers-relay-operator",
        "sub": "operator:acceptance",
        "aud": ["peers-relay-admin"],
        "iat": now,
        "exp": now + 900,
        "scope": "relay.admin",
    }

    def encode(value: Mapping[str, object]) -> bytes:
        return base64.urlsafe_b64encode(
            json.dumps(
                dict(value),
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        ).rstrip(b"=")

    unsigned = encode(header) + b"." + encode(payload)
    signature = base64.urlsafe_b64encode(
        hmac.new(key.strip(), unsigned, hashlib.sha256).digest()
    ).rstrip(b"=")
    return (unsigned + b"." + signature).decode("ascii")


def _zeroize(value: bytearray) -> None:
    for index in range(len(value)):
        value[index] = 0
    value.clear()


class DualRelayControlHandler(EphemeralCapabilityHandler):
    def __init__(
        self,
        *,
        transport: SshTransport,
        project: str,
        station_url: str,
        relay_urls: Mapping[str, str],
        relay_cas: Mapping[str, bytes],
        relay_peer_ids: Mapping[str, str],
        container_ids: Mapping[str, str],
        source_commit: str,
        fixture_epoch: str,
    ) -> None:
        self._transport = transport
        self._project = project
        self._station_url = station_url.rstrip("/")
        self._relay_urls = dict(relay_urls)
        self._relay_cas = dict(relay_cas)
        self._relay_peer_ids = dict(relay_peer_ids)
        self._container_ids = dict(container_ids)
        self._source_commit = source_commit
        self._fixture_epoch = fixture_epoch
        self._operator_tokens: dict[str, bytearray] = {}
        self._dashboard_token = bytearray()
        self._invitation_secrets: list[bytearray] = []
        self._consumed_invite_ids: dict[str, str] = {}
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return ALLOWED_OPERATIONS

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        values = [
            value.decode("utf-8")
            for value in (
                *self._operator_tokens.values(),
                self._dashboard_token,
                *self._invitation_secrets,
            )
            if value
        ]
        return tuple(values)

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        self._require_available(operation, deadline_monotonic, cancellation)
        if operation == "initial-state":
            attachments = self._attachments()
            invites = {
                relay: self._relay_request(
                    relay,
                    "GET",
                    "/api/v1/relay/invites",
                )[1].get("invites", [])
                for relay in RELAY_IDS
            }
            return {
                "fixtureEpoch": self._fixture_epoch,
                "sourceCommit": self._source_commit,
                "attachments": attachments,
                "ownedActiveInviteCounts": {
                    relay: sum(
                        isinstance(item, Mapping)
                        and str(item.get("label") or "").startswith(
                            f"{self._fixture_epoch}-"
                        )
                        and int(item.get("status") or 0) == 1
                        for item in values
                    )
                    for relay, values in invites.items()
                    if isinstance(values, list)
                },
            }
        if operation == "active-invite-delete":
            relay = self._relay(payload)
            created = self._create_invite(relay, suffix="active-delete")
            status, result = self._relay_request(
                relay,
                "DELETE",
                "/api/v1/relay/invite",
                {"invite_id": created["inviteId"]},
            )
            return {
                "relay": relay,
                "inviteId": created["inviteId"],
                "status": status,
                "result": result,
            }
        if operation == "target-mismatch":
            relay = self._relay(payload)
            created = self._create_invite(
                relay,
                suffix="wrong-station",
                station_peer_id="12D3KooWQnYwTWm5Yw7jQD4qMskv4g3Yp1sLr7xwzVJ7LrBad111",
            )
            status, result = self._dashboard_request(
                "POST",
                "/dashboard/api/relay/attachments",
                created["invitation"],
            )
            self._relay_request(
                relay,
                "DELETE",
                "/api/v1/relay/invite",
                {"invite_id": created["inviteId"]},
            )
            return {
                "relay": relay,
                "status": status,
                "error": str(result.get("error") or result.get("message") or ""),
            }
        if operation == "attach-relay":
            relay = self._relay(payload)
            created = self._create_invite(relay, suffix="attachment")
            status, attachment = self._dashboard_request(
                "POST",
                "/dashboard/api/relay/attachments",
                created["invitation"],
            )
            if status != 200:
                raise ProvisioningError(
                    f"Station rejected {relay} invitation with HTTP {status}"
                )
            self._consumed_invite_ids[relay] = created["inviteId"]
            return {
                "relay": relay,
                "inviteId": created["inviteId"],
                "relayPeerId": self._relay_peer_ids[relay],
                "response": attachment,
            }
        if operation == "attachments":
            return {"items": self._attachments()}
        if operation == "relay-state":
            relay = self._relay(payload)
            action = str(payload.get("action") or "")
            if action not in {"stop", "start"}:
                raise ProvisioningError("Relay state action is invalid")
            return self._set_container_state(relay, action)
        if operation == "station-restart":
            before = self._container_started_at("station")
            self._docker("restart", self._container_ids["station"], timeout=60)
            health = _wait_json(
                self._station_url + "/sub-oss/healthz",
                timeout_seconds=180,
            )
            self._dashboard_login()
            after = self._container_started_at("station")
            return {
                "containerId": self._container_ids["station"],
                "startedAtBefore": before,
                "startedAtAfter": after,
                "restarted": bool(before and after and before != after),
                "health": health,
            }
        if operation == "delete-attachment":
            relay = self._relay(payload)
            return self._attachment_mutation(relay, "DELETE", "")
        if operation == "retry-attachment":
            relay = self._relay(payload)
            return self._attachment_mutation(relay, "POST", "/retry")
        if operation == "delete-consumed-invites":
            results = {}
            for relay in RELAY_IDS:
                invite_id = self._consumed_invite_ids.get(relay, "")
                if not invite_id:
                    raise ProvisioningError(
                        f"{relay} consumed invitation identity is unavailable"
                    )
                status, body = self._relay_request(
                    relay,
                    "DELETE",
                    "/api/v1/relay/invite",
                    {"invite_id": invite_id},
                )
                results[relay] = {
                    "inviteId": invite_id,
                    "status": status,
                    "error": str(
                        body.get("error") or body.get("message") or ""
                    ),
                }
            return results
        if operation == "durable-state":
            return {
                relay: self._relay_database_snapshot(relay)
                for relay in RELAY_IDS
            }
        raise ProvisioningError(f"unsupported dual-Relay operation: {operation}")

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        del operation
        encoded = json.dumps(dict(response), sort_keys=True)
        if any(secret and secret in encoded for secret in self.sensitive_values):
            raise EphemeralCapabilityBlocked(
                "dual-Relay response contained secret material",
                resource=CAPABILITY_ID,
            )
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason, deadline_monotonic
        self._close_secrets()
        return True

    def close(self) -> EphemeralHandlerCleanup:
        self._close_secrets()
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)

    def _close_secrets(self) -> None:
        for token in self._operator_tokens.values():
            _zeroize(token)
        self._operator_tokens.clear()
        _zeroize(self._dashboard_token)
        for secret in self._invitation_secrets:
            _zeroize(secret)
        self._invitation_secrets.clear()
        self._closed = True

    def _require_available(
        self,
        operation: str,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> None:
        if (
            self._closed
            or operation not in ALLOWED_OPERATIONS
            or cancellation.is_set()
            or time.monotonic() >= deadline_monotonic
        ):
            raise EphemeralCapabilityBlocked(
                "dual-Relay control is unavailable",
                resource=CAPABILITY_ID,
            )

    @staticmethod
    def _relay(payload: Mapping[str, object]) -> str:
        relay = str(payload.get("relay") or "")
        if relay not in RELAY_IDS:
            raise ProvisioningError("Relay target is invalid")
        return relay

    def _operator_token(self, relay: str) -> str:
        cached = self._operator_tokens.get(relay)
        if cached:
            return cached.decode("utf-8")
        container = self._container_ids[relay]
        completed = self._transport.run_argv(
            (
                "docker",
                "exec",
                container,
                "cat",
                "/app/relay-secrets/relay-operator.key",
            ),
            timeout=15,
            check=True,
        )
        key = bytearray(completed.stdout.encode("utf-8"))
        try:
            token = _operator_token(bytes(key))
        finally:
            _zeroize(key)
        stored = bytearray(token.encode("ascii"))
        self._operator_tokens[relay] = stored
        return token

    def _dashboard_login(self) -> str:
        status, result = _request_json(
            self._station_url + "/dashboard/api/auth/login",
            method="POST",
            body={"username": "peers", "password": "peers"},
        )
        token = str(result.get("token") or "")
        if status != 200 or token.count(".") != 2:
            raise ProvisioningError("Station Dashboard login failed")
        _zeroize(self._dashboard_token)
        self._dashboard_token = bytearray(token.encode("utf-8"))
        return token

    def _dashboard_request(
        self,
        method: str,
        path: str,
        body: Mapping[str, object] | None = None,
    ) -> tuple[int, dict[str, Any]]:
        token = (
            self._dashboard_token.decode("utf-8")
            if self._dashboard_token
            else self._dashboard_login()
        )
        status, result = _request_json(
            self._station_url + path,
            method=method,
            body=body,
            token=token,
        )
        if status == 401:
            status, result = _request_json(
                self._station_url + path,
                method=method,
                body=body,
                token=self._dashboard_login(),
            )
        return status, result

    def _relay_request(
        self,
        relay: str,
        method: str,
        path: str,
        body: Mapping[str, object] | None = None,
    ) -> tuple[int, dict[str, Any]]:
        return _request_json(
            self._relay_urls[relay] + path,
            method=method,
            body=body,
            token=self._operator_token(relay),
            ca_pem=self._relay_cas[relay],
        )

    def _create_invite(
        self,
        relay: str,
        *,
        suffix: str,
        station_peer_id: str = "",
    ) -> dict[str, Any]:
        status, result = self._relay_request(
            relay,
            "POST",
            "/api/v1/relay/invite",
            {
                "station_peer_id": station_peer_id,
                "label": f"{self._fixture_epoch}-{relay}-{suffix}",
                "max_clients": 8,
                "bandwidth_limit": 1 << 30,
            },
        )
        invitation = _mapping(result.get("invitation"), "Relay invitation")
        invite_id = str(result.get("invite_id") or "")
        invite_secret = str(invitation.get("invite_token") or "")
        if (
            status != 200
            or not invite_id.isdecimal()
            or invitation.get("relay_peer_id") != self._relay_peer_ids[relay]
            or not invite_secret
        ):
            raise ProvisioningError(f"{relay} invitation response is invalid")
        self._invitation_secrets.append(
            bytearray(invite_secret.encode("utf-8"))
        )
        return {
            "inviteId": invite_id,
            "invitation": invitation,
        }

    def _attachments(self) -> list[dict[str, Any]]:
        status, result = self._dashboard_request(
            "GET",
            "/dashboard/api/relay/attachments",
        )
        items = result.get("items")
        if status != 200 or not isinstance(items, list) or any(
            not isinstance(item, Mapping) for item in items
        ):
            raise ProvisioningError("Station attachment projection is invalid")
        return [dict(item) for item in items]

    def _attachment_mutation(
        self,
        relay: str,
        method: str,
        suffix: str,
    ) -> dict[str, Any]:
        relay_peer_id = self._relay_peer_ids[relay]
        status, result = self._dashboard_request(
            method,
            (
                "/dashboard/api/relay/attachments/"
                + urllib.parse.quote(relay_peer_id, safe="")
                + suffix
            ),
            {} if method == "POST" else None,
        )
        return {
            "relay": relay,
            "relayPeerId": relay_peer_id,
            "status": status,
            "response": result,
        }

    def _set_container_state(self, relay: str, action: str) -> dict[str, Any]:
        container = self._container_ids[relay]
        proxy = self._container_ids[f"{relay}-proxy"]
        if action == "stop":
            self._docker(
                "stop",
                "--time",
                "5",
                proxy,
                container,
                timeout=30,
            )
            health = "stopped"
        else:
            self._docker("start", container, proxy, timeout=30)
            health_payload = _wait_json(
                self._relay_urls[relay] + "/healthz",
                ca_pem=self._relay_cas[relay],
                timeout_seconds=180,
            )
            health = str(health_payload.get("status") or "")
        previous = self._operator_tokens.pop(relay, None)
        if previous is not None:
            _zeroize(previous)
        return {
            "relay": relay,
            "containerId": container,
            "action": action,
            "health": health,
        }

    def _container_started_at(self, service: str) -> str:
        completed = self._transport.run_argv(
            (
                "docker",
                "inspect",
                "--format",
                "{{.State.StartedAt}}",
                self._container_ids[service],
            ),
            timeout=15,
            check=True,
        )
        return completed.stdout.strip()

    def _docker(self, *arguments: str, timeout: float) -> str:
        completed = self._transport.run_argv(
            ("docker", *arguments),
            timeout=timeout,
            check=True,
        )
        return completed.stdout.strip()

    def _relay_database_snapshot(self, relay: str) -> dict[str, Any]:
        container = self._container_ids[RELAY_POSTGRES_SERVICES[relay]]
        query = (
            "SELECT coalesce(json_agg(row_to_json(rows)), '[]') FROM ("
            "SELECT station_peer_id, node_peer_id, status, generation, "
            "invite_id, revoked_at IS NOT NULL AS revoked "
            "FROM relay_enrollment ORDER BY generation, id) rows"
        )
        completed = self._transport.run_argv(
            (
                "docker",
                "exec",
                container,
                "sh",
                "-lc",
                (
                    "psql -At -v ON_ERROR_STOP=1 "
                    "-U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" "
                    f"-c {json.dumps(query)}"
                ),
            ),
            timeout=30,
            check=True,
        )
        try:
            enrollments = json.loads(completed.stdout.strip())
        except json.JSONDecodeError as error:
            raise ProvisioningError(
                f"{relay} enrollment readback is invalid"
            ) from error
        if not isinstance(enrollments, list):
            raise ProvisioningError(
                f"{relay} enrollment readback is not an array"
            )
        return {"enrollments": enrollments}


class StationAccessDualRelayProvisioner(EnvironmentProvisioner):
    environment_id = ENVIRONMENT_ID

    def __init__(self, contract) -> None:
        super().__init__(contract)
        self._transport: SshTransport | None = None
        self._project = ""
        self._remote_root = ""
        self._compose_environment: dict[str, str] = {}
        self._relay_env_file = ""
        self._handler: DualRelayControlHandler | None = None

    @staticmethod
    def _compose_argv(
        remote_root: str,
        relay_env_file: str,
        environment: Mapping[str, str],
        *arguments: str,
    ) -> tuple[str, ...]:
        return (
            "env",
            *(f"{key}={value}" for key, value in sorted(environment.items())),
            "docker",
            "compose",
            "--project-directory",
            remote_root,
            "--env-file",
            relay_env_file,
            "-f",
            f"{remote_root}/{COMPOSE_RELATIVE_PATH}",
            *arguments,
        )

    def _run_remote(
        self,
        argv: Sequence[str],
        *,
        timeout: float,
    ) -> str:
        if self._transport is None:
            raise ProvisioningError("dual-Relay transport is unavailable")
        completed = self._transport.run_argv(
            argv,
            timeout=timeout,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise ProvisioningError(
                f"dual-Relay remote command failed: {detail[-4000:]}"
            )
        return completed.stdout.strip()

    def _container_ids(self) -> dict[str, str]:
        services = (
            "station",
            "station-postgres",
            "relay-a",
            "relay-a-proxy",
            "relay-a-postgres",
            "relay-b",
            "relay-b-proxy",
            "relay-b-postgres",
        )
        result: dict[str, str] = {}
        for service in services:
            container = self._run_remote(
                self._compose_argv(
                    self._remote_root,
                    self._relay_env_file,
                    self._compose_environment,
                    "ps",
                    "-q",
                    service,
                ),
                timeout=30,
            )
            if not container or "\n" in container:
                raise ProvisioningError(
                    f"dual-Relay service {service} has invalid container identity"
                )
            result[service] = container
        return result

    def _verify_runtime_image(
        self,
        container_ids: Mapping[str, str],
        source_commit: str,
    ) -> str:
        image = f"{self._project}-runtime"
        raw = self._run_remote(
            ("docker", "image", "inspect", image),
            timeout=30,
        )
        try:
            inspected = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ProvisioningError(
                "dual-Relay runtime image inspection is invalid"
            ) from error
        if (
            not isinstance(inspected, list)
            or len(inspected) != 1
            or not isinstance(inspected[0], Mapping)
        ):
            raise ProvisioningError(
                "dual-Relay runtime image inspection is incomplete"
            )
        image_id = str(inspected[0].get("Id") or "")
        config = inspected[0].get("Config")
        labels = (
            config.get("Labels")
            if isinstance(config, Mapping)
            else None
        )
        if (
            not image_id
            or not isinstance(labels, Mapping)
            or labels.get("org.opencontainers.image.revision")
            != source_commit
        ):
            raise ProvisioningError(
                "dual-Relay runtime image is not bound to exact source"
            )
        for service in ("station", "relay-a", "relay-b"):
            observed = self._run_remote(
                (
                    "docker",
                    "inspect",
                    "--format",
                    "{{.Image}}",
                    container_ids[service],
                ),
                timeout=15,
            )
            if observed != image_id:
                raise ProvisioningError(
                    f"dual-Relay service {service} uses an unexpected image"
                )
        return image_id

    def _cleanup_runtime_paths(self, paths: tuple[str, ...]) -> None:
        if self._transport is None or not paths:
            return
        self._transport.run_argv(
            ("rm", "-rf", "--", *paths),
            timeout=60,
            check=True,
        )

    def _cleanup_remote(self, runtime_paths: tuple[str, ...]) -> None:
        if self._transport is None or not self._remote_root:
            return
        failures: list[str] = []
        try:
            self._transport.run_argv(
                self._compose_argv(
                    self._remote_root,
                    self._relay_env_file,
                    self._compose_environment,
                    "down",
                    "--volumes",
                    "--remove-orphans",
                    "--timeout",
                    "10",
                ),
                timeout=180,
                check=True,
            )
        except Exception as error:
            failures.append(f"compose down: {error}")
        image = str(self._compose_environment.get("PT_RAL_RUNTIME_IMAGE") or "")
        if image != f"{self._project}-runtime":
            failures.append("runtime image identity is invalid")
        else:
            completed = self._transport.run_argv(
                ("docker", "image", "rm", image),
                timeout=180,
                check=False,
            )
            detail = completed.stderr.strip() or completed.stdout.strip()
            if completed.returncode != 0 and "No such image" not in detail:
                failures.append(f"image cleanup: {detail[-1000:]}")
        try:
            self._transport.run_argv(
                ("rm", "-rf", "--", self._remote_root, *runtime_paths),
                timeout=60,
                check=True,
            )
        except Exception as error:
            failures.append(f"runtime cleanup: {error}")
        if failures:
            raise RuntimeError("; ".join(failures))

    def create_gate_launch_context(
        self,
        *,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
        required_capabilities: tuple[str, ...],
    ) -> EphemeralGateLaunchContext:
        if (
            gate_id != GATE_ID
            or required_capabilities != (CAPABILITY_ID,)
            or self._manifest is None
            or not self._manifest.is_ready()
            or self._handler is None
            or evidence_run_id != self.evidence_run.run_id
            or provisioning_run_id != self._manifest.run_id
        ):
            raise BlockedError(
                reason="dual-Relay launch context identity is incomplete",
                resource=f"ephemeral-capabilities:{gate_id}",
            )
        context = EphemeralGateLaunchContext(
            required_capabilities=required_capabilities,
            request_timeout_seconds=240,
            quiesce_timeout_seconds=15,
        )
        context.register_capability(CAPABILITY_ID, self._handler)
        return context

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id != GATE_ID:
                raise BlockedError(
                    reason=f"{self.environment_id} does not support {gate_id}",
                    resource=f"gate-environment:{gate_id}",
                )
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            if manifest.workspace_digest != "clean":
                raise BlockedError(
                    reason="dual-Relay proof requires a clean exact-source worktree",
                    resource="source-identity:workspace",
                )
            relay_deployment = str(
                profile_env.get("PT_RELAY_DEPLOY_ENV") or ""
            ).strip()
            if (
                profile_env.get("PT_RELAY_MODE") != "remote"
                or not relay_deployment
            ):
                raise BlockedError(
                    reason="dual-Relay proof requires a reviewed remote Relay host",
                    resource=f"profile:{profile_name}",
                )
            base_config = PosixServiceRuntimeConfig.load(
                relay_deployment,
                expected_role="relay",
            )
            self._transport = base_config.transport()
            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(relay_deployment, owner)
            self.acquire_remote_git_source_lease(relay_deployment, owner)

            home = self._run_remote(
                ("sh", "-lc", 'printf "%s" "$HOME"'),
                timeout=15,
            )
            if not home.startswith("/") or not SAFE_RUN_ID.fullmatch(
                manifest.run_id
            ):
                raise ProvisioningError(
                    "dual-Relay remote home or run identity is invalid"
                )
            project = PROJECT_PREFIX + manifest.run_id
            remote_root = f"{home}/{REMOTE_ROOT_PREFIX}{manifest.run_id}"
            relay_env_file = f"{home}/peers-touch/relay.env"
            self._project = project
            self._remote_root = remote_root
            self._relay_env_file = relay_env_file

            remote_ports: set[int] = set()
            while len(remote_ports) < 8:
                remote_ports.add(self._transport.available_remote_port())
            (
                station_http,
                station_libp2p,
                relay_a_control,
                relay_a_public,
                relay_a_libp2p,
                relay_b_control,
                relay_b_public,
                relay_b_libp2p,
            ) = sorted(remote_ports)
            relay_runtime_paths = {
                relay: f".peers-touch/runtime/{project}-{relay}"
                for relay in RELAY_IDS
            }
            relay_configs = {
                relay: dataclasses.replace(
                    base_config,
                    environment_name=f"{project}-{relay}",
                    runtime_path=relay_runtime_paths[relay],
                    http_port=(
                        relay_a_control
                        if relay == "relay-a"
                        else relay_b_control
                    ),
                    public_port=(
                        relay_a_public
                        if relay == "relay-a"
                        else relay_b_public
                    ),
                    libp2p_port=(
                        relay_a_libp2p
                        if relay == "relay-a"
                        else relay_b_libp2p
                    ),
                    public_base_url=(
                        f"https://{base_config.host}:"
                        + str(
                            relay_a_public
                            if relay == "relay-a"
                            else relay_b_public
                        )
                    ),
                    compose_project=project,
                    compose_service=relay,
                    data_volume=f"{project}_{relay}-data",
                )
                for relay in RELAY_IDS
            }
            runtime_paths = tuple(
                f"{home}/{relay_runtime_paths[relay]}"
                for relay in RELAY_IDS
            )
            self.register_cleanup(
                f"dual-relay-secret-roots:{project}",
                lambda: self._cleanup_runtime_paths(runtime_paths),
            )
            preparations = {
                relay: prepare_relay(config)
                for relay, config in relay_configs.items()
            }
            self._run_remote(("mkdir", "-p", remote_root), timeout=15)
            compose_environment = {
                "COMPOSE_PROJECT_NAME": project,
                "PT_RAL_RUNTIME_IMAGE": f"{project}-runtime",
                "PT_RAL_SOURCE_COMMIT": manifest.source_commit,
                "PT_RAL_BUILD_TIME": utc_now(),
                "PT_RAL_REMOTE_HOST": base_config.host,
                "PT_RAL_STATION_HTTP_PORT": str(station_http),
                "PT_RAL_STATION_LIBP2P_PORT": str(station_libp2p),
                "PT_RAL_STATION_URL": (
                    f"http://{base_config.host}:{station_http}"
                ),
                "PT_RAL_RELAY_A_CONTROL_PORT": str(relay_a_control),
                "PT_RAL_RELAY_A_PUBLIC_PORT": str(relay_a_public),
                "PT_RAL_RELAY_A_LIBP2P_PORT": str(relay_a_libp2p),
                "PT_RAL_RELAY_A_URL": (
                    f"https://{base_config.host}:{relay_a_public}"
                ),
                "PT_RAL_RELAY_A_SECRET_ROOT": str(
                    preparations["relay-a"]["secretMountPath"]
                ),
                "PT_RAL_RELAY_B_CONTROL_PORT": str(relay_b_control),
                "PT_RAL_RELAY_B_PUBLIC_PORT": str(relay_b_public),
                "PT_RAL_RELAY_B_LIBP2P_PORT": str(relay_b_libp2p),
                "PT_RAL_RELAY_B_URL": (
                    f"https://{base_config.host}:{relay_b_public}"
                ),
                "PT_RAL_RELAY_B_SECRET_ROOT": str(
                    preparations["relay-b"]["secretMountPath"]
                ),
            }
            self._compose_environment = compose_environment
            self.register_cleanup(
                f"dual-relay-runtime:{project}",
                lambda: self._cleanup_remote(runtime_paths),
            )
            with tempfile.TemporaryDirectory(
                prefix="pt-ral-source-"
            ) as raw:
                archive = Path(raw) / SOURCE_ARCHIVE_NAME
                archive_digest = _source_archive(archive)
                self._transport.copy_file(
                    archive,
                    f"{remote_root}/{SOURCE_ARCHIVE_NAME}",
                    timeout=120,
                )
            remote_archive_digest = self._run_remote(
                ("sha256sum", f"{remote_root}/{SOURCE_ARCHIVE_NAME}"),
                timeout=30,
            ).split(maxsplit=1)[0]
            if remote_archive_digest != archive_digest:
                raise ProvisioningError(
                    "dual-Relay exact-source archive digest mismatch"
                )
            self._run_remote(
                (
                    "tar",
                    "-xzf",
                    f"{remote_root}/{SOURCE_ARCHIVE_NAME}",
                    "-C",
                    remote_root,
                ),
                timeout=120,
            )
            self._run_remote(
                ("rm", "-f", f"{remote_root}/{SOURCE_ARCHIVE_NAME}"),
                timeout=15,
            )
            self._run_remote(
                self._compose_argv(
                    remote_root,
                    relay_env_file,
                    compose_environment,
                    "build",
                    "station",
                ),
                timeout=1800,
            )
            self._run_remote(
                self._compose_argv(
                    remote_root,
                    relay_env_file,
                    compose_environment,
                    "up",
                    "-d",
                    "station",
                    "relay-a",
                    "relay-a-proxy",
                    "relay-b",
                    "relay-b-proxy",
                ),
                timeout=300,
            )

            station_url = compose_environment["PT_RAL_STATION_URL"]
            relay_urls = {
                "relay-a": compose_environment["PT_RAL_RELAY_A_URL"],
                "relay-b": compose_environment["PT_RAL_RELAY_B_URL"],
            }
            relay_cas = {
                relay: self._run_remote(
                    (
                        "cat",
                        str(preparations[relay]["secretMountPath"])
                        + "/relay-ca.crt",
                    ),
                    timeout=15,
                ).encode("ascii")
                for relay in RELAY_IDS
            }
            _wait_json(station_url + "/sub-oss/healthz")
            relay_health = {
                relay: _wait_json(
                    relay_urls[relay] + "/healthz",
                    ca_pem=relay_cas[relay],
                )
                for relay in RELAY_IDS
            }
            station_version = _wait_json(station_url + "/app-meta/version")
            station_info = _wait_json(station_url + "/sub-bootstrap/info")
            station_peer_id = str(
                station_info.get("station_peer_id")
                or station_info.get("stationPeerId")
                or ""
            )
            relay_peer_ids = {
                relay: str(relay_health[relay].get("peer_id") or "")
                for relay in RELAY_IDS
            }
            if (
                not station_peer_id
                or station_version.get("build_commit")
                != manifest.source_commit
                or any(not peer_id for peer_id in relay_peer_ids.values())
                or len(set(relay_peer_ids.values())) != 2
            ):
                raise ProvisioningError(
                    "dual-Relay runtime identities are incomplete"
                )
            container_ids = self._container_ids()
            self._verify_runtime_image(
                container_ids,
                manifest.source_commit,
            )
            protocol_digest = source_proto_digest(REPO_ROOT)
            station_attestation = persist_service_attestation(
                ServiceAttestation(
                    service_id="station",
                    service_kind="station",
                    environment_id=self.environment_id,
                    deployment_environment=project,
                    endpoint=station_url,
                    live_commit=manifest.source_commit,
                    workspace_digest="clean",
                    protocol_digest=protocol_digest,
                    artifact_ref={},
                    produced_at=utc_now(),
                    producer="station-access-dual-relay",
                    build_time=str(station_version.get("build_time") or ""),
                    runtime_identity=station_peer_id,
                )
            )
            relay_attestations = {
                relay: persist_service_attestation(
                    ServiceAttestation(
                        service_id=relay,
                        service_kind="relay",
                        environment_id=self.environment_id,
                        deployment_environment=project,
                        endpoint=relay_urls[relay],
                        live_commit=manifest.source_commit,
                        workspace_digest="clean",
                        protocol_digest=protocol_digest,
                        artifact_ref={},
                        produced_at=utc_now(),
                        producer="station-access-dual-relay",
                        runtime_identity=relay_peer_ids[relay],
                    )
                )
                for relay in RELAY_IDS
            }
            self._handler = DualRelayControlHandler(
                transport=self._transport,
                project=project,
                station_url=station_url,
                relay_urls=relay_urls,
                relay_cas=relay_cas,
                relay_peer_ids=relay_peer_ids,
                container_ids=container_ids,
                source_commit=manifest.source_commit,
                fixture_epoch=manifest.run_id,
            )
            initial = self._handler.invoke(
                "initial-state",
                {},
                deadline_monotonic=time.monotonic() + 60,
                cancellation=threading.Event(),
            )
            if initial.get("attachments") != [] or any(
                count != 0
                for count in _mapping(
                    initial.get("ownedActiveInviteCounts"),
                    "owned invitation counts",
                ).values()
            ):
                raise BlockedError(
                    reason="dual-Relay Fixture did not start empty",
                    resource=f"fixture:{project}",
                )
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services={
                    "station": station_attestation,
                    **relay_attestations,
                },
                clients=(),
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (
            BlockedError,
            OSError,
            ProvisioningError,
            RuntimeError,
            subprocess.SubprocessError,
            urllib.error.URLError,
            ValueError,
        ) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"dual-Relay provisioning failed: {error}",
                    resource=f"environment:{self.environment_id}",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
