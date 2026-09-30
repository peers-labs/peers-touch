from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
import unittest
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

from tooling.acceptance.core import BlockedError, GateError
from tooling.acceptance.drivers.native import MouseAction
from tooling.acceptance.gates.station_access.desktop_oauth_native_e2e import (
    ACCOUNT_IDENTITY_SUMMARY_SELECTOR,
    ACCOUNT_LOGIN_PROVIDER_SELECTOR,
    CHAT_NAV_SELECTOR,
    DesktopOAuthNativeGate,
    LEGACY_ACCOUNT_LOGIN_PROVIDER_FIELD_SELECTOR,
    OAUTH_AVATAR_URL,
    find_people_scopes_are_distinct,
    is_native_tauri_url,
)
from tooling.acceptance.provisioners.station_access_desktop_oauth_native import (
    OAuthBridgeSignerCapabilityHandler,
    StationAccessDesktopOAuthNativeProvisioner,
    _station_restart_script,
    oauth_bridge_signature_message,
)


class _FakeSession:
    def __init__(self, response: object) -> None:
        self.response = response

    def execute_async_script(self, script: str, provider_id: str) -> object:
        self.script = script
        self.provider_id = provider_id
        return self.response


class _FakeRuntimeBinding:
    def __init__(self, binary_sha256: str) -> None:
        self.binary_sha256 = binary_sha256

    def runtime_identity(self) -> dict[str, object]:
        return {
            "cellId": "desktop-macos-native",
            "gateId": "station-access-desktop-oauth-native-e2e",
            "state": "LEASED",
            "source": {
                "commit": "a" * 40,
                "workspaceDigest": "clean",
                "binarySha256": self.binary_sha256,
            },
        }

    def binary_identity(self) -> dict[str, str]:
        return {
            "path": "/tmp/peers-touch-desktop",
            "sha256": "b" * 64,
            "sourceCommit": "a" * 40,
        }


class _FakeCapabilityClient:
    def __init__(self, response: dict[str, object]) -> None:
        self.response = response

    def invoke(
        self,
        capability_id: str,
        operation: str,
        payload: dict[str, object],
        *,
        timeout_seconds: float,
    ) -> dict[str, object]:
        self.capability_id = capability_id
        self.operation = operation
        self.payload = payload
        self.timeout_seconds = timeout_seconds
        return self.response


class _FakeNativeAdapter:
    def __init__(self) -> None:
        self.mouse_calls: list[tuple[tuple[MouseAction, ...], tuple[float, float]]] = []

    def content_origin(self, process_id: int) -> tuple[float, float]:
        self.process_id = process_id
        return 100.0, 200.0

    def post_mouse(
        self,
        actions: tuple[MouseAction, ...],
        point: tuple[float, float],
    ) -> None:
        self.mouse_calls.append((actions, point))


class _FakeHoverElement:
    text = "tooltip"

    def is_displayed(self) -> bool:
        return True


class _FakeHoverSession:
    process_id = 42

    def __init__(self, *, focused: bool = True, rendered: bool = True) -> None:
        self.focused = focused
        self.rendered = rendered

    def execute_script(self, script: str, *args: object) -> object:
        if "document.hasFocus" in script:
            return self.focused
        if "style.visibility" in script:
            self.visibility_script = script
            self.visibility_args = args
            return {"visible": self.rendered}
        if "getBoundingClientRect" in script:
            return {"x": 5.0, "y": 7.0}
        return None

    def find_elements(self, selector: str) -> list[_FakeHoverElement]:
        self.selector = selector
        return [_FakeHoverElement()]


class _FakeHoverRuntimeBinding:
    def __init__(self, adapter: _FakeNativeAdapter) -> None:
        self.native_adapter = adapter
        self.activation_requested = False

    def request_cooperative_activation(
        self,
        target: _FakeHoverSession,
        sessions: tuple[_FakeHoverSession, ...],
    ) -> bool:
        self.activation_requested = sessions == (target,)
        target.focused = True
        return True


