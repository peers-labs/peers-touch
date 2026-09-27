from __future__ import annotations

import inspect
import time
import unittest
from collections.abc import Mapping

from tooling.acceptance.core import ArtifactRef, DriverError
from tooling.acceptance.gates.mobile.appium import (
    APPIUM_CAPABILITY_ID,
    AppiumSession,
)


RUN_ID = "20260830T120000000000Z-" + ("1" * 32)
WORKSPACE_ID = "a" * 16
GATE_ID = "mobile-native-access-e2e"


def _reference(
    path: str,
    *,
    media_type: str = "application/json",
) -> ArtifactRef:
    return ArtifactRef(
        workspace_id=WORKSPACE_ID,
        gate_id=GATE_ID,
        run_id=RUN_ID,
        path=path,
        sha256="b" * 64,
        media_type=media_type,
    )


class RecordingEphemeralClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, object], float]] = []
        self.responses: dict[str, Mapping[str, object]] = {
            "start": {
                "sessionRef": "opaque-session/alice-ios",
                "freshInstallTrace": _reference(
                    "evidence/mobile/runtime/alice-ios/install.json"
                ).to_dict(),
            },
            "stop": {},
            "wait_ready": {"ready": True},
            "is_alive": {"alive": True},
            "contexts": {
                "contexts": [
                    "NATIVE_APP",
                    "WEBVIEW_com.peers.touch.mobile",
                ]
            },
            "switch_context": {},
            "harness_inventory": {"actions": ["build.identity"]},
            "harness_action": {"value": {"ok": True}},
            "harness_negative_callback": {
                "value": {"operation": "replay"}
            },
            "refresh_webview": {},
            "find_element": {"elementRef": "opaque-element/button"},
            "click": {},
            "verify_build_identity": {
                "installedBuildIdentity": _reference(
                    "evidence/mobile/runtime/alice-ios/build-identity.json"
                ).to_dict(),
            },
        }

    def invoke(
        self,
        capability_id: str,
        operation: str,
        payload: Mapping[str, object],
        *,
        timeout_seconds: float,
    ) -> Mapping[str, object]:
        self.calls.append(
            (
                capability_id,
                operation,
                dict(payload),
                timeout_seconds,
            )
        )
        if operation == "capture_page_source":
            if payload.get("captureKind") == "native-ax":
                reference = _reference(
                    "mobile/alice-ios/native-ax.xml",
                    media_type="application/xml",
                )
            else:
                reference = _reference(
                    (
                        f"evidence/mobile/{payload['captureId']}/"
                        "alice-ios/web-dom.html"
                    ),
                    media_type="text/html",
                )
            return {"pageSource": reference.to_dict()}
        if operation == "capture_screenshot":
            reference = _reference(
                (
                    f"evidence/mobile/{payload['captureId']}/"
                    "alice-ios/screenshot.png"
                ),
                media_type="image/png",
            )
            return {"screenshot": reference.to_dict()}
        return self.responses[operation]


class AppiumChildFacadeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = RecordingEphemeralClient()
        self.device_ref = _reference(
            "runtime/mobile/leases/devices/alice-ios.json"
        )
        self.build_ref = _reference("runtime/mobile/builds/ios.json")
        self.session = AppiumSession(
            self.client,  # type: ignore[arg-type]
            client_id="alice-ios",
            platform="ios",
            physical_device_lease=self.device_ref,
            build_attestation=self.build_ref,
            callback_scheme="peers-touch",
        )

    def test_constructor_has_no_raw_authority_compatibility_inputs(self) -> None:
        parameters = inspect.signature(AppiumSession).parameters

        self.assertEqual(
            set(parameters),
            {
                "client",
                "client_id",
                "platform",
                "physical_device_lease",
                "build_attestation",
                "callback_scheme",
                "gate_id",
            },
        )
        for forbidden in (
            "transport",
            "device_broker",
            "artifact_reader",
            "ports",
            "chromedriver_executable",
        ):
            self.assertNotIn(forbidden, parameters)
        for forbidden_method in (
            "execute_script",
            "execute_async_script",
            "element_attribute",
            "get_page_source",
            "get_current_url",
            "screenshot_bytes",
        ):
            self.assertFalse(hasattr(self.session, forbidden_method))

    def test_start_binds_typed_sources_without_raw_authority(self) -> None:
        self.session.start()

        capability, operation, payload, timeout = self.client.calls[0]
        self.assertEqual(capability, APPIUM_CAPABILITY_ID)
        self.assertEqual(operation, "start")
        self.assertEqual(payload["clientId"], "alice-ios")
        self.assertEqual(payload["platform"], "ios")
        self.assertEqual(
            payload["physicalDeviceLease"],
            self.device_ref.to_dict(),
        )
        self.assertEqual(payload["buildAttestation"], self.build_ref.to_dict())
        self.assertNotIn("sessionId", payload)
        self.assertNotIn("udid", payload)
        self.assertNotIn("serial", payload)
        self.assertNotIn("device", payload)
        self.assertGreaterEqual(timeout, 180.0)
        self.assertIsInstance(self.session.fresh_install_trace, ArtifactRef)

    def test_all_session_operations_use_bound_capability_and_opaque_ref(self) -> None:
        self.session.start()
        install_ref = self.session.fresh_install_trace

        self.session.wait_for_ready(12.0)
        self.assertTrue(self.session.is_alive())
        self.assertEqual(
            self.session.contexts(),
            ["NATIVE_APP", "WEBVIEW_com.peers.touch.mobile"],
        )
        self.session.switch_context("NATIVE_APP")
        self.assertEqual(
            self.session.harness_inventory(),
            ["build.identity"],
        )
        self.assertEqual(
            self.session.call_action("projection.read"),
            {"ok": True},
        )
        self.assertEqual(
            self.session.call_negative_callback(
                replay_payload={"runId": RUN_ID},
                negative_payload={"intent": {"operation": "replay"}},
            ),
            {"operation": "replay"},
        )
        self.session.refresh_webview()
        element_ref = self.session.find_element("accessibility id", "continue")
        self.assertEqual(element_ref, "opaque-element/button")
        self.session.click(element_ref)
        self.assertEqual(
            self.session.capture_native_accessibility().media_type,
            "application/xml",
        )
        self.assertEqual(
            self.session.capture_web_dom("success-ios").media_type,
            "text/html",
        )
        self.assertEqual(
            self.session.capture_screenshot("success-ios").media_type,
            "image/png",
        )
        identity_ref = self.session.verify_installed_build_identity(install_ref)
        self.assertIsInstance(identity_ref, ArtifactRef)
        self.assertEqual(identity_ref, self.session.installed_build_identity)
        self.session.stop()

        expected_operations = [
            "start",
            "wait_ready",
            "is_alive",
            "contexts",
            "switch_context",
            "harness_inventory",
            "harness_action",
            "harness_negative_callback",
            "refresh_webview",
            "find_element",
            "click",
            "capture_page_source",
            "capture_page_source",
            "capture_screenshot",
            "verify_build_identity",
            "stop",
        ]
        self.assertEqual(
            [operation for _, operation, _, _ in self.client.calls],
            expected_operations,
        )
        for capability, operation, payload, _ in self.client.calls:
            self.assertEqual(capability, APPIUM_CAPABILITY_ID)
            self.assertEqual(payload["clientId"], "alice-ios")
            self.assertEqual(payload["platform"], "ios")
            if operation != "start":
                self.assertEqual(
                    payload["sessionRef"],
                    "opaque-session/alice-ios",
                )
            serialized = repr(payload).lower()
            self.assertNotIn("sessionid", serialized)
            self.assertNotIn("udid", serialized)
            self.assertNotIn("serial", serialized)

    def test_public_polling_rejects_non_finite_timeouts(self) -> None:
        for method_name in ("wait_for_ready", "switch_to_app_webview"):
            method = getattr(self.session, method_name)
            for timeout in (
                float("nan"),
                float("inf"),
                float("-inf"),
            ):
                with self.subTest(method=method_name, timeout=timeout):
                    with self.assertRaisesRegex(
                        DriverError,
                        "positive finite number",
                    ):
                        method(timeout)

        self.assertEqual(self.client.calls, [])

    def test_webview_polling_does_not_succeed_after_its_deadline(self) -> None:
        class DelayedClient(RecordingEphemeralClient):
            def invoke(
                self,
                capability_id: str,
                operation: str,
                payload: Mapping[str, object],
                *,
                timeout_seconds: float,
            ) -> Mapping[str, object]:
                time.sleep(0.1)
                return super().invoke(
                    capability_id,
                    operation,
                    payload,
                    timeout_seconds=timeout_seconds,
                )

        client = DelayedClient()
        session = AppiumSession(
            client,  # type: ignore[arg-type]
            client_id="alice-ios",
            platform="ios",
            physical_device_lease=self.device_ref,
            build_attestation=self.build_ref,
            callback_scheme="peers-touch",
        )
        session._session_ref = "opaque-session/alice-ios"

        with self.assertRaisesRegex(DriverError, "exceeded its deadline"):
            session.switch_to_app_webview(timeout=0.05)

        self.assertEqual(
            [operation for _, operation, _, _ in client.calls],
            ["contexts"],
        )
        self.assertLessEqual(client.calls[0][3], 0.05)

    def test_capture_rejects_invalid_identity(self) -> None:
        self.session.start()

        for capture_id in ("", "../escape", "Uppercase"):
            with self.subTest(capture_id=capture_id):
                with self.assertRaisesRegex(
                    DriverError,
                    "capture identity",
                ):
                    self.session.capture_screenshot(capture_id)

    def test_malformed_or_cross_run_evidence_fails_closed(self) -> None:
        self.client.responses["start"] = {
            "sessionRef": "opaque-session/alice-ios",
            "freshInstallTrace": ArtifactRef(
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                run_id="20260830T120001000000Z-" + ("2" * 32),
                path="evidence/mobile/runtime/alice-ios/install.json",
                sha256="c" * 64,
                media_type="application/json",
            ).to_dict(),
        }

        with self.assertRaisesRegex(DriverError, "ArtifactRef identity"):
            self.session.start()

    def test_typed_source_refs_are_required_and_same_run(self) -> None:
        with self.assertRaisesRegex(DriverError, "typed ArtifactRefs"):
            AppiumSession(
                self.client,  # type: ignore[arg-type]
                client_id="alice-ios",
                platform="ios",
                physical_device_lease={},  # type: ignore[arg-type]
                build_attestation=self.build_ref,
                callback_scheme="peers-touch",
            )

        other_run = ArtifactRef(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            run_id="20260830T120001000000Z-" + ("2" * 32),
            path=self.build_ref.path,
            sha256=self.build_ref.sha256,
            media_type=self.build_ref.media_type,
        )
        with self.assertRaisesRegex(DriverError, "cross proof runs"):
            AppiumSession(
                self.client,  # type: ignore[arg-type]
                client_id="alice-ios",
                platform="ios",
                physical_device_lease=self.device_ref,
                build_attestation=other_run,
                callback_scheme="peers-touch",
            )

    def test_stop_is_idempotent_without_child_cleanup_authority(self) -> None:
        self.session.stop()
        self.assertEqual(self.client.calls, [])

        self.session.start()
        self.session.stop()
        self.session.stop()
        self.assertEqual(
            [operation for _, operation, _, _ in self.client.calls],
            ["start", "stop"],
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
