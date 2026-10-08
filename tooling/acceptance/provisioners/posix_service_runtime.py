"""Reviewed Linux/POSIX service runtime inspection for Acceptance."""

from __future__ import annotations

import hashlib
import json
import re
import ssl
import textwrap
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.provisioner import (
    load_env_file,
    resolve_deployment_environment_path,
)
from tooling.acceptance.remote_platform import RemotePlatform
from tooling.acceptance.transports.ssh import SshTarget, SshTransport


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_CONTAINER_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")
_RELAY_SECRET_PATHS = (
    "/app/relay-secrets/relay-operator.key",
    "/app/relay-secrets/relay-signing.key",
    "/app/relay-secrets/relay-tls.key",
)
_RELAY_PUBLIC_PATHS = (
    "/app/relay-secrets/relay-ca.crt",
    "/app/relay-secrets/relay.crt",
)


def _required(values: Mapping[str, str], key: str, source: Path) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise ProvisioningError(f"{key} is not set in {source}")
    return value


def _port(
    values: Mapping[str, str],
    key: str,
    source: Path,
    *,
    required: bool = True,
) -> int | None:
    raw = values.get(key, "").strip()
    if not raw and not required:
        return None
    if not raw:
        raise ProvisioningError(f"{key} is not set in {source}")
    try:
        value = int(raw)
    except ValueError as error:
        raise ProvisioningError(f"{key} must be an integer in {source}") from error
    if value < 1024 or value > 65535:
        raise ProvisioningError(f"{key} must be between 1024 and 65535")
    return value


def _container_path(value: str, key: str) -> str:
    normalized = value.strip()
    path = PurePosixPath(normalized)
    if (
        not normalized
        or not path.is_absolute()
        or ".." in path.parts
        or not _CONTAINER_PATH.fullmatch(normalized)
    ):
        raise ProvisioningError(f"{key} must be a safe absolute container path")
    return normalized


def _relative_path(value: str, key: str) -> str:
    normalized = value.strip()
    path = PurePosixPath(normalized)
    if (
        not normalized
        or path.is_absolute()
        or ".." in path.parts
        or not re.fullmatch(r"[A-Za-z0-9._/-]+", normalized)
    ):
        raise ProvisioningError(
            f"{key} must be a safe path relative to the remote home"
        )
    return path.as_posix()


