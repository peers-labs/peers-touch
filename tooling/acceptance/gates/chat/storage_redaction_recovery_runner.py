#!/usr/bin/env python3
"""Prove message redaction remains durable across restart and Recovery."""

from __future__ import annotations

import json
import os
import time
from typing import Any

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.drivers.native import resolve_native_desktop_runtime
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    async_harness,
    enter_chat_page,
    is_native_tauri_url,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    NativeTwoClientGate,
    message_snapshot,
    runtime_manifest,
    send_text,
    wait_until,
)


GATE_ID = "chat-storage-redaction-recovery-e2e"
REDACTION_REQUIRED_ASSERTIONS = {
    "actor_hide_scope",
    "retract_scope",
    "redaction_atomic_commit",
    "redaction_restart_stability",
    "recovery_redaction_reconciliation",
    "redacted_plaintext_absent",
}
REDACTION_REQUIRED_STEPS = {
    "redaction.messages",
    "recovery.archives",
    "redaction.apply",
    "redaction.restart",
    "redaction.restore",
}
MAX_REDACTION_SUBMIT_ATTEMPTS = 3
SELECTORS = {
    "settings_nav": '[data-pt-primary-nav="settings"]',
    "security_section": '[data-pt-section-item="security"]',
    "recovery_generate": "[data-recovery-generate]",
    "recovery_reveal": "[data-recovery-reveal]",
    "recovery_backup": "[data-recovery-backup-create]",
    "recovery_feedback": '[role="dialog"], [role="alertdialog"]',
    "recovery_restore_open": "[data-recovery-restore-open]",
    "recovery_restore_input": "[data-recovery-restore-input]",
    "recovery_restore_submit": "[data-recovery-restore-submit]",
}


def message_dom_snapshot(
    client: TauriSession,
    message_id: str,
) -> dict[str, Any] | None:
    value = client.execute_script(
        """
        const id = arguments[0];
        const row = document.querySelector(
          `[data-message-ulid="${CSS.escape(id)}"]`
        );
        return row ? {
          messageId: id,
          text: row.innerText || '',
          retracted: row.getAttribute('data-message-retracted') || '',
        } : null;
        """,
        message_id,
    )
    return value if isinstance(value, dict) else None


def redaction_snapshot_is_valid(
    snapshot: object,
    *,
    kind: str,
    require_cleanup: bool = True,
) -> bool:
    if not isinstance(snapshot, dict):
        return False
    projection = snapshot.get("projection")
    tombstones = snapshot.get("redactionTombstones")
    cleanup = snapshot.get("redactionCleanup")
    if (
        not isinstance(projection, dict)
        or not isinstance(tombstones, list)
        or not isinstance(cleanup, list)
    ):
        return False
    expected_scope = "actor_hide" if kind == "hidden_for_actor" else "retract"
    matching_tombstones = [
        item
        for item in tombstones
        if isinstance(item, dict)
        and item.get("kind") == kind
        and int(item.get("authoritySequence") or 0) > 0
        and len(str(item.get("authorityEventHash") or "")) == 64
    ]
    matching_cleanup = [
        item
        for item in cleanup
        if isinstance(item, dict)
        and item.get("scopeKind") == expected_scope
        and item.get("state")
        in {
            "deleting_files",
            "compacting",
            "compaction_pending",
            "succeeded",
            "failed_retryable",
            "failed_terminal",
        }
    ]
    return (
        projection.get("plaintextEmpty") is True
        and projection.get("hiddenForActor") == (kind == "hidden_for_actor")
        and projection.get("retracted") == (kind == "retracted")
        and len(matching_tombstones) == 1
        and (not require_cleanup or len(matching_cleanup) >= 1)
        and int(snapshot.get("searchEntryCount") or 0) == 0
        and int(snapshot.get("attachmentProjectionCount") or 0) == 0
        and int(snapshot.get("attachmentTransferCount") or 0) == 0
        and int(snapshot.get("consumptionCount") or 0) > 0
        and int(snapshot.get("laneSequence") or 0) > 0
    )


def redaction_command_disposition(
    snapshot: object,
    *,
    kind: str,
) -> str:
    if redaction_snapshot_is_valid(snapshot, kind=kind):
        return "committed"
    if not isinstance(snapshot, dict):
        return "pending"
    intent = snapshot.get("intent")
    outbox = snapshot.get("outbox")
    if not isinstance(intent, dict) or not isinstance(outbox, dict):
        return "pending"
    if intent.get("state") != "failed" and outbox.get("state") != "failed":
        return "pending"
    if outbox.get("lastErrorCode") == "authority_head_stale":
        return "retry_authority_head"
    return "failed"


