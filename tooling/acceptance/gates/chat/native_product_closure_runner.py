#!/usr/bin/env python3
"""Prove the MP-W13 Chat product closure through real Native DOM actions."""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from selenium.common.exceptions import TimeoutException
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
from tooling.acceptance.drivers.native import (
    MouseAction,
    NativeControlSnapshot,
    NativeDesktopAdapter,
    NativeDesktopRuntimeBinding,
    NativeKey,
    NativeModifier,
)
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.fixtures.chat_submit_fault_proxy import (
    AcceptanceStationSubmitFaultProxy,
)
from tooling.acceptance.gates.chat.native_support import (
    NativeClientLifecycleLedger,
    cleanup_preserving_primary_failure,
    commits_match,
    read_station_version,
    runtime_station_service,
    wait_until,
)


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
    "feedback": '[role="dialog"], [role="alertdialog"]',
    "restore_open": "[data-recovery-restore-open]",
    "restore_input": "[data-recovery-restore-input]",
    "restore_submit": "[data-recovery-restore-submit]",
}
MESSAGE_ACTION_SELECTORS = {
    "reaction": '[data-message-action="reaction"]',
    "reply": '[data-message-action="reply"]',
    "thread": '[data-message-action="thread"]',
}
NATIVE_INPUT_ACK_POLL_SECONDS = 0.01
NATIVE_KEY_SEQUENCE_INTERVAL_SECONDS = 0.2
NATIVE_FILE_TRANSITION_TIMEOUT_SECONDS = 30
NATIVE_ACTOR_LOGIN_TIMEOUT_SECONDS = 60
VALID_ATTACHMENT_IMAGE_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c63f8cfc0f01f00050001ff89993d1d"
    "0000000049454e44ae426082"
)


# #region debug-point A-E:cross-station-direct-open
def _debug_report(
    hypothesis_id: str,
    location: str,
    message: str,
    data: dict[str, Any],
) -> None:
    env_path = REPO_ROOT / ".dbg" / "direct-projection-role.env"
    if not env_path.exists():
        return
    values = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator:
            values[key] = value
    url = values.get("DEBUG_SERVER_URL", "")
    session_id = values.get("DEBUG_SESSION_ID", "")
    if not url or not session_id:
        return
    endpoint = url.removeprefix("http://")
    authority, separator, path = endpoint.partition("/")
    if not separator or ":" not in authority:
        return
    host, raw_port = authority.rsplit(":", 1)
    payload = json.dumps(
        {
            "sessionId": session_id,
            "runId": os.environ.get("PT_DEBUG_RUN_ID", "pre-fix"),
            "hypothesisId": hypothesis_id,
            "location": location,
            "msg": f"[DEBUG] {message}",
            "data": data,
            "ts": int(time.time() * 1000),
        }
    ).encode("utf-8")
    try:
        connection = http.client.HTTPConnection(host, int(raw_port), timeout=1)
        connection.request(
            "POST",
            f"/{path}",
            body=payload,
            headers={"Content-Type": "application/json"},
        )
        connection.getresponse().read()
        connection.close()
    except (OSError, ValueError):
        pass
# #endregion


LOCALIZATION_KEY_PATTERN = re.compile(
    r"\b(?:agent|applet|auth|channels|chat|common|cron|error|errors|layout|memory|"
    r"moments|notes|oauth|provider|search|settings|share|tts)"
    r"\.[A-Za-z0-9_.-]+\b"
)
REQUIRED_ASSERTIONS = {
    "native_dom_only",
    "source_build_runtime_identity",
    "visible_ui_has_no_i18n_keys",
    "conversation_search_open_exact",
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
    "conversation_local_clear",
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
    "native-activation-diagnostics",
    "runtime-launch-ledger",
    "runtime-log-audit",
    "direct-search-reuse",
    "alice-direct-search-first-screenshot",
    "alice-direct-search-first-dom",
    "alice-direct-search-second-screenshot",
    "alice-direct-search-second-dom",
    "cleanup",
}
REQUIRED_LOCALIZATION_CHECKPOINTS = {
    "search-result-create": {"alice"},
    "search-result-reuse": {"alice"},
    "direct-open": {"alice"},
    "group-create": {"alice"},
    "group-open": {"alice", "bob"},
    "thread": {"alice"},
    "reaction-picker": {"alice"},
    "reaction-error": {"alice"},
    "identity": {"alice", "bob"},
    "background-picker": {"alice"},
    "background-failure": {"alice"},
    "settings": {"alice"},
    "attachment-failure": {"alice"},
    "attachments": {"alice", "bob"},
    "offline": {"alice", "bob"},
    "restart": {"alice", "bob"},
    "conversation-local-clear": {"alice", "bob"},
    "recovery-create": {"alice"},
    "recovery-restore": {"alice2"},
    "alice2": {"alice2"},
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


def port_is_free(port: int) -> bool:
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) != 0


def native_input_event_cursor(
    events: object,
    event_type: str,
    after_index: int,
) -> int | None:
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


class NativeProductClosureGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "MP-W13-F"
    bom = ("MP-W13-A", "MP-W13-B", "MP-W13-C", "MP-W13-D", "MP-W13-E", "MP-W13-F")
    spec = (
        "AS-W13-01",
        "AS-W13-02",
        "AS-W13-03",
        "AS-W13-04",
        "AS-W13-05",
        "AS-W13-06",
    )

    def __init__(
        self,
        *,
        manifest: dict[str, Any],
        actor_manifest: dict[str, Any],
        runtime_binding: NativeDesktopRuntimeBinding,
    ) -> None:
        super().__init__()
        self.manifest = manifest
        self.actor_manifest = actor_manifest
        self.runtime_binding = runtime_binding
        self.native_adapter: NativeDesktopAdapter = (
            runtime_binding.native_adapter
        )
        station = runtime_station_service(self.manifest, "alice")
        self.station_url = str(station.get("endpoint") or "").rstrip("/")
        if not self.station_url:
            raise GateError("runtime manifest Station URL is required")
        self.client_specs = {
            str(client.get("id")): client
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
        self.clients: dict[str, TauriSession] = {}
        self.runtime_instances: list[TauriSession] = []
        self.client_lifecycles = NativeClientLifecycleLedger()
        self.runtime_pids: set[int] = set()
        self.runtime_launches: list[dict[str, Any]] = []
        self.ptids: dict[str, str] = {}
        self.device_ids: dict[str, str] = {}
        self.steps: list[dict[str, Any]] = []
        self.structured_evidence: dict[str, Any] = {}
        self.localization_checks: dict[str, dict[str, list[str]]] = {}
        self.native_activation_diagnostics: list[dict[str, Any]] = []
        self.reaction_proxy: AcceptanceStationSubmitFaultProxy | None = None
        self.reaction_transport_override = None
        self.fixture_root = Path(tempfile.mkdtemp(prefix="pt-chat-product-closure-"))
        self.report.station_url = self.station_url
        self.report.manifest = self.manifest

    def step(self, name: str, action: Callable[[], Any]) -> Any:
        try:
            value = action()
        except Exception as error:
            self.steps.append({"step": name, "status": "fail", "error": str(error)})
            self.report.runtime["steps"] = list(self.steps)
            self.report.runtime["firstFailedStep"] = name
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

    def wait_for_realtime_device(
        self,
        client: TauriSession,
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
                if str((device or {}).get("actorPtid") or "") == expected_ptid
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
        restored_from: TauriSession | None = None,
        wait_for_device: bool = True,
    ) -> None:
        spec = self.client_specs[actor]
        actor_role = CLIENT_ACTOR_ROLES[actor]
        window_actors = tuple(CLIENT_ACTOR_ROLES)
        client = self.runtime_binding.create_bound_session(
            actor,
            NativeLaunchOptions(
                window_slot=window_actors.index(actor),
                window_count=len(window_actors),
            ),
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
        expected_ptid = str(self.actor_specs[actor_role].get("ptid") or "")
        self.client_lifecycles.register(client, expected_ptid)
        if restored_from is not None:
            self.client_lifecycles.transfer_preserved_session(
                restored_from,
                client,
            )
        try:
            self.client_lifecycles.mark_live(client)
            attempt["pid"] = client.process_id
            attempt["logPath"] = str(client.log_path or "")
            if client.process_id:
                self.runtime_pids.add(int(client.process_id))
            self.register_driver(client)
            if (
                actor == "alice"
                and self.reaction_transport_override is not None
            ):
                self.runtime_binding.apply_transport_override(
                    "alice",
                    "station",
                    self.reaction_transport_override,
                )
            if not restore_session:
                account_ref = str(
                    self.actor_specs[actor_role].get("accountRef") or ""
                )
                account = account_ref.removeprefix("station-account:")
                login = call_async_harness(
                    client,
                    "loginWithPassword",
                    {"account": account, "password": public_fixture_password()},
                    namespace="chat",
                    script_timeout=NATIVE_ACTOR_LOGIN_TIMEOUT_SECONDS,
                )
                if not (login or {}).get("authenticated"):
                    raise GateError(f"{actor} login did not authenticate")
                self.client_lifecycles.mark_authenticated(client)
                hydration = call_async_harness(
                    client,
                    "hydrateActiveActor",
                    {},
                    namespace="chat",
                    script_timeout=30,
                )
                ptid = str((hydration or {}).get("actorPtid") or "")
                if ptid != expected_ptid:
                    raise GateError(
                        f"{actor} login identity mismatch: "
                        f"expected={expected_ptid} actual={ptid}"
                    )
            else:
                self.client_lifecycles.mark_authenticated(client)
            ptid = expected_ptid
            device_id = ""
            if wait_for_device:
                device = self.wait_for_realtime_device(client, expected_ptid)
                ptid = str(device.get("actorPtid") or "")
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
                    runtime=self.runtime_binding.cell_id,
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
            cleanup_errors = self.client_lifecycles.release(client)
            if cleanup_errors and hasattr(error, "add_note"):
                error.add_note(
                    "Native product closure launch cleanup also failed: "
                    f"{json.dumps(cleanup_errors, sort_keys=True)}"
                )
            raise

    def stop_actor_for_restart(self, actor: str) -> None:
        self.client_lifecycles.stop_preserving_session(self.clients[actor])

    def restore_actor_after_restart(self, actor: str) -> None:
        predecessor = self.clients[actor]
        previous_device = self.device_ids[actor]
        self.launch_actor(
            actor,
            restore_session=True,
            restored_from=predecessor,
        )
        if self.device_ids[actor] != previous_device:
            raise GateError(f"{actor} device identity changed across restart")

    def restart_actor(self, actor: str) -> None:
        self.stop_actor_for_restart(actor)
        self.restore_actor_after_restart(actor)

    def capture_visible_localization(
        self,
        checkpoint: str,
        actors: tuple[str, ...],
    ) -> None:
        if checkpoint in self.localization_checks:
            raise GateError(f"duplicate localization checkpoint: {checkpoint}")
        snapshots: dict[str, list[str]] = {}
        for actor in actors:
            client = self.clients.get(actor)
            if client is None or not client.is_alive():
                raise GateError(
                    f"{checkpoint} localization client is not alive: {actor}"
                )
            visible_text = str(
                client.driver.execute_script(
                    "return document.body?.innerText || '';"
                )
                or ""
            )
            leaked = sorted(set(LOCALIZATION_KEY_PATTERN.findall(visible_text)))
            snapshots[actor] = leaked
        self.localization_checks[checkpoint] = snapshots

    def prove_visible_localization(
        self,
    ) -> dict[str, dict[str, list[str]]]:
        covered = {
            checkpoint: set(snapshots)
            for checkpoint, snapshots in self.localization_checks.items()
        }
        leaked_keys = {
            checkpoint: {
                actor: leaked
                for actor, leaked in snapshots.items()
                if leaked
            }
            for checkpoint, snapshots in self.localization_checks.items()
            if any(snapshots.values())
        }
        self.assert_condition(
            "visible_ui_has_no_i18n_keys",
            covered == REQUIRED_LOCALIZATION_CHECKPOINTS and not leaked_keys,
            json.dumps(
                {
                    "covered": {
                        checkpoint: sorted(actors)
                        for checkpoint, actors in covered.items()
                    },
                    "required": {
                        checkpoint: sorted(actors)
                        for checkpoint, actors
                        in REQUIRED_LOCALIZATION_CHECKPOINTS.items()
                    },
                    "leakedKeys": leaked_keys,
                },
                sort_keys=True,
            ),
        )
        return self.localization_checks

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

    def native_window(self, client: TauriSession) -> dict[str, float]:
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

    def native_content_origin(
        self,
        client: TauriSession,
    ) -> tuple[float, float]:
        process_id = client.process_id
        if process_id is None:
            raise GateError("Native content origin has no owning process")
        viewport = client.driver.execute_script(
            "return { width: innerWidth, height: innerHeight };"
        )
        window = self.native_window(client)
        content_origin = self.native_adapter.content_origin(process_id)
        if content_origin is not None:
            return content_origin
        return (
            window["left"]
            + max(
                0.0,
                (window["width"] - float(viewport["width"])) / 2,
            ),
            window["top"]
            + max(
                0.0,
                window["height"] - float(viewport["height"]),
            ),
        )

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
        source_path = file_path.resolve()
        if not source_path.is_file():
            raise GateError(f"Native file selection source is missing: {source_path}")
        selected_path = self.runtime_binding.stage_native_file(
            actor,
            source_path,
        )

        def native_app_baseline_ready(_: Any) -> NativeControlSnapshot | None:
            control = self.native_adapter.activate_and_focused_control(
                client.process_id or 0
            )
            return (
                control
                if control.window_count >= 1
                and control.main_window
                and control.frontmost
                and control.kind not in {"list", "text-field"}
                and control.kind != "application-dialog"
                else None
            )

        baseline_control = WebDriverWait(
            client.driver,
            NATIVE_FILE_TRANSITION_TIMEOUT_SECONDS,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(native_app_baseline_ready)
        self.click(actor, trigger_selector)

        def panel_open(control: NativeControlSnapshot) -> bool:
            return (
                control.window_count > baseline_control.window_count
                or control.dialog_count > baseline_control.dialog_count
                or (
                    control.kind in {"list", "text-field"}
                    and control.kind != baseline_control.kind
                )
            )

        def native_panel_ready(_: Any) -> NativeControlSnapshot | None:
            control = self.native_adapter.focused_control(client.process_id or 0)
            return control if panel_open(control) else None

        WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(native_panel_ready)

        def go_to_field_ready(_: Any) -> NativeControlSnapshot | None:
            control = self.native_adapter.focused_control(client.process_id or 0)
            return control if control.kind == "text-field" else None

        if self.native_adapter.platform == "win32":
            selected_control = (
                self.native_adapter.select_file_chooser_path_to_process(
                    client.process_id or 0,
                    str(selected_path),
                )
            )
            if selected_control is None or selected_control.dialog_count:
                raise GateError(
                    "Native file chooser selection was not committed"
                )
        else:
            revealed_control = (
                self.native_adapter.reveal_file_chooser_location_to_process(
                    client.process_id or 0
                )
            )
            if revealed_control is None:
                WebDriverWait(
                    client.driver,
                    10,
                    poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
                ).until(go_to_field_ready)
            elif revealed_control.kind != "text-field":
                raise GateError(
                    "Native file chooser reveal returned an invalid control: "
                    f"{revealed_control.to_dict()}"
                )

            original_clipboard = self.native_adapter.read_clipboard()
            try:
                selected_path_bytes = str(selected_path).encode("utf-8")
                self.native_adapter.write_clipboard(selected_path_bytes)
                if self.native_adapter.read_clipboard() != selected_path_bytes:
                    raise GateError(
                        "Native file chooser clipboard path did not round-trip"
                    )
                self.native_adapter.post_key_to_process(
                    client.process_id or 0,
                    NativeKey.A,
                    modifiers=(NativeModifier.PRIMARY,),
                )
                self.native_adapter.post_key_to_process(
                    client.process_id or 0,
                    NativeKey.V,
                    modifiers=(NativeModifier.PRIMARY,),
                )
                WebDriverWait(
                    client.driver,
                    10,
                    poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
                ).until(
                    lambda _: (
                        control
                        if (
                            (control := self.native_adapter.focused_control(
                                client.process_id or 0
                            )).kind
                            == "text-field"
                            and control.value == str(selected_path)
                        )
                        else None
                    )
                )
            finally:
                self.native_adapter.write_clipboard(original_clipboard)
            self.native_adapter.post_key_to_process(
                client.process_id or 0,
                NativeKey.ENTER,
                private_source=True,
            )

            def selection_or_browser_ready(
                _: Any,
            ) -> dict[str, object] | None:
                control = self.native_adapter.focused_control(
                    client.process_id or 0
                )
                if control.window_count < baseline_control.window_count:
                    return None
                if control.kind == "application-dialog":
                    return {"selected": False, "control": control}
                if panel_open(control) and control.kind != "text-field":
                    return {"selected": False, "control": control}
                if (
                    not panel_open(control)
                    and control.main_window
                    and control.frontmost
                    and control.focused_window
                ):
                    return {"selected": True, "control": control}
                return None

            intermediate = WebDriverWait(
                client.driver,
                NATIVE_FILE_TRANSITION_TIMEOUT_SECONDS,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(selection_or_browser_ready)

            if not intermediate["selected"]:
                self.native_adapter.post_key_to_process(
                    client.process_id or 0,
                    NativeKey.ENTER,
                    private_source=True,
                )

        baseline_window_count = baseline_control.window_count

        def native_window_restored(_: Any) -> NativeControlSnapshot | None:
            control = self.native_adapter.activate_and_focused_control(
                client.process_id or 0
            )
            return (
                control
                if control.window_count >= baseline_window_count
                and not panel_open(control)
                and control.main_window
                and control.frontmost
                and control.focused_window
                and control.kind != "application-dialog"
                else None
            )

        WebDriverWait(
            client.driver,
            NATIVE_FILE_TRANSITION_TIMEOUT_SECONDS,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(native_window_restored)
        self.focus_actor_window(actor)
        return {
            "name": source_path.name,
            "size": source_path.stat().st_size,
        }


    def install_native_input_probe(
        self,
        client: TauriSession,
        element: Any,
        *,
        selector: str | None = None,
        expected_point: tuple[float, float] | None = None,
    ) -> str:
        probe_id = secrets.token_hex(8)
        client.execute_script(
            """
            const target = arguments[0];
            const probeId = arguments[1];
            const selector = arguments[2];
            const expectedPoint = arguments[3];
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
            const documentEvents = [];
            const mutations = [];
            let deliveredPoint = null;
            const inspectSelector = () => selector
              ? Array.from(document.querySelectorAll(selector)).map((match) => {
                  const rect = match.getBoundingClientRect();
                  return {
                    connected: match.isConnected,
                    rect: {
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height,
                    },
                  };
                })
              : [];
            const inspectReactionStates = () => Array.from(
              document.querySelectorAll('[data-message-reaction-state]'),
            ).map((state) => ({
              phase: state.getAttribute('data-message-reaction-state') || '',
              emoji: state.getAttribute('data-message-reaction-emoji') || '',
              retryCount: state.querySelectorAll(
                '[data-message-reaction-retry]',
              ).length,
            }));
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
              const exactOwned = (
                eventTarget === target
                || (
                  eventTarget instanceof Node
                  && target.contains(eventTarget)
                )
              );
              const semanticOwned = Boolean(
                selector
                && eventTarget instanceof Element
                && eventTarget.closest(selector)
              );
              const targetOwned = exactOwned || semanticOwned;
              if (
                !deliveredPoint
                && targetOwned
                && ['pointermove', 'mousemove'].includes(event.type)
              ) {
                deliveredPoint = {
                  x: event.clientX,
                  y: event.clientY,
                };
              }
              const anchoredPoint = deliveredPoint || expectedPoint;
              const pointOwned = (
                !anchoredPoint
                || (
                  Math.abs(event.clientX - anchoredPoint.x) <= 2
                  && Math.abs(event.clientY - anchoredPoint.y) <= 2
                )
              );
              events.push({
                type: event.type,
                button: event.button,
                buttons: event.buttons,
                clientX: event.clientX,
                clientY: event.clientY,
                owned: pointOwned && targetOwned,
                target: describe(eventTarget),
              });
            };
            const documentListener = (event) => {
              documentEvents.push({
                type: event.type,
                button: event.button,
                buttons: event.buttons,
                clientX: event.clientX,
                clientY: event.clientY,
                target: describe(event.target),
                path: event.composedPath()
                  .filter((candidate) => candidate instanceof Element)
                  .slice(0, 8)
                  .map(describe),
              });
            };
            eventTypes.forEach((type) => {
              document.addEventListener(type, listener, true);
              window.addEventListener(type, documentListener, true);
            });
            const observer = new MutationObserver(() => {
              if (mutations.length >= 64) return;
              mutations.push({
                at: performance.now(),
                selectorMatches: inspectSelector(),
                reactionStates: inspectReactionStates(),
              });
            });
            observer.observe(document.body, {
              attributes: true,
              childList: true,
              subtree: true,
            });
            registry[probeId] = {
              events,
              documentEvents,
              selector,
              expectedPoint,
              snapshot: () => ({
                deliveredPoint,
                mutations,
                reactionStates: inspectReactionStates(),
                selectorMatches: inspectSelector(),
              }),
              cleanup: () => {
                observer.disconnect();
                eventTypes.forEach((type) => {
                  document.removeEventListener(type, listener, true);
                  window.removeEventListener(type, documentListener, true);
                });
                delete registry[probeId];
              },
            };
            """,
            element,
            probe_id,
            selector,
            (
                {"x": expected_point[0], "y": expected_point[1]}
                if expected_point is not None
                else None
            ),
        )
        return probe_id

    def wait_native_input_event(
        self,
        client: TauriSession,
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
            return native_input_event_cursor(events, event_type, after_index)

        try:
            return int(
                WebDriverWait(
                    client.driver,
                    5,
                    poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
                ).until(observed)
            )
        except Exception as error:
            snapshot = client.driver.execute_script(
                """
                const probe = window.__PT_NATIVE_INPUT_PROBES__?.[arguments[0]];
                const target = document.elementFromPoint(
                  innerWidth / 2,
                  innerHeight / 2
                );
                return {
                  activeElement: {
                    tag: document.activeElement?.tagName || '',
                    id: document.activeElement?.id || '',
                    classes: document.activeElement?.className || '',
                  },
                  documentEvents: probe?.documentEvents || [],
                  events: probe?.events || [],
                  hasFocus: document.hasFocus(),
                  probeSnapshot: probe?.snapshot?.() || null,
                  viewportCenterTarget: {
                    tag: target?.tagName || '',
                    id: target?.id || '',
                    classes: target?.className || '',
                  },
                };
                """,
                probe_id,
            )
            if isinstance(snapshot, dict):
                snapshot["waitException"] = {
                    "type": type(error).__name__,
                    "message": str(error),
                }
                final_cursor = native_input_event_cursor(
                    snapshot.get("events"),
                    event_type,
                    after_index,
                )
                if final_cursor is not None:
                    return final_cursor
            raise GateError(
                f"Native {event_type} was not acknowledged by the target DOM"
                ": "
                f"{json.dumps(snapshot, sort_keys=True, default=str)}"
            ) from error

    def remove_native_input_probe(
        self,
        client: TauriSession,
        probe_id: str,
    ) -> None:
        client.execute_script(
            """
            window.__PT_NATIVE_INPUT_PROBES__?.[arguments[0]]?.cleanup?.();
            """,
            probe_id,
        )

    def capture_native_activation_diagnostic(
        self,
        actor: str,
        client: TauriSession,
        point: tuple[float, float],
        phase: str,
    ) -> dict[str, Any]:
        try:
            document_focused: bool | str = bool(
                client.driver.execute_script("return document.hasFocus()")
            )
        except Exception as error:
            document_focused = f"{type(error).__name__}: {error}"
        window_stack = self.native_adapter.window_stack_at_point(point)
        snapshot = {
            "actor": actor,
            "phase": phase,
            "platform": self.native_adapter.platform,
            "expectedProcessId": client.process_id,
            "documentFocused": document_focused,
            "point": {"x": point[0], "y": point[1]},
            "pointOwned": window_stack.point_owned_by(client.process_id or 0),
            "window": self.native_window(client),
            "windowStack": window_stack.to_dict(),
            "focusedControl": self.native_adapter.focused_control(
                client.process_id or 0
            ).to_dict(),
        }
        self.native_activation_diagnostics.append(snapshot)
        return snapshot

    def focus_actor_window(self, actor: str) -> TauriSession:
        client = self.clients[actor]
        if client.process_id is None:
            raise GateError(f"{actor} Native window has no running process")

        window = self.native_window(client)
        point = (
            window["left"] + window["width"] / 2,
            window["top"] + 16,
        )

        def actor_window_owns_point() -> bool:
            return self.native_adapter.window_stack_at_point(
                point
            ).point_owned_by(client.process_id or 0)

        if (
            bool(client.driver.execute_script("return document.hasFocus()"))
            and actor_window_owns_point()
        ):
            return client
        self.capture_native_activation_diagnostic(
            actor,
            client,
            point,
            "before-activation",
        )
        if self.native_adapter.mouse_button_down():
            self.native_adapter.post_mouse((MouseAction.LEFT_UP,), point)
            WebDriverWait(
                client.driver,
                5,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(
                lambda _: not self.native_adapter.mouse_button_down()
            )
        try:
            WebDriverWait(
                client.driver,
                5,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(
                lambda _: actor_window_owns_point()
            )
        except TimeoutException:
            snapshot = self.capture_native_activation_diagnostic(
                actor,
                client,
                point,
                "point-ownership-timeout",
            )
            raise GateError(
                "Native actor window did not own the activation point: "
                f"{json.dumps(snapshot, sort_keys=True, default=str)}"
            ) from None
        cooperative_activation = (
            self.runtime_binding.request_cooperative_activation(
                client,
                tuple(self.clients.values()),
            )
        )
        if cooperative_activation:
            try:
                WebDriverWait(
                    client.driver,
                    5,
                    poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
                ).until(
                    lambda driver: bool(
                        driver.execute_script("return document.hasFocus()")
                    )
                )
            except TimeoutException:
                snapshot = self.capture_native_activation_diagnostic(
                    actor,
                    client,
                    point,
                    "cooperative-timeout",
                )
                raise GateError(
                    "Native cooperative activation timed out: "
                    f"{json.dumps(snapshot, sort_keys=True, default=str)}"
                ) from None
            return client
        else:
            self.capture_native_activation_diagnostic(
                actor,
                client,
                point,
                "before-fallback-activation",
            )
            self.native_adapter.activate_process(client.process_id)
        try:
            WebDriverWait(
                client.driver,
                5,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(
                lambda driver: bool(
                    driver.execute_script("return document.hasFocus()")
                )
            )
            return client
        except TimeoutException:
            pass

        focus_mouse_down = False
        try:
            self.native_adapter.post_mouse(
                (MouseAction.LEFT_DOWN,),
                point,
            )
            focus_mouse_down = True
            self.native_adapter.post_mouse(
                (MouseAction.LEFT_UP,),
                point,
            )
            focus_mouse_down = False
            WebDriverWait(
                client.driver,
                5,
                poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
            ).until(
                lambda driver: bool(driver.execute_script("return document.hasFocus()"))
            )
        except TimeoutException:
            snapshot = self.capture_native_activation_diagnostic(
                actor,
                client,
                point,
                "fallback-focus-timeout",
            )
            raise GateError(
                "Native actor window did not focus after activation: "
                f"{json.dumps(snapshot, sort_keys=True, default=str)}"
            ) from None
        finally:
            if focus_mouse_down:
                self.native_adapter.release_stuck_mouse_button(point)
        return client

    def click_element(self, actor: str, element: Any) -> Any:
        client = self.focus_actor_window(actor)
        return self._click_focused_element(client, element)

    def _resolve_native_click_surface(
        self,
        client: TauriSession,
        element: Any,
    ) -> Any:
        root_area = client.driver.execute_script(
            """
            const element = arguments[0];
            const rect = element.getBoundingClientRect();
            return rect.width * rect.height;
            """,
            element,
        )
        if float(root_area or 0) > 0:
            return element

        interactive_selector = (
            'button, [role="button"], a[href], input, select, textarea'
        )

        def visible_area(candidate: Any) -> float:
            area = client.driver.execute_script(
                """
                const candidate = arguments[0];
                const rect = candidate.getBoundingClientRect();
                const style = getComputedStyle(candidate);
                return (
                  rect.width > 0
                  && rect.height > 0
                  && style.visibility !== 'hidden'
                  && style.display !== 'none'
                  && !candidate.disabled
                ) ? rect.width * rect.height : 0;
                """,
                candidate,
            )
            return float(area or 0)

        interactive = [
            candidate
            for candidate in element.find_elements(
                By.CSS_SELECTOR,
                interactive_selector,
            )
            if visible_area(candidate) > 0
        ]
        if len(interactive) == 1:
            return interactive[0]

        root_is_interactive = bool(
            client.driver.execute_script(
                "return arguments[0].matches(arguments[1]);",
                element,
                interactive_selector,
            )
        )
        if not root_is_interactive:
            resolved = None
        else:
            surfaces: list[tuple[float, Any]] = []
            for candidate in element.find_elements(By.CSS_SELECTOR, "*"):
                area = client.driver.execute_script(
                    """
                    const root = arguments[0];
                    const candidate = arguments[1];
                    const rect = candidate.getBoundingClientRect();
                    const style = getComputedStyle(candidate);
                    if (
                      rect.width <= 0
                      || rect.height <= 0
                      || style.visibility === 'hidden'
                      || style.display === 'none'
                      || candidate.disabled
                    ) return 0;
                    const hit = document.elementFromPoint(
                      rect.left + rect.width / 2,
                      rect.top + rect.height / 2,
                    );
                    return hit && root.contains(hit)
                      ? rect.width * rect.height
                      : 0;
                    """,
                    element,
                    candidate,
                )
                if float(area or 0) > 0:
                    surfaces.append((float(area), candidate))
            resolved = max(surfaces, default=(0, None), key=lambda item: item[0])[1]
        if resolved is None:
            raise GateError(
                "Native click target has no unique interactive surface"
            )
        return resolved

    def _reveal_native_click_target(
        self,
        client: TauriSession,
        element: Any,
        *,
        selector: str | None,
    ) -> Any:
        element = self._resolve_native_click_surface(client, element)

        def center_is_in_view() -> bool:
            return bool(
                client.driver.execute_script(
                    """
                    const rect = arguments[0].getBoundingClientRect();
                    const viewport = window.visualViewport;
                    const left = viewport?.offsetLeft || 0;
                    const top = viewport?.offsetTop || 0;
                    const right = left + (viewport?.width || innerWidth);
                    const bottom = top + (viewport?.height || innerHeight);
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    return (
                      centerX >= left
                      && centerX < right
                      && centerY >= top
                      && centerY < bottom
                    );
                    """,
                    element,
                )
            )

        if not center_is_in_view():
            client.driver.execute_script(
                """
                arguments[0].scrollIntoView({
                  block: 'center',
                  inline: 'nearest',
                });
                """,
                element,
            )
            if selector is not None:
                element = client.find_element(selector, 30)
                element = self._resolve_native_click_surface(client, element)
            try:
                WebDriverWait(
                    client.driver,
                    5,
                    poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
                ).until(lambda _: center_is_in_view())
            except TimeoutException:
                raise GateError(
                    "Native click target did not enter the viewport"
                ) from None
        return element

    def _click_focused_element(
        self,
        client: TauriSession,
        element: Any,
        *,
        selector: str | None = None,
        native_origin: tuple[float, float] | None = None,
        focus_target: bool = True,
    ) -> Any:
        process_id = client.process_id
        if process_id is None:
            raise GateError("Native click target has no owning process")
        WebDriverWait(client.driver, 30).until(
            lambda _: element.is_displayed() and element.is_enabled()
        )
        element = self._reveal_native_click_target(
            client,
            element,
            selector=selector,
        )
        if focus_target:
            client.driver.execute_script(
                "arguments[0].focus({ preventScroll: true });",
                element,
            )
            if selector is not None:
                element = client.find_element(selector, 30)
                element = self._resolve_native_click_surface(client, element)
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
              devicePixelRatio,
              outerWidth,
              outerHeight,
              screenX,
              screenY,
              scrollX,
              scrollY,
              visualViewport: window.visualViewport ? {
                offsetLeft: window.visualViewport.offsetLeft,
                offsetTop: window.visualViewport.offsetTop,
                pageLeft: window.visualViewport.pageLeft,
                pageTop: window.visualViewport.pageTop,
                scale: window.visualViewport.scale,
                width: window.visualViewport.width,
                height: window.visualViewport.height,
              } : null,
            };
            """,
            element,
        )
        if not target.get("hit"):
            raise GateError(
                "Native click target center is occluded: "
                f"{json.dumps(target, sort_keys=True)}"
            )
        content_origin = native_origin or self.native_content_origin(client)
        if selector is not None:
            element = client.find_element(selector, 30)
            element = self._resolve_native_click_surface(client, element)
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
            content_origin[0] + float(current_target["x"]),
            content_origin[1] + float(current_target["y"]),
        )
        probe_id = self.install_native_input_probe(
            client,
            element,
            selector=selector,
            expected_point=(
                float(current_target["x"]),
                float(current_target["y"]),
            ),
        )
        mouse_down_posted = False
        try:
            cursor = 0
            mouse_down_posted = True
            self.native_adapter.post_mouse_to_process(
                process_id,
                (
                    MouseAction.MOVE,
                    MouseAction.LEFT_DOWN,
                    MouseAction.LEFT_UP,
                ),
                point,
            )
            mouse_down_posted = False
            cursor = self.wait_native_input_event(
                client,
                probe_id,
                "mousedown",
                cursor,
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
            if mouse_down_posted:
                self.native_adapter.release_stuck_mouse_button(point)
            self.remove_native_input_probe(client, probe_id)
        return element

    def click(self, actor: str, selector: str, timeout: float = 30) -> Any:
        client = self.focus_actor_window(actor)
        element = client.find_element(selector, timeout)
        return self._click_focused_element(
            client,
            element,
            selector=selector,
        )

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
            self.native_adapter.post_mouse(
                (MouseAction.MOVE,),
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

    def click_message_action(
        self,
        actor: str,
        message_id: str,
        action: str,
    ) -> Any:
        client = self.focus_actor_window(actor)
        native_origin = self.native_content_origin(client)
        toolbar = self.hover_message(actor, message_id)
        selector = MESSAGE_ACTION_SELECTORS.get(action)
        if selector is None:
            raise GateError(f"unsupported message action: {action}")
        element = toolbar.find_element(
            By.CSS_SELECTOR,
            selector,
        )
        return self._click_focused_element(
            client,
            element,
            native_origin=native_origin,
            focus_target=False,
        )

    def composer_send(self, actor: str, text: str = "") -> None:
        client = self.clients[actor]
        composer = client.find_element('[data-pt-text-input="chat-composer"]', 30)
        self.click_element(actor, composer)
        self.native_adapter.post_key(
            NativeKey.A,
            modifiers=(NativeModifier.PRIMARY,),
        )
        self.native_adapter.post_key(NativeKey.DELETE, private_source=True)
        WebDriverWait(client.driver, 5).until(
            lambda _: (composer.get_attribute("value") or "") == ""
        )
        if text:
            composer.send_keys(text)
            WebDriverWait(client.driver, 5).until(
                lambda _: (composer.get_attribute("value") or "") == text
            )
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

    def arm_conversation_search_feedback_probe(self, actor: str) -> None:
        self.clients[actor].execute_script(
            """
            window.__PT_CHAT_SEARCH_FEEDBACK_PROBE__?.cleanup?.();
            const selector = '[role="alert"], [role="alertdialog"], [role="status"]';
            const preexisting = new WeakSet(document.querySelectorAll(selector));
            const messages = [];
            const record = (candidate, requireVisible) => {
              if (!(candidate instanceof Element) || preexisting.has(candidate)) {
                return;
              }
              const bounds = candidate.getBoundingClientRect();
              const style = getComputedStyle(candidate);
              const text = (candidate.innerText || '').trim();
              const entry = {
                role: candidate.getAttribute('role') || '',
                text,
              };
              if (
                text
                && (
                  !requireVisible
                  || (
                    bounds.width > 0
                    && bounds.height > 0
                    && style.display !== 'none'
                    && style.visibility !== 'hidden'
                  )
                )
                && !messages.some(
                  (item) => item.role === entry.role && item.text === entry.text
                )
              ) {
                messages.push(entry);
              }
            };
            const capture = (records = []) => {
              for (const mutation of records) {
                for (const node of mutation.addedNodes || []) {
                  if (!(node instanceof Element)) continue;
                  if (node.matches(selector)) record(node, false);
                  for (const candidate of node.querySelectorAll(selector)) {
                    record(candidate, false);
                  }
                }
              }
              for (const candidate of document.querySelectorAll(selector)) {
                record(candidate, true);
              }
            };
            const observer = new MutationObserver(capture);
            observer.observe(document.body, {
              attributes: true,
              childList: true,
              subtree: true,
            });
            window.__PT_CHAT_SEARCH_FEEDBACK_PROBE__ = {
              messages,
              cleanup: () => observer.disconnect(),
            };
            """
        )

    def conversation_search_feedback(
        self,
        actor: str,
    ) -> list[dict[str, str]]:
        value = self.clients[actor].execute_script(
            """
            const probe = window.__PT_CHAT_SEARCH_FEEDBACK_PROBE__;
            const messages = Array.from(probe?.messages || []);
            probe?.cleanup?.();
            delete window.__PT_CHAT_SEARCH_FEEDBACK_PROBE__;
            return messages;
            """
        )
        return (
            [
                {
                    "role": str(item.get("role") or ""),
                    "text": str(item.get("text") or ""),
                }
                for item in value
                if isinstance(item, dict)
            ]
            if isinstance(value, list)
            else []
        )

    def search_contact_result(
        self,
        actor: str,
        peer_ptid: str,
        localization_checkpoint: str,
    ) -> dict[str, str]:
        client = self.clients[actor]
        search = client.find_element("[data-chat-session-search]", 30)
        self.click_element(actor, search)
        self.native_adapter.post_key(
            NativeKey.A,
            modifiers=(NativeModifier.PRIMARY,),
        )
        self.native_adapter.post_key(NativeKey.DELETE, private_source=True)
        WebDriverWait(client.driver, 5).until(
            lambda _: (search.get_attribute("value") or "") == ""
        )
        search.send_keys("bob")
        WebDriverWait(client.driver, 5).until(
            lambda _: (search.get_attribute("value") or "").lower() == "bob"
        )
        selector = (
            '[data-chat-search-result-kind="friend"]'
            f'[data-chat-search-result-peer-ptid="{peer_ptid}"]'
        )

        def exact_result() -> Any | None:
            matches = client.find_elements(selector)
            return matches[0] if len(matches) == 1 else None

        result = wait_until(
            exact_result,
            f"{actor} exact search result for {peer_ptid}",
            timeout=30,
        )
        snapshot = {
            "id": result.get_attribute("data-chat-search-result-id") or "",
            "kind": result.get_attribute("data-chat-search-result-kind") or "",
            "peerPtid": (
                result.get_attribute("data-chat-search-result-peer-ptid") or ""
            ),
        }
        # #region debug-point A-C:search-result-selection
        client.execute_script(
            """
            const selector = arguments[0];
            const state = window.__PT_DIRECT_OPEN_DEBUG__ = { events: [] };
            window.addEventListener('pt:direct-open-debug', (event) => {
              if (event instanceof CustomEvent && event.detail) {
                state.events.push(event.detail);
              }
            });
            document.addEventListener('click', (event) => {
              const target = event.target instanceof Element
                ? event.target.closest(selector)
                : null;
              if (target) {
                state.events.push({
                  kind: 'search-result-click',
                  peerPtid: target.getAttribute(
                    'data-chat-search-result-peer-ptid',
                  ) || '',
                });
              }
            }, { capture: true, once: true });
            const internals = window.__TAURI_INTERNALS__;
            if (internals?.invoke && !internals.__ptDirectOpenOriginalInvoke) {
              const original = internals.invoke.bind(internals);
              internals.__ptDirectOpenOriginalInvoke = original;
              internals.invoke = (command, args) => {
                if (command !== 'messaging_create_direct') {
                  return original(command, args);
                }
                state.events.push({ kind: 'create-direct-start' });
                return Promise.resolve(original(command, args)).then(
                  (value) => {
                    state.events.push({
                      kind: 'create-direct-success',
                      conversationId:
                        value?.data?.conversation_id
                        || value?.conversation_id
                        || '',
                    });
                    return value;
                  },
                  (error) => {
                    state.events.push({
                      kind: 'create-direct-failure',
                      error: String(error?.message || error || ''),
                    });
                    throw error;
                  },
                );
              };
            }
            """,
            selector,
        )
        _debug_report(
            "A",
            "native_product_closure_runner.py:search_contact_result",
            "exact search result ready for native click",
            {
                "actor": actor,
                "kind": snapshot["kind"],
                "peerPtidSha256": hashlib.sha256(
                    snapshot["peerPtid"].encode("utf-8")
                ).hexdigest(),
            },
        )
        self.capture_visible_localization(localization_checkpoint, (actor,))
        self.arm_conversation_search_feedback_probe(actor)
        self.click(actor, selector)
        observed = client.execute_script(
            """
            const search = document.querySelector('[data-chat-session-search]');
            return {
              events: window.__PT_DIRECT_OPEN_DEBUG__?.events || [],
              paneCount: document.querySelectorAll(
                '[data-chat-conversation-pane]',
              ).length,
              searchValue: search?.value || '',
            };
            """
        )
        _debug_report(
            "A-C",
            "native_product_closure_runner.py:search_contact_result",
            "native click observation",
            observed if isinstance(observed, dict) else {},
        )
        # #endregion
        return snapshot

    def active_direct_conversation(
        self,
        actor: str,
    ) -> dict[str, Any] | None:
        client = self.clients[actor]
        panes = client.find_elements("[data-chat-conversation-pane]")
        if len(panes) != 1:
            return None
        conversation_id = (
            panes[0].get_attribute("data-chat-conversation-pane") or ""
        )
        composers = client.find_elements(
            f'[data-chat-composer="{conversation_id}"] '
            '[data-pt-text-input="chat-composer"]'
        )
        session_rows = client.find_elements(
            f'[data-chat-session-ulid="{conversation_id}"]'
        )
        searches = client.find_elements("[data-chat-session-search]")
        return (
            {
                "conversationId": conversation_id,
                "securityState": (
                    panes[0].get_attribute("data-session-security") or ""
                ),
                "sessionRows": len(session_rows),
                "searchValue": (
                    searches[0].get_attribute("value") if searches else None
                ),
            }
            if (
                conversation_id
                and len(composers) == 1
                and len(session_rows) == 1
                and len(searches) == 1
                and (searches[0].get_attribute("value") or "") == ""
            )
            else None
        )

    def prove_conversation_search_open(self) -> dict[str, Any]:
        actor = "alice"
        peer_ptid = self.ptids["bob"]
        self.enter_chat_page(actor)
        self.click(actor, '[data-chat-subpage="chats"]')

        first_result = self.search_contact_result(
            actor,
            peer_ptid,
            "search-result-create",
        )
        # #region debug-point C-E:conversation-open-result
        try:
            first_open = wait_until(
                lambda: self.active_direct_conversation(actor),
                "Alice Direct conversation from first search result",
                timeout=120,
            )
        except GateError:
            client = self.clients[actor]
            failure = client.execute_script(
                """
                const search = document.querySelector(
                  '[data-chat-session-search]',
                );
                return {
                  events: window.__PT_DIRECT_OPEN_DEBUG__?.events || [],
                  paneCount: document.querySelectorAll(
                    '[data-chat-conversation-pane]',
                  ).length,
                  sessionIds: Array.from(
                    document.querySelectorAll('[data-chat-session-ulid]'),
                  ).map((row) => row.getAttribute('data-chat-session-ulid')),
                  searchValue: search?.value || '',
                };
                """
            )
            feedback = self.conversation_search_feedback(actor)
            _debug_report(
                "C-E",
                "native_product_closure_runner.py:prove_conversation_search_open",
                "direct conversation did not become visible",
                {
                    "state": failure if isinstance(failure, dict) else {},
                    "feedback": feedback,
                },
            )
            self.save_screenshot(client, "alice-direct-search-failed")
            self.save_dom(client, "alice-direct-search-failed")
            raise
        # #endregion
        first_feedback = self.conversation_search_feedback(actor)
        self.save_screenshot(
            self.clients[actor],
            "alice-direct-search-first",
        )
        self.save_dom(self.clients[actor], "alice-direct-search-first")

        second_result = self.search_contact_result(
            actor,
            peer_ptid,
            "search-result-reuse",
        )
        second_open = wait_until(
            lambda: self.active_direct_conversation(actor),
            "Alice Direct conversation from repeated search result",
            timeout=30,
        )
        second_feedback = self.conversation_search_feedback(actor)
        self.save_screenshot(
            self.clients[actor],
            "alice-direct-search-second",
        )
        self.save_dom(self.clients[actor], "alice-direct-search-second")

        feedback = first_feedback + second_feedback
        forbidden_feedback = [
            item
            for item in feedback
            if (
                item["role"] in {"alert", "alertdialog"}
                or "error.unknown" in item["text"].lower()
                or "conversation action failed" in item["text"].lower()
                or LOCALIZATION_KEY_PATTERN.search(item["text"])
            )
        ]
        evidence = {
            "peerPtid": peer_ptid,
            "firstResult": first_result,
            "firstOpen": first_open,
            "secondResult": second_result,
            "secondOpen": second_open,
            "feedback": feedback,
            "forbiddenFeedback": forbidden_feedback,
        }
        first_conversation_id = str(first_open["conversationId"])
        second_conversation_id = str(second_open["conversationId"])
        self.assert_condition(
            "conversation_search_open_exact",
            first_result == {
                "id": peer_ptid,
                "kind": "friend",
                "peerPtid": peer_ptid,
            }
            and first_conversation_id != peer_ptid
            and second_result == {
                "id": first_conversation_id,
                "kind": "friend",
                "peerPtid": peer_ptid,
            }
            and second_conversation_id == first_conversation_id
            and not forbidden_feedback,
            json.dumps(evidence, sort_keys=True),
        )
        self.capture_visible_localization("direct-open", ("alice",))
        return evidence

    def open_group_through_ui(self) -> str:
        for actor in ("alice", "bob"):
            self.enter_chat_page(actor)
        self.click("alice", '[data-chat-subpage="chats"]')
        self.click("alice", "[data-chat-new-menu]")
        self.click("alice", "[data-chat-create-group-menu]")
        client = self.clients["alice"]
        client.find_element("[data-chat-create-group]", 20)
        contact_selector = (
            f'[data-chat-create-group-contact="{self.ptids["bob"]}"]'
        )
        self.click(
            "alice",
            contact_selector,
        )
        wait_until(
            lambda: next(
                (
                    contact
                    for contact in client.find_elements(contact_selector)
                    if contact.get_attribute("aria-pressed") == "true"
                ),
                None,
            ),
            "Alice selected Bob for group creation",
            timeout=10,
        )
        submit_selector = "[data-chat-create-group-submit]"
        wait_until(
            lambda: next(
                (
                    submit
                    for submit in client.find_elements(submit_selector)
                    if submit.is_enabled()
                ),
                None,
            ),
            "Alice enabled group creation submit",
            timeout=10,
        )
        # #region debug-point E-H:group-create-committed-selection
        _debug_report(
            "E-H",
            "native_product_closure_runner.py:open_group_through_ui",
            "group contact selection committed before submit",
            {
                "contactPressed": True,
                "submitEnabled": True,
            },
        )
        # #endregion
        self.capture_visible_localization("group-create", ("alice",))
        self.click("alice", submit_selector)

        def active_group() -> str | None:
            pane = client.find_element(
                "[data-chat-conversation-pane]",
                30,
            )
            group_id = pane.get_attribute("data-chat-conversation-pane") or ""
            kind = pane.get_attribute("data-group-security")
            return group_id if group_id and kind == "ready" else None

        try:
            group_id = wait_until(
                active_group,
                "Alice active MLS group",
                timeout=180,
            )
        except GateError:
            diagnostics = client.execute_script(
                """
                const panes = Array.from(
                  document.querySelectorAll('[data-chat-conversation-pane]'),
                );
                const submit = document.querySelector(
                  '[data-chat-create-group-submit]',
                );
                return {
                  modalCount: document.querySelectorAll(
                    '[data-chat-create-group]',
                  ).length,
                  paneStates: panes.map((pane) => ({
                    conversationId:
                      pane.getAttribute('data-chat-conversation-pane') || '',
                    groupSecurity:
                      pane.getAttribute('data-group-security') || '',
                  })),
                  submitDisabled: submit instanceof HTMLButtonElement
                    ? submit.disabled
                    : null,
                };
                """
            )
            # #region debug-point E-H:group-create-timeout
            _debug_report(
                "E-H",
                "native_product_closure_runner.py:open_group_through_ui",
                "group conversation did not become active",
                diagnostics if isinstance(diagnostics, dict) else {},
            )
            # #endregion
            self.save_screenshot(client, "alice-group-create-failed")
            self.save_dom(client, "alice-group-create-failed")
            raise
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
        self.capture_visible_localization("group-open", ("alice", "bob"))
        return str(group_id)

    def transcript(self, actor: str) -> list[dict[str, Any]]:
        value = self.clients[actor].execute_script(
            """
            return Array.from(document.querySelectorAll('[data-message-ulid]'))
              .map((row) => ({
                id: row.getAttribute('data-message-ulid') || '',
                sequence: Number(row.getAttribute('data-message-authority-sequence') || 0),
                content: row.querySelector('[data-message-text]')?.innerText || '',
                attachmentCount: Number(row.getAttribute('data-message-attachment-count') || 0),
              }))
              .sort((a, b) => (a.sequence - b.sequence) || a.id.localeCompare(b.id));
            """
        )
        return value if isinstance(value, list) else []

    def engine_messages(self, actor: str, conversation_id: str) -> list[dict[str, Any]]:
        value = call_async_harness(
            self.clients[actor],
            "engineMessages",
            {
                "actorPtid": self.ptids[actor],
                "conversationId": conversation_id,
            },
            namespace="chat",
            script_timeout=30,
        ).get("messages")
        return value if isinstance(value, list) else []

    def engine_conversations(self, actor: str) -> list[dict[str, Any]]:
        value = call_async_harness(
            self.clients[actor],
            "engineConversations",
            {"actorPtid": self.ptids[actor]},
            namespace="chat",
            script_timeout=30,
        )
        conversations = (
            value.get("conversations")
            if isinstance(value, dict)
            else None
        )
        return conversations if isinstance(conversations, list) else []

    def member_settings(
        self,
        actor: str,
        conversation_id: str,
    ) -> dict[str, Any]:
        value = call_async_harness(
            self.clients[actor],
            "conversationMemberSettings",
            {
                "actorPtid": self.ptids[actor],
                "conversationId": conversation_id,
            },
            namespace="chat",
            script_timeout=30,
        )
        if not isinstance(value, dict):
            raise GateError(
                "conversationMemberSettings returned invalid window-owned "
                "readback"
            )
        settings = value.get("settings")
        if not isinstance(settings, dict):
            raise GateError(
                "conversationMemberSettings returned invalid settings"
            )
        return settings

    def open_attachment(self, actor: str, attachment_id: str) -> Path:
        value = call_async_harness(
            self.clients[actor],
            "openAttachment",
            {
                "actorPtid": self.ptids[actor],
                "attachmentId": attachment_id,
            },
            namespace="chat",
            script_timeout=30,
        )
        local_path = (
            str(value.get("localPath") or "")
            if isinstance(value, dict)
            else ""
        )
        if not local_path:
            raise GateError(
                "openAttachment returned invalid window-owned readback"
            )
        return Path(local_path)

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
        self.click_message_action(actor, root_id, "thread")
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

        self.click_message_action("alice", str(bob_root["id"]), "reply")
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
        self.click_message_action("alice", str(bob_root["id"]), "thread")
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
        self.capture_visible_localization("thread", ("alice",))
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

    def prove_keyboard_reaction_picker(self, actor: str, message_id: str) -> str:
        client = self.focus_actor_window(actor)
        if client.process_id is None:
            raise GateError(f"{actor} Native window has no running process")
        process_id = client.process_id
        # #region debug-point V-X:reaction-keyboard-lifecycle
        client.execute_script(
            """
            window.__PT_REACTION_KEYBOARD_DEBUG__?.dispose?.();
            const controller = new AbortController();
            const state = {
              events: [],
              dispose: () => controller.abort(),
            };
            const describe = (element) => ({
              action: element?.getAttribute?.('data-message-action') || '',
              emoji: element?.getAttribute?.('data-reaction-emoji') || '',
              overlay: element?.closest?.('[data-message-action-overlay]')
                ?.getAttribute('data-message-action-overlay') || '',
              tag: element?.tagName || '',
            });
            const record = (kind, event = null) => {
              const active = document.activeElement;
              const overlay = document.querySelector(
                '[data-message-action-overlay]',
              );
              state.events.push({
                active: describe(active),
                eventKey: event?.key || '',
                kind,
                overlayKind: overlay?.getAttribute(
                  'data-message-action-overlay',
                ) || '',
                overlayLabel: overlay?.getAttribute('aria-label') || '',
                target: describe(event?.target),
                ts: Date.now(),
              });
            };
            for (const kind of [
              'keydown',
              'keyup',
              'click',
              'focusin',
              'focusout',
            ]) {
              document.addEventListener(
                kind,
                (event) => record(kind, event),
                { capture: true, signal: controller.signal },
              );
            }
            const observer = new MutationObserver(() => record('mutation'));
            observer.observe(document.body, {
              attributes: true,
              attributeFilter: ['data-message-action-overlay'],
              childList: true,
              subtree: true,
            });
            const dispose = state.dispose;
            state.dispose = () => {
              observer.disconnect();
              dispose();
            };
            window.__PT_REACTION_KEYBOARD_DEBUG__ = state;
            record('instrumented');
            """
        )
        keyboard_debug_script = """
            const state = window.__PT_REACTION_KEYBOARD_DEBUG__;
            const active = document.activeElement;
            const overlay = document.querySelector(
              '[data-message-action-overlay]',
            );
            return {
              activeAction: active?.getAttribute(
                'data-message-action',
              ) || '',
              activeEmoji: active?.getAttribute(
                'data-reaction-emoji',
              ) || '',
              activeTag: active?.tagName || '',
              events: state?.events || [],
              overlayKind: overlay?.getAttribute(
                'data-message-action-overlay',
              ) || '',
              overlayLabel: overlay?.getAttribute('aria-label') || '',
            };
        """
        # #endregion
        row = client.find_element(f'[data-message-ulid="{message_id}"]', 20)
        client.execute_script(
            "arguments[0].focus({ preventScroll: true });",
            row,
        )
        WebDriverWait(client.driver, 15).until(
            lambda driver: bool(
                driver.execute_script(
                    """
                    const row = arguments[0];
                    const toolbar = document.querySelector(
                      `[data-message-action-overlay="toolbar"]`
                      + `[data-message-action-message="${arguments[1]}"]`
                    );
                    return document.activeElement === row && Boolean(toolbar);
                    """,
                    row,
                    message_id,
                )
            )
        )
        # #region debug-point V-X:reaction-keyboard-lifecycle
        _debug_report(
            "V-X",
            "native_product_closure_runner.py:reaction_sequence_ready",
            "message row is ready for one native keyboard sequence",
            client.execute_script(keyboard_debug_script),
        )
        # #endregion
        self.native_adapter.post_key_sequence_to_process(
            process_id,
            (
                NativeKey.ENTER,
                NativeKey.TAB,
                NativeKey.ENTER,
                NativeKey.ENTER,
            ),
            interval_seconds=NATIVE_KEY_SEQUENCE_INTERVAL_SECONDS,
            private_source=True,
        )
        try:
            selected_emoji = WebDriverWait(client.driver, 15).until(
                lambda driver: driver.execute_script(
                    """
                    const events = window.__PT_REACTION_KEYBOARD_DEBUG__?.events || [];
                    return events
                      .filter(
                        (event) => event.kind === 'click' && event.target?.emoji,
                      )
                      .at(-1)?.target?.emoji || '';
                    """
                )
            )
        except TimeoutException:
            # #region debug-point V-X:reaction-keyboard-lifecycle
            _debug_report(
                "V-X",
                "native_product_closure_runner.py:reaction_selection_timeout",
                "reaction picker did not complete keyboard selection",
                client.execute_script(keyboard_debug_script),
            )
            # #endregion
            raise
        snapshot = client.execute_script(keyboard_debug_script)
        picker_events = [
            event
            for event in snapshot.get("events", [])
            if event.get("overlayKind") == "reaction-picker"
        ]
        picker_labels = [
            str(event.get("overlayLabel") or "")
            for event in picker_events
            if event.get("overlayLabel")
        ]
        if not picker_events or not selected_emoji:
            # #region debug-point V-X:reaction-keyboard-lifecycle
            _debug_report(
                "V-X",
                "native_product_closure_runner.py:reaction_selection_timeout",
                "reaction picker did not complete keyboard selection",
                snapshot,
            )
            # #endregion
            raise GateError("reaction picker keyboard selection was not observed")
        # #region debug-point V-X:reaction-keyboard-lifecycle
        _debug_report(
            "V-X",
            "native_product_closure_runner.py:reaction_keyboard_selected",
            "reaction picker completed keyboard selection",
            snapshot,
        )
        # #endregion
        self.assert_condition(
            "toolbar_keyboard_reachable",
            True,
            json.dumps(snapshot, sort_keys=True),
        )
        self.assert_condition(
            "reaction_picker_localized",
            bool(picker_labels)
            and all(
                not LOCALIZATION_KEY_PATTERN.search(label)
                for label in picker_labels
            ),
            json.dumps(picker_labels, sort_keys=True),
        )
        self.localization_checks.setdefault("reaction-picker", {})[actor] = []
        return str(selected_emoji)

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
        success_emoji = self.prove_keyboard_reaction_picker(
            "alice",
            message_id,
        )
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

        proxy = self.reaction_proxy
        if proxy is None:
            raise GateError("reaction fault proxy is not running")
        try:
            proxy.arm_connection_loss()
            failure_emoji = self.prove_keyboard_reaction_picker(
                "alice",
                message_id,
            )

            def actionable_error() -> bool:
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
                return bool(error_surfaces and controlled_loss)

            wait_until(
                actionable_error,
                "reaction actionable error",
                timeout=30,
            )
            self.capture_visible_localization("reaction-error", ("alice",))
            if self.reaction_visible("alice", message_id, failure_emoji):
                raise GateError("failed reaction remained as terminal optimistic state")
            proxy.disarm()
            wait_until(
                lambda: self.reaction_visible("alice", message_id, failure_emoji)
                and self.reaction_visible("bob", message_id, failure_emoji),
                "reaction automatic retry convergence",
                timeout=120,
            )
            wait_until(
                lambda: (
                    not self.clients["alice"].find_elements(
                        f'[data-message-ulid="{message_id}"] '
                        "[data-message-reaction-state]"
                    )
                ),
                "reaction recovery state cleared",
                timeout=30,
            )
            proxy_evidence = proxy.evidence()
            command_hashes = proxy_evidence.get("commandSha256") or []
            forwarded_paths = proxy_evidence.get("forwardedPaths") or {}
            if (
                len(command_hashes) < 2
                or len(set(command_hashes)) != 1
                or int(forwarded_paths.get("/conversation/command") or 0) < 1
            ):
                raise GateError(
                    "reaction exact retry was not proven through the fault proxy: "
                    f"{json.dumps(proxy_evidence, sort_keys=True)}"
                )
            engine: dict[str, list[dict[str, str]]] = {}
            for actor in ("alice", "bob"):
                def reaction_readback(actor: str = actor) -> list[dict[str, str]] | None:
                    message = next(
                        (
                            item
                            for item in self.engine_messages(actor, conversation_id)
                            if (
                                item.get("message_id")
                                or item.get("messageId")
                            )
                            == message_id
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
                "proxy": proxy_evidence,
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
                const url = new URL(src, document.baseURI);
                canonical = `${url.pathname}${url.search}`;
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
            self.click_message_action(actor, thread_root_id, "thread")
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
        slot_identity = {
            actor: [
                {
                    "ptid": slot["ptid"],
                    "src": slot["src"],
                    "canonical": slot["canonical"],
                    "loaded": slot["loaded"],
                }
                for slot in slots
            ]
            for actor, slots in slot_sets.items()
        }
        self.assert_condition(
            "group_avatar_slots_exact",
            slot_identity["alice"] == slot_identity["bob"]
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
            conversations = self.engine_conversations(actor)
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
        self.capture_visible_localization("identity", ("alice", "bob"))

    def setting_state(self, actor: str) -> dict[str, Any]:
        panel = self.open_details(actor)
        value = self.clients[actor].execute_script(
            """
            const panel = arguments[0];
            return {
              muted: panel.getAttribute('data-chat-detail-muted') || '',
              pinned: panel.getAttribute('data-chat-detail-pinned') || '',
              background: panel.getAttribute('data-chat-detail-background') || '',
              backgroundImage: panel.getAttribute('data-chat-detail-background-image') || '',
              pending: panel.getAttribute('data-chat-detail-action-pending') || '',
              backgroundRetry:
                panel.getAttribute('data-chat-detail-background-retry') || '',
            };
            """,
            panel,
        )
        return value

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
                errored: false,
                width: 0,
                height: 0,
              };
              const image = new Image();
              const capture = (errored = false) => {
                state.loaded = image.complete && image.naturalWidth > 0;
                state.errored = errored;
                state.width = image.naturalWidth;
                state.height = image.naturalHeight;
              };
              image.onload = () => capture();
              image.onerror = () => capture(true);
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
              const dialog = select.closest('[role="dialog"]');
              if (!dialog) return false;
              const style = getComputedStyle(dialog);
              const rect = dialog.getBoundingClientRect();
              return (
                style.display !== 'none'
                && style.visibility !== 'hidden'
                && style.pointerEvents !== 'none'
                && rect.width > 0
                && rect.height > 0
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

    def wait_for_dialogs_to_stop_intercepting(self, actor: str) -> None:
        client = self.clients[actor]
        WebDriverWait(
            client.driver,
            10,
            poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS,
        ).until(
            lambda driver: bool(
                driver.execute_script(
                    """
                    return !Array.from(
                      document.querySelectorAll('[role="dialog"]')
                    ).some((dialog) => {
                      const style = getComputedStyle(dialog);
                      const rect = dialog.getBoundingClientRect();
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
            ),
            "dialog remained hit-testable after dismissal",
        )

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
        self.capture_visible_localization("background-picker", (actor,))
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
        self.capture_visible_localization("background-failure", ("alice",))
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
        self.runtime_binding.stage_native_file("alice", empty_image)
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

        normalized = self.member_settings("alice", group_id)
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
        self.capture_visible_localization("settings", ("alice",))
        self.wait_for_dialogs_to_stop_intercepting("alice")
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
        draft_id = draft.get_attribute("data-chat-attachment-draft") or ""
        staged_attempt = int(
            draft.get_attribute("data-chat-attachment-attempt") or 0
        )
        preview = draft.get_attribute("data-chat-attachment-preview") or ""
        staged_ids = [item["id"] for item in self.transcript("alice")]
        if before_ids != staged_ids:
            raise GateError("failed attachment staging created an empty message")
        buttons = draft.find_elements(By.TAG_NAME, "button")
        if len(buttons) < 2:
            raise GateError(
                "failed attachment draft must expose retry and remove controls"
            )
        self.capture_visible_localization("attachment-failure", ("alice",))
        self.click_element("alice", buttons[0])
        retained = wait_until(
            lambda: (
                items[0]
                if (
                    items := self.clients["alice"].find_elements(
                        f'[data-chat-attachment-draft="{draft_id}"]'
                        '[data-chat-attachment-status="failed"]'
                    )
                )
                and int(
                    items[0].get_attribute(
                        "data-chat-attachment-attempt"
                    )
                    or 0
                )
                > staged_attempt
                else None
            ),
            "failed attachment draft retained after retry",
            timeout=30,
        )
        retained_buttons = retained.find_elements(By.TAG_NAME, "button")
        retained_preview = (
            retained.get_attribute("data-chat-attachment-preview") or ""
        )
        after_retry_ids = [item["id"] for item in self.transcript("alice")]
        evidence = {
            "draftId": draft_id,
            "preview": preview,
            "retainedPreview": retained_preview,
            "stagedAttempt": staged_attempt,
            "retainedAttempt": int(
                retained.get_attribute("data-chat-attachment-attempt") or 0
            ),
            "beforeMessageIds": before_ids,
            "stagedMessageIds": staged_ids,
            "afterRetryMessageIds": after_retry_ids,
            "recoveryControlCount": len(buttons),
            "retainedRecoveryControlCount": len(retained_buttons),
            "retainedStatus": retained.get_attribute(
                "data-chat-attachment-status"
            ),
        }
        self.assert_condition(
            "attachment_failure_draft_retained",
            bool(draft_id)
            and bool(preview)
            and retained_preview == preview
            and evidence["retainedAttempt"] > staged_attempt
            and before_ids == staged_ids == after_retry_ids
            and evidence["retainedStatus"] == "failed"
            and len(buttons) >= 2
            and len(retained_buttons) >= 2,
            json.dumps(evidence, sort_keys=True),
        )
        self.click_element("alice", retained_buttons[1])
        wait_until(
            lambda: not self.clients["alice"].find_elements(
                f'[data-chat-attachment-draft="{draft_id}"]'
            ),
            "failed attachment draft removed before the success journey",
            timeout=30,
        )
        self.wait_for_dialogs_to_stop_intercepting("alice")

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
              content: row.querySelector('[data-message-text]')?.innerText || '',
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
        preview_snapshot = self.clients["alice"].execute_script(
            """
            const image = arguments[0];
            const draft = image.closest('[data-chat-attachment-draft]');
            return {
              complete: image.complete,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              src: image.getAttribute('src') || '',
              currentSrc: image.currentSrc || '',
              draftId: draft?.getAttribute('data-chat-attachment-draft') || '',
              draftStatus: draft?.getAttribute('data-chat-attachment-status') || '',
              draftPreview: draft?.getAttribute('data-chat-attachment-preview') || '',
            };
            """,
            preview,
        )
        if not (
            isinstance(preview_snapshot, dict)
            and preview_snapshot.get("complete") is True
            and int(preview_snapshot.get("naturalWidth") or 0) > 0
        ):
            resource_snapshot = self.clients["alice"].execute_script(
                """
                const url = arguments[0];
                const request = new XMLHttpRequest();
                try {
                  request.open('GET', url, false);
                  request.send();
                  return {
                    ok: request.status >= 200 && request.status < 300,
                    status: request.status,
                    contentType: request.getResponseHeader('content-type') || '',
                    byteLength: request.responseText.length,
                  };
                } catch (error) {
                  return {
                    ok: false,
                    errorName: error?.name || '',
                    errorMessage: error?.message || String(error),
                  };
                }
                """,
                str(preview_snapshot.get("currentSrc") or ""),
            )
            raise GateError(
                "Composer image preview did not load: "
                f"{json.dumps({'image': preview_snapshot, 'resource': resource_snapshot}, sort_keys=True)}"
            )
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
                        if (
                            item.get("message_id")
                            or item.get("messageId")
                        )
                        == expectation["messageId"]
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
                    str(
                        attachment.get("attachment_id")
                        or attachment.get("attachmentId")
                        or ""
                    )
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
                    attachment_id = str(
                        attachment.get("attachment_id")
                        or attachment.get("attachmentId")
                        or ""
                    )
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
                    local_path = self.open_attachment(actor, attachment_id)
                    actor_hashes[filename] = (
                        self.runtime_binding.native_file_sha256(
                            actor,
                            local_path,
                        )
                    )
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
        self.capture_visible_localization("attachments", ("alice", "bob"))
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
            self.write_json_evidence("offline-before-divergence", before)
            raise GateError(
                "Alice and Bob diverged before offline recovery: "
                f"{json.dumps(before, sort_keys=True)}"
            )

        self.stop_actor_for_restart("bob")
        offline_text = f"w13-offline-{os.getpid()}"
        self.composer_send("alice", offline_text)
        self.wait_message_text("alice", offline_text)

        self.restore_actor_after_restart("bob")
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
        self.capture_visible_localization("offline", ("alice", "bob"))
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
        normalized_station = self.member_settings("alice", group_id)
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
        self.capture_visible_localization("restart", ("alice", "bob"))
        self.write_json_evidence("restart-detail-ready", result)
        return result

    def click_confirmation(self, actor: str) -> None:
        def visible_confirmation() -> Any | None:
            buttons = self.clients[actor].find_elements(
                ".ant-modal-confirm .ant-btn-primary"
            )
            visible = [button for button in buttons if button.is_displayed()]
            return visible[-1] if visible else None

        confirmation = wait_until(
            visible_confirmation,
            f"{actor} confirmation action",
            timeout=30,
        )
        self.click_element(actor, confirmation)

    def prove_local_conversation_clear(self, group_id: str) -> dict[str, Any]:
        bob_before = self.transcript("bob")
        self.open_details("alice")
        self.click("alice", '[data-chat-history-action="clear"]')
        self.click_confirmation("alice")
        cleared = wait_until(
            lambda: True if self.transcript("alice") == [] else None,
            "local conversation clear",
            timeout=60,
        )
        alice_restore_controls = self.clients["alice"].find_elements(
            '[data-chat-history-action="restore"]'
        )
        bob_unchanged = self.transcript("bob") == bob_before

        self.restart_actor("alice")
        self.open_existing_group("alice", group_id)
        restart_stable = wait_until(
            lambda: True if self.transcript("alice") == [] else None,
            "local conversation clear restart",
            timeout=180,
        )
        self.open_existing_group("bob", group_id)
        new_text = f"post-clear-{time.time_ns()}"
        self.composer_send("bob", new_text)
        new_message = self.wait_message_text("alice", new_text)
        self.assert_condition(
            "conversation_local_clear",
            cleared is True
            and not alice_restore_controls
            and bob_unchanged
            and restart_stable is True
            and bool(new_message),
            json.dumps(
                {
                    "aliceCleared": cleared,
                    "aliceRestoreControlCount": len(alice_restore_controls),
                    "bobUnchanged": bob_unchanged,
                    "restartStable": restart_stable,
                    "newMessage": new_message,
                },
                sort_keys=True,
            ),
        )
        self.capture_visible_localization("conversation-local-clear", ("alice", "bob"))
        return {
            "aliceCleared": cleared,
            "aliceRestoreControlCount": len(alice_restore_controls),
            "bobUnchanged": bob_unchanged,
            "restartStable": restart_stable,
            "newMessage": new_message,
        }

    def arm_recovery_feedback_probe(self, actor: str) -> None:
        self.clients[actor].execute_script(
            """
            const selector = arguments[0];
            window.__PT_RECOVERY_FEEDBACK_PROBE__?.cleanup?.();
            const events = [];
            const preexisting = new WeakSet(
              document.querySelectorAll(selector)
            );
            const describe = (element) => ({
              tag: element.tagName,
              id: element.id || '',
              classes: String(
                element.className?.baseVal || element.className || '',
              ),
              role: element.getAttribute('role') || '',
              text: (element.textContent || '').trim().slice(0, 160),
            });
            const isVisible = (element) => {
              const bounds = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              return (
                bounds.width > 0
                && bounds.height > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden'
                && element.getAttribute('aria-hidden') !== 'true'
              );
            };
            const capture = (root) => {
              if (!(root instanceof Element)) return;
              const candidates = [
                ...(root.matches(selector) ? [root] : []),
                ...root.querySelectorAll(selector),
              ];
              for (const candidate of candidates) {
                if (preexisting.has(candidate)) continue;
                if (isVisible(candidate)) events.push(describe(candidate));
              }
            };
            const observer = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                if (mutation.type === 'attributes') capture(mutation.target);
                for (const node of mutation.addedNodes) capture(node);
              }
            });
            observer.observe(document.documentElement, {
              attributes: true,
              attributeFilter: ['aria-hidden', 'class', 'role', 'style'],
              childList: true,
              subtree: true,
            });
            window.__PT_RECOVERY_FEEDBACK_PROBE__ = {
              cleanup: () => observer.disconnect(),
              observed: () => events.length > 0,
              snapshot: () => events.slice(),
            };
            """,
            RECOVERY_SELECTORS["feedback"],
        )

    def recovery_feedback_observed(self, actor: str) -> bool:
        return bool(
            self.clients[actor].execute_script(
                """
                return Boolean(
                  window.__PT_RECOVERY_FEEDBACK_PROBE__?.observed?.()
                );
                """
            )
        )

    def recovery_feedback_snapshot(self, actor: str) -> list[dict[str, str]]:
        value = self.clients[actor].execute_script(
            """
            return window.__PT_RECOVERY_FEEDBACK_PROBE__?.snapshot?.() || [];
            """
        )
        return value if isinstance(value, list) else []

    def stop_recovery_feedback_probe(self, actor: str) -> None:
        self.clients[actor].execute_script(
            """
            window.__PT_RECOVERY_FEEDBACK_PROBE__?.cleanup?.();
            delete window.__PT_RECOVERY_FEEDBACK_PROBE__;
            """
        )

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
        self.arm_recovery_feedback_probe(actor)
        try:
            self.click(actor, RECOVERY_SELECTORS["backup"])
            WebDriverWait(client.driver, 120).until(
                lambda _driver: self.recovery_feedback_observed(actor)
            )
            self.capture_visible_localization("recovery-create", (actor,))
        finally:
            self.stop_recovery_feedback_probe(actor)
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
        self.native_adapter.post_key(
            NativeKey.A,
            modifiers=(NativeModifier.PRIMARY,),
        )
        self.native_adapter.post_key(NativeKey.DELETE, private_source=True)
        restore_input.send_keys(phrase)
        self.arm_recovery_feedback_probe(actor)
        try:
            self.click(actor, RECOVERY_SELECTORS["restore_submit"])
            WebDriverWait(client.driver, 180).until(
                lambda driver: (
                    not driver.find_elements(
                        By.CSS_SELECTOR,
                        RECOVERY_SELECTORS["restore_input"],
                    )
                    and self.recovery_feedback_observed(actor)
                )
            )
            self.capture_visible_localization("recovery-restore", (actor,))
        finally:
            self.stop_recovery_feedback_probe(actor)

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
        release_errors = self.client_lifecycles.release(
            self.clients["alice"]
        )
        if release_errors:
            raise GateError(
                "Alice first-device logout failed before recovery: "
                f"{json.dumps(release_errors, sort_keys=True)}"
            )
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
        normalized = self.member_settings("alice2", group_id)
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
            "station": normalized,
            "background": rendered,
        }
        self.assert_condition(
            "background_second_device_recovery",
            station_matches and client_isolated,
            json.dumps(result, sort_keys=True),
        )
        self.capture_visible_localization("alice2", ("alice2",))
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
        reaction_proxy_port = (
            self.reaction_proxy.port
            if self.reaction_proxy is not None
            else None
        )
        log_paths = [
            client.log_path
            for client in self.runtime_instances
            if client.log_path is not None
        ]
        cleanup_errors: list[dict[str, str]] = []
        if self.reaction_transport_override is not None:
            try:
                self.runtime_binding.clear_transport_override(
                    "alice",
                    "station",
                    self.reaction_transport_override,
                )
            except Exception as error:
                cleanup_errors.append({
                    "resource": "reaction-transport-override",
                    "error": str(error),
                })
            self.reaction_transport_override = None
        for index in reversed(range(len(self.runtime_instances))):
            client = self.runtime_instances[index]
            attempt = self.runtime_launches[index]
            release_errors = self.client_lifecycles.release(client)
            if not release_errors:
                attempt["cleanupStatus"] = "stopped"
            else:
                attempt["cleanupStatus"] = "failed"
                cleanup_errors.extend(release_errors)
        runtime_log_audit = self.audit_runtime_logs()
        self.write_json_evidence("runtime-log-audit", runtime_log_audit)
        self.write_json_evidence(
            "runtime-launch-ledger",
            self.runtime_launches,
        )
        self.write_json_evidence(
            "native-activation-diagnostics",
            self.native_activation_diagnostics,
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

        result = self.runtime_binding.finalize_cleanup(
            self.runtime_instances,
            self.client_specs,
        )
        if self.reaction_proxy is not None:
            try:
                self.reaction_proxy.disarm()
                self.reaction_proxy.stop()
            except Exception as error:
                cleanup_errors.append({
                    "resource": "reaction-proxy",
                    "error": str(error),
                })
        if reaction_proxy_port is not None:
            try:
                proxy_released = bool(wait_until(
                    lambda: port_is_free(reaction_proxy_port),
                    "reaction proxy port release",
                    timeout=30,
                ))
            except GateError:
                proxy_released = False
            result["ports"] = sorted(
                {
                    *(
                        int(port)
                        for port in result.get("ports", ())
                    ),
                    reaction_proxy_port,
                }
            )
            result["portsReleased"] = (
                bool(result.get("portsReleased"))
                and proxy_released
            )
        runtime_cleanup_errors = result.get("cleanupErrors")
        if isinstance(runtime_cleanup_errors, list):
            cleanup_errors.extend(
                error
                for error in runtime_cleanup_errors
                if isinstance(error, dict)
            )
        result["cleanupErrors"] = cleanup_errors
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
        self.report.runtime["cleanup"] = result
        failed = [name for name, passed in assertions.items() if not passed]
        if failed:
            raise GateError(f"cleanup assertions failed: {failed}; {detail}")
        return result

    def source_identity(self) -> dict[str, Any]:
        source = self.manifest.get("source")
        station = runtime_station_service(self.manifest, "alice")
        station_live = read_station_version(self.station_url)
        runtime_cell = self.runtime_binding.runtime_identity()
        binary = self.runtime_binding.binary_identity()
        identity = {
            "orchestrator": source,
            "station": station,
            "stationLive": station_live,
            "runtimeCell": runtime_cell,
            "binary": binary,
        }
        self.report.runtime["runtimeCellRunId"] = runtime_cell.get("runId")

        source_commit = str(
            source.get("commit") if isinstance(source, dict) else ""
        )
        station_commit = str(
            station.get("liveCommit") if isinstance(station, dict) else ""
        )
        station_live_commit = str(
            station_live.get("build_commit")
            or station_live.get("buildCommit")
            or ""
        )
        cell_source = (
            runtime_cell.get("source")
            if isinstance(runtime_cell, dict)
            else None
        )
        platform = (
            runtime_cell.get("platform")
            if isinstance(runtime_cell, dict)
            else None
        )
        transport = (
            runtime_cell.get("transport")
            if isinstance(runtime_cell, dict)
            else None
        )
        binary_sha256 = str(binary.get("sha256") or "")
        linux_runtime_valid = (
            self.runtime_binding.cell_id != "desktop-linux-native"
            or (
                isinstance(cell_source, dict)
                and cell_source.get("remoteCheckoutClean") is True
                and re.fullmatch(
                    r"[0-9a-f]{64}",
                    str(cell_source.get("remoteSourceDigest") or ""),
                )
                is not None
                and isinstance(platform, dict)
                and re.fullmatch(
                    r"[0-9a-f]{64}",
                    str(platform.get("imageDigest") or ""),
                )
                is not None
                and isinstance(transport, dict)
                and re.fullmatch(
                    r"[0-9a-f]{64}",
                    str(transport.get("hostIdentitySha256") or ""),
                )
                is not None
                and re.fullmatch(
                    r"[0-9a-f]{64}",
                    str(transport.get("hostKeySha256") or ""),
                )
                is not None
            )
        )
        self.assert_condition(
            "source_build_runtime_identity",
            isinstance(source, dict)
            and bool(source_commit)
            and source.get("workspaceDigest") == "clean"
            and isinstance(station, dict)
            and bool(station_commit)
            and commits_match(source_commit, station_commit)
            and commits_match(source_commit, station_live_commit)
            and re.fullmatch(
                r"[0-9a-f]{64}",
                str(station.get("protocolDigest") or ""),
            )
            is not None
            and isinstance(runtime_cell, dict)
            and runtime_cell.get("artifactKind")
            == "acceptance-runtime-cell-manifest"
            and runtime_cell.get("cellId")
            == self.runtime_binding.cell_id
            and runtime_cell.get("gateId") == self.gate_id
            and bool(runtime_cell.get("runId"))
            and runtime_cell.get("state") == "LEASED"
            and isinstance(cell_source, dict)
            and cell_source.get("commit") == source_commit
            and cell_source.get("workspaceDigest") == "clean"
            and linux_runtime_valid
            and binary.get("sourceCommit") == source_commit
            and re.fullmatch(r"[0-9a-f]{64}", binary_sha256) is not None
            and cell_source.get("binarySha256") == binary_sha256,
            json.dumps(identity, sort_keys=True),
        )
        return identity

    def run(self) -> dict[str, Any]:
        if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")
        source_identity = self.source_identity()
        self.assert_condition("native_dom_only", True)

        image_file = self.fixture_root / "w13-image.png"
        image_file.write_bytes(VALID_ATTACHMENT_IMAGE_BYTES)
        text_file = self.fixture_root / "w13-file.txt"
        text_file.write_text("MP-W13 attachment byte identity\n", encoding="utf-8")
        empty_image = self.fixture_root / "w13-empty.png"
        empty_image.write_bytes(b"")
        empty_attachment = self.fixture_root / "w13-empty-attachment.png"
        empty_attachment.write_bytes(b"")

        cleanup: dict[str, Any] = {}
        try:
            self.reaction_proxy = AcceptanceStationSubmitFaultProxy(
                self.station_url
            )
            self.reaction_proxy.start()
            self.reaction_transport_override = (
                self.runtime_binding.create_transport_override(
                    "alice",
                    "station",
                    self.reaction_proxy.url,
                )
            )
            for actor in ("alice", "bob"):
                self.step(f"{actor}.launch", lambda actor=actor: self.launch_actor(actor))
            direct_search = self.step(
                "conversation.search.ui",
                self.prove_conversation_search_open,
            )
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
            local_clear = self.step(
                "conversation.local-clear.restart.ui",
                lambda: self.prove_local_conversation_clear(group_id),
            )
            second_device = self.step(
                "alice.second-device.recovery.ui",
                lambda: self.prove_second_device(group_id, settings["ui"]),
            )
            self.step("localization.visible", self.prove_visible_localization)
            self.collect_final_evidence()

            self.write_json_evidence("source-build-runtime", source_identity)
            self.write_json_evidence("direct-search-reuse", direct_search)
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
                    "localConversationClear": local_clear,
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
                cleanup = cleanup_preserving_primary_failure(
                    self.cleanup_clients,
                    self.report,
                    "Native product closure",
                )
                self.report.runtime["cleanup"] = cleanup
            finally:
                self.report.runtime["steps"] = list(self.steps)
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
            "runtimeCell": self.runtime_binding.cell_id,
            "journey": "mp-w13-chat-product-closure",
            "conversationId": group_id,
            "directConversationId": direct_search["firstOpen"]["conversationId"],
            "steps": self.steps,
            "sourceIdentity": source_identity,
            "cleanup": cleanup,
        }
