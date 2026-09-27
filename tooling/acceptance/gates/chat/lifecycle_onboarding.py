#!/usr/bin/env python3
"""Prove CHAT-J01 from person discovery through the first Direct messages."""

from __future__ import annotations

import json
from typing import Any, Callable

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    async_harness,
    enter_chat_page,
    runtime_station_service,
    selected_native_runtime,
    shared_federation_id,
    wait_for_peer_key_bundle,
    wait_until,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    LIFECYCLE_ONBOARDING_GATE_ID,
    NativeTwoClientGate,
)


GATE_ID = LIFECYCLE_ONBOARDING_GATE_ID
REPORT_PATH = None
STEP_TIMEOUT = 120.0
ONBOARDING_REQUIRED_ASSERTIONS = {
    "local_search_identity",
    "federated_handle_search_identity",
    "station_scoped_search_identity",
    "friend_request_pending_visible",
    "duplicate_request_suppressed",
    "friend_request_rejected_visible",
    "friend_request_retry_available",
    "friend_request_accepted_visible",
    "relationship_converged",
    "direct_conversation_singleton",
    "native_account_resume_without_credentials",
    "friend_request_history_consolidated_selectable",
    "station_identity_human_readable_copyable",
}

SELECTORS = {
    "chats_subpage": '[data-chat-subpage="chats"]',
    "contacts_subpage": '[data-chat-subpage="contacts"]',
    "new_menu": "[data-chat-new-menu]",
    "find_people_menu": "[data-chat-find-people-menu]",
    "find_people": "[data-chat-find-people]",
    "find_people_input": "[data-chat-find-people-input]",
    "find_people_search": "[data-chat-find-people-search]",
    "friend_request_section": "[data-chat-friend-request-section]",
    "contact_message": "[data-chat-contact-message]",
}


def matching_requests(
    snapshot: dict[str, Any],
    *,
    sender_ptid: str,
    receiver_ptid: str,
    status: int,
) -> list[dict[str, Any]]:
    requests = snapshot.get("requests")
    if not isinstance(requests, list):
        return []
    return [
        request
        for request in requests
        if isinstance(request, dict)
        and request.get("senderPtid") == sender_ptid
        and request.get("receiverPtid") == receiver_ptid
        and request.get("status") == status
    ]


def counterparty_requests(
    snapshot: dict[str, Any],
    *,
    viewer_ptid: str,
    peer_ptid: str,
) -> list[dict[str, Any]]:
    requests = snapshot.get("requests")
    if not isinstance(requests, list):
        return []
    return [
        request
        for request in requests
        if isinstance(request, dict)
        and {
            request.get("senderPtid"),
            request.get("receiverPtid"),
        } == {viewer_ptid, peer_ptid}
    ]


def accepted_conversation_id(
    snapshots: tuple[dict[str, Any], dict[str, Any]],
) -> str | None:
    conversation_sets = []
    for snapshot in snapshots:
        values = snapshot.get("conversationIds")
        if not isinstance(values, list):
            return None
        conversation_ids = {
            str(value)
            for value in values
            if isinstance(value, str) and value
        }
        if len(conversation_ids) != 1:
            return None
        conversation_sets.append(conversation_ids)
    shared = conversation_sets[0] & conversation_sets[1]
    return next(iter(shared)) if len(shared) == 1 else None


