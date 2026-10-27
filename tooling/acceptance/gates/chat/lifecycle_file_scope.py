"""Real Chat scope journeys paired with independent authority observations."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.native import (
    NativeDesktopRuntimeBinding,
    NativeKey,
    NativeModifier,
)
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.lifecycle_file_native import prove_file_grant_revocation
from tooling.acceptance.gates.chat.native_support import (
    ACCOUNTS,
    CHAT_FIXTURE_FEDERATION_NAME,
    DEV_ACCOUNT_PASSWORD,
    async_harness,
    enter_chat_page,
    wait_until,
)


def _native_command(
    client: TauriSession, command: str, input: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = client.driver.execute_async_script("""
        const done = arguments[arguments.length - 1];
        window.__TAURI__.core.invoke(arguments[0], { input: arguments[1] })
          .then(result => {
            if (!result.ok) {
              done({ failure: result.error?.code || 'NATIVE_COMMAND_FAILED' });
              return;
            }
            done(JSON.parse(result.data.status));
          }).catch(() => done({ failure: 'NATIVE_COMMAND_REJECTED' }));
    """, command, input)
    if not isinstance(result, dict) or result.get("failure"):
        raise GateError(f"Chat scope command {command} failed: {result}")
    return result


class ChatFileScopeJourney:
    """Reuse the bound client and Suite accounts; own no runtime allocation."""

    def __init__(
        self, *, client: TauriSession, runtime_binding: NativeDesktopRuntimeBinding,
        account: str, actor_ptid: str, conversation_id: str,
        primary_station: dict[str, Any], secondary_station: dict[str, Any],
        native_click: Callable[[str], Any], evidence_root: Path,
    ) -> None:
        self.client = client
        self.binding = runtime_binding
        self.account = account
        self.actor_ptid = actor_ptid
        self.conversation_id = conversation_id
        self.primary_station = primary_station
        self.secondary_station = secondary_station
        self.native_click = native_click
        self.evidence_root = evidence_root
        self.secondary_account = ACCOUNTS["charlie"]
        self.secondary_actor_ptid = ""
        self.secondary_conversation_id = ""
        self.primary_route_id = ""
        self.secondary_route_id = ""

    def _login_fixture(self, account: str) -> dict[str, Any]:
        result = async_harness(self.client, "loginWithPassword", {
            "account": account, "password": DEV_ACCOUNT_PASSWORD,
        }, timeout=60)
        if not isinstance(result, dict) or not result.get("authenticated"):
            raise GateError("Chat scope fixture session did not authenticate")
        return result

    def prepare(self) -> None:
        primary_peer = str(self.primary_station["runtimeIdentity"])
        secondary_peer = str(self.secondary_station["runtimeIdentity"])
        secondary_url = str(self.secondary_station["endpoint"]).rstrip("/")
        if primary_peer == secondary_peer:
            raise GateError("Chat Station boundary requires distinct Suite Stations")
        _native_command(self.client, "station_add", {"input": secondary_url})
        entries = _native_command(self.client, "station_list").get("entries", [])
        for entry in entries:
            if entry.get("station_peer_id") == secondary_peer:
                self.secondary_route_id = next((
                    route["route_id"] for route in entry["routes"]
                    if str(route["endpoint_origin"]).rstrip("/") == secondary_url
                ), "")
            if entry.get("station_peer_id") == primary_peer:
                self.primary_route_id = str(entry.get("active_route_id") or "")
        if not self.primary_route_id or not self.secondary_route_id:
            raise GateError("Chat scope fixture route is not bound to the Suite Station")
        try:
            secondary = self._login_fixture(self.secondary_account)
            self.secondary_actor_ptid = str(secondary.get("actorPtid") or "")
            if (
                not self.secondary_actor_ptid
                or self.secondary_actor_ptid == self.actor_ptid
            ):
                raise GateError("Chat account boundary lacks a distinct Suite actor")
        finally:
            self._restore_primary_session()
        federations = async_harness(self.client, "federationContext", {})
        contexts = federations.get("federations", []) if isinstance(federations, dict) else []
        context = next((
            entry for entry in contexts if entry.get("name") == CHAT_FIXTURE_FEDERATION_NAME
        ), None)
        if not context:
            raise GateError("Chat scope fixture has no canonical federation context")
        conversation = async_harness(self.client, "createDirectConversation", {
            "peerPtid": self.secondary_actor_ptid,
            "federationId": context["federationId"],
        })
        self.secondary_conversation_id = str((conversation or {}).get("conversationId") or "")
        if not self.secondary_conversation_id or self.secondary_conversation_id == self.conversation_id:
            raise GateError("Chat conversation boundary needs a distinct real conversation")
        self.restore_conversation()

    def restore_conversation(self) -> None:
        enter_chat_page(self.client)
        self.client.find_element(
            f'[data-pt-conversation-item="{self.conversation_id}"]', 30,
        ).click()
        self._require_conversation(self.conversation_id)

    def _require_conversation(self, conversation_id: str) -> None:
        wait_until(
            lambda: self.client.find_elements(
                f'[data-chat-conversation-pane="{conversation_id}"]',
            ),
            "Chat scope selected the expected real conversation", timeout=30,
        )

    def _restore_primary_session(self) -> None:
        if self.primary_route_id:
            _native_command(self.client, "station_set_active", {
                "station_peer_id": self.primary_station["runtimeIdentity"],
                "route_id": self.primary_route_id,
            })
        restored = self._login_fixture(self.account)
        if restored.get("actorPtid") != self.actor_ptid:
            raise GateError("Chat scope restoration authenticated the wrong actor")
        self.restore_conversation()

    def _logout_ui(self) -> dict[str, Any]:
        if self.client.process_id is None:
            raise GateError("Chat scope UI has no owning native client")
        adapter = self.binding.native_adapter
        self.native_click(".chat-file-modal .chat-file-header")
        adapter.post_key_to_process(
            self.client.process_id, NativeKey.COMMA, modifiers=(NativeModifier.PRIMARY,),
        )
        self.client.find_element('[data-pt-secondary-tab="help"]', 15).click()
        sections = self.client.find_elements('[data-pt-section-item="help"]')
        if sections:
            sections[0].click()
        self.client.find_element('.ant-btn-dangerous', 15).click()
        self.client.find_element('.ant-modal-confirm-btns .ant-btn-dangerous', 10).click()
        wait_until(
            lambda: self.client.find_elements('[data-station-picker-trigger]'),
            "real logout reset reached the account and Station gate", timeout=45,
        )
        identity = wait_until(
            lambda: value if (
                isinstance(value := async_harness(self.client, "identityState", {}), dict)
                and value.get("phase") == "accountGate"
                and value.get("authenticated") is False
            ) else None,
            "real logout removed authenticated identity", timeout=30,
        )
        return {"boundary": "logout", "identity": identity}

    def _login_ui(self, account: str, expected_ptid: str) -> dict[str, Any]:
        add = self.client.find_elements("[data-login-add-account]")
        if add:
            add[0].click()
        self.client.find_element('[data-login-tab="email"]', 15).click()
        email = self.client.find_element("[data-login-email]", 15)
        email.clear()
        email.send_keys(account)
        password = self.client.find_element("[data-login-password]", 10)
        password.send_keys(DEV_ACCOUNT_PASSWORD)
        self.client.find_element("[data-login-submit]", 10).click()

        def authenticated() -> dict[str, Any] | None:
            skip = self.client.find_elements("[data-login-pin-skip]")
            if skip and skip[0].is_displayed():
                skip[0].click()
            value = async_harness(self.client, "hydrateActiveActor", {}, timeout=10)
            return value if isinstance(value, dict) and value.get("actorPtid") == expected_ptid else None

        restored = wait_until(
            authenticated, "real account login reached the expected actor", timeout=60,
        )
        enter_chat_page(self.client)
        return {"actorPtid": restored["actorPtid"], "visibleChat": True}

    def _station_ui(self) -> dict[str, Any]:
        logout = self._logout_ui()
        self.client.find_element("[data-station-picker-trigger]", 10).click()
        peer_id = self.secondary_station["runtimeIdentity"]
        adapter = self.binding.native_adapter
        baseline = adapter.focused_control(self.client.process_id)
        self.native_click(
            f'[data-station-peer-id="{peer_id}"] '
            f'[data-station-route-id="{self.secondary_route_id}"]',
        )
        # Accept only the privacy confirmation owned by this route selection.
        confirmation = wait_until(
            lambda: control if (
                (control := adapter.focused_control(self.client.process_id)).dialog_count
                > baseline.dialog_count
            ) else None,
            "owned Station privacy confirmation", timeout=15,
        )
        adapter.post_key_to_process(self.client.process_id, NativeKey.ENTER)
        wait_until(
            lambda: self.client.find_element(
                f'[data-station-peer-id="{peer_id}"] '
                f'[data-station-route-id="{self.secondary_route_id}"]', 5,
            ).get_attribute("aria-pressed") == "true",
            "real Station picker visibly selected the new route", timeout=15,
        )
        registry = _native_command(self.client, "station_list")
        if registry.get("active_station_peer_id") != peer_id:
            raise GateError("real Station picker did not select the Suite Station")
        return {"boundary": "station", "stationPeerId": peer_id,
                "selectedRouteVisible": True,
                "confirmation": confirmation.to_dict(), "logout": logout}

    def prove(self, attachment_id: str) -> dict[str, Any]:
        def conversation_ui() -> dict[str, Any]:
            self.client.find_element(".ant-modal-close", 5).click()
            self.client.find_element(
                f'[data-pt-conversation-item="{self.secondary_conversation_id}"]', 15,
            ).click()
            self._require_conversation(self.secondary_conversation_id)
            return {"boundary": "conversation", "conversationId": self.secondary_conversation_id}

        def conversation_owner() -> dict[str, Any]:
            async_harness(self.client, "syncFriendSession", {
                "sessionUlid": self.secondary_conversation_id,
            })
            self._require_conversation(self.secondary_conversation_id)
            return {"boundary": "conversation", "owner": "messaging-runtime"}

        def account_ui() -> dict[str, Any]:
            logout = self._logout_ui()
            account = self._login_ui(self.secondary_account, self.secondary_actor_ptid)
            return {"boundary": "account", "logout": logout, "account": account}

        def account_authority() -> dict[str, Any]:
            selected = async_harness(self.client, "replaceAccountWithPassword", {
                "account": self.secondary_account, "password": DEV_ACCOUNT_PASSWORD,
            }, timeout=60)
            if not isinstance(selected, dict) or selected.get("actorPtid") != self.secondary_actor_ptid:
                raise GateError("independent account authority did not change")
            return {"boundary": "account", "owner": "identity-runtime",
                    "command": "access_submit_login",
                    "actorPtid": selected["actorPtid"]}

        def station_authority() -> dict[str, Any]:
            selected = _native_command(self.client, "station_set_active", {
                "station_peer_id": self.secondary_station["runtimeIdentity"],
                "route_id": self.secondary_route_id,
            })
            if selected.get("active_station_peer_id") != self.secondary_station["runtimeIdentity"]:
                raise GateError("independent native Station authority did not change")
            return {"boundary": "station", "command": "station_set_active",
                    "stationPeerId": selected["active_station_peer_id"]}

        observations = {}
        for boundary, ui, owner in (
            ("conversation", conversation_ui, conversation_owner),
            ("account", account_ui, account_authority),
            ("station", self._station_ui, station_authority),
        ):
            restore = self.restore_conversation if boundary == "conversation" else self._restore_primary_session
            observations[boundary] = {}
            for evidence_class, transition in (("ui", ui), ("supporting-authority", owner)):
                observations[boundary][evidence_class] = prove_file_grant_revocation(
                    client=self.client, runtime_binding=self.binding,
                    attachment_id=attachment_id, actor_ptid=self.actor_ptid,
                    transition=transition, restore=restore,
                    evidence_class=evidence_class,
                    evidence_root=self.evidence_root / boundary / evidence_class,
                )
        observations["logout"] = prove_file_grant_revocation(
            client=self.client, runtime_binding=self.binding,
            attachment_id=attachment_id, actor_ptid=self.actor_ptid,
            transition=self._logout_ui, restore=self._restore_primary_session,
            evidence_root=self.evidence_root / "logout",
        )
        return observations