@dataclass(frozen=True)
class PosixServiceRuntimeConfig:
    environment_name: str
    role: str
    host: str
    user: str
    ssh_port: int
    known_hosts_file: str
    deploy_path: str
    runtime_path: str
    http_port: int
    public_port: int
    stream_port: int | None
    public_base_url: str
    compose_project: str
    compose_service: str
    data_volume: str
    tls_ca_path: str
    operator_key_path: str

    @classmethod
    def load(
        cls,
        environment_name: str,
        *,
        expected_role: str,
    ) -> "PosixServiceRuntimeConfig":
        if not _IDENTIFIER.fullmatch(environment_name):
            raise ProvisioningError("deploy environment name is invalid")
        if expected_role not in {"station", "relay"}:
            raise ProvisioningError("expected service role is invalid")
        source = resolve_deployment_environment_path(environment_name)
        values = load_env_file(source)
        platform = values.get(
            "PT_DEPLOY_PLATFORM",
            RemotePlatform.POSIX.value,
        ).strip().lower()
        if platform != RemotePlatform.POSIX.value:
            raise ProvisioningError(
                f"{environment_name} must use the POSIX deployment contract"
            )
        role = _required(values, "PT_DEPLOY_ROLE", source).lower()
        if role != expected_role:
            raise ProvisioningError(
                f"{environment_name} role must be {expected_role}"
            )
        runtime_kind = _required(values, "PT_DEPLOY_RUNTIME_KIND", source)
        if runtime_kind != "docker-compose":
            raise ProvisioningError(
                f"{environment_name} runtime kind must be docker-compose"
            )
        compose_project = _required(
            values,
            "PT_DEPLOY_COMPOSE_PROJECT",
            source,
        )
        compose_service = _required(
            values,
            "PT_DEPLOY_COMPOSE_SERVICE",
            source,
        )
        data_volume = _required(values, "PT_DEPLOY_DATA_VOLUME", source)
        for key, value in (
            ("PT_DEPLOY_COMPOSE_PROJECT", compose_project),
            ("PT_DEPLOY_COMPOSE_SERVICE", compose_service),
            ("PT_DEPLOY_DATA_VOLUME", data_volume),
        ):
            if not _IDENTIFIER.fullmatch(value):
                raise ProvisioningError(f"{key} is invalid")

        public_base_url = _required(
            values,
            "PT_DEPLOY_PUBLIC_BASE_URL",
            source,
        ).rstrip("/")
        parsed = urlparse(public_base_url)
        required_scheme = "https" if role == "relay" else "http"
        if parsed.scheme.lower() != required_scheme or not parsed.hostname:
            raise ProvisioningError(
                f"{environment_name} public URL must use {required_scheme}"
            )
        try:
            public_port = parsed.port or (
                443 if required_scheme == "https" else 80
            )
        except ValueError as error:
            raise ProvisioningError(
                f"{environment_name} public URL has an invalid port"
            ) from error

        stream_port = _port(
            values,
            "PT_DEPLOY_STREAM_PORT",
            source,
            required=role == "relay",
        )
        http_port = _port(values, "PT_DEPLOY_HTTP_PORT", source)
        assert http_port is not None
        tls_ca_path = ""
        operator_key_path = ""
        if role == "relay":
            if public_port in {http_port, stream_port}:
                raise ProvisioningError(
                    "Relay public, control, and stream ports must be distinct"
                )
            tls_ca_path = _container_path(
                _required(values, "PT_DEPLOY_TLS_CA_PATH", source),
                "PT_DEPLOY_TLS_CA_PATH",
            )
            operator_key_path = _container_path(
                _required(values, "PT_DEPLOY_OPERATOR_KEY_PATH", source),
                "PT_DEPLOY_OPERATOR_KEY_PATH",
            )

        deploy_path = _relative_path(
            _required(values, "PT_DEPLOY_PATH", source),
            "PT_DEPLOY_PATH",
        )
        runtime_path = values.get("PT_DEPLOY_RUNTIME_PATH", "").strip()
        if role == "relay":
            runtime_path = _relative_path(
                _required(values, "PT_DEPLOY_RUNTIME_PATH", source),
                "PT_DEPLOY_RUNTIME_PATH",
            )
        elif runtime_path:
            runtime_path = _relative_path(
                runtime_path,
                "PT_DEPLOY_RUNTIME_PATH",
            )
        else:
            runtime_path = deploy_path

        return cls(
            environment_name=environment_name,
            role=role,
            host=_required(values, "PT_DEPLOY_HOST", source),
            user=_required(values, "PT_DEPLOY_USER", source),
            ssh_port=int(values.get("PT_DEPLOY_SSH_PORT", "22")),
            known_hosts_file=values.get(
                "PT_DEPLOY_KNOWN_HOSTS_FILE",
                "",
            ).strip(),
            deploy_path=deploy_path,
            runtime_path=runtime_path,
            http_port=http_port,
            public_port=public_port,
            stream_port=stream_port,
            public_base_url=public_base_url,
            compose_project=compose_project,
            compose_service=compose_service,
            data_volume=data_volume,
            tls_ca_path=tls_ca_path,
            operator_key_path=operator_key_path,
        )

    def transport(self) -> SshTransport:
        return SshTransport(
            SshTarget(
                host=self.host,
                user=self.user,
                port=self.ssh_port,
                known_hosts_file=self.known_hosts_file,
                remote_platform=RemotePlatform.POSIX,
            )
        )

    def inspection_payload(self) -> dict[str, object]:
        return {
            "environmentName": self.environment_name,
            "role": self.role,
            "deployPath": self.deploy_path,
            "httpPort": self.http_port,
            "publicPort": self.public_port,
            "streamPort": self.stream_port,
            "composeProject": self.compose_project,
            "composeService": self.compose_service,
            "dataVolume": self.data_volume,
        }


