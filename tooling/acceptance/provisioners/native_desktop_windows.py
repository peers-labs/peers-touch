"""Remote Windows Native Desktop runtime-cell lifecycle."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import socket
import struct
import subprocess
import tempfile
import time
import zlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path, PureWindowsPath
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from tooling.acceptance.core import (
    AppLaunchMetadata,
    CellAdapterIdentity,
    CellDisplayIdentity,
    CellPlatformIdentity,
    CellSourceIdentity,
    CellTransportIdentity,
    REPO_ROOT,
    RUNTIME_CELLS_DIR,
    RuntimeCellContract,
    RuntimeCellManifest,
    RuntimeCellState,
)
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.lease import RemoteGitSourceLease
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.core.source_sync import (
    RemoteSourceSynchronizer,
    SourceSyncRequest,
    SourceSyncResult,
)
from tooling.acceptance.drivers.tauri import ProvisionedTauriLauncher
from tooling.acceptance.transports.ssh import (
    RemotePlatform,
    SshTarget,
    SshTransport,
    SshTunnel,
)


_SHA256 = re.compile(r"^(?:sha256:)?([0-9a-f]{64})$")
_IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_DEFAULT_PROFILE_ROOT = REPO_ROOT / ".local" / "acceptance" / "runtime-cells"
_DEFAULT_DEPLOY_ROOT = REPO_ROOT / ".local" / "deploy" / "envs"
_DEFAULT_RUNTIME_ROOT = (
    "AppData/Local/PeersTouch/AcceptanceCells/desktop-windows-native"
)
_DEFAULT_CARGO_TARGET_ROOT = "pt-cache/desktop-windows-native"
_BROKER_RELATIVE_PATH = (
    "tooling/acceptance/provisioners/windows_desktop_broker.py"
)
_BINARY_RELATIVE_PATH = "debug/peers-touch-desktop.exe"
_BUILD_SCRIPT_RELATIVE_PATH = "tooling/scripts/windows-desktop-build.ps1"


def _required(values: dict[str, str], key: str, source: Path) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise ProvisioningError(f"{key} is missing from {source}")
    return value


def _port(
    values: dict[str, str],
    key: str,
    default: int,
    source: Path,
) -> int:
    try:
        value = int(values.get(key, str(default)))
    except ValueError as error:
        raise ProvisioningError(f"{key} is invalid in {source}") from error
    if value < 1024 or value > 65535:
        raise ProvisioningError(f"{key} must be between 1024 and 65535")
    return value


def _positive_int(
    values: dict[str, str],
    key: str,
    default: int,
    source: Path,
) -> int:
    try:
        value = int(values.get(key, str(default)))
    except ValueError as error:
        raise ProvisioningError(f"{key} is invalid in {source}") from error
    if value <= 0:
        raise ProvisioningError(f"{key} must be positive")
    return value


def _digest(value: str, name: str) -> str:
    matched = _SHA256.fullmatch(value.strip().lower())
    if matched is None:
        raise ProvisioningError(f"{name} is not a SHA-256 digest")
    return matched.group(1)


def _screenshot_probe_geometry(value: object) -> tuple[int, int]:
    if not isinstance(value, dict) or value.get("captured") is not True:
        raise ProvisioningError(
            "Windows adapter screenshot probe did not capture the desktop"
        )
    byte_length = value.get("byteLength")
    if (
        value.get("contentEncoding") != "zlib"
        or isinstance(byte_length, bool)
        or not isinstance(byte_length, int)
        or byte_length <= 54
    ):
        raise ProvisioningError(
            "Windows adapter screenshot probe metadata is invalid"
        )
    expected_digest = _digest(
        str(value.get("sha256") or ""),
        "Windows adapter screenshot",
    )
    try:
        compressed = base64.b64decode(str(value.get("content") or ""), validate=True)
        content = zlib.decompress(compressed)
        if (
            len(content) != byte_length
            or hashlib.sha256(content).hexdigest() != expected_digest
            or content[:2] != b"BM"
        ):
            raise ValueError("screenshot payload identity does not match")
        width, height = struct.unpack_from("<ii", content, 18)
    except (ValueError, struct.error, zlib.error) as error:
        raise ProvisioningError(
            "Windows adapter screenshot probe payload is invalid"
        ) from error
    if width <= 0 or height <= 0:
        raise ProvisioningError(
            "Windows adapter screenshot probe geometry is invalid"
        )
    return width, height


def _windows_join(root: str, *parts: str) -> str:
    return str(PureWindowsPath(root, *parts))


def _normalized_windows_path(path: str) -> PureWindowsPath:
    normalized = str(PureWindowsPath(path))
    if normalized.startswith("\\\\?\\UNC\\"):
        normalized = "\\\\" + normalized[8:]
    elif normalized.startswith("\\\\?\\"):
        normalized = normalized[4:]
    return PureWindowsPath(normalized)


def _windows_verbatim_path(path: str) -> str:
    normalized = str(_normalized_windows_path(path))
    if normalized.startswith("\\\\"):
        return "\\\\?\\UNC\\" + normalized[2:]
    return "\\\\?\\" + normalized


def _windows_path_is_descendant(path: str, root: str) -> bool:
    candidate = _normalized_windows_path(path)
    parent = _normalized_windows_path(root)
    return candidate != parent and parent in candidate.parents


def _json_output(
    completed: subprocess.CompletedProcess[str],
    operation: str,
) -> dict[str, Any]:
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise ProvisioningError(
            f"Windows runtime-cell {operation} failed: {detail[-4000:]}"
        )
    try:
        envelope = json.loads(completed.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise ProvisioningError(
            f"Windows runtime-cell {operation} returned invalid JSON"
        ) from error
    if not isinstance(envelope, dict) or envelope.get("status") != "OK":
        detail = (
            envelope.get("error")
            if isinstance(envelope, dict)
            else "non-object response"
        )
        raise ProvisioningError(
            f"Windows runtime-cell {operation} was rejected: {detail}"
        )
    result = envelope.get("result")
    if not isinstance(result, dict):
        raise ProvisioningError(
            f"Windows runtime-cell {operation} returned an invalid result"
        )
    return result


@dataclass(frozen=True)
class WindowsCellProfile:
    name: str
    deploy_environment: str
    desktop_user: str
    runtime_root: str
    python_executable: str
    vsdevcmd_path: str
    windows_sdk_root: str
    windows_sdk_version: str
    perl_path: str
    protoc_path: str
    webdriver_port: int
    gateway_port: int
    cargo_target_root: str = _DEFAULT_CARGO_TARGET_ROOT
    build_timeout_seconds: int = 3600

    @classmethod
    def load(
        cls,
        contract: RuntimeCellContract,
        *,
        profile_root: Path = _DEFAULT_PROFILE_ROOT,
    ) -> "WindowsCellProfile":
        prefix = "profile:"
        if not contract.transport.target_ref.startswith(prefix):
            raise ProvisioningError(
                f"Windows runtime cell target must use {prefix!r}"
            )
        name = contract.transport.target_ref.removeprefix(prefix)
        configured = os.environ.get("PT_ACCEPTANCE_CELL_PROFILE_FILE", "")
        path = (
            Path(configured).expanduser()
            if configured
            else profile_root / f"{name}.env"
        )
        if not path.is_file():
            raise BlockedError(
                reason=f"Windows runtime-cell profile is missing: {path}",
                resource=f"runtime-cell-profile:{name}",
            )
        values = load_env_file(path)
        profile = cls(
            name=name,
            deploy_environment=_required(
                values,
                "PT_ACCEPTANCE_CELL_DEPLOY_ENV",
                path,
            ),
            desktop_user=_required(
                values,
                "PT_ACCEPTANCE_CELL_DESKTOP_USER",
                path,
            ),
            runtime_root=values.get(
                "PT_ACCEPTANCE_CELL_RUNTIME_ROOT",
                _DEFAULT_RUNTIME_ROOT,
            ),
            python_executable=values.get(
                "PT_ACCEPTANCE_CELL_PYTHON",
                "python",
            ),
            vsdevcmd_path=values.get(
                "PT_ACCEPTANCE_CELL_VSDEVCMD",
                "C:/BuildTools/Common7/Tools/VsDevCmd.bat",
            ),
            windows_sdk_root=_required(
                values,
                "PT_ACCEPTANCE_CELL_WINDOWS_SDK_ROOT",
                path,
            ),
            windows_sdk_version=_required(
                values,
                "PT_ACCEPTANCE_CELL_WINDOWS_SDK_VERSION",
                path,
            ),
            perl_path=values.get(
                "PT_ACCEPTANCE_CELL_PERL",
                "C:/Strawberry/perl/bin/perl.exe",
            ),
            protoc_path=_required(
                values,
                "PT_ACCEPTANCE_CELL_PROTOC",
                path,
            ),
            webdriver_port=_port(
                values,
                "PT_ACCEPTANCE_CELL_WEBDRIVER_PORT",
                4645,
                path,
            ),
            gateway_port=_port(
                values,
                "PT_ACCEPTANCE_CELL_GATEWAY_PORT",
                3230,
                path,
            ),
            cargo_target_root=values.get(
                "PT_ACCEPTANCE_CELL_CARGO_TARGET_ROOT",
                _DEFAULT_CARGO_TARGET_ROOT,
            ),
            build_timeout_seconds=_positive_int(
                values,
                "PT_ACCEPTANCE_CELL_BUILD_TIMEOUT_SECONDS",
                3600,
                path,
            ),
        )
        profile.validate()
        return profile

    def validate(self) -> None:
        runtime = PureWindowsPath(self.runtime_root)
        if runtime.is_absolute() or ".." in runtime.parts:
            raise ProvisioningError(
                "Windows runtime-cell runtime root must be relative to remote home"
            )
        cargo_target = PureWindowsPath(self.cargo_target_root)
        if cargo_target.is_absolute() or ".." in cargo_target.parts:
            raise ProvisioningError(
                "Windows runtime-cell Cargo target root must be relative to remote home"
            )
        vsdevcmd = PureWindowsPath(self.vsdevcmd_path)
        if not vsdevcmd.is_absolute():
            raise ProvisioningError(
                "Windows runtime-cell VsDevCmd path must be drive-absolute"
            )
        if not PureWindowsPath(self.windows_sdk_root).is_absolute():
            raise ProvisioningError(
                "Windows runtime-cell SDK root must be drive-absolute"
            )
        if not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", self.windows_sdk_version):
            raise ProvisioningError(
                "Windows runtime-cell SDK version must be numeric"
            )
        if not PureWindowsPath(self.perl_path).is_absolute():
            raise ProvisioningError(
                "Windows runtime-cell Perl path must be drive-absolute"
            )
        if not PureWindowsPath(self.protoc_path).is_absolute():
            raise ProvisioningError(
                "Windows runtime-cell protoc path must be drive-absolute"
            )
        if self.webdriver_port == self.gateway_port:
            raise ProvisioningError(
                "Windows runtime-cell ports must be distinct"
            )
        if self.build_timeout_seconds <= 0:
            raise ProvisioningError(
                "Windows runtime-cell build timeout must be positive"
            )


@dataclass
class _ActorRuntime:
    actor: str
    webdriver_tunnel: SshTunnel
    gateway_tunnel: SshTunnel
    log_path: Path
    released: bool = False


@dataclass
class _EndpointRuntime:
    endpoint_id: str
    tunnel: SshTunnel
    tunnel_pid: int
    local_port: int
    remote_port: int
    released: bool = False


class NativeDesktopWindowsProvisioner:
    """Owns one exact-source Windows Desktop runtime-cell lease."""

    def __init__(
        self,
        *,
        contract_path: Path | None = None,
        profile_root: Path = _DEFAULT_PROFILE_ROOT,
        deploy_root: Path = _DEFAULT_DEPLOY_ROOT,
        source_root: Path = REPO_ROOT,
        transport: SshTransport | None = None,
    ) -> None:
        selected_contract = contract_path or (
            RUNTIME_CELLS_DIR / "desktop-windows-native.yaml"
        )
        self.contract = RuntimeCellContract.from_yaml(selected_contract)
        if self.contract.platform != "windows":
            raise ProvisioningError(
                "NativeDesktopWindowsProvisioner requires windows"
            )
        self.profile = WindowsCellProfile.load(
            self.contract,
            profile_root=profile_root,
        )
        self.deploy_root = deploy_root
        self.source_root = source_root.resolve()
        deploy_path = deploy_root / f"{self.profile.deploy_environment}.env"
        if not deploy_path.is_file():
            raise BlockedError(
                reason=(
                    "Windows runtime-cell deploy environment is missing: "
                    f"{deploy_path}"
                ),
                resource=(
                    "runtime-cell-deploy-environment:"
                    f"{self.profile.deploy_environment}"
                ),
            )
        self.deploy_values = load_env_file(deploy_path)
        self.target = SshTarget(
            host=_required(self.deploy_values, "PT_DEPLOY_HOST", deploy_path),
            user=_required(self.deploy_values, "PT_DEPLOY_USER", deploy_path),
            port=int(self.deploy_values.get("PT_DEPLOY_SSH_PORT", "22")),
            known_hosts_file=self.deploy_values.get(
                "PT_DEPLOY_KNOWN_HOSTS_FILE",
                "",
            ),
            remote_platform=RemotePlatform.WINDOWS,
        )
        self.transport = transport or SshTransport(self.target)
        self.state_path = (
            REPO_ROOT
            / ".local"
            / "acceptance"
            / "runtime-cells"
            / f"{self.contract.cell_id}.json"
        )
        self._actors: dict[str, _ActorRuntime] = {}
        self._actor_slots: dict[str, int] = {}
        self._endpoints: dict[str, _EndpointRuntime] = {}
        self._tunnel_failures: list[dict[str, object]] = []
        self._source_lease: RemoteGitSourceLease | None = None

    def ready(
        self,
        gate_id: str = "runtime-cell-preflight",
    ) -> RuntimeCellManifest:
        if self.state_path.exists():
            raise BlockedError(
                reason=(
                    f"Windows runtime cell {self.contract.cell_id} "
                    "already has owner state; run stop before ready"
                ),
                resource=f"runtime-cell:{self.contract.cell_id}",
            )
        run_id = _new_run_id()
        remote_home = ""
        remote_source = ""
        broker_root = ""
        broker_path = ""
        broker_acquired = False
        source_lease_acquired = False
        probe_tunnels: list[SshTunnel] = []
        try:
            host = self._host_preflight()
            remote_home = self._remote_home()
            broker_root = _windows_join(
                remote_home,
                self.profile.runtime_root,
            )
            source_request = self._source_request()
            self._ensure_remote_source_repository(
                remote_home,
                source_request.deploy_path,
            )
            source_lease_owner = (
                f"runtime-cell:{self.contract.cell_id}:{run_id}"
            )
            source_lease = RemoteGitSourceLease(
                source_request.environment_name,
                source_lease_owner,
                host=source_request.host,
                user=source_request.user,
                deploy_path=source_request.deploy_path,
                port=source_request.ssh_port,
                known_hosts_file=source_request.known_hosts_file,
                remote_platform=RemotePlatform.WINDOWS,
            )
            source_lease.acquire()
            self._source_lease = source_lease
            source_lease_acquired = True
            source = self._sync_source(remote_home)
            remote_source = _windows_join(remote_home, source.deploy_path)
            broker_path = _windows_join(
                remote_source,
                _BROKER_RELATIVE_PATH,
            )
            self._assert_remote_ports_free(
                self.profile.webdriver_port,
                self.profile.gateway_port,
            )
            binary_path, binary_sha256 = self._build_binary(
                remote_source,
                remote_home,
            )
            self._require_interactive_desktop(host)
            expires_at = datetime.now(timezone.utc) + timedelta(
                seconds=self.contract.lease_ttl_seconds
            )
            acquired = self._broker(
                broker_path,
                broker_root,
                "acquire",
                {
                    "runId": run_id,
                    "expiresAtEpoch": int(expires_at.timestamp()),
                },
            )
            broker_acquired = True
            self._write_state(
                {
                    "cellId": self.contract.cell_id,
                    "runId": run_id,
                    "state": "PREPARING",
                    "expiresAtEpoch": int(expires_at.timestamp()),
                    "remoteHome": remote_home,
                    "remoteSource": remote_source,
                    "cargoTargetRoot": _windows_join(
                        remote_home,
                        self.profile.cargo_target_root,
                    ),
                    "brokerRoot": broker_root,
                    "brokerPath": broker_path,
                    "binaryPath": binary_path,
                    "binarySha256": binary_sha256,
                    "sourceCommit": source.commit,
                    "sourceLeaseOwner": source_lease_owner,
                    "broker": acquired,
                }
            )
            probe = self._launch_remote_actor(
                actor="cell-probe",
                webdriver_port=self.profile.webdriver_port,
                gateway_port=self.profile.gateway_port,
                profile=f"{self.profile.name}-probe",
                environment={},
            )
            try:
                self._wait_remote_actor_endpoints(
                    "cell-probe",
                    self.profile.webdriver_port,
                    self.profile.gateway_port,
                )
                webdriver_tunnel = self.transport.start_local_forward(
                    remote_port=self.profile.webdriver_port,
                )
                gateway_tunnel = self.transport.start_local_forward(
                    remote_port=self.profile.gateway_port,
                )
                probe_tunnels.extend((webdriver_tunnel, gateway_tunnel))
                adapter = self._probe_adapter(
                    int(probe["processId"]),
                )
                manifest = self._manifest(
                    gate_id=gate_id,
                    run_id=run_id,
                    expires_at=expires_at,
                    host=host,
                    source=source,
                    binary_sha256=binary_sha256,
                    adapter=adapter,
                    webdriver_local_port=webdriver_tunnel.local_port,
                )
            finally:
                for tunnel in reversed(probe_tunnels):
                    tunnel.stop()
                self._stop_remote_actor("cell-probe")
            manifest.validate(self.contract)
            state = self._read_state()
            self._write_state(
                {
                    **state,
                    "state": RuntimeCellState.LEASED.value,
                    "manifest": manifest.to_dict(),
                }
            )
            return manifest
        except BaseException as error:
            failures: list[str] = []
            for tunnel in reversed(probe_tunnels):
                try:
                    tunnel.stop()
                except Exception as cleanup_error:
                    failures.append(f"probe tunnel: {cleanup_error}")
            if broker_acquired:
                try:
                    self._broker(
                        broker_path,
                        broker_root,
                        "cleanup",
                        {"runId": run_id},
                    )
                except Exception as cleanup_error:
                    failures.append(f"remote broker: {cleanup_error}")
            if source_lease_acquired:
                try:
                    self._release_source_lease()
                except Exception as cleanup_error:
                    failures.append(f"source lease: {cleanup_error}")
            if not failures:
                self.state_path.unlink(missing_ok=True)
                raise
            raise ProvisioningError(
                f"Windows runtime-cell operation failed ({error}); "
                "cleanup also failed: "
                + "; ".join(failures)
            ) from error

    def status(self) -> dict[str, Any]:
        state = self._read_state()
        if not state:
            return {
                "cellId": self.contract.cell_id,
                "state": RuntimeCellState.CLEANED.value,
            }
        payload = self._broker_from_state(state, "status", {})
        if payload.get("expired"):
            cleanup = self.stop()
            return {
                "cellId": self.contract.cell_id,
                "state": RuntimeCellState.CLEANED.value,
                "expired": True,
                "cleanup": cleanup,
            }
        return {
            "cellId": self.contract.cell_id,
            "state": state.get("state", "PREPARING"),
            "manifest": state.get("manifest"),
            **payload,
        }

    def launch_actor(
        self,
        actor: str,
        client_spec: dict[str, Any],
        environment: dict[str, str],
    ) -> ProvisionedTauriLauncher:
        state = self._require_state()
        normalized_actor = self._actor_id(actor)
        if normalized_actor in self._actors:
            raise ProvisioningError(
                f"Windows runtime-cell actor {normalized_actor!r} "
                "is already launched"
            )
        webdriver_port, gateway_port = self._actor_remote_ports(
            normalized_actor,
        )
        remote = self._launch_remote_actor(
            actor=normalized_actor,
            webdriver_port=webdriver_port,
            gateway_port=gateway_port,
            profile=str(client_spec["profile"]),
            environment=environment,
        )
        webdriver_tunnel: SshTunnel | None = None
        gateway_tunnel: SshTunnel | None = None
        try:
            self._wait_remote_actor_endpoints(
                normalized_actor,
                webdriver_port,
                gateway_port,
            )
            webdriver_tunnel = self.transport.start_local_forward(
                remote_port=webdriver_port,
                local_port=int(client_spec["webdriver_port"]),
            )
            gateway_tunnel = self.transport.start_local_forward(
                remote_port=gateway_port,
                local_port=int(client_spec["gateway_port"]),
            )
        except BaseException:
            for tunnel in (gateway_tunnel, webdriver_tunnel):
                if tunnel is not None:
                    tunnel.stop()
            self._stop_remote_actor(normalized_actor)
            self._actor_slots.pop(normalized_actor, None)
            raise
        log_path = (
            self.state_path.parent
            / "logs"
            / str(state["runId"])
            / f"{normalized_actor}.log"
        )
        log_path.parent.mkdir(parents=True, exist_ok=True)
        runtime = _ActorRuntime(
            actor=normalized_actor,
            webdriver_tunnel=webdriver_tunnel,
            gateway_tunnel=gateway_tunnel,
            log_path=log_path,
        )
        self._actors[normalized_actor] = runtime
        metadata = AppLaunchMetadata(
            webdriver_host="127.0.0.1",
            webdriver_port=webdriver_tunnel.local_port,
            gateway_port=gateway_tunnel.local_port,
            profile=str(remote["profile"]),
            storage_root=str(remote["storageRoot"]),
            process_id=int(remote["processId"]),
            log_path=log_path,
        )
        return ProvisionedTauriLauncher(
            metadata,
            release=lambda *, preserve_state=False: self.release_actor(
                normalized_actor,
                preserve_state=preserve_state,
            ),
            alive=lambda: self.actor_is_alive(normalized_actor),
        )

    def release_actor(
        self,
        actor: str,
        *,
        preserve_state: bool = False,
    ) -> None:
        runtime = self._actors.get(actor)
        if runtime is None or runtime.released:
            return
        runtime.released = True
        failures: list[str] = []
        for name, tunnel in (
            ("gateway tunnel", runtime.gateway_tunnel),
            ("WebDriver tunnel", runtime.webdriver_tunnel),
        ):
            detail = tunnel.failure_detail()
            if detail is not None:
                self._tunnel_failures.append(
                    {"actor": actor, "tunnel": name, **detail}
                )
            try:
                tunnel.stop()
            except Exception as error:
                failures.append(f"{name}: {error}")
        try:
            stopped = self._stop_remote_actor(
                actor,
                preserve_state=preserve_state,
            )
            content = str(stopped.get("logContent") or "")
            if content:
                runtime.log_path.write_bytes(
                    base64.b64decode(content, validate=True)
                )
            for field in (
                "processStopped",
                "taskReleased",
                "portsReleased",
                "storageReleased",
            ):
                if stopped.get(field) is not True:
                    failures.append(
                        f"remote actor reported {field}=false"
                    )
        except Exception as error:
            failures.append(f"remote actor: {error}")
        if failures:
            runtime.released = False
            raise ProvisioningError(
                f"Windows runtime-cell actor {actor!r} cleanup failed: "
                + "; ".join(failures)
            )
        self._actors.pop(actor, None)
        if not preserve_state:
            self._actor_slots.pop(actor, None)

    def actor_is_alive(self, actor: str) -> bool:
        runtime = self._actors.get(actor)
        if runtime is None or runtime.released:
            return False
        if (
            not runtime.webdriver_tunnel.is_alive()
            or not runtime.gateway_tunnel.is_alive()
        ):
            return False
        result = self._broker_from_state(
            self._require_state(),
            "actor-status",
            {"actor": actor},
        )
        return (
            result.get("processAlive") is True
            and result.get("taskExists") is True
        )

    def expose_orchestrator_endpoint(
        self,
        endpoint_id: str,
        url: str,
    ) -> dict[str, Any]:
        normalized = self._actor_id(endpoint_id)
        if normalized in self._endpoints:
            raise ProvisioningError(
                f"Windows runtime-cell endpoint {normalized!r} "
                "is already exposed"
            )
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username is not None
            or parsed.password is not None
        ):
            raise ProvisioningError(
                "orchestrator endpoint must be an HTTP(S) loopback URL "
                "without credentials"
            )
        try:
            port = parsed.port
        except ValueError as error:
            raise ProvisioningError(
                "orchestrator endpoint port is invalid"
            ) from error
        if port is None:
            raise ProvisioningError(
                "orchestrator endpoint must declare an explicit port"
            )
        remote_port = self.transport.available_remote_port()
        tunnel = self.transport.start_reverse_forward(
            local_port=port,
            remote_port=remote_port,
        )
        runtime = _EndpointRuntime(
            endpoint_id=normalized,
            tunnel=tunnel,
            tunnel_pid=tunnel.process_id,
            local_port=port,
            remote_port=remote_port,
        )
        self._endpoints[normalized] = runtime
        return {
            "endpointId": normalized,
            "url": urlunsplit(
                (
                    parsed.scheme,
                f"127.0.0.1:{remote_port}",
                    parsed.path,
                    parsed.query,
                    parsed.fragment,
                )
            ),
            "tunnelPid": runtime.tunnel_pid,
            "localPort": port,
            "remotePort": remote_port,
        }

    def release_endpoint(self, endpoint_id: str) -> dict[str, Any]:
        runtime = self._endpoints.get(endpoint_id)
        if runtime is None:
            return {
                "endpointId": endpoint_id,
                "released": True,
                "alreadyReleased": True,
            }
        runtime.tunnel.stop()
        deadline = time.monotonic() + 5
        while (
            time.monotonic() < deadline
            and self.transport.remote_loopback_port_listening(
                runtime.remote_port
            )
        ):
            time.sleep(0.05)
        released = (
            not runtime.tunnel.is_alive()
            and not self.transport.remote_loopback_port_listening(
                runtime.remote_port
            )
        )
        if not released:
            raise ProvisioningError(
                f"Windows runtime-cell endpoint {endpoint_id!r} "
                "did not release"
            )
        self._endpoints.pop(endpoint_id, None)
        return {
            "endpointId": endpoint_id,
            "tunnelPid": runtime.tunnel_pid,
            "localPort": runtime.local_port,
            "remotePort": runtime.remote_port,
            "released": True,
        }

    def endpoint_cleanup_audit(self) -> dict[str, Any]:
        active = [
            {
                "endpointId": endpoint_id,
                "tunnelPid": runtime.tunnel_pid,
                "localPort": runtime.local_port,
                "remotePort": runtime.remote_port,
            }
            for endpoint_id, runtime in sorted(self._endpoints.items())
            if not runtime.released
        ]
        return {
            "activeEndpointLeases": active,
            "endpointsReleased": not active,
        }

    def actor_cleanup_audit(self) -> dict[str, Any]:
        state = self._read_state()
        remote_actors: list[dict[str, Any]] = []
        if state:
            status = self._broker_from_state(state, "status", {})
            raw_actors = status.get("actors")
            if isinstance(raw_actors, list):
                remote_actors = [
                    item for item in raw_actors if isinstance(item, dict)
                ]
        active_local = sorted(
            actor
            for actor, runtime in self._actors.items()
            if not runtime.released
        )
        active_remote = sorted(
            str(actor.get("actor") or "")
            for actor in remote_actors
            if actor.get("processAlive") or actor.get("taskExists")
        )
        return {
            "activeLocalActors": active_local,
            "activeRemoteActors": active_remote,
            "tunnelFailures": list(self._tunnel_failures),
            "portsReleased": not active_local and not active_remote,
            "processesReleased": not active_remote,
            "storageReleased": not active_remote,
        }

    def validate_binding(self, gate_id: str, source_commit: str) -> None:
        state = self._require_state()
        manifest = state.get("manifest")
        source = manifest.get("source") if isinstance(manifest, dict) else None
        if not isinstance(manifest, dict) or manifest.get("gateId") != gate_id:
            raise ProvisioningError(
                "Windows runtime-cell Gate identity does not match"
            )
        if not isinstance(source, dict) or source.get("commit") != source_commit:
            raise ProvisioningError(
                "Windows runtime-cell source commit does not match"
            )

    def binary_identity(self) -> dict[str, str]:
        state = self._require_state()
        return {
            "path": (
                f"runtime-cell:{self.contract.cell_id}:"
                f"{state['runId']}:{_BINARY_RELATIVE_PATH}"
            ),
            "sha256": _digest(
                str(state.get("binarySha256") or ""),
                "Windows binary digest",
            ),
            "sourceCommit": str(state.get("sourceCommit") or ""),
        }

    def runtime_identity(self) -> dict[str, Any]:
        state = self._require_state()
        manifest = state.get("manifest")
        if not isinstance(manifest, dict):
            raise ProvisioningError(
                "Windows runtime-cell manifest is missing"
            )
        return dict(manifest)

    def stage_actor_file(self, actor: str, source: Path) -> str:
        state = self._require_state()
        normalized = self._active_actor(actor)
        local_source = source.expanduser().resolve()
        if not local_source.is_file() or not _FILE_NAME.fullmatch(
            local_source.name
        ):
            raise ProvisioningError(
                "Windows runtime-cell fixture source is invalid"
            )
        source_identity = hashlib.sha256(
            os.fsencode(local_source)
        ).hexdigest()
        content_digest = hashlib.sha256(local_source.read_bytes()).hexdigest()
        remote_path = _windows_join(
            str(state["brokerRoot"]),
            "actors",
            normalized,
            "fixtures",
            source_identity,
            local_source.name,
        )
        self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                (
                    "New-Item -ItemType Directory -Force -Path "
                    f"'{str(PureWindowsPath(remote_path).parent).replace(chr(39), chr(39) * 2)}' "
                    "| Out-Null"
                ),
            ),
            timeout=15,
            check=True,
        )
        self.transport.copy_file(local_source, remote_path, timeout=60)
        if self.actor_file_sha256(normalized, remote_path) != content_digest:
            raise ProvisioningError(
                "Windows runtime-cell staged fixture digest mismatch"
            )
        return remote_path

    def actor_file_sha256(self, actor: str, path: str) -> str:
        state = self._require_state()
        normalized = self._active_actor(actor)
        candidate = _normalized_windows_path(path)
        fixture_root = _windows_join(
            str(state["brokerRoot"]),
            "actors",
            normalized,
            "fixtures",
        )
        runtime_actor_root = _windows_join(
            str(state["brokerRoot"]),
            "actors",
            str(state["runId"]),
            normalized,
        )
        if (
            not candidate.is_absolute()
            or not any(
                _windows_path_is_descendant(str(candidate), root)
                for root in (fixture_root, runtime_actor_root)
            )
        ):
            raise ProvisioningError(
                "Windows runtime-cell file is outside actor root"
            )
        io_path = _windows_verbatim_path(str(candidate))
        completed = self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                (
                    "(Get-FileHash -Algorithm SHA256 -LiteralPath "
                    f"'{io_path.replace(chr(39), chr(39) * 2)}').Hash"
                ),
            ),
            timeout=15,
            check=True,
        )
        return _digest(
            completed.stdout.strip(),
            "Windows actor file digest",
        )

    def clone_actor_storage(
        self,
        source_actor: str,
        target_actor: str,
        relative_path: str,
    ) -> None:
        state = self._require_state()
        source = self._active_actor(source_actor)
        target = self._actor_id(target_actor)
        relative = PureWindowsPath(relative_path)
        if (
            not relative_path
            or relative.is_absolute()
            or ".." in relative.parts
        ):
            raise ProvisioningError(
                "Windows runtime-cell actor storage path is invalid"
            )
        if target in self._actors:
            raise ProvisioningError(
                f"Windows runtime-cell actor {target!r} is active"
            )
        source_path = _windows_verbatim_path(_windows_join(
            str(state["brokerRoot"]),
            "actors",
            str(state["runId"]),
            source,
            "storage",
            str(relative),
        ))
        target_path = _windows_verbatim_path(_windows_join(
            str(state["brokerRoot"]),
            "actors",
            str(state["runId"]),
            target,
            "storage",
            str(relative),
        ))
        script = (
            "$ErrorActionPreference='Stop'; "
            f"if (Test-Path -LiteralPath '{target_path}') {{ "
            "throw 'target storage already exists' }; "
            f"New-Item -ItemType Directory -Force -Path "
            f"'{str(PureWindowsPath(target_path).parent)}' | Out-Null; "
            f"Copy-Item -Recurse -LiteralPath '{source_path}' "
            f"-Destination '{target_path}'"
        )
        self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ),
            timeout=60,
            check=True,
        )

    def execute_adapter(
        self,
        operation: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        return self._broker_from_state(
            self._require_state(),
            "adapter",
            {
                "adapterOperation": operation,
                "requestId": f"adapter-{secrets.token_hex(8)}",
                "payload": payload,
                "sourceRoot": self._require_state()["remoteSource"],
            },
        )

    def logs(self, tail: int = 200) -> str:
        state = self._require_state()
        status = self._broker_from_state(state, "status", {})
        lines = json.dumps(status, indent=2, sort_keys=True).splitlines()
        return "\n".join(lines[-max(1, min(tail, 2000)):])

    def stop(self) -> dict[str, Any]:
        state = self._read_state()
        failures: list[str] = []
        for actor in reversed(tuple(self._actors)):
            try:
                self.release_actor(actor)
            except Exception as error:
                failures.append(f"actor {actor}: {error}")
        for endpoint_id in reversed(tuple(self._endpoints)):
            try:
                self.release_endpoint(endpoint_id)
            except Exception as error:
                failures.append(f"endpoint {endpoint_id}: {error}")
        if state:
            try:
                cleanup = self._broker_from_state(state, "cleanup", {})
                if cleanup.get("clean") is not True:
                    failures.append("remote broker reported clean=false")
            except Exception as error:
                failures.append(f"remote broker: {error}")
                cleanup = {"clean": False}
            try:
                self._clean_remote_source(
                    str(state["remoteSource"]),
                    str(state["sourceCommit"]),
                )
            except Exception as error:
                failures.append(f"source workspace: {error}")
        else:
            cleanup = {"clean": True, "alreadyClean": True}
        try:
            self._release_source_lease()
        except Exception as error:
            failures.append(f"source lease: {error}")
        if failures:
            raise ProvisioningError(
                "Windows runtime-cell cleanup failed: "
                + "; ".join(failures)
            )
        self.state_path.unlink(missing_ok=True)
        return {
            "cellId": self.contract.cell_id,
            "state": RuntimeCellState.CLEANED.value,
            "remote": cleanup,
        }

    def _clean_remote_source(
        self,
        remote_source: str,
        source_commit: str,
    ) -> None:
        completed = self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                (
                    "$ErrorActionPreference='Stop'; "
                    f"git -C '{remote_source}' config core.longpaths true; "
                    f"git -C '{remote_source}' reset --hard "
                    f"'{source_commit}' | Out-Null; "
                    f"git -C '{remote_source}' clean -ffdqx; "
                    f"$head=(git -C '{remote_source}' rev-parse HEAD).Trim(); "
                    f"$dirty=git -C '{remote_source}' status --porcelain "
                    "--ignored --untracked-files=all; "
                    f"if ($head -ne '{source_commit}' -or "
                    "-not [string]::IsNullOrWhiteSpace(($dirty -join ''))) { "
                    "throw 'source workspace cleanup audit failed' }"
                ),
            ),
            timeout=180,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise ProvisioningError(
                f"Windows source workspace cleanup failed: {detail[-4000:]}"
            )

    def _source_request(self) -> SourceSyncRequest:
        return SourceSyncRequest.from_env_files(
            self.profile.deploy_environment,
            source_root=self.source_root,
            environments_dir=self.deploy_root,
            central_environment_path=(
                REPO_ROOT / ".local" / "deploy" / "git-server.env"
            ),
            require_clean=self.contract.source.clean_commit_required_for_proof,
            remote_platform=RemotePlatform.WINDOWS,
        )

    def _ensure_remote_source_repository(
        self,
        remote_home: str,
        deploy_path: str,
    ) -> None:
        remote_source = _windows_join(remote_home, deploy_path)
        command = (
            "$ErrorActionPreference='Stop'; "
            f"New-Item -ItemType Directory -Force -Path "
            f"'{remote_source}' | Out-Null; "
            f"if (-not (Test-Path -LiteralPath "
            f"'{_windows_join(remote_source, '.git')}')) {{ "
            f"git init '{remote_source}' | Out-Null }}; "
            f"git -C '{remote_source}' config core.longpaths true"
        )
        self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                command,
            ),
            timeout=60,
            check=True,
        )

    def _release_source_lease(self) -> None:
        lease = self._source_lease
        if lease is None:
            return
        lease.release()
        self._source_lease = None

    def _sync_source(self, remote_home: str) -> SourceSyncResult:
        request = self._source_request()
        commit, source_digest = RemoteSourceSynchronizer(request).preflight()
        remote_source = _windows_join(remote_home, request.deploy_path)
        remote_head = self.transport.run_argv(
            ("git", "-C", remote_source, "rev-parse", "HEAD"),
            timeout=15,
            check=False,
        )
        current_commit = (
            remote_head.stdout.strip()
            if remote_head.returncode == 0
            else ""
        )
        if current_commit != commit:
            with tempfile.TemporaryDirectory(
                prefix="pt-windows-source-"
            ) as directory:
                bundle = Path(directory) / "source.bundle"
                revision = request.branch
                created = subprocess.run(
                    (
                        "git",
                        "-C",
                        str(self.source_root),
                        "bundle",
                        "create",
                        str(bundle),
                        revision,
                    ),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    check=False,
                )
                if created.returncode != 0:
                    detail = created.stderr.strip() or created.stdout.strip()
                    raise ProvisioningError(
                        f"Windows source bundle creation failed: {detail}"
                    )
                remote_bundle = _windows_join(
                    remote_home,
                    "AppData",
                    "Local",
                    "Temp",
                    f"pt-source-{secrets.token_hex(8)}.bundle",
                )
                self.transport.copy_file(bundle, remote_bundle, timeout=300)
                try:
                    self.transport.run_argv(
                        (
                            "powershell.exe",
                            "-NoProfile",
                            "-NonInteractive",
                            "-Command",
                            (
                                "$ErrorActionPreference='Stop'; "
                                f"New-Item -ItemType Directory -Force -Path "
                                f"'{remote_source}' | Out-Null; "
                                f"if (-not (Test-Path -LiteralPath "
                                f"'{_windows_join(remote_source, '.git')}')) {{ "
                                f"git init '{remote_source}' | Out-Null }}; "
                                f"git -C '{remote_source}' config "
                                "core.longpaths true; "
                                f"git -C '{remote_source}' fetch "
                                f"'{remote_bundle}' '{commit}'; "
                                f"git -C '{remote_source}' checkout -f "
                                f"-B '{request.branch}' '{commit}'"
                            ),
                        ),
                        timeout=600,
                        check=True,
                    )
                finally:
                    self.transport.run_argv(
                        (
                            "powershell.exe",
                            "-NoProfile",
                            "-NonInteractive",
                            "-Command",
                            f"Remove-Item -Force -LiteralPath '{remote_bundle}'",
                        ),
                        timeout=30,
                        check=False,
                    )
        self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                (
                    "$ErrorActionPreference='Stop'; "
                    f"git -C '{remote_source}' reset --hard "
                    f"'{commit}' | Out-Null; "
                    f"git -C '{remote_source}' clean -ffdqx"
                ),
            ),
            timeout=180,
            check=True,
        )
        identity = self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                (
                    f"$head=git -C '{remote_source}' rev-parse HEAD; "
                    f"$dirty=git -C '{remote_source}' status --porcelain "
                    "--untracked-files=all; "
                    "[pscustomobject]@{commit=$head.Trim(); "
                    "clean=[string]::IsNullOrWhiteSpace(($dirty -join ''))} "
                    "| ConvertTo-Json -Compress"
                ),
            ),
            timeout=30,
            check=True,
        )
        try:
            observed = json.loads(identity.stdout.strip())
        except json.JSONDecodeError as error:
            raise ProvisioningError(
                "Windows source identity returned invalid JSON"
            ) from error
        if (
            observed.get("commit") != commit
            or observed.get("clean") is not True
        ):
            raise ProvisioningError(
                "Windows source checkout identity validation failed"
            )
        return SourceSyncResult(
            environment_name=request.environment_name,
            branch=request.branch,
            commit=commit,
            remote_commit=commit,
            remote_source_digest=source_digest,
            remote_checkout_clean=True,
            source_mode=request.source_mode,
            deploy_path=request.deploy_path,
        )

    def _build_binary(
        self,
        remote_source: str,
        remote_home: str,
    ) -> tuple[str, str]:
        cargo_target_root = _windows_join(
            remote_home,
            self.profile.cargo_target_root,
        )
        binary_path = _windows_join(
            cargo_target_root,
            _BINARY_RELATIVE_PATH,
        )
        build_script = _windows_join(
            remote_source,
            _BUILD_SCRIPT_RELATIVE_PATH,
        )
        completed = self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                build_script,
                "-SourceRoot",
                remote_source,
                "-CargoTargetRoot",
                cargo_target_root,
                "-VsDevCmd",
                self.profile.vsdevcmd_path,
                "-WindowsSdkRoot",
                self.profile.windows_sdk_root.rstrip("/\\"),
                "-WindowsSdkVersion",
                self.profile.windows_sdk_version.rstrip("/\\"),
                "-PerlPath",
                self.profile.perl_path,
                "-ProtocPath",
                self.profile.protoc_path,
            ),
            timeout=self.profile.build_timeout_seconds,
            check=False,
        )
        if completed.returncode != 0:
            detail = "\n".join(
                output.strip()
                for output in (completed.stdout, completed.stderr)
                if output.strip()
            )
            raise BlockedError(
                reason=f"Windows Desktop build failed: {detail[-8000:]}",
                resource="runtime-cell-binary:desktop-windows-native",
            )
        digest = self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                (
                    "(Get-FileHash -Algorithm SHA256 -LiteralPath "
                    f"'{binary_path}').Hash"
                ),
            ),
            timeout=30,
            check=True,
        )
        return binary_path, _digest(
            digest.stdout.strip(),
            "Windows Desktop binary digest",
        )

    def _launch_remote_actor(
        self,
        *,
        actor: str,
        webdriver_port: int,
        gateway_port: int,
        profile: str,
        environment: dict[str, str],
    ) -> dict[str, Any]:
        state = self._require_state()
        actor_root = _windows_join(
            str(state["brokerRoot"]),
            "actors",
            str(state["runId"]),
            actor,
        )
        actor_state_root = _windows_join(
            str(state["brokerRoot"]),
            "state",
            str(state["runId"]),
            actor,
        )
        return self._broker_from_state(
            state,
            "launch-actor",
            {
                "actor": actor,
                "executable": state["binaryPath"],
                "arguments": [],
                "environment": {
                    **environment,
                    "PT_PROFILE": profile,
                },
                "webdriverPort": webdriver_port,
                "gatewayPort": gateway_port,
                "profile": profile,
                "storageRoot": actor_state_root,
                "logPath": _windows_join(actor_root, "logs", "desktop.log"),
            },
        )

    def _stop_remote_actor(
        self,
        actor: str,
        *,
        preserve_state: bool = False,
    ) -> dict[str, Any]:
        return self._broker_from_state(
            self._require_state(),
            "stop-actor",
            {"actor": actor, "preserveState": preserve_state},
        )

    def _wait_remote_actor_endpoints(
        self,
        actor: str,
        webdriver_port: int,
        gateway_port: int,
        *,
        timeout: float = 60,
    ) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            webdriver_ready = self.transport.remote_loopback_port_listening(
                webdriver_port
            )
            gateway_ready = self.transport.remote_loopback_port_listening(
                gateway_port
            )
            if webdriver_ready and gateway_ready:
                return
            time.sleep(0.25)
        status = self._broker_from_state(
            self._require_state(),
            "status",
            {},
        )
        raise ProvisioningError(
            f"Windows runtime-cell actor {actor!r} endpoints did not become "
            f"ready: webdriver={webdriver_port} gateway={gateway_port} "
            f"broker={json.dumps(status, sort_keys=True)}"
        )

    def _probe_adapter(self, process_id: int) -> dict[str, Any]:
        control: dict[str, Any] = {}
        screenshot = self.execute_adapter("probe_screenshot", {})
        width, height = _screenshot_probe_geometry(screenshot)
        center = [width / 2, height / 2]
        stack = self.execute_adapter(
            "window_stack_at_point",
            {"point": center},
        )
        point_owned = any(
            isinstance(window, dict)
            and int(window.get("ownerPid") or -1) == process_id
            for window in stack.get("windows", [])
        )
        if point_owned:
            self.execute_adapter(
                "post_mouse",
                {
                    "actions": ["move", "left-down", "left-up"],
                    "point": center,
                },
            )
        focus_deadline = time.monotonic() + 10
        while time.monotonic() < focus_deadline:
            control = self.execute_adapter(
                "activate_process",
                {"processId": process_id},
            )
            if (
                control.get("frontmost") is True
                and control.get("focusedWindow") is True
            ):
                break
            time.sleep(0.25)
        return {
            "input": True,
            "focus": (
                control.get("frontmost") is True
                and control.get("focusedWindow") is True
            ),
            "pointOwnership": point_owned,
            "screenshot": bool(screenshot.get("content")),
            "width": width,
            "height": height,
        }

    def _broker_from_state(
        self,
        state: dict[str, Any],
        operation: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        return self._broker(
            str(state["brokerPath"]),
            str(state["brokerRoot"]),
            operation,
            {"runId": state["runId"], **payload},
        )

    def _broker(
        self,
        broker_path: str,
        broker_root: str,
        operation: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        request = {
            **payload,
            "operation": operation,
            "root": broker_root,
            "desktopUser": self.profile.desktop_user,
        }
        encoded = base64.b64encode(
            json.dumps(request, sort_keys=True).encode("utf-8")
        ).decode("ascii")
        completed = self.transport.run_argv(
            (
                self.profile.python_executable,
                broker_path,
                "--request",
                encoded,
            ),
            timeout=120,
            check=False,
        )
        return _json_output(completed, f"broker {operation}")

    def _host_preflight(self) -> dict[str, Any]:
        script = (
            "$ErrorActionPreference='Stop'; "
            "$os=Get-CimInstance Win32_OperatingSystem; "
            "$session=Get-Process explorer -IncludeUserName "
            "-ErrorAction SilentlyContinue | Where-Object "
            f"{{$_.UserName -like '*\\{self.profile.desktop_user}' "
            f"-or $_.UserName -eq '{self.profile.desktop_user}'}} "
            "| Select-Object -First 1; "
            "$webview=Get-ChildItem "
            "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients' "
            "-ErrorAction SilentlyContinue | ForEach-Object { "
            "Get-ItemProperty $_.PSPath } | Where-Object { "
            "$_.name -like '*WebView2*' } | Select-Object -First 1; "
            "$perlVersion=''; "
            f"if (Test-Path -LiteralPath '{self.profile.perl_path}') {{ "
            f"$perlVersion=& '{self.profile.perl_path}' "
            "-MLocale::Maketext::Simple -e 'print $^V' }; "
            "$protocVersion=''; "
            f"if (Test-Path -LiteralPath '{self.profile.protoc_path}') {{ "
            f"$protocVersion=& '{self.profile.protoc_path}' --version }}; "
            "[pscustomobject]@{caption=$os.Caption; version=$os.Version; "
            "build=$os.BuildNumber; architecture=$os.OSArchitecture; "
            "webviewVersion=$(if ($webview) {$webview.pv} else {''}); "
            "perlVersion=$perlVersion; protocVersion=$protocVersion; "
            "interactive=($null -ne $session); sessionId="
            "$(if ($session) {$session.SessionId} else {-1})} "
            "| ConvertTo-Json -Compress"
        )
        completed = self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ),
            timeout=30,
            check=True,
        )
        try:
            host = json.loads(completed.stdout.strip())
        except json.JSONDecodeError as error:
            raise ProvisioningError(
                "Windows host preflight returned invalid JSON"
            ) from error
        if (
            not isinstance(host, dict)
            or not str(host.get("webviewVersion") or "")
            or not str(host.get("perlVersion") or "")
            or not str(host.get("protocVersion") or "")
        ):
            raise BlockedError(
                reason=(
                    "Windows runtime-cell host is missing WebView2 or a "
                    "configured build toolchain dependency"
                ),
                resource=f"runtime-cell-host:{self.contract.cell_id}",
            )
        return host

    def _require_interactive_desktop(
        self,
        host: dict[str, Any],
    ) -> None:
        if host.get("interactive") is not True:
            raise BlockedError(
                reason=(
                    "Windows runtime-cell host has no matching interactive "
                    "desktop session and connected display"
                ),
                resource=f"runtime-cell-host:{self.contract.cell_id}",
            )

    def _remote_home(self) -> str:
        completed = self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Environment]::GetFolderPath('UserProfile')",
            ),
            timeout=15,
            check=True,
        )
        home = completed.stdout.strip()
        if not PureWindowsPath(home).is_absolute():
            raise ProvisioningError(
                "Windows remote home resolution returned a relative path"
            )
        return home

    def _assert_remote_ports_free(self, *ports: int) -> None:
        script = (
            "$listeners=@(); try { "
            + " ".join(
                (
                    "$listener=[Net.Sockets.TcpListener]::new("
                    f"[Net.IPAddress]::Loopback,{port}); "
                    "$listener.Start(); $listeners += $listener;"
                )
                for port in ports
            )
            + " } finally { $listeners | ForEach-Object { $_.Stop() } }"
        )
        completed = self.transport.run_argv(
            (
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ),
            timeout=15,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise BlockedError(
                reason=f"Windows runtime-cell port preflight failed: {detail}",
                resource=f"runtime-cell-ports:{self.contract.cell_id}",
            )

    def _actor_remote_ports(self, actor: str) -> tuple[int, int]:
        if actor not in self._actor_slots:
            used = set(self._actor_slots.values())
            slot = next(
                (candidate for candidate in range(1024) if candidate not in used),
                None,
            )
            if slot is None:
                raise ProvisioningError(
                    "Windows runtime-cell actor port range is exhausted"
                )
            self._actor_slots[actor] = slot
        slot = self._actor_slots[actor]
        webdriver = self.profile.webdriver_port + slot
        gateway = self.profile.gateway_port + slot
        if webdriver > 65535 or gateway > 65535 or webdriver == gateway:
            self._actor_slots.pop(actor, None)
            raise ProvisioningError(
                f"Windows runtime-cell actor {actor!r} has no valid port pair"
            )
        return webdriver, gateway

    def _manifest(
        self,
        *,
        gate_id: str,
        run_id: str,
        expires_at: datetime,
        host: dict[str, Any],
        source: SourceSyncResult,
        binary_sha256: str,
        adapter: dict[str, Any],
        webdriver_local_port: int,
    ) -> RuntimeCellManifest:
        host_key_path = (
            Path(self.target.known_hosts_file).expanduser()
            if self.target.known_hosts_file
            else Path.home() / ".ssh" / "known_hosts"
        )
        host_key = subprocess.run(
            (
                "ssh-keygen",
                "-F",
                self.target.host,
                "-f",
                str(host_key_path),
            ),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        ).stdout
        if not host_key:
            raise ProvisioningError(
                "Windows runtime-cell host key is not pinned"
            )
        host_identity = "|".join(
            str(host.get(field) or "")
            for field in ("caption", "version", "build", "architecture")
        )
        return RuntimeCellManifest(
            cell_id=self.contract.cell_id,
            gate_id=gate_id,
            run_id=run_id,
            state=RuntimeCellState.LEASED,
            platform=CellPlatformIdentity(
                os="windows",
                host_distribution=str(host.get("caption") or ""),
                host_kernel=str(host.get("build") or ""),
                isolation_kind="host",
                image_digest="",
                distribution=str(host.get("caption") or ""),
                architecture="x86_64",
                webview_backend="WebView2",
                webview_version=str(host.get("webviewVersion") or ""),
            ),
            transport=CellTransportIdentity(
                kind="ssh",
                host_identity_sha256=hashlib.sha256(
                    host_identity.encode("utf-8")
                ).hexdigest(),
                host_key_sha256=hashlib.sha256(
                    host_key.encode("utf-8")
                ).hexdigest(),
                webdriver_local_port=webdriver_local_port,
                webdriver_remote_port=self.profile.webdriver_port,
            ),
            display=CellDisplayIdentity(
                session_type="native-windows",
                display_id=hashlib.sha256(
                    (
                        self.contract.cell_id
                        + "|"
                        + str(host.get("sessionId"))
                    ).encode("utf-8")
                ).hexdigest()[:16],
                seat=str(host.get("sessionId") or ""),
                width=int(adapter.get("width") or 0),
                height=int(adapter.get("height") or 0),
                connected_output=True,
                desktop_user_identity_sha256=hashlib.sha256(
                    self.profile.desktop_user.encode("utf-8")
                ).hexdigest(),
            ),
            source=CellSourceIdentity(
                mode=self.contract.source.mode,
                commit=source.commit,
                workspace_digest="clean",
                remote_source_digest=_digest(
                    source.remote_source_digest,
                    "Windows source digest",
                ),
                remote_checkout_clean=source.remote_checkout_clean,
                binary_sha256=binary_sha256,
            ),
            native_adapter=CellAdapterIdentity(
                input_backend=self.contract.native_adapter.input,
                window_backend=self.contract.native_adapter.window,
                screenshot_backend=self.contract.native_adapter.screenshot,
                input_probe=adapter.get("input") is True,
                focus_probe=adapter.get("focus") is True,
                point_ownership_probe=(
                    adapter.get("pointOwnership") is True
                ),
                screenshot_probe=adapter.get("screenshot") is True,
            ),
            lease_owner_run_id=run_id,
            lease_expires_at=expires_at.isoformat(),
            cleanup_registered=True,
            cleanup_resources=self.contract.cleanup_resources,
        )

    def _local_is_ancestor(self, ancestor: str, descendant: str) -> bool:
        completed = subprocess.run(
            (
                "git",
                "-C",
                str(self.source_root),
                "merge-base",
                "--is-ancestor",
                ancestor,
                descendant,
            ),
            capture_output=True,
            check=False,
        )
        return completed.returncode == 0

    @staticmethod
    def _actor_id(actor: str) -> str:
        normalized = actor.strip()
        if not _IDENTIFIER.fullmatch(normalized):
            raise ProvisioningError(
                "Windows runtime-cell actor or endpoint id is invalid"
            )
        return normalized

    def _active_actor(self, actor: str) -> str:
        normalized = self._actor_id(actor)
        runtime = self._actors.get(normalized)
        if runtime is None or runtime.released:
            raise ProvisioningError(
                f"Windows runtime-cell actor {normalized!r} is not active"
            )
        return normalized

    def _write_state(self, payload: dict[str, Any]) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        os.chmod(temporary, 0o600)
        temporary.replace(self.state_path)

    def _read_state(self) -> dict[str, Any]:
        try:
            payload = json.loads(
                self.state_path.read_text(encoding="utf-8")
            )
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError) as error:
            raise ProvisioningError(
                f"Windows runtime-cell state is invalid: {error}"
            ) from error
        if not isinstance(payload, dict):
            raise ProvisioningError(
                "Windows runtime-cell state is not an object"
            )
        return payload

    def _require_state(self) -> dict[str, Any]:
        state = self._read_state()
        if not state:
            raise BlockedError(
                reason=(
                    f"Windows runtime cell {self.contract.cell_id} "
                    "is not active"
                ),
                resource=f"runtime-cell:{self.contract.cell_id}",
            )
        return state


def _new_run_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return f"{timestamp.lower()}-{secrets.token_hex(8)}"
