from __future__ import annotations

import json
import unittest

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.station_access.desktop_oauth_native_e2e import (
    DesktopOAuthNativeGate,
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


class DesktopOAuthNativeGateTest(unittest.TestCase):
    def test_accepts_pre_authentication_loopback_start(self) -> None:
        status = json.dumps(
            {
                "auth_url": "https://oauth.example/start?return_to=loopback",
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
        self.assertIn("oauth2_start_loopback", session.script)
        self.assertEqual(session.provider_id, "github")

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