class ChatStorageRedactionRecoveryGate(NativeTwoClientGate):
    gate_id = GATE_ID
    phase = "chat-storage-redaction-recovery"
    bom = ("CSG-G04",)
    spec = ("chat-storage-redaction-recovery",)

    def __init__(self) -> None:
        cell_id = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()
        if cell_id != "desktop-macos-native":
            raise GateError(
                "Chat storage redaction recovery requires desktop-macos-native"
            )
        manifest, actor_manifest = runtime_manifest(self.gate_id)
        source = manifest.get("source")
        source_commit = str(
            source.get("commit") if isinstance(source, dict) else ""
        )
        if not source_commit:
            raise GateError("runtime manifest source commit is required")
        runtime_binding = resolve_native_desktop_runtime(
            cell_id,
            gate_id=self.gate_id,
            source_commit=source_commit,
        )
        runtime_binding.set_runtime_manifest(manifest)
        super().__init__(
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=runtime_binding,
            gate_id=self.gate_id,
            allow_existing_fixture=False,
        )
        self.report.runtime["journey"] = "storage-redaction-recovery"
        self.storage_conversation_id = ""
        self.redaction_evidence: dict[str, Any] = {}

    def open_conversation(self) -> str:
        conversation_id = super().open_conversation()
        self.storage_conversation_id = conversation_id
        return conversation_id

    def sync_actor(self, actor: str) -> None:
        async_harness(
            self.clients[actor],
            "syncFriendSession",
            {"sessionUlid": self.storage_conversation_id},
        )

    def engine_snapshot(
        self,
        actor: str,
        message_id: str,
        command_id: str = "",
    ) -> dict[str, Any]:
        value = async_harness(
            self.clients[actor],
            "engineInteractionSnapshot",
            {
                "actorPtid": self.ptids[actor],
                "conversationId": self.storage_conversation_id,
                "messageId": message_id,
                "commandId": command_id,
            },
        )
        if not isinstance(value, dict):
            raise GateError("redaction engine snapshot is invalid")
        return value

    def arm_recovery_feedback_probe(self, actor: str) -> None:
        self.clients[actor].execute_script(
            """
            const selector = arguments[0];
            window.__PT_RECOVERY_FEEDBACK_PROBE__?.cleanup?.();
            const events = [];
            const preexisting = new WeakSet(
              document.querySelectorAll(selector)
            );
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
                if (!preexisting.has(candidate) && isVisible(candidate)) {
                  events.push((candidate.textContent || '').trim());
                }
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
            };
            """,
            SELECTORS["recovery_feedback"],
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

    def stop_recovery_feedback_probe(self, actor: str) -> None:
        self.clients[actor].execute_script(
            """
            window.__PT_RECOVERY_FEEDBACK_PROBE__?.cleanup?.();
            delete window.__PT_RECOVERY_FEEDBACK_PROBE__;
            """
        )

    def create_recovery_revision(self, actor: str) -> str:
        client = self.clients[actor]
        client.find_element(SELECTORS["settings_nav"], 30).click()
        client.find_element(SELECTORS["security_section"], 10).click()
        WebDriverWait(client.driver, 30).until(
            lambda driver: driver.find_element(
                By.CSS_SELECTOR,
                SELECTORS["recovery_generate"],
            )
        )
        client.find_element(SELECTORS["recovery_generate"], 10).click()
        client.find_element(SELECTORS["recovery_reveal"], 10).click()
        phrase = str(
            client.execute_script(
                "return Array.from(document.querySelectorAll("
                "'[data-recovery-phrase] span:last-child')"
                ").map(e=>e.textContent?.trim()).filter(Boolean).join(' ')"
            )
            or ""
        )
        if len(phrase.split()) != 24:
            raise GateError(
                f"{actor} recovery phrase must contain exactly 24 words"
            )
        self.arm_recovery_feedback_probe(actor)
        try:
            client.find_element(SELECTORS["recovery_backup"], 10).click()
            WebDriverWait(client.driver, 120).until(
                lambda _driver: self.recovery_feedback_observed(actor)
            )
        finally:
            self.stop_recovery_feedback_probe(actor)
        enter_chat_page(client)
        self.sync_actor(actor)
        return phrase

    def restore_recovery_revision(self, actor: str, phrase: str) -> None:
        client = self.clients[actor]
        client.find_element(SELECTORS["settings_nav"], 30).click()
        client.find_element(SELECTORS["security_section"], 10).click()
        WebDriverWait(client.driver, 30).until(
            lambda driver: driver.find_element(
                By.CSS_SELECTOR,
                SELECTORS["recovery_restore_open"],
            )
        )
        client.find_element(SELECTORS["recovery_restore_open"], 10).click()
        restore_input = client.find_element(
            SELECTORS["recovery_restore_input"],
            10,
        )
        client.execute_script(
            """
            const element = arguments[0];
            const value = arguments[1];
            const setter = Object.getOwnPropertyDescriptor(
              HTMLTextAreaElement.prototype, 'value'
            )?.set || Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype, 'value'
            )?.set;
            if (setter) setter.call(element, value);
            else element.value = value;
            element.dispatchEvent(new InputEvent('input', {
              bubbles: true, data: value, inputType: 'insertText',
            }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            """,
            restore_input,
            phrase,
        )
        self.arm_recovery_feedback_probe(actor)
        try:
            client.find_element(
                SELECTORS["recovery_restore_submit"],
                10,
            ).click()
            WebDriverWait(client.driver, 180).until(
                lambda driver: (
                    not driver.find_elements(
                        By.CSS_SELECTOR,
                        SELECTORS["recovery_restore_input"],
                    )
                    and self.recovery_feedback_observed(actor)
                )
            )
        finally:
            self.stop_recovery_feedback_probe(actor)
        enter_chat_page(client)
        self.sync_actor(actor)

    def restart_actor(self, actor: str) -> None:
        predecessor = self.clients[actor]
        self.client_lifecycles.stop_preserving_session(predecessor)
        client = self.runtime_binding.create_bound_session(
            actor,
            NativeLaunchOptions(
                window_slot=("alice", "bob").index(actor),
                window_count=2,
            ),
        )
        self.runtime_instances.append(client)
        expected_ptid = self.ptids[actor]
        self.client_lifecycles.register(client, expected_ptid)
        self.client_lifecycles.transfer_preserved_session(predecessor, client)
        self.client_lifecycles.mark_live(client)
        self.register_driver(client)

        device = wait_until(
            lambda: (
                value
                if (
                    isinstance(
                        value := async_harness(
                            client,
                            "getRealtimeDevice",
                            {},
                        ),
                        dict,
                    )
                    and value.get("active") is True
                    and value.get("actorPtid") == expected_ptid
                    and value.get("deviceId") == self.device_ids[actor]
                )
                else None
            ),
            f"{actor} preserved redaction session",
            timeout=60,
        )
        if not is_native_tauri_url(client.get_current_url()):
            raise GateError(f"{actor} restart did not use native Tauri")
        self.client_lifecycles.mark_authenticated(client)
        self.clients[actor] = client
        self.device_ids[actor] = str(device["deviceId"])
        enter_chat_page(client)
        self.sync_actor(actor)

    def wait_for_redaction(
        self,
        actor: str,
        message_id: str,
        kind: str,
        command_id: str = "",
        *,
        require_cleanup: bool = True,
    ) -> dict[str, Any]:
        latest: dict[str, Any] = {}

        def probe() -> dict[str, Any] | None:
            self.sync_actor(actor)
            snapshot = self.engine_snapshot(actor, message_id, command_id)
            latest.clear()
            latest.update(snapshot)
            return (
                snapshot
                if redaction_snapshot_is_valid(
                    snapshot,
                    kind=kind,
                    require_cleanup=require_cleanup,
                )
                else None
            )

        try:
            return wait_until(
                probe,
                f"{actor} durable {kind} redaction",
                timeout=120,
            )
        except GateError as error:
            raise GateError(
                f"{error}; lastSnapshot={json.dumps(latest, sort_keys=True)}"
            ) from error

    def submit_redaction(
        self,
        *,
        actor: str,
        message_id: str,
        interaction: str,
        kind: str,
    ) -> str:
        last_snapshot: dict[str, Any] = {}
        for attempt in range(1, MAX_REDACTION_SUBMIT_ATTEMPTS + 1):
            response = async_harness(
                self.clients[actor],
                "submitMetadataInteraction",
                {
                    "conversationId": self.storage_conversation_id,
                    "kind": "friend",
                    "messageId": message_id,
                    "interaction": interaction,
                    "remove": False,
                },
            )
            command_id = str(
                (response or {}).get("command_id")
                or (response or {}).get("commandId")
                or ""
            )
            if not command_id:
                raise GateError(
                    f"{interaction} returned no command identity"
                )

            def probe() -> tuple[str, dict[str, Any]] | None:
                self.sync_actor(actor)
                snapshot = self.engine_snapshot(
                    actor,
                    message_id,
                    command_id,
                )
                last_snapshot.clear()
                last_snapshot.update(snapshot)
                disposition = redaction_command_disposition(
                    snapshot,
                    kind=kind,
                )
                return (
                    (disposition, snapshot)
                    if disposition != "pending"
                    else None
                )

            try:
                disposition, _ = wait_until(
                    probe,
                    f"{actor} {interaction} command outcome",
                    timeout=120,
                )
            except GateError as error:
                raise GateError(
                    f"{error}; lastSnapshot="
                    f"{json.dumps(last_snapshot, sort_keys=True)}"
                ) from error
            if disposition == "committed":
                return command_id
            if (
                disposition == "retry_authority_head"
                and attempt < MAX_REDACTION_SUBMIT_ATTEMPTS
            ):
                continue
            raise GateError(
                f"{actor} {interaction} command failed after attempt {attempt}; "
                f"lastSnapshot={json.dumps(last_snapshot, sort_keys=True)}"
            )
        raise GateError(f"{actor} {interaction} retry budget exhausted")

    def assert_redacted_dom(
        self,
        *,
        actor: str,
        message_id: str,
        plaintext: str,
        kind: str,
    ) -> None:
        last_snapshot: dict[str, Any] = {}

        def probe() -> bool | None:
            snapshot = message_dom_snapshot(self.clients[actor], message_id)
            last_snapshot.clear()
            if isinstance(snapshot, dict):
                last_snapshot.update(snapshot)
            if kind == "hidden_for_actor":
                return True if snapshot is None else None
            if (
                snapshot is not None
                and snapshot.get("retracted") == "true"
                and plaintext not in str(snapshot.get("text") or "")
            ):
                return True
            return None

        try:
            wait_until(
                probe,
                f"{actor} {kind} DOM projection",
                timeout=30,
            )
        except GateError as error:
            raise GateError(
                f"{error}; lastDomSnapshot="
                f"{json.dumps(last_snapshot, sort_keys=True)}"
            ) from error

    def assert_redaction_state(
        self,
        *,
        hide_message_id: str,
        hide_plaintext: str,
        retract_message_id: str,
        retract_plaintext: str,
        hide_command_id: str,
        retract_command_id: str,
        require_cleanup: bool = True,
    ) -> dict[str, Any]:
        alice_hide = self.wait_for_redaction(
            "alice",
            hide_message_id,
            "hidden_for_actor",
            hide_command_id,
            require_cleanup=require_cleanup,
        )
        self.assert_redacted_dom(
            actor="alice",
            message_id=hide_message_id,
            plaintext=hide_plaintext,
            kind="hidden_for_actor",
        )
        self.sync_actor("bob")
        bob_hide_dom = wait_until(
            lambda: (
                snapshot
                if (
                    (snapshot := message_dom_snapshot(
                        self.clients["bob"],
                        hide_message_id,
                    ))
                    and hide_plaintext in str(snapshot.get("text") or "")
                )
                else None
            ),
            "Bob actor-scope unaffected plaintext",
            timeout=120,
        )
        bob_hide_engine = self.engine_snapshot("bob", hide_message_id)
        bob_hide_tombstones = bob_hide_engine.get("redactionTombstones")
        if (
            not isinstance(bob_hide_engine.get("projection"), dict)
            or bob_hide_engine["projection"].get("plaintextEmpty") is not False
            or (
                isinstance(bob_hide_tombstones, list)
                and any(
                    isinstance(item, dict)
                    and item.get("kind") == "hidden_for_actor"
                    for item in bob_hide_tombstones
                )
            )
        ):
            raise GateError("actor-scoped hide affected Bob's durable projection")

        retract_snapshots = {
            actor: self.wait_for_redaction(
                actor,
                retract_message_id,
                "retracted",
                retract_command_id,
                require_cleanup=require_cleanup,
            )
            for actor in ("alice", "bob")
        }
        for actor in ("alice", "bob"):
            self.assert_redacted_dom(
                actor=actor,
                message_id=retract_message_id,
                plaintext=retract_plaintext,
                kind="retracted",
            )
        return {
            "aliceHide": alice_hide,
            "bobHide": bob_hide_engine,
            "bobHideDom": {
                "messageId": bob_hide_dom.get("messageId"),
                "plaintextVisible": True,
            },
            "retract": retract_snapshots,
        }

    def prove_additional_journey_assertions(self) -> None:
        conversation_id = self.storage_conversation_id
        if not conversation_id:
            raise GateError("redaction journey has no conversation identity")
        alice = self.clients["alice"]
        bob = self.clients["bob"]
        hide_plaintext = f"redaction-hide-{time.time_ns()}"
        retract_plaintext = f"redaction-retract-{time.time_ns()}"

        def seed_messages() -> tuple[str, str]:
            hide_sent = send_text(alice, hide_plaintext)
            hide_message_id = str(hide_sent.get("messageUlid") or "")
            retract_sent = send_text(alice, retract_plaintext)
            retract_message_id = str(retract_sent.get("messageUlid") or "")
            if not hide_message_id or not retract_message_id:
                raise GateError("redaction fixture messages have no identity")
            wait_until(
                lambda: message_snapshot(bob, hide_plaintext),
                "Bob pre-redaction hide plaintext",
            )
            wait_until(
                lambda: message_snapshot(bob, retract_plaintext),
                "Bob pre-redaction retract plaintext",
            )
            return hide_message_id, retract_message_id

        hide_message_id, retract_message_id = self.step(
            "redaction.messages",
            seed_messages,
            "alice",
        )
        recovery_phrases = self.step(
            "recovery.archives",
            lambda: {
                actor: self.create_recovery_revision(actor)
                for actor in ("alice", "bob")
            },
        )

        def apply_redactions() -> dict[str, str]:
            hide_command_id = self.submit_redaction(
                actor="alice",
                message_id=hide_message_id,
                interaction="hideForActor",
                kind="hidden_for_actor",
            )
            retract_command_id = self.submit_redaction(
                actor="alice",
                message_id=retract_message_id,
                interaction="retract",
                kind="retracted",
            )
            return {
                "hide": hide_command_id,
                "retract": retract_command_id,
            }

        redaction_commands = self.step(
            "redaction.apply",
            apply_redactions,
            "alice",
        )
        immediate = self.assert_redaction_state(
            hide_message_id=hide_message_id,
            hide_plaintext=hide_plaintext,
            retract_message_id=retract_message_id,
            retract_plaintext=retract_plaintext,
            hide_command_id=redaction_commands["hide"],
            retract_command_id=redaction_commands["retract"],
        )
        self.assert_condition("actor_hide_scope", True)
        self.assert_condition("retract_scope", True)
        self.assert_condition(
            "redaction_atomic_commit",
            all(
                redaction_snapshot_is_valid(
                    snapshot,
                    kind=kind,
                )
                for kind, snapshot in (
                    ("hidden_for_actor", immediate["aliceHide"]),
                    ("retracted", immediate["retract"]["alice"]),
                    ("retracted", immediate["retract"]["bob"]),
                )
            ),
        )

        self.step(
            "redaction.restart",
            lambda: [self.restart_actor(actor) for actor in ("alice", "bob")],
        )
        restarted = self.assert_redaction_state(
            hide_message_id=hide_message_id,
            hide_plaintext=hide_plaintext,
            retract_message_id=retract_message_id,
            retract_plaintext=retract_plaintext,
            hide_command_id=redaction_commands["hide"],
            retract_command_id=redaction_commands["retract"],
        )
        self.assert_condition("redaction_restart_stability", True)

        self.step(
            "redaction.restore",
            lambda: [
                self.restore_recovery_revision(
                    actor,
                    recovery_phrases[actor],
                )
                for actor in ("alice", "bob")
            ],
        )
        restored = self.assert_redaction_state(
            hide_message_id=hide_message_id,
            hide_plaintext=hide_plaintext,
            retract_message_id=retract_message_id,
            retract_plaintext=retract_plaintext,
            hide_command_id=redaction_commands["hide"],
            retract_command_id=redaction_commands["retract"],
            require_cleanup=False,
        )
        self.assert_condition("recovery_redaction_reconciliation", True)
        self.assert_condition(
            "redacted_plaintext_absent",
            all(
                snapshot["projection"].get("plaintextEmpty") is True
                for snapshot in (
                    restored["aliceHide"],
                    restored["retract"]["alice"],
                    restored["retract"]["bob"],
                )
            ),
        )
        self.redaction_evidence = {
            "conversationId": conversation_id,
            "hideMessageId": hide_message_id,
            "retractMessageId": retract_message_id,
            "hideCommandId": redaction_commands["hide"],
            "retractCommandId": redaction_commands["retract"],
            "immediate": immediate,
            "restarted": restarted,
            "restored": restored,
        }
        self.report.runtime["redactionRecovery"] = self.redaction_evidence

    def run(self) -> dict[str, Any]:
        result = super().run()
        result["journey"] = "storage-redaction-recovery"
        assertions = {item.name for item in self.report.assertions}
        missing = REDACTION_REQUIRED_ASSERTIONS - assertions
        if missing:
            raise GateError(
                f"required redaction assertions are missing: {sorted(missing)}"
            )
        result["redactionRecovery"] = self.redaction_evidence
        return result


def main() -> int:
    gate: AcceptanceGate = ChatStorageRedactionRecoveryGate()
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
