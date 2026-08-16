#!/usr/bin/env python3
"""Prove durable Direct and Group interactions in isolated Native Tauri clients."""

from __future__ import annotations

import json
import os
import random
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable

from tooling.acceptance.core import AcceptanceGate, ActorRuntime, GateError, REPO_ROOT
from tooling.acceptance.drivers.tauri import TauriDriver
from tooling.acceptance.fixtures.chat_native_reset import deploy_environment
from tooling.acceptance.gates.chat.native_support import (
    DEFAULT_STATION,
    async_harness,
    enter_chat_page,
    reset_fixture,
    start_authenticated_client,
    stop_client,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    commits_match,
    current_commit,
    current_workspace_digest,
    read_station_version,
    wait_until,
)


REPORT_PATH = Path(
    os.environ.get(
        "CHAT_NATIVE_INTERACTIONS_REPORT",
        "tooling/acceptance/reports/chat-native-interactions-run.json",
    )
)
CLIENT_PORTS = {"alice": 4451, "bob": 4452, "charlie": 4453}
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))
ACTORS = ("alice", "bob", "charlie")
REQUIRED_ASSERTIONS = {
    "native_runtime",
    "actor_isolation",
    "direct_reply_thread",
    "direct_author_only_edit",
    "direct_reaction_idempotency",
    "direct_pin_convergence",
    "direct_read_progression",
    "direct_retract_convergence",
    "direct_client_restart",
    "group_reply_thread",
    "group_author_only_edit",
    "group_reaction_idempotency",
    "group_pin_convergence",
    "group_read_progression",
    "group_retract_convergence",
    "station_restart_convergence",
    "station_authority_readback",
    "engine_durable_readback",
}


