#!/usr/bin/env python3
"""Prove the MP-W13 Chat product closure through real Native DOM actions."""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
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
from tooling.acceptance.gates.chat.native_support import commits_match, wait_until


GATE_ID = "chat-native-product-closure-e2e"
CLIENT_ACTOR_ROLES = {
    "alice": "alice",
    "bob": "bob",
    "alice2": "alice",
}
RECOVERY_SELECTORS = {
    "settings_nav": '[data-pt-primary-nav="settings"]',
    "security_section": '[data-pt-section-item="security"]',
    "generate": "[data-recovery-generate]",
    "reveal": "[data-recovery-reveal]",
    "backup": "[data-recovery-backup-create]",
    "restore_open": "[data-recovery-restore-open]",
    "restore_input": "[data-recovery-restore-input]",
    "restore_submit": "[data-recovery-restore-submit]",
}
NATIVE_INPUT_ACK_POLL_SECONDS = 0.01
NATIVE_FILE_TRANSITION_TIMEOUT_SECONDS = 30
NATIVE_FILE_PANEL_FOCUSED_ROLES = frozenset({"AXList", "AXTextField"})
NATIVE_ACCESSIBILITY_PROBE = r"""
import ctypes
import json
import sys

import AppKit

process_id = int(sys.argv[1])
application_services = ctypes.CDLL(
    "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
)
core_foundation = ctypes.CDLL(
    "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
)
CFRef = ctypes.c_void_p
CFIndex = ctypes.c_long
CFTypeID = ctypes.c_ulong
UTF8 = 0x08000100

application_services.AXUIElementCreateApplication.argtypes = [ctypes.c_int32]
application_services.AXUIElementCreateApplication.restype = CFRef
application_services.AXUIElementCopyAttributeValue.argtypes = [
    CFRef,
    CFRef,
    ctypes.POINTER(CFRef),
]
application_services.AXUIElementCopyAttributeValue.restype = ctypes.c_int32
application_services.AXUIElementSetMessagingTimeout.argtypes = [
    CFRef,
    ctypes.c_float,
]
application_services.AXUIElementSetMessagingTimeout.restype = ctypes.c_int32
core_foundation.CFStringCreateWithCString.argtypes = [
    CFRef,
    ctypes.c_char_p,
    ctypes.c_uint32,
]
core_foundation.CFStringCreateWithCString.restype = CFRef
core_foundation.CFStringGetTypeID.restype = CFTypeID
core_foundation.CFBooleanGetTypeID.restype = CFTypeID
core_foundation.CFArrayGetTypeID.restype = CFTypeID
core_foundation.CFGetTypeID.argtypes = [CFRef]
core_foundation.CFGetTypeID.restype = CFTypeID
core_foundation.CFStringGetLength.argtypes = [CFRef]
core_foundation.CFStringGetLength.restype = CFIndex
core_foundation.CFStringGetMaximumSizeForEncoding.argtypes = [
    CFIndex,
    ctypes.c_uint32,
]
core_foundation.CFStringGetMaximumSizeForEncoding.restype = CFIndex
core_foundation.CFStringGetCString.argtypes = [
    CFRef,
    ctypes.c_char_p,
    CFIndex,
    ctypes.c_uint32,
]
core_foundation.CFStringGetCString.restype = ctypes.c_bool
core_foundation.CFBooleanGetValue.argtypes = [CFRef]
core_foundation.CFBooleanGetValue.restype = ctypes.c_bool
core_foundation.CFArrayGetCount.argtypes = [CFRef]
core_foundation.CFArrayGetCount.restype = CFIndex
core_foundation.CFArrayGetValueAtIndex.argtypes = [CFRef, CFIndex]
core_foundation.CFArrayGetValueAtIndex.restype = CFRef
core_foundation.CFRelease.argtypes = [CFRef]


def create_attribute(name):
    return core_foundation.CFStringCreateWithCString(
        None,
        name.encode("utf-8"),
        UTF8,
    )


def copy_attribute(element, name):
    key = create_attribute(name)
    value = CFRef()
    try:
        error = application_services.AXUIElementCopyAttributeValue(
            element,
            key,
            ctypes.byref(value),
        )
    finally:
        core_foundation.CFRelease(key)
    return value if error == 0 else None


def decode_text(value):
    if (
        not value
        or core_foundation.CFGetTypeID(value)
        != core_foundation.CFStringGetTypeID()
    ):
        return ""
    size = (
        core_foundation.CFStringGetMaximumSizeForEncoding(
            core_foundation.CFStringGetLength(value),
            UTF8,
        )
        + 1
    )
    buffer = ctypes.create_string_buffer(size)
    if not core_foundation.CFStringGetCString(value, buffer, size, UTF8):
        return ""
    return buffer.value.decode("utf-8")


def decode_boolean(value):
    return bool(
        value
        and core_foundation.CFGetTypeID(value)
        == core_foundation.CFBooleanGetTypeID()
        and core_foundation.CFBooleanGetValue(value)
    )


def array_items(value):
    if (
        not value
        or core_foundation.CFGetTypeID(value)
        != core_foundation.CFArrayGetTypeID()
    ):
        return []
    return [
        core_foundation.CFArrayGetValueAtIndex(value, index)
        for index in range(core_foundation.CFArrayGetCount(value))
    ]


def copied_text(element, name):
    value = copy_attribute(element, name)
    try:
        return decode_text(value)
    finally:
        if value:
            core_foundation.CFRelease(value)


def copied_boolean(element, name):
    value = copy_attribute(element, name)
    try:
        return decode_boolean(value)
    finally:
        if value:
            core_foundation.CFRelease(value)


application = application_services.AXUIElementCreateApplication(process_id)
application_services.AXUIElementSetMessagingTimeout(application, 0.5)
focused = copy_attribute(application, "AXFocusedUIElement")
windows_value = copy_attribute(application, "AXWindows")
windows = array_items(windows_value)
sheet_count = 0
for window in windows:
    sheets_value = copy_attribute(window, "AXSheets")
    try:
        sheet_count += len(array_items(sheets_value))
    finally:
        if sheets_value:
            core_foundation.CFRelease(sheets_value)
front_window = windows[0] if windows else None
frontmost_app = AppKit.NSWorkspace.sharedWorkspace().frontmostApplication()
result = {
    "role": copied_text(focused, "AXRole") if focused else "",
    "subrole": copied_text(focused, "AXSubrole") if focused else "",
    "title": copied_text(focused, "AXTitle") if focused else "",
    "value": copied_text(focused, "AXValue") if focused else "",
    "windowCount": len(windows),
    "sheetCount": sheet_count,
    "frontmost": copied_boolean(application, "AXFrontmost"),
    "mainWindow": (
        copied_boolean(front_window, "AXMain") if front_window else False
    ),
    "focusedWindow": (
        copied_boolean(front_window, "AXFocused") if front_window else False
    ),
    "actualFrontmostPid": (
        int(frontmost_app.processIdentifier()) if frontmost_app else -1
    ),
}
sys.stdout.write(json.dumps(result))
if windows_value:
    core_foundation.CFRelease(windows_value)
if focused:
    core_foundation.CFRelease(focused)
core_foundation.CFRelease(application)
"""
READBACK_COMMANDS = {
    "conversation_get_member_settings",
    "messaging_list_conversations",
    "messaging_list_messages",
    "messaging_open_attachment",
}
REQUIRED_ASSERTIONS = {
    "native_dom_only",
    "source_build_runtime_identity",
    "transcript_exact",
    "thread_exact",
    "toolbar_geometry",
    "toolbar_keyboard_reachable",
    "reaction_picker_success",
    "reaction_authority_readback",
    "reaction_failure_recovery",
    "avatar_exact_loaded",
    "group_avatar_slots_exact",
    "station_attribution_exact",
    "settings_station_readback",
    "settings_restart_recovery",
    "background_upload_recovery",
    "background_rendered",
    "background_second_device_recovery",
    "clear_cursor_station_readback",
    "offline_recovery_exact",
    "restart_exact",
    "attachment_failure_draft_retained",
    "attachment_images_loaded",
    "attachment_count_conservation",
    "attachment_byte_exact",
    "runtime_logs_clean",
    "cleanup_ports_released",
    "cleanup_processes_released",
    "cleanup_storage_released",
}
REQUIRED_EVIDENCE = {
    "alice-final-screenshot",
    "alice-final-dom",
    "bob-final-screenshot",
    "bob-final-dom",
    "alice2-final-screenshot",
    "alice2-final-dom",
    "source-build-runtime",
    "transcript-thread",
    "reaction-geometry",
    "identity-station",
    "settings-background",
    "attachment-ledger",
    "recovery-ledger",
    "runtime-launch-ledger",
    "runtime-log-audit",
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


def pid_is_stopped(pid: int) -> bool:
    if pid <= 0:
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    return False


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
        if set(self.client_specs) != set(CLIENT_ACTOR_ROLES):
            raise GateError(
                "runtime manifest must allocate isolated Alice, Bob, and Alice2 clients"
            )
        if set(self.actor_specs) != {"alice", "bob"}:
            raise GateError("actor manifest must contain canonical Alice and Bob identities")
        self.clients: dict[str, TauriDriver] = {}
        self.runtime_instances: list[TauriDriver] = []
        self.runtime_pids: set[int] = set()
        self.runtime_launches: list[dict[str, Any]] = []
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

    def wait_for_realtime_device(
        self,
        client: TauriDriver,
        expected_ptid: str,
    ) -> dict[str, Any]:
        def restored_device() -> dict[str, Any] | None:
            device = call_async_harness(
                client,
                "getRealtimeDevice",
                {},
                namespace="chat",
                script_timeout=10,
            )
            return (
                device
                if str((device or {}).get("actorId") or "") == expected_ptid
                and str((device or {}).get("deviceId") or "")
                else None
            )

        return wait_until(
            restored_device,
            f"restored identity {expected_ptid}",
            timeout=60,
        )

    def launch_actor(
        self,
        actor: str,
        *,
        restore_session: bool = False,
        wait_for_device: bool = True,
    ) -> None:
        spec = self.client_specs[actor]
        actor_role = CLIENT_ACTOR_ROLES[actor]
        window_actors = tuple(CLIENT_ACTOR_ROLES)
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
        attempt = {
            "sequence": len(self.runtime_launches) + 1,
            "clientRole": actor,
            "actorRole": actor_role,
            "ptid": "",
            "deviceId": "",
            "pid": None,
            "webdriverPort": client.port,
            "gatewayPort": client.gateway_port,
            "rendererPort": int(spec["renderer_port"]),
            "profile": client.profile,
            "storageRoot": client.storage_root,
            "logPath": "",
            "initializationStatus": "starting",
            "cleanupStatus": "pending",
        }
        self.runtime_instances.append(client)
        self.runtime_launches.append(attempt)
        try:
            client.start()
            attempt["pid"] = client.process_id
            attempt["logPath"] = str(client.log_path or "")
            if client.process_id:
                self.runtime_pids.add(int(client.process_id))
            self.register_driver(client)
            client.wait_for_acceptance_harness(30)
            expected_ptid = str(self.actor_specs[actor_role].get("ptid") or "")
            if not restore_session:
                self.configure_station(client, actor_station_url)
                with StationDriver(
                    f"http://127.0.0.1:{client.gateway_port}"
                ) as station:
                    station.auth_logout()
                account_ref = str(
                    self.actor_specs[actor_role].get("accountRef") or ""
                )
                account = account_ref.removeprefix("station-account:")
                login = call_async_harness(
                    client,
                    "loginWithPassword",
                    {"account": account, "password": public_fixture_password()},
                    namespace="chat",
                    script_timeout=30,
                )
                ptid = str((login or {}).get("actorId") or "")
                if not (login or {}).get("authenticated") or ptid != expected_ptid:
                    raise GateError(
                        f"{actor} login identity mismatch: "
                        f"expected={expected_ptid} actual={ptid}"
                    )
            ptid = expected_ptid
            device_id = ""
            if wait_for_device:
                device = self.wait_for_realtime_device(client, expected_ptid)
                ptid = str(device.get("actorId") or "")
                device_id = str((device or {}).get("deviceId") or "")
                if not device_id:
                    raise GateError(f"{actor} messaging device identity is missing")
            self.clients[actor] = client
            self.ptids[actor] = ptid
            if device_id:
                self.device_ids[actor] = device_id
            attempt["ptid"] = ptid
            attempt["deviceId"] = device_id
            attempt["initializationStatus"] = "ready"
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
        except Exception as error:
            attempt["pid"] = attempt["pid"] or client.process_id
            attempt["logPath"] = str(client.log_path or "")
            attempt["initializationStatus"] = "failed"
            attempt["failureType"] = type(error).__name__
            if client.process_id:
                self.runtime_pids.add(int(client.process_id))
            client.stop()
            raise

    def restart_actor(self, actor: str) -> None:
        previous_device = self.device_ids[actor]
        self.clients[actor].stop()
        self.launch_actor(actor, restore_session=True)
        if self.device_ids[actor] != previous_device:
            raise GateError(f"{actor} device identity changed across restart")

    def bind_recovered_device(self, actor: str) -> str:
        device = self.wait_for_realtime_device(
            self.clients[actor],
            self.ptids[actor],
        )
        device_id = str(device.get("deviceId") or "")
        if not device_id:
            raise GateError(f"{actor} recovered messaging device identity is missing")
        self.device_ids[actor] = device_id
        for launch in reversed(self.runtime_launches):
            if launch.get("clientRole") == actor:
                launch["deviceId"] = device_id
                break
        return device_id

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
        core_graphics.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
        core_foundation.CFRelease.argtypes = [ctypes.c_void_p]

        native_point = CGPoint(*point)
        for event_type in event_types:
            event = core_graphics.CGEventCreateMouseEvent(
                None,
                event_type,
                native_point,
                0,
            )
            if not event:
                raise GateError("CoreGraphics failed to create Native mouse event")
            core_graphics.CGEventPost(0, event)
            core_foundation.CFRelease(event)

    def post_key(
        self,
        key_code: int,
        *,
        flags: int = 0,
        text: str = "",
        private_source: bool = False,
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
        core_graphics.CGEventSourceCreate.argtypes = [ctypes.c_int32]
        core_graphics.CGEventSourceCreate.restype = ctypes.c_void_p
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
        source = core_graphics.CGEventSourceCreate(-1) if private_source else None
        try:
            if private_source and not source:
                raise GateError("CoreGraphics failed to create Native private event source")
            for pressed in (True, False):
                event = core_graphics.CGEventCreateKeyboardEvent(
                    source,
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
        finally:
            if source:
                core_foundation.CFRelease(source)

    def post_key_chord(
        self,
        key_code: int,
        modifiers: tuple[tuple[int, int], ...],
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
        core_graphics.CGEventSourceCreate.argtypes = [ctypes.c_int32]
        core_graphics.CGEventSourceCreate.restype = ctypes.c_void_p
        core_graphics.CGEventSetFlags.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint64,
        ]
        core_graphics.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
        core_foundation.CFRelease.argtypes = [ctypes.c_void_p]

        source = core_graphics.CGEventSourceCreate(-1)
        if not source:
            raise GateError("CoreGraphics failed to create Native private event source")

        active_flags = 0

        def post(key: int, pressed: bool, flags: int) -> None:
            event = core_graphics.CGEventCreateKeyboardEvent(source, key, pressed)
            if not event:
                raise GateError("CoreGraphics failed to create Native keyboard event")
            try:
                core_graphics.CGEventSetFlags(event, flags)
                core_graphics.CGEventPost(0, event)
            finally:
                core_foundation.CFRelease(event)

        try:
            for modifier_key, modifier_flag in modifiers:
                active_flags |= modifier_flag
                post(modifier_key, True, active_flags)
            post(key_code, True, active_flags)
            post(key_code, False, active_flags)
            for modifier_key, modifier_flag in reversed(modifiers):
                active_flags &= ~modifier_flag
                post(modifier_key, False, active_flags)
        finally:
            core_foundation.CFRelease(source)

    def invoke_native_activation_command(
        self,
        client: TauriDriver,
        command: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        request_id = secrets.token_hex(8)
        client.driver.execute_script(
            """
            const command = arguments[0];
            const commandArguments = arguments[1];
            const requestId = arguments[2];
            const requests = window.__PT_NATIVE_ACTIVATION_REQUESTS__ ||= {};
            requests[requestId] = { done: false };
            window.__TAURI_INTERNALS__.invoke(
              command,
              commandArguments,
            ).then((result) => {
              requests[requestId] = { done: true, result };
            }).catch((error) => {
              requests[requestId] = {
                done: true,
                result: {
                  ok: false,
                  error: { message: String(error) },
                },
              };
            });
            """,
            command,
            arguments,
            request_id,
        )
        try:
            result = WebDriverWait(
                client.driver,
                5,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(
                lambda driver: driver.execute_script(
                    """
                    const request = window.__PT_NATIVE_ACTIVATION_REQUESTS__
                      ?.[arguments[0]];
                    return request?.done ? request.result : null;
                    """,
                    request_id,
                )
            )
        finally:
            client.driver.execute_script(
                """
                if (window.__PT_NATIVE_ACTIVATION_REQUESTS__) {
                  delete window.__PT_NATIVE_ACTIVATION_REQUESTS__[arguments[0]];
                }
                """,
                request_id,
            )
        if not isinstance(result, dict) or not result.get("ok"):
            raise GateError(
                f"Native actor {command} failed: "
                f"{json.dumps(result, sort_keys=True, default=str)}"
            )
        return result

    def request_cooperative_activation(self, target: TauriDriver) -> bool:
        if target.process_id is None:
            raise GateError("Native activation target process is unavailable")
        source = next(
            (
                client
                for client in self.clients.values()
                if client.process_id not in (None, target.process_id)
                and bool(
                    client.driver.execute_script(
                        "return document.hasFocus()"
                    )
                )
            ),
            None,
        )
        if source is None or source.process_id is None:
            return False

        self.invoke_native_activation_command(
            source,
            "acceptance_yield_activation",
            {"targetPid": target.process_id},
        )
        self.invoke_native_activation_command(
            target,
            "acceptance_request_activation",
            {},
        )
        return True

    def activate_native_process(self, process_id: int) -> None:
        appkit_script = r"""
import json
import sys

import AppKit

application = AppKit.NSRunningApplication.runningApplicationWithProcessIdentifier_(
    int(sys.argv[1])
)
if application is None:
    raise SystemExit("Native actor process is unavailable")
workspace = AppKit.NSWorkspace.sharedWorkspace()
frontmost_before = workspace.frontmostApplication()
target_active_before = bool(application.isActive())
options = (
    AppKit.NSApplicationActivateAllWindows
    | AppKit.NSApplicationActivateIgnoringOtherApps
)
request_accepted = bool(application.activateWithOptions_(options))
frontmost_after = workspace.frontmostApplication()
sys.stdout.write(
    json.dumps(
        {
            "activationMode": "uncoordinated-fallback",
            "activationPolicy": int(application.activationPolicy()),
            "finishedLaunching": bool(application.isFinishedLaunching()),
            "hidden": bool(application.isHidden()),
            "targetActiveBefore": target_active_before,
            "requestAccepted": request_accepted,
            "targetActiveAfter": bool(application.isActive()),
            "frontmostPidBefore": (
                int(frontmost_before.processIdentifier())
                if frontmost_before is not None
                else -1
            ),
            "frontmostPidAfter": (
                int(frontmost_after.processIdentifier())
                if frontmost_after is not None
                else -1
            ),
        }
    )
)
if not request_accepted:
    raise SystemExit("AppKit rejected Native actor activation")
"""
        appkit_activation = subprocess.run(
            (sys.executable, "-c", appkit_script, str(process_id)),
            capture_output=True,
            text=True,
            check=False,
        )
        if appkit_activation.returncode != 0:
            raise GateError(
                "Native actor AppKit activation failed: "
                f"{appkit_activation.stderr.strip() or appkit_activation.stdout.strip()}"
            )

        script = f"""
        tell application "System Events"
          set targetProcess to first application process whose unix id is {process_id}
          set frontmost of targetProcess to true
          try
            perform action "AXRaise" of front window of targetProcess
          end try
          try
            set value of attribute "AXMain" of front window of targetProcess to true
          end try
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
        try:
            completed = subprocess.run(
                (
                    sys.executable,
                    "-c",
                    NATIVE_ACCESSIBILITY_PROBE,
                    str(process_id),
                ),
                capture_output=True,
                text=True,
                check=False,
                timeout=2,
            )
        except subprocess.TimeoutExpired:
            return {"error": "Native Accessibility probe timed out"}
        if completed.returncode != 0:
            return {"error": completed.stderr.strip()}
        try:
            value = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return {"error": f"unexpected AX response: {completed.stdout!r}"}
        return value if isinstance(value, dict) else {"error": "invalid AX response"}

    def native_window_stack_at_point(
        self,
        point: tuple[float, float],
    ) -> dict[str, Any]:
        script = r"""
import json
import sys

try:
    import Quartz

    point_x = float(sys.argv[1])
    point_y = float(sys.argv[2])
    windows = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly,
        Quartz.kCGNullWindowID,
    )
    owners = []
    for index, window in enumerate(windows):
        bounds = window.get(Quartz.kCGWindowBounds) or {}
        left = float(bounds.get("X", 0))
        top = float(bounds.get("Y", 0))
        width = float(bounds.get("Width", 0))
        height = float(bounds.get("Height", 0))
        if not (
            left <= point_x < left + width
            and top <= point_y < top + height
        ):
            continue
        owners.append(
            {
                "index": index,
                "ownerPid": int(window.get(Quartz.kCGWindowOwnerPID, 0)),
                "ownerName": str(window.get(Quartz.kCGWindowOwnerName, "")),
                "windowName": str(window.get(Quartz.kCGWindowName, "")),
                "layer": int(window.get(Quartz.kCGWindowLayer, 0)),
                "alpha": float(window.get(Quartz.kCGWindowAlpha, 0)),
                "bounds": {
                    "left": left,
                    "top": top,
                    "width": width,
                    "height": height,
                },
            }
        )
    print(json.dumps({"windows": owners[:16]}))
except Exception as error:
    print(json.dumps({"error": f"{type(error).__name__}: {error}"}))
"""
        completed = subprocess.run(
            (sys.executable, "-c", script, str(point[0]), str(point[1])),
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            return {
                "error": completed.stderr.strip()
                or f"window stack probe exited {completed.returncode}"
            }
        try:
            value = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return {"error": f"invalid window stack probe: {completed.stdout!r}"}
        return value if isinstance(value, dict) else {"error": "invalid window stack"}

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

        def native_app_baseline_ready(_: Any) -> dict[str, Any] | None:
            control = self.native_focused_control(client.process_id or 0)
            return (
                control
                if int(control.get("windowCount", 0)) >= 1
                and bool(control.get("mainWindow"))
                and bool(control.get("frontmost"))
                and control.get("role") not in NATIVE_FILE_PANEL_FOCUSED_ROLES
                and control.get("subrole") != "AXApplicationDialog"
                else None
            )

        baseline_control = WebDriverWait(
            client.driver,
            NATIVE_FILE_TRANSITION_TIMEOUT_SECONDS,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(native_app_baseline_ready)
        self.click(actor, trigger_selector)

        def panel_open(control: dict[str, Any]) -> bool:
            return (
                int(control.get("windowCount", 0))
                > int(baseline_control.get("windowCount", 0))
                or int(control.get("sheetCount", 0))
                > int(baseline_control.get("sheetCount", 0))
                or (
                    control.get("role") in NATIVE_FILE_PANEL_FOCUSED_ROLES
                    and control.get("role") != baseline_control.get("role")
                )
            )

        def native_panel_ready(_: Any) -> dict[str, Any] | None:
            control = self.native_focused_control(client.process_id or 0)
            return control if panel_open(control) else None

        WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(native_panel_ready)

        command = 0x00100000
        shift = 0x00020000
        self.post_key_chord(5, ((55, command), (56, shift)))

        def go_to_field_ready(_: Any) -> dict[str, Any] | None:
            control = self.native_focused_control(client.process_id or 0)
            return control if control.get("role") == "AXTextField" else None
        WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(go_to_field_ready)

        self.post_key_chord(0, ((55, command),))
        self.post_key(51, private_source=True)
        WebDriverWait(
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
                    and control.get("value") == ""
                )
                else None
            )
        )
        original_clipboard = subprocess.run(
            ("/usr/bin/pbpaste",),
            capture_output=True,
            check=False,
        )
        if original_clipboard.returncode != 0:
            raise GateError("Native file chooser could not read the current clipboard")
        try:
            copied = subprocess.run(
                ("/usr/bin/pbcopy",),
                input=str(selected_path).encode("utf-8"),
                capture_output=True,
                check=False,
            )
            if copied.returncode != 0:
                raise GateError("Native file chooser could not stage the selected path")
            self.post_key_chord(9, ((55, command),))
            WebDriverWait(
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
                        and control.get("value") == str(selected_path)
                    )
                    else None
                )
            )
        finally:
            restored = subprocess.run(
                ("/usr/bin/pbcopy",),
                input=original_clipboard.stdout,
                capture_output=True,
                check=False,
            )
            if restored.returncode != 0:
                raise GateError("Native file chooser could not restore the clipboard")
        self.post_key(36, private_source=True)

        baseline_window_count = int(baseline_control.get("windowCount", 0))
        def selection_or_browser_ready(_: Any) -> dict[str, Any] | None:
            control = self.native_focused_control(client.process_id or 0)
            if (
                int(control.get("windowCount", 0)) < baseline_window_count
                or not control.get("role")
            ):
                return None
            if control.get("subrole") == "AXApplicationDialog":
                return {"selected": False, "control": control}
            if panel_open(control) and control.get("role") != "AXTextField":
                return {"selected": False, "control": control}
            if not panel_open(control):
                return {"selected": True, "control": control}
            return None

        intermediate = WebDriverWait(
            client.driver,
            NATIVE_FILE_TRANSITION_TIMEOUT_SECONDS,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(selection_or_browser_ready)

        if not intermediate["selected"]:
            self.post_key(36, private_source=True)

        def native_window_restored(_: Any) -> dict[str, Any] | None:
            control = self.native_focused_control(client.process_id or 0)
            return (
                control
                if int(control.get("windowCount", 0))
                >= baseline_window_count
                and not panel_open(control)
                and bool(control.get("role"))
                and control.get("subrole") != "AXApplicationDialog"
                else None
            )

        WebDriverWait(
            client.driver,
            NATIVE_FILE_TRANSITION_TIMEOUT_SECONDS,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(native_window_restored)
        self.focus_actor_window(actor)
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
            const describe = (candidate) => {
              if (!(candidate instanceof Element)) return null;
              return {
                tag: candidate.tagName,
                id: candidate.id || '',
                classes: candidate.className?.baseVal
                  || candidate.className
                  || '',
                role: candidate.getAttribute('role') || '',
              };
            };
            const listener = (event) => {
              const eventTarget = event.target;
              const owned = (
                eventTarget === target
                || (
                  eventTarget instanceof Node
                  && target.contains(eventTarget)
                )
              );
              events.push({
                type: event.type,
                button: event.button,
                buttons: event.buttons,
                clientX: event.clientX,
                clientY: event.clientY,
                owned,
                target: describe(eventTarget),
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
                if (
                    isinstance(event, dict)
                    and event.get("type") == event_type
                    and event.get("owned") is True
                ):
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

        window = self.native_window(client)
        point = (
            window["left"] + window["width"] / 2,
            window["top"] + 16,
        )

        def actor_window_owns_point() -> bool:
            stack = self.native_window_stack_at_point(point)
            windows = stack.get("windows")
            if not isinstance(windows, list):
                return False
            for window in windows:
                if not isinstance(window, dict) or float(window.get("alpha") or 0) <= 0:
                    continue
                return window.get("ownerPid") == client.process_id
            return False

        if (
            bool(client.driver.execute_script("return document.hasFocus()"))
            and actor_window_owns_point()
        ):
            return client
        if self.native_mouse_button_down():
            self.post_mouse((2,), point)
            WebDriverWait(
                client.driver,
                5,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(
                lambda _: not self.native_mouse_button_down()
            )
        cooperative_activation = self.request_cooperative_activation(client)
        if cooperative_activation:
            WebDriverWait(
                client.driver,
                5,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(
                lambda driver: (
                    bool(driver.execute_script("return document.hasFocus()"))
                    and actor_window_owns_point()
                )
            )
        else:
            self.activate_native_process(client.process_id)
        WebDriverWait(
            client.driver,
            5,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(
            lambda _: actor_window_owns_point()
        )
        if not bool(client.driver.execute_script("return document.hasFocus()")):
            focus_mouse_down = False
            try:
                self.post_mouse((1,), point)
                focus_mouse_down = True
                self.post_mouse((2,), point)
                focus_mouse_down = False
                WebDriverWait(
                    client.driver,
                    5,
                    poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
                ).until(
                    lambda _: not self.native_mouse_button_down()
                )
            finally:
                if focus_mouse_down and self.native_mouse_button_down():
                    self.post_mouse((2,), point)
            WebDriverWait(
                client.driver,
                5,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(
                lambda driver: bool(driver.execute_script("return document.hasFocus()"))
            )
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
        probe_id = self.install_native_input_probe(client, element)
        mouse_down_posted = False
        try:
            cursor = 0
            current_target = client.driver.execute_script(
                """
                const element = arguments[0];
                const rect = element.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;
                const hit = document.elementFromPoint(x, y);
                return {
                  connected: element.isConnected,
                  disabled: Boolean(element.disabled),
                  hit: hit === element || element.contains(hit),
                  x,
                  y,
                };
                """,
                element,
            )
            if (
                not current_target.get("connected")
                or current_target.get("disabled")
                or not current_target.get("hit")
            ):
                raise GateError(
                    "Native click target changed before event delivery"
                )
            point = (
                window["left"]
                + content_offset_x
                + float(current_target["x"]),
                window["top"]
                + content_offset_y
                + float(current_target["y"]),
            )
            self.post_mouse(
                (1,),
                point,
            )
            mouse_down_posted = True
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
            mouse_down_posted = False
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
            if mouse_down_posted and self.native_mouse_button_down():
                self.post_mouse((2,), point)
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

        def inspect_targets() -> dict[str, Any]:
            return client.execute_script(
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

        before = inspect_targets()
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

    def thread_snapshot(self, actor: str, root_id: str) -> dict[str, Any]:
        if self.clients[actor].find_elements("[data-chat-detail-panel='open']"):
            self.click(actor, "[data-chat-detail-toggle]")
        row = self.clients[actor].find_element(
            f'[data-message-ulid="{root_id}"]',
            20,
        )
        summary = {
            "count": int(
                row.get_attribute("data-message-thread-reply-count") or 0
            ),
            "ids": [
                item
                for item in (
                    row.get_attribute("data-message-thread-reply-ids") or ""
                ).split(",")
                if item
            ],
        }
        self.hover_message(actor, root_id)
        self.click(actor, '[data-message-action="thread"]')
        panel = self.clients[actor].find_element(
            "[data-chat-thread-panel='open']",
            30,
        )
        panel_snapshot = self.clients[actor].execute_script(
            """
            const panel = arguments[0];
            return {
              root: panel.getAttribute('data-chat-thread-root') || '',
              count: Number(
                panel.getAttribute('data-chat-thread-reply-count') || 0
              ),
              ids: Array.from(
                panel.querySelectorAll('[data-thread-message-role="reply"]')
              ).map((item) =>
                item.getAttribute('data-thread-message-id') || ''
              ),
              orders: Array.from(
                panel.querySelectorAll('[data-thread-message-order]')
              ).map((item) =>
                Number(item.getAttribute('data-thread-message-order') || -1)
              ),
            };
            """,
            panel,
        )
        self.click(actor, "[data-chat-thread-close]")
        if (
            panel_snapshot.get("root") != root_id
            or panel_snapshot.get("count") != summary["count"]
            or panel_snapshot.get("ids") != summary["ids"]
        ):
            raise GateError(
                f"{actor} thread summary and panel diverged: "
                f"{json.dumps({'summary': summary, 'panel': panel_snapshot})}"
            )
        return {"summary": summary, "panel": panel_snapshot}

    def conversation_snapshot(
        self,
        actor: str,
        thread_root_id: str,
        reaction_message_id: str,
        reaction_emoji: str,
        attachment_messages: dict[str, int],
    ) -> dict[str, Any]:
        reaction_visible = self.reaction_visible(
            actor,
            reaction_message_id,
            reaction_emoji,
        )
        attachments = {
            message_id: self.attachment_message(actor, count, message_id)
            for message_id, count in attachment_messages.items()
        }
        if not reaction_visible:
            raise GateError(
                f"{actor} reaction {reaction_emoji} is missing after recovery"
            )
        if not all(isinstance(item, dict) for item in attachments.values()):
            raise GateError(f"{actor} attachment rows are incomplete after recovery")
        return {
            "transcript": self.transcript(actor),
            "thread": self.thread_snapshot(actor, thread_root_id),
            "reaction": {
                "messageId": reaction_message_id,
                "emoji": reaction_emoji,
                "visible": reaction_visible,
            },
            "attachments": attachments,
        }

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

    def prove_keyboard_reaction_picker(self, actor: str, message_id: str) -> None:
        client = self.focus_actor_window(actor)
        row = client.find_element(f'[data-message-ulid="{message_id}"]', 20)
        self.click_element(actor, row)
        self.post_key(36, private_source=True)
        WebDriverWait(client.driver, 15).until(
            lambda driver: driver.execute_script(
                """
                const active = document.activeElement;
                return active?.closest(
                  '[data-message-action-overlay="toolbar"]'
                )?.getAttribute('data-message-action-message') || '';
                """
            )
            == message_id
        )
        for _ in range(10):
            action = str(
                client.execute_script(
                    """
                    return document.activeElement
                      ?.getAttribute('data-message-action') || '';
                    """
                )
                or ""
            )
            if action == "reaction":
                break
            self.post_key(48, private_source=True)
        else:
            raise GateError("reaction action is not keyboard reachable")
        self.post_key(36, private_source=True)
        WebDriverWait(client.driver, 15).until(
            lambda driver: bool(
                driver.execute_script(
                    """
                    const picker = document.querySelector(
                      '[data-message-action-overlay="reaction-picker"]'
                    );
                    return picker
                      && document.activeElement?.hasAttribute(
                        'data-reaction-emoji'
                      );
                    """
                )
            )
        )
        self.post_key(53, private_source=True)
        self.assert_condition("toolbar_keyboard_reachable", True)

    def reaction_visible(self, actor: str, message_id: str, emoji: str) -> bool:
        rows = self.clients[actor].find_elements(
            f'[data-message-ulid="{message_id}"] [data-message-reaction]'
        )
        return any(
            row.get_attribute("data-message-reaction") == emoji for row in rows
        )

    def prove_reaction(
        self,
        conversation_id: str,
        message_id: str,
    ) -> dict[str, Any]:
        self.prove_keyboard_reaction_picker("alice", message_id)
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

            def actionable_error() -> Any | None:
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
            engine: dict[str, list[dict[str, str]]] = {}
            for actor in ("alice", "bob"):
                def reaction_readback(actor: str = actor) -> list[dict[str, str]] | None:
                    message = next(
                        (
                            item
                            for item in self.engine_messages(actor, conversation_id)
                            if item.get("message_id") == message_id
                        ),
                        None,
                    )
                    if not isinstance(message, dict):
                        return None
                    reactions = message.get("reactions")
                    if not isinstance(reactions, list):
                        return None
                    normalized = sorted(
                        ({
                            "actorPtid": str(
                                item.get("actor_ptid")
                                or item.get("actorPtid")
                                or ""
                            ),
                            "reaction": str(item.get("reaction") or ""),
                        } for item in reactions if isinstance(item, dict)),
                        key=lambda item: (
                            item["actorPtid"],
                            item["reaction"],
                        ),
                    )
                    return (
                        normalized
                        if normalized
                        == [{
                            "actorPtid": self.ptids["alice"],
                            "reaction": failure_emoji,
                        }]
                        else None
                    )

                engine[actor] = wait_until(
                    reaction_readback,
                    f"{actor} reaction Engine readback",
                    timeout=120,
                )
            self.assert_condition(
                "reaction_authority_readback",
                engine["alice"] == engine["bob"],
                json.dumps(engine, sort_keys=True),
            )
            self.assert_condition("reaction_failure_recovery", True)
            return {
                "failureEmoji": failure_emoji,
                "proxy": proxy.evidence(),
                "engine": engine,
                "recovered": True,
            }
        finally:
            proxy.disarm()

    def open_details(self, actor: str) -> Any:
        if not self.clients[actor].find_elements("[data-chat-detail-panel='open']"):
            self.click(actor, "[data-chat-detail-toggle]")
        return self.clients[actor].find_element("[data-chat-detail-panel='open']", 20)

    def identity_snapshot(self, actor: str) -> dict[str, Any]:
        client = self.clients[actor]
        value = client.execute_script(
            """
            const identities = {};
            for (const node of document.querySelectorAll('[data-chat-avatar-ptid]')) {
              const ptid = node.getAttribute('data-chat-avatar-ptid') || '';
              const src = node.getAttribute('data-chat-avatar-src') || '';
              if (!ptid || !src) continue;
              const image = node.matches('img') ? node : node.querySelector('img');
              const canonical = (() => {
                try {
                  const url = new URL(src, document.baseURI);
                  return `${url.pathname}${url.search}`;
                } catch {
                  return src;
                }
              })();
              const surface = node.closest('[data-chat-thread-panel]')
                ? 'thread'
                : node.closest('[data-chat-detail-panel]')
                  ? 'details'
                  : node.closest('[data-chat-group-ulid]')
                    ? 'conversation-list'
                    : node.closest('[data-message-ulid]')
                      ? 'timeline'
                      : 'other';
              (identities[ptid] ||= []).push({
                src,
                canonical,
                currentSrc: image?.currentSrc || image?.src || '',
                surface,
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
            ).map((node) => {
              const src = node.getAttribute('data-chat-avatar-src') || '';
              const image = node.querySelector('img');
              let canonical = src;
              try {
                canonical = new URL(src, document.baseURI).href;
              } catch {
                // Preserve the source value so malformed identities fail equality.
              }
              return {
                conversationId:
                  node.closest('[data-chat-group-ulid]')
                    ?.getAttribute('data-chat-group-ulid') || '',
                ptid: node.getAttribute('data-chat-avatar-ptid') || '',
                src,
                canonical,
                currentSrc: image?.currentSrc || image?.src || '',
                loaded: Boolean(image?.complete && image?.naturalWidth > 0),
              };
            });
            return { identities, stationNodes, groupSlots };
            """
        )
        return value if isinstance(value, dict) else {}

    def prove_identity_station(self, group_id: str, thread_root_id: str) -> None:
        snapshots: dict[str, dict[str, Any]] = {}
        for actor in ("alice", "bob"):
            def capture_phase(required_surfaces: set[str]) -> dict[str, Any]:
                def ready() -> dict[str, Any] | None:
                    snapshot = self.identity_snapshot(actor)
                    identities = snapshot.get("identities", {})
                    for ptid in self.ptids.values():
                        entries = identities.get(ptid, [])
                        for surface in required_surfaces:
                            surface_entries = [
                                entry
                                for entry in entries
                                if entry.get("surface") == surface
                            ]
                            if not surface_entries or not all(
                                entry.get("loaded") for entry in surface_entries
                            ):
                                return None
                    return snapshot

                return wait_until(
                    ready,
                    f"{actor} loaded avatar surfaces {sorted(required_surfaces)}",
                    timeout=30,
                )

            if self.clients[actor].find_elements("[data-chat-detail-panel='open']"):
                self.click(actor, "[data-chat-detail-toggle]")
            phases = [capture_phase({"conversation-list", "timeline"})]
            self.open_details(actor)
            phases.append(capture_phase({"details"}))
            self.click(actor, "[data-chat-detail-toggle]")
            self.hover_message(actor, thread_root_id)
            self.click(actor, '[data-message-action="thread"]')
            self.clients[actor].find_element("[data-chat-thread-panel='open']", 30)
            phases.append(capture_phase({"thread"}))
            self.click(actor, "[data-chat-thread-close]")

            def loaded_snapshot() -> dict[str, Any] | None:
                merged: dict[str, list[dict[str, Any]]] = {}
                station_nodes: list[dict[str, Any]] = []
                for snapshot in phases:
                    station_nodes.extend(snapshot.get("stationNodes", []))
                    for ptid, entries in snapshot.get("identities", {}).items():
                        merged.setdefault(ptid, []).extend(entries)
                expected_surfaces = {
                    "conversation-list",
                    "timeline",
                    "thread",
                    "details",
                }
                valid = True
                for ptid in self.ptids.values():
                    entries = merged.get(ptid, [])
                    surfaces = {entry.get("surface") for entry in entries}
                    canonical = {
                        entry.get("canonical")
                        for entry in entries
                        if entry.get("canonical")
                    }
                    valid = valid and (
                        expected_surfaces.issubset(surfaces)
                        and len(canonical) == 1
                        and all(entry.get("loaded") for entry in entries)
                    )
                return (
                    {
                        "identities": merged,
                        "stationNodes": station_nodes,
                        "groupSlots": [
                            slot
                            for slot in phases[0].get("groupSlots", [])
                            if slot.get("conversationId") == group_id
                        ],
                    }
                    if valid
                    else None
                )

            snapshots[actor] = wait_until(
                loaded_snapshot,
                f"{actor} exact loaded avatar surfaces",
                timeout=30,
            )

        for ptid in self.ptids.values():
            client_sources = []
            for actor in ("alice", "bob"):
                entries = snapshots[actor]["identities"].get(ptid, [])
                client_sources.append({
                    "canonical": {
                        entry.get("canonical")
                        for entry in entries
                        if entry.get("canonical")
                    },
                    "raw": {
                        entry.get("src")
                        for entry in entries
                        if entry.get("src")
                    },
                    "current": {
                        entry.get("currentSrc")
                        for entry in entries
                        if entry.get("currentSrc")
                    },
                })
            raw_sources = client_sources[0]["raw"]
            expected_cache_key = (
                hashlib.sha256(next(iter(raw_sources)).encode("utf-8"))
                .hexdigest()[:16]
                if len(raw_sources) == 1
                else ""
            )
            if (
                len(client_sources) != 2
                or len(client_sources[0]["canonical"]) != 1
                or len(client_sources[0]["raw"]) != 1
                or client_sources[0]["canonical"]
                != client_sources[1]["canonical"]
                or client_sources[0]["raw"] != client_sources[1]["raw"]
                or not expected_cache_key
                or any(
                    not sources["current"]
                    or any(
                        expected_cache_key not in str(current)
                        for current in sources["current"]
                    )
                    for sources in client_sources
                )
            ):
                raise GateError(
                    f"avatar identity diverged across clients for {ptid}: "
                    f"{client_sources}"
                )
        self.assert_condition("avatar_exact_loaded", True)
        slot_sets = {
            actor: [
                {
                    "ptid": str(slot.get("ptid") or ""),
                    "src": str(slot.get("src") or ""),
                    "canonical": str(slot.get("canonical") or ""),
                    "currentSrc": str(slot.get("currentSrc") or ""),
                    "loaded": bool(slot.get("loaded")),
                }
                for slot in snapshot["groupSlots"]
            ]
            for actor, snapshot in snapshots.items()
        }
        expected_slot_ptids = sorted(set(self.ptids.values()))
        self.assert_condition(
            "group_avatar_slots_exact",
            slot_sets["alice"] == slot_sets["bob"]
            and [slot["ptid"] for slot in slot_sets["alice"]]
            == expected_slot_ptids
            and all(
                slot["src"]
                and slot["canonical"]
                and slot["currentSrc"]
                and hashlib.sha256(slot["src"].encode("utf-8"))
                .hexdigest()[:16] in slot["currentSrc"]
                and slot["loaded"]
                for slot in slot_sets["alice"]
            ),
            json.dumps(slot_sets, sort_keys=True),
        )

        station_sets: dict[str, set[Any]] = {}
        engine_authorities: dict[str, str] = {}
        for actor, snapshot in snapshots.items():
            nodes = snapshot.get("stationNodes", [])
            ids = {
                node.get("id")
                for node in nodes
                if node.get("state") == "available" and node.get("visible")
            }
            station_sets[actor] = ids
            conversations = gateway_read(
                self.clients[actor],
                "messaging_list_conversations",
                {},
            ).get("conversations")
            conversation = next(
                (
                    item
                    for item in conversations or []
                    if isinstance(item, dict)
                    and (
                        item.get("conversation_id")
                        or item.get("conversationId")
                    )
                    == group_id
                ),
                None,
            )
            if not isinstance(conversation, dict):
                raise GateError(
                    f"{actor} Engine conversation projection is missing"
                )
            engine_authorities[actor] = str(
                conversation.get("authority_station_id")
                or conversation.get("authorityStationId")
                or ""
            )
        station_sets_detail = [
            sorted(str(station_id) for station_id in station_ids if station_id)
            for station_ids in station_sets.values()
        ]
        expected_authority = engine_authorities["alice"]
        self.assert_condition(
            "station_attribution_exact",
            bool(expected_authority)
            and engine_authorities["bob"] == expected_authority
            and station_sets["alice"] == {expected_authority}
            and station_sets["bob"] == {expected_authority},
            json.dumps(
                {
                    "dom": station_sets_detail,
                    "engine": engine_authorities,
                },
                sort_keys=True,
            ),
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
              clearedAt: Number(
                panel.getAttribute('data-chat-detail-cleared-at') || 0
              ),
              pending: panel.getAttribute('data-chat-detail-action-pending') || '',
              backgroundRetry:
                panel.getAttribute('data-chat-detail-background-retry') || '',
            };
            """,
            panel,
        )

    def background_resource_snapshot(self, actor: str) -> dict[str, Any]:
        client = self.clients[actor]
        value = client.execute_script(
            """
            const pane = document.querySelector('[data-chat-conversation-pane]');
            const surface = pane?.querySelector('.chat-message-scroll');
            const css = surface ? getComputedStyle(surface).backgroundImage : '';
            const matches = Array.from(css.matchAll(/url\\(["']?([^"')]+)["']?\\)/g));
            const src = matches.at(-1)?.[1] || '';
            const existing = window.__PT_BACKGROUND_RESOURCE_PROBE__;
            if (!existing || existing.src !== src) {
              const state = {
                reference: pane?.getAttribute('data-chat-background-image') || '',
                css,
                src,
                loaded: false,
                width: 0,
                height: 0,
              };
              const image = new Image();
              const capture = () => {
                state.loaded = image.complete && image.naturalWidth > 0;
                state.width = image.naturalWidth;
                state.height = image.naturalHeight;
              };
              image.onload = capture;
              image.onerror = capture;
              image.src = src;
              capture();
              window.__PT_BACKGROUND_RESOURCE_PROBE__ = {
                src,
                state,
                image,
              };
            }
            const probe = window.__PT_BACKGROUND_RESOURCE_PROBE__;
            probe.state.reference =
              pane?.getAttribute('data-chat-background-image') || '';
            probe.state.css = css;
            return { ...probe.state };
            """
        )
        return value if isinstance(value, dict) else {}

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

        def background_action_ready(_: Any) -> dict[str, Any] | None:
            snapshot = client.execute_script(
                """
                const describe = (node) => {
                  if (!node) return null;
                  const rect = node.getBoundingClientRect();
                  return {
                    tag: node.tagName,
                    classes: node.className?.baseVal || node.className || '',
                    role: node.getAttribute?.('role') || '',
                    text: node.textContent?.trim() || '',
                    rect: {
                      left: rect.left,
                      top: rect.top,
                      right: rect.right,
                      bottom: rect.bottom,
                      width: rect.width,
                      height: rect.height,
                    },
                  };
                };
                const action = document.querySelector(
                  '[data-chat-conversation-action="background"]'
                );
                const rect = action?.getBoundingClientRect();
                const x = rect ? rect.left + rect.width / 2 : 0;
                const y = rect ? rect.top + rect.height / 2 : 0;
                const hitStack = action
                  ? document.elementsFromPoint(x, y).slice(0, 8).map(describe)
                  : [];
                const hit = action ? document.elementFromPoint(x, y) : null;
                return {
                  ready: Boolean(
                    action && (hit === action || action.contains(hit))
                  ),
                  action: describe(action),
                  hitStack,
                  modals: Array.from(
                    document.querySelectorAll('.ant-modal')
                  ).map(describe),
                  retry: Array.from(
                    document.querySelectorAll(
                      '[data-chat-background-retry]'
                    )
                  ).map(describe),
                  alerts: Array.from(
                    document.querySelectorAll('[role="alert"]')
                  ).map(describe),
                };
                """
            )
            return snapshot if snapshot.get("ready") else None

        WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(background_action_ready)
        self.click(actor, '[data-chat-conversation-action="background"]')
        client.find_element("[data-chat-background-select]", 15)

    def select_second_background(self, actor: str) -> None:
        client = self.clients[actor]
        select = client.find_element("[data-chat-background-select]", 15)
        self.click_element(actor, select)

        def rendered_options(driver: Any) -> list[Any] | None:
            options = driver.find_elements(
                By.CSS_SELECTOR,
                ".ant-select-item-option",
            )
            return options if len(options) >= 2 else None

        options = WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(rendered_options)
        self.click_element(actor, options[1])

    def prove_settings_background(
        self,
        group_id: str,
        valid_image: Path,
        empty_image: Path,
    ) -> dict[str, Any]:
        self.open_details("alice")
        self.click("alice", '[data-chat-conversation-action="mute"]')

        def mute_projection() -> dict[str, Any] | None:
            state = self.setting_state("alice")
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
        failed_state = wait_until(
            lambda: (
                state
                if (
                    (state := self.setting_state("alice")).get("pending") == ""
                    and state.get("backgroundRetry") == "true"
                )
                else None
            ),
            "failed background upload recovery state",
            timeout=60,
        )
        if failed_state.get("backgroundImage") != before_image:
            raise GateError("failed background upload replaced the prior background")
        self.open_background_modal("alice")
        retry = self.clients["alice"].find_element(
            "[data-chat-background-retry]",
            10,
        )
        retry_client = self.clients["alice"]
        retry_client.execute_script(
            """
            const panel = document.querySelector('[data-chat-detail-panel="open"]');
            if (!panel) throw new Error('Chat Details panel is unavailable');
            const transitions = [];
            const capture = () => {
              const state = {
                pending:
                  panel.getAttribute('data-chat-detail-action-pending') || '',
                retry:
                  panel.getAttribute('data-chat-detail-background-retry') || '',
              };
              const previous = transitions.at(-1);
              if (
                !previous
                || previous.pending !== state.pending
                || previous.retry !== state.retry
              ) {
                transitions.push(state);
              }
            };
            capture();
            const observer = new MutationObserver(capture);
            observer.observe(panel, {
              attributes: true,
              attributeFilter: [
                'data-chat-detail-action-pending',
                'data-chat-detail-background-retry',
              ],
            });
            window.__PT_BACKGROUND_RETRY_PROBE__ = {
              cleanup: () => observer.disconnect(),
              snapshot: () => transitions.slice(),
            };
            """
        )

        def background_retry_trace() -> list[dict[str, str]]:
            value = retry_client.execute_script(
                """
                return window.__PT_BACKGROUND_RETRY_PROBE__?.snapshot?.() || [];
                """
            )
            return value if isinstance(value, list) else []

        def background_retry_pending() -> list[dict[str, str]] | None:
            transitions = background_retry_trace()
            return (
                transitions
                if any(
                    item.get("pending") == "background-image"
                    for item in transitions
                )
                else None
            )

        empty_image.write_bytes(valid_image.read_bytes())
        try:
            self.click_element("alice", retry)
            retry_transitions = wait_until(
                background_retry_pending,
                "background retry pending transition",
                timeout=10,
            )
            final_state = wait_until(
                lambda: (
                    state
                    if (
                        (
                            state := self.setting_state("alice")
                        ).get("backgroundImage", "")
                    ).startswith("oss://")
                    and state.get("pending") == ""
                    and state.get("backgroundRetry") == "false"
                    else None
                ),
                "uploaded background projection",
                timeout=120,
            )
        except Exception as error:
            raise GateError(
                "background retry did not converge: "
                f"{json.dumps(background_retry_trace(), sort_keys=True)}"
            ) from error
        finally:
            retry_client.execute_script(
                "window.__PT_BACKGROUND_RETRY_PROBE__?.cleanup?.();"
            )
        self.assert_condition("background_upload_recovery", True)
        rendered = wait_until(
            lambda: (
                snapshot
                if (
                    (snapshot := self.background_resource_snapshot("alice")).get(
                        "reference"
                    )
                    == final_state["backgroundImage"]
                    and snapshot.get("loaded") is True
                    and int(snapshot.get("width") or 0) > 0
                    and int(snapshot.get("height") or 0) > 0
                )
                else None
            ),
            "uploaded background CSS resource",
            timeout=60,
        )
        self.assert_condition(
            "background_rendered",
            True,
            json.dumps(rendered, sort_keys=True),
        )

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
        return {
            "ui": final_state,
            "station": normalized,
            "retryTransitions": retry_transitions,
            "rendered": rendered,
        }

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
        message_id: str = "",
    ) -> dict[str, Any] | None:
        client = self.clients[actor]
        value = client.execute_script(
            """
            const expected = Number(arguments[0]);
            const expectedId = arguments[1];
            const row = Array.from(document.querySelectorAll('[data-message-ulid]'))
              .find((item) =>
                Number(item.getAttribute('data-message-attachment-count') || 0) === expected
                && (!expectedId || item.getAttribute('data-message-ulid') === expectedId)
              );
            if (!row) return null;
            return {
              id: row.getAttribute('data-message-ulid') || '',
              count: Number(row.getAttribute('data-message-attachment-count') || 0),
              content: row.querySelector('[data-message-content]')?.innerText || '',
              attachments: Array.from(
                row.querySelectorAll('[data-messaging-attachment-id]')
              ).map((item) => {
                const images = Array.from(item.querySelectorAll('img'));
                return {
                  id: item.getAttribute('data-messaging-attachment-id') || '',
                  kind: item.getAttribute('data-messaging-attachment-kind') || '',
                  state: item.getAttribute('data-messaging-attachment-state') || '',
                  imageCount: images.length,
                  imageLoaded: images.length > 0
                    && images.every(
                      (image) => image.complete && image.naturalWidth > 0
                    ),
                };
              }),
            };
            """,
            expected_count,
            message_id,
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
        composer = self.clients["alice"].find_element(
            f'[data-chat-composer="{group_id}"]',
            5,
        )
        previous_outcome_revision = int(
            composer.get_attribute("data-chat-send-outcome-revision") or 0
        )
        self.click("alice", "[data-chat-send]")

        def current_send_outcome() -> dict[str, Any] | None:
            composer = self.clients["alice"].find_element(
                f'[data-chat-composer="{group_id}"]',
                5,
            )
            revision = int(
                composer.get_attribute("data-chat-send-outcome-revision") or 0
            )
            if revision <= previous_outcome_revision:
                return None
            return {
                "revision": revision,
                "state": composer.get_attribute("data-chat-send-outcome-state"),
                "messageId": composer.get_attribute(
                    "data-chat-send-outcome-message-id"
                ) or "",
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

        outcome = wait_until(
            current_send_outcome,
            "queued two-attachment send outcome",
            timeout=180,
        )
        if outcome["state"] != "pending":
            raise GateError(f"Composer send outcome was not queued: {outcome}")
        if (
            not outcome["messageId"]
            or outcome["count"] != 2
            or len(outcome["ids"]) != 2
        ):
            raise GateError(f"Composer send outcome count mismatch: {outcome}")
        if self.clients["alice"].find_elements("[data-chat-attachment-draft]"):
            raise GateError("queued attachment send did not clear Composer drafts")

        def rendered_attachment_message(actor: str) -> dict[str, Any] | None:
            row = self.attachment_message(
                actor,
                2,
                str(outcome["messageId"]),
            )
            if not row:
                return None
            image_attachments = [
                attachment
                for attachment in row["attachments"]
                if attachment["kind"] == "image"
            ]
            return (
                row
                if len(image_attachments) == 1
                and {
                    attachment["id"]
                    for attachment in row["attachments"]
                }
                == set(outcome["ids"])
                and image_attachments[0]["imageCount"] > 0
                and image_attachments[0]["imageLoaded"]
                else None
            )

        sender_row = wait_until(
            lambda: rendered_attachment_message("alice"),
            "Alice two-attachment row",
            timeout=180,
        )
        receiver_row = wait_until(
            lambda: rendered_attachment_message("bob"),
            "Bob two-attachment row",
            timeout=180,
        )
        if (
            sender_row != receiver_row
            or str(sender_row["content"]).strip()
        ):
            raise GateError(
                "attachment-only sender/receiver rows diverged or contain text: "
                f"{json.dumps({'sender': sender_row, 'receiver': receiver_row}, sort_keys=True)}"
            )

        previous_outcome_revision = int(outcome["revision"])
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
                        '[data-chat-attachment-draft]'
                        '[data-chat-attachment-status="ready"]'
                    )
                )
                == 1
                else None
            ),
            "one ready text-plus-attachment draft",
            timeout=120,
        )
        text_attachment_content = f"w13-text-attachment-{os.getpid()}"
        self.composer_send("alice", text_attachment_content)
        text_outcome = wait_until(
            current_send_outcome,
            "queued text-plus-attachment send outcome",
            timeout=180,
        )
        if (
            text_outcome["state"] != "pending"
            or not text_outcome["messageId"]
            or text_outcome["count"] != 1
            or len(text_outcome["ids"]) != 1
        ):
            raise GateError(
                f"text-plus-attachment outcome count mismatch: {text_outcome}"
            )
        if self.clients["alice"].find_elements("[data-chat-attachment-draft]"):
            raise GateError(
                "queued text-plus-attachment send did not clear Composer draft"
            )
        text_message = self.wait_message_text("alice", text_attachment_content)
        self.wait_message_text("bob", text_attachment_content)
        if str(text_message["id"]) != text_outcome["messageId"]:
            raise GateError(
                "text-plus-attachment outcome and DOM message IDs differ: "
                f"{json.dumps({'outcome': text_outcome, 'dom': text_message}, sort_keys=True)}"
            )
        text_rows = {
            actor: wait_until(
                lambda actor=actor: self.attachment_message(
                    actor,
                    1,
                    str(text_outcome["messageId"]),
                ),
                f"{actor} text-plus-attachment row",
                timeout=180,
            )
            for actor in ("alice", "bob")
        }
        if (
            text_rows["alice"] != text_rows["bob"]
            or text_rows["alice"]["content"] != text_attachment_content
            or {
                attachment["id"]
                for attachment in text_rows["alice"]["attachments"]
            }
            != set(text_outcome["ids"])
        ):
            raise GateError(
                "text-plus-attachment rows diverged: "
                f"{json.dumps(text_rows, sort_keys=True)}"
            )

        engine: dict[str, Any] = {}
        byte_hashes: dict[str, Any] = {}
        message_expectations = {
            "attachmentOnly": {
                "messageId": str(outcome["messageId"]),
                "count": 2,
                "hashes": {
                    image_file.name: file_sha256(image_file),
                    text_file.name: file_sha256(text_file),
                },
            },
            "textPlusAttachment": {
                "messageId": str(text_outcome["messageId"]),
                "count": 1,
                "hashes": {text_file.name: file_sha256(text_file)},
            },
        }
        for actor in ("alice", "bob"):
            messages = self.engine_messages(actor, group_id)
            engine[actor] = {}
            byte_hashes[actor] = {}
            for label, expectation in message_expectations.items():
                message = next(
                    (
                        item
                        for item in messages
                        if item.get("message_id") == expectation["messageId"]
                    ),
                    None,
                )
                if not isinstance(message, dict):
                    raise GateError(
                        f"{actor} Engine {label} attachment message is missing"
                    )
                attachments = message.get("attachments")
                if (
                    not isinstance(attachments, list)
                    or len(attachments) != expectation["count"]
                ):
                    raise GateError(
                        f"{actor} Engine {label} attachment count mismatch: "
                        f"{attachments}"
                    )
                engine_attachment_ids = {
                    str(attachment.get("attachment_id") or "")
                    for attachment in attachments
                    if isinstance(attachment, dict)
                }
                expected_attachment_ids = set(
                    outcome["ids"]
                    if label == "attachmentOnly"
                    else text_outcome["ids"]
                )
                if engine_attachment_ids != expected_attachment_ids:
                    raise GateError(
                        f"{actor} Engine {label} attachment IDs differ: "
                        f"expected={sorted(expected_attachment_ids)} "
                        f"actual={sorted(engine_attachment_ids)}"
                    )
                engine[actor][label] = message
                actor_hashes: dict[str, str] = {}
                for attachment in attachments:
                    attachment_id = str(attachment.get("attachment_id") or "")
                    filename = str(attachment.get("filename") or "")
                    selector = f'[data-messaging-attachment-id="{attachment_id}"]'
                    attachment_element = self.clients[actor].find_element(
                        selector,
                        20,
                    )
                    if (
                        attachment_element.get_attribute(
                            "data-messaging-attachment-open-state"
                        )
                        != "ready"
                    ):
                        self.click_element(actor, attachment_element)
                    wait_until(
                        lambda: (
                            element
                            if (
                                element := self.clients[actor].find_element(
                                    selector,
                                    5,
                                )
                            ).get_attribute(
                                "data-messaging-attachment-open-state"
                            )
                            == "ready"
                            else None
                        ),
                        f"{actor} attachment {attachment_id} Native open",
                        timeout=60,
                    )
                    opened = gateway_read(
                        self.clients[actor],
                        "messaging_open_attachment",
                        {"attachment_id": attachment_id},
                    )
                    local_path = Path(str(opened.get("local_path") or ""))
                    if not local_path.is_file():
                        raise GateError(f"{actor} attachment cache path is missing")
                    actor_hashes[filename] = file_sha256(local_path)
                if actor_hashes != expectation["hashes"]:
                    raise GateError(
                        f"{actor} {label} attachment byte hashes differ: "
                        f"expected={expectation['hashes']} actual={actor_hashes}"
                    )
                byte_hashes[actor][label] = actor_hashes

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
            and text_outcome["count"] == 1
            and len(text_outcome["ids"]) == 1
            and len(engine["alice"]["attachmentOnly"]["attachments"]) == 2
            and len(engine["bob"]["attachmentOnly"]["attachments"]) == 2
            and len(engine["alice"]["textPlusAttachment"]["attachments"]) == 1
            and len(engine["bob"]["textPlusAttachment"]["attachments"]) == 1
            and sender_row["count"] == 2
            and receiver_row["count"] == 2
            and text_rows["alice"]["count"] == 1
            and text_rows["bob"]["count"] == 1
            and all(value == {"media": 1, "files": 2} for value in details.values())
        )
        self.assert_condition(
            "attachment_count_conservation",
            conserved,
            json.dumps(
                {
                    "outcome": outcome,
                    "textOutcome": text_outcome,
                    "sender": sender_row,
                    "receiver": receiver_row,
                    "textRows": text_rows,
                    "details": details,
                }
            ),
        )
        self.assert_condition(
            "attachment_images_loaded",
            True,
            json.dumps(
                {
                    "sender": sender_row["attachments"],
                    "receiver": receiver_row["attachments"],
                }
            ),
        )
        self.assert_condition("attachment_byte_exact", True, json.dumps(byte_hashes))
        return {
            "outcome": outcome,
            "textOutcome": text_outcome,
            "engine": engine,
            "senderRow": sender_row,
            "receiverRow": receiver_row,
            "textRows": text_rows,
            "details": details,
            "byteHashes": byte_hashes,
        }

    def open_existing_group(self, actor: str, group_id: str) -> None:
        self.enter_chat_page(actor)
        self.clients[actor].find_element(
            f'[data-chat-group-ulid="{group_id}"]',
            180,
        )
        self.click(actor, f'[data-chat-group-ulid="{group_id}"]')
        self.clients[actor].find_element(
            f'[data-chat-conversation-pane="{group_id}"]',
            180,
        )

    def prove_offline_recovery(
        self,
        group_id: str,
        thread_root_id: str,
        reaction_message_id: str,
        reaction_emoji: str,
        attachment_messages: dict[str, int],
    ) -> dict[str, Any]:
        before = {
            actor: self.conversation_snapshot(
                actor,
                thread_root_id,
                reaction_message_id,
                reaction_emoji,
                attachment_messages,
            )
            for actor in ("alice", "bob")
        }
        if before["alice"] != before["bob"]:
            raise GateError("Alice and Bob diverged before offline recovery")

        self.clients["bob"].stop()
        offline_text = f"w13-offline-{os.getpid()}"
        self.composer_send("alice", offline_text)
        self.wait_message_text("alice", offline_text)

        self.restart_actor("bob")
        self.open_existing_group("bob", group_id)
        wait_until(
            lambda: (
                value
                if (
                    (value := self.transcript("bob"))
                    == self.transcript("alice")
                    and any(
                        offline_text in str(item.get("content") or "")
                        for item in value
                    )
                )
                else None
            ),
            "Bob offline exact transcript recovery",
            timeout=180,
        )
        after = {
            actor: self.conversation_snapshot(
                actor,
                thread_root_id,
                reaction_message_id,
                reaction_emoji,
                attachment_messages,
            )
            for actor in ("alice", "bob")
        }
        self.assert_condition(
            "offline_recovery_exact",
            after["alice"] == after["bob"],
            json.dumps(after, sort_keys=True),
        )
        return {"before": before, "after": after, "offlineText": offline_text}

    def prove_restart(
        self,
        group_id: str,
        settings_before: dict[str, Any],
        thread_root_id: str,
        reaction_message_id: str,
        reaction_emoji: str,
        attachment_messages: dict[str, int],
    ) -> dict[str, Any]:
        expected = self.conversation_snapshot(
            "bob",
            thread_root_id,
            reaction_message_id,
            reaction_emoji,
            attachment_messages,
        )
        self.restart_actor("alice")
        self.open_existing_group("alice", group_id)
        wait_until(
            lambda: (
                value
                if (value := self.transcript("alice"))
                == expected["transcript"]
                else None
            ),
            "Alice exact transcript after restart",
            timeout=180,
        )
        actual = self.conversation_snapshot(
            "alice",
            thread_root_id,
            reaction_message_id,
            reaction_emoji,
            attachment_messages,
        )
        self.assert_condition(
            "restart_exact",
            actual == expected,
            json.dumps({"expected": expected, "actual": actual}, sort_keys=True),
        )
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
        rendered = wait_until(
            lambda: (
                value
                if (
                    (value := self.background_resource_snapshot("alice")).get(
                        "reference"
                    )
                    == settings_before["ui"]["backgroundImage"]
                    and value.get("loaded") is True
                )
                else None
            ),
            "background resource after client restart",
            timeout=60,
        )
        station = gateway_read(
            self.clients["alice"],
            "conversation_get_member_settings",
            {"conversation_id": group_id},
        )
        normalized_station = (
            station.get("settings")
            if isinstance(station.get("settings"), dict)
            else station
        )
        station_matches = (
            bool(normalized_station.get("muted"))
            and bool(normalized_station.get("pinned"))
            and normalized_station.get("background") == "paper"
            and str(
                normalized_station.get("background_image")
                or normalized_station.get("backgroundImage")
                or ""
            )
            == settings_before["ui"]["backgroundImage"]
            and int(
                normalized_station.get("cleared_at_unix_ms")
                or normalized_station.get("clearedAtUnixMs")
                or 0
            )
            == 0
        )
        self.assert_condition(
            "settings_restart_recovery",
            bool(state) and station_matches and bool(rendered),
            json.dumps(
                {
                    "ui": state,
                    "station": normalized_station,
                    "rendered": rendered,
                },
                sort_keys=True,
            ),
        )
        result = {
            "expected": expected,
            "actual": actual,
            "settings": state,
            "station": normalized_station,
            "background": rendered,
        }
        self.write_json_evidence("restart-detail-ready", result)
        return result

    def click_confirmation(self, actor: str) -> None:
        buttons = self.clients[actor].find_elements(
            ".ant-modal-confirm .ant-btn-primary"
        )
        visible = [button for button in buttons if button.is_displayed()]
        if not visible:
            raise GateError(f"{actor} confirmation action is unavailable")
        self.click_element(actor, visible[-1])

    def prove_clear_cursor(self, group_id: str) -> dict[str, Any]:
        self.open_details("alice")
        self.click("alice", '[data-chat-history-action="clear"]')
        self.click_confirmation("alice")
        cleared = wait_until(
            lambda: (
                value
                if (value := self.setting_state("alice")).get("clearedAt", 0) > 0
                else None
            ),
            "clear cursor projection",
            timeout=60,
        )
        station_cleared = gateway_read(
            self.clients["alice"],
            "conversation_get_member_settings",
            {"conversation_id": group_id},
        )
        normalized = (
            station_cleared.get("settings")
            if isinstance(station_cleared.get("settings"), dict)
            else station_cleared
        )
        station_value = int(
            normalized.get("cleared_at_unix_ms")
            or normalized.get("clearedAtUnixMs")
            or 0
        )
        if station_value != int(cleared["clearedAt"]):
            raise GateError(
                "clear cursor Station readback diverged: "
                f"ui={cleared['clearedAt']} station={station_value}"
            )

        self.restart_actor("alice")
        self.open_existing_group("alice", group_id)
        restored = wait_until(
            lambda: (
                value
                if (
                    (value := self.setting_state("alice")).get("clearedAt")
                    == cleared["clearedAt"]
                    and self.transcript("alice") == []
                )
                else None
            ),
            "clear cursor restart recovery",
            timeout=180,
        )
        self.click("alice", '[data-chat-history-action="restore"]')
        self.click_confirmation("alice")
        wait_until(
            lambda: (
                value
                if (value := self.setting_state("alice")).get("clearedAt") == 0
                else None
            ),
            "clear cursor restore",
            timeout=60,
        )
        expected = wait_until(
            lambda: (
                value
                if (value := self.transcript("alice"))
                == self.transcript("bob")
                else None
            ),
            "restored exact transcript",
            timeout=180,
        )
        station_restored = gateway_read(
            self.clients["alice"],
            "conversation_get_member_settings",
            {"conversation_id": group_id},
        )
        restored_settings = (
            station_restored.get("settings")
            if isinstance(station_restored.get("settings"), dict)
            else station_restored
        )
        station_restored_cursor = int(
            restored_settings.get("cleared_at_unix_ms")
            or restored_settings.get("clearedAtUnixMs")
            or 0
        )
        self.assert_condition(
            "clear_cursor_station_readback",
            bool(expected) and station_restored_cursor == 0,
            json.dumps(
                {
                    "cleared": cleared,
                    "station": normalized,
                    "restart": restored,
                    "restoredStation": restored_settings,
                },
                sort_keys=True,
            ),
        )
        return {
            "cleared": cleared,
            "station": normalized,
            "restart": restored,
            "restoredStation": restored_settings,
            "restoredTranscript": expected,
        }

    def create_recovery_revision(self, actor: str) -> str:
        client = self.clients[actor]
        self.click(actor, RECOVERY_SELECTORS["settings_nav"])
        self.click(actor, RECOVERY_SELECTORS["security_section"])
        self.click(actor, RECOVERY_SELECTORS["generate"])
        self.click(actor, RECOVERY_SELECTORS["reveal"])
        phrase = str(
            client.execute_script(
                """
                return Array.from(
                  document.querySelectorAll(
                    '[data-recovery-phrase] span:last-child'
                  )
                )
                  .map((element) => element.textContent?.trim())
                  .filter(Boolean)
                  .join(' ');
                """
            )
            or ""
        )
        if len(phrase.split()) != 24:
            raise GateError("recovery phrase does not contain exactly 24 words")
        self.click(actor, RECOVERY_SELECTORS["backup"])
        WebDriverWait(client.driver, 120).until(
            lambda driver: bool(
                driver.find_elements(By.CSS_SELECTOR, ".ant-message-success")
            )
        )
        return phrase

    def restore_recovery_revision(self, actor: str, phrase: str) -> None:
        client = self.clients[actor]
        self.click(actor, RECOVERY_SELECTORS["settings_nav"])
        self.click(actor, RECOVERY_SELECTORS["security_section"])
        self.click(actor, RECOVERY_SELECTORS["restore_open"])
        restore_input = client.find_element(
            RECOVERY_SELECTORS["restore_input"],
            20,
        )
        self.click_element(actor, restore_input)
        restore_input.send_keys(Keys.COMMAND, "a")
        restore_input.send_keys(Keys.BACKSPACE)
        restore_input.send_keys(phrase)
        self.click(actor, RECOVERY_SELECTORS["restore_submit"])
        WebDriverWait(client.driver, 180).until(
            lambda driver: (
                not driver.find_elements(
                    By.CSS_SELECTOR,
                    RECOVERY_SELECTORS["restore_input"],
                )
                and bool(
                    driver.find_elements(By.CSS_SELECTOR, ".ant-message-success")
                )
            )
        )

    def prove_second_device(
        self,
        group_id: str,
        expected_settings: dict[str, Any],
    ) -> dict[str, Any]:
        recovery_phrase = self.create_recovery_revision("alice")
        self.save_screenshot(self.clients["alice"], "alice-final")
        self.save_dom(self.clients["alice"], "alice-final")
        self.save_app_log(self.clients["alice"], "alice-final")
        first_device_id = self.device_ids["alice"]
        self.clients["alice"].stop()
        self.launch_actor("alice2", wait_for_device=False)
        self.restore_recovery_revision("alice2", recovery_phrase)
        second_device_id = self.bind_recovered_device("alice2")
        if (
            self.ptids["alice2"] != self.ptids["alice"]
            or second_device_id == first_device_id
        ):
            raise GateError("Alice second-device identity is not isolated")
        self.open_existing_group("alice2", group_id)
        state = wait_until(
            lambda: (
                value
                if (
                    (value := self.setting_state("alice2")).get("muted") == "true"
                    and value.get("pinned") == "true"
                    and value.get("background") == "paper"
                    and value.get("backgroundImage")
                    == expected_settings["backgroundImage"]
                    and value.get("clearedAt") == 0
                )
                else None
            ),
            "Alice second-device settings recovery",
            timeout=180,
        )
        rendered = wait_until(
            lambda: (
                value
                if (
                    (value := self.background_resource_snapshot("alice2")).get(
                        "reference"
                    )
                    == expected_settings["backgroundImage"]
                    and value.get("loaded") is True
                )
                else None
            ),
            "Alice second-device background render",
            timeout=60,
        )
        station = gateway_read(
            self.clients["alice2"],
            "conversation_get_member_settings",
            {"conversation_id": group_id},
        )
        normalized = (
            station.get("settings")
            if isinstance(station.get("settings"), dict)
            else station
        )
        station_matches = (
            bool(normalized.get("muted"))
            and bool(normalized.get("pinned"))
            and normalized.get("background") == "paper"
            and str(
                normalized.get("background_image")
                or normalized.get("backgroundImage")
                or ""
            )
            == expected_settings["backgroundImage"]
            and int(
                normalized.get("cleared_at_unix_ms")
                or normalized.get("clearedAtUnixMs")
                or 0
            )
            == 0
        )
        client_isolated = all(
            self.client_specs["alice"][field]
            != self.client_specs["alice2"][field]
            for field in (
                "webdriver_port",
                "gateway_port",
                "profile",
                "storage_root",
            )
        )
        result = {
            "firstDeviceId": first_device_id,
            "secondDeviceId": second_device_id,
            "ptid": self.ptids["alice2"],
            "settings": state,
            "station": station,
            "background": rendered,
        }
        self.assert_condition(
            "background_second_device_recovery",
            station_matches and client_isolated,
            json.dumps(result, sort_keys=True),
        )
        return result

    def audit_runtime_logs(self) -> dict[str, Any]:
        forbidden = (
            re.compile(r"/group-chat/members"),
            re.compile(r"/conversation/members"),
            re.compile(r"active conversation membership required"),
            re.compile(r"messaging read cursor is incomplete"),
            re.compile(r"unhandled(?: promise)? rejection"),
            re.compile(r"last_read_sequence[\"']?\s*[:=]\s*0(?=\D|$)"),
            re.compile(r"lastreadsequence[\"']?\s*[:=]\s*0(?=\D|$)"),
        )
        matches: list[dict[str, str]] = []
        audit: list[dict[str, Any]] = []
        for index, client in enumerate(self.runtime_instances):
            if not client.log_path or not client.log_path.is_file():
                matches.append({
                    "profile": client.profile,
                    "marker": "runtime log missing",
                })
                continue
            raw = client.log_path.read_bytes()
            if not raw:
                matches.append({
                    "profile": client.profile,
                    "marker": "runtime log empty",
                })
                continue
            content = raw.decode(
                encoding="utf-8",
                errors="replace",
            ).lower()
            audit.append({
                "launch": index + 1,
                "profile": client.profile,
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            })
            for pattern in forbidden:
                if pattern.search(content):
                    matches.append({
                        "profile": client.profile,
                        "marker": pattern.pattern,
                    })
        return {
            "logs": audit,
            "matches": matches,
            "clean": (
                len(audit) == len(self.runtime_instances)
                and not matches
            ),
        }

    def collect_final_evidence(self) -> None:
        for actor in ("bob", "alice2"):
            self.save_screenshot(self.clients[actor], f"{actor}-final")
            self.save_dom(self.clients[actor], f"{actor}-final")
            self.save_app_log(self.clients[actor], f"{actor}-final")

    def cleanup_clients(self) -> dict[str, Any]:
        pids = sorted(self.runtime_pids)
        ports = sorted(
            {
                int(spec["webdriver_port"])
                for spec in self.client_specs.values()
            }
            | {
                int(spec["gateway_port"])
                for spec in self.client_specs.values()
            }
            | {
                int(spec["renderer_port"])
                for spec in self.client_specs.values()
            }
            | (
                {self.reaction_proxy.port}
                if self.reaction_proxy is not None
                else set()
            )
        )
        storage_roots = sorted({
            Path(str(spec["storage_root"]))
            for spec in self.client_specs.values()
        })
        log_paths = [
            client.log_path
            for client in self.runtime_instances
            if client.log_path is not None
        ]
        cleanup_errors: list[dict[str, str]] = []
        for index in reversed(range(len(self.runtime_instances))):
            client = self.runtime_instances[index]
            attempt = self.runtime_launches[index]
            try:
                client.stop()
                attempt["cleanupStatus"] = "stopped"
            except Exception as error:
                attempt["cleanupStatus"] = "failed"
                cleanup_errors.append({
                    "resource": f"client:{client.profile}",
                    "error": str(error),
                })
        if self.reaction_proxy is not None:
            try:
                self.reaction_proxy.disarm()
                self.reaction_proxy.stop()
            except Exception as error:
                cleanup_errors.append({
                    "resource": "reaction-proxy",
                    "error": str(error),
                })
        runtime_log_audit = self.audit_runtime_logs()
        self.write_json_evidence("runtime-log-audit", runtime_log_audit)
        self.write_json_evidence(
            "runtime-launch-ledger",
            self.runtime_launches,
        )
        for index, log_path in enumerate(log_paths):
            try:
                if log_path.is_file():
                    self.report.add_evidence_file(
                        f"runtime-{index:02d}-app-log",
                        log_path,
                        destination_dir=self.evidence_dir,
                    )
            except Exception as error:
                cleanup_errors.append({
                    "resource": f"log-evidence:{log_path}",
                    "error": str(error),
                })

        try:
            ports_released = bool(wait_until(
                lambda: all(port_is_free(port) for port in ports),
                "Native client port release",
                timeout=30,
            ))
        except GateError:
            ports_released = False
        try:
            processes_released = bool(wait_until(
                lambda: all(pid_is_stopped(pid) for pid in pids),
                "Native client process release",
                timeout=30,
            ))
        except GateError:
            processes_released = False

        storage_errors: list[dict[str, str]] = []
        for storage_root in storage_roots:
            try:
                shutil.rmtree(storage_root)
            except FileNotFoundError:
                pass
            except OSError as error:
                storage_errors.append({
                    "path": str(storage_root),
                    "error": str(error),
                })
        storage_released = (
            not storage_errors
            and all(not storage_root.exists() for storage_root in storage_roots)
        )
        for log_path in log_paths:
            try:
                log_path.unlink(missing_ok=True)
            except OSError as error:
                cleanup_errors.append({
                    "resource": f"log:{log_path}",
                    "error": str(error),
                })
        logs_released = all(not path.exists() for path in log_paths)
        result = {
            "ports": ports,
            "pids": pids,
            "storageRoots": [str(path) for path in storage_roots],
            "storageErrors": storage_errors,
            "cleanupErrors": cleanup_errors,
            "logs": [str(path) for path in log_paths],
            "portsReleased": bool(ports_released),
            "processesReleased": bool(processes_released),
            "storageReleased": storage_released,
            "logsReleased": logs_released,
        }
        detail = json.dumps(result, sort_keys=True)
        assertions = {
            "runtime_logs_clean": bool(runtime_log_audit["clean"]),
            "cleanup_ports_released": bool(result["portsReleased"]),
            "cleanup_processes_released": bool(result["processesReleased"]),
            "cleanup_storage_released": (
                bool(result["storageReleased"])
                and bool(result["logsReleased"])
                and not cleanup_errors
            ),
        }
        for name, passed in assertions.items():
            self.report.add_assertion(name, passed, detail)
        self.write_json_evidence("cleanup", result)
        failed = [name for name, passed in assertions.items() if not passed]
        if failed:
            raise GateError(f"cleanup assertions failed: {failed}; {detail}")
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
        source_commit = str(
            source.get("commit") if isinstance(source, dict) else ""
        )
        station_commit = str(
            station.get("liveCommit") if isinstance(station, dict) else ""
        )
        self.assert_condition(
            "source_build_runtime_identity",
            isinstance(source, dict)
            and bool(source_commit)
            and source.get("workspaceDigest") == "clean"
            and isinstance(station, dict)
            and bool(station_commit)
            and commits_match(source_commit, station_commit)
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
                lambda: self.prove_reaction(group_id, action_message_id),
            )
            self.step(
                "identity.station.dom",
                lambda: self.prove_identity_station(group_id, action_message_id),
            )
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
            attachment_messages = {
                str(attachments["senderRow"]["id"]): 2,
                str(attachments["textRows"]["alice"]["id"]): 1,
            }
            offline = self.step(
                "bob.offline.recovery.ui",
                lambda: self.prove_offline_recovery(
                    group_id,
                    action_message_id,
                    action_message_id,
                    str(reaction["failureEmoji"]),
                    attachment_messages,
                ),
            )
            restart = self.step(
                "client.restart.ui",
                lambda: self.prove_restart(
                    group_id,
                    {"ui": settings["ui"]},
                    action_message_id,
                    action_message_id,
                    str(reaction["failureEmoji"]),
                    attachment_messages,
                ),
            )
            clear_cursor = self.step(
                "clear.cursor.restart.ui",
                lambda: self.prove_clear_cursor(group_id),
            )
            second_device = self.step(
                "alice.second-device.recovery.ui",
                lambda: self.prove_second_device(group_id, settings["ui"]),
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
            self.write_json_evidence(
                "settings-background",
                {
                    "initial": settings,
                    "clearCursor": clear_cursor,
                    "secondDevice": second_device,
                },
            )
            self.write_json_evidence("attachment-ledger", attachments)
            self.write_json_evidence(
                "recovery-ledger",
                {"offline": offline, "restart": restart},
            )
        finally:
            try:
                cleanup = self.cleanup_clients()
            finally:
                shutil.rmtree(self.fixture_root, ignore_errors=True)

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