class LifecycleOnboardingGate(NativeTwoClientGate):
    gate_id = GATE_ID
    phase = "CHAT-W01"
    bom = ("CHAT-G01", "CHAT-G02", "CHAT-G03", "CHAT-G04")
    spec = ("CHAT-J01", "chat-native-visible-clients")
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
            allow_existing_fixture=True,
        )

    def _snapshot(self, actor: str, peer: str) -> dict[str, Any]:
        value = async_harness(
            self.clients[actor],
            "refreshOnboardingProjection",
            {"peerPtid": self.ptids[peer]},
        )
        if not isinstance(value, dict):
            raise GateError(f"{actor} onboarding snapshot is invalid")
        return value

    @staticmethod
    def _resume_surface(client: TauriSession) -> dict[str, Any] | None:
        value = client.execute_script(
            """
            return {
              authenticatedShell: Boolean(document.querySelector('[data-page]')),
              emailPrompt: Boolean(document.querySelector('[data-login-email]')),
              passwordPrompt: Boolean(document.querySelector('[data-login-password]')),
              pinPrompt: Boolean(document.querySelector('input[inputmode="numeric"]')),
            };
            """
        )
        return value if isinstance(value, dict) else None

    def _restart_and_resume_account(self, actor: str) -> dict[str, Any]:
        predecessor = self.clients[actor]
        expected_ptid = self.ptids[actor]
        expected_device_id = self.device_ids[actor]
        self.client_lifecycles.stop_preserving_session(predecessor)
        client = self.runtime_binding.create_bound_session(
            actor,
            NativeLaunchOptions(
                window_slot=("alice", "bob").index(actor),
                window_count=2,
            ),
        )
        self.runtime_instances.append(client)
        self.client_lifecycles.register(client, expected_ptid)
        self.client_lifecycles.transfer_preserved_session(
            predecessor,
            client,
        )
        self.client_lifecycles.mark_live(client)
        self.register_driver(client)

        def resumed() -> dict[str, Any] | None:
            try:
                hydration = async_harness(
                    client,
                    "hydrateActiveActor",
                    {},
                    timeout=10,
                )
                surface = self._resume_surface(client)
            except Exception:
                return None
            actor_ptid = str((hydration or {}).get("actorPtid") or "")
            if (
                actor_ptid != expected_ptid
                or not isinstance(surface, dict)
                or surface.get("authenticatedShell") is not True
                or surface.get("emailPrompt") is True
                or surface.get("passwordPrompt") is True
                or surface.get("pinPrompt") is True
            ):
                return None
            return {
                "actorPtid": actor_ptid,
                "surface": surface,
            }

        evidence = wait_until(
            resumed,
            f"{actor} native account session resume",
            timeout=STEP_TIMEOUT,
        )
        device = wait_until(
            lambda: (
                current
                if (
                    isinstance(
                        current := async_harness(
                            client,
                            "getRealtimeDevice",
                            {},
                        ),
                        dict,
                    )
                    and current.get("active") is True
                    and current.get("actorPtid") == expected_ptid
                    and current.get("deviceId") == expected_device_id
                )
                else None
            ),
            f"{actor} resumed messaging device",
            timeout=STEP_TIMEOUT,
        )
        self.client_lifecycles.mark_authenticated(client)
        self.clients[actor] = client
        return {
            **evidence,
            "deviceId": str(device.get("deviceId") or ""),
        }

    def prove_additional_journey_assertions(self) -> None:
        evidence = {
            actor: self.step(
                "account.resume",
                lambda actor=actor: self._restart_and_resume_account(actor),
                actor,
            )
            for actor in ("alice", "bob")
        }
        self.report.runtime["accountResume"] = evidence
        self.assert_condition(
            "native_account_resume_without_credentials",
            all(
                item.get("actorPtid") == self.ptids[actor]
                and item.get("deviceId") == self.device_ids[actor]
                and item.get("surface", {}).get("authenticatedShell") is True
                and item.get("surface", {}).get("emailPrompt") is False
                and item.get("surface", {}).get("passwordPrompt") is False
                and item.get("surface", {}).get("pinPrompt") is False
                for actor, item in evidence.items()
            ),
            json.dumps(evidence, sort_keys=True),
        )

    def _wait_snapshot(
        self,
        actor: str,
        peer: str,
        description: str,
        predicate: Callable[[dict[str, Any]], bool],
    ) -> dict[str, Any]:
        return wait_until(
            lambda: (
                snapshot
                if predicate(
                    snapshot := self._snapshot(actor, peer)
                )
                else None
            ),
            description,
            timeout=STEP_TIMEOUT,
        )

    def _prepare_stranger_state(self) -> dict[str, Any]:
        evidence: dict[str, Any] = {}
        for actor, peer in (("bob", "alice"), ("alice", "bob")):
            value = async_harness(
                self.clients[actor],
                "prepareOnboardingPeer",
                {"peerPtid": self.ptids[peer]},
            )
            if not isinstance(value, dict):
                raise GateError(
                    f"{actor} onboarding fixture preparation returned invalid state"
                )
            evidence[actor] = value

        for actor, peer in (("bob", "alice"), ("alice", "bob")):
            evidence[actor] = self._wait_snapshot(
                actor,
                peer,
                f"{actor} stranger relationship state",
                lambda snapshot: (
                    snapshot.get("acceptedFriendship") is False
                    and not matching_requests(
                        snapshot,
                        sender_ptid=self.ptids[actor],
                        receiver_ptid=self.ptids[peer],
                        status=1,
                    )
                    and not matching_requests(
                        snapshot,
                        sender_ptid=self.ptids[peer],
                        receiver_ptid=self.ptids[actor],
                        status=1,
                    )
                ),
            )
        return evidence

    @staticmethod
    def _set_input(client: TauriSession, selector: str, value: str) -> None:
        element = client.find_element(selector, 10)
        client.execute_script(
            """
            const root = arguments[0];
            const input = root instanceof HTMLInputElement
              ? root
              : root.querySelector('input');
            const value = arguments[1];
            if (!input) throw new Error('input missing');
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype, 'value'
            )?.set;
            if (!setter) throw new Error('input setter missing');
            setter.call(input, value);
            input.dispatchEvent(new InputEvent('input', {
              bubbles: true, data: value, inputType: 'insertText',
            }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            """,
            element,
            value,
        )

    def _open_find_people(self, client: TauriSession) -> None:
        enter_chat_page(client)
        client.find_element(SELECTORS["chats_subpage"], 10).click()
        client.find_element(SELECTORS["new_menu"], 10).click()
        client.find_element(SELECTORS["find_people_menu"], 10).click()
        client.find_element(SELECTORS["find_people"], 10)

    @staticmethod
    def _close_find_people(client: TauriSession) -> None:
        client.find_element(SELECTORS["find_people"], 10)
        visible_close_buttons = [
            element
            for element in client.driver.find_elements(
                By.CSS_SELECTOR,
                ".ant-modal-close",
            )
            if element.is_displayed()
        ]
        if len(visible_close_buttons) != 1:
            raise GateError(
                "Find People requires exactly one visible modal close action"
            )
        client.execute_script(
            "arguments[0].click();",
            visible_close_buttons[0],
        )
        WebDriverWait(client.driver, 10).until(
            EC.invisibility_of_element_located(
                (By.CSS_SELECTOR, SELECTORS["find_people"])
            )
        )

    @staticmethod
    def _search_result_snapshot(
        client: TauriSession,
        expected_ptid: str,
    ) -> dict[str, Any] | None:
        selector = (
            f'[data-chat-find-people-result={json.dumps(expected_ptid)}]'
        )
        value = client.execute_script(
            """
            const row = document.querySelector(arguments[0]);
            if (!row) return null;
            const action = row.querySelector(
              '[data-chat-find-people-action]'
            );
            return {
              peerPtid:
                row.getAttribute('data-chat-find-people-result') || '',
              federatedHandle:
                row.getAttribute('data-chat-find-people-handle') || '',
              homeStation:
                row.getAttribute(
                  'data-chat-find-people-home-station'
                ) || '',
              homeStationPeerId:
                row.getAttribute(
                  'data-chat-find-people-home-station-peer-id'
                ) || '',
              friendState:
                row.getAttribute('data-chat-friend-state') || '',
              actionState:
                action?.getAttribute(
                  'data-chat-find-people-action-state'
                ) || '',
              actionDisabled: Boolean(action?.disabled),
              ptidText:
                row.querySelector(
                  '[data-chat-find-people-ptid]'
                )?.textContent?.trim() || '',
              visibleText: row.textContent?.trim() || '',
            };
            """,
            selector,
        )
        return value if isinstance(value, dict) else None

    def _search_result(
        self,
        client: TauriSession,
        query: str,
        expected_ptid: str,
    ) -> dict[str, Any]:
        self._set_input(client, SELECTORS["find_people_input"], query)
        client.find_element(SELECTORS["find_people_search"], 10).click()
        return wait_until(
            lambda: self._search_result_snapshot(client, expected_ptid),
            f"search result for {expected_ptid}",
            timeout=STEP_TIMEOUT,
        )

    def _select_station_scope(
        self,
        client: TauriSession,
        federation_id: str,
        station_id: str,
    ) -> None:
        federation_selector = (
            "[data-chat-find-people-scope=\"federation\"]"
            f"[data-chat-find-people-federation-id={json.dumps(federation_id)}]"
        )
        client.find_element(federation_selector, 10).click()
        station_selector = (
            "[data-chat-find-people-scope=\"station\"]"
            f"[data-chat-find-people-station-id={json.dumps(station_id)}]"
        )
        client.find_element(station_selector, 30).click()

    def _send_visible_request(
        self,
        sender: str,
        receiver: str,
    ) -> dict[str, Any]:
        client = self.clients[sender]
        receiver_identity = async_harness(
            self.clients[receiver],
            "onboardingIdentity",
            {},
        )
        if not isinstance(receiver_identity, dict):
            raise GateError(f"{receiver} onboarding identity is invalid")
        receiver_ptid = self.ptids[receiver]
        username = str(receiver_identity.get("preferredUsername") or "")
        federated_handle = str(
            receiver_identity.get("federatedHandle") or ""
        )
        home_station = str(
            receiver_identity.get("homeStationDomain")
            or receiver_identity.get("homeStationPeerId")
            or ""
        )
        station_peer_id = str(
            receiver_identity.get("homeStationPeerId") or ""
        )
        if not username or not federated_handle or not station_peer_id:
            raise GateError(
                f"{receiver} has incomplete discoverable identity: "
                f"{receiver_identity}"
            )

        self._open_find_people(client)
        local = self._search_result(client, username, receiver_ptid)
        self.assert_condition(
            "local_search_identity",
            local.get("peerPtid") == receiver_ptid
            and local.get("ptidText") == receiver_ptid
            and bool(local.get("homeStation")),
            json.dumps(local, sort_keys=True),
        )

        exact = self._search_result(
            client,
            federated_handle,
            receiver_ptid,
        )
        self.assert_condition(
            "federated_handle_search_identity",
            exact.get("peerPtid") == receiver_ptid
            and exact.get("federatedHandle") == federated_handle
            and home_station in str(exact.get("visibleText") or ""),
            json.dumps(exact, sort_keys=True),
        )

        federation_id = shared_federation_id(
            self.clients,
            (sender, receiver),
        )
        self._select_station_scope(
            client,
            federation_id,
            station_peer_id,
        )
        scoped = self._search_result(client, username, receiver_ptid)
        self.assert_condition(
            "station_scoped_search_identity",
            scoped.get("peerPtid") == receiver_ptid
            and scoped.get("homeStationPeerId") == station_peer_id,
            json.dumps(scoped, sort_keys=True),
        )
        if (
            scoped.get("friendState") != "none"
            or scoped.get("actionState") != "available"
            or scoped.get("actionDisabled") is not False
        ):
            raise GateError(
                "Find People did not expose an available stranger action: "
                f"{scoped}"
            )

        action_selector = (
            f'[data-chat-find-people-action={json.dumps(receiver_ptid)}]'
        )
        action = client.find_element(action_selector, 10)
        action.click()

        def pending_result() -> dict[str, Any] | None:
            result = self._search_result_snapshot(client, receiver_ptid)
            if result is None:
                return None
            return result if (
                result.get("friendState") == "pending"
                and result.get("actionState") == "pending"
                and result.get("actionDisabled") is True
            ) else None

        pending = wait_until(
            pending_result,
            f"{sender} pending request UI",
            timeout=STEP_TIMEOUT,
        )
        sender_snapshot = self._wait_snapshot(
            sender,
            receiver,
            f"{sender} canonical pending request",
            lambda snapshot: len(
                matching_requests(
                    snapshot,
                    sender_ptid=self.ptids[sender],
                    receiver_ptid=receiver_ptid,
                    status=1,
                )
            ) == 1,
        )
        disabled_action = client.find_element(action_selector, 10)
        client.execute_script("arguments[0].click();", disabled_action)
        duplicate_snapshot = self._snapshot(sender, receiver)
        pending_count = len(
            matching_requests(
                duplicate_snapshot,
                sender_ptid=self.ptids[sender],
                receiver_ptid=receiver_ptid,
                status=1,
            )
        )
        self.assert_condition(
            "friend_request_pending_visible",
            pending.get("friendState") == "pending",
            json.dumps(pending, sort_keys=True),
        )
        self.assert_condition(
            "duplicate_request_suppressed",
            pending_count == 1,
            json.dumps(duplicate_snapshot, sort_keys=True),
        )
        self._close_find_people(client)
        pending_request = matching_requests(
            sender_snapshot,
            sender_ptid=self.ptids[sender],
            receiver_ptid=receiver_ptid,
            status=1,
        )[0]
        return {
            "identity": receiver_identity,
            "local": local,
            "federated": exact,
            "station": scoped,
            "pendingRequestId": pending_request["id"],
        }

    def _retry_visible_request(
        self,
        sender: str,
        receiver: str,
    ) -> dict[str, Any]:
        client = self.clients[sender]
        receiver_identity = async_harness(
            self.clients[receiver],
            "onboardingIdentity",
            {},
        )
        if not isinstance(receiver_identity, dict):
            raise GateError(f"{receiver} onboarding identity is invalid")
        receiver_ptid = self.ptids[receiver]
        federated_handle = str(
            receiver_identity.get("federatedHandle") or ""
        )
        self._open_find_people(client)
        result = self._search_result(
            client,
            federated_handle,
            receiver_ptid,
        )
        if (
            result.get("friendState") != "none"
            or result.get("actionState") != "available"
            or result.get("actionDisabled") is not False
        ):
            raise GateError(
                "rejected request did not recover to an available action: "
                f"{result}"
            )
        client.find_element(
            f'[data-chat-find-people-action={json.dumps(receiver_ptid)}]',
            10,
        ).click()
        snapshot = self._wait_snapshot(
            sender,
            receiver,
            f"{sender} retried pending request",
            lambda current: len(
                matching_requests(
                    current,
                    sender_ptid=self.ptids[sender],
                    receiver_ptid=receiver_ptid,
                    status=1,
                )
            ) == 1,
        )
        self._close_find_people(client)
        pending = matching_requests(
            snapshot,
            sender_ptid=self.ptids[sender],
            receiver_ptid=receiver_ptid,
            status=1,
        )[0]
        return {
            "search": result,
            "pendingRequestId": pending["id"],
        }

    @staticmethod
    def _open_request_section(client: TauriSession) -> None:
        enter_chat_page(client)
        client.find_element(SELECTORS["contacts_subpage"], 10).click()
        client.find_element("[data-chat-contacts]", 10)
        label = client.find_element(
            SELECTORS["friend_request_section"],
            10,
        )
        client.execute_script(
            """
            const header = arguments[0].closest('.ant-collapse-header');
            if (!header) throw new Error('friend request header missing');
            if (header.getAttribute('aria-expanded') !== 'true') {
              header.click();
            }
            """,
            label,
        )

    def _request_row(
        self,
        client: TauriSession,
        *,
        peer_ptid: str,
        direction: str,
        status: int,
    ) -> dict[str, Any] | None:
        selector = (
            f'[data-chat-friend-request-peer-ptid={json.dumps(peer_ptid)}]'
            f'[data-chat-friend-request-direction={json.dumps(direction)}]'
            f'[data-chat-friend-request-status="{status}"]'
        )
        value = client.execute_script(
            """
            const rows = Array.from(document.querySelectorAll(arguments[0]));
            const row = rows.at(-1);
            if (!row) return null;
            return {
              rowCount: rows.length,
              requestId:
                row.getAttribute('data-chat-friend-request-id') || '',
              status:
                row.getAttribute('data-chat-friend-request-status') || '',
              direction:
                row.getAttribute(
                  'data-chat-friend-request-direction'
                ) || '',
              attemptCount:
                row.getAttribute(
                  'data-chat-friend-request-attempt-count'
                ) || '',
              role: row.getAttribute('role') || '',
              tabIndex: row.getAttribute('tabindex') || '',
              acceptVisible: Boolean(
                row.querySelector(
                  '[data-chat-friend-request-action="accept"]'
                )
              ),
              rejectVisible: Boolean(
                row.querySelector(
                  '[data-chat-friend-request-action="reject"]'
                )
              ),
              errorVisible: Boolean(
                row.querySelector('[data-chat-friend-request-error]')
              ),
              visibleText: row.textContent?.trim() || '',
            };
            """,
            selector,
        )
        return value if isinstance(value, dict) else None

    def _select_request_profile(
        self,
        client: TauriSession,
        *,
        peer_ptid: str,
        direction: str,
        status: int,
    ) -> dict[str, Any]:
        selector = (
            f'[data-chat-friend-request-peer-ptid={json.dumps(peer_ptid)}]'
            f'[data-chat-friend-request-direction={json.dumps(direction)}]'
            f'[data-chat-friend-request-status="{status}"]'
        )
        client.find_element(selector, 10).click()
        detail_selector = (
            f'[data-chat-contact-detail-peer-ptid={json.dumps(peer_ptid)}]'
        )
        client.find_element(detail_selector, 10)
        details = client.find_element(
            "[data-chat-profile-technical-details]",
            10,
        )
        initially_open = details.get_attribute("open") is not None
        client.find_element(
            "[data-chat-profile-technical-details] summary",
            10,
        ).click()
        return wait_until(
            lambda: client.execute_script(
                """
                const detail = document.querySelector(arguments[0]);
                const technical = document.querySelector(
                  '[data-chat-profile-technical-details]'
                );
                if (!detail || !technical?.open) return null;
                return {
                  kind:
                    detail.getAttribute(
                      'data-chat-contact-detail-kind'
                    ) || '',
                  peerPtid:
                    detail.getAttribute(
                      'data-chat-contact-detail-peer-ptid'
                    ) || '',
                  stationName:
                    detail.getAttribute(
                      'data-chat-contact-detail-home-station-name'
                    ) || '',
                  stationPeerId:
                    detail.getAttribute(
                      'data-chat-contact-detail-home-station-peer-id'
                    ) || '',
                  attemptCount:
                    detail.getAttribute(
                      'data-chat-contact-detail-request-attempt-count'
                    ) || '',
                  detailsInitiallyOpen: arguments[1],
                  detailsOpen: Boolean(technical.open),
                  copyFields: Array.from(
                    technical.querySelectorAll('[data-chat-profile-copy]')
                  ).map((item) => (
                    item.getAttribute('data-chat-profile-copy') || ''
                  )),
                };
                """,
                detail_selector,
                initially_open,
            ),
            "selectable request profile with expanded identity details",
            timeout=STEP_TIMEOUT,
        )

    def _decide_request(
        self,
        receiver: str,
        sender: str,
        action: str,
    ) -> dict[str, Any]:
        client = self.clients[receiver]
        self._open_request_section(client)
        sender_ptid = self.ptids[sender]
        row = wait_until(
            lambda: self._request_row(
                client,
                peer_ptid=sender_ptid,
                direction="incoming",
                status=1,
            ),
            f"{receiver} incoming pending request",
            timeout=STEP_TIMEOUT,
        )
        if row.get("acceptVisible") is not True or row.get("rejectVisible") is not True:
            raise GateError(
                f"{receiver} pending request actions are unavailable: {row}"
            )
        selector = (
            f'[data-chat-friend-request-peer-ptid={json.dumps(sender_ptid)}]'
            '[data-chat-friend-request-direction="incoming"]'
            '[data-chat-friend-request-status="1"] '
            f'[data-chat-friend-request-action="{action}"]'
        )
        client.find_element(selector, 10).click()
        terminal_status = 2 if action == "accept" else 3
        terminal = wait_until(
            lambda: self._request_row(
                client,
                peer_ptid=sender_ptid,
                direction="incoming",
                status=terminal_status,
            ),
            f"{receiver} {action} request result",
            timeout=STEP_TIMEOUT,
        )
        return terminal

    def _open_contact_conversation(
        self,
        actor: str,
        peer: str,
    ) -> str:
        client = self.clients[actor]
        enter_chat_page(client)
        client.find_element(SELECTORS["contacts_subpage"], 10).click()
        contact_selector = (
            f'[data-chat-contact-ptid={json.dumps(self.ptids[peer])}]'
        )
        client.find_element(contact_selector, 30).click()
        client.find_element(SELECTORS["contact_message"], 10).click()

        return wait_until(
            lambda: client.execute_script(
                """
                const pane = document.querySelector(
                  '[data-chat-conversation-pane]'
                );
                const id = pane?.getAttribute(
                  'data-chat-conversation-pane'
                ) || '';
                return id || null;
                """,
            ),
            f"{actor} peer-bound Direct conversation",
            timeout=STEP_TIMEOUT,
        )

    def open_conversation(self) -> str:
        sender, receiver = self.direction_order
        for client in self.clients.values():
            enter_chat_page(client)

        fixture = self.step(
            "relationship.normalize",
            self._prepare_stranger_state,
        )
        discovery = self.step(
            "discovery.search",
            lambda: self._send_visible_request(sender, receiver),
            sender,
        )
        rejected = self.step(
            "relationship.reject",
            lambda: self._decide_request(receiver, sender, "reject"),
            receiver,
        )
        sender_rejected = self._wait_snapshot(
            sender,
            receiver,
            f"{sender} rejected request projection",
            lambda snapshot: any(
                request.get("id") == discovery["pendingRequestId"]
                and request.get("status") == 3
                for request in snapshot.get("requests", [])
                if isinstance(request, dict)
            ),
        )
        self._open_request_section(self.clients[sender])
        sender_rejected_row = wait_until(
            lambda: self._request_row(
                self.clients[sender],
                peer_ptid=self.ptids[receiver],
                direction="outgoing",
                status=3,
            ),
            f"{sender} visible rejected request",
            timeout=STEP_TIMEOUT,
        )
        self.assert_condition(
            "friend_request_rejected_visible",
            rejected.get("status") == "3"
            and sender_rejected_row.get("status") == "3"
            and sender_rejected.get("acceptedFriendship") is False,
            json.dumps(
                {
                    "receiver": rejected,
                    "senderDom": sender_rejected_row,
                    "sender": sender_rejected,
                },
                sort_keys=True,
            ),
        )
        rejected_profile = self.step(
            "relationship.rejected-profile",
            lambda: self._select_request_profile(
                self.clients[sender],
                peer_ptid=self.ptids[receiver],
                direction="outgoing",
                status=3,
            ),
            sender,
        )
        self.assert_condition(
            "terminal_request_profile_selectable",
            rejected_profile.get("kind") == "person"
            and rejected_profile.get("peerPtid") == self.ptids[receiver]
            and int(rejected_profile.get("attemptCount") or 0)
            == len(counterparty_requests(
                sender_rejected,
                viewer_ptid=self.ptids[sender],
                peer_ptid=self.ptids[receiver],
            )),
            json.dumps(rejected_profile, sort_keys=True),
        )
        self.assert_condition(
            "station_identity_human_readable_copyable",
            bool(rejected_profile.get("stationName"))
            and rejected_profile.get("stationName")
            != rejected_profile.get("stationPeerId")
            and rejected_profile.get("detailsInitiallyOpen") is False
            and rejected_profile.get("detailsOpen") is True
            and {
                "actor-ptid",
                "station-peer-id",
            }.issubset(set(rejected_profile.get("copyFields") or [])),
            json.dumps(rejected_profile, sort_keys=True),
        )

        retry = self.step(
            "relationship.retry",
            lambda: self._retry_visible_request(sender, receiver),
            sender,
        )
        self.assert_condition(
            "friend_request_retry_available",
            retry["pendingRequestId"] != discovery["pendingRequestId"],
            json.dumps(
                {
                    "firstRequestId": discovery["pendingRequestId"],
                    "retryRequestId": retry["pendingRequestId"],
                },
                sort_keys=True,
            ),
        )
        accepted = self.step(
            "relationship.accept",
            lambda: self._decide_request(receiver, sender, "accept"),
            receiver,
        )

        snapshots = (
            self._wait_snapshot(
                sender,
                receiver,
                f"{sender} accepted relationship",
                lambda snapshot: snapshot.get("acceptedFriendship") is True,
            ),
            self._wait_snapshot(
                receiver,
                sender,
                f"{receiver} accepted relationship",
                lambda snapshot: snapshot.get("acceptedFriendship") is True,
            ),
        )
        self._open_request_section(self.clients[sender])
        sender_accepted_row = wait_until(
            lambda: self._request_row(
                self.clients[sender],
                peer_ptid=self.ptids[receiver],
                direction="outgoing",
                status=2,
            ),
            f"{sender} visible accepted request",
            timeout=STEP_TIMEOUT,
        )
        self.assert_condition(
            "friend_request_accepted_visible",
            accepted.get("status") == "2"
            and sender_accepted_row.get("status") == "2",
            json.dumps(
                {
                    "receiver": accepted,
                    "sender": sender_accepted_row,
                },
                sort_keys=True,
            ),
        )
        self.assert_condition(
            "friend_request_history_consolidated_selectable",
            sender_accepted_row.get("rowCount") == 1
            and int(sender_accepted_row.get("attemptCount") or 0)
            == len(counterparty_requests(
                snapshots[0],
                viewer_ptid=self.ptids[sender],
                peer_ptid=self.ptids[receiver],
            ))
            and int(sender_accepted_row.get("attemptCount") or 0) >= 2
            and sender_accepted_row.get("role") == "button"
            and sender_accepted_row.get("tabIndex") == "0"
            and rejected_profile.get("kind") == "person",
            json.dumps(
                {
                    "acceptedRow": sender_accepted_row,
                    "rejectedProfile": rejected_profile,
                },
                sort_keys=True,
            ),
        )
        self.assert_condition(
            "relationship_converged",
            all(
                snapshot.get("acceptedFriendship") is True
                for snapshot in snapshots
            ),
            json.dumps(snapshots, sort_keys=True),
        )

        wait_for_peer_key_bundle(
            self.clients[sender],
            self.ptids[receiver],
            str(
                runtime_station_service(
                    self.manifest,
                    receiver,
                ).get("runtimeIdentity")
                or ""
            ),
        )
        wait_for_peer_key_bundle(
            self.clients[receiver],
            self.ptids[sender],
            str(
                runtime_station_service(
                    self.manifest,
                    sender,
                ).get("runtimeIdentity")
                or ""
            ),
        )
        sender_conversation = self._open_contact_conversation(sender, receiver)
        receiver_conversation = self._open_contact_conversation(receiver, sender)
        converged_snapshots = wait_until(
            lambda: (
                current
                if accepted_conversation_id(
                    current := (
                        self._snapshot(sender, receiver),
                        self._snapshot(receiver, sender),
                    )
                )
                else None
            ),
            "one shared Direct conversation",
            timeout=STEP_TIMEOUT,
        )
        conversation_id = accepted_conversation_id(converged_snapshots)
        self.assert_condition(
            "direct_conversation_singleton",
            bool(conversation_id)
            and sender_conversation == conversation_id
            and receiver_conversation == conversation_id,
            json.dumps(
                {
                    "senderConversation": sender_conversation,
                    "receiverConversation": receiver_conversation,
                    "snapshots": converged_snapshots,
                },
                sort_keys=True,
            ),
        )
        self.report.runtime["onboarding"] = {
            "fixture": fixture,
            "discovery": discovery,
            "rejected": rejected,
            "retry": retry,
            "accepted": accepted,
            "snapshots": converged_snapshots,
        }
        return str(conversation_id)

    def run(self) -> dict[str, Any]:
        result = super().run()
        assertion_names = {
            assertion.name
            for assertion in self.report.assertions
        }
        missing = ONBOARDING_REQUIRED_ASSERTIONS - assertion_names
        if missing:
            raise GateError(
                f"onboarding assertions are missing: {sorted(missing)}"
            )
        result["journey"] = "onboarding-first-message"
        self.report.runtime["journey"] = "onboarding-first-message"
        return result


def main() -> int:
    selected = selected_native_runtime(GATE_ID)
    gate: AcceptanceGate = LifecycleOnboardingGate(
        manifest=selected.manifest,
        actor_manifest=selected.actor_manifest,
        runtime_binding=selected.binding,
    )
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
