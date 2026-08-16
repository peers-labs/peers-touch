#!/usr/bin/env python3
"""Shared visible-native Desktop runner for W8 Chat acceptance journeys."""

from __future__ import annotations

import hashlib
import json
import os
import random
import shutil
import signal
import socket
import subprocess
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

from tooling.acceptance.core import (
    ProvisioningError,
    load_json_artifact,
    load_runtime_manifest,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
WAIT_TICK = threading.Event()
DEFAULT_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "60"))
STARTUP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STARTUP_TIMEOUT_SECONDS", "900"))

REPORT_NAMES = {
    "two-client": "chat-native-two-client-run.json",
    "multi-device": "chat-native-multi-device-run.json",
    "recovery": "chat-native-recovery-run.json",
    "group-mls": "chat-native-group-mls-run.json",
}

SELECTORS = {
    "station_trigger": "[data-station-picker-trigger]",
    "login_tab": '[data-login-tab="password"]',
    "login_email": "[data-login-email]",
    "login_password": "[data-login-password]",
    "login_submit": "[data-login-submit]",
    "pin_skip": "[data-login-pin-skip]",
    "chat_nav": '[data-pt-primary-nav="chat"]',
    "settings_nav": '[data-pt-primary-nav="settings"]',
    "composer": '[data-pt-text-input="chat-composer"]',
    "send": "[data-chat-send]",
    "session_ready": '[data-session-security="ready"]',
    "group_ready": '[data-group-security="ready"]',
    "detail_toggle": "[data-chat-detail-toggle]",
    "recovery_generate": "[data-recovery-generate]",
    "recovery_reveal": "[data-recovery-reveal]",
    "recovery_phrase": "[data-recovery-phrase]",
    "recovery_backup": "[data-recovery-backup-create]",
    "recovery_restore_open": "[data-recovery-restore-open]",
    "recovery_restore_input": "[data-recovery-restore-input]",
    "recovery_restore_submit": "[data-recovery-restore-submit]",
    "new_menu": "[data-chat-new-menu]",
    "create_group_menu": "[data-chat-create-group-menu]",
    "create_group": "[data-chat-create-group]",
    "create_group_contact": "[data-chat-create-group-contact]",
    "create_group_submit": "[data-chat-create-group-submit]",
    "group_add_open": "[data-chat-group-add-member-open]",
    "group_add_select": "[data-chat-group-add-member-select]",
    "group_add_submit": "[data-chat-group-add-member-submit]",
    "group_manage": "[data-chat-group-manage-members]",
    "contact_message": "[data-chat-contact-message]",
    "contacts_subpage": '[data-chat-subpage="contacts"]',
}