def inspect_posix_runtime(
    config: PosixServiceRuntimeConfig,
    *,
    transport: SshTransport | None = None,
) -> dict[str, Any]:
    script = textwrap.dedent(
        """
        import json
        import pathlib
        import subprocess
        import sys

        cfg = json.loads(sys.argv[1])

        def run(argv):
            completed = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if completed.returncode != 0:
                detail = completed.stderr.strip() or completed.stdout.strip()
                raise RuntimeError(detail or "command failed")
            return completed.stdout

        filters = [
            "label=com.docker.compose.project=" + cfg["composeProject"],
            "label=com.docker.compose.service=" + cfg["composeService"],
        ]
        command = ["docker", "ps", "--format", "{{.ID}}"]
        for item in filters:
            command.extend(["--filter", item])
        container_ids = [line.strip() for line in run(command).splitlines() if line.strip()]
        if len(container_ids) != 1:
            raise RuntimeError("reviewed Compose service must own exactly one running container")
        container_id = container_ids[0]
        container = json.loads(run(["docker", "inspect", container_id]))[0]
        image_id = container["Image"]
        image = json.loads(run(["docker", "image", "inspect", image_id]))[0]
        labels = image.get("Config", {}).get("Labels") or {}
        state = container.get("State") or {}
        mounts = container.get("Mounts") or []
        volume_names = sorted(
            str(item.get("Name") or "")
            for item in mounts
            if item.get("Type") == "volume" and item.get("Name")
        )
        if cfg["dataVolume"] not in volume_names:
            raise RuntimeError("runtime does not own the reviewed data volume")
        deploy_path = pathlib.Path.home() / cfg["deployPath"]
        status = run(
            ["git", "-C", str(deploy_path), "status", "--porcelain", "--untracked-files=all"]
        ).strip()
        source_commit = run(
            ["git", "-C", str(deploy_path), "rev-parse", "HEAD"]
        ).strip()
        payload = {
            "artifactKind": "posix-compose-runtime-status",
            "environmentName": cfg["environmentName"],
            "platform": "linux",
            "role": cfg["role"],
            "runtimeOwner": "docker-compose:"
                + cfg["composeProject"] + "/" + cfg["composeService"],
            "runtimePath": str(deploy_path),
            "containerId": container_id,
            "processIds": [int(state.get("Pid") or 0)],
            "healthy": (
                state.get("Status") == "running"
                and (
                    not isinstance(state.get("Health"), dict)
                    or state["Health"].get("Status") == "healthy"
                )
            ),
            "sourceCommit": source_commit,
            "sourceClean": not bool(status),
            "imageId": image_id,
            "imageDigest": str(image.get("Id") or ""),
            "buildCommit": str(labels.get("org.opencontainers.image.revision") or ""),
            "buildTime": str(labels.get("org.opencontainers.image.created") or ""),
            "dataOwner": cfg["dataVolume"],
            "httpPort": cfg["httpPort"],
            "publicPort": cfg["publicPort"],
            "streamPort": cfg["streamPort"],
        }
        print(json.dumps(payload, sort_keys=True))
        """
    ).strip()
    remote = transport or config.transport()
    completed = remote.run_argv(
        ["python3", "-", json.dumps(config.inspection_payload(), sort_keys=True)],
        timeout=30,
        check=False,
        input_text=script,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise BlockedError(
            reason=(
                f"Cannot inspect Linux runtime {config.environment_name}: "
                f"{detail[-2000:]}"
            ),
            resource=f"runtime-status:{config.environment_name}",
        )
    try:
        value = json.loads(completed.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise BlockedError(
            reason=(
                f"Linux runtime {config.environment_name} returned invalid status"
            ),
            resource=f"runtime-status:{config.environment_name}",
        ) from error
    if (
        not isinstance(value, dict)
        or value.get("artifactKind") != "posix-compose-runtime-status"
        or value.get("platform") != "linux"
        or value.get("role") != config.role
        or value.get("healthy") is not True
        or value.get("sourceClean") is not True
        or value.get("dataOwner") != config.data_volume
        or not value.get("containerId")
        or not value.get("runtimeOwner")
    ):
        raise BlockedError(
            reason=f"Linux runtime {config.environment_name} is incomplete",
            resource=f"runtime-status:{config.environment_name}",
        )
    return value


def resolve_posix_service_version(
    deploy_environment: str,
) -> dict[str, Any]:
    source = resolve_deployment_environment_path(deploy_environment)
    values = load_env_file(source)
    role = _required(values, "PT_DEPLOY_ROLE", source).lower()
    config = PosixServiceRuntimeConfig.load(
        deploy_environment,
        expected_role=role,
    )
    status = inspect_posix_runtime(config)
    build_commit = str(status.get("buildCommit") or "")
    source_commit = str(status.get("sourceCommit") or "")
    if (
        len(build_commit) < 7
        or not (
            build_commit.startswith(source_commit)
            or source_commit.startswith(build_commit)
        )
    ):
        raise BlockedError(
            reason=(
                f"Linux runtime {deploy_environment} image is not bound "
                "to its exact source"
            ),
            resource=f"runtime-status:{deploy_environment}",
        )
    return {
        "build_commit": build_commit,
        "build_time": str(status.get("buildTime") or ""),
        "service_id": str(status["runtimeOwner"]),
    }


def _read_container_file(
    config: PosixServiceRuntimeConfig,
    path: str,
    *,
    transport: SshTransport | None = None,
) -> bytes:
    status = inspect_posix_runtime(config, transport=transport)
    remote = transport or config.transport()
    completed = remote.run_argv(
        ["docker", "exec", str(status["containerId"]), "cat", path],
        timeout=15,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or "file read failed"
        raise BlockedError(
            reason=f"Cannot read reviewed runtime file: {detail[-500:]}",
            resource=f"runtime-file:{config.environment_name}",
        )
    return completed.stdout.encode("utf-8")


def resolve_posix_relay_trust_anchor(
    deploy_environment: str,
) -> tuple[bytes, str]:
    config = PosixServiceRuntimeConfig.load(
        deploy_environment,
        expected_role="relay",
    )
    certificate = _read_container_file(config, config.tls_ca_path)
    try:
        ssl.PEM_cert_to_DER_cert(certificate.decode("ascii"))
    except (UnicodeError, ValueError) as error:
        raise BlockedError(
            reason="Linux Relay trust anchor is not a valid PEM certificate",
            resource=f"runtime-trust:{deploy_environment}",
        ) from error
    return certificate, "sha256:" + hashlib.sha256(certificate).hexdigest()


def mint_posix_relay_operator_token(
    config: PosixServiceRuntimeConfig,
    *,
    transport: SshTransport | None = None,
) -> str:
    if config.role != "relay":
        raise ProvisioningError("operator tokens require a Relay runtime")
    status = inspect_posix_runtime(config, transport=transport)
    script = textwrap.dedent(
        """
        import base64
        import hashlib
        import hmac
        import json
        import subprocess
        import sys
        import time

        container, key_path = sys.argv[1:3]
        completed = subprocess.run(
            ["docker", "exec", container, "cat", key_path],
            capture_output=True,
            check=False,
        )
        if completed.returncode != 0:
            raise SystemExit("cannot read operator key")
        key = completed.stdout.strip()
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
        sys.stdout.write((unsigned + b"." + signature).decode("ascii"))
        """
    ).strip()
    remote = transport or config.transport()
    completed = remote.run_argv(
        [
            "python3",
            "-",
            str(status["containerId"]),
            config.operator_key_path,
        ],
        timeout=15,
        check=False,
        input_text=script,
    )
    token = completed.stdout.strip()
    if completed.returncode != 0 or token.count(".") != 2:
        raise BlockedError(
            reason="Linux Relay operator token minting failed",
            resource=f"runtime-operator:{config.environment_name}",
        )
    return token


def audit_posix_relay_security(
    config: PosixServiceRuntimeConfig,
    *,
    station_runtime: Mapping[str, Any],
    relay_runtime: Mapping[str, Any],
    transport: SshTransport | None = None,
) -> dict[str, Any]:
    if config.role != "relay":
        raise ProvisioningError("Relay security audit requires a Relay runtime")
    # The Station image intentionally has no Python runtime. Run the fixed
    # POSIX checks through shell tools inside the container instead.
    status = inspect_posix_runtime(config, transport=transport)
    remote = transport or config.transport()
    paths = _RELAY_SECRET_PATHS + _RELAY_PUBLIC_PATHS
    shell = (
        "set -eu; "
        "for path in " + " ".join(paths) + "; do "
        "test -s \"$path\"; stat -c '%n|%a|%u|%g|%s' \"$path\"; "
        "done; "
        "sha256sum /app/peers-touch-station; "
        "test \"$(readlink /proc/1/exe)\" = '/app/peers-touch-station'"
    )
    completed = remote.run_argv(
        [
            "docker",
            "exec",
            str(status["containerId"]),
            "sh",
            "-lc",
            shell,
        ],
        timeout=30,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise BlockedError(
            reason=f"Linux Relay security audit failed: {detail[-1000:]}",
            resource=f"runtime-security:{config.environment_name}",
        )
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    records: list[dict[str, Any]] = []
    for line in lines[: len(paths)]:
        parts = line.split("|")
        if len(parts) != 5:
            raise BlockedError(
                reason="Linux Relay security audit returned invalid file evidence",
                resource=f"runtime-security:{config.environment_name}",
            )
        path, mode, uid, gid, size = parts
        secret = path in _RELAY_SECRET_PATHS
        mode_value = int(mode, 8)
        protected = (
            int(uid) == 0
            and int(size) > 0
            and (
                mode_value & 0o077 == 0
                if secret
                else mode_value & 0o022 == 0
            )
        )
        records.append(
            {
                "name": PurePosixPath(path).name,
                "path": path,
                "mode": mode,
                "uid": int(uid),
                "gid": int(gid),
                "nonEmpty": int(size) > 0,
                "protected": protected,
            }
        )
    digest_line = lines[len(paths)] if len(lines) > len(paths) else ""
    binary_sha256 = digest_line.split(" ", 1)[0].lower()
    if (
        len(records) != len(paths)
        or any(record["protected"] is not True for record in records)
        or not _SHA256.fullmatch(binary_sha256)
        or station_runtime.get("dataOwner") == relay_runtime.get("dataOwner")
        or station_runtime.get("runtimeOwner")
        == relay_runtime.get("runtimeOwner")
    ):
        raise BlockedError(
            reason="Linux Relay runtime ownership is incomplete",
            resource=f"runtime-security:{config.environment_name}",
        )
    return {
        "platform": "linux",
        "requiredProtectedFiles": records,
        "binarySha256": binary_sha256,
        "processBinaryMatches": True,
        "stationDataOwner": str(station_runtime.get("dataOwner") or ""),
        "relayDataOwner": str(relay_runtime.get("dataOwner") or ""),
    }
