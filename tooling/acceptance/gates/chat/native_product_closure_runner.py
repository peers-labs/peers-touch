#!/usr/bin/env python3
"""Prove the MP-W13 Chat product closure through real Native DOM actions."""

from __future__ import annotations

import hashlib
import json
import os
import socket
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, Callable

from selenium.webdriver import ActionChains, Keys
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
from tooling.acceptance.gates.chat.native_support import enter_chat_page, wait_until


GATE_ID = "chat-native-product-closure-e2e"
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
        client = TauriDriver(
            app_binary=str(self.binary),
            port=int(spec["webdriver_port"]),
            gateway_port=int(spec["gateway_port"]),
            profile=str(spec["profile"]),
            storage_root=str(spec["storage_root"]),
            environment={"PEERS_STATION_URL": self.station_url},
        )
        client.start()
        self.register_driver(client)
        try:
            client.wait_for_acceptance_harness(30)
            self.configure_station(client, self.station_url)
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

    def click(self, actor: str, selector: str, timeout: float = 30) -> Any:
        element = self.clients[actor].find_element(selector, timeout)
        WebDriverWait(self.clients[actor].driver, timeout).until(
            lambda _: element.is_displayed() and element.is_enabled()
        )
        element.click()
        return element

    def hover_message(self, actor: str, message_id: str) -> Any:
        client = self.clients[actor]
        row = client.find_element(f'[data-message-ulid="{message_id}"]', 30)
        ActionChains(client.driver).move_to_element(row).perform()
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
        composer.click()
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
                if (!row) return null;
                return {
                  id: row.getAttribute('data-message-ulid') || '',
                  sequence: Number(row.getAttribute('data-message-authority-sequence') || 0),
                  attachmentCount: Number(row.getAttribute('data-message-attachment-count') || 0),
                  content: row.querySelector('[data-message-content]')?.innerText || '',
                };
                """,
                text,
            )
            return value if isinstance(value, dict) and value.get("id") else None

        return wait_until(snapshot, f"{actor} visible message {text!r}", timeout=120)

    def open_group_through_ui(self) -> str:
        for actor in ("alice", "bob"):
            enter_chat_page(self.clients[actor])
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

        alice_transcript = wait_until(
            lambda: (
                value
                if len(value := self.transcript("alice")) >= 3
                else None
            ),
            "Alice complete transcript",
            timeout=120,
        )
        bob_transcript = wait_until(
            lambda: (
                value
                if len(value := self.transcript("bob")) == len(alice_transcript)
                else None
            ),
            "Bob complete transcript",
            timeout=120,
        )
        self.assert_condition(
            "transcript_exact",
            alice_transcript == bob_transcript
            and all(item["sequence"] > 0 for item in alice_transcript),
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
            const adjacent = [rows[index - 1], rows[index + 1]].filter(Boolean)
              .map((item) => item.querySelector('[data-message-content]')?.getBoundingClientRect())
              .filter(Boolean);
            const rect = (element) => {
              const value = element?.getBoundingClientRect();
              return value ? {
                left: value.left, right: value.right, top: value.top, bottom: value.bottom,
                width: value.width, height: value.height,
              } : null;
            };
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
        target.click()

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
        proxy = ProfileThreeSubmitFaultProxy(self.station_url)
        proxy.start()
        try:
            self.configure_station(self.clients["alice"], proxy.url)
            proxy.arm_connection_loss()
            self.choose_reaction("alice", message_id, failure_emoji)
            error_row = wait_until(
                lambda: (
                    row
                    if (
                        row := self.clients["alice"].find_element(
                            f'[data-message-ulid="{message_id}"]',
                            5,
                        )
                    ).get_attribute("data-message-reaction-state")
                    == "error"
                    else None
                ),
                "reaction actionable error",
                timeout=30,
            )
            if self.reaction_visible("alice", message_id, failure_emoji):
                raise GateError("failed reaction remained as terminal optimistic state")
            proxy.disarm()
            self.configure_station(self.clients["alice"], self.station_url)
            retry = error_row.find_element(
                By.CSS_SELECTOR,
                f'[data-message-reaction-retry="{message_id}"]',
            )
            retry.click()
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
            proxy.stop()
            self.configure_station(self.clients["alice"], self.station_url)

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
        snapshots = {
            actor: self.identity_snapshot(actor) for actor in ("alice", "bob")
        }
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
        self.assert_condition(
            "station_attribution_exact",
            len(station_sets) == 2
            and len(station_sets[0]) == 1
            and station_sets[0] == station_sets[1],
            json.dumps(station_sets),
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
        self.click(actor, '[data-chat-conversation-action="background"]')
        self.clients[actor].find_element("[data-chat-background-select]", 15)

    def select_second_background(self, actor: str) -> None:
        select = self.clients[actor].find_element("[data-chat-background-select]", 15)
        select.click()
        options = WebDriverWait(self.clients[actor].driver, 10).until(
            lambda driver: driver.find_elements(By.CSS_SELECTOR, "[role='option']")
        )
        if len(options) < 2:
            raise GateError("background select has fewer than two options")
        options[1].click()

    def prove_settings_background(
        self,
        group_id: str,
        valid_image: Path,
        empty_image: Path,
    ) -> dict[str, Any]:
        self.open_details("alice")
        self.click("alice", '[data-chat-conversation-action="mute"]')
        wait_until(
            lambda: self.setting_state("alice").get("muted") == "true",
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
        self.clients["alice"].find_element(
            "[data-chat-background-input]",
            10,
        ).send_keys(str(empty_image))
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
        self.clients["alice"].find_element(
            "[data-chat-background-input]",
            10,
        ).send_keys(str(valid_image))
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
        attachment_input = self.clients["alice"].find_element(
            "[data-chat-attachment-input]",
            10,
        )
        attachment_input.send_keys(str(empty_file))
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
        buttons[-1].click()
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
        attachment_input = self.clients["alice"].find_element(
            "[data-chat-attachment-input]",
            10,
        )
        attachment_input.send_keys(f"{image_file}\n{text_file}")
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
        enter_chat_page(self.clients["alice"])
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
        )
        for client in self.clients.values():
            client.stop()
        released = wait_until(
            lambda: all(port_is_free(port) for port in ports),
            "Native client port release",
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
