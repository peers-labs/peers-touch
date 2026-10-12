from __future__ import annotations

import hashlib
import json
import tempfile
import time
from pathlib import Path
from typing import Any

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_file_picker import select_native_file
from tooling.acceptance.gates.chat.native_support import wait_until
from tooling.acceptance.gates.chat.native_two_client_runner import (
    message_snapshot,
    send_text,
)


ATTACHMENT_BYTES = 32 * 1024 * 1024
ATTACHMENT_CHUNK = (
    b"peers-touch-node-connectivity-circuit-attachment-v1\n"
) * 2048


def write_attachment(path: Path) -> str:
    digest = hashlib.sha256()
    remaining = ATTACHMENT_BYTES
    with path.open("wb") as output:
        while remaining:
            chunk = ATTACHMENT_CHUNK[:remaining]
            output.write(chunk)
            digest.update(chunk)
            remaining -= len(chunk)
    if path.stat().st_size != ATTACHMENT_BYTES:
        raise GateError("32 MiB attachment fixture has the wrong size")
    return digest.hexdigest()


class NodeConnectivityNativeJourneyMixin:
    def _active_conversation_id(self) -> str:
        identities = {
            str(
                client.find_element(
                    "[data-chat-conversation-pane]",
                    30,
                ).get_attribute("data-chat-conversation-pane")
                or ""
            )
            for client in self.clients.values()
        }
        if len(identities) != 1 or not next(iter(identities), ""):
            raise GateError(
                "Native clients do not share one active conversation"
            )
        return identities.pop()

    def _prove_persistent_identity_state(self) -> dict[str, Any]:
        evidence = {
            actor: {
                "storageRoot": str(
                    self.client_specs[actor].get("storage_root") or ""
                ),
                "storageLifecycle": str(
                    self.client_specs[actor].get("storage_lifecycle") or ""
                ),
                "devicePolicy": str(
                    self.actor_specs[actor].get("devicePolicy") or ""
                ),
            }
            for actor in ("alice", "bob")
        }
        roots = [
            Path(item["storageRoot"]) for item in evidence.values()
        ]
        self.assert_condition(
            "native_actor_identity_state_persistent",
            len(set(roots)) == 2
            and all(
                item["storageLifecycle"] == "persistent"
                and item["devicePolicy"] == "persistent-acceptance"
                and root.is_dir()
                and not root.is_symlink()
                for item, root in zip(evidence.values(), roots)
            ),
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    def _prove_read_receipt(self) -> dict[str, Any]:
        text = f"ncp-native-read-{time.time_ns()}"
        sent = send_text(self.clients["alice"], text)
        message_id = str(sent.get("messageUlid") or "")
        received = wait_until(
            lambda: message_snapshot(self.clients["bob"], text),
            "Bob receiver-visible Native plaintext",
            timeout=120,
        )
        read = wait_until(
            lambda: (
                snapshot
                if (
                    snapshot := message_snapshot(
                        self.clients["alice"],
                        text,
                    )
                )
                and snapshot.get("receipt") == "read"
                else None
            ),
            "Alice sender-visible READ receipt",
            timeout=120,
        )
        evidence = {
            "messageId": message_id,
            "sender": read,
            "receiver": received,
        }
        self.assert_condition(
            "native_text_read",
            bool(message_id)
            and received.get("messageUlid") == message_id
            and read.get("messageUlid") == message_id
            and read.get("receipt") == "read",
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    @staticmethod
    def _composer_outcome(
        client: TauriSession,
        conversation_id: str,
        after_revision: int,
    ) -> dict[str, Any] | None:
        composer = client.find_element(
            f'[data-chat-composer="{conversation_id}"]',
            5,
        )
        revision = int(
            composer.get_attribute("data-chat-send-outcome-revision") or 0
        )
        if revision <= after_revision:
            return None
        return {
            "revision": revision,
            "state": composer.get_attribute(
                "data-chat-send-outcome-state"
            )
            or "",
            "messageId": composer.get_attribute(
                "data-chat-send-outcome-message-id"
            )
            or "",
            "attachmentIds": [
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

    @staticmethod
    def _attachment_snapshot(
        client: TauriSession,
        message_id: str,
        attachment_id: str,
    ) -> dict[str, Any] | None:
        value = client.execute_script(
            """
            const messageId = arguments[0];
            const attachmentId = arguments[1];
            const row = document.querySelector(
              `[data-message-ulid="${CSS.escape(messageId)}"]`
            );
            const attachment = row?.querySelector(
              `[data-messaging-attachment-id="${CSS.escape(attachmentId)}"]`
            );
            if (!row || !attachment) return null;
            const rect = attachment.getBoundingClientRect();
            return {
              messageId: row.getAttribute('data-message-ulid') || '',
              attachmentId:
                attachment.getAttribute('data-messaging-attachment-id') || '',
              kind:
                attachment.getAttribute('data-messaging-attachment-kind') || '',
              state:
                attachment.getAttribute('data-messaging-attachment-state') || '',
              openState:
                attachment.getAttribute(
                  'data-messaging-attachment-open-state'
                ) || '',
              visible: rect.width > 0 && rect.height > 0,
            };
            """,
            message_id,
            attachment_id,
        )
        return value if isinstance(value, dict) else None

    def _open_attachment(
        self,
        actor: str,
        attachment_id: str,
    ) -> Path:
        from tooling.acceptance.gates.chat.native_support import async_harness

        value = async_harness(
            self.clients[actor],
            "openAttachment",
            {
                "actorPtid": self.ptids[actor],
                "attachmentId": attachment_id,
            },
            timeout=60,
        )
        local_path = (
            str(value.get("localPath") or "")
            if isinstance(value, dict)
            else ""
        )
        if not local_path:
            raise GateError("Native attachment readback returned no local path")
        return Path(local_path)

    def _prove_attachment(self) -> dict[str, Any]:
        conversation_id = self._active_conversation_id()
        sender = self.clients["alice"]
        receiver = self.clients["bob"]
        with tempfile.TemporaryDirectory(
            prefix="pt-ncp-native-attachment-"
        ) as raw:
            source_path = Path(raw) / "ncp-native-32m.bin"
            source_sha256 = write_attachment(source_path)
            composer = sender.find_element(
                f'[data-chat-composer="{conversation_id}"]',
                30,
            )
            previous_revision = int(
                composer.get_attribute(
                    "data-chat-send-outcome-revision"
                )
                or 0
            )
            trigger = sender.find_element(
                "[data-chat-attachment-picker]",
                30,
            )
            if not trigger.is_displayed() or not trigger.is_enabled():
                raise GateError(
                    "Alice Native attachment picker is not actionable"
                )
            selection = self.step(
                "attachment.upload",
                lambda: select_native_file(
                    actor="alice",
                    client=sender,
                    sessions=tuple(self.clients.values()),
                    runtime_binding=self.runtime_binding,
                    source_path=source_path,
                    trigger=trigger.click,
                ),
                "alice",
            )
            wait_until(
                lambda: (
                    drafts
                    if len(
                        drafts := sender.find_elements(
                            '[data-chat-attachment-draft]'
                            '[data-chat-attachment-status="ready"]'
                        )
                    )
                    == 1
                    else None
                ),
                "Alice 32 MiB attachment draft",
                timeout=120,
            )
            sender.find_element("[data-chat-send]", 30).click()
            outcome = wait_until(
                lambda: self._composer_outcome(
                    sender,
                    conversation_id,
                    previous_revision,
                ),
                "Alice Native attachment send outcome",
                timeout=180,
            )
            if (
                outcome.get("state") != "pending"
                or not outcome.get("messageId")
                or len(outcome.get("attachmentIds") or []) != 1
            ):
                raise GateError(
                    "Native attachment send outcome is incomplete: "
                    f"{json.dumps(outcome, sort_keys=True)}"
                )
            message_id = str(outcome["messageId"])
            attachment_id = str(outcome["attachmentIds"][0])
            receiver_snapshot = self.step(
                "attachment.received",
                lambda: wait_until(
                    lambda: (
                        snapshot
                        if (
                            snapshot := self._attachment_snapshot(
                                receiver,
                                message_id,
                                attachment_id,
                            )
                        )
                        and snapshot.get("visible") is True
                        else None
                    ),
                    "Bob receiver-visible 32 MiB attachment",
                    timeout=180,
                ),
                "bob",
            )
            attachment_element = receiver.find_element(
                f'[data-message-ulid="{message_id}"] '
                f'[data-messaging-attachment-id="{attachment_id}"]',
                30,
            )
            self.step(
                "attachment.opened",
                attachment_element.click,
                "bob",
            )
            opened_snapshot = wait_until(
                lambda: (
                    snapshot
                    if (
                        snapshot := self._attachment_snapshot(
                            receiver,
                            message_id,
                            attachment_id,
                        )
                    )
                    and snapshot.get("openState") == "ready"
                    else None
                ),
                "Bob opened Native attachment",
                timeout=180,
            )
            local_path = self._open_attachment("bob", attachment_id)
            receiver_sha256 = self.step(
                "attachment.digest",
                lambda: self.runtime_binding.native_file_sha256(
                    "bob",
                    local_path,
                ),
                "bob",
            )
            evidence = {
                "conversationId": conversation_id,
                "messageId": message_id,
                "attachmentId": attachment_id,
                "byteLength": ATTACHMENT_BYTES,
                "selection": selection,
                "sendOutcome": outcome,
                "receiverSnapshot": receiver_snapshot,
                "openedSnapshot": opened_snapshot,
                "sourceSha256": source_sha256,
                "receiverSha256": receiver_sha256,
            }
            self.assert_condition(
                "native_attachment_receiver_visible",
                receiver_snapshot.get("visible") is True
                and opened_snapshot.get("openState") == "ready",
                json.dumps(evidence, sort_keys=True),
            )
            self.assert_condition(
                "native_attachment_byte_exact",
                selection.get("size") == ATTACHMENT_BYTES
                and receiver_sha256 == source_sha256,
                json.dumps(evidence, sort_keys=True),
            )
            return evidence
