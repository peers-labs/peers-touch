from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.mobile.simulator_platform_e2e import (
    SimulatorPlatformGate,
    _audit_accessibility_markup,
    _validate_network,
)


class _Reference:
    def __init__(self, path: str) -> None:
        self.path = path

    def to_dict(self) -> dict[str, str]:
        return {"path": self.path}


class _Artifacts:
    def __init__(self) -> None:
        self.paths: list[str] = []

    def write_json(self, path: str, _value: object, **_kwargs: object) -> _Reference:
        self.paths.append(path)
        return _Reference(path)

    def write_bytes(self, path: str, _value: bytes, **_kwargs: object) -> _Reference:
        self.paths.append(path)
        return _Reference(path)


class _Session:
    def __init__(self, platform: str) -> None:
        self.platform = platform
        self.context = "NATIVE_APP"

    def start(self) -> None:
        return None

    def wait_for_ready(self) -> None:
        return None

    def switch_to_app_webview(self) -> str:
        self.context = "WEBVIEW"
        return self.context

    def switch_to_native(self) -> None:
        self.context = "NATIVE_APP"

    def require_harness(self, _actions: list[str]) -> None:
        return None

    def call_action(
        self,
        action: str,
        payload: object = None,
    ) -> object:
        if action == "platform.permission.checkAll":
            return [
                {
                    "kind": kind,
                    "status": "granted",
                    "canRequest": False,
                }
                for kind in ("camera", "microphone", "storage", "notifications")
            ]
        if action == "platform.permission.check":
            assert isinstance(payload, dict)
            return {
                "kind": payload["kind"],
                "status": "granted",
                "canRequest": False,
            }
        if action == "platform.network.read":
            return {
                "connected": True,
                "networkType": "wifi",
                "updatedAtMs": 1,
            }
        if action == "lifecycle.snapshot":
            return {"phase": "ACTIVE", "generation": 2}
        raise AssertionError(action)

    def screenshot_bytes(self) -> bytes:
        return b"png"

    def get_page_source(self) -> str:
        return '<main><button label="Ready"/></main>'


class SimulatorPlatformGateTests(unittest.TestCase):
    def test_required_dual_ios_pair_produces_proven_result(self) -> None:
        gate = SimulatorPlatformGate()
        artifacts = _Artifacts()
        specs = (
            SimpleNamespace(
                client_id="sim-ios",
                platform="ios",
                required_harness_actions=(),
            ),
            SimpleNamespace(
                client_id="sim-ios-peer",
                platform="ios",
                required_harness_actions=(),
            ),
        )
        sessions = {
            "sim-ios": _Session("ios"),
            "sim-ios-peer": _Session("ios"),
        }
        manifest = {
            "mobileSimulator": {
                "appium": {"serverUrl": "http://127.0.0.1:4723"},
            },
        }
        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_platform_e2e."
                "_validate_source_identity",
                return_value={"commit": "a" * 40},
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_platform_e2e."
                "_validate_runtime_identity",
                return_value={"platforms": ["ios"]},
            ),
            patch.object(gate, "_client_specs", return_value=specs),
            patch.object(
                gate,
                "_create_session",
                side_effect=lambda _url, spec: sessions[spec.client_id],
            ),
            patch.object(gate, "_preflight_ios"),
        ):
            result = gate._run_journeys(artifacts, manifest)

        self.assertEqual(result["gateId"], "mobile-simulator-platform-e2e")
        self.assertEqual(result["completionStatus"], "DONE")
        self.assertEqual(result["proofStatus"], "PROVEN")
        self.assertFalse(result["physicalDeviceClaimed"])
        self.assertEqual(set(result["clients"]), {"sim-ios", "sim-ios-peer"})
        self.assertEqual(
            {
                item["platform"]
                for item in result["clients"].values()
            },
            {"ios"},
        )
        self.assertTrue(any(path.endswith("native-accessibility.xml") for path in artifacts.paths))

    def test_network_projection_fails_closed(self) -> None:
        with self.assertRaisesRegex(GateError, "network readback"):
            _validate_network(
                {
                    "connected": False,
                    "networkType": "wifi",
                    "updatedAtMs": 1,
                },
                "sim-ios",
            )

    def test_accessibility_markup_requires_readable_native_semantics(
        self,
    ) -> None:
        self.assertEqual(
            _audit_accessibility_markup(
                '<hierarchy><node text="Sign in"/></hierarchy>',
                "sim-ios-peer",
            ),
            {"nodeCount": 2, "readableNodeCount": 1},
        )
        with self.assertRaisesRegex(GateError, "readable semantics"):
            _audit_accessibility_markup(
                "<hierarchy><node/></hierarchy>",
                "sim-ios-peer",
            )


if __name__ == "__main__":
    unittest.main()
