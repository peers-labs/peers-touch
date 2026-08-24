from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import sys
import textwrap
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
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
from tooling.acceptance.drivers.tauri import ProvisionedTauriLauncher
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.lease import RemoteGitSourceLease
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.core.source_sync import (
    RemoteSourceSynchronizer,
    SourceSyncRequest,
)
from tooling.acceptance.transports.ssh import (
    SshTarget,
    SshTransport,
    SshTunnel,
)


_IMAGE_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,255}$")
_DISPLAY = re.compile(r"^:[1-9][0-9]{0,3}$")
_SHA256 = re.compile(r"^(?:sha256:)?([0-9a-f]{64})$")
_HTTPS_URL = re.compile(r"^https://[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$")
_CARGO_INDEX = re.compile(
    r"^(?:sparse\+)?https://[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$"
)
_ENDPOINT_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_DEFAULT_PROFILE_ROOT = REPO_ROOT / ".local" / "acceptance" / "runtime-cells"
_DEFAULT_DEPLOY_ROOT = REPO_ROOT / ".local" / "deploy" / "envs"
_DEFAULT_RUNTIME_ROOT = ".cache/peers-touch/acceptance-cells"
_DEFAULT_CACHE_ROOT = ".cache/peers-touch/build/desktop-linux-native"
_BASE_IMAGE_DIGEST = (
    "33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517"
)
_CONTAINERFILE = (
    "tooling/acceptance/images/desktop-linux/Containerfile"
)
_IMAGE_CONTEXT = "tooling/acceptance/images/desktop-linux"
_REMOTE_CONTROL = (
    "tooling/acceptance/images/desktop-linux/remote_control.py"
)
_LOCAL_TUNNEL_SUPERVISOR = (
    REPO_ROOT
    / "tooling"
    / "acceptance"
    / "provisioners"
    / "local_tunnel_supervisor.py"
)
_BINARY_RELATIVE_PATH = "bin/peers-touch-desktop"
_REMOTE_CLEANUP_AUDIT_SCRIPT = textwrap.dedent(
    """
    import json
    import pathlib
    import socket
    import subprocess
    import sys

    home = pathlib.Path.home()
    cell_root = home / sys.argv[1] / sys.argv[2]
    run_id = sys.argv[3]
    containers = sys.argv[4:6]
    ports = [int(value) for value in sys.argv[6:9]]
    source = pathlib.Path(sys.argv[9])
    expected_commit = sys.argv[10]

    remaining = []
    for name in containers:
        if not name:
            continue
        inspected = subprocess.run(
            ("docker", "inspect", name),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if inspected.returncode == 0:
            remaining.append(name)

    active_ports = []
    for port in ports:
        try:
            connection = socket.create_connection(
                ("127.0.0.1", port),
                timeout=0.2,
            )
            connection.close()
            active_ports.append(port)
        except OSError:
            pass

    head = subprocess.run(
        ("git", "-C", str(source), "rev-parse", "HEAD"),
        capture_output=True,
        text=True,
    )
    dirty = subprocess.run(
        ("git", "-C", str(source), "status", "--porcelain=v1"),
        capture_output=True,
        text=True,
    )
    payload = {
        "containers": remaining,
        "activePorts": active_ports,
        "leaseExists": (cell_root / "lease" / "lease.json").exists(),
        "runExists": (cell_root / "runs" / run_id).exists(),
        "sourceCommitMatches": (
            head.returncode == 0
            and head.stdout.strip() == expected_commit
        ),
        "sourceClean": dirty.returncode == 0 and not dirty.stdout.strip(),
    }
    payload["clean"] = (
        not remaining
        and not active_ports
        and not payload["leaseExists"]
        and not payload["runExists"]
        and payload["sourceCommitMatches"]
        and payload["sourceClean"]
    )
    print(json.dumps(payload, sort_keys=True))
    """
).strip()
_NATIVE_ADAPTER_PROBE_SCRIPT = textwrap.dedent(
    """
    import json
    import os
    import pathlib
    import sys
    import time

    from Xlib import display as xdisplay
    from tooling.acceptance.drivers.native.base import MouseAction
    from tooling.acceptance.drivers.native.linux_x11 import (
        LinuxX11NativeDesktopAdapter,
    )

    os.environ["DBUS_SESSION_BUS_ADDRESS"] = pathlib.Path(
        "/workspace/run/dbus.state"
    ).read_text(encoding="utf-8").splitlines()[0]
    adapter = LinuxX11NativeDesktopAdapter(sys.argv[1])
    process_id = int(sys.argv[2])
    adapter.activate_process(process_id)
    time.sleep(0.2)
    control = adapter.focused_control(process_id)

    probe_display = xdisplay.Display(sys.argv[1])
    root = probe_display.screen().root
    active = root.get_full_property(
        probe_display.intern_atom("_NET_ACTIVE_WINDOW"),
        probe_display.intern_atom("WINDOW"),
    )
    active_window = probe_display.create_resource_object(
        "window",
        active.value[0],
    )
    geometry = active_window.get_geometry()
    origin = root.translate_coords(active_window, 0, 0)
    point = (
        origin.x + geometry.width / 2,
        origin.y + geometry.height / 2,
    )
    adapter.post_mouse((MouseAction.MOVE,), point)
    pointer = root.query_pointer()
    input_ok = (
        abs(pointer.root_x - point[0]) <= 1
        and abs(pointer.root_y - point[1]) <= 1
    )
    probe_display.close()

    stack = adapter.window_stack_at_point(point)
    shot = pathlib.Path(sys.argv[3])
    adapter.capture_screenshot(shot)
    payload = {
        "input": input_ok,
        "focus": (
            control.frontmost
            and control.focused_window
            and not control.error
        ),
        "pointOwnership": stack.point_owned_by(process_id),
        "screenshot": shot.is_file() and shot.stat().st_size > 0,
        "control": control.to_dict(),
        "windowStack": stack.to_dict(),
    }
    sys.stdout.write(json.dumps(payload, sort_keys=True))
    """
).strip()


