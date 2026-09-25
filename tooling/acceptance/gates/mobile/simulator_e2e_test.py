from __future__ import annotations

import copy
import io
import json
import time
import unittest
import urllib.error
from collections.abc import Mapping
from contextlib import redirect_stderr
from pathlib import Path
from typing import Any
from unittest.mock import patch

from tooling.acceptance.core import DriverError, GateError
from tooling.acceptance.gates.mobile.simulator_e2e import (
    DOCUMENT_SOURCE_SCRIPT,
    GATE_ID,
    HARNESS_INVENTORY_SCRIPT,
    IOS_WEBVIEW_CONNECT_ATTEMPT_TIMEOUT_MS,
    MAX_APPIUM_ERROR_RESPONSE_BYTES,
    MAX_APPIUM_RESPONSE_BYTES,
    MAX_MOBILE_PAGE_SOURCE_RESPONSE_BYTES,
    PHYSICAL_PROVIDER_SCOPE,
    PROVEN_SCOPE,
    READ_FINALIZE_EVIDENCE_SCRIPT,
    SimulatorAppiumSession,
    SimulatorBuildTarget,
    SimulatorCallbackRoutingGate,
    SimulatorClientSpec,
    SimulatorDeviceTarget,
    SimulatorGateBlocked,
    START_FINALIZE_EVIDENCE_SCRIPT,
    UrllibAppiumTransport,
    W3C_ELEMENT_KEY,
    _redacted_markup,
    _validate_cleanup_result,
    _validate_fail_closed_projection,
    _validate_runtime_identity,
)


def valid_projection() -> dict[str, Any]:
    return {
        "station": {
            "activeStationPeerId": "",
            "entries": [],
        },
        "access": {
            "decision": None,
            "session": None,
            "loading": False,
            "errorKey": None,
            "restored": False,
        },
        "oauth": {
            "phase": "failed",
            "stationPeerId": None,
            "provider": None,
            "accessAttemptId": None,
            "gateId": None,
            "expiresAtUnixMs": None,
            "result": "rejected",
            "errorCode": "invalid_callback",
            "candidatePtid": None,
            "accessDecision": None,
            "session": None,
            "errorKey": "auth.oauth.invalidCallback",
            "recovery": None,
        },
    }


def simulator_resources() -> dict[str, Any]:
    return {
        "appium": {
            "serverUrl": "http://127.0.0.1:4723",
            "serverVersion": "2.19.0",
            "expectedServerVersion": "2.19.0",
            "drivers": {
                "ios": {
                    "identity": "appium-xcuitest-driver",
                    "automationName": "XCUITest",
                    "version": "9.10.5",
                    "expectedVersion": "9.10.5",
                },
            },
        },
        "applications": {
            "ios": {
                "artifact": "/tmp/peers-touch-ios.app",
                "id": "com.peers.touch.mobile",
                "callbackScheme": "peers-touch",
                "sha256": "a" * 64,
            },
        },
        "clients": {
            "sim-ios": {
                "platform": "ios",
                "device": "ios-simulator-udid",
                "deviceRole": "ios-simulator",
                "ports": {
                    "wda-local": 8101,
                    "mjpeg": 9101,
                    "webview": 9511,
                },
            },
            "sim-ios-peer": {
                "platform": "ios",
                "device": "ios-peer-simulator-udid",
                "deviceRole": "peer-ios-simulator",
                "ports": {
                    "wda-local": 8102,
                    "mjpeg": 9201,
                    "webview": 9512,
                },
            },
        },
        "harness": {
            "requiredActions": [
                "projection.read",
                "lifecycle.restart",
                "native.deliverDeepLink",
                "cleanup",
            ],
        },
    }


def valid_cleanup_result() -> dict[str, Any]:
    return {
        "oauthPurge": {
            "stationRevocation": "confirmed",
            "secureStorage": {
                "activeAttemptIndexAbsent": True,
                "attemptSecretRecordAbsent": True,
                "currentSessionIndexAbsent": True,
                "credentialRecordAbsent": True,
                "publicProjectionAbsent": True,
            },
        },
        "webSessionProjectionCleared": True,
        "stationRegistryCleared": True,
    }


def runtime_manifest() -> dict[str, Any]:
    return {
        "artifactKind": "acceptance-runtime-manifest",
        "environmentId": "mobile-simulator",
        "gateId": GATE_ID,
        "runId": "simulator-run",
        "state": "FIXTURE_READY",
        "source": {
            "commit": "source-commit",
            "workspaceDigest": "dirty:source-digest",
        },
        "services": {},
        "credentialRefs": [],
        "mobileSimulator": simulator_resources(),
    }


class FakeAppiumTransport:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.requests: list[tuple[str, str, dict[str, Any] | None]] = []

    def request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        body = dict(payload) if payload is not None else None
        self.requests.append((method, path, body))
        if method == "POST" and path == "/session":
            return {"sessionId": self.session_id, "capabilities": {}}
        return None


