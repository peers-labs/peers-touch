from __future__ import annotations

import ctypes
import dataclasses
import hashlib
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Mapping
from pathlib import Path

from tooling.acceptance.core import (
    BlockedError,
    ClientRuntime,
    EnvironmentContract,
    EnvironmentProvisioner,
    EphemeralCapabilityBlocked,
    EphemeralCapabilityHandler,
    EphemeralGateLaunchContext,
    EphemeralHandlerCleanup,
    ProvisioningError,
    ProvisioningState,
    RuntimeManifest,
)
from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.drivers.native.macos import (
    MacOSNativeDesktopAdapter,
)


ENVIRONMENT_ID = "desktop-shell-native"
GATE_ID = "desktop-shell-tray-e2e"
CAPABILITY_ID = "desktop.shell.status-item"
CLIENT_ID = "desktop-shell"
STATUS_HELP = "Peers Touch"
SHOW_MENU_ITEM = "Show Peers Touch"
APP_BUNDLE = (
    REPO_ROOT
    / "apps"
    / "desktop"
    / "src-tauri"
    / "target"
    / "debug"
    / "bundle"
    / "macos"
    / "Peers.app"
)
APP_BINARY = APP_BUNDLE / "Contents" / "MacOS" / "peers-touch-desktop"
TRAY_ASSET = (
    REPO_ROOT
    / "apps"
    / "desktop"
    / "src-tauri"
    / "icons"
    / "tray-icon-macos.png"
)
DEDICATED_BINARY = (
    REPO_ROOT / ".local" / "acceptance" / "bin" / "peers-touch-desktop"
)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


