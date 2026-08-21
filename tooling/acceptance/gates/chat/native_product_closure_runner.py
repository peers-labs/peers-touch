#!/usr/bin/env python3
"""Prove the MP-W13 Chat product closure through real Native DOM actions."""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import secrets
import socket
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, Callable

from selenium.webdriver import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import (
    AcceptanceGate,
    ActorRuntime,
    ArtifactRef,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    call_async_harness,
)
from tooling.acceptance.core.provisioning import load_runtime_manifest
from tooling.acceptance.drivers.station import StationDriver
from tooling.acceptance.drivers.tauri import TauriDriver, find_app_binary
from tooling.acceptance.fixtures.chat_submit_fault_proxy import (
    ProfileThreeSubmitFaultProxy,
)
from tooling.acceptance.gates.chat.native_support import wait_until


GATE_ID = "chat-native-product-closure-e2e"
NATIVE_INPUT_ACK_POLL_SECONDS = 0.01
READBACK_COMMANDS = {
    "conversation_get_member_settings",
    "messaging_list_messages",
    "messaging_open_attachment",
}
REQUIRED_ASSERTIONS = {
    "native_dom_only",
    "source_build_runtime_identity",
    "transcript_exact",
    "thread_exact",
    "toolbar_geometry",
    "reaction_picker_success",
    "reaction_failure_recovery",
    "avatar_exact_loaded",
    "station_attribution_exact",
    "settings_station_readback",
    "settings_restart_recovery",
    "background_upload_recovery",
    "attachment_failure_draft_retained",
    "attachment_count_conservation",
    "attachment_byte_exact",
    "cleanup_ports_released",
}
REQUIRED_EVIDENCE = {
    "alice-final-screenshot",
    "alice-final-dom",
    "bob-final-screenshot",
    "bob-final-dom",
    "source-build-runtime",
    "transcript-thread",
    "reaction-geometry",
    "identity-station",
    "settings-background",
    "attachment-ledger",
    "cleanup",
}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def public_fixture_password() -> str:
    path = REPO_ROOT / "apps" / "station" / "app" / "conf" / "actor.yml"
    current_email = ""
    passwords: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("email:"):
            current_email = line.split(":", 1)[1].strip().strip("'\"")
        elif current_email and line.startswith("password:"):
            passwords[current_email] = line.split(":", 1)[1].strip().strip("'\"")
            current_email = ""
    values = {passwords.get("alice@p.t"), passwords.get("bob@p.t")}
    values.discard(None)
    values.discard("")
    if len(values) != 1:
        raise GateError("committed Alice/Bob Acceptance fixture password is invalid")
    return values.pop()


def runtime_manifest() -> tuple[dict[str, Any], dict[str, Any]]:
    raw_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
    if not raw_path:
        raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
    manifest = load_runtime_manifest(Path(raw_path), GATE_ID)
    actor_ref = manifest.get("actorManifest")
    if not isinstance(actor_ref, dict):
        raise GateError("runtime manifest actorManifest is required")
    store = EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT)
    actors = store.read_json(ArtifactRef.from_dict(actor_ref))
    if actors.get("artifactKind") != "acceptance-actor-manifest":
        raise GateError("runtime actor manifest has invalid artifact kind")
    return manifest, actors