class UrllibAppiumTransportTests(unittest.TestCase):
    class Response:
        def __init__(
            self,
            body: bytes,
            *,
            bytes_per_read: int | None = None,
            delay_seconds: float = 0,
        ) -> None:
            self.body = body
            self.bytes_per_read = bytes_per_read
            self.delay_seconds = delay_seconds
            self.offset = 0
            self.read_sizes: list[int] = []
            self.timeouts: list[float] = []
            self.closed = False

        def __enter__(self) -> "UrllibAppiumTransportTests.Response":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def close(self) -> None:
            self.closed = True

        def settimeout(self, timeout_seconds: float) -> None:
            self.timeouts.append(timeout_seconds)

        def read1(self, size: int = -1) -> bytes:
            self.read_sizes.append(size)
            if self.delay_seconds:
                time.sleep(self.delay_seconds)
            if self.offset >= len(self.body):
                return b""
            actual_size = (
                len(self.body) - self.offset
                if size < 0
                else size
            )
            if self.bytes_per_read is not None:
                actual_size = min(actual_size, self.bytes_per_read)
            chunk = self.body[self.offset : self.offset + actual_size]
            self.offset += len(chunk)
            return chunk

    def test_ordinary_response_uses_mandatory_default_bound(self) -> None:
        response = self.Response(b"x" * (MAX_APPIUM_RESPONSE_BYTES + 1))
        transport = UrllibAppiumTransport("http://appium.invalid")

        with patch(
            "tooling.acceptance.gates.mobile.simulator_e2e."
            "urllib.request.urlopen",
            return_value=response,
        ), self.assertRaisesRegex(DriverError, "exceeds its byte limit"):
            transport.request("GET", "/session/test/contexts")

        self.assertNotIn(-1, response.read_sizes)

    def test_http_error_body_is_bounded(self) -> None:
        response = self.Response(
            b"x" * (MAX_APPIUM_ERROR_RESPONSE_BYTES + 1)
        )
        error = urllib.error.HTTPError(
            "http://appium.invalid/session/test",
            500,
            "server error",
            {},
            response,
        )
        transport = UrllibAppiumTransport("http://appium.invalid")

        with patch(
            "tooling.acceptance.gates.mobile.simulator_e2e."
            "urllib.request.urlopen",
            side_effect=error,
        ), self.assertRaisesRegex(DriverError, "HTTP 500"):
            transport.request("GET", "/session/test")

        self.assertNotIn(-1, response.read_sizes)
        self.assertTrue(response.closed)

    def test_trickle_response_obeys_total_deadline(self) -> None:
        response = self.Response(
            b'{"value":"ok"}',
            bytes_per_read=1,
            delay_seconds=0.02,
        )
        transport = UrllibAppiumTransport(
            "http://appium.invalid",
            timeout_seconds=0.03,
        )
        started = time.monotonic()

        with patch(
            "tooling.acceptance.gates.mobile.simulator_e2e."
            "urllib.request.urlopen",
            return_value=response,
        ), self.assertRaisesRegex(
            DriverError,
            "HttpResponseDeadlineExceeded",
        ):
            transport.request("GET", "/session/test/contexts")

        self.assertLess(time.monotonic() - started, 0.15)

    def test_page_source_uses_its_explicit_response_bound(self) -> None:
        limits: list[int] = []

        class Transport:
            @staticmethod
            def request(
                _method: str,
                _path: str,
                _payload: Mapping[str, Any] | None = None,
                *,
                max_response_bytes: int,
            ) -> str:
                limits.append(max_response_bytes)
                return "<AppiumAUT />"

        session = SimulatorAppiumSession(
            transport=Transport(),
            client_id="sim-ios",
            platform="ios",
            automation_name="XCUITest",
            device=SimulatorDeviceTarget(
                platform="ios",
                identifier="simulator-id",
                role="ios-simulator",
            ),
            build=SimulatorBuildTarget(
                platform="ios",
                artifact=Path("/tmp/mobile.app"),
                application_id="com.peers.touch.mobile",
            ),
            callback_scheme="peers-touch",
            ports={"wda-local": 8101, "mjpeg": 9101, "webview": 9511},
        )
        session.session_id = "test"

        self.assertEqual(session.get_page_source(), "<AppiumAUT />")
        self.assertEqual(limits, [MAX_MOBILE_PAGE_SOURCE_RESPONSE_BYTES])

        with patch(
            "tooling.acceptance.gates.mobile.simulator_e2e."
            "MAX_MOBILE_PAGE_SOURCE_BYTES",
            8,
        ), self.assertRaisesRegex(
            DriverError,
            "page source exceeds",
        ):
            session.get_page_source()

    def test_webview_source_uses_bounded_script_transport(self) -> None:
        requests: list[tuple[str, str, object, int]] = []

        class Transport:
            @staticmethod
            def request(
                method: str,
                path: str,
                payload: Mapping[str, Any] | None = None,
                *,
                max_response_bytes: int,
            ) -> str:
                requests.append((method, path, payload, max_response_bytes))
                return "<html><body>ready</body></html>"

        session = SimulatorAppiumSession(
            transport=Transport(),
            client_id="sim-ios",
            platform="ios",
            automation_name="XCUITest",
            device=SimulatorDeviceTarget(
                platform="ios",
                identifier="simulator-id",
                role="ios-simulator",
            ),
            build=SimulatorBuildTarget(
                platform="ios",
                artifact=Path("/tmp/mobile.app"),
                application_id="com.peers.touch.mobile",
            ),
            callback_scheme="peers-touch",
            ports={"wda-local": 8101, "mjpeg": 9101, "webview": 9511},
        )
        session.session_id = "test"

        self.assertEqual(
            session.get_webview_source(),
            "<html><body>ready</body></html>",
        )
        self.assertEqual(
            requests,
            [
                (
                    "POST",
                    "/session/test/execute/async",
                    {"script": DOCUMENT_SOURCE_SCRIPT, "args": []},
                    MAX_MOBILE_PAGE_SOURCE_RESPONSE_BYTES,
                ),
            ],
        )

        with patch(
            "tooling.acceptance.gates.mobile.simulator_e2e."
            "MAX_MOBILE_PAGE_SOURCE_BYTES",
            8,
        ), self.assertRaisesRegex(
            DriverError,
            "WebView source exceeds",
        ):
            session.get_webview_source()

    def test_final_evidence_invokes_actions_once_then_polls_result(self) -> None:
        requests: list[tuple[str, str, object]] = []
        projection = valid_projection()
        cleanup = valid_cleanup_result()

        class Transport:
            @staticmethod
            def request(
                method: str,
                path: str,
                payload: Mapping[str, Any] | None = None,
            ) -> dict[str, object]:
                requests.append((method, path, payload))
                if (
                    payload
                    and payload.get("script")
                    == START_FINALIZE_EVIDENCE_SCRIPT
                ):
                    return {"started": True}
                return {
                    "state": "done",
                    "value": {
                        "source": "<html><body>ready</body></html>",
                        "projection": projection,
                        "cleanup": cleanup,
                    }
                }

        session = SimulatorAppiumSession(
            transport=Transport(),
            client_id="sim-ios",
            platform="ios",
            automation_name="XCUITest",
            device=SimulatorDeviceTarget(
                platform="ios",
                identifier="simulator-id",
                role="ios-simulator",
            ),
            build=SimulatorBuildTarget(
                platform="ios",
                artifact=Path("/tmp/mobile.app"),
                application_id="com.peers.touch.mobile",
            ),
            callback_scheme="peers-touch",
            ports={"wda-local": 8101, "mjpeg": 9101, "webview": 9511},
        )
        session.session_id = "test"

        self.assertEqual(
            session.finalize_evidence_and_cleanup(),
            ("<html><body>ready</body></html>", projection, cleanup),
        )
        self.assertEqual(
            requests,
            [
                (
                    "POST",
                    "/session/test/execute/sync",
                    {"script": START_FINALIZE_EVIDENCE_SCRIPT, "args": []},
                ),
                (
                    "POST",
                    "/session/test/execute/sync",
                    {"script": READ_FINALIZE_EVIDENCE_SCRIPT, "args": []},
                ),
            ],
        )


