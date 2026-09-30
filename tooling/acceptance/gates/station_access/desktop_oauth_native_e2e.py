#!/usr/bin/env python3
"""Native Desktop proof for OAuth loopback startup before authentication."""

from __future__ import annotations

import json
import os
import re
import time
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
from urllib.request import ProxyHandler, build_opener

from selenium.webdriver import ActionChains

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    REPO_ROOT,
    call_async_harness,
    load_runtime_manifest,
)
from tooling.acceptance.drivers.native import resolve_native_desktop_runtime
from tooling.acceptance.drivers.tauri import TauriSession


GATE_ID = "station-access-desktop-oauth-native-e2e"
CLIENT_ID = "oauth-login"
PROVIDERS = ("github", "google")
OAUTH_AVATAR_URL = "https://avatars.githubusercontent.com/u/583231?v=4"
CHAT_NAV_SELECTOR = '[data-pt-primary-nav="chat"] [role="button"]'
REQUIRED_ASSERTIONS = frozenset(
    {
        "native_login_surface_is_unauthenticated",
        "github_loopback_starts_before_authentication",
        "google_loopback_starts_before_authentication",
        "github_loopback_cancels_before_authentication",
        "google_loopback_cancels_before_authentication",
        "oauth_callback_creates_station_session",
        "oauth_callback_restores_authenticated_identity",
        "oauth_identity_projection_is_consistent",
        "account_identity_ui_shows_provider_and_ptid",
        "find_people_scope_labels_and_tooltips_are_distinct",
        "native_runtime_is_source_bound",
        "native_runtime_cleanup",
    }
)


def is_native_tauri_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "tauri"
        and parsed.hostname == "localhost"
        and parsed.username is None
        and parsed.password is None
        and port is None
    )


def find_people_scopes_are_distinct(evidence: Mapping[str, object]) -> bool:
    federation = evidence.get("federation")
    station = evidence.get("station")
    if not isinstance(federation, Mapping) or not isinstance(station, Mapping):
        return False
    federation_label = str(federation.get("label") or "").strip()
    station_label = str(station.get("label") or "").strip()
    federation_aria = str(federation.get("ariaLabel") or "").strip()
    station_aria = str(station.get("ariaLabel") or "").strip()
    return (
        federation.get("name") == station.get("name") == "local"
        and federation_label == "Federation: local"
        and station_label == "Station: local"
        and federation_label != station_label
        and bool(federation_aria)
        and bool(station_aria)
        and federation_aria != station_aria
        and federation.get("tooltip") == federation_aria
        and station.get("tooltip") == station_aria
    )


OAUTH_START_SCRIPT = """
const providerId = arguments[0];
const done = arguments[arguments.length - 1];
const internals = window.__TAURI_INTERNALS__;
if (!internals || typeof internals.invoke !== 'function') {
  done({ transport: 'missing', error: 'Tauri invoke is unavailable' });
  return;
}
let settled = false;
const finish = (value) => {
  if (settled) return;
  settled = true;
  window.clearTimeout(timer);
  done(value);
};
const timer = window.setTimeout(
  () => finish({ transport: 'timeout', error: 'oauth2_start_loopback timed out' }),
  10000,
);
Promise.resolve(internals.invoke('oauth2_start_loopback', {
  input: { id: providerId, environment: 'prod' },
})).then(
  (value) => finish({ transport: 'resolved', value }),
  (error) => finish({
    transport: 'rejected',
    error: {
      code: error?.code || error?.error?.code || '',
      message: error?.message || error?.error?.message || String(error),
    },
  }),
);
"""
OAUTH_CANCEL_SCRIPT = """
const sessionId = arguments[0];
const done = arguments[arguments.length - 1];
const internals = window.__TAURI_INTERNALS__;
Promise.resolve(internals.invoke('oauth2_cancel_loopback', {
  input: { session_id: sessionId },
})).then(
  (value) => done({ transport: 'resolved', value }),
  (error) => done({
    transport: 'rejected',
    error: {
      code: error?.code || error?.error?.code || '',
      message: error?.message || error?.error?.message || String(error),
    },
  }),
);
"""
OAUTH_POLL_SCRIPT = """
const sessionId = arguments[0];
const done = arguments[arguments.length - 1];
const internals = window.__TAURI_INTERNALS__;
Promise.resolve(internals.invoke('oauth2_poll_loopback', {
  input: { session_id: sessionId },
})).then(
  (value) => done({ transport: 'resolved', value }),
  (error) => done({
    transport: 'rejected',
    error: {
      code: error?.code || error?.error?.code || '',
      message: error?.message || error?.error?.message || String(error),
    },
  }),
);
"""


class DesktopOAuthNativeGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-OAUTH"
    bom = ("SAL-OAUTH-01",)
    spec = ("station-access-desktop-oauth-preauth",)

    def __init__(self) -> None:
        super().__init__()
        manifest_path = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_MANIFEST",
            "",
        ).strip()
        if not manifest_path:
            raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        self.manifest = load_runtime_manifest(Path(manifest_path), self.gate_id)
        self.report.manifest = self.manifest
        runtime_cell_manifest_path = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_CELL_MANIFEST",
            "",
        ).strip()
        if not runtime_cell_manifest_path:
            raise GateError("PT_ACCEPTANCE_RUNTIME_CELL_MANIFEST is required")
        try:
            runtime_cell_manifest = json.loads(
                Path(runtime_cell_manifest_path).read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError) as error:
            raise GateError(
                f"Desktop OAuth runtime-cell manifest is invalid: {error}"
            ) from error
        self.runtime_cell_manifest = self._mapping(
            runtime_cell_manifest,
            "runtime-cell manifest",
        )
        source = self._mapping(self.manifest.get("source"), "runtime source")
        source_commit = str(source.get("commit") or "")
        if source.get("workspaceDigest") != "clean" or not source_commit:
            raise GateError("Desktop OAuth native proof requires clean source")
        cell_id = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()
        if cell_id != "desktop-macos-native":
            raise GateError(
                "Desktop OAuth native proof requires desktop-macos-native"
            )
        self.runtime_binding = resolve_native_desktop_runtime(
            cell_id,
            gate_id=self.gate_id,
            source_commit=source_commit,
        )
        self.runtime_binding.set_runtime_manifest(self.manifest)

    def run(self) -> dict[str, Any]:
        client = self._client()
        session: TauriSession | None = None
        cleanup: dict[str, Any] = {}
        find_people_scopes: dict[str, Any] = {}
        try:
            session = self.runtime_binding.create_bound_session(CLIENT_ID)
            login_card = self._wait_for_displayed(
                session,
                "[data-pt-login-card]",
                timeout=30,
            )
            identity = self._mapping(
                call_async_harness(
                    session,
                    "identityState",
                    {},
                    namespace="stationAccess",
                    script_timeout=10,
                ),
                "Desktop pre-authentication identity",
            )
            self.save_screenshot(session, "desktop-oauth-pre-auth")
            self.save_dom(session, "desktop-oauth-pre-auth")
            self.assert_condition(
                "native_login_surface_is_unauthenticated",
                login_card.is_displayed()
                and identity.get("authenticated") is False
                and not identity.get("actorPtid"),
                json.dumps(identity, sort_keys=True),
            )

            providers = {
                provider_id: self._start_oauth(session, provider_id)
                for provider_id in PROVIDERS
            }
            for provider_id in PROVIDERS:
                self.assert_condition(
                    f"{provider_id}_loopback_starts_before_authentication",
                    providers[provider_id]["transport"] == "resolved"
                    and providers[provider_id]["hasAuthorizationUrl"] is True
                    and providers[provider_id]["hasLoopbackSession"] is True
                    and providers[provider_id]["hasLoopbackCallback"] is True,
                    json.dumps(providers[provider_id], sort_keys=True),
                )
                cancellation = self._cancel_oauth(
                    session,
                    providers[provider_id]["sessionId"],
                )
                providers[provider_id]["cancellation"] = cancellation
                self.assert_condition(
                    f"{provider_id}_loopback_cancels_before_authentication",
                    cancellation["transport"] == "resolved"
                    and cancellation["cancelled"] is True
                    and cancellation["status"] == "cancelled",
                    json.dumps(cancellation, sort_keys=True),
                )

            login_start = self._start_oauth_via_product(session, "github")
            callback = self._send_callback(
                login_start["callbackUrl"],
                provider_id="github",
                provider_user_id="acceptance-native-oauth",
                email="oauth.acceptance@test.invalid",
            )
            callback_result = self._poll_oauth(
                session,
                login_start["sessionId"],
            )
            authenticated_identity = self._complete_oauth_via_product(
                session,
                "github",
            )
            login_surface_visible = any(
                element.is_displayed()
                for element in session.find_elements("[data-pt-login-card]")
            )
            providers["github"]["loginProof"] = {
                "callback": callback,
                "loopback": callback_result,
                "identity": authenticated_identity,
                "loginSurfaceVisible": login_surface_visible,
            }
            actor_ptid = str(authenticated_identity.get("actorPtid") or "")
            self.assert_condition(
                "oauth_callback_creates_station_session",
                callback["statusCode"] == 200
                and callback_result["completed"] is True
                and callback_result["status"] == "completed"
                and actor_ptid.startswith("ptid:"),
                json.dumps(providers["github"]["loginProof"], sort_keys=True),
            )
            self.assert_condition(
                "oauth_callback_restores_authenticated_identity",
                authenticated_identity.get("authenticated") is True
                and authenticated_identity.get("lifecycleState") == "ready"
                and authenticated_identity.get("phaseKind") != "accountGate"
                and actor_ptid.startswith("ptid:")
                and not login_surface_visible,
                json.dumps(authenticated_identity, sort_keys=True),
            )
            identity_projection = self._mapping(
                call_async_harness(
                    session,
                    "oauthIdentityProjection",
                    {},
                    namespace="stationAccess",
                    script_timeout=30,
                ),
                "Desktop OAuth identity projection",
            )
            providers["github"]["identityProjection"] = identity_projection
            projected_avatar = str(identity_projection.get("profileAvatarUrl") or "")
            self.assert_condition(
                "oauth_identity_projection_is_consistent",
                identity_projection.get("actorPtid") == actor_ptid
                and identity_projection.get("profilePtid") == actor_ptid
                and identity_projection.get("sessionProvider") == "github"
                and identity_projection.get("accountProvider") == "github"
                and bool(projected_avatar)
                and identity_projection.get("sessionAvatarUrl") == projected_avatar
                and identity_projection.get("accountAvatarUrl") == projected_avatar,
                json.dumps(identity_projection, sort_keys=True),
            )

            call_async_harness(
                session,
                "openAccountIdentity",
                {},
                namespace="stationAccess",
                script_timeout=10,
            )
            account_avatar = self._wait_for_displayed(
                session,
                "[data-pt-account-avatar-url]",
                timeout=20,
            )
            account_ptid = self._wait_for_displayed(
                session,
                '[data-pt-account-identity="ptid"]',
                timeout=20,
            )
            account_provider = self._wait_for_displayed(
                session,
                '[data-pt-account-identity="login-provider"]',
                timeout=20,
            )
            account_ui = {
                "avatarUrl": account_avatar.get_attribute(
                    "data-pt-account-avatar-url"
                ),
                "ptid": account_ptid.text,
                "provider": account_provider.text,
            }
            providers["github"]["accountUi"] = account_ui
            self.assert_condition(
                "account_identity_ui_shows_provider_and_ptid",
                account_ui["avatarUrl"] == projected_avatar
                and actor_ptid in account_ui["ptid"]
                and "GitHub" in account_ui["provider"],
                json.dumps(account_ui, sort_keys=True),
            )
            self.save_screenshot(session, "desktop-oauth-authenticated")
            self.save_dom(session, "desktop-oauth-authenticated")

            find_people_scopes = self._find_people_scope_evidence(session)
            self.assert_condition(
                "find_people_scope_labels_and_tooltips_are_distinct",
                find_people_scopes_are_distinct(find_people_scopes),
                json.dumps(find_people_scopes, sort_keys=True),
            )
            self.save_screenshot(session, "desktop-oauth-find-people-scopes")
            self.save_dom(session, "desktop-oauth-find-people-scopes")

            source_identity = self._source_identity()
            document_url = session.get_current_url()
            self.assert_condition(
                "native_runtime_is_source_bound",
                is_native_tauri_url(document_url)
                and source_identity["verified"] is True,
                json.dumps(
                    {
                        "documentUrl": document_url,
                        "sourceIdentity": source_identity,
                    },
                    sort_keys=True,
                ),
            )
        finally:
            if session is not None:
                session.stop()
                self.save_app_log(session, "desktop-oauth-pre-auth")
            cleanup = self.runtime_binding.finalize_cleanup(
                [session] if session is not None else [],
                {CLIENT_ID: client},
            )
            self.report.runtime["cleanup"] = cleanup

        self.assert_condition(
            "native_runtime_cleanup",
            cleanup.get("portsReleased") is True
            and cleanup.get("processesReleased") is True
            and cleanup.get("storageReleased") is True
            and not cleanup.get("cleanupErrors"),
            json.dumps(cleanup, sort_keys=True),
        )
        assertions = {assertion.name for assertion in self.report.assertions}
        missing = REQUIRED_ASSERTIONS - assertions
        if missing:
            raise GateError(
                f"Desktop OAuth native assertions are missing: {sorted(missing)}"
            )
        return {
            "environment": "station-access-desktop-oauth-native",
            "runtimeCell": "desktop-macos-native",
            "journey": "station-access-desktop-oauth-preauth",
            "providers": providers,
            "findPeopleScopes": find_people_scopes,
            "sourceIdentity": source_identity,
            "cleanup": cleanup,
        }

    def _client(self) -> dict[str, Any]:
        clients = self.manifest.get("clients")
        if not isinstance(clients, list):
            raise GateError("Desktop OAuth runtime clients are missing")
        matches = [
            dict(client)
            for client in clients
            if isinstance(client, Mapping) and client.get("id") == CLIENT_ID
        ]
        if len(matches) != 1:
            raise GateError("Desktop OAuth runtime requires exactly one login client")
        return matches[0]

    @staticmethod
    def _wait_for_displayed(
        session: TauriSession,
        selector: str,
        *,
        timeout: float,
    ) -> Any:
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            try:
                element = session.find_element(selector, timeout=1)
                if element.is_displayed():
                    return element
            except Exception as error:  # noqa: BLE001 - retained for evidence.
                last_error = error
            time.sleep(0.1)
        suffix = f"; last error: {last_error}" if last_error else ""
        raise GateError(
            f"Desktop OAuth element did not become visible: {selector}{suffix}"
        )

    @classmethod
    def _find_people_scope_evidence(
        cls,
        session: TauriSession,
    ) -> dict[str, Any]:
        session.find_element(
            CHAT_NAV_SELECTOR,
            timeout=20,
        ).click()
        cls._wait_for_displayed(
            session,
            "[data-chat-new-menu]",
            timeout=20,
        ).click()
        cls._wait_for_displayed(
            session,
            "[data-chat-find-people-menu]",
            timeout=10,
        ).click()
        cls._wait_for_displayed(
            session,
            "[data-chat-find-people]",
            timeout=20,
        )

        federation = cls._wait_for_displayed_with_text(
            session,
            '[data-chat-find-people-scope="federation"]',
            "Federation: local",
            timeout=20,
        )
        federation_aria = str(federation.get_attribute("aria-label") or "").strip()
        federation_tooltip = cls._hover_tooltip(
            session,
            federation,
            federation_aria,
            timeout=10,
        )
        federation.click()
        station = cls._wait_for_displayed_with_text(
            session,
            '[data-chat-find-people-scope="station"]',
            "Station: local",
            timeout=30,
        )

        station_aria = str(station.get_attribute("aria-label") or "").strip()
        station_tooltip = cls._hover_tooltip(
            session,
            station,
            station_aria,
            timeout=10,
        )
        return {
            "federation": {
                "name": "local",
                "label": federation.text.strip(),
                "ariaLabel": federation_aria,
                "tooltip": federation_tooltip,
            },
            "station": {
                "name": "local",
                "label": station.text.strip(),
                "ariaLabel": station_aria,
                "tooltip": station_tooltip,
            },
        }

    @staticmethod
    def _wait_for_displayed_with_text(
        session: TauriSession,
        selector: str,
        expected_text: str,
        *,
        timeout: float,
    ) -> Any:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for element in session.find_elements(selector):
                if element.is_displayed() and element.text.strip() == expected_text:
                    return element
            time.sleep(0.1)
        raise GateError(
            "Desktop OAuth element did not become visible with expected text: "
            f"{selector}={expected_text!r}"
        )

    @staticmethod
    def _hover_tooltip(
        session: TauriSession,
        element: Any,
        expected_text: str,
        *,
        timeout: float,
    ) -> str:
        if not expected_text:
            raise GateError("Find People scope aria-label is empty")
        ActionChains(session.driver).move_to_element(element).perform()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for tooltip in session.find_elements(".ant-tooltip-inner"):
                tooltip_text = tooltip.text.strip()
                if tooltip.is_displayed() and tooltip_text == expected_text:
                    return tooltip_text
            time.sleep(0.1)
        raise GateError(
            "Find People scope tooltip did not become visible with expected text: "
            f"{expected_text!r}"
        )

    def _source_identity(self) -> dict[str, Any]:
        source = self._mapping(self.manifest.get("source"), "runtime source")
        services = self._mapping(
            self.manifest.get("services"),
            "runtime services",
        )
        station = self._mapping(services.get("station"), "Station attestation")
        runtime_cell = self.runtime_binding.runtime_identity()
        binary = self.runtime_binding.binary_identity()
        leased_cell = self.runtime_cell_manifest
        cell_source = self._mapping(
            runtime_cell.get("source"),
            "runtime-cell source",
        )
        leased_cell_source = self._mapping(
            leased_cell.get("source"),
            "leased runtime-cell source",
        )
        source_commit = str(source.get("commit") or "")
        binary_sha256 = str(binary.get("sha256") or "")
        verified = (
            self.manifest.get("state") == "FIXTURE_READY"
            and self.manifest.get("gateId") == self.gate_id
            and source.get("workspaceDigest") == "clean"
            and station.get("workspaceDigest") == "clean"
            and station.get("liveCommit") == source_commit
            and runtime_cell.get("cellId") == "desktop-macos-native"
            and runtime_cell.get("gateId") == self.gate_id
            and runtime_cell.get("state") == "LEASED"
            and leased_cell.get("cellId") == "desktop-macos-native"
            and leased_cell.get("gateId") == self.gate_id
            and leased_cell.get("state") == "LEASED"
            and cell_source.get("commit") == source_commit
            and cell_source.get("workspaceDigest") == "clean"
            and leased_cell_source.get("commit") == source_commit
            and leased_cell_source.get("workspaceDigest") == "clean"
            and binary.get("sourceCommit") == source_commit
            and re.fullmatch(r"[0-9a-f]{64}", binary_sha256) is not None
            and cell_source.get("binarySha256") == binary_sha256
            and leased_cell_source.get("binarySha256") == binary_sha256
        )
        return {
            "orchestrator": source,
            "station": station,
            "runtimeCell": runtime_cell,
            "leasedRuntimeCell": leased_cell,
            "binary": binary,
            "verified": verified,
        }

    @staticmethod
    def _oauth_start_evidence(
        provider_id: str,
        auth_url: str,
        session_id: str,
    ) -> dict[str, Any]:
        parsed_url = urlparse(auth_url)
        return_to = parse_qs(parsed_url.query).get("return_to", [""])[0]
        parsed_callback = urlparse(return_to)
        return {
            "provider": provider_id,
            "transport": "resolved",
            "authorizationOrigin": (
                f"{parsed_url.scheme}://{parsed_url.netloc}"
                if parsed_url.scheme and parsed_url.netloc
                else ""
            ),
            "hasAuthorizationUrl": parsed_url.scheme in {"http", "https"},
            "hasLoopbackSession": session_id.startswith("lp-"),
            "hasLoopbackCallback": (
                parsed_callback.scheme == "http"
                and parsed_callback.hostname in {"127.0.0.1", "localhost", "::1"}
                and parse_qs(parsed_callback.query).get("session_id") == [session_id]
            ),
            "callbackUrl": return_to,
            "sessionId": session_id,
        }

    @staticmethod
    def _start_oauth(
        session: TauriSession,
        provider_id: str,
    ) -> dict[str, Any]:
        raw = session.execute_async_script(OAUTH_START_SCRIPT, provider_id)
        if not isinstance(raw, Mapping) or raw.get("transport") != "resolved":
            raise GateError(
                f"{provider_id} OAuth start failed before authentication: "
                f"{json.dumps(raw, sort_keys=True)}"
            )
        result = raw.get("value")
        if not isinstance(result, Mapping) or result.get("ok") is not True:
            raise GateError(
                f"{provider_id} OAuth start was rejected before authentication: "
                f"{json.dumps(result, sort_keys=True)}"
            )
        data = result.get("data")
        status_raw = data.get("status") if isinstance(data, Mapping) else None
        if not isinstance(status_raw, str):
            raise GateError(f"{provider_id} OAuth start omitted status")
        try:
            status = json.loads(status_raw)
        except json.JSONDecodeError as error:
            raise GateError(
                f"{provider_id} OAuth start returned invalid status JSON"
            ) from error
        return DesktopOAuthNativeGate._oauth_start_evidence(
            provider_id,
            str(status.get("auth_url") or ""),
            str(status.get("session_id") or ""),
        )

    @staticmethod
    def _start_oauth_via_product(
        session: TauriSession,
        provider_id: str,
    ) -> dict[str, Any]:
        start = DesktopOAuthNativeGate._mapping(
            call_async_harness(
                session,
                "beginOAuthLogin",
                {"providerId": provider_id},
                namespace="stationAccess",
                script_timeout=15,
            ),
            "Desktop product OAuth start",
        )
        return DesktopOAuthNativeGate._oauth_start_evidence(
            provider_id,
            str(start.get("authUrl") or ""),
            str(start.get("sessionId") or ""),
        )

    @staticmethod
    def _build_callback_url(
        callback_url: str,
        *,
        provider_id: str,
        provider_user_id: str,
        email: str,
        timestamp: str,
    ) -> str:
        parsed = urlparse(callback_url)
        query = {
            key: values[-1]
            for key, values in parse_qs(parsed.query, keep_blank_values=True).items()
            if values
        }
        query.update(
            {
                "provider": provider_id,
                "provider_user_id": provider_user_id,
                "username": "oauthacceptance",
                "display_name": "OAuth Acceptance",
                "email": email,
                "avatar_url": OAUTH_AVATAR_URL,
                "ts": timestamp,
            }
        )
        return urlunparse(parsed._replace(query=urlencode(query)))

    @classmethod
    def _send_callback(
        cls,
        callback_url: str,
        *,
        provider_id: str,
        provider_user_id: str,
        email: str,
    ) -> dict[str, Any]:
        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
            "+00:00",
            "Z",
        )
        target = cls._build_callback_url(
            callback_url,
            provider_id=provider_id,
            provider_user_id=provider_user_id,
            email=email,
            timestamp=timestamp,
        )
        try:
            opener = build_opener(ProxyHandler({}))
            with opener.open(target, timeout=15) as response:
                response.read()
                status_code = int(response.status)
        except OSError as error:
            raise GateError(f"OAuth loopback callback failed: {error}") from error
        return {
            "provider": provider_id,
            "statusCode": status_code,
        }

    @staticmethod
    def _invoke_status(
        session: TauriSession,
        script: str,
        *args: str,
        label: str,
    ) -> dict[str, Any]:
        raw = session.execute_async_script(script, *args)
        if not isinstance(raw, Mapping) or raw.get("transport") != "resolved":
            raise GateError(f"{label} transport failed: {json.dumps(raw, sort_keys=True)}")
        result = raw.get("value")
        if not isinstance(result, Mapping) or result.get("ok") is not True:
            raise GateError(f"{label} failed: {json.dumps(result, sort_keys=True)}")
        data = result.get("data")
        status_raw = data.get("status") if isinstance(data, Mapping) else None
        if not isinstance(status_raw, str):
            raise GateError(f"{label} omitted status")
        try:
            return DesktopOAuthNativeGate._mapping(
                json.loads(status_raw),
                f"{label} status",
            )
        except json.JSONDecodeError as error:
            raise GateError(f"{label} returned invalid status JSON") from error

    @classmethod
    def _poll_oauth(
        cls,
        session: TauriSession,
        session_id: str,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + 20
        latest: dict[str, Any] = {}
        while time.monotonic() < deadline:
            latest = cls._invoke_status(
                session,
                OAUTH_POLL_SCRIPT,
                session_id,
                label="OAuth callback poll",
            )
            if latest.get("completed") is True:
                result = {
                    "completed": True,
                    "status": str(latest.get("status") or ""),
                    "error": str(latest.get("error") or ""),
                }
                if result["status"] != "completed":
                    raise GateError(
                        "OAuth callback failed: "
                        f"{json.dumps(result, sort_keys=True)}"
                    )
                return result
            time.sleep(0.1)
        raise GateError(
            f"OAuth callback did not complete: {json.dumps(latest, sort_keys=True)}"
        )

    @staticmethod
    def _complete_oauth_via_product(
        session: TauriSession,
        provider_id: str,
    ) -> dict[str, Any]:
        return DesktopOAuthNativeGate._mapping(
            call_async_harness(
                session,
                "completeOAuthLogin",
                {"providerId": provider_id},
                namespace="stationAccess",
                script_timeout=45,
            ),
            "Desktop completed OAuth identity",
        )

    @staticmethod
    def _cancel_oauth(
        session: TauriSession,
        session_id: str,
    ) -> dict[str, Any]:
        raw = session.execute_async_script(OAUTH_CANCEL_SCRIPT, session_id)
        if not isinstance(raw, Mapping) or raw.get("transport") != "resolved":
            raise GateError(
                "OAuth cancellation failed before authentication: "
                f"{json.dumps(raw, sort_keys=True)}"
            )
        result = raw.get("value")
        if not isinstance(result, Mapping) or result.get("ok") is not True:
            raise GateError(
                "OAuth cancellation was rejected before authentication: "
                f"{json.dumps(result, sort_keys=True)}"
            )
        data = result.get("data")
        status_raw = data.get("status") if isinstance(data, Mapping) else None
        if not isinstance(status_raw, str):
            raise GateError("OAuth cancellation omitted status")
        try:
            status = json.loads(status_raw)
        except json.JSONDecodeError as error:
            raise GateError("OAuth cancellation returned invalid status JSON") from error
        return {
            "transport": "resolved",
            "cancelled": status.get("cancelled") is True,
            "status": str(status.get("status") or ""),
        }

    @staticmethod
    def _mapping(value: object, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)


def main() -> int:
    return DesktopOAuthNativeGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
