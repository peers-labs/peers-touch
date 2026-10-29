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
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from selenium.webdriver.common.keys import Keys

from tooling.acceptance.core import (
    CellAdapterIdentity,
    CellDisplayIdentity,
    CellNonInterferenceIdentity,
    CellPlatformIdentity,
    CellSourceIdentity,
    CellTransportIdentity,
    REPO_ROOT,
    RUNTIME_CELLS_DIR,
    RuntimeCellContract,
    RuntimeCellManifest,
    RuntimeCellState,
)
from tooling.acceptance.core.runtime_cell import CellFileChooserIdentity
from tooling.acceptance.core.errors import (
    BlockedError,
    DriverError,
    ProvisioningError,
)
from tooling.acceptance.core.evidence_store import source_identity
from tooling.acceptance.drivers.native.base import (
    MouseAction,
    NativeControlSnapshot,
    NativeInputIsolation,
    NativeInputMode,
    NativeOperatorObservation,
    NativeWindowStack,
    admit_local_native_input_mode,
)
from tooling.acceptance.drivers.native.macos import MacOSNativeDesktopAdapter
from tooling.acceptance.drivers.tauri import (
    LocalTauriLauncher,
    TauriSession,
    resolve_smoke_port,
)
from .desktop_acceptance_build import DesktopAcceptanceBuild