class FakeEvidenceWriter:
    def __init__(self) -> None:
        self.json_values: dict[str, dict[str, Any]] = {}
        self.byte_values: dict[str, bytes] = {}
        self.completed: dict[str, Any] | None = None

    def __enter__(self) -> "FakeEvidenceWriter":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def write_json(
        self,
        relative_path: str,
        value: Mapping[str, Any],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> None:
        del role, redact
        self.json_values[relative_path] = copy.deepcopy(dict(value))

    def write_bytes(
        self,
        relative_path: str,
        value: bytes,
        *,
        media_type: str = "application/octet-stream",
        role: str | None = None,
    ) -> None:
        del media_type, role
        self.byte_values[relative_path] = value

    def complete(self, **value: Any) -> None:
        self.completed = dict(value)


class FakeSimulatorSession:
    def __init__(
        self,
        client_id: str,
        *,
        bundle_id: str = "com.peers.touch.mobile",
        available_actions: list[str] | None = None,
        fail_first_projection: bool = False,
        fail_cleanup: bool = False,
        cleanup_result: Mapping[str, Any] | None = None,
    ) -> None:
        self.client_id = client_id
        self.session_id = ""
        self.bundle_id = bundle_id
        self.available_actions = available_actions or [
            "projection.read",
            "lifecycle.restart",
            "native.deliverDeepLink",
            "cleanup",
        ]
        self.fail_first_projection = fail_first_projection
        self.fail_cleanup = fail_cleanup
        self.cleanup_result = dict(cleanup_result or valid_cleanup_result())
        self.projection_reads = 0
        self.events: list[str] = []
        self.current_context = "NATIVE_APP"
        self.stopped = False
        self.driver_reconnects = 0
        self.native_source_reads = 0
        self.native_source_reads_at_reconnect: list[int] = []
        self.native_ready_timeouts: list[float] = []
        self.webview_ready_timeout: float | None = None

    def start(self) -> "FakeSimulatorSession":
        self.events.append("start")
        self.session_id = f"session-{self.client_id}"
        return self

    def stop(self) -> None:
        self.events.append("stop")
        self.session_id = ""
        self.stopped = True

    def reconnect_after_runtime_relaunch(
        self,
    ) -> "FakeSimulatorSession":
        self.driver_reconnects += 1
        self.native_source_reads_at_reconnect.append(
            self.native_source_reads
        )
        self.stop()
        return self.start()

    def wait_for_ready(self, timeout: float = 30.0) -> None:
        self.native_ready_timeouts.append(timeout)
        self.events.append("wait-ready")

    def is_alive(self) -> bool:
        self.events.append("session-status")
        return bool(self.session_id)

    def contexts(self) -> list[str]:
        self.events.append("contexts")
        return [
            "NATIVE_APP",
            "WEBVIEW_com.peers.touch.mobile",
        ]

    def switch_to_native(self) -> None:
        self.current_context = "NATIVE_APP"
        self.events.append("context:native")

    def switch_to_app_webview(self, timeout: float = 30.0) -> str:
        self.webview_ready_timeout = timeout
        self.current_context = "WEBVIEW_com.peers.touch.mobile"
        self.events.append("context:webview")
        return self.current_context

    def require_harness(self, required_actions: list[str]) -> list[str]:
        self.events.append("harness")
        if self.fail_cleanup and required_actions == ["cleanup"]:
            raise DriverError("cleanup harness unavailable")
        missing = sorted(set(required_actions) - set(self.available_actions))
        if missing:
            raise DriverError(
                "Mobile Acceptance Harness actions are unavailable: "
                + ", ".join(missing)
            )
        return list(self.available_actions)

    def call_action(
        self,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        del payload
        self.events.append(f"action:{action}")
        if action == "projection.read":
            self.projection_reads += 1
            if self.fail_first_projection and self.projection_reads == 1:
                raise DriverError("projection unavailable")
            return valid_projection()
        if action == "lifecycle.restart":
            return {"requested": True, "scope": "webview"}
        if action == "cleanup":
            return copy.deepcopy(self.cleanup_result)
        raise AssertionError(f"unexpected action {action}")

    def deep_link_for_failure_case(
        self,
        url: str,
        failure_case: str,
    ) -> None:
        self.assert_invalid_link(url, failure_case)
        stage = "warm" if "simulator-warm-" in url else "cold"
        self.events.append(f"deep-link:{stage}")

    def execute_script(self, script: str, *args: Any) -> Any:
        self.events.append(f"script:{script}")
        if script == "mobile: activeAppInfo":
            return {
                "bundleId": self.bundle_id,
                "name": "Peers Touch",
                "pid": 4815,
                "processArguments": {
                    "env": {
                        "ACCESS_TOKEN": "must-not-persist",
                    },
                },
            }
        if script == "mobile: terminateApp" and args:
            return None
        raise AssertionError("unexpected native script")

    def get_current_url(self) -> str:
        self.events.append("runtime-url")
        return "tauri://localhost/mobile?token=must-not-persist"

    def get_page_source(self) -> str:
        if self.current_context == "NATIVE_APP":
            self.native_source_reads += 1
            return '<hierarchy authorization="Bearer native-secret"/>'
        return '<html password="web-secret"></html>'

    def get_webview_source(self) -> str:
        return '<html password="web-secret"></html>'

    def finalize_evidence_and_cleanup(
        self,
    ) -> tuple[str, dict[str, Any], dict[str, Any]]:
        self.events.append("action:projection.read")
        projection = valid_projection()
        self.events.append("action:cleanup")
        return (
            '<html password="web-secret"></html>',
            projection,
            copy.deepcopy(self.cleanup_result),
        )

    def screenshot_bytes(self) -> bytes:
        return b"simulator-screenshot"

    def assert_invalid_link(self, url: str, failure_case: str) -> None:
        if failure_case != "invalid":
            raise AssertionError("only invalid callbacks are allowed")
        if "code=" in url or "token=" in url:
            raise AssertionError("successful callback material is forbidden")
        if not url.startswith("peers-touch://oauth/callback?"):
            raise AssertionError("callback scheme mismatch")


def client_spec(platform: str) -> SimulatorClientSpec:
    is_ios = platform == "ios"
    return SimulatorClientSpec(
        client_id="sim-ios" if is_ios else "sim-android",
        platform=platform,
        automation_name="XCUITest" if is_ios else "UiAutomator2",
        device=SimulatorDeviceTarget(
            platform=platform,
            identifier=(
                "ios-simulator-udid" if is_ios else "emulator-5554"
            ),
            role="ios-simulator" if is_ios else "android-emulator",
        ),
        build=SimulatorBuildTarget(
            platform=platform,
            artifact=Path("/tmp/mobile.app" if is_ios else "/tmp/mobile.apk"),
            application_id="com.peers.touch.mobile",
        ),
        callback_scheme="peers-touch",
        ports=(
            {"wda-local": 8101, "mjpeg": 9101, "webview": 9511}
            if is_ios
            else {"system": 8201, "mjpeg": 9201, "webview": 9512}
        ),
        required_harness_actions=(
            "cleanup",
            "lifecycle.restart",
            "native.deliverDeepLink",
            "projection.read",
        ),
        chromedriver_executable=(
            "/runtime-cache/chromedriver"
            if platform == "android"
            else ""
        ),
    )


class SimulatorSeamContractTests(unittest.TestCase):
    def test_cleanup_requires_production_purge_and_absence_contract(self) -> None:
        self.assertEqual(
            _validate_cleanup_result(valid_cleanup_result()),
            valid_cleanup_result(),
        )

        obsolete = {"stationRegistryCleared": True}
        with self.assertRaisesRegex(GateError, "omitted OAuth purge proof"):
            _validate_cleanup_result(obsolete)

        for field in (
            "activeAttemptIndexAbsent",
            "attemptSecretRecordAbsent",
            "currentSessionIndexAbsent",
            "credentialRecordAbsent",
            "publicProjectionAbsent",
        ):
            with self.subTest(field=field):
                incomplete = valid_cleanup_result()
                incomplete["oauthPurge"]["secureStorage"][field] = False
                with self.assertRaisesRegex(
                    GateError,
                    "secure-storage absence",
                ):
                    _validate_cleanup_result(incomplete)

    def test_catalog_gate_identity_manifest_key_and_proof_scope(self) -> None:
        catalog_path = Path(__file__).resolve().parents[2] / "gates.yaml"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        gate = catalog["gates"]["mobile-simulator-access-e2e"]
        manifest = runtime_manifest()

        self.assertEqual(GATE_ID, "mobile-simulator-access-e2e")
        self.assertEqual(PROVEN_SCOPE, "simulator-callback-routing")
        self.assertEqual(
            PHYSICAL_PROVIDER_SCOPE,
            "physical provider OAuth/MS-AG03 remains UNPROVEN",
        )
        self.assertEqual(
            gate["command"],
            "python3 -m tooling.acceptance.gates.mobile.simulator_access_e2e",
        )
        self.assertIn("mobileSimulator", manifest)
        self.assertNotIn("mobileNative", manifest)

    def test_primary_result_uses_canonical_evidence_contract(self) -> None:
        gate = SimulatorCallbackRoutingGate()

        passed = gate._result_base("PASS")
        self.assertEqual(
            passed["artifactKind"],
            "acceptance-gate-evidence-report",
        )
        self.assertEqual(passed["gateId"], GATE_ID)
        self.assertEqual(passed["gate"], GATE_ID)
        self.assertEqual(passed["phase"], "W2-E1 Simulator evidence")
        self.assertEqual(passed["bom"], ["W2-E1"])
        self.assertEqual(passed["spec"], ["MS-D14"])
        self.assertEqual(passed["observedScope"], [PROVEN_SCOPE])
        self.assertTrue(passed["sampleEmissionAllowed"])
        self.assertNotIn("provenScope", passed)
        self.assertNotIn("sourcePhase", passed)

        failed = gate._result_base("FAIL")
        self.assertEqual(failed["observedScope"], [])
        self.assertFalse(failed["sampleEmissionAllowed"])

    def test_runtime_identity_requires_verified_toolchain_and_hashes(
        self,
    ) -> None:
        resources = simulator_resources()
        identity = _validate_runtime_identity(resources)

        self.assertEqual(identity["appium"]["serverVersion"], "2.19.0")
        self.assertEqual(
            identity["appium"]["drivers"]["ios"]["version"],
            "9.10.5",
        )
        self.assertEqual(identity["chromedriver"], {})
        peer = next(
            spec
            for spec in SimulatorCallbackRoutingGate()._client_specs(
                resources
            )
            if spec.client_id == "sim-ios-peer"
        )
        self.assertEqual(peer.platform, "ios")
        self.assertEqual(peer.chromedriver_executable, "")

    def test_runtime_identity_rejects_version_or_hash_mismatch(self) -> None:
        resources = simulator_resources()
        resources["appium"]["drivers"]["ios"]["version"] = "9.10.4"
        with self.assertRaisesRegex(
            SimulatorGateBlocked,
            "driver is not verified",
        ):
            _validate_runtime_identity(resources)

        resources = simulator_resources()
        resources["applications"]["ios"]["sha256"] = "invalid"
        with self.assertRaisesRegex(
            SimulatorGateBlocked,
            "application hash is invalid",
        ):
            _validate_runtime_identity(resources)


class SimulatorAppiumCapabilityTests(unittest.TestCase):
    def test_webview_switch_retries_a_stale_ios_target(self) -> None:
        class StaleTargetTransport(FakeAppiumTransport):
            def __init__(self) -> None:
                super().__init__("ios-session")
                self.context_queries = 0

            def request(
                self,
                method: str,
                path: str,
                payload: Mapping[str, Any] | None = None,
            ) -> Any:
                result = super().request(method, path, payload)
                if method == "GET" and path.endswith("/contexts"):
                    self.context_queries += 1
                    webview = (
                        "WEBVIEW_stale.1"
                        if self.context_queries == 1
                        else "WEBVIEW_current.2"
                    )
                    return ["NATIVE_APP", webview]
                if (
                    method == "POST"
                    and path.endswith("/context")
                    and payload == {"name": "WEBVIEW_stale.1"}
                ):
                    raise DriverError("stale WebKit target")
                if (
                    method == "POST"
                    and path.endswith("/execute/sync")
                    and payload
                    and payload.get("script") == HARNESS_INVENTORY_SCRIPT
                ):
                    return ["projection.read"]
                return result

        transport = StaleTargetTransport()
        session = SimulatorAppiumSession(
            transport,
            client_id="sim-ios",
            platform="ios",
            automation_name="XCUITest",
            device=SimulatorDeviceTarget(
                platform="ios",
                identifier="ios-simulator-udid",
                role="ios-simulator",
            ),
            build=SimulatorBuildTarget(
                platform="ios",
                artifact=Path("/tmp/mobile.app"),
                application_id="com.peers.touch.mobile",
            ),
            callback_scheme="peers-touch",
            ports={"wda-local": 8101, "mjpeg": 9101, "webview": 9511},
        )
        session.start()

        with patch(
            "tooling.acceptance.gates.mobile.simulator_e2e.time.sleep",
            return_value=None,
        ):
            context = session.switch_to_app_webview(timeout=1.0)

        self.assertEqual(context, "WEBVIEW_current.2")
        self.assertEqual(transport.context_queries, 2)

    def test_ios_reconnects_driver_after_runtime_relaunch(self) -> None:
        transport = FakeAppiumTransport("ios-session")
        session = SimulatorAppiumSession(
            transport,
            client_id="sim-ios",
            platform="ios",
            automation_name="XCUITest",
            device=SimulatorDeviceTarget(
                platform="ios",
                identifier="ios-simulator-udid",
                role="ios-simulator",
            ),
            build=SimulatorBuildTarget(
                platform="ios",
                artifact=Path("/tmp/mobile.app"),
                application_id="com.peers.touch.mobile",
            ),
            callback_scheme="peers-touch",
            ports={"wda-local": 8101, "mjpeg": 9101, "webview": 9511},
        )

        session.start()
        session.reconnect_after_runtime_relaunch()

        create_requests = [
            request
            for request in transport.requests
            if request[0] == "POST" and request[1] == "/session"
        ]
        self.assertEqual(len(create_requests), 2)
        self.assertIn(
            ("DELETE", "/session/ios-session", None),
            transport.requests,
        )
    def test_public_w3c_element_and_orientation_operations(self) -> None:
        class ElementTransport(FakeAppiumTransport):
            def request(
                self,
                method: str,
                path: str,
                payload: Mapping[str, Any] | None = None,
            ) -> Any:
                result = super().request(method, path, payload)
                if method == "POST" and path.endswith("/element"):
                    return {W3C_ELEMENT_KEY: "field/1"}
                return result

        transport = ElementTransport("ios-session")
        session = SimulatorAppiumSession(
            transport,
            client_id="sim-ios",
            platform="ios",
            automation_name="XCUITest",
            device=SimulatorDeviceTarget(
                platform="ios",
                identifier="ios-simulator-udid",
                role="simulator",
            ),
            build=SimulatorBuildTarget(
                platform="ios",
                artifact=Path("/tmp/mobile.app"),
                application_id="com.peers.touch.mobile",
            ),
            callback_scheme="peers-touch",
            ports={"wda-local": 8101, "mjpeg": 9101, "webview": 9511},
        )

        session.start()
        element_ref = session.find_element(
            "class name",
            "XCUIElementTypeTextField",
        )
        session.click_element(element_ref)
        session.set_orientation("landscape")

        self.assertEqual(element_ref, "field/1")
        self.assertIn(
            (
                "POST",
                "/session/ios-session/element",
                {
                    "using": "class name",
                    "value": "XCUIElementTypeTextField",
                },
            ),
            transport.requests,
        )
        self.assertIn(
            (
                "POST",
                "/session/ios-session/element/field%2F1/click",
                {},
            ),
            transport.requests,
        )
        self.assertIn(
            (
                "POST",
                "/session/ios-session/orientation",
                {"orientation": "LANDSCAPE"},
            ),
            transport.requests,
        )
        with self.assertRaisesRegex(DriverError, "PORTRAIT or LANDSCAPE"):
            session.set_orientation("upside-down")

    def test_polling_rejects_non_finite_timeouts(self) -> None:
        transport = FakeAppiumTransport("ios-session")
        gate = SimulatorCallbackRoutingGate(
            transport_factory=lambda _url: transport
        )
        session = gate._create_session(
            "http://127.0.0.1:4723",
            client_spec("ios"),
        )

        for method_name in ("wait_for_ready", "switch_to_app_webview"):
            method = getattr(session, method_name)
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

        self.assertEqual(transport.requests, [])

    def test_ios_and_android_use_isolated_w3c_capabilities(self) -> None:
        for platform in ("ios", "android"):
            with self.subTest(platform=platform):
                transport = FakeAppiumTransport(f"{platform}-session")
                gate = SimulatorCallbackRoutingGate(
                    transport_factory=lambda _url, value=transport: value
                )
                session = gate._create_session(
                    "http://127.0.0.1:4723",
                    client_spec(platform),
                )
                self.assertIsInstance(session, SimulatorAppiumSession)
                self.assertFalse(
                    hasattr(session, "physical_device_lease_ref")
                )
                self.assertFalse(hasattr(session, "build_attestation_ref"))
                session.start()
                try:
                    create = transport.requests[0]
                    capabilities = create[2]["capabilities"]["alwaysMatch"]
                    self.assertEqual(
                        capabilities["platformName"],
                        "iOS" if platform == "ios" else "Android",
                    )
                    self.assertEqual(
                        capabilities["appium:automationName"],
                        "XCUITest" if platform == "ios" else "UiAutomator2",
                    )
                    self.assertTrue(capabilities["appium:noReset"])
                    self.assertFalse(capabilities["appium:fullReset"])
                    self.assertEqual(
                        capabilities["appium:udid"],
                        (
                            "ios-simulator-udid"
                            if platform == "ios"
                            else "emulator-5554"
                        ),
                    )
                    self.assertEqual(
                        capabilities["appium:app"],
                        "/tmp/mobile.app"
                        if platform == "ios"
                        else "/tmp/mobile.apk",
                    )
                    if platform == "ios":
                        self.assertEqual(
                            capabilities["appium:bundleId"],
                            "com.peers.touch.mobile",
                        )
                        self.assertTrue(capabilities["appium:isHeadless"])
                        self.assertFalse(
                            capabilities["appium:shouldTerminateApp"]
                        )
                        self.assertEqual(
                            capabilities["appium:webviewConnectTimeout"],
                            IOS_WEBVIEW_CONNECT_ATTEMPT_TIMEOUT_MS,
                        )
                        self.assertEqual(capabilities["appium:wdaLocalPort"], 8101)
                    else:
                        self.assertEqual(
                            capabilities["appium:appPackage"],
                            "com.peers.touch.mobile",
                        )
                        self.assertEqual(capabilities["appium:systemPort"], 8201)
                        self.assertEqual(
                            capabilities["appium:chromedriverPort"],
                            9512,
                        )
                finally:
                    session.stop()


class SimulatorJourneyProtocolTests(unittest.TestCase):
    def test_warm_cold_restart_action_order_and_evidence(self) -> None:
        session = FakeSimulatorSession("sim-ios")
        artifacts = FakeEvidenceWriter()
        gate = SimulatorCallbackRoutingGate()

        result = gate._exercise_client(  # type: ignore[arg-type]
            artifacts,
            session,
            client_spec("ios"),
        )

        protocol_events = [
            event
            for event in session.events
            if event.startswith(
                ("action:", "deep-link:", "script:")
            )
        ]
        self.assertEqual(
            protocol_events,
            [
                "script:mobile: activeAppInfo",
                "action:projection.read",
                "deep-link:warm",
                "action:projection.read",
                "script:mobile: terminateApp",
                "deep-link:cold",
                "action:projection.read",
                "action:lifecycle.restart",
                "action:projection.read",
                "action:cleanup",
            ],
        )
        self.assertEqual(
            result["stages"],
            [
                "initial",
                "warm-invalid",
                "cold-invalid",
                "restart-reconnected",
            ],
        )
        self.assertFalse(result["physicalRoleClaimed"])
        self.assertEqual(session.driver_reconnects, 1)
        self.assertEqual(session.native_source_reads_at_reconnect, [4])
        self.assertEqual(session.native_ready_timeouts[0], 15.0)
        self.assertEqual(session.webview_ready_timeout, 30.0)
        self.assertEqual(len(artifacts.json_values), 5)
        self.assertEqual(len(artifacts.byte_values), 13)
        self.assertNotIn(
            "mobile-simulator/sim-ios/restart-reconnected/native-ax.xml",
            artifacts.byte_values,
        )
        preflight = artifacts.json_values[
            "mobile-simulator/sim-ios/preflight/status.json"
        ]
        self.assertEqual(preflight["status"], "PASS")
        self.assertIsNone(preflight["firstFailedStep"])
        self.assertEqual(
            preflight["bundleIdentity"],
            {
                "bundleId": "com.peers.touch.mobile",
                "name": "Peers Touch",
                "pid": 4815,
            },
        )
        self.assertEqual(
            preflight["runtimeIdentity"],
            {
                "context": "WEBVIEW_com.peers.touch.mobile",
                "origin": "tauri://localhost",
                "scheme": "tauri",
            },
        )
        self.assertNotIn(
            b"must-not-persist",
            artifacts.byte_values[
                "mobile-simulator/sim-ios/preflight/webview-source.html"
            ],
        )

    def test_ios_preflight_fails_before_journey_on_bundle_mismatch(self) -> None:
        artifacts = FakeEvidenceWriter()
        session = FakeSimulatorSession(
            "sim-ios",
            bundle_id="com.example.browser",
        )
        gate = SimulatorCallbackRoutingGate()

        with self.assertRaisesRegex(
            DriverError,
            "active bundle does not match",
        ):
            gate._exercise_client(  # type: ignore[arg-type]
                artifacts,
                session,
                client_spec("ios"),
            )

        self.assertFalse(
            any(event.startswith("action:") for event in session.events)
        )
        preflight = artifacts.json_values[
            "mobile-simulator/sim-ios/preflight/status.json"
        ]
        self.assertEqual(preflight["status"], "FAIL")
        self.assertEqual(preflight["firstFailedStep"], "bundle-identity")
        self.assertEqual(
            preflight["contexts"],
            ["NATIVE_APP", "WEBVIEW_com.peers.touch.mobile"],
        )
        self.assertTrue(preflight["sessionStatus"]["active"])
        self.assertEqual(
            preflight["bundleIdentity"]["bundleId"],
            "com.example.browser",
        )
        self.assertTrue(preflight["sourceCaptured"])
        self.assertTrue(preflight["axCaptured"])
        self.assertIn(
            "mobile-simulator/sim-ios/preflight/source.txt",
            artifacts.byte_values,
        )
        self.assertIn(
            "mobile-simulator/sim-ios/preflight/native-ax.xml",
            artifacts.byte_values,
        )

    def test_ios_preflight_requires_all_declared_harness_actions(self) -> None:
        artifacts = FakeEvidenceWriter()
        session = FakeSimulatorSession(
            "sim-ios",
            available_actions=["projection.read", "cleanup"],
        )
        gate = SimulatorCallbackRoutingGate()

        with self.assertRaisesRegex(
            DriverError,
            "lifecycle.restart",
        ):
            gate._exercise_client(  # type: ignore[arg-type]
                artifacts,
                session,
                client_spec("ios"),
            )

        preflight = artifacts.json_values[
            "mobile-simulator/sim-ios/preflight/status.json"
        ]
        self.assertEqual(
            preflight["firstFailedStep"],
            "required-harness-actions",
        )
        self.assertFalse(preflight["browserFallbackUsed"])
        self.assertNotIn(
            "token",
            json.dumps(preflight).lower(),
        )

    def test_physical_role_and_provider_inputs_are_rejected(self) -> None:
        resources = simulator_resources()
        resources["clients"]["sim-ios"]["deviceRole"] = "primary-physical"
        gate = SimulatorCallbackRoutingGate()

        with self.assertRaisesRegex(
            SimulatorGateBlocked,
            "must not claim a physical-device role",
        ):
            gate._client_specs(resources)

        with self.assertRaisesRegex(
            SimulatorGateBlocked,
            "must not receive provider credentials",
        ):
            gate._reject_credentials(
                {"credentialRefs": ["env:PROVIDER_ACCOUNT"]},
                simulator_resources(),
            )

    def test_projection_and_markup_evidence_are_secret_safe(self) -> None:
        projection = valid_projection()
        projection["oauth"]["accessToken"] = "must-not-persist"
        with self.assertRaisesRegex(GateError, "secret-bearing data"):
            _validate_fail_closed_projection(projection)

        redacted = _redacted_markup(
            '<hierarchy authorization="Bearer native-secret" '
            'password="web-secret"/>'
        ).decode("utf-8")
        self.assertNotIn("native-secret", redacted)
        self.assertNotIn("web-secret", redacted)
        self.assertNotIn("password=", redacted)
        self.assertNotIn("authorization=", redacted)

    def test_failure_still_cleans_up_started_session(self) -> None:
        artifacts = FakeEvidenceWriter()
        failing_session = FakeSimulatorSession(
            "sim-ios",
            fail_first_projection=True,
        )
        gate = SimulatorCallbackRoutingGate(
            session_factory=(  # type: ignore[arg-type]
                lambda _url, _spec: failing_session
            )
        )
        manifest = runtime_manifest()

        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_e2e.ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(gate, "_load_manifest", return_value=manifest),
            redirect_stderr(io.StringIO()),
        ):
            exit_code = gate.execute()

        self.assertEqual(exit_code, 1)
        self.assertTrue(failing_session.stopped)
        self.assertEqual(gate.sessions, [])
        self.assertEqual(
            artifacts.json_values["mobile-simulator/cleanup.json"][
                "resources"
            ],
            [
                {
                    "clientId": "sim-ios",
                    "resource": "product-harness",
                    "status": "passed",
                },
                {
                    "clientId": "sim-ios",
                    "resource": "appium-session",
                    "status": "passed",
                },
            ],
        )

    def test_cleanup_failure_does_not_hide_primary_failure(self) -> None:
        artifacts = FakeEvidenceWriter()
        failing_session = FakeSimulatorSession(
            "sim-ios",
            fail_first_projection=True,
            fail_cleanup=True,
        )
        gate = SimulatorCallbackRoutingGate(
            session_factory=(  # type: ignore[arg-type]
                lambda _url, _spec: failing_session
            )
        )

        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_e2e.ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(
                gate,
                "_load_manifest",
                return_value=runtime_manifest(),
            ),
            redirect_stderr(io.StringIO()),
        ):
            exit_code = gate.execute()

        result = artifacts.json_values["mobile-simulator/result.json"]
        self.assertEqual(exit_code, 1)
        self.assertEqual(result["reason"], "projection unavailable")
        self.assertEqual(
            result["cleanupReason"],
            "one or more simulator cleanup actions failed",
        )
        self.assertEqual(
            result["cleanup"][0]["reason"],
            "cleanup harness unavailable",
        )

    def test_pass_claim_is_limited_to_simulator_callback_routing(self) -> None:
        artifacts = FakeEvidenceWriter()
        sessions: dict[str, FakeSimulatorSession] = {}

        def create_session(
            _server_url: str,
            spec: SimulatorClientSpec,
        ) -> FakeSimulatorSession:
            session = FakeSimulatorSession(spec.client_id)
            sessions[spec.client_id] = session
            return session

        gate = SimulatorCallbackRoutingGate(
            session_factory=create_session,  # type: ignore[arg-type]
        )
        result = gate._run_journeys(artifacts, runtime_manifest())

        self.assertEqual(
            result["observedScope"],
            ["simulator-callback-routing"],
        )
        self.assertEqual(
            result["unprovenScope"],
            ["physical provider OAuth/MS-AG03 remains UNPROVEN"],
        )
        self.assertTrue(result["sampleEmissionAllowed"])
        self.assertFalse(result["physicalDeviceClaimed"])
        self.assertFalse(result["successfulCallbackInjected"])
        self.assertFalse(result["stationMocksUsed"])
        self.assertEqual(set(result["clients"]), {"sim-ios", "sim-ios-peer"})
        self.assertEqual(
            artifacts.json_values[
                "mobile-simulator/source-identity.json"
            ]["source"],
            {
                "commit": "source-commit",
                "workspaceDigest": "dirty:source-digest",
            },
        )
        gate._cleanup_sessions(artifacts)
        self.assertTrue(all(session.stopped for session in sessions.values()))


if __name__ == "__main__":
    unittest.main(verbosity=2)