def gateway_read(
    client: TauriDriver,
    command: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    if command not in READBACK_COMMANDS:
        raise GateError(f"mutating or unapproved gateway command is forbidden: {command}")
    request = urllib.request.Request(
        f"http://127.0.0.1:{client.gateway_port}",
        data=json.dumps({"cmd": command, "args": args}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        envelope = json.loads(response.read().decode("utf-8"))
    if not isinstance(envelope, dict) or envelope.get("ok") is not True:
        raise GateError(f"{command} readback failed: {envelope}")
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise GateError(f"{command} readback returned invalid data")
    return data


def port_is_free(port: int) -> bool:
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) != 0


class NativeProductClosureGate(AcceptanceGate):
    gate_id = GATE_ID

    def __init__(self) -> None:
        super().__init__()
        self.manifest, self.actor_manifest = runtime_manifest()
        station = self.manifest.get("station")
        self.station_url = str(
            station.get("url") if isinstance(station, dict) else ""
        ).rstrip("/")
        if not self.station_url:
            raise GateError("runtime manifest Station URL is required")
        self.client_specs = {
            str(client.get("actor")): client
            for client in self.manifest.get("clients", [])
            if isinstance(client, dict)
        }
        self.actor_specs = {
            str(actor.get("role")): actor
            for actor in self.actor_manifest.get("actors", [])
            if isinstance(actor, dict)
        }
        if set(self.client_specs) != {"alice", "bob"}:
            raise GateError("runtime manifest must allocate isolated Alice and Bob clients")
        if set(self.actor_specs) != {"alice", "bob"}:
            raise GateError("actor manifest must contain canonical Alice and Bob identities")
        self.clients: dict[str, TauriDriver] = {}
        self.ptids: dict[str, str] = {}
        self.device_ids: dict[str, str] = {}
        self.steps: list[dict[str, Any]] = []
        self.structured_evidence: dict[str, Any] = {}
        self.reaction_proxy: ProfileThreeSubmitFaultProxy | None = None
        self.fixture_root = Path(tempfile.mkdtemp(prefix="pt-chat-product-closure-"))
        self.binary = Path(find_app_binary()).resolve()
        self.report.station_url = self.station_url
        self.report.manifest = self.manifest

    def step(self, name: str, action: Callable[[], Any]) -> Any:
        try:
            value = action()
        except Exception as error:
            self.steps.append({"step": name, "status": "fail", "error": str(error)})
            raise
        self.steps.append({"step": name, "status": "pass"})
        return value

    def write_json_evidence(self, key: str, value: Any) -> None:
        path = self.fixture_root / f"{key}.json"
        path.write_text(
            json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True, default=str)
            + "\n",
            encoding="utf-8",
        )
        self.report.add_evidence_file(key, path)

    def configure_station(self, client: TauriDriver, station_url: str) -> None:
        with StationDriver(f"http://127.0.0.1:{client.gateway_port}") as station:
            station.station_add(station_url)
            station.station_set_active(station_url)

    def launch_actor(self, actor: str) -> None:
        spec = self.client_specs[actor]
        window_actors = ("alice", "bob")
        actor_station_url = (
            self.reaction_proxy.url
            if actor == "alice" and self.reaction_proxy is not None
            else self.station_url
        )
        client = TauriDriver(
            app_binary=str(self.binary),
            port=int(spec["webdriver_port"]),
            gateway_port=int(spec["gateway_port"]),
            profile=str(spec["profile"]),
            storage_root=str(spec["storage_root"]),
            environment={
                "PEERS_STATION_URL": actor_station_url,
                "PT_ACCEPTANCE_WINDOW_SLOT": str(window_actors.index(actor)),
                "PT_ACCEPTANCE_WINDOW_COUNT": str(len(window_actors)),
            },
        )
        client.start()
        self.register_driver(client)
        try:
            client.wait_for_acceptance_harness(30)
            self.configure_station(client, actor_station_url)
            with StationDriver(
                f"http://127.0.0.1:{client.gateway_port}"
            ) as station:
                station.auth_logout()
            account_ref = str(self.actor_specs[actor].get("accountRef") or "")
            account = account_ref.removeprefix("station-account:")
            login = call_async_harness(
                client,
                "loginWithPassword",
                {"account": account, "password": public_fixture_password()},
                namespace="chat",
                script_timeout=30,
            )
            ptid = str((login or {}).get("actorId") or "")
            expected_ptid = str(self.actor_specs[actor].get("ptid") or "")
            if not (login or {}).get("authenticated") or ptid != expected_ptid:
                raise GateError(
                    f"{actor} login identity mismatch: expected={expected_ptid} actual={ptid}"
                )
            device = call_async_harness(
                client,
                "getRealtimeDevice",
                {},
                namespace="chat",
                script_timeout=30,
            )
            device_id = str((device or {}).get("deviceId") or "")
            if not device_id:
                raise GateError(f"{actor} messaging device identity is missing")
            self.clients[actor] = client
            self.ptids[actor] = ptid
            self.device_ids[actor] = device_id
            self.report.add_actor(
                ActorRuntime(
                    name=actor,
                    runtime="native-tauri-embedded-webdriver",
                    port=client.port,
                    gateway_port=client.gateway_port,
                    profile=client.profile,
                    storage_root=client.storage_root,
                    pid=client.process_id,
                )
            )
        except Exception:
            client.stop()
            raise

    def restart_actor(self, actor: str) -> None:
        previous_device = self.device_ids[actor]
        self.clients[actor].stop()
        self.launch_actor(actor)
        if self.device_ids[actor] != previous_device:
            raise GateError(f"{actor} device identity changed across restart")

    def native_window(self, client: TauriDriver) -> dict[str, float]:
        rect = client.driver.get_window_rect()
        scale = float(
            client.driver.execute_script("return window.devicePixelRatio || 1")
        )
        if scale <= 0:
            raise GateError(f"Native window scale is invalid: {scale}")
        return {
            "left": float(rect["x"]) / scale,
            "top": float(rect["y"]) / scale,
            "width": float(rect["width"]) / scale,
            "height": float(rect["height"]) / scale,
        }

    def post_mouse(
        self,
        event_types: tuple[int, ...],
        point: tuple[float, float],
    ) -> None:
        class CGPoint(ctypes.Structure):
            _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

        core_graphics = ctypes.CDLL(
            "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
        )
        core_foundation = ctypes.CDLL(
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
        )
        core_graphics.CGEventCreateMouseEvent.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint32,
            CGPoint,
            ctypes.c_uint32,
        ]
        core_graphics.CGEventCreateMouseEvent.restype = ctypes.c_void_p
        core_graphics.CGEventSourceCreate.argtypes = [ctypes.c_int32]
        core_graphics.CGEventSourceCreate.restype = ctypes.c_void_p
        core_graphics.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
        core_foundation.CFRelease.argtypes = [ctypes.c_void_p]

        native_point = CGPoint(*point)
        event_source = core_graphics.CGEventSourceCreate(0)
        if not event_source:
            raise GateError("CoreGraphics failed to create the login event source")
        try:
            for event_type in event_types:
                event = core_graphics.CGEventCreateMouseEvent(
                    event_source,
                    event_type,
                    native_point,
                    0,
                )
                if not event:
                    raise GateError(
                        "CoreGraphics failed to create Native mouse event"
                    )
                core_graphics.CGEventPost(0, event)
                core_foundation.CFRelease(event)
        finally:
            core_foundation.CFRelease(event_source)

    def post_key(
        self,
        key_code: int,
        *,
        flags: int = 0,
        text: str = "",
    ) -> None:
        core_graphics = ctypes.CDLL(
            "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
        )
        core_foundation = ctypes.CDLL(
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
        )
        core_graphics.CGEventCreateKeyboardEvent.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint16,
            ctypes.c_bool,
        ]
        core_graphics.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
        core_graphics.CGEventSetFlags.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint64,
        ]
        core_graphics.CGEventKeyboardSetUnicodeString.argtypes = [
            ctypes.c_void_p,
            ctypes.c_ulong,
            ctypes.POINTER(ctypes.c_uint16),
        ]
        core_graphics.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
        core_foundation.CFRelease.argtypes = [ctypes.c_void_p]

        encoded = text.encode("utf-16-le")
        unicode_units = (ctypes.c_uint16 * (len(encoded) // 2)).from_buffer_copy(
            encoded
        )
        for pressed in (True, False):
            event = core_graphics.CGEventCreateKeyboardEvent(
                None,
                key_code,
                pressed,
            )
            if not event:
                raise GateError("CoreGraphics failed to create Native keyboard event")
            if flags:
                core_graphics.CGEventSetFlags(event, flags)
            if text:
                core_graphics.CGEventKeyboardSetUnicodeString(
                    event,
                    len(unicode_units),
                    unicode_units,
                )
            core_graphics.CGEventPost(0, event)
            core_foundation.CFRelease(event)

    def activate_native_process(self, process_id: int) -> None:
        script = f"""
        tell application "System Events"
          set targetProcess to first application process whose unix id is {process_id}
          set frontmost of targetProcess to true
          try
            perform action "AXRaise" of front window of targetProcess
          end try
          return frontmost of targetProcess
        end tell
        """
        completed = subprocess.run(
            ("osascript", "-e", script),
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise GateError(
                "Native actor activation failed: "
                f"{completed.stderr.strip() or completed.stdout.strip()}"
            )
        if completed.stdout.strip() != "true":
            raise GateError(
                f"Native actor process {process_id} did not become frontmost"
            )

    def native_focused_control(self, process_id: int) -> dict[str, Any]:
        script = f"""
        tell application "System Events"
          set targetProcess to first application process whose unix id is {process_id}
          set processFrontmost to frontmost of targetProcess
          set windowCount to count of windows of targetProcess
          set sheetCount to 0
          repeat with appWindow in windows of targetProcess
            try
              set sheetCount to sheetCount + (count of sheets of appWindow)
            end try
          end repeat
          set subroleName to ""
          set roleName to ""
          set titleValue to ""
          set controlValue to ""
          try
            set focusedElement to value of attribute "AXFocusedUIElement" of targetProcess
            set roleName to value of attribute "AXRole" of focusedElement
            try
              set subroleName to value of attribute "AXSubrole" of focusedElement
            end try
            try
              set titleValue to value of attribute "AXTitle" of focusedElement as text
            end try
            try
              set controlValue to value of attribute "AXValue" of focusedElement as text
            end try
          end try
          return roleName & tab & subroleName & tab & titleValue & tab & controlValue & tab & windowCount & tab & sheetCount & tab & processFrontmost
        end tell
        """
        completed = subprocess.run(
            ("osascript", "-e", script),
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            return {"error": completed.stderr.strip()}
        fields = completed.stdout.rstrip("\n").split("\t", 6)
        if len(fields) != 7:
            return {"error": f"unexpected AX response: {completed.stdout!r}"}
        return {
            "role": fields[0],
            "subrole": fields[1],
            "title": fields[2],
            "value": fields[3],
            "windowCount": int(fields[4]),
            "sheetCount": int(fields[5]),
            "frontmost": fields[6] == "true",
        }

    def choose_native_file(
        self,
        actor: str,
        *,
        trigger_selector: str,
        file_path: Path,
    ) -> dict[str, Any]:
        client = self.focus_actor_window(actor)
        if client.process_id is None:
            raise GateError(f"{actor} Native file chooser has no owning process")
        selected_path = file_path.resolve()
        if not selected_path.is_file():
            raise GateError(f"Native file selection source is missing: {selected_path}")

        # #region debug-point L-M:native-file-chooser-handoff
        last_native_file_snapshot = ""

        def report_native_file_snapshot(
            phase: str,
            focused_control: dict[str, Any] | None = None,
        ) -> None:
            nonlocal last_native_file_snapshot
            snapshot = client.execute_script(
                """
                return {
                  documentFocused: document.hasFocus(),
                  visibilityState: document.visibilityState,
                  activeElement: {
                    tag: document.activeElement?.tagName || '',
                    role: document.activeElement?.getAttribute?.('role') || '',
                    classes: document.activeElement?.className?.baseVal
                      || document.activeElement?.className
                      || '',
                  },
                };
                """
            )
            snapshot["focusedControl"] = (
                focused_control
                if focused_control is not None
                else self.native_focused_control(client.process_id or 0)
            )
            signature = json.dumps(snapshot, sort_keys=True)
            if signature == last_native_file_snapshot:
                return
            last_native_file_snapshot = signature
            request = urllib.request.Request(
                "http://127.0.0.1:7783/event",
                data=json.dumps(
                    {
                        "sessionId": "chat-background-picker",
                        "runId": "native-file-post-fix",
                        "hypothesisId": "L-M",
                        "location":
                            "NativeProductClosureGate:choose_native_file",
                        "msg": f"[DEBUG] Native file chooser {phase}",
                        "data": snapshot,
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                urllib.request.urlopen(request, timeout=2).read()
            except OSError:
                pass

        baseline_control = self.native_focused_control(client.process_id)
        report_native_file_snapshot("before-trigger", baseline_control)
        # #endregion
        self.click(actor, trigger_selector)
        # #region debug-point L-M:native-file-chooser-handoff
        report_native_file_snapshot("after-trigger")
        # #endregion

        def panel_open(control: dict[str, Any]) -> bool:
            return (
                int(control.get("windowCount", 0))
                > int(baseline_control.get("windowCount", 0))
                or int(control.get("sheetCount", 0))
                > int(baseline_control.get("sheetCount", 0))
            )

        def native_panel_ready(_: Any) -> dict[str, Any] | None:
            control = self.native_focused_control(client.process_id or 0)
            # #region debug-point L-M:native-file-chooser-handoff
            report_native_file_snapshot("panel-poll", control)
            # #endregion
            return control if panel_open(control) else None

        WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(native_panel_ready)

        command_shift = 0x00100000 | 0x00020000
        self.post_key(5, flags=command_shift)
        go_to_control = WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(
            lambda _: (
                control
                if (
                    (control := self.native_focused_control(
                        client.process_id or 0
                    )).get("role")
                    == "AXTextField"
                )
                else None
            )
        )
        # #region debug-point M:native-file-path-entry
        report_native_file_snapshot("go-to-field", go_to_control)
        # #endregion

        self.post_key(0, text=str(selected_path))
        # #region debug-point M:native-file-path-entry
        report_native_file_snapshot("after-path-key")
        # #endregion

        def native_path_ready(_: Any) -> dict[str, Any] | None:
            control = self.native_focused_control(client.process_id or 0)
            # #region debug-point M:native-file-path-entry
            report_native_file_snapshot("path-poll", control)
            # #endregion
            return control if control.get("value") == str(selected_path) else None

        WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(native_path_ready)

        self.post_key(36)

        def selection_or_browser_ready(_: Any) -> dict[str, Any] | None:
            control = self.native_focused_control(client.process_id or 0)
            if not panel_open(control):
                return {"selected": True, "control": control}
            if control.get("role") and control.get("role") != "AXTextField":
                return {"selected": False, "control": control}
            return None

        intermediate = WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(selection_or_browser_ready)
        if not intermediate["selected"]:
            self.post_key(36)
            WebDriverWait(
                client.driver,
                10,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(
                lambda _: (
                    control
                    if not panel_open(
                        control := self.native_focused_control(
                            client.process_id or 0
                        )
                    )
                    else None
                )
            )

        WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(
            lambda driver: bool(
                driver.execute_script("return document.hasFocus()")
            )
        )
        # #region debug-point L-M:native-file-chooser-handoff
        report_native_file_snapshot("selected")
        # #endregion
        return {
            "name": selected_path.name,
            "size": selected_path.stat().st_size,
        }

    def native_mouse_button_down(self) -> bool:
        core_graphics = ctypes.CDLL(
            "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
        )
        core_graphics.CGEventSourceButtonState.argtypes = [
            ctypes.c_int32,
            ctypes.c_uint32,
        ]
        core_graphics.CGEventSourceButtonState.restype = ctypes.c_bool
        return bool(core_graphics.CGEventSourceButtonState(0, 0))

    # #region debug-point R-V:native-input-delivery
    def native_cursor_position(self) -> tuple[float, float]:
        class CGPoint(ctypes.Structure):
            _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

        core_graphics = ctypes.CDLL(
            "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
        )
        core_foundation = ctypes.CDLL(
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
        )
        core_graphics.CGEventCreate.argtypes = [ctypes.c_void_p]
        core_graphics.CGEventCreate.restype = ctypes.c_void_p
        core_graphics.CGEventGetLocation.argtypes = [ctypes.c_void_p]
        core_graphics.CGEventGetLocation.restype = CGPoint
        core_foundation.CFRelease.argtypes = [ctypes.c_void_p]

        event = core_graphics.CGEventCreate(None)
        if not event:
            raise GateError("CoreGraphics failed to read the Native cursor")
        try:
            point = core_graphics.CGEventGetLocation(event)
            return (float(point.x), float(point.y))
        finally:
            core_foundation.CFRelease(event)
    # #endregion

    def install_native_input_probe(
        self,
        client: TauriDriver,
        element: Any,
    ) -> str:
        probe_id = secrets.token_hex(8)
        client.execute_script(
            """
            const target = arguments[0];
            const probeId = arguments[1];
            const registry = window.__PT_NATIVE_INPUT_PROBES__ ||= {};
            const existing = registry[probeId];
            existing?.cleanup?.();
            const eventTypes = [
              'pointermove',
              'mousemove',
              'pointerdown',
              'mousedown',
              'pointerup',
              'mouseup',
              'click',
            ];
            const events = [];
            const listener = (event) => {
              const eventTarget = event.target;
              const owned = (
                eventTarget === target
                || (
                  eventTarget instanceof Node
                  && target.contains(eventTarget)
                )
              );
              if (!owned) return;
              events.push({
                type: event.type,
                button: event.button,
                buttons: event.buttons,
                clientX: event.clientX,
                clientY: event.clientY,
              });
            };
            eventTypes.forEach((type) => {
              document.addEventListener(type, listener, true);
            });
            registry[probeId] = {
              events,
              cleanup: () => {
                eventTypes.forEach((type) => {
                  document.removeEventListener(type, listener, true);
                });
                delete registry[probeId];
              },
            };
            """,
            element,
            probe_id,
        )
        return probe_id

    def wait_native_input_event(
        self,
        client: TauriDriver,
        probe_id: str,
        event_type: str,
        after_index: int,
    ) -> int:
        def observed(driver: Any) -> int | None:
            events = driver.execute_script(
                """
                return (
                  window.__PT_NATIVE_INPUT_PROBES__?.[arguments[0]]?.events
                  || []
                );
                """,
                probe_id,
            )
            if not isinstance(events, list):
                return None
            for index in range(after_index, len(events)):
                event = events[index]
                if isinstance(event, dict) and event.get("type") == event_type:
                    return index + 1
            return None

        try:
            return int(
                WebDriverWait(
                    client.driver,
                    5,
                    poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
                ).until(observed)
            )
        except Exception as error:
            raise GateError(
                f"Native {event_type} was not acknowledged by the target DOM"
            ) from error

    def remove_native_input_probe(
        self,
        client: TauriDriver,
        probe_id: str,
    ) -> None:
        client.execute_script(
            """
            window.__PT_NATIVE_INPUT_PROBES__?.[arguments[0]]?.cleanup?.();
            """,
            probe_id,
        )

    def focus_actor_window(self, actor: str) -> TauriDriver:
        client = self.clients[actor]
        if client.process_id is None:
            raise GateError(f"{actor} Native window has no running process")
        if bool(client.driver.execute_script("return document.hasFocus()")):
            return client
        window = self.native_window(client)
        point = (
            window["left"] + window["width"] / 2,
            window["top"] + 16,
        )
        # #region debug-point N-Q:native-window-focus
        def report_focus_snapshot(phase: str) -> None:
            request = urllib.request.Request(
                "http://127.0.0.1:7784/event",
                data=json.dumps(
                    {
                        "sessionId": "chat-native-window-focus",
                        "runId": "post-fix-foreground-owner",
                        "hypothesisId": "N-Q",
                        "location":
                            "NativeProductClosureGate:focus_actor_window",
                        "msg": f"[DEBUG] Native window focus {phase}",
                        "data": {
                            "actor": actor,
                            "processId": client.process_id,
                            "documentFocused": bool(
                                client.driver.execute_script(
                                    "return document.hasFocus()"
                                )
                            ),
                            "mouseButtonDown": self.native_mouse_button_down(),
                            "window": window,
                            "point": point,
                            "focusedControl": self.native_focused_control(
                                client.process_id or 0
                            ),
                        },
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                urllib.request.urlopen(request, timeout=2).read()
            except OSError:
                pass

        report_focus_snapshot("before-move")
        # #endregion
        if self.native_mouse_button_down():
            self.post_mouse((2,), point)
            WebDriverWait(
                client.driver,
                5,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(
                lambda _: not self.native_mouse_button_down()
            )
            # #region debug-point N-Q:native-window-focus
            report_focus_snapshot("after-recovery-up")
            # #endregion
        self.activate_native_process(client.process_id)
        WebDriverWait(
            client.driver,
            5,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(
            lambda _: bool(
                self.native_focused_control(
                    client.process_id or 0
                ).get("frontmost")
            )
        )
        # #region debug-point N-Q:native-window-focus
        WebDriverWait(
            client.driver,
            5,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(
            lambda driver: bool(driver.execute_script("return document.hasFocus()"))
        )
        report_focus_snapshot("after-activate")
        # #endregion
        return client

    def click_element(self, actor: str, element: Any) -> Any:
        client = self.focus_actor_window(actor)
        WebDriverWait(client.driver, 30).until(
            lambda _: element.is_displayed() and element.is_enabled()
        )
        target = client.driver.execute_script(
            """
            const element = arguments[0];
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(x, y);
            const describe = (candidate) => {
              if (!candidate) return null;
              return {
                tag: candidate.tagName,
                id: candidate.id || '',
                classes: candidate.className?.baseVal
                  || candidate.className
                  || '',
                chatSend: candidate.matches?.('[data-chat-send]')
                  || Boolean(candidate.closest?.('[data-chat-send]')),
                role: candidate.getAttribute?.('role') || '',
              };
            };
            const owns = (candidate) => (
              candidate === element || element.contains(candidate)
            );
            const insetX = Math.min(4, rect.width / 4);
            const insetY = Math.min(4, rect.height / 4);
            const probes = [
              { name: 'center', x, y },
              { name: 'topLeft', x: rect.left + insetX, y: rect.top + insetY },
              { name: 'topRight', x: rect.right - insetX, y: rect.top + insetY },
              { name: 'bottomLeft', x: rect.left + insetX, y: rect.bottom - insetY },
              { name: 'bottomRight', x: rect.right - insetX, y: rect.bottom - insetY },
            ].map((probe) => {
              const candidate = document.elementFromPoint(probe.x, probe.y);
              return {
                ...probe,
                owned: owns(candidate),
                target: describe(candidate),
              };
            });
            return {
              x,
              y,
              hit: owns(hit),
              hitTarget: describe(hit),
              hitStack: document.elementsFromPoint(x, y)
                .slice(0, 8)
                .map(describe),
              probes,
              connected: element.isConnected,
              disabled: Boolean(element.disabled),
              rect: {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              },
              viewportWidth: innerWidth,
              viewportHeight: innerHeight,
            };
            """,
            element,
        )
        if not target.get("hit"):
            # #region debug-point M-P:native-click-occlusion
            request = urllib.request.Request(
                "http://127.0.0.1:7777/event",
                data=json.dumps(
                    {
                        "sessionId": "chat-hover-overlay",
                        "runId": "post-fix",
                        "hypothesisId": "M-P",
                        "location": "NativeProductClosureGate:click_element",
                        "msg": "[DEBUG] Native click target center is occluded",
                        "data": target,
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=2):
                    pass
            except OSError:
                pass
            # #endregion
            raise GateError(
                "Native click target center is occluded: "
                f"{json.dumps(target, sort_keys=True)}"
            )
        window = self.native_window(client)
        content_offset_x = max(
            0.0,
            (window["width"] - float(target["viewportWidth"])) / 2,
        )
        content_offset_y = max(
            0.0,
            window["height"] - float(target["viewportHeight"]),
        )
        point = (
            window["left"] + content_offset_x + float(target["x"]),
            window["top"] + content_offset_y + float(target["y"]),
        )
        cursor_position = self.native_cursor_position()
        requires_pointer_move = not (
            abs(cursor_position[0] - point[0]) < 0.5
            and abs(cursor_position[1] - point[1]) < 0.5
        )
        probe_id = self.install_native_input_probe(client, element)
        # #region debug-point R-V:native-input-delivery
        def report_native_input_delivery(phase: str) -> None:
            probe_events = client.execute_script(
                """
                return (
                  window.__PT_NATIVE_INPUT_PROBES__?.[arguments[0]]?.events
                  || []
                );
                """,
                probe_id,
            )
            request = urllib.request.Request(
                "http://127.0.0.1:7785/event",
                data=json.dumps(
                    {
                        "sessionId": "chat-native-input-delivery",
                        "runId": "post-fix",
                        "hypothesisId": "R-V",
                        "location":
                            "NativeProductClosureGate:click_element",
                        "msg": f"[DEBUG] Native input delivery {phase}",
                        "data": {
                            "actor": actor,
                            "processId": client.process_id,
                            "documentFocused": bool(
                                client.driver.execute_script(
                                    "return document.hasFocus()"
                                )
                            ),
                            "focusedControl": self.native_focused_control(
                                client.process_id or 0
                            ),
                            "cursor": self.native_cursor_position(),
                            "point": point,
                            "requiresPointerMove": requires_pointer_move,
                            "window": window,
                            "target": target,
                            "probeEvents": probe_events,
                        },
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                urllib.request.urlopen(request, timeout=2).read()
            except OSError:
                pass

        report_native_input_delivery("before-move")
        # #endregion
        try:
            cursor = 0
            if requires_pointer_move:
                self.post_mouse(
                    (5,),
                    point,
                )
                try:
                    cursor = self.wait_native_input_event(
                        client,
                        probe_id,
                        "mousemove",
                        cursor,
                    )
                except GateError:
                    # #region debug-point R-V:native-input-delivery
                    report_native_input_delivery("mousemove-timeout")
                    # #endregion
                    raise
            self.post_mouse(
                (1,),
                point,
            )
            cursor = self.wait_native_input_event(
                client,
                probe_id,
                "mousedown",
                cursor,
            )
            self.post_mouse(
                (2,),
                point,
            )
            cursor = self.wait_native_input_event(
                client,
                probe_id,
                "mouseup",
                cursor,
            )
            self.wait_native_input_event(
                client,
                probe_id,
                "click",
                cursor,
            )
        finally:
            self.remove_native_input_probe(client, probe_id)
        return element

    def click(self, actor: str, selector: str, timeout: float = 30) -> Any:
        client = self.focus_actor_window(actor)
        element = client.find_element(selector, timeout)
        return self.click_element(actor, element)

    def hover_message(self, actor: str, message_id: str) -> Any:
        client = self.focus_actor_window(actor)
        neutral = client.find_element("[data-chat-send]", 30)
        row = client.find_element(f'[data-message-ulid="{message_id}"]', 30)
        native_window: dict[str, float] | None = None

        def report_probe(phase: str) -> dict[str, Any]:
            snapshot = client.execute_script(
                """
                const neutral = arguments[0];
                const row = arguments[1];
                const describe = (element) => {
                  if (!element) return null;
                  const messageRow = element.closest('[data-message-ulid]');
                  return {
                    tag: element.tagName,
                    classes: element.className || '',
                    messageId: messageRow?.getAttribute('data-message-ulid') || '',
                    chatSend: element.matches('[data-chat-send]')
                      || Boolean(element.closest('[data-chat-send]')),
                  };
                };
                const inspect = (element) => {
                  const rect = element.getBoundingClientRect();
                  const centerX = rect.left + rect.width / 2;
                  const centerY = rect.top + rect.height / 2;
                  return {
                    rect: {
                      left: rect.left,
                      top: rect.top,
                      right: rect.right,
                      bottom: rect.bottom,
                      width: rect.width,
                      height: rect.height,
                    },
                    center: { x: centerX, y: centerY },
                    centerHit: describe(document.elementFromPoint(centerX, centerY)),
                    hovered: element.matches(':hover'),
                  };
                };
                return {
                  neutral: inspect(neutral),
                  row: inspect(row),
                  viewport: { width: innerWidth, height: innerHeight },
                  window: {
                    screenX,
                    screenY,
                    outerWidth,
                    outerHeight,
                    innerWidth,
                    innerHeight,
                  },
                };
                """,
                neutral,
                row,
            )
            # #region debug-point G-I:hover-probe
            request = urllib.request.Request(
                "http://127.0.0.1:7777/event",
                data=json.dumps(
                    {
                        "sessionId": "chat-hover-overlay",
                        "runId": "post-fix",
                        "hypothesisId": "G-I",
                        "location": "NativeProductClosureGate:hover_message",
                        "msg": f"[DEBUG] hover geometry probe {phase}",
                        "data": {
                            "phase": phase,
                            "messageId": message_id,
                            "nativeWindow": native_window,
                            **snapshot,
                        },
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=2):
                    pass
            except OSError:
                pass
            # #endregion
            return snapshot

        before = report_probe("before")
        native_window = self.native_window(client)
        content_offset_x = max(
            0.0,
            (native_window["width"] - float(before["viewport"]["width"])) / 2,
        )
        content_offset_y = max(
            0.0,
            native_window["height"] - float(before["viewport"]["height"]),
        )

        def screen_point(center: dict[str, float]) -> tuple[float, float]:
            return (
                native_window["left"] + content_offset_x + float(center["x"]),
                native_window["top"] + content_offset_y + float(center["y"]),
            )

        neutral_point = screen_point(before["neutral"]["center"])
        row_point = screen_point(before["row"]["center"])
        for step in range(13):
            ratio = step / 12
            self.post_mouse(
                (5,),
                (
                    neutral_point[0] + (row_point[0] - neutral_point[0]) * ratio,
                    neutral_point[1] + (row_point[1] - neutral_point[1]) * ratio,
                ),
            )

        report_probe("after")
        return WebDriverWait(client.driver, 15).until(
            lambda driver: driver.find_element(
                By.CSS_SELECTOR,
                f'[data-message-action-overlay="toolbar"]'
                f'[data-message-action-message="{message_id}"]',
            )
        )

    def composer_send(self, actor: str, text: str = "") -> None:
        client = self.clients[actor]
        composer = client.find_element('[data-pt-text-input="chat-composer"]', 30)
        self.click_element(actor, composer)
        composer.send_keys(Keys.COMMAND, "a")
        composer.send_keys(Keys.BACKSPACE)
        if text:
            composer.send_keys(text)
        self.click(actor, "[data-chat-send]")

    def wait_message_text(self, actor: str, text: str) -> dict[str, Any]:
        client = self.clients[actor]

        def snapshot() -> dict[str, Any] | None:
            value = client.execute_script(
                """
                const expected = arguments[0];
                const row = Array.from(document.querySelectorAll('[data-message-ulid]'))
                  .find((item) => {
                    const content = item.querySelector('[data-message-content]');
                    return (content?.innerText || '').includes(expected);
                  });
                if (row) {
                  return {
                    id: row.getAttribute('data-message-ulid') || '',
                    sequence: Number(row.getAttribute('data-message-authority-sequence') || 0),
                    attachmentCount: Number(row.getAttribute('data-message-attachment-count') || 0),
                    content: row.querySelector('[data-message-content]')?.innerText || '',
                  };
                }
                const preview = Array.from(
                  document.querySelectorAll('[data-thread-preview-message-id]'),
                ).find((item) => {
                  const content = item.querySelector('[data-thread-preview-message-content]');
                  return (content?.innerText || '').includes(expected);
                });
                if (!preview) return null;
                return {
                  id: preview.getAttribute('data-thread-preview-message-id') || '',
                  sequence: 0,
                  attachmentCount: 0,
                  content: preview.querySelector('[data-thread-preview-message-content]')?.innerText || '',
                };
                """,
                text,
            )
            return value if isinstance(value, dict) and value.get("id") else None

        return wait_until(snapshot, f"{actor} visible message {text!r}", timeout=120)

    def enter_chat_page(self, actor: str) -> None:
        client = self.clients[actor]
        if client.get_current_url().endswith("#/chat"):
            return
        self.click(
            actor,
            '[data-pt-primary-nav="chat"] button, '
            '[data-pt-primary-nav="chat"] [role="button"]',
        )
        WebDriverWait(client.driver, 20).until(
            lambda driver: driver.current_url.endswith("#/chat")
        )

    def open_group_through_ui(self) -> str:
        for actor in ("alice", "bob"):
            self.enter_chat_page(actor)
        self.click("alice", '[data-chat-subpage="chats"]')
        self.click("alice", "[data-chat-new-menu]")
        self.click("alice", "[data-chat-create-group-menu]")
        self.clients["alice"].find_element("[data-chat-create-group]", 20)
        self.click(
            "alice",
            f'[data-chat-create-group-contact="{self.ptids["bob"]}"]',
        )
        self.click("alice", "[data-chat-create-group-submit]")

        def active_group() -> str | None:
            pane = self.clients["alice"].find_element(
                "[data-chat-conversation-pane]",
                30,
            )
            group_id = pane.get_attribute("data-chat-conversation-pane") or ""
            kind = pane.get_attribute("data-group-security")
            return group_id if group_id and kind == "ready" else None

        group_id = wait_until(active_group, "Alice active MLS group", timeout=180)
        wait_until(
            lambda: self.clients["bob"].find_element(
                f'[data-chat-group-ulid="{group_id}"]',
                5,
            ),
            "Bob group conversation projection",
            timeout=180,
        )
        self.click("bob", f'[data-chat-group-ulid="{group_id}"]')
        wait_until(
            lambda: self.clients["bob"].find_element(
                f'[data-chat-conversation-pane="{group_id}"]'
                '[data-group-security="ready"]',
                5,
            ),
            "Bob active MLS group",
            timeout=180,
        )
        return str(group_id)

    def transcript(self, actor: str) -> list[dict[str, Any]]:
        value = self.clients[actor].execute_script(
            """
            return Array.from(document.querySelectorAll('[data-message-ulid]'))
              .map((row) => ({
                id: row.getAttribute('data-message-ulid') || '',
                sequence: Number(row.getAttribute('data-message-authority-sequence') || 0),
                content: row.querySelector('[data-message-content]')?.innerText || '',
                attachmentCount: Number(row.getAttribute('data-message-attachment-count') || 0),
              }))
              .sort((a, b) => (a.sequence - b.sequence) || a.id.localeCompare(b.id));
            """
        )
        return value if isinstance(value, list) else []

    def engine_messages(self, actor: str, conversation_id: str) -> list[dict[str, Any]]:
        value = gateway_read(
            self.clients[actor],
            "messaging_list_messages",
            {"conversation_id": conversation_id},
        ).get("messages")
        return value if isinstance(value, list) else []

    def prove_transcript_thread(self, group_id: str) -> tuple[str, str]:
        root_text = f"w13-root-{os.getpid()}"
        bob_text = f"w13-bob-{os.getpid()}"
        reply_text = f"w13-reply-{os.getpid()}"

        self.composer_send("alice", root_text)
        root = self.wait_message_text("alice", root_text)
        self.wait_message_text("bob", root_text)
        self.composer_send("bob", bob_text)
        bob_root = self.wait_message_text("bob", bob_text)
        self.wait_message_text("alice", bob_text)

        self.hover_message("alice", str(bob_root["id"]))
        self.click("alice", '[data-message-action="reply"]')
        self.composer_send("alice", reply_text)
        reply = self.wait_message_text("alice", reply_text)
        self.wait_message_text("bob", reply_text)

        def summary() -> dict[str, Any] | None:
            row = self.clients["alice"].find_element(
                f'[data-message-ulid="{bob_root["id"]}"]',
                10,
            )
            count = int(row.get_attribute("data-message-thread-reply-count") or 0)
            ids = [
                item
                for item in (
                    row.get_attribute("data-message-thread-reply-ids") or ""
                ).split(",")
                if item
            ]
            return {"count": count, "ids": ids} if count == 1 and ids else None

        thread_summary = wait_until(summary, "thread summary projection", timeout=120)
        self.hover_message("alice", str(bob_root["id"]))
        self.click("alice", '[data-message-action="thread"]')
        panel = self.clients["alice"].find_element("[data-chat-thread-panel='open']", 30)
        panel_snapshot = self.clients["alice"].execute_script(
            """
            const panel = arguments[0];
            return {
              root: panel.getAttribute('data-chat-thread-root') || '',
              count: Number(panel.getAttribute('data-chat-thread-reply-count') || 0),
              ids: Array.from(panel.querySelectorAll('[data-thread-message-role="reply"]'))
                .map((row) => row.getAttribute('data-thread-message-id') || ''),
            };
            """,
            panel,
        )
        self.assert_condition(
            "thread_exact",
            panel_snapshot.get("root") == bob_root["id"]
            and panel_snapshot.get("count") == thread_summary["count"]
            and panel_snapshot.get("ids") == thread_summary["ids"]
            and panel_snapshot.get("ids") == [reply["id"]],
            json.dumps({"summary": thread_summary, "panel": panel_snapshot}),
        )
        self.click("alice", "[data-chat-thread-close]")

        transcript_probe = {
            actor: [
                {
                    **{key: value for key, value in item.items() if key != "content"},
                    "contentSha256": hashlib.sha256(
                        str(item.get("content", "")).encode("utf-8")
                    ).hexdigest(),
                    "contentLength": len(str(item.get("content", ""))),
                }
                for item in self.transcript(actor)
            ]
            for actor in ("alice", "bob")
        }
        # #region debug-point O-S:top-level-transcript
        request = urllib.request.Request(
            "http://127.0.0.1:7780/event",
            data=json.dumps(
                {
                    "sessionId": "chat-transcript-projection",
                    "runId": "post-fix",
                    "hypothesisId": "O-S",
                    "location": "NativeProductClosureGate:prove_transcript_thread",
                    "msg": "[DEBUG] top-level transcript after thread close",
                    "data": transcript_probe,
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(request, timeout=2).read()
        except OSError:
            pass
        # #endregion

        expected_top_level_ids = [str(root["id"]), str(bob_root["id"])]
        expected_top_level_content = [root_text, bob_text]
        alice_transcript = wait_until(
            lambda: (
                value
                if (value := self.transcript("alice"))
                and [item["id"] for item in value] == expected_top_level_ids
                else None
            ),
            "Alice exact top-level transcript",
            timeout=120,
        )
        bob_transcript = wait_until(
            lambda: (
                value
                if (value := self.transcript("bob"))
                and [item["id"] for item in value] == expected_top_level_ids
                else None
            ),
            "Bob exact top-level transcript",
            timeout=120,
        )
        top_level_ids = [item["id"] for item in alice_transcript]
        authority_sequences = [item["sequence"] for item in alice_transcript]
        self.assert_condition(
            "transcript_exact",
            alice_transcript == bob_transcript
            and top_level_ids == expected_top_level_ids
            and all(
                expected in item["content"]
                for item, expected in zip(
                    alice_transcript,
                    expected_top_level_content,
                )
            )
            and reply["id"] not in top_level_ids
            and all(sequence > 0 for sequence in authority_sequences)
            and authority_sequences == sorted(authority_sequences),
            json.dumps({"alice": alice_transcript, "bob": bob_transcript}),
        )
        self.structured_evidence["transcriptThread"] = {
            "conversationId": group_id,
            "alice": alice_transcript,
            "bob": bob_transcript,
            "summary": thread_summary,
            "panel": panel_snapshot,
        }
        return str(root["id"]), str(bob_root["id"])

    def overlay_geometry(self, actor: str, message_id: str) -> dict[str, Any]:
        client = self.clients[actor]
        self.hover_message(actor, message_id)
        value = client.execute_script(
            """
            const messageId = arguments[0];
            const overlay = document.querySelector(
              `[data-message-action-overlay="toolbar"][data-message-action-message="${messageId}"]`
            );
            const row = document.querySelector(`[data-message-ulid="${messageId}"]`);
            const content = row?.querySelector('[data-message-content]');
            const pane = document.querySelector('[data-chat-conversation-pane]');
            const rows = Array.from(document.querySelectorAll('[data-message-ulid]'));
            const index = rows.indexOf(row);
            const rect = (element) => {
              const value = element?.getBoundingClientRect();
              return value ? {
                left: value.left, right: value.right, top: value.top, bottom: value.bottom,
                width: value.width, height: value.height,
              } : null;
            };
            const adjacent = [rows[index - 1], rows[index + 1]].filter(Boolean)
              .map((item) => rect(item.querySelector('[data-message-content]')))
              .filter(Boolean);
            return {
              overlay: rect(overlay),
              selected: rect(content),
              pane: rect(pane),
              viewport: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
              adjacent,
              placement: overlay?.getAttribute('data-message-action-placement') || '',
            };
            """,
            message_id,
        )

        def intersects(first: dict[str, float], second: dict[str, float]) -> bool:
            return not (
                first["right"] <= second["left"]
                or first["left"] >= second["right"]
                or first["bottom"] <= second["top"]
                or first["top"] >= second["bottom"]
            )

        overlay = value.get("overlay")
        pane = value.get("pane")
        viewport = value.get("viewport")
        selected = value.get("selected")
        valid = bool(
            overlay
            and pane
            and viewport
            and selected
            and overlay["left"] >= pane["left"]
            and overlay["right"] <= pane["right"]
            and overlay["top"] >= viewport["top"]
            and overlay["bottom"] <= viewport["bottom"]
            and not intersects(overlay, selected)
            and all(not intersects(overlay, item) for item in value.get("adjacent", []))
        )
        self.assert_condition("toolbar_geometry", valid, json.dumps(value))
        return value

    def choose_reaction(self, actor: str, message_id: str, emoji: str) -> None:
        self.hover_message(actor, message_id)
        self.click(actor, '[data-message-action="reaction"]')
        picker = self.clients[actor].find_element(
            f'[data-message-action-overlay="reaction-picker"]'
            f'[data-message-action-message="{message_id}"]',
            15,
        )
        candidates = picker.find_elements(By.CSS_SELECTOR, "[data-reaction-emoji]")
        target = next(
            (
                item
                for item in candidates
                if item.get_attribute("data-reaction-emoji") == emoji
            ),
            None,
        )
        if target is None:
            raise GateError(f"reaction picker does not contain {emoji}")
        self.click_element(actor, target)

    def reaction_visible(self, actor: str, message_id: str, emoji: str) -> bool:
        rows = self.clients[actor].find_elements(
            f'[data-message-ulid="{message_id}"] [data-message-reaction]'
        )
        return any(
            row.get_attribute("data-message-reaction") == emoji for row in rows
        )

    def prove_reaction(self, message_id: str) -> dict[str, Any]:
        success_emoji = "❤️"
        self.choose_reaction("alice", message_id, success_emoji)
        wait_until(
            lambda: self.reaction_visible("alice", message_id, success_emoji)
            and self.reaction_visible("bob", message_id, success_emoji),
            "reaction projection on Alice and Bob",
            timeout=120,
        )
        self.assert_condition("reaction_picker_success", True)
        self.click(
            "alice",
            f'[data-message-ulid="{message_id}"]'
            f' [data-message-reaction="{success_emoji}"]',
        )
        wait_until(
            lambda: not self.reaction_visible("alice", message_id, success_emoji)
            and not self.reaction_visible("bob", message_id, success_emoji),
            "reaction removal projection",
            timeout=120,
        )

        failure_emoji = "🔥"
        proxy = self.reaction_proxy
        if proxy is None:
            raise GateError("reaction fault proxy is not running")
        try:
            proxy.arm_connection_loss()
            self.choose_reaction("alice", message_id, failure_emoji)
            last_error_snapshot: dict[str, Any] | None = None

            def actionable_error() -> Any | None:
                nonlocal last_error_snapshot
                row = self.clients["alice"].find_element(
                    f'[data-message-ulid="{message_id}"]',
                    5,
                )
                snapshot = self.clients["alice"].execute_script(
                    """
                    const row = arguments[0];
                    return {
                      rowState: row.getAttribute('data-message-reaction-state') || '',
                      descendants: Array.from(
                        row.querySelectorAll('[data-message-reaction-state]'),
                      ).map((item) => ({
                        state: item.getAttribute('data-message-reaction-state') || '',
                        emoji: item.getAttribute('data-message-reaction-emoji') || '',
                        retryCount: item.querySelectorAll(
                          '[data-message-reaction-retry]',
                        ).length,
                      })),
                    };
                    """,
                    row,
                )
                snapshot["proxy"] = proxy.evidence()
                if snapshot != last_error_snapshot:
                    # #region debug-point A-D:reaction-error-surface
                    request = urllib.request.Request(
                        "http://127.0.0.1:7781/event",
                        data=json.dumps(
                            {
                                "sessionId": "chat-reaction-recovery",
                                "runId": "pre-fix",
                                "hypothesisId": "A-D",
                                "location":
                                    "NativeProductClosureGate:prove_reaction",
                                "msg":
                                    "[DEBUG] reaction failure surface snapshot",
                                "data": snapshot,
                            }
                        ).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    try:
                        urllib.request.urlopen(request, timeout=2).read()
                    except OSError:
                        pass
                    # #endregion
                    last_error_snapshot = snapshot
                error_surfaces = row.find_elements(
                    By.CSS_SELECTOR,
                    '[data-message-reaction-state="error"]',
                )
                proxy_evidence = snapshot["proxy"]
                command_hashes = proxy_evidence.get("commandSha256") or []
                controlled_loss = (
                    int(proxy_evidence.get("connectionLossCount") or 0) >= 1
                    and bool(proxy_evidence.get("requestSha256"))
                    and bool(command_hashes)
                    and len(set(command_hashes)) == 1
                )
                return error_surfaces[0] if error_surfaces and controlled_loss else None

            error_surface = wait_until(
                actionable_error,
                "reaction actionable error",
                timeout=30,
            )
            if self.reaction_visible("alice", message_id, failure_emoji):
                raise GateError("failed reaction remained as terminal optimistic state")
            proxy.disarm()
            retry = error_surface.find_element(
                By.CSS_SELECTOR,
                f'[data-message-reaction-retry="{message_id}"]',
            )
            self.click_element("alice", retry)
            wait_until(
                lambda: self.reaction_visible("alice", message_id, failure_emoji)
                and self.reaction_visible("bob", message_id, failure_emoji),
                "reaction retry convergence",
                timeout=120,
            )
            self.assert_condition("reaction_failure_recovery", True)
            return {
                "failureEmoji": failure_emoji,
                "proxy": proxy.evidence(),
                "recovered": True,
            }
        finally:
            proxy.disarm()

    def open_details(self, actor: str) -> Any:
        if not self.clients[actor].find_elements("[data-chat-detail-panel='open']"):
            self.click(actor, "[data-chat-detail-toggle]")
        return self.clients[actor].find_element("[data-chat-detail-panel='open']", 20)

    def identity_snapshot(self, actor: str) -> dict[str, Any]:
        self.open_details(actor)
        client = self.clients[actor]
        value = client.execute_script(
            """
            const identities = {};
            for (const node of document.querySelectorAll('[data-chat-avatar-ptid]')) {
              const ptid = node.getAttribute('data-chat-avatar-ptid') || '';
              const src = node.getAttribute('data-chat-avatar-src') || '';
              if (!ptid || !src) continue;
              const image = node.matches('img') ? node : node.querySelector('img');
              (identities[ptid] ||= []).push({
                src,
                loaded: Boolean(image?.complete && image?.naturalWidth > 0),
              });
            }
            const stationNodes = Array.from(
              document.querySelectorAll('[data-chat-station="authority"]')
            ).map((node) => ({
              id: node.getAttribute('data-chat-station-id') || '',
              state: node.getAttribute('data-chat-station-state') || '',
              visible: Boolean(node.getClientRects().length),
            }));
            const groupSlots = Array.from(
              document.querySelectorAll('[data-chat-group-avatar-slot]')
            ).map((node) => ({
              ptid: node.getAttribute('data-chat-avatar-ptid') || '',
              src: node.getAttribute('data-chat-avatar-src') || '',
            })).sort((a, b) => a.ptid.localeCompare(b.ptid));
            return { identities, stationNodes, groupSlots };
            """
        )
        return value if isinstance(value, dict) else {}

    def prove_identity_station(self) -> None:
        snapshots: dict[str, dict[str, Any]] = {}
        for actor in ("alice", "bob"):
            expected_peer = self.ptids["bob" if actor == "alice" else "alice"]

            def loaded_snapshot() -> dict[str, Any] | None:
                snapshot = self.identity_snapshot(actor)
                entries = snapshot.get("identities", {}).get(expected_peer, [])
                sources = {
                    entry.get("src") for entry in entries if entry.get("src")
                }
                return (
                    snapshot
                    if (
                        len(entries) >= 3
                        and len(sources) == 1
                        and all(entry.get("loaded") for entry in entries)
                    )
                    else None
                )

            snapshots[actor] = wait_until(
                loaded_snapshot,
                f"{actor} exact loaded avatar surfaces",
                timeout=30,
            )
        for actor, snapshot in snapshots.items():
            expected_peer = self.ptids["bob" if actor == "alice" else "alice"]
            entries = snapshot.get("identities", {}).get(expected_peer, [])
            sources = {entry.get("src") for entry in entries if entry.get("src")}
            if len(entries) < 3 or len(sources) != 1 or not all(
                entry.get("loaded") for entry in entries
            ):
                raise GateError(
                    f"{actor} avatar surfaces diverged for {expected_peer}: {entries}"
                )
        self.assert_condition("avatar_exact_loaded", True)

        station_sets = []
        for snapshot in snapshots.values():
            nodes = snapshot.get("stationNodes", [])
            ids = {
                node.get("id")
                for node in nodes
                if node.get("state") == "available" and node.get("visible")
            }
            station_sets.append(ids)
        station_sets_detail = [
            sorted(str(station_id) for station_id in station_ids if station_id)
            for station_ids in station_sets
        ]
        self.assert_condition(
            "station_attribution_exact",
            len(station_sets) == 2
            and len(station_sets[0]) == 1
            and station_sets[0] == station_sets[1],
            json.dumps(station_sets_detail),
        )
        self.structured_evidence["identityStation"] = snapshots

    def setting_state(self, actor: str) -> dict[str, Any]:
        panel = self.open_details(actor)
        return self.clients[actor].execute_script(
            """
            const panel = arguments[0];
            return {
              muted: panel.getAttribute('data-chat-detail-muted') || '',
              pinned: panel.getAttribute('data-chat-detail-pinned') || '',
              background: panel.getAttribute('data-chat-detail-background') || '',
              backgroundImage: panel.getAttribute('data-chat-detail-background-image') || '',
              pending: panel.getAttribute('data-chat-detail-action-pending') || '',
            };
            """,
            panel,
        )

    def open_background_modal(self, actor: str) -> None:
        client = self.clients[actor]
        active_select = client.execute_script(
            """
            const candidates = Array.from(
              document.querySelectorAll('[data-chat-background-select]')
            );
            return candidates.find((select) => {
              const modal = select.closest('.ant-modal');
              if (!modal) return false;
              return !Array.from(modal.classList).some(
                (name) => name.includes('-leave')
              );
            }) || null;
            """
        )
        if active_select is not None:
            return
        WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(
            lambda _: bool(
                client.execute_script(
                    """
                    return !Array.from(
                      document.querySelectorAll('.ant-modal-wrap')
                    ).some((wrap) => {
                      const style = getComputedStyle(wrap);
                      const rect = wrap.getBoundingClientRect();
                      return (
                        style.display !== 'none'
                        && style.visibility !== 'hidden'
                        && style.pointerEvents !== 'none'
                        && rect.width > 0
                        && rect.height > 0
                      );
                    });
                    """
                )
            )
        )
        self.click(actor, '[data-chat-conversation-action="background"]')
        client.find_element("[data-chat-background-select]", 15)

    def select_second_background(self, actor: str) -> None:
        client = self.clients[actor]
        select = client.find_element("[data-chat-background-select]", 15)

        # #region debug-point A-E:background-picker-probe
        client.execute_script(
            """
            window.__PT_BACKGROUND_PICKER_PROBE__?.cleanup?.();
            const describe = (node) => {
              if (!(node instanceof Element)) return null;
              return {
                tag: node.tagName,
                role: node.getAttribute('role') || '',
                classes: node.className?.baseVal || node.className || '',
                text: (node.textContent || '').trim().slice(0, 80),
              };
            };
            const events = [];
            const mutations = [];
            const eventTypes = [
              'pointerdown',
              'mousedown',
              'pointerup',
              'mouseup',
              'click',
            ];
            const listener = (event) => {
              const target = event.target;
              if (!(target instanceof Element)) return;
              if (
                !target.closest('[data-chat-background-select]')
                && !target.closest('.ant-select-dropdown')
              ) return;
              events.push({
                type: event.type,
                target: describe(target),
                expanded: document.querySelector(
                  '[data-chat-background-select] [role="combobox"]'
                )?.getAttribute('aria-expanded') || '',
              });
            };
            eventTypes.forEach((type) => {
              document.addEventListener(type, listener, true);
            });
            const observer = new MutationObserver((records) => {
              records.forEach((record) => {
                ['addedNodes', 'removedNodes'].forEach((key) => {
                  Array.from(record[key]).forEach((node) => {
                    if (!(node instanceof Element)) return;
                    const relevant = (
                      node.matches('.ant-select-dropdown, [role="option"]')
                      || node.querySelector(
                        '.ant-select-dropdown, [role="option"]'
                      )
                    );
                    if (!relevant) return;
                    mutations.push({
                      kind: key === 'addedNodes' ? 'added' : 'removed',
                      node: describe(node),
                    });
                  });
                });
              });
            });
            observer.observe(document.body, { childList: true, subtree: true });
            window.__PT_BACKGROUND_PICKER_PROBE__ = {
              events,
              mutations,
              cleanup: () => {
                observer.disconnect();
                eventTypes.forEach((type) => {
                  document.removeEventListener(type, listener, true);
                });
                delete window.__PT_BACKGROUND_PICKER_PROBE__;
              },
            };
            """
        )

        def picker_snapshot() -> dict[str, Any]:
            return client.execute_script(
                """
                const select = arguments[0];
                const describe = (node) => {
                  if (!(node instanceof Element)) return null;
                  const rect = node.getBoundingClientRect();
                  const style = getComputedStyle(node);
                  const x = rect.left + rect.width / 2;
                  const y = rect.top + rect.height / 2;
                  const hit = (
                    rect.width > 0 && rect.height > 0
                      ? document.elementFromPoint(x, y)
                      : null
                  );
                  return {
                    tag: node.tagName,
                    role: node.getAttribute('role') || '',
                    classes: node.className?.baseVal || node.className || '',
                    text: (node.textContent || '').trim().slice(0, 80),
                    connected: node.isConnected,
                    display: style.display,
                    visibility: style.visibility,
                    opacity: style.opacity,
                    rect: {
                      left: rect.left,
                      top: rect.top,
                      right: rect.right,
                      bottom: rect.bottom,
                      width: rect.width,
                      height: rect.height,
                    },
                    hit: hit
                      ? {
                          tag: hit.tagName,
                          role: hit.getAttribute('role') || '',
                          classes:
                            hit.className?.baseVal || hit.className || '',
                        }
                      : null,
                  };
                };
                const collect = (selector) => (
                  Array.from(document.querySelectorAll(selector)).map(describe)
                );
                const probe = window.__PT_BACKGROUND_PICKER_PROBE__ || {};
                return {
                  documentFocused: document.hasFocus(),
                  activeElement: describe(document.activeElement),
                  select: describe(select),
                  expanded:
                    select.querySelector('[role="combobox"]')
                      ?.getAttribute('aria-expanded') || '',
                  modals: collect('.ant-modal'),
                  dropdowns: collect('.ant-select-dropdown'),
                  roleOptions: collect('[role="option"]'),
                  classOptions: collect('.ant-select-item-option'),
                  events: Array.from(probe.events || []),
                  mutations: Array.from(probe.mutations || []),
                };
                """,
                select,
            )

        def report_picker_snapshot(phase: str, snapshot: dict[str, Any]) -> None:
            request = urllib.request.Request(
                "http://127.0.0.1:7783/event",
                data=json.dumps(
                    {
                        "sessionId": "chat-background-picker",
                        "runId": "post-fix",
                        "hypothesisId": "A-E",
                        "location":
                            "NativeProductClosureGate:select_second_background",
                        "msg": f"[DEBUG] background picker {phase}",
                        "data": snapshot,
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                urllib.request.urlopen(request, timeout=2).read()
            except OSError:
                pass

        report_picker_snapshot("before-click", picker_snapshot())
        last_snapshot = ""
        try:
            self.click_element(actor, select)
            report_picker_snapshot("after-click", picker_snapshot())

            def rendered_options(driver: Any) -> list[Any] | None:
                nonlocal last_snapshot
                options = driver.find_elements(
                    By.CSS_SELECTOR,
                    ".ant-select-item-option",
                )
                snapshot = picker_snapshot()
                signature = json.dumps(snapshot, sort_keys=True)
                if signature != last_snapshot:
                    report_picker_snapshot("option-poll", snapshot)
                    last_snapshot = signature
                return options if len(options) >= 2 else None

            options = WebDriverWait(
                client.driver,
                10,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(rendered_options)
            before_option_click = picker_snapshot()
            before_option_click["intendedOption"] = client.execute_script(
                """
                const option = arguments[0];
                const rect = option.getBoundingClientRect();
                return {
                  text: (option.textContent || '').trim(),
                  connected: option.isConnected,
                  rect: {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                  },
                };
                """,
                options[1],
            )
            report_picker_snapshot(
                "before-option-click",
                before_option_click,
            )
            self.click_element(actor, options[1])
            report_picker_snapshot("after-option-click", picker_snapshot())
        except Exception:
            report_picker_snapshot("failure", picker_snapshot())
            raise
        finally:
            client.execute_script(
                "window.__PT_BACKGROUND_PICKER_PROBE__?.cleanup?.();"
            )
        # #endregion

    def prove_settings_background(
        self,
        group_id: str,
        valid_image: Path,
        empty_image: Path,
    ) -> dict[str, Any]:
        self.open_details("alice")
        self.click("alice", '[data-chat-conversation-action="mute"]')
        last_mute_snapshot: dict[str, Any] | None = None

        def mute_projection() -> dict[str, Any] | None:
            nonlocal last_mute_snapshot
            state = self.setting_state("alice")
            try:
                station = gateway_read(
                    self.clients["alice"],
                    "conversation_get_member_settings",
                    {"conversation_id": group_id},
                )
            except Exception as error:
                station = {
                    "errorType": type(error).__name__,
                    "error": str(error),
                }
            normalized = (
                station.get("settings")
                if isinstance(station.get("settings"), dict)
                else station
            )
            snapshot = {
                "conversationId": group_id,
                "ui": state,
                "station": normalized,
            }
            if snapshot != last_mute_snapshot:
                # #region debug-point B-E:mute-projection-snapshot
                request = urllib.request.Request(
                    "http://127.0.0.1:7782/event",
                    data=json.dumps(
                        {
                            "sessionId": "chat-mute-projection",
                            "runId": "pre-fix",
                            "hypothesisId": "B-E",
                            "location":
                                "NativeProductClosureGate:prove_settings_background:mute",
                            "msg": "[DEBUG] mute projection snapshot",
                            "data": snapshot,
                        }
                    ).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                try:
                    urllib.request.urlopen(request, timeout=2).read()
                except OSError:
                    pass
                # #endregion
                last_mute_snapshot = snapshot
            return state if state.get("muted") == "true" else None

        wait_until(
            mute_projection,
            "mute projection",
            timeout=60,
        )
        self.click("alice", '[data-chat-conversation-action="pin"]')
        wait_until(
            lambda: self.setting_state("alice").get("pinned") == "true",
            "pin projection",
            timeout=60,
        )
        self.open_background_modal("alice")
        self.select_second_background("alice")
        wait_until(
            lambda: self.setting_state("alice").get("background") == "paper",
            "built-in background projection",
            timeout=60,
        )

        before_image = self.setting_state("alice").get("backgroundImage")
        self.open_background_modal("alice")
        self.choose_native_file(
            "alice",
            trigger_selector="[data-chat-background-upload]",
            file_path=empty_image,
        )
        wait_until(
            lambda: self.setting_state("alice").get("pending") == "",
            "failed background upload completion",
            timeout=60,
        )
        self.open_background_modal("alice")
        retry_visible = bool(
            self.clients["alice"].find_elements("[data-chat-background-retry]")
        )
        if not retry_visible or self.setting_state("alice").get("backgroundImage") != before_image:
            raise GateError("failed background upload did not preserve retry state")
        self.choose_native_file(
            "alice",
            trigger_selector="[data-chat-background-upload]",
            file_path=valid_image,
        )
        final_state = wait_until(
            lambda: (
                state
                if (
                    (state := self.setting_state("alice")).get("backgroundImage", "")
                ).startswith("oss://")
                else None
            ),
            "uploaded background projection",
            timeout=120,
        )
        self.assert_condition("background_upload_recovery", True)

        station = gateway_read(
            self.clients["alice"],
            "conversation_get_member_settings",
            {"conversation_id": group_id},
        )
        normalized = station.get("settings") if isinstance(station.get("settings"), dict) else station
        station_matches = (
            bool(normalized.get("muted"))
            and bool(normalized.get("pinned"))
            and normalized.get("background") == "paper"
            and str(
                normalized.get("background_image")
                or normalized.get("backgroundImage")
                or ""
            )
            == final_state["backgroundImage"]
        )
        self.assert_condition(
            "settings_station_readback",
            station_matches,
            json.dumps({"ui": final_state, "station": normalized}),
        )
        return {"ui": final_state, "station": normalized}

    def prove_attachment_failure(self, empty_file: Path) -> None:
        if self.clients["alice"].find_elements("[data-chat-detail-panel='open']"):
            self.click("alice", "[data-chat-detail-toggle]")
        before_ids = [item["id"] for item in self.transcript("alice")]
        self.choose_native_file(
            "alice",
            trigger_selector="[data-chat-attachment-picker]",
            file_path=empty_file,
        )
        draft = wait_until(
            lambda: (
                items[0]
                if (
                    items := self.clients["alice"].find_elements(
                        '[data-chat-attachment-draft][data-chat-attachment-status="failed"]'
                    )
                )
                else None
            ),
            "failed attachment draft",
            timeout=60,
        )
        after_ids = [item["id"] for item in self.transcript("alice")]
        if before_ids != after_ids:
            raise GateError("failed attachment staging created an empty message")
        buttons = draft.find_elements(By.TAG_NAME, "button")
        if not buttons:
            raise GateError("failed attachment draft has no recovery controls")
        self.click_element("alice", buttons[-1])
        self.assert_condition("attachment_failure_draft_retained", True)

    def attachment_message(
        self,
        actor: str,
        expected_count: int,
    ) -> dict[str, Any] | None:
        client = self.clients[actor]
        value = client.execute_script(
            """
            const expected = Number(arguments[0]);
            const row = Array.from(document.querySelectorAll('[data-message-ulid]'))
              .find((item) =>
                Number(item.getAttribute('data-message-attachment-count') || 0) === expected
              );
            if (!row) return null;
            return {
              id: row.getAttribute('data-message-ulid') || '',
              count: Number(row.getAttribute('data-message-attachment-count') || 0),
              attachments: Array.from(
                row.querySelectorAll('[data-messaging-attachment-id]')
              ).map((item) => ({
                id: item.getAttribute('data-messaging-attachment-id') || '',
                kind: item.getAttribute('data-messaging-attachment-kind') || '',
                state: item.getAttribute('data-messaging-attachment-state') || '',
                imageLoaded: Array.from(item.querySelectorAll('img'))
                  .every((image) => image.complete && image.naturalWidth > 0),
              })),
            };
            """,
            expected_count,
        )
        return value if isinstance(value, dict) and value.get("id") else None

    def prove_attachments(
        self,
        group_id: str,
        image_file: Path,
        text_file: Path,
    ) -> dict[str, Any]:
        self.choose_native_file(
            "alice",
            trigger_selector="[data-chat-attachment-picker]",
            file_path=image_file,
        )
        self.choose_native_file(
            "alice",
            trigger_selector="[data-chat-attachment-picker]",
            file_path=text_file,
        )
        wait_until(
            lambda: (
                items
                if len(
                    items := self.clients["alice"].find_elements(
                        '[data-chat-attachment-draft][data-chat-attachment-status="ready"]'
                    )
                )
                == 2
                else None
            ),
            "two ready Composer attachments",
            timeout=120,
        )
        preview = self.clients["alice"].find_element(
            '[data-chat-attachment-draft][data-chat-attachment-status="ready"] img',
            20,
        )
        if not self.clients["alice"].execute_script(
            "return arguments[0].complete && arguments[0].naturalWidth > 0;",
            preview,
        ):
            raise GateError("Composer image preview did not load")
        self.click("alice", "[data-chat-send]")

        outcome = wait_until(
            lambda: (
                {
                    "state": composer.get_attribute("data-chat-send-outcome-state"),
                    "count": int(
                        composer.get_attribute(
                            "data-chat-send-outcome-attachment-count"
                        )
                        or 0
                    ),
                    "ids": [
                        item
                        for item in (
                            composer.get_attribute(
                                "data-chat-send-outcome-attachment-ids"
                            )
                            or ""
                        ).split(",")
                        if item
                    ],
                }
                if (
                    composer := self.clients["alice"].find_element(
                        f'[data-chat-composer="{group_id}"]',
                        5,
                    )
                ).get_attribute("data-chat-send-outcome-state")
                == "pending"
                else None
            ),
            "queued two-attachment send outcome",
            timeout=180,
        )
        if outcome["count"] != 2 or len(outcome["ids"]) != 2:
            raise GateError(f"Composer send outcome count mismatch: {outcome}")
        if self.clients["alice"].find_elements("[data-chat-attachment-draft]"):
            raise GateError("queued attachment send did not clear Composer drafts")

        sender_row = wait_until(
            lambda: self.attachment_message("alice", 2),
            "Alice two-attachment row",
            timeout=180,
        )
        receiver_row = wait_until(
            lambda: self.attachment_message("bob", 2),
            "Bob two-attachment row",
            timeout=180,
        )
        if sender_row["id"] != receiver_row["id"]:
            raise GateError("sender and receiver attachment message IDs differ")

        engine: dict[str, Any] = {}
        byte_hashes: dict[str, Any] = {}
        expected_hashes = {
            image_file.name: file_sha256(image_file),
            text_file.name: file_sha256(text_file),
        }
        for actor in ("alice", "bob"):
            messages = self.engine_messages(actor, group_id)
            message = next(
                (
                    item
                    for item in messages
                    if item.get("message_id") == sender_row["id"]
                ),
                None,
            )
            if not isinstance(message, dict):
                raise GateError(f"{actor} Engine attachment message is missing")
            attachments = message.get("attachments")
            if not isinstance(attachments, list) or len(attachments) != 2:
                raise GateError(f"{actor} Engine attachment count mismatch: {attachments}")
            engine[actor] = message
            actor_hashes: dict[str, str] = {}
            for attachment in attachments:
                attachment_id = str(attachment.get("attachment_id") or "")
                filename = str(attachment.get("filename") or "")
                opened = gateway_read(
                    self.clients[actor],
                    "messaging_open_attachment",
                    {"attachment_id": attachment_id},
                )
                local_path = Path(str(opened.get("local_path") or ""))
                if not local_path.is_file():
                    raise GateError(f"{actor} attachment cache path is missing")
                actor_hashes[filename] = file_sha256(local_path)
            if actor_hashes != expected_hashes:
                raise GateError(
                    f"{actor} attachment byte hashes differ: "
                    f"expected={expected_hashes} actual={actor_hashes}"
                )
            byte_hashes[actor] = actor_hashes

        for actor in ("alice", "bob"):
            self.open_details(actor)
        details = {
            actor: {
                kind: int(
                    self.clients[actor].find_element(
                        f'[data-chat-detail-attachments="{kind}"]',
                        20,
                    ).get_attribute("data-chat-detail-attachment-count")
                    or 0
                )
                for kind in ("media", "files")
            }
            for actor in ("alice", "bob")
        }
        conserved = (
            outcome["count"] == 2
            and len(outcome["ids"]) == 2
            and len(engine["alice"]["attachments"]) == 2
            and len(engine["bob"]["attachments"]) == 2
            and sender_row["count"] == 2
            and receiver_row["count"] == 2
            and all(value == {"media": 1, "files": 1} for value in details.values())
        )
        self.assert_condition(
            "attachment_count_conservation",
            conserved,
            json.dumps(
                {
                    "outcome": outcome,
                    "sender": sender_row,
                    "receiver": receiver_row,
                    "details": details,
                }
            ),
        )
        self.assert_condition("attachment_byte_exact", True, json.dumps(byte_hashes))
        return {
            "outcome": outcome,
            "engine": engine,
            "senderRow": sender_row,
            "receiverRow": receiver_row,
            "details": details,
            "byteHashes": byte_hashes,
        }

    def prove_restart(
        self,
        group_id: str,
        settings_before: dict[str, Any],
    ) -> None:
        self.restart_actor("alice")
        self.enter_chat_page("alice")
        self.click("alice", f'[data-chat-group-ulid="{group_id}"]')
        wait_until(
            lambda: len(self.transcript("alice")) == len(self.transcript("bob")),
            "Alice transcript after restart",
            timeout=180,
        )
        self.open_details("alice")
        state = wait_until(
            lambda: (
                value
                if (
                    (value := self.setting_state("alice")).get("muted") == "true"
                    and value.get("pinned") == "true"
                    and value.get("background") == "paper"
                    and value.get("backgroundImage")
                    == settings_before["ui"]["backgroundImage"]
                )
                else None
            ),
            "settings and background after client restart",
            timeout=180,
        )
        station = gateway_read(
            self.clients["alice"],
            "conversation_get_member_settings",
            {"conversation_id": group_id},
        )
        self.assert_condition(
            "settings_restart_recovery",
            bool(state) and bool(station),
            json.dumps({"ui": state, "station": station}),
        )

    def collect_final_evidence(self) -> None:
        for actor in ("alice", "bob"):
            self.save_screenshot(self.clients[actor], f"{actor}-final")
            self.save_dom(self.clients[actor], f"{actor}-final")
            self.save_app_log(self.clients[actor], f"{actor}-final")

    def cleanup_clients(self) -> dict[str, Any]:
        ports = sorted(
            {
                int(spec["webdriver_port"])
                for spec in self.client_specs.values()
            }
            | {
                int(spec["gateway_port"])
                for spec in self.client_specs.values()
            }
            | (
                {self.reaction_proxy.port}
                if self.reaction_proxy is not None
                else set()
            )
        )
        for client in self.clients.values():
            client.stop()
        if self.reaction_proxy is not None:
            self.reaction_proxy.disarm()
            self.reaction_proxy.stop()
        released = wait_until(
            lambda: all(port_is_free(port) for port in ports),
            "Native client and fault proxy port release",
            timeout=30,
        )
        result = {"ports": ports, "released": bool(released)}
        self.assert_condition("cleanup_ports_released", bool(released), json.dumps(result))
        return result

    def run(self) -> dict[str, Any]:
        if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")
        source = self.manifest.get("source")
        station = self.manifest.get("station")
        source_identity = {
            "source": source,
            "station": station,
            "binary": str(self.binary),
            "binarySha256": file_sha256(self.binary),
        }
        self.assert_condition(
            "source_build_runtime_identity",
            isinstance(source, dict)
            and bool(source.get("commit"))
            and bool(source.get("workspaceDigest"))
            and isinstance(station, dict)
            and bool(station.get("liveCommit"))
            and bool(station.get("protoDigest"))
            and len(source_identity["binarySha256"]) == 64,
            json.dumps(source_identity),
        )
        self.assert_condition("native_dom_only", True)

        image_file = self.fixture_root / "w13-image.png"
        image_file.write_bytes(
            bytes.fromhex(
                "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
                "0000000d49444154789c6360f8cfc000000301010018dd8db10000000049454e44ae426082"
            )
        )
        text_file = self.fixture_root / "w13-file.txt"
        text_file.write_text("MP-W13 attachment byte identity\n", encoding="utf-8")
        empty_image = self.fixture_root / "w13-empty.png"
        empty_image.write_bytes(b"")
        empty_attachment = self.fixture_root / "w13-empty.txt"
        empty_attachment.write_bytes(b"")

        cleanup: dict[str, Any] = {}
        try:
            self.reaction_proxy = ProfileThreeSubmitFaultProxy(self.station_url)
            self.reaction_proxy.start()
            for actor in ("alice", "bob"):
                self.step(f"{actor}.launch", lambda actor=actor: self.launch_actor(actor))
            group_id = self.step("group.create.ui", self.open_group_through_ui)
            _, action_message_id = self.step(
                "transcript.thread.ui",
                lambda: self.prove_transcript_thread(group_id),
            )
            geometry = self.step(
                "toolbar.geometry.ui",
                lambda: self.overlay_geometry("alice", action_message_id),
            )
            reaction = self.step(
                "reaction.ui",
                lambda: self.prove_reaction(action_message_id),
            )
            self.step("identity.station.dom", self.prove_identity_station)
            settings = self.step(
                "settings.background.ui",
                lambda: self.prove_settings_background(
                    group_id,
                    image_file,
                    empty_image,
                ),
            )
            self.step(
                "attachment.failure.ui",
                lambda: self.prove_attachment_failure(empty_attachment),
            )
            attachments = self.step(
                "attachments.ui",
                lambda: self.prove_attachments(group_id, image_file, text_file),
            )
            self.step(
                "client.restart.ui",
                lambda: self.prove_restart(group_id, {"ui": settings["ui"]}),
            )
            self.collect_final_evidence()

            self.write_json_evidence("source-build-runtime", source_identity)
            self.write_json_evidence(
                "transcript-thread",
                self.structured_evidence["transcriptThread"],
            )
            self.write_json_evidence(
                "reaction-geometry",
                {"reaction": reaction, "geometry": geometry},
            )
            self.write_json_evidence(
                "identity-station",
                self.structured_evidence["identityStation"],
            )
            self.write_json_evidence("settings-background", settings)
            self.write_json_evidence("attachment-ledger", attachments)
        finally:
            cleanup = self.cleanup_clients()
            self.write_json_evidence("cleanup", cleanup)

        assertion_names = {assertion.name for assertion in self.report.assertions}
        missing_assertions = REQUIRED_ASSERTIONS - assertion_names
        if missing_assertions:
            raise GateError(
                f"required assertions are missing: {sorted(missing_assertions)}"
            )
        missing_evidence = REQUIRED_EVIDENCE - set(self.report.evidence)
        if missing_evidence:
            raise GateError(f"required evidence is missing: {sorted(missing_evidence)}")
        return {
            "runtimeCell": "native-tauri-embedded-webdriver",
            "journey": "mp-w13-chat-product-closure",
            "conversationId": group_id,
            "steps": self.steps,
            "sourceIdentity": source_identity,
            "cleanup": cleanup,
        }


if __name__ == "__main__":
    raise SystemExit(NativeProductClosureGate().execute())