def gateway_command(
    client: TauriDriver,
    command: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    request = urllib.request.Request(
        f"http://127.0.0.1:{client.gateway_port}",
        data=json.dumps({"cmd": command, "args": args}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        envelope = json.loads(response.read().decode("utf-8"))
    if not isinstance(envelope, dict) or envelope.get("ok") is not True:
        raise GateError(f"{command} failed: {envelope}")
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise GateError(f"{command} returned invalid data")
    return data


def message_dom_snapshot(client: TauriDriver, message_id: str) -> dict[str, Any] | None:
    value = client.execute_script(
        """
        const id = arguments[0];
        const row = document.querySelector(`[data-message-ulid="${CSS.escape(id)}"]`);
        if (!row) return null;
        return {
          messageId: id,
          text: row.innerText || '',
          edited: row.getAttribute('data-message-edited') || '',
          retracted: row.getAttribute('data-message-retracted') || '',
          replyTo: row.getAttribute('data-message-reply-to') || '',
          threadRoot: row.getAttribute('data-message-thread-root') || '',
          threadReplyCount: Number(row.getAttribute('data-message-thread-reply-count') || '0'),
          pinned: Boolean(row.querySelector('[data-message-pinned="true"]')),
          readBy: (row.getAttribute('data-message-read-by') || '')
            .split(',').filter(Boolean),
          readState: row.querySelector('[data-message-read-state]')
            ?.getAttribute('data-message-read-state') || '',
          reactions: Array.from(row.querySelectorAll('[data-message-reaction]'))
            .map((item) => item.getAttribute('data-message-reaction') || ''),
          receipt: row.querySelector('[data-message-receipt]')
            ?.getAttribute('data-message-receipt') || '',
        };
        """,
        message_id,
    )
    return value if isinstance(value, dict) else None


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def station_readback(conversation_id: str, message_id: str) -> dict[str, Any]:
    environment = deploy_environment("station-three")
    host = environment.get("PT_DEPLOY_HOST", "").strip()
    user = environment.get("PT_DEPLOY_USER", "").strip()
    if not host or not user:
        raise GateError("station-three deployment host identity is unavailable")
    container = os.environ.get(
        "CHAT_ACCEPTANCE_POSTGRES_CONTAINER",
        "pt-station-a-postgres-1",
    )
    conversation = sql_literal(conversation_id)
    message = sql_literal(message_id)
    query = f"""
SELECT json_build_object(
  'events', COALESCE((
    SELECT json_agg(json_build_object(
      'eventId', event_id,
      'sequence', sequence,
      'commandId', command_id,
      'messageId', message_id,
      'hashBytes', octet_length(event_hash)
    ) ORDER BY sequence)
    FROM messaging_events
    WHERE conversation_id = {conversation} AND message_id = {message}
  ), '[]'::json),
  'queue', COALESCE((
    SELECT json_agg(json_build_object(
      'itemId', item_id,
      'eventId', event_id,
      'recipientPtid', recipient_ptid,
      'recipientDeviceId', recipient_device_id,
      'laneSequence', lane_sequence,
      'state', state
    ) ORDER BY recipient_ptid, recipient_device_id, lane_sequence)
    FROM device_queue_items
    WHERE conversation_id = {conversation}
  ), '[]'::json),
  'readCursors', COALESCE((
    SELECT json_agg(json_build_object(
      'readerPtid', reader_ptid,
      'lastReadSequence', last_read_sequence
    ) ORDER BY reader_ptid)
    FROM messaging_read_cursors
    WHERE conversation_id = {conversation}
  ), '[]'::json)
);
"""
    remote = (
        f"docker exec -i {container} sh -lc "
        "'psql -At -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\"'"
    )
    result = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "StrictHostKeyChecking=no",
            f"{user}@{host}",
            remote,
        ],
        input=query,
        text=True,
        check=True,
        capture_output=True,
    )
    value = json.loads(result.stdout.strip())
    if not isinstance(value, dict):
        raise GateError("Station interaction readback is invalid")
    return value


class NativeInteractionsGate(AcceptanceGate):
    gate_id = "chat-native-interactions-e2e"
    report_path = REPORT_PATH

    def __init__(self) -> None:
        super().__init__()
        self.station_url = os.environ.get(
            "CHAT_NATIVE_STATION_URL",
            DEFAULT_STATION,
        ).rstrip("/")
        self.tested_commit = current_commit()
        self.workspace_digest = current_workspace_digest()
        self.steps: list[dict[str, Any]] = []
        self.clients: dict[str, TauriDriver] = {}
        self.ptids: dict[str, str] = {}
        self.device_ids: dict[str, str] = {}
        self.conversations: dict[str, str] = {}
        self.message_ids: dict[str, str] = {}
        self.command_ids: dict[str, str] = {}
        self.station_evidence: dict[str, Any] = {}
        self.engine_evidence: dict[str, Any] = {}

    def step(self, name: str, action: Callable[[], Any], client: str = "") -> Any:
        started = time.monotonic()
        try:
            value = action()
        except Exception as error:
            self.steps.append(
                {
                    "step": name,
                    "client": client,
                    "status": "fail",
                    "durationMs": int((time.monotonic() - started) * 1000),
                    "error": str(error),
                }
            )
            raise
        self.steps.append(
            {
                "step": name,
                "client": client,
                "status": "pass",
                "durationMs": int((time.monotonic() - started) * 1000),
            }
        )
        return value

    def start_client(self, actor: str) -> None:
        client, ptid = start_authenticated_client(
            actor,
            CLIENT_PORTS[actor],
            self.station_url,
        )
        self.register_driver(client)
        self.clients[actor] = client
        self.ptids[actor] = ptid
        device = async_harness(client, "getRealtimeDevice", {})
        device_id = str((device or {}).get("deviceId") or "")
        if not device_id:
            raise GateError(f"{actor}: messaging device ID is missing")
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
        enter_chat_page(client)

    def sync(self, actor: str, kind: str, conversation_id: str) -> None:
        method = "syncFriendSession" if kind == "friend" else "syncGroup"
        key = "sessionUlid" if kind == "friend" else "groupUlid"
        async_harness(self.clients[actor], method, {key: conversation_id})

    def projection(
        self,
        actor: str,
        kind: str,
        conversation_id: str,
        message_id: str,
    ) -> dict[str, Any] | None:
        value = async_harness(
            self.clients[actor],
            "interactionProjection",
            {
                "conversationId": conversation_id,
                "kind": kind,
                "messageId": message_id,
            },
        )
        return value if isinstance(value, dict) else None

    def send(
        self,
        actor: str,
        kind: str,
        conversation_id: str,
        content: str,
        *,
        reply_to: str = "",
        thread_root: str = "",
    ) -> dict[str, Any]:
        result = async_harness(
            self.clients[actor],
            "sendInteractionMessage",
            {
                "conversationId": conversation_id,
                "kind": kind,
                "content": content,
                "replyToMessageId": reply_to,
                "threadRootMessageId": thread_root,
            },
        )
        if not isinstance(result, dict) or not result.get("messageId"):
            raise GateError(f"{kind} send returned no message identity")
        return result

    def expect_rejected(self, action: Callable[[], Any], description: str) -> None:
        try:
            action()
        except Exception:
            return
        raise GateError(f"unauthorized action succeeded: {description}")

    def engine_snapshot(
        self,
        actor: str,
        conversation_id: str,
        message_id: str,
        command_id: str = "",
    ) -> dict[str, Any]:
        return gateway_command(
            self.clients[actor],
            "messaging_acceptance_interaction_snapshot",
            {
                "conversation_id": conversation_id,
                "message_id": message_id,
                "command_id": command_id,
            },
        )

    def prove_lifecycle(
        self,
        kind: str,
        conversation_id: str,
        members: tuple[str, ...],
    ) -> None:
        prefix = f"{kind}-{time.time_ns()}"
        base = self.step(
            f"{kind}.message.send",
            lambda: self.send("alice", kind, conversation_id, f"{prefix}-base"),
            "alice",
        )
        message_id = str(base["messageId"])
        self.message_ids[f"{kind}.base"] = message_id
        for actor in members:
            self.step(
                f"{kind}.message.visible",
                lambda actor=actor: wait_until(
                    lambda: (
                        self.sync(actor, kind, conversation_id)
                        or message_dom_snapshot(self.clients[actor], message_id)
                    ),
                    f"{actor} {kind} base DOM",
                    STEP_TIMEOUT,
                ),
                actor,
            )

        reply = self.step(
            f"{kind}.reply.send",
            lambda: self.send(
                "bob",
                kind,
                conversation_id,
                f"{prefix}-reply",
                reply_to=message_id,
            ),
            "bob",
        )
        reply_id = str(reply["messageId"])
        thread = self.step(
            f"{kind}.thread.send",
            lambda: self.send(
                "bob",
                kind,
                conversation_id,
                f"{prefix}-thread",
                thread_root=message_id,
            ),
            "bob",
        )
        thread_id = str(thread["messageId"])
        for actor in members:
            reply_projection = wait_until(
                lambda actor=actor: self.projection(
                    actor,
                    kind,
                    conversation_id,
                    reply_id,
                ),
                f"{actor} {kind} reply projection",
                STEP_TIMEOUT,
            )
            thread_projection = wait_until(
                lambda actor=actor: self.projection(
                    actor,
                    kind,
                    conversation_id,
                    thread_id,
                ),
                f"{actor} {kind} thread projection",
                STEP_TIMEOUT,
            )
            if reply_projection.get("replyToMessageId") != message_id:
                raise GateError(f"{actor} {kind} reply linkage mismatch")
            if thread_projection.get("threadRootMessageId") != message_id:
                raise GateError(f"{actor} {kind} thread linkage mismatch")
        self.assert_condition(f"{kind}_reply_thread", True)

        edited_text = f"{prefix}-edited"
        edit = self.step(
            f"{kind}.edit.submit",
            lambda: async_harness(
                self.clients["alice"],
                "editInteractionMessage",
                {
                    "conversationId": conversation_id,
                    "kind": kind,
                    "messageId": message_id,
                    "plaintext": edited_text,
                },
            ),
            "alice",
        )
        edit_command = str((edit or {}).get("command_id") or (edit or {}).get("commandId") or "")
        if not edit_command:
            raise GateError(f"{kind} edit returned no command ID")
        self.command_ids[f"{kind}.edit"] = edit_command
        for actor in members:
            wait_until(
                lambda actor=actor: (
                    snapshot
                    if (
                        snapshot := self.projection(
                            actor,
                            kind,
                            conversation_id,
                            message_id,
                        )
                    )
                    and snapshot.get("content") == edited_text
                    and snapshot.get("edited") is True
                    else None
                ),
                f"{actor} {kind} edited projection",
                STEP_TIMEOUT,
            )
            wait_until(
                lambda actor=actor: (
                    snapshot
                    if (
                        snapshot := message_dom_snapshot(
                            self.clients[actor],
                            message_id,
                        )
                    )
                    and snapshot.get("edited") == "true"
                    and edited_text in str(snapshot.get("text") or "")
                    else None
                ),
                f"{actor} {kind} edited DOM",
                STEP_TIMEOUT,
            )
        self.expect_rejected(
            lambda: async_harness(
                self.clients["bob"],
                "editInteractionMessage",
                {
                    "conversationId": conversation_id,
                    "kind": kind,
                    "messageId": message_id,
                    "plaintext": f"{prefix}-unauthorized",
                },
            ),
            f"bob edits alice {kind} message",
        )
        self.assert_condition(f"{kind}_author_only_edit", True)

        for _ in range(2):
            async_harness(
                self.clients["bob"],
                "submitMetadataInteraction",
                {
                    "conversationId": conversation_id,
                    "kind": kind,
                    "messageId": message_id,
                    "interaction": "reaction",
                    "reaction": "👍",
                    "remove": False,
                },
            )
        for actor in members:
            wait_until(
                lambda actor=actor: (
                    snapshot
                    if (
                        snapshot := self.projection(
                            actor,
                            kind,
                            conversation_id,
                            message_id,
                        )
                    )
                    and len(snapshot.get("reactions") or []) == 1
                    else None
                ),
                f"{actor} {kind} idempotent reaction",
                STEP_TIMEOUT,
            )
        self.assert_condition(f"{kind}_reaction_idempotency", True)
        async_harness(
            self.clients["bob"],
            "submitMetadataInteraction",
            {
                "conversationId": conversation_id,
                "kind": kind,
                "messageId": message_id,
                "interaction": "reaction",
                "reaction": "👍",
                "remove": True,
            },
        )

        pin = async_harness(
            self.clients["alice"],
            "submitMetadataInteraction",
            {
                "conversationId": conversation_id,
                "kind": kind,
                "messageId": message_id,
                "interaction": "pin",
                "remove": False,
            },
        )
        pin_command = str((pin or {}).get("command_id") or (pin or {}).get("commandId") or "")
        for actor in members:
            wait_until(
                lambda actor=actor: (
                    snapshot
                    if (
                        snapshot := self.projection(
                            actor,
                            kind,
                            conversation_id,
                            message_id,
                        )
                    )
                    and snapshot.get("pinned") is True
                    else None
                ),
                f"{actor} {kind} pin",
                STEP_TIMEOUT,
            )
        async_harness(
            self.clients["alice"],
            "submitMetadataInteraction",
            {
                "conversationId": conversation_id,
                "kind": kind,
                "messageId": message_id,
                "interaction": "pin",
                "remove": True,
            },
        )
        for actor in members:
            wait_until(
                lambda actor=actor: (
                    snapshot
                    if (
                        snapshot := self.projection(
                            actor,
                            kind,
                            conversation_id,
                            message_id,
                        )
                    )
                    and snapshot.get("pinned") is False
                    else None
                ),
                f"{actor} {kind} unpin",
                STEP_TIMEOUT,
            )
        self.assert_condition(f"{kind}_pin_convergence", True)

        read = async_harness(
            self.clients["bob"],
            "submitReadCursor",
            {"conversationId": conversation_id, "kind": kind},
        )
        read_sequence = int((read or {}).get("lastReadSequence") or 0)
        if read_sequence <= 0:
            raise GateError(f"{kind} read cursor returned no sequence")
        alice_engine = wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := self.engine_snapshot(
                        "alice",
                        conversation_id,
                        message_id,
                        edit_command,
                    )
                )
                and any(
                    cursor.get("actorPtid") == self.ptids["bob"]
                    and int(cursor.get("lastReadSequence") or 0) >= read_sequence
                    for cursor in snapshot.get("readCursors") or []
                )
                else None
            ),
            f"alice {kind} read cursor projection",
            STEP_TIMEOUT,
        )
        self.engine_evidence[f"{kind}.alice"] = alice_engine
        wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := message_dom_snapshot(
                        self.clients["alice"],
                        message_id,
                    )
                )
                and (
                    snapshot.get("receipt") == "read"
                    if kind == "direct"
                    else (
                        self.ptids["bob"] in (snapshot.get("readBy") or [])
                        and snapshot.get("readState") == "read"
                    )
                )
                else None
            ),
            f"alice {kind} sender-visible read state",
            STEP_TIMEOUT,
        )
        self.assert_condition(f"{kind}_read_progression", True)

        retract = async_harness(
            self.clients["alice"],
            "submitMetadataInteraction",
            {
                "conversationId": conversation_id,
                "kind": kind,
                "messageId": message_id,
                "interaction": "retract",
                "remove": False,
            },
        )
        retract_command = str(
            (retract or {}).get("command_id")
            or (retract or {}).get("commandId")
            or ""
        )
        for actor in members:
            wait_until(
                lambda actor=actor: (
                    snapshot
                    if (
                        snapshot := message_dom_snapshot(
                            self.clients[actor],
                            message_id,
                        )
                    )
                    and snapshot.get("retracted") == "true"
                    else None
                ),
                f"{actor} {kind} retracted DOM",
                STEP_TIMEOUT,
            )
        self.assert_condition(f"{kind}_retract_convergence", True)
        engine = self.engine_snapshot(
            "alice",
            conversation_id,
            message_id,
            retract_command or pin_command,
        )
        projection = engine.get("projection") or {}
        if (
            projection.get("retracted") is not True
            or int(engine.get("consumptionCount") or 0) <= 0
            or int(engine.get("laneSequence") or 0) <= 0
        ):
            raise GateError(f"{kind} Engine durable interaction evidence is incomplete")
        self.engine_evidence[f"{kind}.terminal"] = engine
        station = station_readback(conversation_id, message_id)
        if not station.get("events") or not station.get("queue"):
            raise GateError(f"{kind} Station authority/queue evidence is incomplete")
        self.station_evidence[kind] = station

    def restart_client(self, actor: str, kind: str, conversation_id: str) -> None:
        old = self.clients[actor]
        stop_client(old)
        client, ptid = start_authenticated_client(
            actor,
            CLIENT_PORTS[actor],
            self.station_url,
        )
        self.register_driver(client)
        if ptid != self.ptids[actor]:
            raise GateError(f"{actor} identity changed across client restart")
        self.clients[actor] = client
        enter_chat_page(client)
        self.sync(actor, kind, conversation_id)

    def restart_station(self) -> None:
        if os.environ.get("CHAT_ACCEPTANCE_ALLOW_STATION_RESTART") != "1":
            raise GateError(
                "CHAT_ACCEPTANCE_ALLOW_STATION_RESTART=1 is required for the "
                "authorized Profile Three restart scenario"
            )
        subprocess.run(
            ["make", "profile", "three"],
            cwd=REPO_ROOT,
            check=True,
        )
        subprocess.run(
            ["make", "station-restart"],
            cwd=REPO_ROOT,
            check=True,
        )
        wait_until(
            lambda: read_station_version(self.station_url),
            "Profile Three Station restart health",
            180,
            1,
        )

    def run(self) -> dict[str, Any]:
        if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")
        if not os.environ.get("CHAT_ACCEPTANCE_PASSWORD", ""):
            raise GateError("CHAT_ACCEPTANCE_PASSWORD is required")
        self.report.station_url = self.station_url
        version = self.step(
            "station.identity",
            lambda: read_station_version(self.station_url),
        )
        live_commit = str(version.get("build_commit") or "")
        if not commits_match(live_commit, self.tested_commit):
            raise GateError(
                "Station/client commit mismatch: "
                f"station={live_commit or 'missing'} client={self.tested_commit}"
            )
        self.step(
            "fixture.reset",
            lambda: reset_fixture(ACTORS),
        )
        order = list(ACTORS)
        random.SystemRandom().shuffle(order)
        try:
            for actor in order:
                self.step(
                    "client.authenticated",
                    lambda actor=actor: self.start_client(actor),
                    actor,
                )
            self.assert_condition(
                "native_runtime",
                all(
                    client.get_current_url().startswith("tauri://localhost")
                    for client in self.clients.values()
                ),
            )
            self.assert_condition(
                "actor_isolation",
                len(set(self.ptids.values())) == len(ACTORS)
                and len(set(self.device_ids.values())) == len(ACTORS)
                and len({client.port for client in self.clients.values()}) == len(ACTORS)
                and len({client.gateway_port for client in self.clients.values()}) == len(ACTORS)
                and len({client.storage_root for client in self.clients.values()}) == len(ACTORS),
            )

            direct = async_harness(
                self.clients["alice"],
                "createDirectConversation",
                {"peerPtid": self.ptids["bob"]},
            )
            direct_id = str((direct or {}).get("conversationId") or "")
            if not direct_id:
                raise GateError("Direct conversation creation returned no ID")
            self.conversations["direct"] = direct_id
            for actor in ("alice", "bob"):
                self.sync(actor, "friend", direct_id)
            self.prove_lifecycle("direct", direct_id, ("alice", "bob"))

            self.step(
                "direct.client.restart",
                lambda: self.restart_client("bob", "friend", direct_id),
                "bob",
            )
            direct_terminal = self.message_ids["direct.base"]
            wait_until(
                lambda: (
                    snapshot
                    if (
                        snapshot := message_dom_snapshot(
                            self.clients["bob"],
                            direct_terminal,
                        )
                    )
                    and snapshot.get("retracted") == "true"
                    else None
                ),
                "bob direct projection after restart",
                STEP_TIMEOUT,
            )
            self.assert_condition("direct_client_restart", True)

            group = async_harness(
                self.clients["alice"],
                "createGroup",
                {
                    "name": f"acceptance-{time.time_ns()}",
                    "memberDids": [self.ptids["bob"], self.ptids["charlie"]],
                },
                timeout=120,
            )
            group_id = str((group or {}).get("groupUlid") or "")
            if not group_id:
                raise GateError("Group creation returned no ID")
            self.conversations["group"] = group_id
            for actor in ACTORS:
                self.sync(actor, "group", group_id)
            self.prove_lifecycle("group", group_id, ACTORS)

            self.step("station.restart", self.restart_station)
            for actor in ACTORS:
                self.sync(
                    actor,
                    "group" if actor == "charlie" else "friend",
                    group_id if actor == "charlie" else direct_id,
                )
            self.assert_condition("station_restart_convergence", True)
            self.assert_condition(
                "station_authority_readback",
                all(
                    evidence.get("events") and evidence.get("queue")
                    for evidence in self.station_evidence.values()
                ),
            )
            self.assert_condition(
                "engine_durable_readback",
                all(
                    int(evidence.get("consumptionCount") or 0) > 0
                    for evidence in self.engine_evidence.values()
                ),
            )
            for actor, client in self.clients.items():
                self.save_screenshot(client, actor)
                self.save_dom(client, actor)
                self.save_app_log(client, actor)
        finally:
            for client in self.clients.values():
                try:
                    stop_client(client)
                except Exception:
                    client.stop()

        names = {assertion.name for assertion in self.report.assertions}
        missing = REQUIRED_ASSERTIONS - names
        if missing:
            raise GateError(f"required assertions are missing: {sorted(missing)}")
        return {
            "runtimeCell": "native-tauri-embedded-webdriver",
            "journey": "direct-and-group-message-interactions",
            "testedCommit": self.tested_commit,
            "testedWorkspaceDigest": self.workspace_digest,
            "stationLive": version,
            "launchOrder": order,
            "conversations": self.conversations,
            "messageIds": self.message_ids,
            "commandIds": self.command_ids,
            "stationReadback": self.station_evidence,
            "engineReadback": self.engine_evidence,
            "steps": self.steps,
            "clients": {
                actor: {
                    "ptid": self.ptids[actor],
                    "deviceId": self.device_ids[actor],
                    "webdriverPort": self.clients[actor].port,
                    "gatewayPort": self.clients[actor].gateway_port,
                    "profile": self.clients[actor].profile,
                    "storageRoot": self.clients[actor].storage_root,
                }
                for actor in ACTORS
            },
        }


if __name__ == "__main__":
    raise SystemExit(NativeInteractionsGate().execute())
