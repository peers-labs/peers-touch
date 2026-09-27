#!/usr/bin/env python3
"""Prove authoritative presence and stable Chat geometry on Native Desktop."""

from __future__ import annotations

import json
import time
from typing import Any

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.fixtures.chat_presence_fault_proxy import (
    AcceptanceStationPresenceFaultProxy,
)
from tooling.acceptance.gates.chat.native_support import (
    async_harness,
    runtime_station_service,
    selected_native_runtime,
    wait_until,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    PRESENCE_LAYOUT_GATE_ID,
    NativeTwoClientGate,
    message_snapshot,
)


GATE_ID = PRESENCE_LAYOUT_GATE_ID
REPORT_PATH = None
STEP_TIMEOUT = 120.0
PRESENCE_LEASE_SECONDS = 90.0
PRESENCE_OBSERVATION_SECONDS = 95.0
UNREAD_OVERFLOW_TARGET = 100
UNREAD_DELIVERY_CHUNK_SIZE = 10
GEOMETRY_TOLERANCE_PX = 0.75
REQUIRED_PRESENCE_LAYOUT_ASSERTIONS = {
    "presence_cross_station_authority",
    "presence_bilateral_authoritative",
    "presence_focus_independent",
    "presence_lease_renewal",
    "presence_unknown_preserved",
    "presence_recovered_after_unavailable",
    "session_unread_geometry_stable",
    "session_unread_capped",
    "message_metadata_geometry_stable",
    "message_scroll_anchor_stable",
    "message_pending_interaction_slot_reserved",
    "message_emoji_geometry_bounded",
}


def _rect_equal(
    left: object,
    right: object,
    *,
    keys: tuple[str, ...],
    tolerance: float = GEOMETRY_TOLERANCE_PX,
) -> bool:
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    return all(
        abs(float(left.get(key, 0)) - float(right.get(key, 0)))
        <= tolerance
        for key in keys
    )


def conversation_geometry_equal(
    before: object,
    after: object,
) -> bool:
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    return all(
        _rect_equal(
            before.get(part),
            after.get(part),
            keys=("left", "top", "width", "height"),
        )
        for part in ("row", "text", "lane")
    )


def message_geometry_equal(
    before: object,
    after: object,
    message_ids: tuple[str, ...],
) -> bool:
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    before_rows = before.get("rows")
    after_rows = after.get("rows")
    if not isinstance(before_rows, dict) or not isinstance(after_rows, dict):
        return False
    for message_id in message_ids:
        previous = before_rows.get(message_id)
        current = after_rows.get(message_id)
        if not isinstance(previous, dict) or not isinstance(current, dict):
            return False
        if not _rect_equal(
            previous.get("row"),
            current.get("row"),
            keys=("top", "bottom", "height"),
        ):
            return False
        if not _rect_equal(
            previous.get("rail"),
            current.get("rail"),
            keys=("top", "bottom", "height"),
        ):
            return False
    return True


def scroll_anchor_equal(before: object, after: object) -> bool:
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    return (
        before.get("anchorId") == after.get("anchorId")
        and abs(
            float(before.get("anchorOffset", 0))
            - float(after.get("anchorOffset", 0))
        )
        <= GEOMETRY_TOLERANCE_PX
        and abs(
            float(before.get("scrollTop", 0))
            - float(after.get("scrollTop", 0))
        )
        <= GEOMETRY_TOLERANCE_PX
    )