class DesktopShellStatusItemHandler(EphemeralCapabilityHandler):
    _ALLOWED_OPERATIONS = (
        "inspect",
        "hide-main-window",
        "show-main-window",
        "capture-screenshot",
    )

    def __init__(
        self,
        *,
        artifact_writer: object,
        app_binary: Path,
        tray_asset: Path,
        storage_root: Path,
    ) -> None:
        self._artifact_writer = artifact_writer
        self._app_binary = app_binary.resolve(strict=True)
        self._tray_asset = tray_asset.resolve(strict=True)
        self._storage_root = storage_root.resolve(strict=True)
        self._adapter = MacOSNativeDesktopAdapter()
        self._process: subprocess.Popen[bytes] | None = None
        self._log_stream: object | None = None
        self._log_path = self._storage_root / "desktop-shell.log"
        asset = self._tray_asset.read_bytes()
        binary = self._app_binary.read_bytes()
        self._package_identity = {
            "bundleName": APP_BUNDLE.name,
            "binarySha256": hashlib.sha256(binary).hexdigest(),
            "assetSha256": hashlib.sha256(asset).hexdigest(),
            "assetEmbedded": asset in binary,
        }
        self._gateway_port: int | None = None
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return self._ALLOWED_OPERATIONS

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return ()

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        if payload:
            raise EphemeralCapabilityBlocked(
                "Desktop shell status-item operations accept no payload",
                resource=f"{CAPABILITY_ID}:{operation}",
            )
        self._require_active(deadline_monotonic, cancellation)
        process_id = self._ensure_process(
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        if operation == "inspect":
            return self._inspect(process_id)
        if operation == "hide-main-window":
            window = self._adapter.hide_main_window(process_id)
            return {
                **self._inspect(process_id),
                "window": window,
            }
        if operation == "show-main-window":
            window = self._adapter.show_main_window_from_status_item(
                process_id,
                expected_help=STATUS_HELP,
                menu_item_title=SHOW_MENU_ITEM,
            )
            return {
                **self._inspect(process_id),
                "window": window,
            }
        if operation == "capture-screenshot":
            screenshot = self._storage_root / "desktop-shell-tray.png"
            self._adapter.capture_screenshot(screenshot)
            reference = self._artifact_writer.write_bytes(
                "desktop-shell/native-status-item.png",
                screenshot.read_bytes(),
                media_type="image/png",
                role="desktop-shell-native-status-item",
            )
            return {
                "artifact": reference.to_dict(),
                "byteLength": screenshot.stat().st_size,
            }
        raise EphemeralCapabilityBlocked(
            "Desktop shell status-item operation is not allowed",
            resource=f"{CAPABILITY_ID}:{operation}",
        )

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        del operation
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason
        try:
            self.close()
        except Exception:
            return False
        return time.monotonic() < deadline_monotonic

    def close(self) -> EphemeralHandlerCleanup:
        if self._closed:
            return EphemeralHandlerCleanup(
                closed=True,
                secrets_zeroized=True,
            )
        self._closed = True
        cleanup_errors: list[str] = []
        process = self._process
        if process is not None:
            try:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=3)
            except Exception as error:
                cleanup_errors.append(f"process: {error}")
            finally:
                self._process = None
        if self._log_stream is not None:
            try:
                self._log_stream.close()
            except Exception as error:
                cleanup_errors.append(f"log: {error}")
            finally:
                self._log_stream = None
        if process is not None and process.poll() is None:
            cleanup_errors.append("process remained alive")
        if (
            self._gateway_port is not None
            and self._port_is_listening(self._gateway_port)
        ):
            cleanup_errors.append(
                f"gateway port {self._gateway_port} remained active"
            )
        if process is not None:
            try:
                self._adapter.status_item_snapshot(
                    process.pid,
                    expected_help=STATUS_HELP,
                )
            except Exception:
                pass
            else:
                cleanup_errors.append("status item remained present")
        if cleanup_errors:
            raise ProvisioningError(
                "Desktop shell cleanup failed: "
                + "; ".join(cleanup_errors)
            )
        return EphemeralHandlerCleanup(
            closed=True,
            secrets_zeroized=True,
        )

    def _require_active(
        self,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> None:
        if (
            self._closed
            or cancellation.is_set()
            or time.monotonic() >= deadline_monotonic
        ):
            raise EphemeralCapabilityBlocked(
                "Desktop shell status-item owner is unavailable",
                resource=CAPABILITY_ID,
            )

    def _ensure_process(
        self,
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> int:
        if self._process is None:
            self._storage_root.mkdir(parents=True, exist_ok=True)
            self._log_stream = self._log_path.open("wb")
            self._gateway_port = _available_port()
            environment = os.environ.copy()
            environment.update(
                {
                    "PEERS_STORAGE_ROOT": str(self._storage_root),
                    "PT_GATEWAY_PORT": str(self._gateway_port),
                    "PT_PROFILE": "acceptance-desktop-shell",
                }
            )
            self._process = subprocess.Popen(
                (str(self._app_binary),),
                cwd=self._app_binary.parent,
                env=environment,
                stdout=self._log_stream,
                stderr=subprocess.STDOUT,
            )
        process = self._process
        while time.monotonic() < deadline_monotonic:
            self._require_active(deadline_monotonic, cancellation)
            if process.poll() is not None:
                detail = (
                    self._log_path.read_text(
                        encoding="utf-8",
                        errors="replace",
                    )[-4000:]
                    if self._log_path.is_file()
                    else ""
                )
                raise EphemeralCapabilityBlocked(
                    f"Packaged Desktop exited before tray readiness: {detail}",
                    resource="desktop-shell-process",
                )
            try:
                self._adapter.status_item_snapshot(
                    process.pid,
                    expected_help=STATUS_HELP,
                )
                window = self._adapter.window_state(process.pid)
                if int(window["windowCount"]) == 0:
                    self._adapter.show_main_window_from_status_item(
                        process.pid,
                        expected_help=STATUS_HELP,
                        menu_item_title=SHOW_MENU_ITEM,
                    )
                return process.pid
            except Exception:
                time.sleep(0.1)
        raise EphemeralCapabilityBlocked(
            "Packaged Desktop status item did not become ready",
            resource="desktop-shell-status-item",
        )

    def _inspect(self, process_id: int) -> dict[str, object]:
        process_executable = self._process_executable(process_id)
        return {
            "processId": process_id,
            "processAlive": (
                self._process is not None
                and self._process.poll() is None
            ),
            "processExecutableSha256": _sha256_file(process_executable),
            "package": dict(self._package_identity),
            "statusItem": self._adapter.status_item_snapshot(
                process_id,
                expected_help=STATUS_HELP,
            ).to_dict(),
            "window": self._adapter.window_state(process_id),
        }

    def _process_executable(self, process_id: int) -> Path:
        libproc = ctypes.CDLL("/usr/lib/libproc.dylib")
        libproc.proc_pidpath.argtypes = [
            ctypes.c_int,
            ctypes.c_void_p,
            ctypes.c_uint32,
        ]
        libproc.proc_pidpath.restype = ctypes.c_int
        buffer = ctypes.create_string_buffer(4096)
        length = libproc.proc_pidpath(
            process_id,
            buffer,
            len(buffer),
        )
        if length <= 0:
            raise ProvisioningError(
                "Packaged Desktop process executable is unavailable"
            )
        executable = Path(
            buffer.value.decode("utf-8")
        ).resolve(strict=True)
        if executable != self._app_binary:
            raise ProvisioningError(
                "Packaged Desktop process executable does not match the bundle"
            )
        return executable

    @staticmethod
    def _port_is_listening(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.2)
            return probe.connect_ex(("127.0.0.1", port)) == 0


class DesktopShellNativeProvisioner(EnvironmentProvisioner):
    environment_id = ENVIRONMENT_ID

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)
        self._handler: DesktopShellStatusItemHandler | None = None
        self._storage_root: Path | None = None

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id != GATE_ID:
                raise BlockedError(
                    reason=(
                        f"Desktop shell environment does not support {gate_id}"
                    ),
                    resource=f"gate-environment:{gate_id}",
                )
            if sys.platform != "darwin":
                raise BlockedError(
                    reason="Desktop shell tray proof requires macOS",
                    resource="runtime-cell:desktop-macos-native",
                )
            if self._manifest.workspace_digest != "clean":
                raise BlockedError(
                    reason="Desktop shell proof requires a clean source worktree",
                    resource="source-identity:worktree-cleanliness",
                )
            self._manifest = self._preflighted(
                self._manifest,
                profile_name="desktop-shell-native",
                slot=0,
            )
            self._build_package()
            self._storage_root = Path(
                tempfile.mkdtemp(prefix="peers-desktop-shell-")
            )
            self.register_cleanup(
                "desktop-shell-storage",
                self._cleanup_storage,
            )
            client = ClientRuntime(
                id=CLIENT_ID,
                actor="desktop-user",
                runtime="native-tauri-packaged",
                worktree=str(REPO_ROOT),
                gateway_port=0,
                renderer_port=0,
                webdriver_port=0,
                profile="desktop-shell-native",
                storage_root=str(self._storage_root),
                required_service_roles=(),
                service_bindings={},
            )
            self._manifest = dataclasses.replace(
                self._manifest,
                state=ProvisioningState.PROVISIONED,
                clients=(client,),
                cleanup_resources=self.contract.cleanup.resources,
            )
            return self._ready(self._manifest)
        except (
            BlockedError,
            OSError,
            ProvisioningError,
            subprocess.SubprocessError,
        ) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Desktop shell provisioning failed: {error}",
                    resource=f"{ENVIRONMENT_ID}:provisioning",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )

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
            or evidence_run_id != self.evidence_run.run_id
            or provisioning_run_id != self._manifest.run_id
            or self._storage_root is None
        ):
            raise BlockedError(
                reason=(
                    "Desktop shell parent authority is not ready or does not "
                    "match the Gate run"
                ),
                resource=f"ephemeral-capabilities:{gate_id}",
            )
        self._handler = DesktopShellStatusItemHandler(
            artifact_writer=self.evidence_run,
            app_binary=APP_BINARY,
            tray_asset=TRAY_ASSET,
            storage_root=self._storage_root,
        )
        self.register_cleanup(
            "desktop-shell-process",
            self._cleanup_handler,
        )
        context = EphemeralGateLaunchContext(
            required_capabilities=required_capabilities,
            request_timeout_seconds=60.0,
            quiesce_timeout_seconds=10.0,
        )
        context.register_capability(CAPABILITY_ID, self._handler)
        return context

    def _build_package(self) -> None:
        completed = subprocess.run(
            (
                "pnpm",
                "--dir",
                "apps/desktop",
                "exec",
                "tauri",
                "build",
                "--debug",
                "--bundles",
                "app",
            ),
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=3600,
            check=False,
        )
        if completed.returncode != 0:
            raise BlockedError(
                reason=(
                    "Packaged Desktop build failed: "
                    + (
                        completed.stderr.strip()
                        or completed.stdout.strip()
                        or f"exit {completed.returncode}"
                    )[-4000:]
                ),
                resource="desktop-shell-package-build",
            )
        for path in (APP_BUNDLE, APP_BINARY, TRAY_ASSET):
            if not path.exists():
                raise BlockedError(
                    reason=f"Desktop shell package input is missing: {path}",
                    resource="desktop-shell-package",
                )
        driver = subprocess.run(
            ("make", "acceptance-driver-build"),
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=3600,
            check=False,
        )
        if driver.returncode != 0 or not DEDICATED_BINARY.is_file():
            raise BlockedError(
                reason=(
                    "Desktop runtime-cell driver build failed: "
                    + (
                        driver.stderr.strip()
                        or driver.stdout.strip()
                        or f"exit {driver.returncode}"
                    )[-4000:]
                ),
                resource="desktop-acceptance-binary",
            )

    def _cleanup_handler(self) -> None:
        if self._handler is None:
            return
        result = self._handler.close()
        if not result.closed:
            raise ProvisioningError(
                "Desktop shell capability handler did not close"
            )

    def _cleanup_storage(self) -> None:
        if self._storage_root is None:
            return
        try:
            shutil.rmtree(self._storage_root)
        except FileNotFoundError:
            pass
        if self._storage_root.exists():
            raise ProvisioningError(
                "Desktop shell storage remained after cleanup"
            )