class DesktopOAuthNativeGateTest(unittest.TestCase):
    def test_chat_navigation_targets_the_production_role_button(self) -> None:
        self.assertEqual(
            CHAT_NAV_SELECTOR,
            '[data-pt-primary-nav="chat"] [role="button"]',
        )

    def test_account_provider_targets_the_compact_identity_summary(self) -> None:
        self.assertEqual(
            ACCOUNT_IDENTITY_SUMMARY_SELECTOR,
            "[data-pt-account-identity-summary]",
        )
        self.assertEqual(
            ACCOUNT_LOGIN_PROVIDER_SELECTOR,
            "[data-pt-account-login-provider]",
        )
        self.assertEqual(
            LEGACY_ACCOUNT_LOGIN_PROVIDER_FIELD_SELECTOR,
            '[data-pt-account-identity="login-provider"]',
        )

    def test_accepts_distinct_same_name_scope_evidence(self) -> None:
        self.assertTrue(
            find_people_scopes_are_distinct(
                {
                    "federation": {
                        "name": "local",
                        "label": "Federation: local",
                        "ariaLabel": (
                            "Search every discoverable person in the local federation."
                        ),
                        "tooltip": (
                            "Search every discoverable person in the local federation."
                        ),
                    },
                    "station": {
                        "name": "local",
                        "label": "Station: local",
                        "ariaLabel": (
                            "Search only people whose Home Station is local."
                        ),
                        "tooltip": (
                            "Search only people whose Home Station is local."
                        ),
                    },
                }
            )
        )

    def test_rejects_ambiguous_same_name_scope_evidence(self) -> None:
        self.assertFalse(
            find_people_scopes_are_distinct(
                {
                    "federation": {
                        "name": "local",
                        "label": "local",
                        "ariaLabel": "local",
                        "tooltip": "local",
                    },
                    "station": {
                        "name": "local",
                        "label": "local",
                        "ariaLabel": "local",
                        "tooltip": "local",
                    },
                }
            )
        )

    def test_hover_tooltip_uses_native_pointer_coordinates(self) -> None:
        gate = object.__new__(DesktopOAuthNativeGate)
        adapter = _FakeNativeAdapter()
        gate.runtime_binding = _FakeHoverRuntimeBinding(adapter)
        session = _FakeHoverSession()

        tooltip = gate._hover_tooltip(
            session,
            object(),
            "tooltip",
            timeout=0.1,
        )

        self.assertEqual(tooltip, "tooltip")
        self.assertEqual(session.selector, '[role="tooltip"]')
        self.assertEqual(
            adapter.mouse_calls,
            [
                ((MouseAction.MOVE,), (102.0, 202.0)),
                ((MouseAction.MOVE,), (105.0, 207.0)),
            ],
        )

    def test_hover_tooltip_focuses_native_window_before_pointer_move(self) -> None:
        gate = object.__new__(DesktopOAuthNativeGate)
        adapter = _FakeNativeAdapter()
        runtime_binding = _FakeHoverRuntimeBinding(adapter)
        gate.runtime_binding = runtime_binding
        session = _FakeHoverSession(focused=False)

        tooltip = gate._hover_tooltip(
            session,
            object(),
            "tooltip",
            timeout=0.1,
        )

        self.assertEqual(tooltip, "tooltip")
        self.assertTrue(runtime_binding.activation_requested)

    def test_tooltip_visibility_uses_rendered_layout(self) -> None:
        session = _FakeHoverSession(rendered=False)
        trigger = object()
        tooltip = object()

        self.assertFalse(
            DesktopOAuthNativeGate._element_is_visibly_rendered(
                session,
                trigger,
                tooltip,
            )
        )
        self.assertEqual(session.visibility_args, (trigger, tooltip))
        self.assertIn("aria-describedby", session.visibility_script)
        self.assertIn("effectiveOpacity >= 0.99", session.visibility_script)

    def test_accepts_routed_native_tauri_url(self) -> None:
        self.assertTrue(is_native_tauri_url("tauri://localhost"))
        self.assertTrue(
            is_native_tauri_url("tauri://localhost/settings?tab=account#identity")
        )

    def test_rejects_non_native_or_credentialed_url(self) -> None:
        for value in (
            "http://localhost/settings",
            "tauri://example.com/settings",
            "tauri://user@localhost/settings",
            "tauri://localhost:3410/settings",
            "not a url",
        ):
            with self.subTest(value=value):
                self.assertFalse(is_native_tauri_url(value))

    def test_accepts_pre_authentication_loopback_start(self) -> None:
        status = json.dumps(
            {
                "auth_url": (
                    "https://oauth.example/start?"
                    "return_to=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback"
                    "%3Fsession_id%3Dlp-123"
                ),
                "session_id": "lp-123",
            }
        )
        session = _FakeSession(
            {
                "transport": "resolved",
                "value": {
                    "ok": True,
                    "data": {"status": status},
                },
            }
        )

        result = DesktopOAuthNativeGate._start_oauth(session, "github")

        self.assertEqual(result["provider"], "github")
        self.assertTrue(result["hasAuthorizationUrl"])
        self.assertTrue(result["hasLoopbackSession"])
        self.assertTrue(result["hasLoopbackCallback"])
        self.assertEqual(
            result["callbackUrl"],
            "http://127.0.0.1:49152/callback?session_id=lp-123",
        )
        self.assertIn("oauth2_start_loopback", session.script)
        self.assertEqual(session.provider_id, "github")

    def test_builds_deterministic_loopback_callback(self) -> None:
        callback_url = DesktopOAuthNativeGate._build_callback_url(
            "http://127.0.0.1:49152/callback?session_id=lp-123",
            provider_id="github",
            provider_user_id="fixture-user",
            email="fixture@test.invalid",
            timestamp="2026-09-29T15:30:00Z",
            signature="a" * 64,
        )

        query = parse_qs(urlparse(callback_url).query)
        self.assertEqual(query["session_id"], ["lp-123"])
        self.assertEqual(query["provider"], ["github"])
        self.assertEqual(query["provider_user_id"], ["fixture-user"])
        self.assertEqual(query["email"], ["fixture@test.invalid"])
        self.assertEqual(query["avatar_url"], [OAUTH_AVATAR_URL])
        self.assertEqual(query["ts"], ["2026-09-29T15:30:00Z"])
        self.assertEqual(query["sig"], ["a" * 64])

    def test_omits_missing_loopback_signature(self) -> None:
        callback_url = DesktopOAuthNativeGate._build_callback_url(
            "http://127.0.0.1:49152/callback?session_id=lp-123&sig=stale",
            provider_id="github",
            provider_user_id="fixture-user",
            email="fixture@test.invalid",
            timestamp="2026-09-29T15:30:00Z",
            signature=None,
        )

        self.assertNotIn("sig", parse_qs(urlparse(callback_url).query))

    def test_signer_matches_oauth_client_canonical_message(self) -> None:
        secret = "isolated-native-oauth-secret"
        timestamp = "2026-09-29T15:30:00Z"
        handler = OAuthBridgeSignerCapabilityHandler(secret)
        response = handler.invoke(
            "sign",
            {
                "provider": "github",
                "providerUserId": "fixture-user",
                "email": "fixture@test.invalid",
                "timestamp": timestamp,
            },
            deadline_monotonic=time.monotonic() + 1,
            cancellation=threading.Event(),
        )
        expected_message = "github:fixture-user:fixture@test.invalid:" + timestamp
        expected = hmac.new(
            secret.encode(),
            expected_message.encode(),
            hashlib.sha256,
        ).hexdigest()

        self.assertEqual(
            oauth_bridge_signature_message(
                "github",
                "fixture-user",
                "fixture@test.invalid",
                timestamp,
            ),
            expected_message,
        )
        self.assertEqual(response["signature"], expected)
        self.assertTrue(handler.close().secrets_zeroized)

    def test_gate_requests_signature_without_receiving_secret(self) -> None:
        gate = object.__new__(DesktopOAuthNativeGate)
        client = _FakeCapabilityClient(
            {"algorithm": "HMAC-SHA256", "signature": "b" * 64}
        )
        gate.capability_client = client

        signed = gate._sign_callback(
            provider_id="google",
            provider_user_id="fixture-user",
            email="fixture@test.invalid",
        )

        self.assertEqual(signed["signature"], "b" * 64)
        self.assertEqual(client.capability_id, "station-access.oauth-bridge-signer")
        self.assertEqual(client.operation, "sign")
        self.assertNotIn("secret", client.payload)

    def test_signer_capability_rejects_mismatched_run_identity(self) -> None:
        provisioner = object.__new__(
            StationAccessDesktopOAuthNativeProvisioner
        )
        provisioner._bridge_secret = "isolated-native-oauth-secret"
        provisioner._evidence_run = SimpleNamespace(run_id="evidence-run")
        provisioner._manifest = SimpleNamespace(
            run_id="provisioning-run",
            is_ready=lambda: True,
        )

        with self.assertRaisesRegex(
            BlockedError,
            "authorities are not ready",
        ):
            provisioner.create_gate_launch_context(
                gate_id="station-access-desktop-oauth-native-e2e",
                evidence_run_id="wrong-evidence-run",
                provisioning_run_id="provisioning-run",
                required_capabilities=(
                    "station-access.oauth-bridge-signer",
                ),
            )

    def test_station_restart_injects_secret_only_through_stdin_override(self) -> None:
        command = (
            "docker compose --env-file $HOME/station.env -p pt-station "
            "-f $HOME/repo/tooling/docker/compose.yml --profile station "
            "--profile infra up -d station"
        )
        enabled = _station_restart_script(
            "repo",
            command,
            enable_bridge_secret=True,
        )
        disabled = _station_restart_script(
            "repo",
            command,
            enable_bridge_secret=False,
        )

        self.assertIn("IFS= read -r PEERS_OAUTH_BRIDGE_SECRET", enabled)
        self.assertIn("PEERS_OAUTH_BRIDGE_SECRET: ${PEERS_OAUTH_BRIDGE_SECRET:?}", enabled)
        self.assertNotIn("isolated-native-oauth-secret", enabled)
        self.assertIn("unset PEERS_OAUTH_BRIDGE_SECRET", disabled)
        self.assertNotIn("-f - up -d station", disabled)

    def test_rejects_unauthorized_pre_authentication_start(self) -> None:
        session = _FakeSession(
            {
                "transport": "resolved",
                "value": {
                    "ok": False,
                    "error": {
                        "code": "UNAUTHORIZED",
                        "message": "authentication required",
                    },
                },
            }
        )

        with self.assertRaisesRegex(
            GateError,
            "rejected before authentication",
        ):
            DesktopOAuthNativeGate._start_oauth(session, "google")

    def test_accepts_pre_authentication_loopback_cancellation(self) -> None:
        status = json.dumps(
            {
                "cancelled": True,
                "status": "cancelled",
            }
        )
        session = _FakeSession(
            {
                "transport": "resolved",
                "value": {
                    "ok": True,
                    "data": {"status": status},
                },
            }
        )

        result = DesktopOAuthNativeGate._cancel_oauth(session, "lp-123")

        self.assertTrue(result["cancelled"])
        self.assertEqual(result["status"], "cancelled")
        self.assertIn("oauth2_cancel_loopback", session.script)
        self.assertEqual(session.provider_id, "lp-123")

    def test_source_identity_binds_launched_binary_to_runtime_cell(self) -> None:
        gate = object.__new__(DesktopOAuthNativeGate)
        gate.manifest = {
            "state": "FIXTURE_READY",
            "gateId": "station-access-desktop-oauth-native-e2e",
            "source": {
                "commit": "a" * 40,
                "workspaceDigest": "clean",
            },
            "services": {
                "station": {
                    "liveCommit": "a" * 40,
                    "workspaceDigest": "clean",
                },
            },
        }
        gate.runtime_cell_manifest = {
            "cellId": "desktop-macos-native",
            "gateId": "station-access-desktop-oauth-native-e2e",
            "state": "LEASED",
            "source": {
                "commit": "a" * 40,
                "workspaceDigest": "clean",
                "binarySha256": "b" * 64,
            },
        }
        gate.runtime_binding = _FakeRuntimeBinding("b" * 64)

        identity = gate._source_identity()

        self.assertTrue(identity["verified"])

    def test_source_identity_rejects_runtime_binary_mismatch(self) -> None:
        gate = object.__new__(DesktopOAuthNativeGate)
        gate.manifest = {
            "state": "FIXTURE_READY",
            "gateId": "station-access-desktop-oauth-native-e2e",
            "source": {
                "commit": "a" * 40,
                "workspaceDigest": "clean",
            },
            "services": {
                "station": {
                    "liveCommit": "a" * 40,
                    "workspaceDigest": "clean",
                },
            },
        }
        gate.runtime_cell_manifest = {
            "cellId": "desktop-macos-native",
            "gateId": "station-access-desktop-oauth-native-e2e",
            "state": "LEASED",
            "source": {
                "commit": "a" * 40,
                "workspaceDigest": "clean",
                "binarySha256": "b" * 64,
            },
        }
        gate.runtime_binding = _FakeRuntimeBinding("c" * 64)

        identity = gate._source_identity()

        self.assertFalse(identity["verified"])


if __name__ == "__main__":
    unittest.main()
