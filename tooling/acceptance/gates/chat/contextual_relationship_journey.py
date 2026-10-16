"""Contextual Social safety proof on the existing Native two-client runtime."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Callable

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.chat.native_support import enter_chat_page

if TYPE_CHECKING:
    from tooling.acceptance.drivers.tauri import TauriSession
    from tooling.acceptance.gates.chat.native_two_client_runner import NativeTwoClientGate


REQUIRED_ASSERTIONS = {
    "contact_contextual_block",
    "settings_block_projection",
    "contact_block_restart_persisted",
    "settings_unblock_contact_converged",
    "contact_contextual_unblock",
}
REQUIRED_STEPS = {
    "relationship.contact.block",
    "relationship.settings.blocked",
    "relationship.restart",
    "relationship.settings.unblock",
    "relationship.contact.unblock",
}
EVIDENCE_NAMES = (
    "relationship-contact-blocked",
    "relationship-settings-blocked",
    "relationship-restart-blocked",
    "relationship-settings-unblocked",
    "relationship-contact-unblocked",
)


def click(client: TauriSession, selector: str) -> None:
    client.semantic_click(client.find_element(selector, 30))


def contact_snapshot(client: TauriSession, peer_ptid: str) -> dict[str, Any]:
    return client.execute_script(
        """
        const peer = arguments[0];
        const detail = Array.from(document.querySelectorAll(
          '[data-chat-contact-detail-peer-ptid]'
        )).find((item) => (
          item.getAttribute('data-chat-contact-detail-peer-ptid') === peer
          && item.getBoundingClientRect().height > 0
        ));
        const safety = detail?.querySelector('[data-chat-contact-safety]');
        const action = safety?.querySelector('[data-chat-contact-block-action]');
        const message = detail?.querySelector('[data-chat-contact-message]');
        return {
          peerPtid: safety?.getAttribute('data-chat-contact-safety') || '',
          blocked: safety?.getAttribute('data-chat-contact-blocked') || '',
          action: action?.getAttribute('data-chat-contact-block-action') || '',
          enabled: Boolean(action && !action.disabled),
          messageDisabled: message?.disabled === true,
        };
        """,
        peer_ptid,
    ) or {}


def privacy_snapshot(client: TauriSession, peer_ptid: str) -> dict[str, Any]:
    return client.execute_script(
        """
        const section = document.querySelector('[data-pt-section-host="privacy"]');
        const visible = Boolean(section && section.getBoundingClientRect().height > 0);
        const row = Array.from(section?.querySelectorAll('[data-blocked-actor]') || [])
          .find((item) => item.getAttribute('data-blocked-actor') === arguments[0]);
        return {
          visible,
          ready: visible && !section.querySelector('.ant-spin-spinning, .ant-alert'),
          blocked: Boolean(row),
          peerPtid: row?.getAttribute('data-blocked-actor') || '',
        };
        """,
        peer_ptid,
    ) or {}


def prove_contextual_relationships(
    gate: NativeTwoClientGate,
    wait_until: Callable[..., Any],
) -> None:
    # Product mutations use only rendered controls. Harness login and restart
    # remain owned by the enclosing runner; no second fixture is provisioned.
    actor = "alice"
    peer = gate.ptids["bob"]
    observations: dict[str, Any] = {"actorPtid": gate.ptids[actor], "peerPtid": peer}
    gate.report.runtime["contextualRelationships"] = observations

    def capture(name: str) -> None:
        gate.save_screenshot(gate.clients[actor], name)
        gate.save_dom(gate.clients[actor], name)

    def contact(blocked: bool) -> dict[str, Any]:
        expected = str(blocked).lower()
        return wait_until(
            lambda: (
                snapshot
                if (snapshot := contact_snapshot(gate.clients[actor], peer)).get("peerPtid") == peer
                and snapshot.get("blocked") == expected
                and snapshot.get("action") == ("unblock" if blocked else "block")
                and snapshot.get("enabled") is True
                else None
            ),
            f"{actor} contact {peer} blocked={expected}",
        )

    def open_contact() -> None:
        client = gate.clients[actor]
        enter_chat_page(client)
        click(client, '[data-chat-subpage="contacts"]')
        click(client, f'[data-chat-contact-ptid={json.dumps(peer)}]')

    def open_privacy() -> None:
        client = gate.clients[actor]
        click(client, '[data-pt-primary-nav="settings"]')
        click(client, '[data-group-key="general"]')
        click(client, '[data-section-key="privacy"]')

    def privacy(blocked: bool) -> dict[str, Any]:
        return wait_until(
            lambda: (
                snapshot
                if (snapshot := privacy_snapshot(gate.clients[actor], peer)).get("ready") is True
                and snapshot.get("blocked") is blocked
                else None
            ),
            f"{actor} Privacy projection for {peer} blocked={blocked}",
        )

    def confirm() -> None:
        client = gate.clients[actor]
        click(client, '[role="dialog"] .ant-btn-primary')
        wait_until(
            lambda: client.execute_script(
                """
                return !Array.from(document.querySelectorAll('[role="dialog"]'))
                  .some((dialog) => dialog.getBoundingClientRect().height > 0);
                """
            ),
            "relationship confirmation closed",
        )

    def contextual_change(blocked: bool) -> dict[str, Any]:
        client = gate.clients[actor]
        safety = f'[data-chat-contact-safety={json.dumps(peer)}]'
        click(client, f'{safety} [data-chat-contact-block-action="{"block" if blocked else "unblock"}"]')
        confirm()
        snapshot = contact(blocked)
        if blocked and snapshot.get("messageDisabled") is not True:
            raise GateError("blocked contact Message action must be disabled")
        return snapshot

    def first_block() -> dict[str, Any]:
        open_contact()
        contact(False)
        snapshot = contextual_change(True)
        capture("relationship-contact-blocked")
        return snapshot

    snapshot = gate.step("relationship.contact.block", first_block, actor)
    observations["contextualBlock"] = snapshot
    gate.assert_condition("contact_contextual_block", snapshot["messageDisabled"] is True)

    def settings_blocked() -> dict[str, Any]:
        open_privacy()
        snapshot = privacy(True)
        capture("relationship-settings-blocked")
        return snapshot

    snapshot = gate.step("relationship.settings.blocked", settings_blocked, actor)
    observations["settingsBlocked"] = snapshot
    gate.assert_condition("settings_block_projection", snapshot["peerPtid"] == peer)

    def restart() -> dict[str, Any]:
        gate.restart_client(actor)
        open_privacy()
        snapshot = privacy(True)
        capture("relationship-restart-blocked")
        return snapshot

    snapshot = gate.step("relationship.restart", restart, actor)
    observations["restartBlocked"] = snapshot
    gate.assert_condition("contact_block_restart_persisted", snapshot["peerPtid"] == peer)

    def settings_unblock() -> dict[str, Any]:
        click(gate.clients[actor], f'[data-unblock-actor={json.dumps(peer)}]')
        confirm()
        privacy(False)
        open_contact()
        snapshot = contact(False)
        capture("relationship-settings-unblocked")
        return snapshot

    snapshot = gate.step("relationship.settings.unblock", settings_unblock, actor)
    observations["settingsUnblocked"] = snapshot
    gate.assert_condition("settings_unblock_contact_converged", snapshot["messageDisabled"] is False)

    def contextual_unblock() -> dict[str, Any]:
        contextual_change(True)
        snapshot = contextual_change(False)
        capture("relationship-contact-unblocked")
        open_privacy()
        privacy(False)
        return snapshot

    snapshot = gate.step("relationship.contact.unblock", contextual_unblock, actor)
    observations["contextualUnblocked"] = snapshot
    gate.assert_condition("contact_contextual_unblock", snapshot["messageDisabled"] is False)