@dataclass(frozen=True)
class LinuxCellProfile:
    name: str
    deploy_environment: str
    image_ref: str
    base_image_ref: str
    node_dist_url: str
    rustup_dist_server: str
    rustup_update_root: str
    cargo_registry_index: str
    display: str
    webdriver_port: int
    gateway_port: int
    observer_port: int
    runtime_root: str = _DEFAULT_RUNTIME_ROOT
    cache_root: str = _DEFAULT_CACHE_ROOT
    cache_retention_days: int = 14

    @classmethod
    def load(
        cls,
        contract: RuntimeCellContract,
        *,
        profile_root: Path = _DEFAULT_PROFILE_ROOT,
    ) -> "LinuxCellProfile":
        prefix = "profile:"
        target_ref = contract.transport.target_ref
        if not target_ref.startswith(prefix):
            raise ProvisioningError(
                f"Linux runtime cell target must use {prefix!r}"
            )
        name = target_ref.removeprefix(prefix)
        configured = os.environ.get("PT_ACCEPTANCE_CELL_PROFILE_FILE", "")
        path = (
            Path(configured).expanduser()
            if configured
            else profile_root / f"{name}.env"
        )
        if not path.is_file():
            raise BlockedError(
                reason=(
                    f"Linux runtime-cell profile is missing: {path}. "
                    "Create it from the documented profile contract."
                ),
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
            image_ref=_required(
                values,
                "PT_ACCEPTANCE_CELL_IMAGE",
                path,
            ),
            base_image_ref=values.get(
                "PT_ACCEPTANCE_CELL_BASE_IMAGE",
                (
                    "ubuntu@sha256:"
                    + _BASE_IMAGE_DIGEST
                ),
            ),
            node_dist_url=values.get(
                "PT_ACCEPTANCE_CELL_NODE_DIST_URL",
                "https://nodejs.org/dist",
            ).rstrip("/"),
            rustup_dist_server=values.get(
                "PT_ACCEPTANCE_CELL_RUSTUP_DIST_SERVER",
                "https://static.rust-lang.org",
            ).rstrip("/"),
            rustup_update_root=values.get(
                "PT_ACCEPTANCE_CELL_RUSTUP_UPDATE_ROOT",
                "https://static.rust-lang.org/rustup",
            ).rstrip("/"),
            cargo_registry_index=values.get(
                "PT_ACCEPTANCE_CELL_CARGO_REGISTRY_INDEX",
                "sparse+https://index.crates.io/",
            ),
            display=values.get("PT_ACCEPTANCE_CELL_DISPLAY", ":99"),
            webdriver_port=_port(
                values,
                "PT_ACCEPTANCE_CELL_WEBDRIVER_PORT",
                4445,
                path,
            ),
            gateway_port=_port(
                values,
                "PT_ACCEPTANCE_CELL_GATEWAY_PORT",
                3030,
                path,
            ),
            observer_port=_port(
                values,
                "PT_ACCEPTANCE_CELL_OBSERVER_PORT",
                5909,
                path,
            ),
            runtime_root=values.get(
                "PT_ACCEPTANCE_CELL_RUNTIME_ROOT",
                _DEFAULT_RUNTIME_ROOT,
            ),
            cache_root=values.get(
                "PT_ACCEPTANCE_CELL_CACHE_ROOT",
                _DEFAULT_CACHE_ROOT,
            ),
            cache_retention_days=_positive_int(
                values,
                "PT_ACCEPTANCE_CELL_CACHE_RETENTION_DAYS",
                14,
                path,
            ),
        )
        profile.validate()
        return profile

    def validate(self) -> None:
        if not _IMAGE_REF.fullmatch(self.image_ref):
            raise ProvisioningError("Linux runtime-cell image reference is invalid")
        if not _IMAGE_REF.fullmatch(self.base_image_ref) or "@sha256:" not in (
            self.base_image_ref
        ):
            raise ProvisioningError(
                "Linux runtime-cell base image must be digest-pinned"
            )
        if self.base_image_ref.rsplit("@sha256:", 1)[-1] != _BASE_IMAGE_DIGEST:
            raise ProvisioningError(
                "Linux runtime-cell base image digest does not match Containerfile"
            )
        for name, value in (
            ("Node distribution URL", self.node_dist_url),
            ("rustup distribution server", self.rustup_dist_server),
            ("rustup update root", self.rustup_update_root),
        ):
            if not _HTTPS_URL.fullmatch(value):
                raise ProvisioningError(
                    f"Linux runtime-cell {name} must be an HTTPS URL"
                )
        if not _CARGO_INDEX.fullmatch(self.cargo_registry_index):
            raise ProvisioningError(
                "Linux runtime-cell Cargo registry index must be an HTTPS URL"
            )
        if not _DISPLAY.fullmatch(self.display):
            raise ProvisioningError("Linux runtime-cell display must look like :99")
        for value, name in (
            (self.runtime_root, "runtime root"),
            (self.cache_root, "cache root"),
        ):
            path = Path(value)
            if path.is_absolute() or ".." in path.parts:
                raise ProvisioningError(
                    f"Linux runtime-cell {name} must be relative to remote home"
                )
        ports = (self.webdriver_port, self.gateway_port, self.observer_port)
        if len(set(ports)) != len(ports):
            raise ProvisioningError("Linux runtime-cell ports must be distinct")


@dataclass
class _ActorRuntime:
    actor: str
    webdriver_tunnel: SshTunnel | None
    webdriver_local_port: int
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
    matched = _SHA256.fullmatch(value.strip())
    if matched is None:
        raise ProvisioningError(f"{name} is not a SHA-256 digest")
    return matched.group(1)


