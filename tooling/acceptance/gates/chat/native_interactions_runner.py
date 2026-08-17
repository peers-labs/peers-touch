#!/usr/bin/env python3
"""Prove durable Direct and Group interactions in isolated Native Tauri clients."""

from __future__ import annotations

import json
import os
import random
import socket
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable

from tooling.acceptance.core import AcceptanceGate, ActorRuntime, GateError
from tooling.acceptance.drivers.tauri import TauriDriver
from tooling.acceptance.fixtures.chat_native_reset import (
    deploy_environment,
    duplicate_profile_three_queue_delivery,
    profile_three_environment,
    restart_profile_three_station,
)
from tooling.acceptance.fixtures.chat_submit_fault_proxy import (
    ProfileThreeSubmitFaultProxy,
)
from tooling.acceptance.gates.chat.native_support import (
    DEFAULT_STATION,
    async_harness,
    configure_station,
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
    "direct_reply_thread_panel",
    "direct_reply_target_unavailable",
    "direct_author_only_edit",
    "direct_author_only_retract",
    "direct_reaction_idempotency",
    "direct_reaction_remove_convergence",
    "direct_pin_convergence",
    "direct_read_progression",
    "direct_retract_convergence",
    "direct_client_restart",
    "direct_offline_recovery",
    "direct_duplicate_queue_replay",
    "group_reply_thread",
    "group_reply_thread_panel",
    "group_reply_target_unavailable",
    "group_author_only_edit",
    "group_author_only_retract",
    "group_reaction_idempotency",
    "group_reaction_remove_convergence",
    "group_pin_convergence",
    "group_read_progression",
    "group_retract_convergence",
    "group_offline_recovery",
    "group_duplicate_queue_replay",
    "group_removed_member_denied",
    "revoked_device_denied",
    "pending_interaction_timeout_retry",
    "station_restart_convergence",
    "station_authority_readback",
    "engine_durable_readback",
    "resources_released",
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
          replyTargetState: row.querySelector('[data-message-reply-target-state]')
            ?.getAttribute('data-message-reply-target-state') || '',
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


def thread_dom_snapshot(client: TauriDriver) -> dict[str, Any] | None:
    value = client.execute_script(
        """
        const panel = document.querySelector('[data-chat-thread-panel="open"]');
        if (!panel) return null;
        return {
          rootMessageId: panel.getAttribute('data-chat-thread-root') || '',
          replyCount: Number(
            panel.getAttribute('data-chat-thread-reply-count') || '0'
          ),
          replyMessageIds: Array.from(
            panel.querySelectorAll('[data-thread-message-role="reply"]')
          ).map((row) => row.getAttribute('data-thread-message-id') || ''),
          orders: Array.from(
            panel.querySelectorAll('[data-thread-message-order]')
          ).map((row) => Number(
            row.getAttribute('data-thread-message-order') || '-1'
          )),
        };
        """
    )
    return value if isinstance(value, dict) else None


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def station_mutation_fingerprint(evidence: dict[str, Any]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    authority_events = evidence.get("authorityEvents") or evidence.get("events") or []
    authority_event_ids = tuple(
        str(event.get("eventId") or "") for event in authority_events
    )
    authority_event_id_set = set(authority_event_ids)
    return (
        authority_event_ids,
        tuple(
            str(item.get("itemId") or "")
            for item in evidence.get("queue") or []
            if str(item.get("eventId") or "") in authority_event_id_set
        ),
    )


def recipient_queue_item_ids(
    evidence: dict[str, Any],
    ptid: str,
    device_id: str,
) -> tuple[str, ...]:
    return tuple(
        str(item.get("itemId") or "")
        for item in evidence.get("queue") or []
        if item.get("recipientPtid") == ptid
        and item.get("recipientDeviceId") == device_id
    )


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
  'authorityEvents', COALESCE((
    SELECT json_agg(json_build_object(
      'eventId', event_id,
      'sequence', sequence,
      'commandId', command_id
    ) ORDER BY sequence)
    FROM messaging_events
    WHERE conversation_id = {conversation}
  ), '[]'::json),
  'queue', COALESCE((
    SELECT json_agg(json_build_object(
      'itemId', item_id,
      'eventId', event_id,
      'recipientPtid', recipient_ptid,
      'recipientDeviceId', recipient_device_id,
      'laneSequence', lane_sequence,
      'state', state,
      'attemptCount', attempt_count,
      'payloadSha256', encode(payload_sha256, 'hex')
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
        self.restart_evidence: dict[str, str] = {}
        self.timeout_retry_evidence: dict[str, Any] = {}
        self.cleanup_evidence: dict[str, Any] = {}

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
        claim_kind = "direct" if kind == "friend" else "group"
        prefix = f"{claim_kind}-{time.time_ns()}"
        base = self.step(
            f"{claim_kind}.message.send",
            lambda: self.send("alice", kind, conversation_id, f"{prefix}-base"),
            "alice",
        )
        message_id = str(base["messageId"])
        self.message_ids[f"{claim_kind}.base"] = message_id
        for actor in members:
            self.step(
                f"{claim_kind}.message.visible",
                lambda actor=actor: wait_until(
                    lambda: (
                        self.sync(actor, kind, conversation_id)
                        or message_dom_snapshot(self.clients[actor], message_id)
                    ),
                    f"{actor} {claim_kind} base DOM",
                    STEP_TIMEOUT,
                ),
                actor,
            )

        reply = self.step(
            f"{claim_kind}.reply.send",
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
            f"{claim_kind}.thread.send",
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
        nested = self.step(
            f"{claim_kind}.thread.nested.send",
            lambda: self.send(
                "bob",
                kind,
                conversation_id,
                f"{prefix}-thread-nested",
                reply_to=thread_id,
                thread_root=message_id,
            ),
            "bob",
        )
        nested_id = str(nested["messageId"])
        self.message_ids[f"{claim_kind}.thread.first"] = thread_id
        self.message_ids[f"{claim_kind}.thread.nested"] = nested_id
        for actor in members:
            reply_projection = wait_until(
                lambda actor=actor: self.projection(
                    actor,
                    kind,
                    conversation_id,
                    reply_id,
                ),
                f"{actor} {claim_kind} reply projection",
                STEP_TIMEOUT,
            )
            thread_projection = wait_until(
                lambda actor=actor: self.projection(
                    actor,
                    kind,
                    conversation_id,
                    thread_id,
                ),
                f"{actor} {claim_kind} thread projection",
                STEP_TIMEOUT,
            )
            if reply_projection.get("replyToMessageId") != message_id:
                raise GateError(f"{actor} {claim_kind} reply linkage mismatch")
            if thread_projection.get("threadRootMessageId") != message_id:
                raise GateError(f"{actor} {claim_kind} thread linkage mismatch")
            nested_projection = wait_until(
                lambda actor=actor: self.projection(
                    actor,
                    kind,
                    conversation_id,
                    nested_id,
                ),
                f"{actor} {claim_kind} nested thread projection",
                STEP_TIMEOUT,
            )
            if (
                nested_projection.get("replyToMessageId") != thread_id
                or nested_projection.get("threadRootMessageId") != message_id
            ):
                raise GateError(
                    f"{actor} {claim_kind} nested thread linkage mismatch"
                )
            async_harness(
                self.clients[actor],
                "openInteractionThread",
                {
                    "conversationId": conversation_id,
                    "kind": kind,
                    "messageId": message_id,
                },
            )
            panel = wait_until(
                lambda actor=actor: (
                    snapshot
                    if (
                        snapshot := thread_dom_snapshot(self.clients[actor])
                    )
                    and snapshot.get("rootMessageId") == message_id
                    and snapshot.get("replyCount") == 2
                    and snapshot.get("replyMessageIds") == [thread_id, nested_id]
                    and snapshot.get("orders") == [0, 1, 2]
                    else None
                ),
                f"{actor} {claim_kind} thread panel count and order",
                STEP_TIMEOUT,
            )
            if panel.get("replyMessageIds") != [thread_id, nested_id]:
                raise GateError(
                    f"{actor} {claim_kind} thread panel order mismatch"
                )
        self.assert_condition(f"{claim_kind}_reply_thread", True)
        self.assert_condition(f"{claim_kind}_reply_thread_panel", True)

        unavailable_base = self.step(
            f"{claim_kind}.missing-target.base.send",
            lambda: self.send(
                "alice",
                kind,
                conversation_id,
                f"{prefix}-missing-target-base",
            ),
            "alice",
        )
        unavailable_base_id = str(unavailable_base["messageId"])
        unavailable_reply = self.step(
            f"{claim_kind}.missing-target.reply.send",
            lambda: self.send(
                "bob",
                kind,
                conversation_id,
                f"{prefix}-missing-target-reply",
                reply_to=unavailable_base_id,
            ),
            "bob",
        )
        unavailable_reply_id = str(unavailable_reply["messageId"])
        for actor in members:
            wait_until(
                lambda actor=actor: (
                    self.sync(actor, kind, conversation_id)
                    or self.projection(
                        actor,
                        kind,
                        conversation_id,
                        unavailable_reply_id,
                    )
                ),
                f"{actor} {claim_kind} reply before local target deletion",
                STEP_TIMEOUT,
            )
            wait_until(
                lambda actor=actor: message_dom_snapshot(
                    self.clients[actor],
                    unavailable_reply_id,
                ),
                f"{actor} {claim_kind} reply DOM before local target deletion",
                STEP_TIMEOUT,
            )
        target_actor = "bob"
        deleted = async_harness(
            self.clients[target_actor],
            "deleteLocalInteractionMessage",
            {
                "conversationId": conversation_id,
                "kind": kind,
                "messageId": unavailable_base_id,
            },
        )
        if (deleted or {}).get("present") is not False:
            raise GateError(
                f"{target_actor} {claim_kind} local target deletion failed"
            )
        wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := message_dom_snapshot(
                        self.clients[target_actor],
                        unavailable_reply_id,
                    )
                )
                and snapshot.get("replyTargetState") == "unavailable"
                else None
            ),
            f"{target_actor} {claim_kind} unavailable reply target DOM",
            STEP_TIMEOUT,
        )
        self.assert_condition(f"{claim_kind}_reply_target_unavailable", True)

        edited_text = f"{prefix}-edited"
        edit = self.step(
            f"{claim_kind}.edit.submit",
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
            raise GateError(f"{claim_kind} edit returned no command ID")
        self.command_ids[f"{claim_kind}.edit"] = edit_command
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
                f"{actor} {claim_kind} edited projection",
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
                f"{actor} {claim_kind} edited DOM",
                STEP_TIMEOUT,
            )
        before_unauthorized_edit = station_readback(conversation_id, message_id)
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
            f"bob edits alice {claim_kind} message",
        )
        after_unauthorized_edit = station_readback(conversation_id, message_id)
        if station_mutation_fingerprint(before_unauthorized_edit) != station_mutation_fingerprint(
            after_unauthorized_edit
        ):
            raise GateError(
                f"unauthorized {claim_kind} edit mutated authority or queue"
            )
        self.assert_condition(f"{claim_kind}_author_only_edit", True)

        for attempt in range(2):
            before_consumption = {
                actor: int(
                    self.engine_snapshot(
                        actor,
                        conversation_id,
                        message_id,
                    ).get("consumptionCount")
                    or 0
                )
                for actor in members
            }
            reaction = async_harness(
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
            reaction_command = str(
                (reaction or {}).get("command_id")
                or (reaction or {}).get("commandId")
                or ""
            )
            if not reaction_command:
                raise GateError(
                    f"{claim_kind} reaction attempt returned no command ID"
                )
            wait_until(
                lambda: (
                    snapshot
                    if (
                        snapshot := self.engine_snapshot(
                            "bob",
                            conversation_id,
                            message_id,
                            reaction_command,
                        )
                    )
                    and (snapshot.get("intent") or {}).get("state")
                    in {"submitted", "committed"}
                    else None
                ),
                f"bob {claim_kind} reaction attempt {attempt + 1} submission",
                STEP_TIMEOUT,
            )
            for actor in members:
                wait_until(
                    lambda actor=actor: (
                        snapshot
                        if (
                            snapshot := self.engine_snapshot(
                                actor,
                                conversation_id,
                                message_id,
                            )
                        )
                        and int(snapshot.get("consumptionCount") or 0)
                        > before_consumption[actor]
                        else None
                    ),
                    f"{actor} {claim_kind} reaction attempt "
                    f"{attempt + 1} consumption",
                    STEP_TIMEOUT,
                )
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
                    f"{actor} {claim_kind} idempotent reaction",
                    STEP_TIMEOUT,
                )
        self.assert_condition(f"{claim_kind}_reaction_idempotency", True)
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
                    and len(snapshot.get("reactions") or []) == 0
                    else None
                ),
                f"{actor} {claim_kind} reaction removal projection",
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
                    and len(snapshot.get("reactions") or []) == 0
                    else None
                ),
                f"{actor} {claim_kind} reaction removal DOM",
                STEP_TIMEOUT,
            )
        self.assert_condition(f"{claim_kind}_reaction_remove_convergence", True)

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
                f"{actor} {claim_kind} pin",
                STEP_TIMEOUT,
            )
        async_harness(
            self.clients["bob"],
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
                f"{actor} {claim_kind} unpin",
                STEP_TIMEOUT,
            )
        self.assert_condition(f"{claim_kind}_pin_convergence", True)

        read = async_harness(
            self.clients["bob"],
            "submitReadCursor",
            {"conversationId": conversation_id, "kind": kind},
        )
        read_sequence = int((read or {}).get("lastReadSequence") or 0)
        if read_sequence <= 0:
            raise GateError(f"{claim_kind} read cursor returned no sequence")
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
            f"alice {claim_kind} read cursor projection",
            STEP_TIMEOUT,
        )
        self.engine_evidence[f"{claim_kind}.alice"] = alice_engine
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
                    if kind == "friend"
                    else (
                        self.ptids["bob"] in (snapshot.get("readBy") or [])
                        and snapshot.get("readState") == "read"
                    )
                )
                else None
            ),
            f"alice {claim_kind} sender-visible read state",
            STEP_TIMEOUT,
        )
        self.assert_condition(f"{claim_kind}_read_progression", True)

        before_unauthorized_retract = station_readback(conversation_id, message_id)
        self.expect_rejected(
            lambda: async_harness(
                self.clients["bob"],
                "submitMetadataInteraction",
                {
                    "conversationId": conversation_id,
                    "kind": kind,
                    "messageId": message_id,
                    "interaction": "retract",
                    "remove": False,
                },
            ),
            f"bob retracts alice {claim_kind} message",
        )
        after_unauthorized_retract = station_readback(conversation_id, message_id)
        if station_mutation_fingerprint(
            before_unauthorized_retract
        ) != station_mutation_fingerprint(after_unauthorized_retract):
            raise GateError(
                f"unauthorized {claim_kind} retract mutated authority or queue"
            )
        self.assert_condition(f"{claim_kind}_author_only_retract", True)

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
                f"{actor} {claim_kind} retracted DOM",
                STEP_TIMEOUT,
            )
        self.assert_condition(f"{claim_kind}_retract_convergence", True)
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
            raise GateError(
                f"{claim_kind} Engine durable interaction evidence is incomplete"
            )
        self.engine_evidence[f"{claim_kind}.terminal"] = engine
        station = station_readback(conversation_id, message_id)
        if not station.get("events") or not station.get("queue"):
            raise GateError(
                f"{claim_kind} Station authority/queue evidence is incomplete"
            )
        self.station_evidence[claim_kind] = station

    def prove_offline_recovery(
        self,
        kind: str,
        conversation_id: str,
        online_members: tuple[str, ...],
    ) -> None:
        claim_kind = "direct" if kind == "friend" else "group"
        prefix = f"{claim_kind}-offline-{time.time_ns()}"
        base = self.send(
            "alice",
            kind,
            conversation_id,
            f"{prefix}-base",
        )
        message_id = str(base["messageId"])
        for actor in ("alice", "bob", *online_members):
            self.sync(actor, kind, conversation_id)
            wait_until(
                lambda actor=actor: message_dom_snapshot(
                    self.clients[actor],
                    message_id,
                ),
                f"{actor} {claim_kind} offline seed DOM",
                STEP_TIMEOUT,
            )

        stop_client(self.clients["bob"])
        edited_text = f"{prefix}-edited"
        edit = async_harness(
            self.clients["alice"],
            "editInteractionMessage",
            {
                "conversationId": conversation_id,
                "kind": kind,
                "messageId": message_id,
                "plaintext": edited_text,
            },
        )
        edit_command = str(
            (edit or {}).get("command_id")
            or (edit or {}).get("commandId")
            or ""
        )
        if not edit_command:
            raise GateError(f"{claim_kind} offline edit returned no command ID")
        async_harness(
            self.clients["alice"],
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
        async_harness(
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
        for actor in ("alice", *online_members):
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
                    and snapshot.get("pinned") is True
                    and len(snapshot.get("reactions") or []) == 1
                    else None
                ),
                f"{actor} {claim_kind} offline mutation convergence",
                STEP_TIMEOUT,
            )

        self.restart_client(
            "bob",
            kind,
            conversation_id,
            stop_existing=False,
        )
        wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := self.projection(
                        "bob",
                        kind,
                        conversation_id,
                        message_id,
                    )
                )
                and snapshot.get("content") == edited_text
                and snapshot.get("edited") is True
                and snapshot.get("pinned") is True
                and len(snapshot.get("reactions") or []) == 1
                else None
            ),
            f"bob {claim_kind} offline queue recovery",
            STEP_TIMEOUT,
        )
        wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := message_dom_snapshot(
                        self.clients["bob"],
                        message_id,
                    )
                )
                and snapshot.get("edited") == "true"
                and snapshot.get("pinned") is True
                and len(snapshot.get("reactions") or []) == 1
                and edited_text in str(snapshot.get("text") or "")
                else None
            ),
            f"bob {claim_kind} offline recovery DOM",
            STEP_TIMEOUT,
        )
        before_restart = self.engine_snapshot(
            "bob",
            conversation_id,
            message_id,
            edit_command,
        )
        self.restart_client("bob", kind, conversation_id)
        after_restart = wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := self.engine_snapshot(
                        "bob",
                        conversation_id,
                        message_id,
                        edit_command,
                    )
                )
                and len(snapshot.get("reactions") or []) == 1
                and len(snapshot.get("pins") or []) == 1
                else None
            ),
            f"bob {claim_kind} offline recovery after client restart",
            STEP_TIMEOUT,
        )
        if before_restart.get("consumptionCount") != after_restart.get(
            "consumptionCount"
        ):
            raise GateError(
                f"{claim_kind} offline recovery duplicated consumption after restart"
            )
        self.engine_evidence[f"{claim_kind}.offline"] = after_restart
        self.station_evidence[f"{claim_kind}.offline"] = station_readback(
            conversation_id,
            message_id,
        )
        self.assert_condition(f"{claim_kind}_offline_recovery", True)
        self.prove_duplicate_queue_replay(
            claim_kind,
            conversation_id,
            message_id,
            "bob",
        )

    def prove_duplicate_queue_replay(
        self,
        claim_kind: str,
        conversation_id: str,
        message_id: str,
        actor: str,
    ) -> None:
        before_station = station_readback(conversation_id, message_id)
        event_ids = {
            str(event.get("eventId") or "")
            for event in before_station.get("events") or []
        }
        candidates = [
            item
            for item in before_station.get("queue") or []
            if item.get("recipientPtid") == self.ptids[actor]
            and item.get("recipientDeviceId") == self.device_ids[actor]
            and item.get("eventId") in event_ids
            and int(item.get("state") or 0) == 5
        ]
        if not candidates:
            raise GateError(
                f"{claim_kind} duplicate replay has no ACKed source delivery"
            )
        source = max(
            candidates,
            key=lambda item: int(item.get("laneSequence") or 0),
        )
        before_engine = self.engine_snapshot(
            actor,
            conversation_id,
            message_id,
        )
        before_dom = message_dom_snapshot(self.clients[actor], message_id)
        try:
            injected = duplicate_profile_three_queue_delivery(
                self.station_url,
                str(source.get("itemId") or ""),
                self.ptids[actor],
                self.device_ids[actor],
            )
        except RuntimeError as error:
            raise GateError(str(error)) from error
        duplicate_item_id = str(injected.get("duplicateItemId") or "")
        duplicate_lane = int(injected.get("laneSequence") or 0)
        if not duplicate_item_id or duplicate_lane <= 0:
            raise GateError(
                f"{claim_kind} duplicate replay injection returned invalid evidence"
            )

        def acked_duplicate() -> dict[str, Any] | None:
            evidence = station_readback(conversation_id, message_id)
            acknowledged = any(
                item.get("itemId") == duplicate_item_id
                and int(item.get("state") or 0) == 5
                and int(item.get("attemptCount") or 0) >= 1
                for item in evidence.get("queue") or []
            )
            return evidence if acknowledged else None

        after_station = wait_until(
            acked_duplicate,
            f"{actor} {claim_kind} duplicate queue delivery ACK",
            STEP_TIMEOUT,
        )
        after_engine = wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := self.engine_snapshot(
                        actor,
                        conversation_id,
                        message_id,
                    )
                )
                and int(snapshot.get("laneSequence") or 0) >= duplicate_lane
                else None
            ),
            f"{actor} {claim_kind} duplicate queue replay Engine cursor",
            STEP_TIMEOUT,
        )
        after_dom = message_dom_snapshot(self.clients[actor], message_id)
        for field in ("projection", "reactions", "pins", "consumptionCount"):
            if before_engine.get(field) != after_engine.get(field):
                raise GateError(
                    f"{claim_kind} duplicate replay changed Engine {field}"
                )
        if before_dom != after_dom:
            raise GateError(
                f"{claim_kind} duplicate replay changed receiver-visible DOM"
            )
        self.station_evidence[f"{claim_kind}.duplicate"] = after_station
        self.engine_evidence[f"{claim_kind}.duplicate"] = after_engine
        self.assert_condition(f"{claim_kind}_duplicate_queue_replay", True)

    def prove_pending_timeout_retry(
        self,
        kind: str,
        conversation_id: str,
    ) -> None:
        claim_kind = "direct" if kind == "friend" else "group"
        prefix = f"{claim_kind}-timeout-{time.time_ns()}"
        original_text = f"{prefix}-original"
        edited_text = f"{prefix}-edited"
        base = self.send(
            "alice",
            kind,
            conversation_id,
            original_text,
        )
        message_id = str(base["messageId"])
        for actor in ("alice", "bob"):
            self.sync(actor, kind, conversation_id)
            wait_until(
                lambda actor=actor: message_dom_snapshot(
                    self.clients[actor],
                    message_id,
                ),
                f"{actor} {claim_kind} timeout seed DOM",
                STEP_TIMEOUT,
            )

        before_station = station_readback(conversation_id, message_id)
        proxy = ProfileThreeSubmitFaultProxy(self.station_url)
        proxy.start()
        proxy_port = proxy.port
        command_id = ""
        pending_engine: dict[str, Any] = {}
        final_engine: dict[str, Any] = {}
        proxy_evidence: dict[str, Any] = {}
        try:
            configure_station(self.clients["alice"], proxy.url)
            proxy.arm_connection_loss()
            edit = async_harness(
                self.clients["alice"],
                "editInteractionMessage",
                {
                    "conversationId": conversation_id,
                    "kind": kind,
                    "messageId": message_id,
                    "plaintext": edited_text,
                },
            )
            command_id = str(
                (edit or {}).get("command_id")
                or (edit or {}).get("commandId")
                or ""
            )
            if not command_id:
                raise GateError("timeout edit returned no command ID")

            pending_engine = wait_until(
                lambda: (
                    snapshot
                    if (
                        (snapshot := self.engine_snapshot(
                            "alice",
                            conversation_id,
                            message_id,
                            command_id,
                        ))
                        and (snapshot.get("intent") or {}).get("state")
                        == "retry_wait"
                        and (snapshot.get("outbox") or {}).get("state")
                        == "retry_wait"
                        and int(
                            (snapshot.get("outbox") or {}).get("attemptCount")
                            or 0
                        )
                        >= 1
                    )
                    else None
                ),
                f"Alice {claim_kind} interaction retry_wait after connection loss",
                STEP_TIMEOUT,
            )
            intent = pending_engine.get("intent") or {}
            outbox = pending_engine.get("outbox") or {}
            command_sha = str(intent.get("commandSha256") or "")
            if (
                not command_sha
                or outbox.get("commandSha256") != command_sha
                or outbox.get("lastErrorCode") != "network"
            ):
                raise GateError(
                    "timeout retry did not preserve one exact network-failed command"
                )
            sender_projection = self.projection(
                "alice",
                kind,
                conversation_id,
                message_id,
            )
            sender_dom = message_dom_snapshot(
                self.clients["alice"],
                message_id,
            )
            if (
                not sender_projection
                or sender_projection.get("content") != original_text
                or sender_projection.get("edited") is True
                or not sender_dom
                or original_text not in str(sender_dom.get("text") or "")
                or sender_dom.get("edited") == "true"
            ):
                raise GateError(
                    "timeout changed the original sender-visible message"
                )
            during_station = station_readback(conversation_id, message_id)
            if any(
                event.get("commandId") == command_id
                for event in during_station.get("events") or []
            ):
                raise GateError(
                    "connection-loss submit reached Authority before retry"
                )
            proxy_evidence = proxy.evidence()
            command_hashes = proxy_evidence.get("commandSha256") or []
            if (
                int(proxy_evidence.get("connectionLossCount") or 0) < 1
                or not command_hashes
                or any(value != command_sha for value in command_hashes)
            ):
                raise GateError(
                    "fault proxy did not observe only the exact command bytes"
                )

            configure_station(self.clients["alice"], self.station_url)
            proxy.disarm()

            def dispatch_until_submitted() -> dict[str, Any] | None:
                gateway_command(
                    self.clients["alice"],
                    "messaging_dispatch",
                    {},
                )
                snapshot = self.engine_snapshot(
                    "alice",
                    conversation_id,
                    message_id,
                    command_id,
                )
                state = str((snapshot.get("outbox") or {}).get("state") or "")
                return snapshot if state in {"submitted", "committed"} else None

            final_engine = wait_until(
                dispatch_until_submitted,
                "Alice exact interaction retry submission",
                STEP_TIMEOUT,
            )
            if (
                (final_engine.get("outbox") or {}).get("commandSha256")
                != command_sha
            ):
                raise GateError("interaction retry changed exact command bytes")
            wait_until(
                lambda: (
                    snapshot
                    if (
                        (snapshot := self.projection(
                            "bob",
                            kind,
                            conversation_id,
                            message_id,
                        ))
                        and snapshot.get("content") == edited_text
                        and snapshot.get("edited") is True
                    )
                    else None
                ),
                f"Bob {claim_kind} timeout retry edited projection",
                STEP_TIMEOUT,
            )
            receiver_dom = wait_until(
                lambda: (
                    snapshot
                    if (
                        (snapshot := message_dom_snapshot(
                            self.clients["bob"],
                            message_id,
                        ))
                        and snapshot.get("edited") == "true"
                        and edited_text in str(snapshot.get("text") or "")
                    )
                    else None
                ),
                f"Bob {claim_kind} timeout retry edited DOM",
                STEP_TIMEOUT,
            )
            visible_count = int(
                self.clients["bob"].execute_script(
                    """
                    return document.querySelectorAll(
                      `[data-message-ulid="${CSS.escape(arguments[0])}"]`
                    ).length;
                    """,
                    message_id,
                )
                or 0
            )
            after_station = station_readback(conversation_id, message_id)
            command_events = [
                event
                for event in after_station.get("events") or []
                if event.get("commandId") == command_id
            ]
            if len(command_events) != 1 or visible_count != 1:
                raise GateError(
                    "exact retry did not converge to one Authority fact and "
                    "one receiver-visible result"
                )
            self.timeout_retry_evidence[claim_kind] = {
                "conversationId": conversation_id,
                "messageId": message_id,
                "commandId": command_id,
                "commandSha256": command_sha,
                "beforeStation": before_station,
                "pendingEngine": pending_engine,
                "finalEngine": final_engine,
                "finalStation": after_station,
                "receiverDom": receiver_dom,
                "receiverVisibleCount": visible_count,
                "faultProxy": proxy_evidence,
            }
            self.command_ids[f"{claim_kind}.timeout-edit"] = command_id
        finally:
            try:
                configure_station(self.clients["alice"], self.station_url)
            finally:
                proxy.disarm()
                if not proxy_evidence:
                    proxy_evidence = proxy.evidence()
                proxy.stop()
                scenario_evidence = self.timeout_retry_evidence.setdefault(
                    claim_kind,
                    {},
                )
                scenario_evidence.setdefault(
                    "faultProxy",
                    proxy_evidence,
                )
                scenario_evidence["proxyPort"] = proxy_port
                scenario_evidence["proxyPortReleased"] = wait_until(
                    lambda: self.port_is_free(proxy_port),
                    f"{claim_kind} Chat submit fault proxy port release",
                    10,
                    0.1,
                )

    def restart_client(
        self,
        actor: str,
        kind: str,
        conversation_id: str,
        *,
        stop_existing: bool = True,
    ) -> None:
        old = self.clients[actor]
        if stop_existing:
            stop_client(old)
        client, ptid = start_authenticated_client(
            actor,
            CLIENT_PORTS[actor],
            self.station_url,
        )
        self.register_driver(client)
        if ptid != self.ptids[actor]:
            raise GateError(f"{actor} identity changed across client restart")
        device = async_harness(client, "getRealtimeDevice", {})
        device_id = str((device or {}).get("deviceId") or "")
        if device_id != self.device_ids[actor]:
            raise GateError(f"{actor} device changed across client restart")
        self.clients[actor] = client
        enter_chat_page(client)
        self.sync(actor, kind, conversation_id)

    def prove_restart_convergence(
        self,
        kind: str,
        conversation_id: str,
        members: tuple[str, ...],
    ) -> None:
        claim_kind = "direct" if kind == "friend" else "group"
        message_id = self.message_ids[f"{claim_kind}.base"]
        thread_ids = [
            self.message_ids[f"{claim_kind}.thread.first"],
            self.message_ids[f"{claim_kind}.thread.nested"],
        ]
        for actor in members:
            self.sync(actor, kind, conversation_id)
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
                    and snapshot.get("retracted") is True
                    and snapshot.get("pinned") is False
                    and len(snapshot.get("reactions") or []) == 0
                    else None
                ),
                f"{actor} {claim_kind} terminal projection after Station restart",
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
                    and snapshot.get("retracted") == "true"
                    and snapshot.get("pinned") is False
                    and len(snapshot.get("reactions") or []) == 0
                    else None
                ),
                f"{actor} {claim_kind} terminal DOM after Station restart",
                STEP_TIMEOUT,
            )
            async_harness(
                self.clients[actor],
                "openInteractionThread",
                {
                    "conversationId": conversation_id,
                    "kind": kind,
                    "messageId": message_id,
                },
            )
            wait_until(
                lambda actor=actor: (
                    snapshot
                    if (
                        snapshot := thread_dom_snapshot(self.clients[actor])
                    )
                    and snapshot.get("rootMessageId") == message_id
                    and snapshot.get("replyMessageIds") == thread_ids
                    and snapshot.get("orders") == [0, 1, 2]
                    else None
                ),
                f"{actor} {claim_kind} thread panel after Station restart",
                STEP_TIMEOUT,
            )

    def prove_removed_group_member(self, conversation_id: str) -> None:
        prefix = f"group-removed-{time.time_ns()}"
        base = self.send(
            "alice",
            "group",
            conversation_id,
            f"{prefix}-base",
        )
        message_id = str(base["messageId"])
        for actor in ACTORS:
            self.sync(actor, "group", conversation_id)
            wait_until(
                lambda actor=actor: message_dom_snapshot(
                    self.clients[actor],
                    message_id,
                ),
                f"{actor} Group removal seed DOM",
                STEP_TIMEOUT,
            )

        removed = async_harness(
            self.clients["alice"],
            "removeGroupMember",
            {
                "groupUlid": conversation_id,
                "memberDid": self.ptids["charlie"],
            },
            timeout=120,
        )
        if not (removed or {}).get("success"):
            raise GateError("Charlie Group removal did not succeed")
        before_denied = station_readback(conversation_id, message_id)
        self.expect_rejected(
            lambda: async_harness(
                self.clients["charlie"],
                "submitMetadataInteraction",
                {
                    "conversationId": conversation_id,
                    "kind": "group",
                    "messageId": message_id,
                    "interaction": "reaction",
                    "reaction": "🚫",
                    "remove": False,
                },
            ),
            "removed Group member submits interaction",
        )
        after_denied = station_readback(conversation_id, message_id)
        if station_mutation_fingerprint(before_denied) != station_mutation_fingerprint(
            after_denied
        ):
            raise GateError("removed Group member mutated authority or queue")

        async_harness(
            self.clients["alice"],
            "submitMetadataInteraction",
            {
                "conversationId": conversation_id,
                "kind": "group",
                "messageId": message_id,
                "interaction": "reaction",
                "reaction": "✅",
                "remove": False,
            },
        )
        wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := self.projection(
                        "bob",
                        "group",
                        conversation_id,
                        message_id,
                    )
                )
                and len(snapshot.get("reactions") or []) == 1
                else None
            ),
            "Bob receives post-removal Group interaction",
            STEP_TIMEOUT,
        )
        after_allowed = station_readback(conversation_id, message_id)
        charlie_before = recipient_queue_item_ids(
            before_denied,
            self.ptids["charlie"],
            self.device_ids["charlie"],
        )
        charlie_after = recipient_queue_item_ids(
            after_allowed,
            self.ptids["charlie"],
            self.device_ids["charlie"],
        )
        if charlie_after != charlie_before:
            raise GateError("removed Group member received a future queue item")
        charlie_dom = message_dom_snapshot(self.clients["charlie"], message_id)
        if charlie_dom and charlie_dom.get("reactions"):
            raise GateError("removed Group member observed a future interaction")
        self.station_evidence["group.removed"] = after_allowed
        self.assert_condition("group_removed_member_denied", True)

    def prove_revoked_device(self, conversation_id: str) -> None:
        prefix = f"direct-revoked-{time.time_ns()}"
        base = self.send(
            "alice",
            "friend",
            conversation_id,
            f"{prefix}-base",
        )
        message_id = str(base["messageId"])
        for actor in ("alice", "bob"):
            self.sync(actor, "friend", conversation_id)
            wait_until(
                lambda actor=actor: message_dom_snapshot(
                    self.clients[actor],
                    message_id,
                ),
                f"{actor} revoked-device seed DOM",
                STEP_TIMEOUT,
            )

        revoked = async_harness(
            self.clients["bob"],
            "revokeCurrentDevice",
            {},
        )
        if (
            (revoked or {}).get("revoked") is not True
            or (revoked or {}).get("deviceId") != self.device_ids["bob"]
        ):
            raise GateError("Bob current-device revocation did not succeed")
        before_denied = station_readback(conversation_id, message_id)
        self.expect_rejected(
            lambda: async_harness(
                self.clients["bob"],
                "submitMetadataInteraction",
                {
                    "conversationId": conversation_id,
                    "kind": "friend",
                    "messageId": message_id,
                    "interaction": "reaction",
                    "reaction": "🚫",
                    "remove": False,
                },
            ),
            "revoked device submits interaction",
        )
        after_denied = station_readback(conversation_id, message_id)
        if station_mutation_fingerprint(before_denied) != station_mutation_fingerprint(
            after_denied
        ):
            raise GateError("revoked device mutated authority or queue")

        async_harness(
            self.clients["alice"],
            "submitMetadataInteraction",
            {
                "conversationId": conversation_id,
                "kind": "friend",
                "messageId": message_id,
                "interaction": "reaction",
                "reaction": "✅",
                "remove": False,
            },
        )
        wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := self.projection(
                        "alice",
                        "friend",
                        conversation_id,
                        message_id,
                    )
                )
                and len(snapshot.get("reactions") or []) == 1
                else None
            ),
            "Alice post-revocation Direct interaction",
            STEP_TIMEOUT,
        )
        after_allowed = station_readback(conversation_id, message_id)
        bob_before = recipient_queue_item_ids(
            before_denied,
            self.ptids["bob"],
            self.device_ids["bob"],
        )
        bob_after = recipient_queue_item_ids(
            after_allowed,
            self.ptids["bob"],
            self.device_ids["bob"],
        )
        if bob_after != bob_before:
            raise GateError("revoked device received a future queue item")
        bob_dom = message_dom_snapshot(self.clients["bob"], message_id)
        if bob_dom and bob_dom.get("reactions"):
            raise GateError("revoked device observed a future interaction")
        self.station_evidence["direct.revoked"] = after_allowed
        self.assert_condition("revoked_device_denied", True)

    def restart_station(self) -> None:
        try:
            self.restart_evidence = restart_profile_three_station(
                self.station_url,
                self.tested_commit,
            )
        except RuntimeError as error:
            raise GateError(str(error)) from error

    @staticmethod
    def port_is_free(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
            return connection.connect_ex(("127.0.0.1", port)) != 0

    def run(self) -> dict[str, Any]:
        if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")
        try:
            profile_three_environment(self.station_url)
        except RuntimeError as error:
            raise GateError(str(error)) from error
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
            self.prove_lifecycle("friend", direct_id, ("alice", "bob"))
            self.prove_pending_timeout_retry("friend", direct_id)
            self.prove_offline_recovery("friend", direct_id, ())

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
            self.prove_pending_timeout_retry("group", group_id)
            self.assert_condition("pending_interaction_timeout_retry", True)
            self.prove_offline_recovery("group", group_id, ("charlie",))

            self.step("station.restart", self.restart_station)
            self.prove_restart_convergence(
                "friend",
                direct_id,
                ("alice", "bob"),
            )
            self.prove_restart_convergence(
                "group",
                group_id,
                ACTORS,
            )
            self.assert_condition("station_restart_convergence", True)
            self.prove_removed_group_member(group_id)
            self.prove_revoked_device(direct_id)
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
        ports = sorted(
            {
                port
                for client in self.clients.values()
                for port in (client.port, client.gateway_port)
            }
        )
        released = bool(
            wait_until(
                lambda: all(self.port_is_free(port) for port in ports),
                "Native interaction client port release",
                30,
                0.25,
            )
        )
        self.cleanup_evidence = {
            "ports": ports,
            "allPortsReleased": released,
            "clientsStopped": sorted(self.clients),
        }
        self.assert_condition("resources_released", released)

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
            "timeoutRetry": self.timeout_retry_evidence,
            "stationRestart": self.restart_evidence,
            "cleanup": self.cleanup_evidence,
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
