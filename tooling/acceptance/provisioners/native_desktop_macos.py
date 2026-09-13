"""Local macOS Native Desktop runtime-cell lifecycle."""

from __future__ import annotations

import getpass
import hashlib
import json
import os
import platform
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
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
from tooling.acceptance.drivers.native.base import (
    MouseAction,
    NativeControlSnapshot,
)
from tooling.acceptance.drivers.native.macos import MacOSNativeDesktopAdapter
from tooling.acceptance.drivers.tauri import (
    LocalTauriLauncher,
    TauriSession,
    find_app_binary,
    resolve_smoke_port,
)


_WINDOW_BOUNDS_PROBE = r"""
import json
import sys

import Quartz

process_id = int(sys.argv[1])
windows = Quartz.CGWindowListCopyWindowInfo(
    Quartz.kCGWindowListOptionOnScreenOnly
    | Quartz.kCGWindowListExcludeDesktopElements,
    Quartz.kCGNullWindowID,
)
candidates = []
for window in windows:
    if int(window.get(Quartz.kCGWindowOwnerPID, -1)) != process_id:
        continue
    if int(window.get(Quartz.kCGWindowLayer, -1)) != 0:
        continue
    if float(window.get(Quartz.kCGWindowAlpha, 0)) <= 0:
        continue
    bounds = window.get(Quartz.kCGWindowBounds) or {}
    width = float(bounds.get("Width", 0))
    height = float(bounds.get("Height", 0))
    if width <= 0 or height <= 0:
        continue
    candidates.append(
        {
            "left": float(bounds.get("X", 0)),
            "top": float(bounds.get("Y", 0)),
            "width": width,
            "height": height,
        }
    )
if not candidates:
    raise SystemExit("no visible process-owned window")
candidates.sort(key=lambda value: value["width"] * value["height"], reverse=True)
print(json.dumps(candidates[0], sort_keys=True))
"""

_DISPLAY_PROBE = r"""
import json

import Quartz

display_id = Quartz.CGMainDisplayID()
width = int(Quartz.CGDisplayPixelsWide(display_id))
height = int(Quartz.CGDisplayPixelsHigh(display_id))
print(
    json.dumps(
        {
            "displayId": str(display_id),
            "width": width,
            "height": height,
            "connected": width > 0 and height > 0,
        },
        sort_keys=True,
    )
)
"""