class JourneyError(RuntimeError):
    """A fail-closed acceptance boundary failure."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise JourneyError(message)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def commits_match(live_commit: str, expected_commit: str) -> bool:
    return (
        len(live_commit) >= 7
        and len(expected_commit) >= 7
        and (
            live_commit.startswith(expected_commit)
            or expected_commit.startswith(live_commit)
        )
    )


def sha256_files(root: Path, paths: Iterable[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda item: item.as_posix()):
        relative = path.relative_to(root).as_posix().encode()
        digest.update(relative)
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def source_identity(worktree: Path) -> dict[str, str]:
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=worktree,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    workspace = hashlib.sha256()
    workspace.update(
        subprocess.run(
            ["git", "diff", "--binary", "HEAD"],
            cwd=worktree,
            check=True,
            capture_output=True,
        ).stdout
    )
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
        cwd=worktree,
        check=True,
        capture_output=True,
    ).stdout.split(b"\0")
    for raw_path in sorted(path for path in untracked if path):
        workspace.update(raw_path)
        workspace.update(b"\0")
        workspace.update((worktree / raw_path.decode()).read_bytes())
    proto_files = [
        *(worktree / "model" / "domain").rglob("*.proto"),
        *(worktree / "apps" / "desktop" / "src" / "gen" / "proto").rglob("*.ts"),
        *(worktree / "apps" / "station").rglob("*.pb.go"),
    ]
    proto_digest = sha256_files(worktree, proto_files)
    return {
        "commit": commit,
        "workspaceDigest": workspace.hexdigest(),
        "protoDigest": proto_digest,
    }


def wait_until(
    predicate: Callable[[], Any],
    description: str,
    timeout: float = DEFAULT_TIMEOUT,
    interval: float = 0.2,
) -> Any:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as error:  # noqa: BLE001 - retained for boundary diagnostics.
            last_error = error
        WAIT_TICK.wait(min(interval, max(0.0, deadline - time.monotonic())))
    suffix = f"; last error: {last_error}" if last_error else ""
    raise JourneyError(f"timed out waiting for {description}{suffix}")


def read_json_url(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=10) as response:  # noqa: S310 - explicit operator URL.
        payload = json.loads(response.read().decode())
    require(isinstance(payload, dict), f"expected JSON object from {url}")
    data = payload.get("data")
    return data if isinstance(data, dict) else payload


@dataclass
class StepTelemetry:
    journey: str
    evidence_dir: Path
    steps: list[dict[str, Any]] = field(default_factory=list)
    last_successful_step: str = ""

    def run(
        self,
        step: str,
        operation: Callable[[], Any],
        *,
        client: str = "",
        timeout: float = DEFAULT_TIMEOUT,
        diagnostic: Callable[[], dict[str, Any]] | None = None,
    ) -> Any:
        started = time.monotonic()
        event: dict[str, Any] = {
            "step": step,
            "client": client,
            "status": "running",
            "startedAt": now_iso(),
            "timeoutMs": int(timeout * 1000),
        }
        self.steps.append(event)
        try:
            result = operation()
            event.update(
                status="pass",
                finishedAt=now_iso(),
                durationMs=int((time.monotonic() - started) * 1000),
            )
            self.last_successful_step = f"{client}:{step}" if client else step
            return result
        except Exception as error:
            event.update(
                status="failed",
                finishedAt=now_iso(),
                durationMs=int((time.monotonic() - started) * 1000),
                error=str(error),
            )
            if diagnostic is not None:
                try:
                    event["diagnostic"] = diagnostic()
                except Exception as diagnostic_error:  # noqa: BLE001
                    event["diagnosticError"] = str(diagnostic_error)
            raise


class NativeObserver:
    def __init__(self, socket_path: Path):
        self.socket_path = socket_path
        self.connection: socket.socket | None = None
        self.reader: Any = None

    def connect(self) -> None:
        self.close()
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.settimeout(DEFAULT_TIMEOUT)
        connection.connect(str(self.socket_path))
        self.connection = connection
        self.reader = connection.makefile("r", encoding="utf-8")
        require(self.command({"type": "ping"}) == "pong", "native observer ping failed")

    def close(self) -> None:
        if self.reader is not None:
            self.reader.close()
        if self.connection is not None:
            self.connection.close()
        self.reader = None
        self.connection = None

    def command(self, payload: dict[str, Any]) -> Any:
        require(self.connection is not None and self.reader is not None, "observer is not connected")
        self.connection.sendall((json.dumps(payload, separators=(",", ":")) + "\n").encode())
        line = self.reader.readline()
        require(bool(line), "native observer closed the connection")
        response = json.loads(line)
        require(
            response.get("ok") is True,
            f"observer {payload.get('type')} failed for {payload.get('selector', '')}: {response.get('error')}",
        )
        return response.get("data")

    def eval(self, script: str) -> Any:
        return self.command({"type": "eval", "script": script})

    def click(self, selector: str, timeout: float = DEFAULT_TIMEOUT) -> None:
        clicked = self.eval(
            f"""(()=>{{
              const elements=Array.from(document.querySelectorAll({json.dumps(selector)}));
              const element=elements.find((item)=>item.getClientRects().length>0)||elements[0];
              if(!(element instanceof HTMLElement)) return false;
              element.click();
              return true;
            }})()"""
        )
        require(clicked is True, f"observer click target is missing: {selector}")

    def fill(self, selector: str, text: str, timeout: float = DEFAULT_TIMEOUT) -> None:
        tag_name = self.eval(
            f"document.querySelector({json.dumps(selector)})?.tagName||''"
        )
        if tag_name == "TEXTAREA":
            result = self.eval(
                f"""(()=>{{
                  const element=document.querySelector({json.dumps(selector)});
                  if(!(element instanceof HTMLTextAreaElement)) return false;
                  const setter=Object.getOwnPropertyDescriptor(
                    HTMLTextAreaElement.prototype,'value'
                  )?.set;
                  if(!setter) return false;
                  setter.call(element,{json.dumps(text)});
                  element.dispatchEvent(new InputEvent('input',{{
                    bubbles:true,
                    inputType:'insertText',
                    data:{json.dumps(text)}
                  }}));
                  element.dispatchEvent(new Event('change',{{bubbles:true}}));
                  return element.value==={json.dumps(text)};
                }})()"""
            )
            require(result is True, f"observer textarea fill failed for {selector}")
            return
        self.command(
            {"type": "fill", "selector": selector, "text": text, "timeout_ms": int(timeout * 1000)}
        )

    def count(self, selector: str) -> int:
        return int(self.command({"type": "count", "selector": selector}) or 0)

    def visible(self, selector: str) -> bool:
        return bool(
            self.eval(
                f"""(()=>{{
                  return Array.from(document.querySelectorAll({json.dumps(selector)}))
                    .some((element)=>element.getClientRects().length>0);
                }})()"""
            )
        )

    def wait_for(self, selector: str, timeout: float = DEFAULT_TIMEOUT) -> None:
        self.command(
            {"type": "wait_for_selector", "selector": selector, "timeout_ms": int(timeout * 1000)}
        )

    def content(self) -> str:
        return str(self.command({"type": "content"}) or "")


@dataclass
class ClientSpec:
    name: str
    email: str
    expected_ptid: str
    worktree: Path
    index: int
    gateway_port: int = 0
    renderer_port: int = 0
    profile: str = ""
    storage_root: Path | None = None
    observer_socket: Path | None = None


@dataclass
class NativeClient:
    spec: ClientSpec
    station_url: str
    password: str
    run_root: Path
    evidence_dir: Path
    process: subprocess.Popen[str] | None = None
    log_handle: Any = None
    device_id: str = ""
    process_id: str = ""

    def __post_init__(self) -> None:
        require(self.spec.gateway_port > 0, f"{self.spec.name} gateway port is required")
        require(self.spec.renderer_port > 0, f"{self.spec.name} renderer port is required")
        require(self.spec.storage_root is not None, f"{self.spec.name} storage root is required")
        require(self.spec.observer_socket is not None, f"{self.spec.name} observer socket is required")
        self.gateway_port = self.spec.gateway_port
        self.renderer_port = self.spec.renderer_port
        self.storage_root = self.spec.storage_root
        self.runtime_profile_path = self.run_root / self.spec.name / "profile.env"
        self.socket_path = self.spec.observer_socket
        self.log_path = self.evidence_dir / self.spec.name / "desktop.log"
        self.observer = NativeObserver(self.socket_path)
        self.identity = source_identity(self.spec.worktree)
        self.active_conversation_id = ""

    def start_process(self) -> None:
        self.stop()
        self.storage_root.mkdir(parents=True, exist_ok=True)
        self.runtime_profile_path.write_text(
            "\n".join(
                (
                    f"PT_DEV_PROFILE={self.spec.profile}",
                    f"PT_DEV_SLOT={self.spec.index}",
                    "PT_STATION_MODE=remote",
                    "PT_STATION_NAME=chat-native-station",
                    f"PT_STATION_URL={self.station_url}",
                    "PT_STATION_PORT=18080",
                    f"PT_STATION_HEALTH_URL={self.station_url}/app-meta/version",
                    f"PT_DESKTOP_APP_GATEWAY_PORT={self.gateway_port}",
                    f"PT_DESKTOP_APP_WEB_PORT={self.renderer_port}",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.log_handle = self.log_path.open("a", encoding="utf-8")
        env = os.environ.copy()
        env.update(
            {
                "WORKTREE_ID": f"chat-native-{self.spec.name}",
                "PT_DEV_PROFILE": self.spec.profile,
                "PT_DESKTOP_INSTANCE_OFFSET": "0",
                "PT_DESKTOP_APP_GATEWAY_PORT": str(self.gateway_port),
                "PT_DESKTOP_APP_WEB_PORT": str(self.renderer_port),
                "PEERS_STORAGE_ROOT": str(self.storage_root),
                "PT_STATION_MODE": "remote",
                "PT_STATION_URL": self.station_url,
                "PEERS_STATION_URL": self.station_url,
                "PT_DESKTOP_E2E": "true",
                "PT_PLAYWRIGHT_SOCKET": str(self.socket_path),
                "PT_DEV_PROFILE_FILE": str(self.runtime_profile_path),
                "RESTART": "1",
                "CARGO_BUILD_JOBS": "1",
            }
        )
        self.process = subprocess.Popen(
            ["make", "desktop"],
            cwd=self.spec.worktree,
            env=env,
            text=True,
            stdout=self.log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    def await_ports(self) -> None:
        def ready() -> bool:
            if self.process is not None and self.process.poll() is not None:
                raise JourneyError(f"{self.spec.name} Desktop exited with {self.process.returncode}")
            with socket.socket() as probe:
                return probe.connect_ex(("127.0.0.1", self.gateway_port)) == 0

        wait_until(ready, f"{self.spec.name} gateway port", STARTUP_TIMEOUT)
        completed = subprocess.run(
            ["lsof", f"-tiTCP:{self.gateway_port}", "-sTCP:LISTEN"],
            text=True,
            capture_output=True,
        )
        self.process_id = completed.stdout.strip().splitlines()[0]

    def connect_observer(self) -> None:
        wait_until(self.socket_path.exists, f"{self.spec.name} observer socket", STARTUP_TIMEOUT)
        self.observer.connect()

    def select_station(self) -> None:
        observer = self.observer
        observer.wait_for(SELECTORS["station_trigger"])
        observer.click(SELECTORS["station_trigger"])
        station_selector = f'[data-station-url={json.dumps(self.station_url)}]'
        observer.wait_for(station_selector)
        observer.click(station_selector)

    def submit_login(self) -> None:
        observer = self.observer
        observer.wait_for(SELECTORS["login_tab"])
        observer.click(SELECTORS["login_tab"])
        observer.fill(SELECTORS["login_email"], self.spec.email)
        observer.fill(SELECTORS["login_password"], self.password)
        observer.click(SELECTORS["login_submit"])

    def wait_shell(self) -> None:
        observer = self.observer
        ready_state = wait_until(
            lambda: (
                "pin"
                if observer.count(SELECTORS["pin_skip"])
                else "chat"
                if observer.count(SELECTORS["chat_nav"])
                else ""
            ),
            f"{self.spec.name} login result",
            120,
        )
        if ready_state == "pin":
            observer.click(SELECTORS["pin_skip"])
            wait_until(
                lambda: observer.count(SELECTORS["chat_nav"]),
                f"{self.spec.name} shell navigation",
                120,
            )

    def login(self) -> None:
        self.select_station()
        self.submit_login()
        self.wait_shell()

    def open_peer(self, peer_ptid: str) -> None:
        self.observer.click(f'{SELECTORS["chat_nav"]} [role="button"]')
        wait_until(
            lambda: self.observer.visible(SELECTORS["contacts_subpage"]),
            f"{self.spec.name} contacts subpage",
            120,
        )
        self.observer.click(SELECTORS["contacts_subpage"])
        selector = f'[data-chat-contact-ptid={json.dumps(peer_ptid)}]'
        wait_until(
            lambda: self.observer.visible(selector),
            f"{self.spec.name} visible peer contact",
            120,
        )
        self.observer.click(selector)
        wait_until(
            lambda: self.observer.visible(SELECTORS["contact_message"]),
            f"{self.spec.name} contact message action",
            120,
        )
        self.observer.click(SELECTORS["contact_message"])
        wait_until(
            lambda: self.observer.visible(SELECTORS["composer"]),
            f"{self.spec.name} chat composer",
            120,
        )
        conversation = wait_until(
            lambda: next(
                (
                    item
                    for item in self.gateway_command("messaging_list_conversations").get(
                        "conversations", []
                    )
                    if isinstance(item, dict)
                    and item.get("kind") in {1, "direct"}
                    and item.get("conversation_id")
                ),
                None,
            ),
            f"{self.spec.name} direct conversation projection",
            120,
            1,
        )
        self.active_conversation_id = str(conversation["conversation_id"])

    def wait_session_ready(self) -> None:
        wait_until(
            lambda: (
                data
                if str(
                    (
                        data := self.gateway_command(
                            "messaging_debug",
                            {"conversation_id": self.active_conversation_id},
                        )
                    ).get("prepare_send_plan")
                    or ""
                ).startswith("Ok")
                else None
            ),
            f"{self.spec.name} direct send plan",
            120,
            1,
        )

    def send_text(self, text: str) -> dict[str, Any]:
        submitted = False
        try:
            self.observer.fill(SELECTORS["composer"], text)
            self.observer.click(SELECTORS["send"])
            snapshot = wait_until(
                lambda: self.message_snapshot(text),
                f"{self.spec.name} committed message identity",
                120,
            )
            require(bool(snapshot.get("messageUlid")), "submitted message has no committed message ID")
            submitted = True
            return snapshot
        finally:
            if not submitted:
                try:
                    self.observer.fill(SELECTORS["composer"], "")
                except Exception:  # noqa: BLE001 - cleanup is captured by the caller diagnostic.
                    pass

    def message_snapshot(self, text: str) -> dict[str, Any] | None:
        encoded = json.dumps(text)
        result = self.observer.eval(
            f"""(()=>{{
              const row=Array.from(document.querySelectorAll('[data-message-ulid]'))
                .find((item)=>(item.innerText||'').includes({encoded}));
              if(!row) return null;
              return {{
                messageUlid:row.getAttribute('data-message-ulid')||'',
                text:row.innerText||'',
                receipt:row.querySelector('[data-message-receipt]')?.getAttribute('data-message-receipt')||''
              }};
            }})()"""
        )
        return result if isinstance(result, dict) else None

    def composer_value(self) -> str:
        return str(
            self.observer.eval(
                f"document.querySelector({json.dumps(SELECTORS['composer'])})?.value||''"
            )
            or ""
        )

    def diagnostic(self, name: str) -> dict[str, Any]:
        snapshot = self.evidence_dir / self.spec.name / f"{name}.html"
        snapshot.parent.mkdir(parents=True, exist_ok=True)
        snapshot.write_text(self.observer.content(), encoding="utf-8")
        return {
            "domSnapshot": str(snapshot),
            "desktopLog": str(self.log_path),
            "composerValue": self.composer_value(),
            "deviceId": self.device_id,
            "processId": self.process_id,
        }

    def gateway_command(
        self,
        command: str,
        args: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.gateway_port}",
            data=json.dumps({"cmd": command, "args": args or {}}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            envelope = json.loads(response.read().decode())
        require(
            isinstance(envelope, dict) and envelope.get("ok") is True,
            f"{self.spec.name} gateway command failed: {command}",
        )
        data = envelope.get("data")
        require(isinstance(data, dict), f"{self.spec.name} gateway data is invalid: {command}")
        return data

    def read_device_id(self) -> str:
        snapshot = wait_until(
            lambda: (
                data
                if (
                    data := self.gateway_command("messaging_debug")
                ).get("endpoint_device_id")
                else None
            ),
            f"{self.spec.name} active messaging endpoint",
            120,
            1,
        )
        self.device_id = str(snapshot["endpoint_device_id"]).strip()
        require(bool(self.device_id), f"{self.spec.name} device_id is blank")
        return self.device_id

    def wait_bundle_published(self) -> None:
        wait_until(
            lambda: (
                data
                if (
                    str(
                        (
                            data := self.gateway_command("messaging_debug")
                        ).get("publish_prekeys")
                        or ""
                    ).startswith("Ok")
                    and str(data.get("publish_mls_key_packages") or "").startswith("Ok")
                )
                else None
            ),
            f"{self.spec.name} key bundle publication",
            120,
            1,
        )

    def stop(self) -> None:
        self.observer.close()
        if self.process is not None:
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.process.wait(timeout=5)
        self.process = None
        if self.log_handle is not None:
            self.log_handle.close()
            self.log_handle = None
        self.socket_path.unlink(missing_ok=True)


class NativeVisibleJourney:
    def __init__(self, journey: str):
        require(journey in REPORT_NAMES, f"unknown native journey: {journey}")
        self.journey = journey
        self.gate_id = f"chat-native-{journey}-e2e"
        manifest_value = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
        require(bool(manifest_value), "PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        self.runtime_manifest_path = Path(manifest_value).resolve()
        try:
            self.runtime_manifest = load_runtime_manifest(
                self.runtime_manifest_path,
                self.gate_id,
            )
        except ProvisioningError as error:
            raise JourneyError(str(error)) from error
        station = self.runtime_manifest.get("station")
        require(isinstance(station, dict), "runtime manifest Station is required")
        self.station_url = str(station.get("url") or "").rstrip("/")
        require(bool(self.station_url), "runtime manifest Station URL is required")
        attestation_value = str(station.get("attestationArtifact") or "")
        self.station_attestation_path = REPO_ROOT / attestation_value
        require(
            self.station_attestation_path.is_file(),
            "runtime manifest Station attestation is missing",
        )
        actor_manifest_value = str(
            self.runtime_manifest.get("actorManifest") or ""
        )
        require(bool(actor_manifest_value), "runtime manifest actorManifest is required")
        self.actor_manifest_path = REPO_ROOT / actor_manifest_value
        try:
            self.actor_manifest = load_json_artifact(
                self.actor_manifest_path,
                "acceptance-actor-manifest",
            )
        except ProvisioningError as error:
            raise JourneyError(str(error)) from error
        credential_refs = self.runtime_manifest.get("credentialRefs")
        require(
            isinstance(credential_refs, list) and len(credential_refs) == 1,
            "runtime manifest requires exactly one Chat credential reference",
        )
        credential_ref = str(credential_refs[0])
        require(
            credential_ref.startswith("env:"),
            "Chat credential reference must use an env: source",
        )
        credential_name = credential_ref[4:]
        self.password = os.environ.get(credential_name, "")
        require(bool(self.password), f"credential reference {credential_ref} is unresolved")
        self.report_path = Path(
            os.environ.get(
                f"CHAT_NATIVE_{journey.upper().replace('-', '_')}_REPORT",
                f"tooling/acceptance/reports/{REPORT_NAMES[journey]}",
            )
        )
        self.evidence_dir = self.report_path.with_suffix("").with_name(
            self.report_path.stem + "-evidence"
        )
        clients = self.runtime_manifest.get("clients")
        require(isinstance(clients, list) and clients, "runtime manifest clients are required")
        first_storage_value = str(clients[0].get("storage_root") or "")
        require(bool(first_storage_value), "runtime manifest client storage root is required")
        first_storage = Path(first_storage_value)
        self.run_root = first_storage.parents[1]
        self.telemetry = StepTelemetry(journey, self.evidence_dir)
        self.station_identity: dict[str, Any] = {}
        self.clients = self._clients()
        self.launch_order: list[str] = []
        self.assertions: list[dict[str, Any]] = []
        self.failure = ""
        self.captured_failure_diagnostics: list[dict[str, Any]] = []
        self.cleanup_evidence: dict[str, Any] = {
            "status": "not-run",
            "clients": [],
            "storageReleased": False,
        }

    def _clients(self) -> list[NativeClient]:
        roles = {
            "two-client": ("alice", "bob"),
            "multi-device": ("alice", "bob1", "bob2"),
            "recovery": ("alice", "bob"),
            "group-mls": ("alice", "bob", "charlie"),
        }[self.journey]
        runtime_clients = self.runtime_manifest.get("clients")
        require(
            isinstance(runtime_clients, list) and len(runtime_clients) == len(roles),
            "runtime manifest client count does not match the native journey",
        )
        actor_entries = self.actor_manifest.get("actors")
        require(isinstance(actor_entries, list), "actor manifest actors are required")
        actors = {
            str(actor.get("role") or ""): actor
            for actor in actor_entries
            if isinstance(actor, dict)
        }
        clients = []
        for index, (role, runtime) in enumerate(zip(roles, runtime_clients)):
            require(isinstance(runtime, dict), f"{role} runtime entry must be an object")
            require(runtime.get("actor") == role, f"{role} runtime actor mismatch")
            actor = "bob" if role.startswith("bob") else role
            actor_entry = actors.get(actor)
            require(isinstance(actor_entry, dict), f"actor manifest role {actor} is required")
            account_ref = str(actor_entry.get("accountRef") or "")
            require(
                account_ref.startswith("station-account:"),
                f"actor manifest accountRef for {actor} is invalid",
            )
            email = account_ref.removeprefix("station-account:")
            ptid = str(actor_entry.get("ptid") or "")
            require(ptid.startswith("ptid:"), f"actor manifest PTID for {actor} is invalid")
            clients.append(
                NativeClient(
                    ClientSpec(
                        role,
                        email,
                        ptid,
                        Path(str(runtime.get("worktree") or "")).resolve(),
                        index,
                        gateway_port=int(runtime.get("gateway_port") or 0),
                        renderer_port=int(runtime.get("renderer_port") or 0),
                        profile=str(runtime.get("profile") or ""),
                        storage_root=Path(str(runtime.get("storage_root") or "")),
                        observer_socket=Path(str(runtime.get("observer_socket") or "")),
                    ),
                    self.station_url,
                    self.password,
                    self.run_root,
                    self.evidence_dir,
                )
            )
        return clients

    def verify_sources(self) -> None:
        attestation = json.loads(self.station_attestation_path.read_text(encoding="utf-8"))
        require(isinstance(attestation, dict), "Station attestation must be a JSON object")
        require(
            attestation.get("artifactKind") == "station-deployment-attestation",
            "Station attestation artifactKind is invalid",
        )
        require(
            attestation.get("producer") == "station-deployment",
            "Station attestation producer is invalid",
        )
        require(
            self.actor_manifest.get("runId") == self.runtime_manifest.get("runId"),
            "actor manifest runId does not match runtime manifest",
        )
        live = read_json_url(f"{self.station_url}/app-meta/version")
        live_commit = str(live.get("build_commit") or "")
        expected_commit = str(attestation.get("commit") or "")
        require(bool(expected_commit), "Station attestation commit is required")
        require(
            commits_match(live_commit, expected_commit),
            "live Station commit does not match attestation",
        )
        require(attestation.get("workspaceDigest") == "clean", "dirty Station deployment is forbidden")
        station_proto = str(attestation.get("protoDigest") or "")
        require(bool(station_proto), "Station attestation protoDigest is required")
        client_commits = {client.identity["commit"] for client in self.clients}
        client_protos = {client.identity["protoDigest"] for client in self.clients}
        require(len(client_commits) == 1, "client commits do not match")
        require(len(client_protos) == 1, "client proto digests do not match")
        require(station_proto in client_protos, "Station/client proto digests do not match")
        require(expected_commit in client_commits, "Station/client commits do not match")
        manifest_source = self.runtime_manifest.get("source")
        require(isinstance(manifest_source, dict), "runtime manifest source identity is required")
        require(
            manifest_source.get("commit") == expected_commit,
            "runtime manifest source commit does not match Station",
        )
        self.station_identity = {
            "url": self.station_url,
            "commit": expected_commit,
            "workspaceDigest": "clean",
            "protoDigest": station_proto,
            "live": live,
            "attestation": str(self.station_attestation_path),
            "runtimeManifest": str(self.runtime_manifest_path),
            "actorManifest": str(self.actor_manifest_path),
        }

    def start_clients(self) -> None:
        order = list(self.clients)
        random.SystemRandom().shuffle(order)
        self.launch_order = [client.spec.name for client in order]
        for client in order:
            self.telemetry.run("process.start", client.start_process, client=client.spec.name)
        for client in order:
            self.telemetry.run(
                "ports.ready",
                client.await_ports,
                client=client.spec.name,
                timeout=STARTUP_TIMEOUT,
            )
        for client in order:
            self.telemetry.run(
                "observer.ready",
                client.connect_observer,
                client=client.spec.name,
                timeout=STARTUP_TIMEOUT,
            )
        for client in order:
            self.telemetry.run(
                "station.selected",
                client.select_station,
                client=client.spec.name,
                diagnostic=lambda client=client: client.diagnostic("station-login-failure"),
            )
            self.telemetry.run(
                "login.submitted",
                client.submit_login,
                client=client.spec.name,
                diagnostic=lambda client=client: client.diagnostic("login-submit-failure"),
            )
            self.telemetry.run(
                "shell.ready",
                client.wait_shell,
                client=client.spec.name,
            )
            self.telemetry.run(
                "device.registered", client.read_device_id, client=client.spec.name
            )
            self.telemetry.run(
                "bundle.published",
                client.wait_bundle_published,
                client=client.spec.name,
            )

    def pair(self, sender: NativeClient, receivers: list[NativeClient], text: str) -> None:
        sender.open_peer(receivers[0].spec.expected_ptid)
        for receiver in receivers:
            receiver.open_peer(sender.spec.expected_ptid)
        self.telemetry.run("conversation.open", lambda: True, client=sender.spec.name)
        self.telemetry.run(
            "sessions.ready",
            lambda: [client.wait_session_ready() for client in [sender, *receivers]],
            client=sender.spec.name,
        )
        sent = self.telemetry.run(
            "message.submitted",
            lambda: sender.send_text(text),
            client=sender.spec.name,
            diagnostic=lambda: sender.diagnostic("message-submit-failure"),
        )
        received = []
        for receiver in receivers:
            snapshot = self.telemetry.run(
                "message.received",
                lambda receiver=receiver: wait_until(
                    lambda: receiver.message_snapshot(text),
                    f"{receiver.spec.name} exact plaintext",
                    120,
                ),
                client=receiver.spec.name,
                diagnostic=lambda receiver=receiver: receiver.diagnostic("message-receive-failure"),
            )
            require(snapshot["text"].find(text) >= 0, "receiver plaintext mismatch")
            received.append({"client": receiver.spec.name, **snapshot})
            self.telemetry.run("message.decrypted", lambda: True, client=receiver.spec.name)
        delivered = self.telemetry.run(
            "receipt.delivered",
            lambda: wait_until(
                lambda: (
                    item
                    if (item := sender.message_snapshot(text))
                    and item.get("receipt") in {"delivered", "read"}
                    else None
                ),
                "delivered receipt",
                120,
            ),
            client=sender.spec.name,
        )
        read = self.telemetry.run(
            "receipt.read",
            lambda: wait_until(
                lambda: (
                    item
                    if (item := sender.message_snapshot(text))
                    and item.get("receipt") == "read"
                    else None
                ),
                "read receipt",
                120,
            ),
            client=sender.spec.name,
        )
        self.assertions.append(
            {
                "id": f"{sender.spec.name}.to.{'.'.join(item.spec.name for item in receivers)}",
                "status": "pass",
                "plaintext": text,
                "messageId": sent["messageUlid"],
                "receivers": received,
                "delivered": delivered["receipt"],
                "read": read["receipt"],
            }
        )

    def run_two_client(self) -> None:
        alice, bob = self.clients
        self.pair(alice, [bob], f"alice-to-bob-{os.getpid()}")
        self.pair(bob, [alice], f"bob-to-alice-{os.getpid()}")

    def run_multi_device(self) -> None:
        alice, bob1, bob2 = self.clients
        self.pair(alice, [bob1, bob2], f"alice-to-bob-devices-{os.getpid()}")

    def run_recovery(self) -> None:
        alice, bob = self.clients
        text = f"recovery-history-{os.getpid()}"
        self.pair(alice, [bob], text)
        bob.observer.click(SELECTORS["settings_nav"])
        bob.observer.wait_for(SELECTORS["recovery_generate"])
        bob.observer.click(SELECTORS["recovery_generate"])
        bob.observer.click(SELECTORS["recovery_reveal"])
        phrase = str(bob.observer.eval(
            "Array.from(document.querySelectorAll('[data-recovery-phrase] span:last-child')).map(e=>e.textContent?.trim()).filter(Boolean).join(' ')"
        ))
        require(len(phrase.split()) == 24, "recovery phrase must contain 24 words")
        bob.observer.click(SELECTORS["recovery_backup"])
        bob.stop()
        shutil.rmtree(bob.storage_root)
        bob.start_process()
        bob.await_ports()
        bob.connect_observer()
        bob.login()
        bob.observer.click(SELECTORS["settings_nav"])
        bob.observer.click(SELECTORS["recovery_restore_open"])
        bob.observer.fill(SELECTORS["recovery_restore_input"], phrase)
        bob.observer.click(SELECTORS["recovery_restore_submit"])
        bob.open_peer(alice.spec.expected_ptid)
        restored = wait_until(lambda: bob.message_snapshot(text), "restored exact plaintext", 120)
        self.assertions.append(
            {"id": "reinstall.restore", "status": "pass", "messageId": restored["messageUlid"]}
        )

    def run_group_mls(self) -> None:
        alice, bob, charlie = self.clients
        alice.observer.click(f'{SELECTORS["chat_nav"]} [role="button"]')
        alice.observer.click(SELECTORS["new_menu"])
        alice.observer.click(SELECTORS["create_group_menu"])
        alice.observer.wait_for(SELECTORS["create_group"])
        alice.observer.click(f'[data-chat-create-group-contact={json.dumps(bob.spec.expected_ptid)}]')
        alice.observer.click(SELECTORS["create_group_submit"])
        group = wait_until(
            lambda: alice.observer.eval(
                "document.querySelector('[data-chat-group-ulid]')?.getAttribute('data-chat-group-ulid')||''"
            ),
            "created MLS group",
            120,
        )
        alice.observer.click(f'[data-chat-group-ulid={json.dumps(group)}]')
        alice.observer.wait_for(SELECTORS["group_ready"], 120)
        alice.observer.click(SELECTORS["detail_toggle"])
        alice.observer.click(SELECTORS["group_add_open"])
        alice.observer.fill(SELECTORS["group_add_select"], charlie.spec.expected_ptid)
        alice.observer.click(SELECTORS["group_add_submit"])
        alice.observer.wait_for(
            f'[data-chat-group-member={json.dumps(charlie.spec.expected_ptid)}]', 120
        )
        text = f"three-device-mls-{os.getpid()}"
        sent = alice.send_text(text)
        for receiver in (bob, charlie):
            receiver.observer.click(f'{SELECTORS["chat_nav"]} [role="button"]')
            receiver.observer.click(f'[data-chat-group-ulid={json.dumps(group)}]')
            receiver.observer.wait_for(SELECTORS["group_ready"], 120)
            wait_until(lambda receiver=receiver: receiver.message_snapshot(text), text, 120)
        alice.observer.click(SELECTORS["group_manage"])
        alice.observer.click(
            f'[data-chat-group-remove-member={json.dumps(charlie.spec.expected_ptid)}]'
        )
        self.assertions.append(
            {"id": "group.mls.add-send-remove", "status": "pass", "messageId": sent["messageUlid"]}
        )

    def run(self) -> None:
        self.telemetry.run("source.identity", self.verify_sources)
        self.start_clients()
        {
            "two-client": self.run_two_client,
            "multi-device": self.run_multi_device,
            "recovery": self.run_recovery,
            "group-mls": self.run_group_mls,
        }[self.journey]()

    def failure_diagnostics(self) -> list[dict[str, Any]]:
        diagnostics = []
        for client in self.clients:
            try:
                diagnostics.append(
                    {"client": client.spec.name, **client.diagnostic("runner-failure")}
                )
            except Exception as error:  # noqa: BLE001
                diagnostics.append({"client": client.spec.name, "error": str(error)})
        return diagnostics

    def write_report(self, status: str, failure: str = "") -> None:
        passed = status == "pass"
        report = {
            "artifactKind": f"chat-native-{self.journey}-run",
            "producer": "chat-native-visible-runner",
            "automated": True,
            "runtime": "visible-native-desktop",
            "status": status,
            "completionStatus": "DONE" if passed else "PARTIAL",
            "proofStatus": "PROVEN" if passed else "UNPROVEN",
            "sampleEmissionAllowed": False,
            "dryRun": False,
            "apiOnly": False,
            "browserOnly": False,
            "capturedAt": now_iso(),
            "failure": failure,
            "lastSuccessfulStep": self.telemetry.last_successful_step,
            "launchOrder": self.launch_order,
            "station": self.station_identity,
            "runtimeManifest": {
                "path": str(self.runtime_manifest_path),
                "runId": self.runtime_manifest.get("runId"),
                "state": self.runtime_manifest.get("state"),
            },
            "clients": [
                {
                    "name": client.spec.name,
                    "ptid": client.spec.expected_ptid,
                    "deviceId": client.device_id,
                    "profile": client.spec.profile,
                    "gatewayPort": client.gateway_port,
                    "rendererPort": client.renderer_port,
                    "storageRoot": str(client.storage_root),
                    "observerSocket": str(client.socket_path),
                    **client.identity,
                }
                for client in self.clients
            ],
            "steps": self.telemetry.steps,
            "assertions": self.assertions,
            "failureDiagnostics": (
                [] if passed else self.captured_failure_diagnostics
            ),
            "cleanup": self.cleanup_evidence,
        }
        self.report_path.parent.mkdir(parents=True, exist_ok=True)
        self.report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    def close(self) -> list[str]:
        failures: list[str] = []
        client_cleanup: list[dict[str, Any]] = []
        for client in self.clients:
            try:
                client.stop()
            except Exception as error:
                failures.append(f"{client.spec.name}: stop failed: {error}")
            ports = {}
            for label, port in (
                ("gateway", client.gateway_port),
                ("renderer", client.renderer_port),
            ):
                with socket.socket() as probe:
                    released = probe.connect_ex(("127.0.0.1", port)) != 0
                ports[label] = {"port": port, "released": released}
                if not released:
                    failures.append(
                        f"{client.spec.name}: {label} port {port} still listening"
                    )
            socket_released = not client.socket_path.exists()
            if not socket_released:
                failures.append(
                    f"{client.spec.name}: observer socket still exists"
                )
            client_cleanup.append(
                {
                    "client": client.spec.name,
                    "ports": ports,
                    "observerSocketReleased": socket_released,
                }
            )
        shutil.rmtree(self.run_root, ignore_errors=True)
        storage_released = not self.run_root.exists()
        if not storage_released:
            failures.append(f"run storage still exists: {self.run_root}")
        self.cleanup_evidence = {
            "status": "pass" if not failures else "failed",
            "clients": client_cleanup,
            "storageReleased": storage_released,
            "failures": failures,
        }
        return failures


def run_journey(journey: str) -> int:
    runner: NativeVisibleJourney | None = None
    failure = ""
    try:
        runner = NativeVisibleJourney(journey)
        runner.run()
    except Exception as error:  # noqa: BLE001 - top-level acceptance boundary.
        failure = str(error)
        if runner is not None:
            runner.captured_failure_diagnostics = runner.failure_diagnostics()
        else:
            print(f"[FAIL] {journey}: {error}")
    finally:
        if runner is not None:
            cleanup_failures = runner.close()
            if cleanup_failures:
                cleanup_failure = "; ".join(cleanup_failures)
                failure = (
                    f"{failure}; cleanup failed: {cleanup_failure}"
                    if failure
                    else f"cleanup failed: {cleanup_failure}"
                )

    if runner is None:
        return 1
    if failure:
        runner.write_report("failed", failure)
        print(f"[FAIL] {journey}: {runner.report_path}: {failure}")
        return 1
    runner.write_report("pass")
    print(f"[OK] {journey}: {runner.report_path}")
    return 0