def _json_output(completed: subprocess.CompletedProcess[str], operation: str) -> dict[str, Any]:
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise ProvisioningError(
            f"Linux runtime-cell {operation} failed: {detail[-4000:]}"
        )
    try:
        payload = json.loads(completed.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise ProvisioningError(
            f"Linux runtime-cell {operation} returned invalid JSON"
        ) from error
    if not isinstance(payload, dict):
        raise ProvisioningError(
            f"Linux runtime-cell {operation} returned a non-object"
        )
    return payload


def _json_document_output(
    completed: subprocess.CompletedProcess[str],
    operation: str,
) -> dict[str, Any]:
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise ProvisioningError(
            f"Linux runtime-cell {operation} failed: {detail[-4000:]}"
        )
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ProvisioningError(
            f"Linux runtime-cell {operation} returned invalid JSON"
        ) from error
    if not isinstance(payload, dict):
        raise ProvisioningError(
            f"Linux runtime-cell {operation} returned a non-object"
        )
    return payload


class NativeDesktopLinuxProvisioner:
    """Owns one remote Linux Desktop runtime cell lifecycle."""

    def __init__(
        self,
        *,
        contract_path: Path | None = None,
        profile_root: Path = _DEFAULT_PROFILE_ROOT,
        deploy_root: Path = _DEFAULT_DEPLOY_ROOT,
        source_root: Path = REPO_ROOT,
    ) -> None:
        selected_contract = contract_path or (
            RUNTIME_CELLS_DIR / "desktop-linux-native.yaml"
        )
        self.contract = RuntimeCellContract.from_yaml(selected_contract)
        if self.contract.platform != "linux":
            raise ProvisioningError("NativeDesktopLinuxProvisioner requires linux")
        self.profile = LinuxCellProfile.load(
            self.contract,
            profile_root=profile_root,
        )
        self.deploy_root = deploy_root
        self.source_root = source_root.resolve()
        self.state_path = (
            REPO_ROOT
            / ".local"
            / "acceptance"
            / "runtime-cells"
            / f"{self.contract.cell_id}.json"
        )
        self.tunnel_state_path = self.state_path.with_suffix(".tunnels.json")

        deploy_path = deploy_root / f"{self.profile.deploy_environment}.env"
        if not deploy_path.is_file():
            raise BlockedError(
                reason=f"Linux runtime-cell deploy environment is missing: {deploy_path}",
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
        )
        self.transport = SshTransport(self.target)
        self._actors: dict[str, _ActorRuntime] = {}
        self._endpoints: dict[str, _EndpointRuntime] = {}

    def ready(self, gate_id: str = "runtime-cell-preflight") -> RuntimeCellManifest:
        if self.state_path.exists():
            current = self.status()
            if current.get("state") == RuntimeCellState.LEASED.value:
                raise BlockedError(
                    reason=(
                        f"Linux runtime cell {self.contract.cell_id} is already leased"
                    ),
                    resource=f"runtime-cell:{self.contract.cell_id}",
                )
            self.state_path.unlink(missing_ok=True)
        if self.tunnel_state_path.exists():
            self._stop_tunnel_supervisor()

        run_id = _new_run_id()
        expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=self.contract.lease_ttl_seconds
        )
        expires_epoch = int(expires_at.timestamp())
        container_name = f"pt-acceptance-{self.contract.cell_id}"
        build_container_name = f"{container_name}-build"
        remote_acquired = False
        remote_source: Path | None = None
        remote_control: Path | None = None
        source_lease_acquired = False

        request = SourceSyncRequest.from_env_files(
            self.profile.deploy_environment,
            source_root=self.source_root,
            environments_dir=self.deploy_root,
            central_environment_path=(
                REPO_ROOT / ".local" / "deploy" / "git-server.env"
            ),
            require_clean=self.contract.source.clean_commit_required_for_proof,
        )
        source_lease_owner = (
            f"runtime-cell:{self.contract.cell_id}:{run_id}"
        )
        lease = RemoteGitSourceLease(
            request.environment_name,
            source_lease_owner,
            host=request.host,
            user=request.user,
            deploy_path=request.deploy_path,
            port=request.ssh_port,
            known_hosts_file=request.known_hosts_file,
        )
        try:
            host = self._host_preflight()
            lease.acquire()
            source_lease_acquired = True
            source = RemoteSourceSynchronizer(
                request,
                source_lease_held=True,
                source_lease_owner=source_lease_owner,
            ).sync()
            remote_home = self._remote_home()
            remote_source = remote_home / request.deploy_path
            source_control = remote_source / _REMOTE_CONTROL
            acquire = self._remote_control(
                source_control,
                "acquire",
                "--runtime-root",
                self.profile.runtime_root,
                "--cell-id",
                self.contract.cell_id,
                "--run-id",
                run_id,
                "--container-name",
                container_name,
                "--build-container-name",
                build_container_name,
                "--source-path",
                request.deploy_path,
                "--source-commit",
                source.commit,
                "--expires-at",
                str(expires_epoch),
                "--webdriver-port",
                str(self.profile.webdriver_port),
                "--gateway-port",
                str(self.profile.gateway_port),
                "--observer-port",
                str(self.profile.observer_port),
            )
            acquired = _json_output(acquire, "lease acquisition")
            remote_acquired = True
            run_root = Path(str(acquired["runRoot"]))
            remote_control = Path(str(acquired["controlPath"]))
            self._write_state(
                {
                    "cellId": self.contract.cell_id,
                    "runId": run_id,
                    "state": "PREPARING",
                    "containerName": container_name,
                    "buildContainerName": build_container_name,
                    "remoteControl": str(remote_control),
                    "remoteSource": str(remote_source),
                    "sourceCommit": source.commit,
                }
            )

            self._prune(remote_control)
            self._assert_remote_ports_free()
            image_digest = self._build_image(remote_source)
            binary_sha256 = self._build_binary(
                remote_source=remote_source,
                run_root=run_root,
                build_container_name=build_container_name,
            )
            self._assert_remote_source_clean(
                remote_source,
                source.commit,
            )
            self._start_container(
                remote_source=remote_source,
                run_root=run_root,
                run_id=run_id,
                container_name=container_name,
                image_digest=image_digest,
            )
            self._assert_running_image(container_name, image_digest)
            ready = self._wait_for_ready(container_name)

            probe_actor = self._start_remote_actor(
                remote_control=remote_control,
                run_id=run_id,
                container_name=container_name,
                actor="cell-probe",
                webdriver_port=self.profile.webdriver_port,
                gateway_port=self.profile.gateway_port,
                profile=f"{self.profile.name}-probe",
                environment={},
            )
            try:
                adapter = self._probe_native_adapter(
                    container_name,
                    run_root,
                    int(probe_actor["processId"]),
                )
                tunnels = self._start_tunnel_supervisor(expires_epoch)
            finally:
                self._stop_remote_actor(
                    remote_control=remote_control,
                    run_id=run_id,
                    container_name=container_name,
                    actor="cell-probe",
                )
            self._probe_observer(int(tunnels["observer"]["localPort"]))
            manifest = self._manifest(
                gate_id=gate_id,
                run_id=run_id,
                expires_at=expires_at,
                host=host,
                source=source,
                image_digest=image_digest,
                binary_sha256=binary_sha256,
                ready=ready,
                adapter=adapter,
                webdriver_local_port=int(
                    tunnels["webdriver"]["localPort"]
                ),
            )
            manifest.validate(self.contract)
            self._write_state(
                {
                    "cellId": self.contract.cell_id,
                    "runId": run_id,
                    "state": RuntimeCellState.LEASED.value,
                    "containerName": container_name,
                    "buildContainerName": build_container_name,
                    "remoteControl": str(remote_control),
                    "remoteSource": str(remote_source),
                    "sourceCommit": source.commit,
                    "tunnelSupervisorPid": int(
                        tunnels["supervisorPid"]
                    ),
                    "webdriverTunnelPid": int(
                        tunnels["webdriver"]["pid"]
                    ),
                    "webdriverLocalPort": int(
                        tunnels["webdriver"]["localPort"]
                    ),
                    "observerTunnelPid": int(
                        tunnels["observer"]["pid"]
                    ),
                    "observerLocalPort": int(
                        tunnels["observer"]["localPort"]
                    ),
                    "manifest": manifest.to_dict(),
                }
            )
            source_lease_acquired = False
            lease.release()
            return manifest
        except BaseException as error:
            cleanup_failures: list[str] = []
            try:
                self._stop_tunnel_supervisor()
            except Exception as cleanup_error:
                cleanup_failures.append(
                    f"SSH tunnel supervisor: {cleanup_error}"
                )
            if remote_acquired:
                try:
                    self._stop_remote(
                        run_id=run_id,
                        container_name=container_name,
                        remote_control=remote_control,
                    )
                except Exception as cleanup_error:
                    cleanup_failures.append(
                        f"remote runtime: {cleanup_error}"
                    )
            if not cleanup_failures:
                self.state_path.unlink(missing_ok=True)
                self.tunnel_state_path.unlink(missing_ok=True)
            if source_lease_acquired:
                source_lease_acquired = False
                try:
                    lease.release()
                except Exception as cleanup_error:
                    cleanup_failures.append(
                        f"source lease: {cleanup_error}"
                    )
            if cleanup_failures:
                raise ProvisioningError(
                    f"Linux runtime-cell operation failed ({error}); "
                    "cleanup also failed: "
                    + "; ".join(cleanup_failures)
                ) from error
            raise
        finally:
            if source_lease_acquired:
                lease.release()

    def status(self) -> dict[str, Any]:
        state = self._read_state()
        if not state:
            tunnel_state = self._read_tunnel_state()
            if tunnel_state.get("status") in ("STARTING", "READY"):
                return {
                    "cellId": self.contract.cell_id,
                    "state": "PREPARING",
                    "tunnelSupervisor": tunnel_state,
                }
            return {
                "cellId": self.contract.cell_id,
                "state": RuntimeCellState.CLEANED.value,
            }
        remote_control = Path(str(state["remoteControl"]))
        remote = self._remote_control(
            remote_control,
            "status",
            "--runtime-root",
            self.profile.runtime_root,
            "--cell-id",
            self.contract.cell_id,
        )
        try:
            payload = _json_output(remote, "status")
        except ProvisioningError:
            audit = self._remote_cleanup_audit(state)
            if not audit["clean"]:
                raise
            self._stop_tunnel_supervisor()
            self.state_path.unlink(missing_ok=True)
            self.tunnel_state_path.unlink(missing_ok=True)
            return {
                "cellId": self.contract.cell_id,
                "state": RuntimeCellState.CLEANED.value,
                "expired": True,
                "cleanupAudit": audit,
            }
        payload["webdriverTunnelAlive"] = _pid_alive(
            int(state.get("webdriverTunnelPid") or 0)
        )
        payload["observerTunnelAlive"] = _pid_alive(
            int(state.get("observerTunnelPid") or 0)
        )
        payload["tunnelSupervisorAlive"] = _pid_alive(
            int(state.get("tunnelSupervisorPid") or 0)
        )
        payload["tunnelSupervisor"] = self._read_tunnel_state()
        payload["manifest"] = state.get("manifest")
        return payload

    def launch_actor(
        self,
        actor: str,
        client_spec: dict[str, Any],
        environment: dict[str, str],
    ) -> ProvisionedTauriLauncher:
        state = self._require_state()
        if actor in self._actors:
            raise ProvisioningError(
                f"Linux runtime-cell actor {actor!r} is already launched"
            )
        remote = self._start_remote_actor(
            remote_control=Path(str(state["remoteControl"])),
            run_id=str(state["runId"]),
            container_name=str(state["containerName"]),
            actor=actor,
            webdriver_port=int(client_spec["webdriver_port"]),
            gateway_port=int(client_spec["gateway_port"]),
            profile=str(client_spec["profile"]),
            environment=environment,
        )
        webdriver_tunnel: SshTunnel | None = None
        gateway_tunnel: SshTunnel | None = None
        try:
            if int(remote["webdriverPort"]) == getattr(
                self.profile,
                "webdriver_port",
                -1,
            ):
                cell_tunnels = self._validated_tunnel_state(
                    self._read_tunnel_state()
                )
                webdriver_local_port = int(
                    cell_tunnels["webdriver"]["localPort"]
                )
            else:
                webdriver_tunnel = self.transport.start_local_forward(
                    remote_port=int(remote["webdriverPort"]),
                    local_port=int(client_spec["webdriver_port"]),
                )
                webdriver_local_port = webdriver_tunnel.local_port
            gateway_tunnel = self.transport.start_local_forward(
                remote_port=int(remote["gatewayPort"]),
                local_port=int(client_spec["gateway_port"]),
            )
        except BaseException:
            for tunnel in (gateway_tunnel, webdriver_tunnel):
                if tunnel is not None:
                    tunnel.stop()
            self._stop_remote_actor(
                remote_control=Path(str(state["remoteControl"])),
                run_id=str(state["runId"]),
                container_name=str(state["containerName"]),
                actor=actor,
            )
            raise
        log_path = (
            self.state_path.parent
            / "logs"
            / str(state["runId"])
            / f"{actor}.log"
        )
        log_path.parent.mkdir(parents=True, exist_ok=True)
        runtime = _ActorRuntime(
            actor=actor,
            webdriver_tunnel=webdriver_tunnel,
            webdriver_local_port=webdriver_local_port,
            gateway_tunnel=gateway_tunnel,
            log_path=log_path,
        )
        self._actors[actor] = runtime
        metadata = AppLaunchMetadata(
            webdriver_host="127.0.0.1",
            webdriver_port=webdriver_local_port,
            gateway_port=gateway_tunnel.local_port,
            profile=str(remote["profile"]),
            storage_root=str(remote["storageRoot"]),
            process_id=int(remote["processId"]),
            log_path=log_path,
        )
        return ProvisionedTauriLauncher(
            metadata,
            release=lambda: self.release_actor(actor),
            alive=lambda: self.actor_is_alive(actor),
        )

    def expose_orchestrator_endpoint(
        self,
        endpoint_id: str,
        url: str,
    ) -> dict[str, Any]:
        normalized_id = endpoint_id.strip()
        if not _ENDPOINT_ID.fullmatch(normalized_id):
            raise ProvisioningError(
                "Linux runtime-cell endpoint id is invalid"
            )
        if normalized_id in self._endpoints:
            raise ProvisioningError(
                f"Linux runtime-cell endpoint {normalized_id!r} is already exposed"
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
            local_port = parsed.port
        except ValueError as error:
            raise ProvisioningError(
                "orchestrator endpoint port is invalid"
            ) from error
        if local_port is None:
            raise ProvisioningError(
                "orchestrator endpoint must declare an explicit port"
            )
        tunnel = self.transport.start_reverse_forward(
            local_port=local_port,
            remote_port=local_port,
        )
        runtime = _EndpointRuntime(
            endpoint_id=normalized_id,
            tunnel=tunnel,
            tunnel_pid=tunnel.process_id,
            local_port=local_port,
            remote_port=local_port,
        )
        self._endpoints[normalized_id] = runtime
        return {
            "endpointId": normalized_id,
            "url": urlunsplit(
                (
                    parsed.scheme,
                    f"127.0.0.1:{runtime.remote_port}",
                    parsed.path,
                    parsed.query,
                    parsed.fragment,
                )
            ),
            "tunnelPid": runtime.tunnel_pid,
            "localPort": runtime.local_port,
            "remotePort": runtime.remote_port,
        }

    def release_endpoint(self, endpoint_id: str) -> dict[str, Any]:
        runtime = self._endpoints.get(endpoint_id)
        if runtime is None:
            return {
                "endpointId": endpoint_id,
                "released": True,
                "alreadyReleased": True,
            }
        if not runtime.released:
            runtime.tunnel.stop()
            runtime.released = True
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
        result = {
            "endpointId": endpoint_id,
            "tunnelPid": runtime.tunnel_pid,
            "localPort": runtime.local_port,
            "remotePort": runtime.remote_port,
            "released": released,
        }
        if released:
            self._endpoints.pop(endpoint_id, None)
            return result
        runtime.released = False
        raise ProvisioningError(
            f"Linux runtime-cell endpoint {endpoint_id!r} did not release"
        )

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

    def release_actor(self, actor: str) -> None:
        runtime = self._actors.get(actor)
        if runtime is None or runtime.released:
            return
        runtime.released = True
        failures: list[str] = []
        for name, tunnel in (
            ("gateway tunnel", runtime.gateway_tunnel),
            ("WebDriver tunnel", runtime.webdriver_tunnel),
        ):
            if tunnel is None:
                continue
            try:
                tunnel.stop()
            except Exception as error:
                failures.append(f"{name}: {error}")
        state = self._read_state()
        if state:
            try:
                stopped = self._stop_remote_actor(
                    remote_control=Path(str(state["remoteControl"])),
                    run_id=str(state["runId"]),
                    container_name=str(state["containerName"]),
                    actor=actor,
                )
                content = str(stopped.get("logContent") or "")
                if content:
                    runtime.log_path.write_bytes(base64.b64decode(content))
            except Exception as error:
                failures.append(f"remote actor: {error}")
        if not failures:
            self._actors.pop(actor, None)
        if failures:
            runtime.released = False
            raise ProvisioningError(
                f"Linux runtime-cell actor {actor!r} cleanup failed: "
                + "; ".join(failures)
            )

    def actor_is_alive(self, actor: str) -> bool:
        runtime = self._actors.get(actor)
        if runtime is None or runtime.released:
            return False
        webdriver_alive = (
            runtime.webdriver_tunnel.is_alive()
            if runtime.webdriver_tunnel is not None
            else _local_port_listening(runtime.webdriver_local_port)
        )
        if not webdriver_alive or not runtime.gateway_tunnel.is_alive():
            return False
        if any(
            not endpoint.released and not endpoint.tunnel.is_alive()
            for endpoint in self._endpoints.values()
        ):
            return False
        actors = self.status().get("actors")
        return isinstance(actors, list) and any(
            isinstance(item, dict) and item.get("actor") == actor
            for item in actors
        )

    def actor_cleanup_audit(self) -> dict[str, Any]:
        status = self.status()
        remote_actors = status.get("actors")
        if not isinstance(remote_actors, list):
            remote_actors = []
        active_local = sorted(
            actor
            for actor, runtime in self._actors.items()
            if not runtime.released
        )
        active_remote = sorted(
            str(actor.get("actor") or "")
            for actor in remote_actors
            if isinstance(actor, dict) and actor.get("actor")
        )
        return {
            "activeLocalActors": active_local,
            "activeRemoteActors": active_remote,
            "portsReleased": not active_local and not active_remote,
            "processesReleased": not active_remote,
            "storageReleased": not active_remote,
        }

    def validate_binding(
        self,
        gate_id: str,
        source_commit: str,
    ) -> None:
        state = self._require_state()
        manifest = state.get("manifest")
        if not isinstance(manifest, dict):
            raise ProvisioningError(
                "Linux runtime-cell manifest is missing"
            )
        if manifest.get("gateId") != gate_id:
            raise ProvisioningError(
                "Linux runtime-cell Gate identity does not match the "
                "requested product Gate"
            )
        source = manifest.get("source")
        if (
            not isinstance(source, dict)
            or source.get("commit") != source_commit
        ):
            raise ProvisioningError(
                "Linux runtime-cell source commit does not match the "
                "product runtime manifest"
            )

    def binary_identity(self) -> dict[str, str]:
        state = self._require_state()
        manifest = state.get("manifest")
        source = manifest.get("source") if isinstance(manifest, dict) else None
        if not isinstance(source, dict):
            raise ProvisioningError(
                "Linux runtime-cell manifest source identity is missing"
            )
        return {
            "path": (
                f"runtime-cell:{self.contract.cell_id}:"
                f"{state['runId']}:{_BINARY_RELATIVE_PATH}"
            ),
            "sha256": _digest(
                str(source.get("binarySha256") or ""),
                "runtime-cell manifest binary digest",
            ),
            "sourceCommit": str(source.get("commit") or ""),
        }

    def execute_adapter(
        self,
        operation: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        state = self._require_state()
        request = {
            **payload,
            "display": self.profile.display,
        }
        completed = self._remote_control(
            Path(str(state["remoteControl"])),
            "adapter",
            "--runtime-root",
            self.profile.runtime_root,
            "--cell-id",
            self.contract.cell_id,
            "--run-id",
            str(state["runId"]),
            "--container-name",
            str(state["containerName"]),
            "--operation",
            operation,
            "--payload",
            base64.b64encode(
                json.dumps(request, sort_keys=True).encode("utf-8")
            ).decode("ascii"),
        )
        return _json_output(completed, f"Native adapter {operation}")

    def logs(self, tail: int = 200) -> str:
        state = self._require_state()
        completed = self.transport.run_argv(
            (
                "docker",
                "logs",
                "--tail",
                str(max(1, min(tail, 2000))),
                str(state["containerName"]),
            ),
            timeout=30,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise ProvisioningError(f"Linux runtime-cell logs failed: {detail}")
        return completed.stdout

    def stop(self) -> dict[str, Any]:
        state = self._read_state()
        actor_cleanup_failures: list[str] = []
        for actor in reversed(tuple(self._actors)):
            try:
                self.release_actor(actor)
            except ProvisioningError as error:
                actor_cleanup_failures.append(str(error))
        for endpoint_id in reversed(tuple(self._endpoints)):
            try:
                self.release_endpoint(endpoint_id)
            except ProvisioningError as error:
                actor_cleanup_failures.append(str(error))
        if not state:
            self._stop_tunnel_supervisor()
            if actor_cleanup_failures:
                raise ProvisioningError(
                    "Linux runtime-cell actor cleanup failed: "
                    + "; ".join(actor_cleanup_failures)
                )
            return {
                "cellId": self.contract.cell_id,
                "state": RuntimeCellState.CLEANED.value,
                "alreadyClean": True,
            }
        cleanup_failures = actor_cleanup_failures
        try:
            self._stop_tunnel_supervisor()
        except (OSError, ProvisioningError) as error:
            cleanup_failures.append(f"local tunnels: {error}")
        try:
            remote = self._stop_remote(
                run_id=str(state["runId"]),
                container_name=str(state["containerName"]),
                remote_control=Path(str(state["remoteControl"])),
            )
        except (OSError, ProvisioningError) as error:
            audit = self._remote_cleanup_audit(state)
            if audit["clean"]:
                remote = {
                    "stopped": False,
                    "alreadyClean": True,
                    "cleanupAudit": audit,
                }
            else:
                cleanup_failures.append(f"remote runtime: {error}")
                remote = {"stopped": False, "cleanupAudit": audit}
        if cleanup_failures:
            raise ProvisioningError(
                "Linux runtime-cell cleanup failed: "
                + "; ".join(cleanup_failures)
            )
        self.state_path.unlink(missing_ok=True)
        self.tunnel_state_path.unlink(missing_ok=True)
        return {
            "cellId": self.contract.cell_id,
            "state": RuntimeCellState.CLEANED.value,
            "remote": remote,
        }

    def _remote_cleanup_audit(
        self,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        completed = self.transport.run_argv(
            (
                "python3",
                "-c",
                _REMOTE_CLEANUP_AUDIT_SCRIPT,
                self.profile.runtime_root,
                self.contract.cell_id,
                str(state.get("runId") or ""),
                str(state.get("containerName") or ""),
                str(state.get("buildContainerName") or ""),
                str(self.profile.webdriver_port),
                str(self.profile.gateway_port),
                str(self.profile.observer_port),
                str(state.get("remoteSource") or ""),
                str(state.get("sourceCommit") or ""),
            ),
            timeout=30,
            check=False,
        )
        return _json_output(completed, "cleanup audit")

    def _start_tunnel_supervisor(
        self,
        expires_epoch: int,
    ) -> dict[str, Any]:
        self.tunnel_state_path.unlink(missing_ok=True)
        command = [
            sys.executable,
            str(_LOCAL_TUNNEL_SUPERVISOR),
            "--state-path",
            str(self.tunnel_state_path),
            "--host",
            self.target.host,
            "--user",
            self.target.user,
            "--port",
            str(self.target.port),
            "--expires-at",
            str(expires_epoch),
            "--forward",
            f"webdriver:{self.profile.webdriver_port}",
            "--forward",
            f"observer:{self.profile.observer_port}",
        ]
        if self.target.known_hosts_file:
            command.extend(
                (
                    "--known-hosts-file",
                    str(Path(self.target.known_hosts_file).expanduser()),
                )
            )
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        deadline = time.monotonic() + 20
        last_state: dict[str, Any] = {}
        while time.monotonic() < deadline:
            last_state = self._read_tunnel_state()
            if last_state.get("status") == "READY":
                return self._validated_tunnel_state(last_state, process.pid)
            if last_state.get("status") in ("FAILED", "CLEANUP_FAILED"):
                break
            if process.poll() is not None:
                break
            time.sleep(0.1)
        try:
            self._stop_tunnel_supervisor()
        except ProvisioningError:
            pass
        detail = str(last_state.get("error") or "readiness timed out")
        raise ProvisioningError(
            f"Linux runtime-cell tunnel supervisor failed: {detail}"
        )

    def _validated_tunnel_state(
        self,
        payload: dict[str, Any],
        expected_supervisor_pid: int | None = None,
    ) -> dict[str, Any]:
        supervisor_pid = int(payload.get("supervisorPid") or 0)
        if supervisor_pid <= 0 or (
            expected_supervisor_pid is not None
            and supervisor_pid != expected_supervisor_pid
        ):
            raise ProvisioningError(
                "Linux runtime-cell tunnel supervisor identity is invalid"
            )
        raw_tunnels = payload.get("tunnels")
        if not isinstance(raw_tunnels, list):
            raise ProvisioningError(
                "Linux runtime-cell tunnel metadata is invalid"
            )
        tunnels: dict[str, dict[str, int]] = {}
        for raw in raw_tunnels:
            if not isinstance(raw, dict):
                continue
            name = str(raw.get("name") or "")
            if name not in ("webdriver", "observer") or name in tunnels:
                continue
            tunnels[name] = {
                "pid": int(raw.get("pid") or 0),
                "localPort": int(raw.get("localPort") or 0),
                "remotePort": int(raw.get("remotePort") or 0),
            }
        if set(tunnels) != {"webdriver", "observer"}:
            raise ProvisioningError(
                "Linux runtime-cell tunnel set is incomplete"
            )
        return {
            "supervisorPid": supervisor_pid,
            **tunnels,
        }

    def _stop_tunnel_supervisor(self) -> None:
        state = self._read_tunnel_state()
        if not state:
            return
        supervisor_pid = int(state.get("supervisorPid") or 0)
        if supervisor_pid > 0 and _pid_alive(supervisor_pid):
            command = subprocess.run(
                ("ps", "-p", str(supervisor_pid), "-o", "command="),
                capture_output=True,
                text=True,
                check=False,
            ).stdout.strip()
            if (
                str(_LOCAL_TUNNEL_SUPERVISOR) not in command
                or str(self.tunnel_state_path) not in command
            ):
                raise ProvisioningError(
                    "refusing to stop an unverified tunnel supervisor process"
                )
            os.killpg(supervisor_pid, signal.SIGTERM)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and _pid_alive(supervisor_pid):
                time.sleep(0.05)

        failures: list[str] = []
        raw_tunnels = state.get("tunnels")
        if isinstance(raw_tunnels, list):
            for tunnel in reversed(raw_tunnels):
                if not isinstance(tunnel, dict):
                    continue
                try:
                    _stop_tunnel_process(
                        int(tunnel.get("pid") or 0),
                        local_port=int(tunnel.get("localPort") or 0),
                        remote_port=int(tunnel.get("remotePort") or 0),
                        destination=self.target.destination,
                    )
                except (OSError, ProvisioningError) as error:
                    failures.append(str(error))
        if supervisor_pid > 0 and _pid_alive(supervisor_pid):
            failures.append(
                f"tunnel supervisor PID {supervisor_pid} remains active"
            )
        if isinstance(raw_tunnels, list):
            active_ports = [
                int(tunnel.get("localPort") or 0)
                for tunnel in raw_tunnels
                if isinstance(tunnel, dict)
                and _local_port_listening(
                    int(tunnel.get("localPort") or 0)
                )
            ]
            if active_ports:
                failures.append(
                    f"local tunnel ports remain active: {active_ports}"
                )
        if failures:
            raise ProvisioningError("; ".join(failures))
        self.tunnel_state_path.unlink(missing_ok=True)

    def _read_tunnel_state(self) -> dict[str, Any]:
        try:
            payload = json.loads(
                self.tunnel_state_path.read_text(encoding="utf-8")
            )
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError) as error:
            raise ProvisioningError(
                f"Linux runtime-cell tunnel state is invalid: {error}"
            ) from error
        if not isinstance(payload, dict):
            raise ProvisioningError(
                "Linux runtime-cell tunnel state is not an object"
            )
        return payload

    def _host_preflight(self) -> dict[str, str]:
        command = (
            "set -eu; "
            ". /etc/os-release; "
            "docker version --format '{{.Server.Version}}' >/dev/null; "
            "test \"$(uname -m)\" = x86_64; "
            "printf '%s\\n%s\\n%s\\n' "
            "\"$PRETTY_NAME\" \"$(uname -r)\" \"$(uname -m)\""
        )
        completed = self.transport.run_argv(
            ("sh", "-lc", command),
            timeout=30,
            check=True,
        )
        lines = completed.stdout.splitlines()
        if len(lines) != 3 or not lines[0].startswith("Ubuntu 20.04"):
            raise BlockedError(
                reason="Linux runtime-cell host must remain Ubuntu 20.04 x86_64",
                resource=f"runtime-cell-host:{self.contract.cell_id}",
            )
        return {
            "distribution": lines[0],
            "kernel": lines[1],
            "architecture": lines[2],
        }

    def _remote_home(self) -> Path:
        completed = self.transport.run_argv(
            ("python3", "-c", "import pathlib,sys;sys.stdout.write(str(pathlib.Path.home()))"),
            timeout=15,
            check=True,
        )
        home = Path(completed.stdout.strip())
        if not home.is_absolute():
            raise ProvisioningError("remote home resolution returned a relative path")
        return home

    def _remote_control(
        self,
        path: Path,
        *arguments: str,
        check: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        return self.transport.run_argv(
            ("python3", str(path), *arguments),
            timeout=60,
            check=check,
        )

    def _prune(self, remote_control: Path) -> None:
        self._remote_control(
            remote_control,
            "prune",
            "--runtime-root",
            self.profile.runtime_root,
            "--cache-root",
            self.profile.cache_root,
            "--retention-days",
            str(self.profile.cache_retention_days),
            check=True,
        )

    def _build_image(self, remote_source: Path) -> str:
        containerfile = remote_source / _CONTAINERFILE
        context = remote_source / _IMAGE_CONTEXT
        uid = self.transport.run_argv(
            ("id", "-u"),
            timeout=10,
            check=True,
        ).stdout.strip()
        gid = self.transport.run_argv(
            ("id", "-g"),
            timeout=10,
            check=True,
        ).stdout.strip()
        completed = self.transport.run_argv(
            (
                "docker",
                "build",
                "--build-arg",
                f"USER_ID={uid}",
                "--build-arg",
                f"USER_GROUP_ID={gid}",
                "--build-arg",
                f"BASE_IMAGE={self.profile.base_image_ref}",
                "--build-arg",
                f"NODE_DIST_URL={self.profile.node_dist_url}",
                "--build-arg",
                f"RUSTUP_DIST_SERVER={self.profile.rustup_dist_server}",
                "--build-arg",
                f"RUSTUP_UPDATE_ROOT={self.profile.rustup_update_root}",
                "--file",
                str(containerfile),
                "--tag",
                self.profile.image_ref,
                str(context),
            ),
            timeout=1800,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise BlockedError(
                reason=f"Linux runtime-cell image build failed: {detail[-4000:]}",
                resource=f"runtime-cell-image:{self.profile.image_ref}",
            )
        inspected = self.transport.run_argv(
            (
                "docker",
                "image",
                "inspect",
                "--format",
                "{{.Id}}",
                self.profile.image_ref,
            ),
            timeout=30,
            check=True,
        )
        return _digest(inspected.stdout.strip(), "container image digest")

    def _assert_remote_ports_free(self) -> None:
        script = "\n".join(
            (
                "import socket,sys",
                "listeners=[]",
                "try:",
                "    for raw in sys.argv[1:]:",
                "        listener=socket.socket(socket.AF_INET,socket.SOCK_STREAM)",
                "        listener.bind(('127.0.0.1',int(raw)))",
                "        listeners.append(listener)",
                "finally:",
                "    for listener in listeners:",
                "        listener.close()",
            )
        )
        completed = self.transport.run_argv(
            (
                "python3",
                "-c",
                script,
                str(self.profile.webdriver_port),
                str(self.profile.gateway_port),
                str(self.profile.observer_port),
            ),
            timeout=15,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise BlockedError(
                reason=f"Linux runtime-cell port preflight failed: {detail[-2000:]}",
                resource=f"runtime-cell-ports:{self.contract.cell_id}",
            )

    def _build_binary(
        self,
        *,
        remote_source: Path,
        run_root: Path,
        build_container_name: str,
    ) -> str:
        uid = self.transport.run_argv(("id", "-u"), timeout=10, check=True).stdout.strip()
        gid = self.transport.run_argv(("id", "-g"), timeout=10, check=True).stdout.strip()
        remote_home = remote_source.parents[len(Path(self.deploy_values["PT_DEPLOY_PATH"]).parts) - 1]
        cache_root = remote_home / self.profile.cache_root
        self._prepare_remote_build_paths(
            cache_root=cache_root,
            run_root=run_root,
            uid=uid,
            gid=gid,
        )
        command = (
            "set -euo pipefail; "
            "mkdir -p /workspace/cache/home /workspace/cache/cargo/home "
            "/workspace/cache/cargo/target /workspace/cache/pnpm/store "
            "/workspace/cache/xdg /workspace/run/bin; "
            "git config --global --add safe.directory /workspace/source; "
            "if [ \"$CARGO_REGISTRIES_CRATES_IO_INDEX\" != "
            "\"sparse+https://index.crates.io/\" ]; then "
            "printf '%s\\n' "
            "'[source.crates-io]' "
            "'replace-with = \"acceptance-mirror\"' "
            "'[source.acceptance-mirror]' "
            "'registry = \"'\"$CARGO_REGISTRIES_CRATES_IO_INDEX\"'\"' "
            "> \"$CARGO_HOME/config.toml\"; "
            "else rm -f \"$CARGO_HOME/config.toml\"; fi; "
            "pnpm install --frozen-lockfile --store-dir /workspace/cache/pnpm/store; "
            "VITE_ACCEPTANCE_HARNESS=1 pnpm --dir apps/desktop run build; "
            "cd apps/desktop/src-tauri; "
            "TAURI_CONFIG='{\"app\":{\"withGlobalTauri\":true}}' "
            "cargo build --locked --features acceptance-webdriver; "
            "cp /workspace/cache/cargo/target/debug/peers-touch-desktop "
            "/workspace/run/bin/peers-touch-desktop; "
            "chmod 0755 /workspace/run/bin/peers-touch-desktop; "
            "sha256sum /workspace/run/bin/peers-touch-desktop"
        )
        completed = self.transport.run_argv(
            (
                "docker",
                "run",
                "--rm",
                "--name",
                build_container_name,
                "--label",
                f"peers-touch.acceptance-cell={self.contract.cell_id}",
                "--network",
                "host",
                "--user",
                f"{uid}:{gid}",
                "--env",
                "HOME=/workspace/cache/home",
                "--env",
                "COREPACK_HOME=/opt/corepack",
                "--env",
                "CARGO_HOME=/workspace/cache/cargo/home",
                "--env",
                "CARGO_TARGET_DIR=/workspace/cache/cargo/target",
                "--env",
                "RUSTUP_HOME=/opt/rustup",
                "--env",
                (
                    "CARGO_REGISTRIES_CRATES_IO_INDEX="
                    f"{self.profile.cargo_registry_index}"
                ),
                "--env",
                "CARGO_NET_RETRY=3",
                "--env",
                "CARGO_HTTP_TIMEOUT=120",
                "--env",
                "XDG_CACHE_HOME=/workspace/cache/xdg",
                "--volume",
                f"{remote_source}:/workspace/source:rw",
                "--volume",
                f"{cache_root}:/workspace/cache:rw",
                "--volume",
                f"{run_root}:/workspace/run:rw",
                "--workdir",
                "/workspace/source",
                "--entrypoint",
                "/bin/bash",
                self.profile.image_ref,
                "-lc",
                command,
            ),
            timeout=3600,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise BlockedError(
                reason=f"Linux Desktop build failed: {detail[-8000:]}",
                resource="runtime-cell-binary:desktop-linux-native",
            )
        digest = completed.stdout.strip().splitlines()[-1].split()[0]
        return _digest(digest, "Desktop binary digest")

    def _prepare_remote_build_paths(
        self,
        *,
        cache_root: Path,
        run_root: Path,
        uid: str,
        gid: str,
    ) -> None:
        paths = (
            cache_root,
            run_root,
            run_root / "bin",
        )
        self.transport.run_argv(
            ("mkdir", "-p", *(str(path) for path in paths)),
            timeout=30,
            check=True,
        )
        for path in paths:
            identity = self.transport.run_argv(
                ("stat", "-c", "%u:%g", str(path)),
                timeout=15,
                check=True,
            ).stdout.strip()
            if identity != f"{uid}:{gid}":
                raise BlockedError(
                    reason=(
                        "Linux runtime-cell writable path has unexpected "
                        f"ownership: {path}"
                    ),
                    resource=f"runtime-cell-storage:{self.contract.cell_id}",
                )

    def _assert_remote_source_clean(self, remote_source: Path, commit: str) -> None:
        self._clean_remote_source(remote_source, commit)
        completed = self.transport.run_argv(
            (
                "git",
                "-C",
                str(remote_source),
                "status",
                "--porcelain",
                "--ignored",
                "--untracked-files=all",
            ),
            timeout=30,
            check=True,
        )
        if completed.stdout.strip():
            raise ProvisioningError(
                "Linux runtime-cell source contains residue after build cleanup"
            )

    def _clean_remote_source(self, remote_source: Path, commit: str) -> None:
        self.transport.run_argv(
            ("git", "-C", str(remote_source), "reset", "--hard", commit),
            timeout=60,
            check=True,
        )
        self.transport.run_argv(
            ("git", "-C", str(remote_source), "clean", "-ffdqx"),
            timeout=120,
            check=True,
        )

    def _start_container(
        self,
        *,
        remote_source: Path,
        run_root: Path,
        run_id: str,
        container_name: str,
        image_digest: str,
    ) -> None:
        uid = self.transport.run_argv(("id", "-u"), timeout=10, check=True).stdout.strip()
        gid = self.transport.run_argv(("id", "-g"), timeout=10, check=True).stdout.strip()
        completed = self.transport.run_argv(
            (
                "docker",
                "run",
                "--detach",
                "--name",
                container_name,
                "--network",
                "host",
                "--user",
                f"{uid}:{gid}",
                "--label",
                f"peers-touch.acceptance-cell={self.contract.cell_id}",
                "--label",
                f"peers-touch.acceptance-run={run_id}",
                "--env",
                f"PT_CELL_RUN_ROOT=/workspace/run",
                "--env",
                f"PT_CELL_APP_BINARY=/workspace/run/{_BINARY_RELATIVE_PATH}",
                "--env",
                f"PT_CELL_RUN_ID={run_id}",
                "--env",
                f"PT_CELL_DISPLAY={self.profile.display}",
                "--env",
                f"PT_CELL_VNC_PORT={self.profile.observer_port}",
                "--env",
                f"TAURI_WEBDRIVER_PORT={self.profile.webdriver_port}",
                "--env",
                f"PT_GATEWAY_PORT={self.profile.gateway_port}",
                "--env",
                f"PT_PROFILE={self.profile.name}",
                "--env",
                "PEERS_STORAGE_ROOT=/workspace/run/storage",
                "--env",
                "HOME=/workspace/run/home",
                "--volume",
                f"{remote_source}:/workspace/source:ro",
                "--volume",
                f"{run_root}:/workspace/run:rw",
                f"sha256:{image_digest}",
            ),
            timeout=60,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise BlockedError(
                reason=f"Linux runtime-cell start failed: {detail[-4000:]}",
                resource=f"runtime-cell-container:{container_name}",
            )

    def _assert_running_image(
        self,
        container_name: str,
        expected_digest: str,
    ) -> None:
        inspected = self.transport.run_argv(
            (
                "docker",
                "inspect",
                "--format",
                "{{.Image}}",
                container_name,
            ),
            timeout=30,
            check=True,
        )
        actual_digest = _digest(
            inspected.stdout.strip(),
            "running container image digest",
        )
        if actual_digest != expected_digest:
            raise ProvisioningError(
                "Linux runtime-cell running image does not match the "
                "attested image digest"
            )

    def _wait_for_ready(
        self,
        container_name: str,
        timeout: float = 180,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        last_detail = ""
        while time.monotonic() < deadline:
            completed = self.transport.run_argv(
                (
                    "docker",
                    "exec",
                    container_name,
                    "cat",
                    "/workspace/run/ready.json",
                ),
                timeout=15,
                check=False,
            )
            if completed.returncode == 0:
                return _json_document_output(completed, "readiness")
            last_detail = completed.stderr.strip() or completed.stdout.strip()
            state = self.transport.run_argv(
                (
                    "docker",
                    "inspect",
                    "--format",
                    "{{.State.Running}}",
                    container_name,
                ),
                timeout=15,
                check=False,
            )
            if state.stdout.strip() != "true":
                break
            time.sleep(0.5)
        logs = self.transport.run_argv(
            ("docker", "logs", "--tail", "200", container_name),
            timeout=30,
            check=False,
        )
        detail = logs.stderr.strip() or logs.stdout.strip() or last_detail
        raise BlockedError(
            reason=f"Linux runtime-cell readiness failed: {detail[-8000:]}",
            resource=f"runtime-cell-container:{container_name}",
        )

    def _start_remote_actor(
        self,
        *,
        remote_control: Path,
        run_id: str,
        container_name: str,
        actor: str,
        webdriver_port: int,
        gateway_port: int,
        profile: str,
        environment: dict[str, str],
    ) -> dict[str, Any]:
        completed = self._remote_control(
            remote_control,
            "actor-start",
            "--runtime-root",
            self.profile.runtime_root,
            "--cell-id",
            self.contract.cell_id,
            "--run-id",
            run_id,
            "--container-name",
            container_name,
            "--actor",
            actor,
            "--display",
            self.profile.display,
            "--webdriver-port",
            str(webdriver_port),
            "--gateway-port",
            str(gateway_port),
            "--profile",
            profile,
            "--environment-json",
            json.dumps(environment, sort_keys=True),
        )
        return _json_output(completed, f"actor {actor} start")

    def _stop_remote_actor(
        self,
        *,
        remote_control: Path,
        run_id: str,
        container_name: str,
        actor: str,
    ) -> dict[str, Any]:
        completed = self._remote_control(
            remote_control,
            "actor-stop",
            "--runtime-root",
            self.profile.runtime_root,
            "--cell-id",
            self.contract.cell_id,
            "--run-id",
            run_id,
            "--container-name",
            container_name,
            "--actor",
            actor,
        )
        return _json_output(completed, f"actor {actor} stop")

    def _probe_native_adapter(
        self,
        container_name: str,
        run_root: Path,
        app_pid: int,
    ) -> dict[str, Any]:
        completed = self.transport.run_argv(
            (
                "docker",
                "exec",
                "--env",
                f"DISPLAY={self.profile.display}",
                "--env",
                "PYTHONPATH=/workspace/source",
                container_name,
                "python3",
                "-c",
                _NATIVE_ADAPTER_PROBE_SCRIPT,
                self.profile.display,
                str(app_pid),
                "/workspace/run/native-adapter-probe.png",
            ),
            timeout=60,
            check=False,
        )
        payload = _json_output(completed, "native adapter probe")
        if not all(
            payload.get(name) is True
            for name in ("input", "focus", "pointOwnership", "screenshot")
        ):
            raise BlockedError(
                reason=(
                    "Linux runtime-cell XTest/EWMH/screenshot probes are incomplete"
                ),
                resource=f"runtime-cell-native-adapter:{self.contract.cell_id}",
            )
        return payload

    @staticmethod
    def _probe_observer(local_port: int) -> None:
        with socket.create_connection(("127.0.0.1", local_port), timeout=5) as stream:
            banner = stream.recv(12)
        if not banner.startswith(b"RFB "):
            raise ProvisioningError("Linux runtime-cell observer is not an RFB endpoint")

    def _manifest(
        self,
        *,
        gate_id: str,
        run_id: str,
        expires_at: datetime,
        host: dict[str, str],
        source: Any,
        image_digest: str,
        binary_sha256: str,
        ready: dict[str, Any],
        adapter: dict[str, Any],
        webdriver_local_port: int,
    ) -> RuntimeCellManifest:
        host_key_file = (
            Path(self.target.known_hosts_file).expanduser()
            if self.target.known_hosts_file
            else Path.home() / ".ssh" / "known_hosts"
        )
        host_key_lines = subprocess.run(
            (
                "ssh-keygen",
                "-F",
                self.target.host,
                "-f",
                str(host_key_file),
            ),
            capture_output=True,
            text=True,
            check=False,
        ).stdout
        if not host_key_lines:
            raise ProvisioningError("Linux runtime-cell host key is not pinned")

        container_identity = self.transport.run_argv(
            (
                "docker",
                "exec",
                f"pt-acceptance-{self.contract.cell_id}",
                "sh",
                "-lc",
                ". /etc/os-release; printf '%s\\n%s\\n' \"$PRETTY_NAME\" \"$(uname -m)\"",
            ),
            timeout=20,
            check=True,
        ).stdout.splitlines()
        if len(container_identity) != 2:
            raise ProvisioningError("Linux runtime-cell userland identity is incomplete")

        return RuntimeCellManifest(
            cell_id=self.contract.cell_id,
            gate_id=gate_id,
            run_id=run_id,
            state=RuntimeCellState.LEASED,
            platform=CellPlatformIdentity(
                os="linux",
                host_distribution=host["distribution"],
                host_kernel=host["kernel"],
                isolation_kind="container",
                image_digest=image_digest,
                distribution=container_identity[0],
                architecture=container_identity[1],
                webview_backend="WebKitGTK",
                webview_version=str(ready.get("webkitVersion") or ""),
            ),
            transport=CellTransportIdentity(
                kind="ssh",
                host_identity_sha256=hashlib.sha256(
                    (
                        host["distribution"]
                        + "|"
                        + host["kernel"]
                        + "|"
                        + host["architecture"]
                    ).encode("utf-8")
                ).hexdigest(),
                host_key_sha256=hashlib.sha256(
                    host_key_lines.encode("utf-8")
                ).hexdigest(),
                webdriver_local_port=webdriver_local_port,
                webdriver_remote_port=self.profile.webdriver_port,
            ),
            display=CellDisplayIdentity(
                session_type="x11",
                display_id=hashlib.sha256(
                    (
                        self.contract.cell_id
                        + "|"
                        + self.profile.display
                    ).encode("utf-8")
                ).hexdigest()[:16],
                seat="container",
                width=1920,
                height=1080,
                connected_output=True,
                desktop_user_identity_sha256=hashlib.sha256(
                    (
                        self.profile.name
                        + "|"
                        + host["architecture"]
                    ).encode("utf-8")
                ).hexdigest(),
            ),
            source=CellSourceIdentity(
                mode=self.contract.source.mode,
                commit=source.commit,
                workspace_digest="clean",
                remote_source_digest=_digest(
                    source.remote_source_digest,
                    "remote source digest",
                ),
                remote_checkout_clean=source.remote_checkout_clean,
                binary_sha256=binary_sha256,
            ),
            native_adapter=CellAdapterIdentity(
                input_backend="x11-xtest",
                window_backend="x11-ewmh",
                screenshot_backend="webkitgtk-and-desktop",
                input_probe=adapter.get("input") is True,
                focus_probe=adapter.get("focus") is True,
                point_ownership_probe=adapter.get("pointOwnership") is True,
                screenshot_probe=adapter.get("screenshot") is True,
            ),
            lease_owner_run_id=run_id,
            lease_expires_at=expires_at.isoformat(),
            cleanup_registered=True,
            cleanup_resources=self.contract.cleanup_resources,
        )

    def _stop_remote(
        self,
        *,
        run_id: str,
        container_name: str,
        remote_control: Path | None = None,
    ) -> dict[str, Any]:
        control = remote_control
        if control is None:
            request = SourceSyncRequest.from_env_files(
                self.profile.deploy_environment,
                source_root=self.source_root,
                environments_dir=self.deploy_root,
                central_environment_path=(
                    REPO_ROOT / ".local" / "deploy" / "git-server.env"
                ),
            )
            control = self._remote_home() / request.deploy_path / _REMOTE_CONTROL
        completed = self._remote_control(
            control,
            "stop",
            "--runtime-root",
            self.profile.runtime_root,
            "--cell-id",
            self.contract.cell_id,
            "--run-id",
            run_id,
            "--container-name",
            container_name,
        )
        return _json_output(completed, "remote stop")

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
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError) as error:
            raise ProvisioningError(
                f"Linux runtime-cell state is invalid: {error}"
            ) from error
        if not isinstance(payload, dict):
            raise ProvisioningError("Linux runtime-cell state is not an object")
        return payload

    def _require_state(self) -> dict[str, Any]:
        state = self._read_state()
        if not state:
            raise BlockedError(
                reason=f"Linux runtime cell {self.contract.cell_id} is not active",
                resource=f"runtime-cell:{self.contract.cell_id}",
            )
        return state


def _new_run_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return f"{timestamp}-{secrets.token_hex(8)}"


def _pid_alive(process_id: int) -> bool:
    if process_id <= 0:
        return False
    try:
        os.kill(process_id, 0)
    except OSError:
        return False
    return True


def _local_port_listening(port: int) -> bool:
    if port <= 0:
        return False
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            return True
    except OSError:
        return False


def _stop_tunnel_process(
    process_id: int,
    *,
    local_port: int,
    remote_port: int,
    destination: str,
) -> None:
    if process_id <= 0:
        return
    command = subprocess.run(
        ("ps", "-p", str(process_id), "-o", "command="),
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    if not command:
        return
    forward = (
        f"127.0.0.1:{local_port}:127.0.0.1:{remote_port}"
    )
    if "ssh " not in f" {command}" or destination not in command or forward not in command:
        raise ProvisioningError(
            f"refusing to stop PID {process_id}: it is not the recorded SSH tunnel"
        )
    try:
        os.killpg(process_id, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if not _pid_alive(process_id):
            return
        time.sleep(0.05)
    os.killpg(process_id, signal.SIGKILL)