_POINTER_LOCATION_PROBE = r"""
import json

import Quartz

event = Quartz.CGEventCreate(None)
if event is None:
    raise SystemExit("cannot create pointer-location event")
point = Quartz.CGEventGetLocation(event)
print(json.dumps({"x": float(point.x), "y": float(point.y)}, sort_keys=True))
"""


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class NativeDesktopMacOSProvisioner:
    """Owns one local macOS GUI-session lease and its probe evidence."""

    def __init__(
        self,
        *,
        contract_path: Path | None = None,
        source_root: Path = REPO_ROOT,
        state_root: Path | None = None,
    ) -> None:
        selected_contract = contract_path or (
            RUNTIME_CELLS_DIR / "desktop-macos-native.yaml"
        )
        self.contract = RuntimeCellContract.from_yaml(selected_contract)
        if self.contract.platform != "macos":
            raise ProvisioningError(
                "NativeDesktopMacOSProvisioner requires macos"
            )
        self.source_root = source_root.resolve()
        root = state_root or (
            REPO_ROOT / ".local" / "acceptance" / "runtime-cells"
        )
        self.state_path = root / f"{self.contract.cell_id}.json"

    def ready(
        self,
        gate_id: str = "runtime-cell-preflight",
    ) -> RuntimeCellManifest:
        if sys.platform != "darwin":
            raise BlockedError(
                reason="desktop-macos-native requires a macOS orchestrator",
                resource=f"runtime-cell:{self.contract.cell_id}",
            )
        if self.state_path.exists():
            raise BlockedError(
                reason=(
                    f"macOS runtime cell {self.contract.cell_id} "
                    "already has owner state; run stop before ready"
                ),
                resource=f"runtime-cell:{self.contract.cell_id}",
            )

        run_id = (
            f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}-"
            f"{secrets.token_hex(8)}"
        )
        expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=self.contract.lease_ttl_seconds
        )
        self._write_state(
            {
                "cellId": self.contract.cell_id,
                "gateId": gate_id,
                "runId": run_id,
                "state": "PREPARING",
            }
        )
        try:
            source = self._source_identity()
            platform_identity, transport, display = self._host_identity()
            adapter, webdriver_port = self._probe_native_adapter()
            transport = CellTransportIdentity(
                kind=transport.kind,
                host_identity_sha256=transport.host_identity_sha256,
                host_key_sha256=transport.host_key_sha256,
                webdriver_local_port=webdriver_port,
                webdriver_remote_port=webdriver_port,
            )
            manifest = RuntimeCellManifest(
                cell_id=self.contract.cell_id,
                gate_id=gate_id,
                run_id=run_id,
                state=RuntimeCellState.LEASED,
                platform=platform_identity,
                transport=transport,
                display=display,
                source=source,
                native_adapter=adapter,
                lease_owner_run_id=run_id,
                lease_expires_at=expires_at.isoformat(),
                cleanup_registered=True,
                cleanup_resources=self.contract.cleanup_resources,
            )
            manifest.validate(self.contract)
            self._write_state(
                {
                    "cellId": self.contract.cell_id,
                    "gateId": gate_id,
                    "runId": run_id,
                    "state": RuntimeCellState.LEASED.value,
                    "manifest": manifest.to_dict(),
                }
            )
            return manifest
        except BaseException:
            self.state_path.unlink(missing_ok=True)
            raise

    def status(self) -> dict[str, Any]:
        if not self.state_path.is_file():
            return {
                "cellId": self.contract.cell_id,
                "state": RuntimeCellState.CLEANED.value,
            }
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ProvisioningError(
                f"macOS runtime-cell state is invalid: {error}"
            ) from error
        if not isinstance(value, dict):
            raise ProvisioningError("macOS runtime-cell state is not an object")
        return value

    def logs(self, tail: int = 200) -> str:
        del tail
        return json.dumps(self.status(), indent=2, sort_keys=True)

    def stop(self) -> dict[str, Any]:
        previous = self.status()
        self.state_path.unlink(missing_ok=True)
        return {
            "cellId": self.contract.cell_id,
            "state": RuntimeCellState.CLEANED.value,
            "previousState": previous.get("state"),
            "clean": not self.state_path.exists(),
        }

    def _source_identity(self) -> CellSourceIdentity:
        commit = self._git("rev-parse", "HEAD")
        tree = self._git("rev-parse", "HEAD^{tree}")
        dirty = subprocess.run(
            (
                "git",
                "-C",
                str(self.source_root),
                "status",
                "--porcelain",
                "--untracked-files=all",
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        if dirty.returncode != 0:
            raise ProvisioningError(
                "cannot inspect local macOS runtime-cell source"
            )
        if dirty.stdout.strip():
            raise BlockedError(
                reason=(
                    "desktop-macos-native requires a clean source worktree"
                ),
                resource="source-identity:worktree-cleanliness",
            )
        binary = Path(find_app_binary()).resolve()
        if not binary.is_file():
            raise BlockedError(
                reason=f"macOS Acceptance binary is missing: {binary}",
                resource="desktop-acceptance-binary",
            )
        return CellSourceIdentity(
            mode="local-worktree",
            commit=commit,
            workspace_digest="clean",
            remote_source_digest=_sha256_text(
                f"{self.source_root}:{commit}:{tree}"
            ),
            remote_checkout_clean=True,
            binary_sha256=_file_sha256(binary),
        )

    def _host_identity(
        self,
    ) -> tuple[
        CellPlatformIdentity,
        CellTransportIdentity,
        CellDisplayIdentity,
    ]:
        display = self._json_probe(_DISPLAY_PROBE, "display")
        width = int(display.get("width") or 0)
        height = int(display.get("height") or 0)
        if not display.get("connected") or width <= 0 or height <= 0:
            raise BlockedError(
                reason="macOS runtime cell has no connected display",
                resource="runtime-cell-display",
            )
        architecture = platform.machine().lower()
        if architecture == "aarch64":
            architecture = "arm64"
        host_seed = (
            f"{platform.node()}:{platform.platform()}:{architecture}:"
            f"{os.getuid()}"
        )
        host_digest = _sha256_text(host_seed)
        system_version = platform.mac_ver()[0] or "unknown"
        return (
            CellPlatformIdentity(
                os="macos",
                host_distribution=f"macOS {system_version}",
                host_kernel=platform.release(),
                isolation_kind="host",
                image_digest="",
                distribution=f"macOS {system_version}",
                architecture=architecture,
                webview_backend="WKWebView",
                webview_version=system_version,
            ),
            CellTransportIdentity(
                kind="local",
                host_identity_sha256=host_digest,
                host_key_sha256=_sha256_text(f"local:{host_digest}"),
                webdriver_local_port=0,
                webdriver_remote_port=0,
            ),
            CellDisplayIdentity(
                session_type="native-macos",
                display_id=str(display.get("displayId") or "main"),
                seat="console",
                width=width,
                height=height,
                connected_output=True,
                desktop_user_identity_sha256=_sha256_text(
                    f"{getpass.getuser()}:{os.getuid()}"
                ),
            ),
        )

    def _probe_native_adapter(
        self,
    ) -> tuple[CellAdapterIdentity, int]:
        webdriver_port = resolve_smoke_port(0)
        launcher = LocalTauriLauncher(
            app_binary=find_app_binary(),
            port=webdriver_port,
            profile=f"{self.contract.cell_id}-probe",
        )
        session = TauriSession(launcher)
        screenshot_root = Path(
            tempfile.mkdtemp(prefix="pt-macos-cell-probe-")
        )
        screenshot = screenshot_root / "desktop.png"
        log_path: Path | None = None
        try:
            session.start()
            session.wait_for_ready()
            session.wait_for_acceptance_harness()
            process_id = session.process_id
            if process_id is None:
                raise ProvisioningError(
                    "macOS runtime-cell probe process identity is unavailable"
                )
            adapter = MacOSNativeDesktopAdapter()
            control = self._await_focused_process(adapter, process_id)
            bounds = self._json_probe(
                _WINDOW_BOUNDS_PROBE,
                "window bounds",
                str(process_id),
            )
            point = (
                float(bounds["left"]) + float(bounds["width"]) / 2,
                float(bounds["top"]) + float(bounds["height"]) / 2,
            )
            adapter.post_mouse((MouseAction.MOVE,), point)
            pointer = self._json_probe(
                _POINTER_LOCATION_PROBE,
                "pointer location",
            )
            input_probe = (
                abs(float(pointer.get("x") or 0) - point[0]) <= 1
                and abs(float(pointer.get("y") or 0) - point[1]) <= 1
            )
            stack = adapter.window_stack_at_point(point)
            adapter.capture_screenshot(screenshot)
            probes = CellAdapterIdentity(
                input_backend=self.contract.native_adapter.input,
                window_backend=self.contract.native_adapter.window,
                screenshot_backend=self.contract.native_adapter.screenshot,
                input_probe=input_probe,
                focus_probe=(
                    not control.error
                    and control.frontmost
                    and control.actual_frontmost_pid == process_id
                    and control.window_count > 0
                ),
                point_ownership_probe=(
                    not stack.error and stack.point_owned_by(process_id)
                ),
                screenshot_probe=(
                    screenshot.is_file() and screenshot.stat().st_size > 0
                ),
            )
            if not (
                probes.input_probe
                and probes.focus_probe
                and probes.point_ownership_probe
                and probes.screenshot_probe
            ):
                raise BlockedError(
                    reason=(
                        "macOS Native adapter probes are incomplete: "
                        f"control={control.to_dict()} "
                        f"pointer={pointer} expectedPoint={point} "
                        f"windowStack={stack.to_dict()} "
                        f"screenshot={probes.screenshot_probe}"
                    ),
                    resource="runtime-cell-native-adapter",
                )
            log_path = session.log_path
            return probes, webdriver_port
        finally:
            session.stop()
            shutil.rmtree(screenshot_root, ignore_errors=True)
            if log_path is None:
                log_path = launcher.log_path
            if log_path is not None:
                log_path.unlink(missing_ok=True)

    @staticmethod
    def _await_focused_process(
        adapter: MacOSNativeDesktopAdapter,
        process_id: int,
        *,
        timeout_seconds: float = 5.0,
        interval_seconds: float = 0.1,
    ) -> NativeControlSnapshot:
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        last_control = NativeControlSnapshot(
            error="Native focus probe did not run"
        )
        while True:
            adapter.activate_process(process_id)
            if interval_seconds > 0:
                time.sleep(interval_seconds)
            last_control = adapter.focused_control(process_id)
            if (
                not last_control.error
                and last_control.frontmost
                and last_control.actual_frontmost_pid == process_id
                and last_control.window_count > 0
            ):
                return last_control
            if time.monotonic() >= deadline:
                raise BlockedError(
                    reason=(
                        "macOS Native process did not reach exact-PID focus "
                        f"within {timeout_seconds:.1f}s: "
                        f"{last_control.to_dict()}"
                    ),
                    resource="runtime-cell-native-focus",
                )

    def _git(self, *args: str) -> str:
        completed = subprocess.run(
            ("git", "-C", str(self.source_root), *args),
            capture_output=True,
            text=True,
            check=False,
        )
        value = completed.stdout.strip()
        if completed.returncode != 0 or not value:
            detail = completed.stderr.strip() or "git returned no value"
            raise ProvisioningError(
                f"cannot inspect macOS runtime-cell source: {detail}"
            )
        return value

    @staticmethod
    def _json_probe(
        script: str,
        operation: str,
        *args: str,
    ) -> dict[str, Any]:
        completed = subprocess.run(
            (sys.executable, "-c", script, *args),
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        if completed.returncode != 0:
            raise BlockedError(
                reason=(
                    f"macOS runtime-cell {operation} probe failed: "
                    f"{completed.stderr.strip() or completed.stdout.strip()}"
                ),
                resource=f"runtime-cell-{operation.replace(' ', '-')}",
            )
        try:
            value = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise ProvisioningError(
                f"macOS runtime-cell {operation} returned invalid JSON"
            ) from error
        if not isinstance(value, dict):
            raise ProvisioningError(
                f"macOS runtime-cell {operation} did not return an object"
            )
        return value

    def _write_state(self, value: dict[str, Any]) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_name(
            f".{self.state_path.name}.{os.getpid()}.{time.time_ns()}.tmp"
        )
        try:
            temporary.write_text(
                json.dumps(value, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            if os.name != "nt":
                temporary.chmod(0o600)
            os.replace(temporary, self.state_path)
        finally:
            temporary.unlink(missing_ok=True)