class LifecyclePresenceLayoutGate(NativeTwoClientGate):
    gate_id = GATE_ID
    phase = "CHAT-W04A"
    bom = ("CHAT-G04", "CHAT-G05", "CHAT-G08", "CHAT-UR14", "CHAT-UR15", "CHAT-UR16")
    spec = ("CHAT-J02", "chat-presence-layout-stability")
    report_path = REPORT_PATH

    def __init__(
        self,
        *,
        manifest: dict[str, Any],
        actor_manifest: dict[str, Any],
        runtime_binding: NativeDesktopRuntimeBinding,
    ) -> None:
        super().__init__(
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=runtime_binding,
            gate_id=GATE_ID,
        )
        self.conversation_id = ""

    def open_conversation(self) -> str:
        self.conversation_id = super().open_conversation()
        return self.conversation_id

    @staticmethod
    def _presence_surface(client: TauriSession) -> dict[str, Any] | None:
        value = client.execute_script(
            """
            const presence = document.querySelector('[data-chat-presence-tag]');
            return presence ? {
              tag: presence.getAttribute('data-chat-presence-tag') || '',
              source: presence.getAttribute('data-chat-presence-source') || '',
              label: presence.getAttribute('aria-label') || '',
              documentFocused: document.hasFocus(),
              visibilityState: document.visibilityState,
            } : null;
            """
        )
        return value if isinstance(value, dict) else None

    def _presence_observation(
        self,
        viewer: str,
        peer: str,
    ) -> dict[str, Any]:
        snapshot = async_harness(
            self.clients[viewer],
            "presenceSnapshot",
            {"actorPtids": [self.ptids[peer]]},
            timeout=15,
        )
        statuses = (
            snapshot.get("statuses")
            if isinstance(snapshot, dict)
            else None
        )
        status = statuses[0] if isinstance(statuses, list) and len(statuses) == 1 else None
        return {
            "viewer": viewer,
            "peer": peer,
            "peerPtid": self.ptids[peer],
            "online": (
                status.get("online")
                if isinstance(status, dict)
                and status.get("actorPtid") == self.ptids[peer]
                else None
            ),
            "surface": self._presence_surface(self.clients[viewer]),
        }

    def _bilateral_presence(self) -> dict[str, Any]:
        observations = {
            "alice": self._presence_observation("alice", "bob"),
            "bob": self._presence_observation("bob", "alice"),
        }
        valid = all(
            observation.get("online") is True
            and isinstance(observation.get("surface"), dict)
            and observation["surface"].get("tag") == "online"
            and observation["surface"].get("source") == "station"
            for observation in observations.values()
        )
        return {"valid": valid, "observations": observations}

    @staticmethod
    def _conversation_geometry(
        client: TauriSession,
        conversation_id: str,
    ) -> dict[str, Any] | None:
        value = client.execute_script(
            """
            const conversationId = arguments[0];
            const row = document.querySelector(
              `[data-pt-conversation-item="${CSS.escape(conversationId)}"]`
            );
            const lane = row?.querySelector('[data-chat-session-unread-lane]');
            const text = lane?.previousElementSibling;
            const rect = (element) => {
              const value = element?.getBoundingClientRect();
              return value ? {
                left: value.left,
                top: value.top,
                width: value.width,
                height: value.height,
              } : null;
            };
            return row && lane && text ? {
              unread: Number(
                row.getAttribute('data-chat-conversation-unread') || '0'
              ),
              badgeText: lane.textContent?.trim() || '',
              row: rect(row),
              text: rect(text),
              lane: rect(lane),
            } : null;
            """,
            conversation_id,
        )
        return value if isinstance(value, dict) else None

    def _conversation_summary(
        self,
        actor: str,
        conversation_id: str,
    ) -> dict[str, Any] | None:
        value = async_harness(
            self.clients[actor],
            "engineConversations",
            {"actorPtid": self.ptids[actor]},
        )
        conversations = (
            value.get("conversations")
            if isinstance(value, dict)
            else None
        )
        if not isinstance(conversations, list):
            return None
        return next(
            (
                conversation
                for conversation in conversations
                if isinstance(conversation, dict)
                and conversation.get("conversationId") == conversation_id
            ),
            None,
        )

    @staticmethod
    def _message_geometry(
        client: TauriSession,
        message_ids: tuple[str, ...],
    ) -> dict[str, Any] | None:
        value = client.execute_script(
            """
            const ids = arguments[0];
            const viewport = document.querySelector('.chat-message-scroll');
            if (!viewport) return null;
            const viewportRect = viewport.getBoundingClientRect();
            const rect = (element) => {
              const value = element?.getBoundingClientRect();
              return value ? {
                left: value.left,
                right: value.right,
                top: value.top,
                bottom: value.bottom,
                width: value.width,
                height: value.height,
              } : null;
            };
            const rows = Object.fromEntries(ids.map((id) => {
              const row = document.querySelector(
                `[data-message-ulid="${CSS.escape(id)}"]`
              );
              const rail = row?.querySelector(
                `[data-message-metadata-rail="${CSS.escape(id)}"]`
              );
              return [id, row && rail ? {
                row: rect(row),
                rail: rect(rail),
                railState:
                  rail.getAttribute('data-message-metadata-state') || '',
                reactionState: rail.querySelector(
                  '[data-message-reaction-state]'
                )?.getAttribute('data-message-reaction-state') || '',
                reactionCount:
                  rail.querySelectorAll('[data-message-reaction]').length,
                threadReplyCount: Number(
                  row.getAttribute('data-message-thread-reply-count') || '0'
                ),
              } : null];
            }));
            const visible = Array.from(
              document.querySelectorAll('[data-message-ulid]')
            ).find((row) => {
              const rowRect = row.getBoundingClientRect();
              return rowRect.bottom > viewportRect.top
                && rowRect.top < viewportRect.bottom;
            });
            const visibleRect = visible?.getBoundingClientRect();
            return {
              rows,
              scrollTop: viewport.scrollTop,
              anchorId: visible?.getAttribute('data-message-ulid') || '',
              anchorOffset: visibleRect
                ? visibleRect.top - viewportRect.top
                : 0,
            };
            """,
            list(message_ids),
        )
        return value if isinstance(value, dict) else None

    def _prove_focus_independent_presence(
        self,
        started_at: float,
    ) -> dict[str, Any]:
        initial = wait_until(
            lambda: (
                snapshot
                if (snapshot := self._bilateral_presence()).get("valid")
                else None
            ),
            "bilateral authoritative online presence",
            timeout=STEP_TIMEOUT,
        )
        self.assert_condition(
            "presence_bilateral_authoritative",
            initial.get("valid") is True,
            json.dumps(initial, sort_keys=True),
        )

        stations = {
            actor: runtime_station_service(self.manifest, actor)
            for actor in ("alice", "bob")
        }
        station_endpoints = {
            str(station.get("endpoint") or "")
            for station in stations.values()
        }
        station_identities = {
            str(station.get("runtimeIdentity") or "")
            for station in stations.values()
        }
        self.assert_condition(
            "presence_cross_station_authority",
            len(station_endpoints) == 2
            and "" not in station_endpoints
            and len(station_identities) == 2
            and "" not in station_identities,
            json.dumps(stations, sort_keys=True),
        )

        focus_samples: list[dict[str, Any]] = []
        sessions = tuple(self.clients.values())
        for actor in ("alice", "bob", "alice"):
            client = self.clients[actor]
            if not self.runtime_binding.request_cooperative_activation(
                client,
                sessions,
            ):
                raise GateError(
                    "desktop-macos-native must support cooperative activation"
                )
            wait_until(
                lambda: client.driver.execute_script(
                    "return document.hasFocus()"
                ),
                f"{actor} native window focus",
                timeout=15,
                interval=0.1,
            )
            focus_samples.append(
                wait_until(
                    lambda: (
                        snapshot
                        if (snapshot := self._bilateral_presence()).get("valid")
                        else None
                    ),
                    f"bilateral presence after focusing {actor}",
                    timeout=STEP_TIMEOUT,
                )
            )
        self.assert_condition(
            "presence_focus_independent",
            len(focus_samples) == 3
            and all(sample.get("valid") is True for sample in focus_samples),
            json.dumps(focus_samples, sort_keys=True),
        )
        return {
            "initial": initial,
            "focusSamples": focus_samples,
        }

    def _prove_unknown_and_recovery(self) -> dict[str, Any]:
        actor = "alice"
        peer = "bob"
        station = runtime_station_service(self.manifest, actor)
        proxy = AcceptanceStationPresenceFaultProxy(
            str(station.get("endpoint") or ""),
            str(station.get("deploymentEnvironment") or "") or None,
        )
        handle = None
        failure = ""
        proxy.start()
        try:
            handle = self.runtime_binding.create_transport_override(
                actor,
                "station",
                proxy.url,
            )
            self.runtime_binding.apply_transport_override(
                actor,
                "station",
                handle,
            )
            proxy.arm_query_failure()
            try:
                async_harness(
                    self.clients[actor],
                    "presenceSnapshot",
                    {"actorPtids": [self.ptids[peer]]},
                    timeout=15,
                )
            except Exception as error:  # noqa: BLE001
                failure = str(error)
            if not failure:
                raise GateError("injected presence query outage did not fail")
            unknown = wait_until(
                lambda: (
                    surface
                    if (
                        isinstance(
                            surface := self._presence_surface(
                                self.clients[actor]
                            ),
                            dict,
                        )
                        and surface.get("tag") == "unknown"
                        and surface.get("source") == "station"
                    )
                    else None
                ),
                "unknown presence after authority outage",
                timeout=15,
                interval=0.1,
            )
            proxy_evidence = proxy.evidence()
            self.assert_condition(
                "presence_unknown_preserved",
                proxy_evidence.get("interceptedCount", 0) >= 1
                and unknown.get("tag") == "unknown",
                json.dumps(
                    {
                        "failure": failure,
                        "surface": unknown,
                        "proxy": proxy_evidence,
                    },
                    sort_keys=True,
                ),
            )
        finally:
            proxy.disarm()
            if handle is not None:
                self.runtime_binding.clear_transport_override(
                    actor,
                    "station",
                    handle,
                )
            proxy.stop()

        recovered = wait_until(
            lambda: (
                snapshot
                if (snapshot := self._bilateral_presence()).get("valid")
                else None
            ),
            "bilateral presence recovery",
            timeout=STEP_TIMEOUT,
        )
        self.assert_condition(
            "presence_recovered_after_unavailable",
            recovered.get("valid") is True,
            json.dumps(recovered, sort_keys=True),
        )
        return {
            "failure": failure,
            "proxy": proxy_evidence,
            "recovered": recovered,
        }

    def _send_message(
        self,
        actor: str,
        content: str,
        *,
        thread_root: str = "",
    ) -> dict[str, Any]:
        value = async_harness(
            self.clients[actor],
            "sendInteractionMessage",
            {
                "conversationId": self.conversation_id,
                "kind": "friend",
                "content": content,
                "threadRootMessageId": thread_root,
            },
        )
        if not isinstance(value, dict) or not value.get("messageId"):
            raise GateError("presence/layout message send returned no identity")
        return value

    def _prove_message_geometry(self) -> dict[str, Any]:
        prefix = f"presence-layout-{time.time_ns()}"
        before_message = self._send_message("alice", f"{prefix}-before")
        root_message = self._send_message("alice", f"{prefix}-root")
        emoji_message = self._send_message("alice", "\U0001f642")
        message_ids = (
            str(before_message["messageId"]),
            str(root_message["messageId"]),
            str(emoji_message["messageId"]),
        )
        for actor in ("alice", "bob"):
            async_harness(
                self.clients[actor],
                "syncFriendSession",
                {"sessionUlid": self.conversation_id},
            )
        for message_id in message_ids:
            wait_until(
                lambda message_id=message_id: message_snapshot(
                    self.clients["alice"],
                    next(
                        text
                        for candidate, text in (
                            (message_ids[0], f"{prefix}-before"),
                            (message_ids[1], f"{prefix}-root"),
                            (message_ids[2], "\U0001f642"),
                        )
                        if candidate == message_id
                    ),
                ),
                f"Alice message row {message_id}",
                timeout=STEP_TIMEOUT,
            )

        baseline = wait_until(
            lambda: self._message_geometry(
                self.clients["alice"],
                message_ids,
            ),
            "baseline message geometry",
            timeout=STEP_TIMEOUT,
        )
        root_id = message_ids[1]
        root_before = baseline["rows"][root_id]
        emoji_before = baseline["rows"][message_ids[2]]
        self.assert_condition(
            "message_pending_interaction_slot_reserved",
            root_before.get("railState") == "reserved"
            and root_before.get("reactionState") == "idle"
            and float((root_before.get("rail") or {}).get("height") or 0) > 0,
            json.dumps(root_before, sort_keys=True),
        )
        self.assert_condition(
            "message_emoji_geometry_bounded",
            emoji_before.get("railState") == "reserved"
            and _rect_equal(
                root_before.get("rail"),
                emoji_before.get("rail"),
                keys=("height",),
            ),
            json.dumps(emoji_before, sort_keys=True),
        )

        async_harness(
            self.clients["bob"],
            "submitMetadataInteraction",
            {
                "conversationId": self.conversation_id,
                "kind": "friend",
                "messageId": root_id,
                "interaction": "reaction",
                "reaction": "\U0001f44d",
            },
        )

        def reaction_ready() -> dict[str, Any] | None:
            projection = async_harness(
                self.clients["alice"],
                "interactionProjection",
                {
                    "conversationId": self.conversation_id,
                    "kind": "friend",
                    "messageId": root_id,
                },
            )
            reactions = (
                projection.get("reactions")
                if isinstance(projection, dict)
                else None
            )
            return (
                projection
                if isinstance(reactions, list)
                and any(
                    isinstance(reaction, dict)
                    and reaction.get("emoji") == "\U0001f44d"
                    for reaction in reactions
                )
                else None
            )

        reaction_projection = wait_until(
            reaction_ready,
            "reaction authority projection",
            timeout=STEP_TIMEOUT,
        )
        after_reaction = wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self._message_geometry(
                            self.clients["alice"],
                            message_ids,
                        ),
                        dict,
                    )
                    and (
                        snapshot.get("rows", {})
                        .get(root_id, {})
                        .get("reactionCount", 0)
                    )
                    >= 1
                )
                else None
            ),
            "populated reaction metadata rail",
            timeout=STEP_TIMEOUT,
        )

        thread = self._send_message(
            "bob",
            f"{prefix}-thread",
            thread_root=root_id,
        )
        thread_id = str(thread["messageId"])

        def thread_ready() -> dict[str, Any] | None:
            projection = async_harness(
                self.clients["alice"],
                "interactionProjection",
                {
                    "conversationId": self.conversation_id,
                    "kind": "friend",
                    "messageId": thread_id,
                    "threadRootMessageId": root_id,
                },
            )
            return (
                projection
                if isinstance(projection, dict)
                and projection.get("threadRootMessageId") == root_id
                else None
            )

        thread_projection = wait_until(
            thread_ready,
            "thread authority projection",
            timeout=STEP_TIMEOUT,
        )
        after_thread = wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self._message_geometry(
                            self.clients["alice"],
                            message_ids,
                        ),
                        dict,
                    )
                    and (
                        snapshot.get("rows", {})
                        .get(root_id, {})
                        .get("threadReplyCount", 0)
                    )
                    >= 1
                )
                else None
            ),
            "populated thread metadata rail",
            timeout=STEP_TIMEOUT,
        )

        stable_geometry = (
            message_geometry_equal(baseline, after_reaction, message_ids)
            and message_geometry_equal(after_reaction, after_thread, message_ids)
        )
        stable_anchor = (
            scroll_anchor_equal(baseline, after_reaction)
            and scroll_anchor_equal(after_reaction, after_thread)
        )
        evidence = {
            "messageIds": list(message_ids),
            "threadMessageId": thread_id,
            "baseline": baseline,
            "afterReaction": after_reaction,
            "afterThread": after_thread,
            "reactionProjection": reaction_projection,
            "threadProjection": thread_projection,
        }
        self.assert_condition(
            "message_metadata_geometry_stable",
            stable_geometry,
            json.dumps(evidence, sort_keys=True),
        )
        self.assert_condition(
            "message_scroll_anchor_stable",
            stable_anchor,
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    def _prove_unread_geometry(self) -> dict[str, Any]:
        receiver = "bob"
        sender = "alice"
        receiver_client = self.clients[receiver]
        last_observation: dict[str, Any] = {}

        def wait_for_unread_projection(
            target: int,
            description: str,
            *,
            exact: bool = False,
            badge_text: str | None = None,
        ) -> dict[str, Any]:
            def observe() -> dict[str, Any] | None:
                nonlocal last_observation
                summary = self._conversation_summary(
                    receiver,
                    self.conversation_id,
                )
                geometry = self._conversation_geometry(
                    receiver_client,
                    self.conversation_id,
                )
                authoritative_unread = int(
                    ((summary or {}).get("summary") or {}).get(
                        "unreadCount",
                        0,
                    )
                )
                rendered_unread = int(
                    (geometry or {}).get("unread") or 0
                )
                last_observation = {
                    "summary": summary,
                    "geometry": geometry,
                    "targetUnread": target,
                }
                counts_match = (
                    authoritative_unread == target
                    and rendered_unread == target
                    if exact
                    else authoritative_unread >= target
                    and rendered_unread >= target
                )
                badge_matches = (
                    badge_text is None
                    or (geometry or {}).get("badgeText") == badge_text
                )
                return (
                    last_observation
                    if isinstance(geometry, dict)
                    and counts_match
                    and badge_matches
                    else None
                )

            try:
                return wait_until(
                    observe,
                    description,
                    timeout=STEP_TIMEOUT,
                )
            except GateError as error:
                raise GateError(
                    f"{error}; last={json.dumps(last_observation, sort_keys=True)}"
                ) from error

        async_harness(
            receiver_client,
            "syncFriendSession",
            {"sessionUlid": self.conversation_id},
        )
        async_harness(
            receiver_client,
            "submitReadCursor",
            {
                "conversationId": self.conversation_id,
                "kind": "friend",
            },
        )

        def zero_unread() -> dict[str, Any] | None:
            geometry = self._conversation_geometry(
                receiver_client,
                self.conversation_id,
            )
            return (
                geometry
                if isinstance(geometry, dict)
                and int(geometry.get("unread") or 0) == 0
                else None
            )

        wait_until(
            zero_unread,
            "zero unread conversation row",
            timeout=STEP_TIMEOUT,
        )
        async_harness(receiver_client, "parkConversation", {})
        baseline = wait_until(
            zero_unread,
            "parked zero unread conversation row",
            timeout=STEP_TIMEOUT,
        )

        prefix = f"unread-geometry-{time.time_ns()}"
        first = async_harness(
            self.clients[sender],
            "sendInteractionMessageBatch",
            {
                "conversationId": self.conversation_id,
                "kind": "friend",
                "prefix": prefix,
                "count": 1,
            },
            timeout=STEP_TIMEOUT,
        )
        if not isinstance(first, dict) or int(first.get("count") or 0) != 1:
            raise GateError("single unread message batch failed")
        single_observation = wait_for_unread_projection(
            1,
            "single unread conversation row",
            exact=True,
        )
        single = single_observation["geometry"]
        overflow_batches: list[dict[str, Any]] = []
        next_index = 2
        while next_index <= UNREAD_OVERFLOW_TARGET:
            count = min(
                UNREAD_DELIVERY_CHUNK_SIZE,
                UNREAD_OVERFLOW_TARGET - next_index + 1,
            )
            target_unread = next_index + count - 1
            sent = async_harness(
                self.clients[sender],
                "sendInteractionMessageBatch",
                {
                    "conversationId": self.conversation_id,
                    "kind": "friend",
                    "prefix": prefix,
                    "count": count,
                    "startIndex": next_index,
                },
                timeout=STEP_TIMEOUT,
            )
            if (
                not isinstance(sent, dict)
                or int(sent.get("count") or 0) != count
            ):
                raise GateError(
                    "overflow unread message batch failed at "
                    f"target {target_unread}"
                )
            observation = wait_for_unread_projection(
                target_unread,
                f"unread conversation row target {target_unread}",
                badge_text=(
                    "99+"
                    if target_unread == UNREAD_OVERFLOW_TARGET
                    else None
                ),
            )
            overflow_batches.append(
                {
                    "targetUnread": target_unread,
                    "count": sent.get("count"),
                    "firstMessageId": sent.get("firstMessageId"),
                    "lastMessageId": sent.get("lastMessageId"),
                    "observation": observation,
                }
            )
            next_index += count
        capped = overflow_batches[-1]["observation"]["geometry"]
        evidence = {
            "baseline": baseline,
            "single": single,
            "capped": capped,
            "firstBatch": first,
            "overflowBatches": overflow_batches,
        }
        self.assert_condition(
            "session_unread_geometry_stable",
            conversation_geometry_equal(baseline, single)
            and all(
                conversation_geometry_equal(
                    single,
                    batch["observation"]["geometry"],
                )
                for batch in overflow_batches
            ),
            json.dumps(evidence, sort_keys=True),
        )
        self.assert_condition(
            "session_unread_capped",
            int(capped.get("unread") or 0) >= UNREAD_OVERFLOW_TARGET
            and capped.get("badgeText") == "99+",
            json.dumps(evidence, sort_keys=True),
        )

        receiver_client.find_element(
            f'[data-pt-conversation-item="{self.conversation_id}"]',
            STEP_TIMEOUT,
        ).click()
        wait_until(
            lambda: self._presence_surface(receiver_client),
            "receiver conversation header after unread proof",
            timeout=STEP_TIMEOUT,
        )
        return evidence

    def _prove_presence_lease(
        self,
        started_at: float,
    ) -> dict[str, Any]:
        samples: list[dict[str, Any]] = []

        def lease_observation() -> dict[str, Any] | None:
            elapsed = time.monotonic() - started_at
            try:
                presence = self._bilateral_presence()
            except Exception as error:  # noqa: BLE001
                return {
                    "failed": True,
                    "elapsedSeconds": elapsed,
                    "error": str(error),
                }
            sample = {
                "elapsedSeconds": elapsed,
                "presence": presence,
            }
            samples.append(sample)
            if not presence.get("valid"):
                return {"failed": True, **sample}
            if elapsed >= PRESENCE_OBSERVATION_SECONDS:
                return {"failed": False, **sample}
            return None

        result = wait_until(
            lease_observation,
            "bilateral online presence beyond one lease interval",
            timeout=PRESENCE_OBSERVATION_SECONDS + 30,
            interval=5,
        )
        self.assert_condition(
            "presence_lease_renewal",
            result.get("failed") is False
            and float(result.get("elapsedSeconds") or 0)
            >= PRESENCE_OBSERVATION_SECONDS
            > PRESENCE_LEASE_SECONDS,
            json.dumps(
                {
                    "leaseSeconds": PRESENCE_LEASE_SECONDS,
                    "requiredObservationSeconds": PRESENCE_OBSERVATION_SECONDS,
                    "samples": samples,
                    "result": result,
                },
                sort_keys=True,
            ),
        )
        return {
            "leaseSeconds": PRESENCE_LEASE_SECONDS,
            "requiredObservationSeconds": PRESENCE_OBSERVATION_SECONDS,
            "samples": samples,
            "result": result,
        }

    def prove_additional_journey_assertions(self) -> None:
        if not self.conversation_id:
            raise GateError("presence/layout journey has no Direct conversation")
        started_at = time.monotonic()
        focus = self.step(
            "presence.focus",
            lambda: self._prove_focus_independent_presence(started_at),
        )
        unknown = self.step(
            "presence.unknown",
            self._prove_unknown_and_recovery,
            "alice",
        )
        messages = self.step(
            "layout.message-metadata",
            self._prove_message_geometry,
            "alice",
        )
        unread = self.step(
            "layout.unread",
            self._prove_unread_geometry,
            "bob",
        )
        lease = self.step(
            "presence.lease",
            lambda: self._prove_presence_lease(started_at),
        )
        self.report.runtime["presenceLayout"] = {
            "conversationId": self.conversation_id,
            "focus": focus,
            "unknown": unknown,
            "messages": messages,
            "unread": unread,
            "lease": lease,
        }

    def run(self) -> dict[str, Any]:
        result = super().run()
        assertion_names = {
            assertion.name
            for assertion in self.report.assertions
        }
        missing = REQUIRED_PRESENCE_LAYOUT_ASSERTIONS - assertion_names
        if missing:
            raise GateError(
                f"presence/layout assertions are missing: {sorted(missing)}"
            )
        result["journey"] = "presence-layout-stability"
        self.report.runtime["journey"] = "presence-layout-stability"
        return result


def main() -> int:
    selected = selected_native_runtime(GATE_ID)
    gate: AcceptanceGate = LifecyclePresenceLayoutGate(
        manifest=selected.manifest,
        actor_manifest=selected.actor_manifest,
        runtime_binding=selected.binding,
    )
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