NATIVE_WINDOW_READY_TIMEOUT_SECONDS = 30.0
NATIVE_FOCUS_READY_TIMEOUT_SECONDS = 30.0


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
        self._acceptance_binary: Path | None = None
        root = state_root or (
            REPO_ROOT / ".local" / "acceptance" / "runtime-cells"
        )
        self.state_path = root / f"{self.contract.cell_id}.json"

    def ready(
        self,
        gate_id: str = "runtime-cell-preflight",
        *,
        artifact_kind: str = "acceptance-binary",
    ) -> RuntimeCellManifest:
        if artifact_kind != "acceptance-binary":
            raise BlockedError(
                reason=(
                    f"macOS runtime cell does not support artifact kind "
                    f"{artifact_kind!r}"
                ),
                resource=f"runtime-cell-artifact:{self.contract.cell_id}",
            )
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

        admit_local_native_input_mode(
            os.environ.get("PT_ACCEPTANCE_DESKTOP_INPUT_MODE"),
            os.environ.get("PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION"),
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
            adapter, webdriver_port = self._probe_native_adapter(source, run_id)
            current = source_identity(self.source_root)
            if (
                current["commit"] != source.commit
                or current["workspaceDigest"] != source.workspace_digest
                or self._acceptance_binary is None
                or _file_sha256(self._acceptance_binary) != source.binary_sha256
            ):
                raise BlockedError(
                    reason="macOS runtime-cell candidate changed during adapter preparation",
                    resource="source-identity:local-snapshot",
                )
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
        source = source_identity(self.source_root)
        commit = source["commit"]
        tree = self._git("rev-parse", "HEAD^{tree}")
        binary = self._build_acceptance_binary()
        if source_identity(self.source_root) != source:
            raise BlockedError(
                reason="macOS runtime-cell source changed while preparing its binary",
                resource="source-identity:local-snapshot",
            )
        self._acceptance_binary = binary
        return CellSourceIdentity(
            mode="local-worktree",
            commit=commit,
            workspace_digest=source["workspaceDigest"],
            remote_source_digest=_sha256_text(
                json.dumps({**source, "tree": tree}, sort_keys=True)
            ),
            remote_checkout_clean=source["workspaceDigest"] == "clean",
            binary_sha256=_file_sha256(binary),
            canonical_root=str(self.source_root.resolve()),
            binary_path=str(binary),
        )

    def _build_acceptance_binary(self) -> Path:
        override = os.environ.get("PT_ACCEPTANCE_APP_BINARY", "").strip()
        build = DesktopAcceptanceBuild(
            self.source_root,
            binary=Path(override) if override else None,
        )
        return build.ensure()

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
        source: CellSourceIdentity,
        run_id: str,
    ) -> tuple[CellAdapterIdentity, int]:
        input_mode = admit_local_native_input_mode(
            os.environ.get("PT_ACCEPTANCE_DESKTOP_INPUT_MODE"),
            os.environ.get("PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION"),
        )
        if self._acceptance_binary is None:
            raise BlockedError(
                reason="Native adapter probe requires the source-bound Acceptance binary",
                resource="source-identity:acceptance-binary",
            )
        webdriver_port = resolve_smoke_port(0)
        launcher = LocalTauriLauncher(
            app_binary=self._acceptance_binary,
            port=webdriver_port,
            profile=f"{self.contract.cell_id}-probe",
            environment={
                "PT_ACCEPTANCE_WINDOW_SLOT": "0",
                "PT_ACCEPTANCE_WINDOW_COUNT": "1",
                "PT_ACCEPTANCE_DESKTOP_INPUT_MODE": input_mode.value,
                "PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION": (
                    NativeInputIsolation.ISOLATED_GUI_SESSION.value
                    if input_mode is NativeInputMode.EXCLUSIVE_NATIVE_INPUT
                    else NativeInputIsolation.SHARED_USER_SESSION.value
                ),
            },
        )
        session = TauriSession(launcher)
        adapter = MacOSNativeDesktopAdapter(input_mode)
        screenshot_root = Path(
            tempfile.mkdtemp(prefix="pt-macos-cell-probe-")
        )
        screenshot = screenshot_root / "desktop.png"
        log_path: Path | None = None
        session_stopped = False
        try:
            operator = (
                adapter.observe_operator()
                if input_mode is NativeInputMode.SEMANTIC_NON_INTRUSIVE
                else None
            )
            session.start()
            session.wait_for_ready()
            session.wait_for_acceptance_harness()
            if input_mode is NativeInputMode.SEMANTIC_NON_INTRUSIVE:
                (
                    semantic_action_probe,
                    semantic_screenshot_probe,
                    non_interference,
                ) = self._probe_semantic_non_interference(
                    session,
                    adapter,
                    screenshot,
                    operator=operator,
                )
                chooser = self._probe_file_chooser(session, adapter, operator)
                log_path = session.log_path
                cleanup_errors = session.stop()
                session_stopped = True
                if cleanup_errors:
                    raise ProvisioningError("Native qualifier cleanup failed")
                non_interference = operator.sample(
                    "owned-stop", target_process_id=chooser.target_process_id,
                )
                chooser = replace(
                    chooser, cell_id=self.contract.cell_id, run_id=run_id,
                    source_commit=source.commit, workspace_digest=source.workspace_digest,
                    binary_sha256=source.binary_sha256,
                    observations=tuple(operator.observations.values()),
                )
                non_interference_probe = non_interference.unchanged()
                probes = CellAdapterIdentity(
                    input_backend=self.contract.native_adapter.input,
                    window_backend=self.contract.native_adapter.window,
                    screenshot_backend=self.contract.native_adapter.screenshot,
                    input_probe=False,
                    focus_probe=False,
                    point_ownership_probe=False,
                    screenshot_probe=False,
                    input_mode=input_mode.value,
                    semantic_backend="tauri-embedded-webdriver",
                    semantic_action_probe=semantic_action_probe,
                    semantic_screenshot_probe=semantic_screenshot_probe,
                    non_interference_probe=non_interference_probe,
                    non_interference=non_interference,
                    file_chooser=chooser,
                )
                if not (
                    probes.semantic_action_probe
                    and probes.semantic_screenshot_probe
                    and probes.non_interference_probe
                ):
                    raise BlockedError(
                        reason=(
                            "macOS semantic adapter probes are incomplete: "
                            f"actions={probes.semantic_action_probe} "
                            f"screenshot={probes.semantic_screenshot_probe} "
                            f"frontmostPidBefore="
                            f"{non_interference.frontmost_pid_before} "
                            f"frontmostPidAfter="
                            f"{non_interference.frontmost_pid_after} "
                            f"pointerBefore=("
                            f"{non_interference.pointer_x_before},"
                            f"{non_interference.pointer_y_before}) "
                            f"pointerAfter=("
                            f"{non_interference.pointer_x_after},"
                            f"{non_interference.pointer_y_after}) "
                            f"keyboardFocusUnchanged="
                            f"{non_interference.keyboard_focus_before_sha256 == non_interference.keyboard_focus_after_sha256}"
                        ),
                        resource="runtime-cell-semantic-adapter",
                    )
                return probes, webdriver_port

            session.driver.set_window_rect(x=100, y=100)
            process_id = session.process_id
            if process_id is None:
                raise ProvisioningError(
                    "macOS runtime-cell probe process identity is unavailable"
                )
            self._await_accessible_window(adapter, process_id)
            adapter.position_main_window(process_id, (100.0, 100.0))
            bounds = self._await_window_bounds(process_id)
            point, pointer, stack, input_probe, attempted_points = (
                self._await_process_owned_point(
                    session,
                    adapter,
                    process_id,
                    bounds,
                )
            )
            activation_point = (
                point
                if input_probe
                and not stack.error
                and stack.point_owned_by(process_id)
                else None
            )
            focus_probe = self._await_webview_focus(
                session,
                adapter,
                activation_point=activation_point,
            )
            point, pointer, stack, input_probe, attempted_points = (
                self._probe_owned_point(
                    adapter,
                    process_id,
                    bounds,
                )
            )
            adapter.capture_screenshot(screenshot)
            probes = CellAdapterIdentity(
                input_backend=self.contract.native_adapter.input,
                window_backend=self.contract.native_adapter.window,
                screenshot_backend=self.contract.native_adapter.screenshot,
                input_probe=input_probe,
                focus_probe=focus_probe,
                point_ownership_probe=(
                    not stack.error and stack.point_owned_by(process_id)
                ),
                screenshot_probe=(
                    screenshot.is_file() and screenshot.stat().st_size > 0
                ),
                input_mode=input_mode.value,
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
                        f"input={probes.input_probe} "
                        f"focus={probes.focus_probe} "
                        f"pointOwnership={probes.point_ownership_probe} "
                        f"pointer={pointer} expectedPoint={point} "
                        f"windowStack={stack.to_dict()} "
                        f"attemptedPoints={attempted_points} "
                        f"screenshot={probes.screenshot_probe}"
                    ),
                    resource="runtime-cell-native-adapter",
                )
            log_path = session.log_path
            return probes, webdriver_port
        finally:
            if not session_stopped:
                session.stop()
            shutil.rmtree(screenshot_root, ignore_errors=True)
            if log_path is None:
                log_path = launcher.log_path
            if log_path is not None:
                log_path.unlink(missing_ok=True)

    @classmethod
    def _await_process_owned_point(
        cls,
        session: TauriSession,
        adapter: MacOSNativeDesktopAdapter,
        process_id: int,
        bounds: dict[str, Any],
        *,
        timeout_seconds: float = NATIVE_FOCUS_READY_TIMEOUT_SECONDS,
        interval_seconds: float = 0.1,
    ) -> tuple[
        tuple[float, float],
        dict[str, Any],
        NativeWindowStack,
        bool,
        tuple[tuple[float, float], ...],
    ]:
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        last_probe: tuple[
            tuple[float, float],
            dict[str, Any],
            NativeWindowStack,
            bool,
            tuple[tuple[float, float], ...],
        ] | None = None
        while True:
            activation = session.invoke_app_result(
                "acceptance_request_activation"
            )
            if activation.get("ok") is not True:
                raise BlockedError(
                    reason=(
                        "macOS runtime-cell probe rejected "
                        "process-owned activation"
                    ),
                    resource="runtime-cell-native-focus",
                )
            last_probe = cls._probe_owned_point(
                adapter,
                process_id,
                bounds,
            )
            _, _, stack, input_probe, _ = last_probe
            if (
                input_probe
                and not stack.error
                and stack.point_owned_by(process_id)
            ):
                return last_probe
            if time.monotonic() >= deadline:
                point, pointer, stack, _, attempted_points = last_probe
                raise BlockedError(
                    reason=(
                        "macOS Native process-owned point did not converge "
                        f"within {timeout_seconds:.1f}s: "
                        f"pointer={pointer} expectedPoint={point} "
                        f"windowStack={stack.to_dict()} "
                        f"attemptedPoints={attempted_points}"
                    ),
                    resource="runtime-cell-native-focus",
                )
            if interval_seconds > 0:
                time.sleep(interval_seconds)

    def _probe_semantic_non_interference(
        self,
        session: TauriSession,
        adapter: MacOSNativeDesktopAdapter,
        screenshot: Path,
        *,
        operator: NativeOperatorObservation,
    ) -> tuple[bool, bool, CellNonInterferenceIdentity]:
        if session.process_id is None:
            raise BlockedError(
                reason="semantic window has no owning process",
                resource="runtime-cell-semantic-adapter",
            )
        operator.sample("launch-ready", target_process_id=session.process_id)
        self._await_window_bounds(session.process_id)
        semantic_action_probe = self._probe_semantic_actions(session)
        session.save_screenshot(screenshot)
        semantic_screenshot_probe = (
            screenshot.is_file() and screenshot.stat().st_size > 0
        )
        return (
            semantic_action_probe,
            semantic_screenshot_probe,
            operator.sample("semantic-ready", target_process_id=session.process_id),
        )

    @staticmethod
    def _probe_file_chooser(
        session: TauriSession, adapter: MacOSNativeDesktopAdapter,
        operator: NativeOperatorObservation,
    ) -> CellFileChooserIdentity:
        process_id = session.process_id
        with tempfile.TemporaryDirectory(
            prefix="PeersTouchChooserQualification-", dir=Path.home(),
        ) as raw:
            # Unique filename makes the exact-PID AX search fallback match a
            # single row; the exact path and file hash are still read back.
            target = (
                Path(raw).resolve()
                / f"qualification-{secrets.token_hex(6)}.bin"
            )
            target.write_bytes(secrets.token_bytes(32))
            fixture_hash = _file_sha256(target)
            baseline = operator.file_chooser(
                "chooser-before", target_process_id=process_id, present=False,
            )
            session.execute_script("""
                const button = document.createElement('button');
                button.dataset.ptChooserQualification = 'true';
                button.textContent = 'Choose qualification file';
                button.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647';
                button.onclick = () => {
                  window.__ptChooserQualification = {pending:true};
                  window.__TAURI_INTERNALS__.invoke('oss_pick_local_file').then(result => {
                    window.__ptChooserQualification = {pending:false,result};
                  }).catch(error => {
                    window.__ptChooserQualification = {pending:false,error:String(error)};
                  });
                };
                document.body.append(button);
            """)
            try:
                session.semantic_click(session.find_element(
                    "[data-pt-chooser-qualification]",
                ))
                opened = operator.file_chooser(
                    "chooser-open", target_process_id=process_id, present=True,
                    timeout_seconds=5.0,
                )
                selected = adapter.select_file_chooser_path_to_process(process_id, str(target))
                deadline = time.monotonic() + 5.0
                while True:
                    result = session.execute_script("return window.__ptChooserQualification")
                    if isinstance(result, dict) and result.get("pending") is False:
                        break
                    if time.monotonic() >= deadline:
                        raise ProvisioningError("Native qualification selection was not committed")
                    time.sleep(0.05)
                native = result.get("result") or {}
                payload = native.get("data") or {}
                if (
                    selected is None or selected.error or selected.value != str(target)
                    or native.get("ok") is not True
                    or payload.get("command") != "oss_pick_local_file"
                    or payload.get("status") != str(target)
                ):
                    raise ProvisioningError("Native qualification selected a different file")
                closed = operator.file_chooser(
                    "chooser-selected", target_process_id=process_id, present=False,
                )
                return CellFileChooserIdentity(
                    cell_id="", run_id="", source_commit="", workspace_digest="",
                    binary_sha256="", backend="macos-accessibility",
                    target_process_id=process_id,
                    requested_path_sha256=_sha256_text(str(target)),
                    selected_path_sha256=_sha256_text(selected.value),
                    fixture_sha256=fixture_hash, selected_file_sha256=_file_sha256(target),
                    panel_presence=(baseline.present, opened.present, closed.present),
                    observations=(),
                )
            finally:
                session.execute_script("""
                    document.querySelector('[data-pt-chooser-qualification]')?.remove();
                    delete window.__ptChooserQualification;
                """)

    @staticmethod
    def _probe_semantic_actions(session: TauriSession) -> bool:
        session.execute_script(
            """
            document.querySelector('[data-pt-runtime-cell-probe]')?.remove();
            const root = document.createElement('div');
            root.dataset.ptRuntimeCellProbe = 'true';
            root.style.cssText = [
              'position:fixed',
              'left:8px',
              'bottom:8px',
              'z-index:2147483647',
              'display:flex',
              'gap:4px',
              'padding:4px',
              'background:#fff',
            ].join(';');
            const hover = document.createElement('button');
            hover.dataset.ptSemanticProbe = 'hover';
            hover.textContent = 'Hover';
            hover.addEventListener('mouseover', () => {
              root.dataset.hovered = '1';
            });
            const click = document.createElement('button');
            click.dataset.ptSemanticProbe = 'click';
            click.textContent = 'Click';
            click.addEventListener('click', () => {
              root.dataset.clicked = '1';
            });
            const input = document.createElement('input');
            input.dataset.ptSemanticProbe = 'input';
            const key = document.createElement('button');
            key.dataset.ptSemanticProbe = 'key';
            key.textContent = 'Key';
            key.addEventListener('click', () => {
              root.dataset.keyCount = String(
                Number(root.dataset.keyCount || '0') + 1,
              );
            });
            root.append(hover, click, input, key);
            document.body.append(root);
            """
        )
        try:
            hover = session.find_element(
                '[data-pt-semantic-probe="hover"]'
            )
            click = session.find_element(
                '[data-pt-semantic-probe="click"]'
            )
            input_element = session.find_element(
                '[data-pt-semantic-probe="input"]'
            )
            key = session.find_element(
                '[data-pt-semantic-probe="key"]'
            )
            session.semantic_hover(hover)
            session.semantic_click(click)
            session.semantic_replace_text(
                input_element,
                "semantic-probe",
            )
            session.semantic_key_sequence(key, Keys.ENTER)
            result = session.execute_script(
                """
                const root = document.querySelector(
                  '[data-pt-runtime-cell-probe]',
                );
                const input = root?.querySelector(
                  '[data-pt-semantic-probe="input"]',
                );
                return {
                  hovered: root?.dataset.hovered === '1',
                  clicked: root?.dataset.clicked === '1',
                  text: input?.value || '',
                  keyCount: Number(root?.dataset.keyCount || '0'),
                };
                """
            )
            return (
                isinstance(result, dict)
                and result.get("hovered") is True
                and result.get("clicked") is True
                and result.get("text") == "semantic-probe"
                and result.get("keyCount") == 1
            )
        finally:
            session.execute_script(
                """
                document.querySelector(
                  '[data-pt-runtime-cell-probe]',
                )?.remove();
                """
            )

    @staticmethod
    def _await_webview_focus(
        session: TauriSession,
        adapter: MacOSNativeDesktopAdapter,
        *,
        activation_point: tuple[float, float] | None,
        timeout_seconds: float = 15.0,
        interval_seconds: float = 0.1,
    ) -> bool:
        if activation_point is None:
            return False
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        while True:
            adapter.post_mouse(
                (MouseAction.LEFT_DOWN, MouseAction.LEFT_UP),
                activation_point,
            )
            if bool(
                session.driver.execute_script(
                    "return document.hasFocus()"
                )
            ):
                return True
            if time.monotonic() >= deadline:
                raise BlockedError(
                    reason=(
                        "macOS Native WebView did not receive focus at its "
                        f"process-owned point within {timeout_seconds:.1f}s"
                    ),
                    resource="runtime-cell-native-focus",
                )
            if interval_seconds > 0:
                time.sleep(interval_seconds)

    @classmethod
    def _probe_owned_point(
        cls,
        adapter: MacOSNativeDesktopAdapter,
        process_id: int,
        bounds: dict[str, Any],
    ) -> tuple[
        tuple[float, float],
        dict[str, Any],
        NativeWindowStack,
        bool,
        tuple[tuple[float, float], ...],
    ]:
        left = float(bounds["left"])
        top = float(bounds["top"])
        width = float(bounds["width"])
        height = float(bounds["height"])
        ratios = (
            (0.5, 0.5),
            (0.25, 0.75),
            (0.75, 0.75),
            (0.25, 0.25),
            (0.75, 0.25),
        )
        points = tuple(
            (left + width * x_ratio, top + height * y_ratio)
            for x_ratio, y_ratio in ratios
        )
        pointer: dict[str, Any] = {}
        stack = NativeWindowStack(error="Native point ownership probe did not run")
        input_probe = False
        for point in points:
            adapter.post_mouse((MouseAction.MOVE,), point)
            pointer = adapter.pointer_location()
            input_probe = (
                abs(float(pointer.get("x") or 0) - point[0]) <= 1
                and abs(float(pointer.get("y") or 0) - point[1]) <= 1
            )
            stack = adapter.window_stack_at_point(point)
            if (
                input_probe
                and not stack.error
                and stack.point_owned_by(process_id)
            ):
                return point, pointer, stack, True, points
        return points[-1], pointer, stack, input_probe, points

    @staticmethod
    def _await_focused_process(
        adapter: MacOSNativeDesktopAdapter,
        process_id: int,
        *,
        timeout_seconds: float = NATIVE_FOCUS_READY_TIMEOUT_SECONDS,
        interval_seconds: float = 0.1,
        activation_point: tuple[float, float] | None = None,
    ) -> NativeControlSnapshot:
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        last_control = adapter.focused_control(process_id)
        while True:
            if (
                not last_control.error
                and last_control.actual_frontmost_pid == process_id
            ):
                return last_control
            if activation_point is not None:
                adapter.post_mouse(
                    (MouseAction.LEFT_DOWN, MouseAction.LEFT_UP),
                    activation_point,
                )
                if interval_seconds > 0:
                    time.sleep(interval_seconds)
                last_control = adapter.focused_control(process_id)
                if (
                    not last_control.error
                    and last_control.actual_frontmost_pid == process_id
                ):
                    return last_control
            try:
                adapter.activate_process(process_id)
            except DriverError as error:
                last_control = NativeControlSnapshot(error=str(error))
            else:
                if interval_seconds > 0:
                    time.sleep(interval_seconds)
                last_control = adapter.focused_control(process_id)
            if time.monotonic() >= deadline:
                raise BlockedError(
                    reason=(
                        "macOS Native process did not reach exact-PID focus "
                        f"within {timeout_seconds:.1f}s: "
                        f"{last_control.to_dict()}"
                    ),
                    resource="runtime-cell-native-focus",
                )
            if last_control.error and interval_seconds > 0:
                time.sleep(interval_seconds)

    @staticmethod
    def _await_accessible_window(
        adapter: MacOSNativeDesktopAdapter,
        process_id: int,
        *,
        timeout_seconds: float = NATIVE_WINDOW_READY_TIMEOUT_SECONDS,
        interval_seconds: float = 0.1,
    ) -> dict[str, object]:
        # Embedded WebDriver readiness does not imply that AppKit has
        # registered the window in the owning process's Accessibility tree.
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        while True:
            state = adapter.window_state(process_id)
            if int(state["windowCount"]) > 0:
                return state
            if time.monotonic() >= deadline:
                raise BlockedError(
                    reason=(
                        "macOS runtime-cell process-owned Accessibility window "
                        f"did not become available within {timeout_seconds:.1f}s"
                    ),
                    resource="runtime-cell-accessibility-window",
                )
            if interval_seconds > 0:
                time.sleep(interval_seconds)

    @classmethod
    def _await_window_bounds(
        cls,
        process_id: int,
        *,
        timeout_seconds: float = NATIVE_WINDOW_READY_TIMEOUT_SECONDS,
        interval_seconds: float = 0.1,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        while True:
            try:
                return cls._json_probe(
                    _WINDOW_BOUNDS_PROBE,
                    "window bounds",
                    str(process_id),
                )
            except BlockedError as error:
                if not error.reason.endswith(
                    ": no visible process-owned window"
                ):
                    raise
                if time.monotonic() >= deadline:
                    raise BlockedError(
                        reason=(
                            "macOS runtime-cell process-owned window did not "
                            f"become visible within {timeout_seconds:.1f}s"
                        ),
                        resource="runtime-cell-window-bounds",
                    ) from error
                if interval_seconds > 0:
                    time.sleep(interval_seconds)

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
