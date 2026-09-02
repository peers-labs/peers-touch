#!/usr/bin/env python3
"""Core Runtime architecture validation tests.

Validates that the Core abstractions work correctly without requiring a running
Tauri app. Uses MockDriver to simulate the BaseDriver contract.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
    AcceptanceGate,
    AppLaunchMetadata,
    ActorRuntime,
    BaseDriver,
    BaseFixture,
    DomDriver,
    EvidenceReport,
    GateError,
    new_report,
    call_async_harness,
    REPO_ROOT as CORE_REPO_ROOT,
)
from tooling.acceptance.core.redaction import REDACTED
from tooling.acceptance.drivers.tauri import (
    LocalTauriLauncher,
    ProvisionedTauriLauncher,
    TauriDriver,
    TauriSession,
)


class MockDriver(DomDriver):
    def __init__(self, alive: bool = True):
        self._started = False
        self._stopped = False
        self._scripts_executed: list[tuple[str, tuple]] = []
        self._async_scripts_executed: list[tuple[str, tuple]] = []
        self._elements: dict[str, Any] = {}
        self._page_source = "<html><body><div id='root'>mock</div></body></html>"
        self._current_url = "tauri://localhost"
        self._alive = alive
        self.screenshot_path: Path | None = None
        self.log_path = None

    def start(self) -> "MockDriver":
        self._started = True
        return self

    def stop(self) -> None:
        self._stopped = True
        self._started = False

    def wait_for_ready(self, timeout: float = 10.0) -> None:
        if not self._started:
            raise GateError("driver not started")

    def execute_script(self, script: str, *args: Any) -> Any:
        self._scripts_executed.append((script, args))
        if "Boolean(document.querySelector" in script and "#root" in script:
            return True
        if "document.body.innerText" in script:
            return "mock page text"
        if "window.__PT_ACCEPTANCE__" in script and "chat" in script:
            return True
        return None

    def execute_async_script(self, script: str, *args: Any) -> Any:
        self._async_scripts_executed.append((script, args))
        if "loginWithPassword" in str(args):
            return {"value": {"authenticated": True, "actorId": "ptid:mock-actor-123"}}
        if "createDirectConversation" in str(args):
            return {"value": {"conversationId": "conv-mock-456"}}
        return {"value": None}

    def find_element(self, selector: str, timeout: float = 10.0) -> Any:
        mock_el = MagicMock()
        mock_el.text = f"element for {selector}"
        mock_el.get_attribute.return_value = "mock-ulid-789"
        return mock_el

    def find_elements(self, selector: str) -> list[Any]:
        mock_el = MagicMock()
        mock_el.text = f"element for {selector}"
        mock_el.get_attribute.return_value = "mock-ulid-789"
        return [mock_el]

    def is_alive(self) -> bool:
        return self._started and self._alive

    def save_screenshot(self, path: str | Path) -> None:
        self.screenshot_path = Path(path)
        Path(path).write_bytes(b"\x89PNG\r\n\x1a\nmock")

    def get_page_source(self) -> str:
        return self._page_source

    def get_current_url(self) -> str:
        return self._current_url


class EvidenceSchemaTests(unittest.TestCase):
    def test_new_report_has_correct_defaults(self):
        report = new_report("test-gate")
        self.assertEqual(report.gate_id, "test-gate")
        self.assertEqual(report.status, "RUNNING")
        self.assertEqual(report.runtime, {})
        self.assertEqual(report.actors, {})
        self.assertEqual(report.assertions, [])
        self.assertEqual(report.evidence, {})
        self.assertIsNone(report.error)

    def test_report_to_dict_contains_required_fields(self):
        report = new_report("test-gate")
        report.status = "PASS"
        report.duration_ms = 1500
        d = report.to_dict()
        required = {
            "artifactKind",
            "gate",
            "status",
            "completionStatus",
            "proofStatus",
            "sampleEmissionAllowed",
            "started_at",
            "duration_ms",
            "runtime",
            "actors",
            "assertions",
            "evidence",
            "error",
            "station_url",
            "error_type",
        }
        self.assertTrue(required.issubset(d.keys()), f"missing fields: {required - d.keys()}")
        self.assertEqual(d["artifactKind"], "acceptance-gate-evidence-report")
        self.assertEqual(d["completionStatus"], "DONE")
        self.assertEqual(d["proofStatus"], "PROVEN")
        self.assertTrue(d["sampleEmissionAllowed"])

    def test_report_serializes_declared_traceability(self):
        report = new_report(
            "environment-gate",
            phase="workstream",
            bom=("GATE-01",),
            spec=("feature-contract",),
        )

        serialized = report.to_dict()

        self.assertEqual(serialized["phase"], "workstream")
        self.assertEqual(serialized["bom"], ["GATE-01"])
        self.assertEqual(serialized["spec"], ["feature-contract"])

    def test_report_writes_valid_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            report = new_report("unit-test-gate")
            report.status = "PASS"
            report.duration_ms = 100
            report_path = Path(tmpdir) / "report.json"
            report.write(report_path)
            loaded = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(loaded["gate"], "unit-test-gate")
            self.assertEqual(loaded["status"], "PASS")
            self.assertIn("started_at", loaded)

    def test_report_serializes_actor_runtime(self):
        report = new_report("actor-test")
        report.add_actor(
            ActorRuntime(
                name="alice",
                runtime="native-tauri",
                port=4445,
                gateway_port=3030,
                profile="acceptance-alice",
            )
        )
        serialized = report.to_dict()
        self.assertEqual(serialized["actors"]["alice"]["name"], "alice")
        self.assertEqual(serialized["actors"]["alice"]["gateway_port"], 3030)

    def test_report_defensively_serializes_actor_mapping(self):
        report = new_report("actor-mapping-test")
        report.actors["bob"] = {"name": "bob", "port": 4446}  # type: ignore[assignment]
        serialized = report.to_dict()
        self.assertEqual(serialized["actors"]["bob"]["port"], 4446)

    def test_report_redacts_sensitive_structured_values(self):
        report = new_report("redaction-test")
        report.runtime = {
            "password": "plain-password",
            "nested": {"api_token": "plain-token"},
            "detail": "Authorization: Bearer abc.def.ghi",
        }
        report.error = "password=plain-password"
        serialized = report.to_dict()
        self.assertEqual(serialized["runtime"]["password"], REDACTED)
        self.assertEqual(serialized["runtime"]["nested"]["api_token"], REDACTED)
        self.assertNotIn("abc.def.ghi", serialized["runtime"]["detail"])
        self.assertNotIn("plain-password", serialized["error"])

    def test_add_assertion_records_pass_and_fail(self):
        report = new_report("test-gate")
        report.add_assertion("login_success", True, "actorId=ptid:xxx")
        report.add_assertion("message_visible", False, "message not found")
        self.assertEqual(len(report.assertions), 2)
        self.assertTrue(report.assertions[0].passed)
        self.assertFalse(report.assertions[1].passed)

    def test_add_evidence_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            src = Path(tmpdir) / "app.log"
            src.write_text("mock log content", encoding="utf-8")
            report = new_report("ev-test")
            stored = report.add_evidence_file(
                "app-log",
                src,
                destination_dir=Path(tmpdir) / "evidence",
            )
            self.assertTrue(stored.endswith(".log"))
            self.assertTrue(Path(stored).exists())


class AcceptanceGateBaseClassTests(unittest.TestCase):
    def test_gate_requires_gate_id(self):
        with self.assertRaises(GateError) as ctx:
            class BadGate(AcceptanceGate):
                def run(self): return {}
            BadGate()
        self.assertIn("gate_id", str(ctx.exception))

    def test_gate_execute_pass_path(self):
        class SuccessGate(AcceptanceGate):
            gate_id = "unit-test-success"
            def __init__(self, tmpdir: Path):
                super().__init__()
                self.report_path = tmpdir / "success.json"
                self.driver = MockDriver()
                self.register_driver(self.driver)
            def run(self):
                self.driver.start()
                self.report.station_url = "http://mock-station"
                self.assert_condition("started", self.driver.is_alive())
                return {"result": "ok", "count": 42}

        with tempfile.TemporaryDirectory() as tmpdir:
            gate = SuccessGate(Path(tmpdir))
            rc = gate.execute()
            self.assertEqual(rc, 0)
            report = json.loads(gate.report_path.read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "PASS")
            self.assertEqual(report["gate"], "unit-test-success")
            self.assertTrue(len(report["assertions"]) >= 1)
            self.assertTrue(report["assertions"][0]["passed"])
            self.assertTrue(gate.driver._stopped, "driver.stop() must be called after pass")

    def test_gate_execute_fail_path_collects_error(self):
        class FailGate(AcceptanceGate):
            gate_id = "unit-test-fail"
            def __init__(self, tmpdir: Path):
                super().__init__()
                self.report_path = tmpdir / "fail.json"
                self.driver = MockDriver()
                self.register_driver(self.driver)
            def run(self):
                self.driver.start()
                raise RuntimeError("intentional failure for testing")

        with tempfile.TemporaryDirectory() as tmpdir:
            gate = FailGate(Path(tmpdir))
            rc = gate.execute()
            self.assertEqual(rc, 1)
            report = json.loads(gate.report_path.read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "FAIL")
            self.assertIn("intentional failure", report["error"])
            self.assertEqual(report["error_type"], "RuntimeError")
            self.assertTrue(gate.driver._stopped, "driver.stop() must be called on failure")

    def test_gate_drivers_cleanup_on_exception(self):
        class FailMidwayGate(AcceptanceGate):
            gate_id = "unit-test-cleanup"
            def __init__(self, tmpdir: Path):
                super().__init__()
                self.report_path = tmpdir / "cleanup.json"
                self.d1 = MockDriver()
                self.d2 = MockDriver()
                self.register_driver(self.d1)
                self.register_driver(self.d2)
            def run(self):
                self.d1.start()
                self.d2.start()
                raise ValueError("boom")

        with tempfile.TemporaryDirectory() as tmpdir:
            gate = FailMidwayGate(Path(tmpdir))
            gate.execute()
            self.assertTrue(gate.d1._stopped, "d1 must be stopped")
            self.assertTrue(gate.d2._stopped, "d2 must be stopped")

    def test_save_screenshot_and_dom(self):
        class ShotGate(AcceptanceGate):
            gate_id = "unit-test-shot"
            def __init__(self, tmpdir: Path):
                super().__init__()
                self.report_path = tmpdir / "shot.json"
                self.evidence_dir = Path(tmpdir) / "ev"
                self.driver = MockDriver()
                self.register_driver(self.driver)
            def run(self):
                self.driver.start()
                shot = self.save_screenshot(self.driver, "actor")
                dom = self.save_dom(self.driver, "actor")
                self.report.evidence["shot_key"] = shot
                self.report.evidence["dom_key"] = dom
                return {}

        with tempfile.TemporaryDirectory() as tmpdir:
            gate = ShotGate(Path(tmpdir))
            rc = gate.execute()
            self.assertEqual(rc, 0)
            report = json.loads(gate.report_path.read_text(encoding="utf-8"))
            self.assertIn("actor-screenshot", report["evidence"])
            self.assertIn("actor-dom", report["evidence"])

    def test_text_evidence_is_redacted(self):
        class RedactionGate(AcceptanceGate):
            gate_id = "unit-test-redaction"

            def __init__(self, tmpdir: Path):
                super().__init__()
                self.report_path = tmpdir / "redaction.json"
                self.evidence_dir = tmpdir / "evidence"
                self.driver = MockDriver()
                self.driver._page_source = (
                    "<html><body>password=dom-secret "
                    "Authorization: Bearer dom-token</body></html>"
                )
                self.driver.log_path = tmpdir / "app.log"
                self.driver.log_path.write_text(
                    "token=log-secret password=log-password",
                    encoding="utf-8",
                )
                self.register_driver(self.driver)

            def run(self):
                self.driver.start()
                self.save_dom(self.driver, "actor")
                self.save_app_log(self.driver, "actor")
                return {}

        with tempfile.TemporaryDirectory() as tmpdir:
            gate = RedactionGate(Path(tmpdir))
            self.assertEqual(gate.execute(), 0)
            report = json.loads(gate.report_path.read_text(encoding="utf-8"))
            for evidence_path in report["evidence"].values():
                text = (CORE_REPO_ROOT / evidence_path).read_text(encoding="utf-8")
                self.assertIn(REDACTED, text)
                self.assertNotIn("dom-secret", text)
                self.assertNotIn("dom-token", text)
                self.assertNotIn("log-secret", text)
                self.assertNotIn("log-password", text)

    def test_cleanup_failure_fails_gate_and_is_reported(self):
        class CleanupFailureDriver(MockDriver):
            def stop(self) -> None:
                raise RuntimeError("cleanup exploded")

        class CleanupFailureGate(AcceptanceGate):
            gate_id = "unit-test-cleanup-failure"

            def __init__(self, tmpdir: Path):
                super().__init__()
                self.report_path = tmpdir / "cleanup-failure.json"
                self.driver = CleanupFailureDriver()
                self.register_driver(self.driver)

            def run(self):
                self.driver.start()
                return {}

        with tempfile.TemporaryDirectory() as tmpdir:
            gate = CleanupFailureGate(Path(tmpdir))
            self.assertEqual(gate.execute(), 1)
            report = json.loads(gate.report_path.read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "FAIL")
            self.assertIn("driver cleanup failed", report["error"])
            self.assertFalse(report["assertions"][-1]["passed"])


class BaseDriverAbstractInterfaceTests(unittest.TestCase):
    def test_cannot_instantiate_basedriver_directly(self):
        with self.assertRaises(TypeError):
            BaseDriver()

    def test_mock_driver_implements_all_methods(self):
        d = MockDriver()
        required_methods = [
            "start", "stop", "wait_for_ready", "execute_script",
            "execute_async_script", "find_element", "find_elements",
            "is_alive", "save_screenshot", "get_page_source", "get_current_url",
        ]
        for m in required_methods:
            self.assertTrue(hasattr(d, m), f"BaseDriver subclass missing {m}")
            self.assertTrue(callable(getattr(d, m)), f"{m} must be callable")

    def test_lifecycle_only_driver_does_not_require_dom_methods(self):
        class LifecycleDriver(BaseDriver):
            def __init__(self):
                self.started = False

            def start(self):
                self.started = True
                return self

            def stop(self):
                self.started = False

            def wait_for_ready(self, timeout: float):
                return None

            def is_alive(self):
                return self.started

        driver = LifecycleDriver()
        self.assertFalse(hasattr(driver, "execute_script"))
        with driver:
            self.assertTrue(driver.is_alive())
        self.assertFalse(driver.is_alive())

    def test_context_manager_calls_start_stop(self):
        d = MockDriver()
        with d as drv:
            self.assertTrue(drv.is_alive())
        self.assertTrue(d._stopped)


class TauriDriverAttachTests(unittest.TestCase):
    def test_connect_attaches_to_endpoint_without_local_runtime_inputs(self):
        driver = TauriDriver(host="127.0.0.1", port=4555)
        session = MagicMock()

        def connect_session() -> None:
            driver._driver = session

        with patch(
            "tooling.acceptance.drivers.tauri._wait_for_webdriver"
        ) as wait, patch.object(
            driver,
            "_connect_session",
            side_effect=connect_session,
        ):
            self.assertIs(driver.connect(timeout=7), session)

        wait.assert_called_once_with("127.0.0.1", 4555, 7)
        self.assertFalse(hasattr(driver, "app_binary"))
        self.assertFalse(hasattr(driver, "storage_root"))
        self.assertFalse(hasattr(driver, "process_id"))
        driver.stop()
        session.quit.assert_called_once()

    def test_driver_stop_only_closes_webdriver_session(self):
        driver = TauriDriver(port=4555)
        session = MagicMock()
        driver._driver = session

        driver.stop()
        driver.stop()

        session.quit.assert_called_once()

    def test_driver_rejects_non_loopback_endpoint(self):
        with self.assertRaisesRegex(ValueError, "loopback"):
            TauriDriver(host="10.37.246.80", port=4555)


class TauriLauncherSessionTests(unittest.TestCase):
    def test_local_launcher_owns_process_log_and_temporary_storage(self):
        process = MagicMock()
        process.pid = 8123
        process.poll.return_value = None
        with patch(
            "tooling.acceptance.drivers.tauri.subprocess.Popen",
            return_value=process,
        ):
            launcher = LocalTauriLauncher(
                app_binary="/tmp/peers-touch-desktop",
                port=4555,
                gateway_port=3030,
                profile="acceptance-local",
            )
            storage_root = Path(launcher.storage_root)
            metadata = launcher.start()

            self.assertEqual(metadata.process_id, 8123)
            self.assertTrue(storage_root.exists())
            self.assertIsNotNone(metadata.log_path)

            launcher.stop()
            launcher.stop()

            process.terminate.assert_called_once()
            self.assertFalse(storage_root.exists())

    def test_local_launcher_preserves_restart_state_until_final_release(self):
        process = MagicMock()
        process.pid = 8123
        process.poll.return_value = None
        with patch(
            "tooling.acceptance.drivers.tauri.subprocess.Popen",
            return_value=process,
        ):
            launcher = LocalTauriLauncher(
                app_binary="/tmp/peers-touch-desktop",
                port=4555,
                gateway_port=3030,
                profile="acceptance-local",
            )
            storage_root = Path(launcher.storage_root)
            launcher.start()

            launcher.stop(preserve_state=True)
            self.assertTrue(storage_root.exists())

            launcher.stop()
            self.assertFalse(storage_root.exists())

    def test_provisioned_launcher_releases_owned_runtime_once(self):
        release = MagicMock()
        launcher = ProvisionedTauriLauncher(
            AppLaunchMetadata(
                webdriver_host="127.0.0.1",
                webdriver_port=4555,
                gateway_port=3030,
                profile="linux-cell",
                storage_root="/cell/storage",
                process_id=42,
                log_path=Path("/cell/app.log"),
            ),
            release=release,
        )

        self.assertEqual(launcher.start().process_id, 42)
        launcher.stop()
        launcher.stop()

        release.assert_called_once_with(preserve_state=False)
        self.assertFalse(launcher.is_alive())

    def test_provisioned_launcher_releases_process_but_preserves_restart_state(self):
        release = MagicMock()
        launcher = ProvisionedTauriLauncher(
            AppLaunchMetadata(
                webdriver_host="127.0.0.1",
                webdriver_port=4555,
                gateway_port=3030,
                profile="linux-cell",
                storage_root="/cell/storage",
                process_id=42,
            ),
            release=release,
        )

        launcher.start()
        launcher.stop(preserve_state=True)
        launcher.stop()

        release.assert_called_once_with(preserve_state=True)

    def test_provisioned_launcher_rejects_non_loopback_webdriver(self):
        with self.assertRaisesRegex(ValueError, "loopback"):
            ProvisionedTauriLauncher(
                AppLaunchMetadata(
                    webdriver_host="10.37.246.80",
                    webdriver_port=4555,
                    gateway_port=3030,
                    profile="linux-cell",
                    storage_root="/cell/storage",
                )
            )

    def test_session_stops_webdriver_before_launcher_without_double_cleanup(self):
        events: list[str] = []
        launcher = MagicMock()
        launcher.metadata = AppLaunchMetadata(
            webdriver_host="127.0.0.1",
            webdriver_port=4555,
            gateway_port=3030,
            profile="acceptance-local",
            storage_root="/tmp/storage",
        )
        launcher.start.side_effect = lambda: (
            events.append("launcher.start") or launcher.metadata
        )
        launcher.stop.side_effect = lambda: events.append("launcher.stop")
        launcher.is_alive.return_value = True
        webdriver_client = MagicMock()
        webdriver_client.start.side_effect = lambda: events.append("driver.start")
        webdriver_client.stop.side_effect = lambda: events.append("driver.stop")
        webdriver_client.is_alive.return_value = True

        with patch(
            "tooling.acceptance.drivers.tauri.TauriDriver",
            return_value=webdriver_client,
        ):
            session = TauriSession(launcher)
            session.start()
            session.stop()
            session.stop()

        self.assertEqual(
            events,
            ["launcher.start", "driver.start", "driver.stop", "launcher.stop"],
        )

    def test_session_preserves_launcher_state_for_restart(self):
        launcher = MagicMock()
        launcher.metadata = AppLaunchMetadata(
            webdriver_host="127.0.0.1",
            webdriver_port=4555,
            gateway_port=3030,
            profile="acceptance-local",
            storage_root="/tmp/storage",
        )
        launcher.start.return_value = launcher.metadata
        webdriver_client = MagicMock()

        with patch(
            "tooling.acceptance.drivers.tauri.TauriDriver",
            return_value=webdriver_client,
        ):
            session = TauriSession(launcher)
            session.start()
            session.stop(preserve_state=True)

        webdriver_client.stop.assert_called_once()
        launcher.stop.assert_called_once_with(preserve_state=True)

    def test_session_releases_launcher_when_webdriver_connect_fails(self):
        launcher = MagicMock()
        launcher.metadata = AppLaunchMetadata(
            webdriver_host="127.0.0.1",
            webdriver_port=4555,
            gateway_port=3030,
            profile="acceptance-local",
            storage_root="/tmp/storage",
        )
        launcher.start.return_value = launcher.metadata
        webdriver_client = MagicMock()
        webdriver_client.start.side_effect = RuntimeError("connect failed")

        with patch(
            "tooling.acceptance.drivers.tauri.TauriDriver",
            return_value=webdriver_client,
        ):
            with self.assertRaisesRegex(RuntimeError, "connect failed"):
                TauriSession(launcher).start()

        webdriver_client.stop.assert_called_once()
        launcher.stop.assert_called_once()


class FixtureInterfaceTests(unittest.TestCase):
    def test_base_fixture_requires_setup_teardown(self):
        with self.assertRaises(TypeError):
            BaseFixture()

    def test_concrete_fixture_reset_calls_teardown_then_setup(self):
        class SimpleFixture(BaseFixture):
            def __init__(self):
                super().__init__()
                self.order = []
            def setup(self): self.order.append("setup")
            def teardown(self): self.order.append("teardown")

        f = SimpleFixture()
        f.reset()
        self.assertEqual(f.order, ["teardown", "setup"])


class HarnessBridgeTests(unittest.TestCase):
    def test_call_async_harness_returns_value(self):
        mock_driver = MockDriver()
        mock_driver.set_script_timeout = MagicMock()
        val = call_async_harness(mock_driver, "loginWithPassword",
                                  {"account": "a@b", "password": "pw"},
                                  namespace="chat")
        self.assertEqual(val["authenticated"], True)
        self.assertTrue(val["actorId"].startswith("ptid:"))

    def test_call_async_harness_propagates_error(self):
        class ErrorDriver(MockDriver):
            def execute_async_script(self, script, *args):
                return {"error": "login failed: bad password"}
        with self.assertRaises(GateError) as ctx:
            call_async_harness(ErrorDriver(), "loginWithPassword", {}, namespace="chat")
        self.assertIn("chat.loginWithPassword", str(ctx.exception))

    def test_call_async_harness_non_dict_result(self):
        class BadDriver(MockDriver):
            def execute_async_script(self, script, *args):
                return None
        with self.assertRaises(GateError) as ctx:
            call_async_harness(BadDriver(), "anything", {}, namespace="chat")
        self.assertIn("non-dict", str(ctx.exception))


class TauriDriverContractTests(unittest.TestCase):
    def test_tauri_driver_inherits_basedriver(self):
        from tooling.acceptance.drivers import TauriDriver, TauriSession
        self.assertTrue(issubclass(TauriDriver, BaseDriver))
        self.assertTrue(issubclass(TauriDriver, DomDriver))
        self.assertTrue(issubclass(TauriSession, BaseDriver))
        self.assertTrue(issubclass(TauriSession, DomDriver))

    def test_old_api_present_on_new_tauri_driver(self):
        from tooling.acceptance.drivers.tauri import TauriDriver
        old_api_methods = [
            "wait_for_element", "find_by_pt_attr", "get_title",
            "wait_for_renderer", "wait_for_acceptance_harness",
        ]
        for m in old_api_methods:
            self.assertTrue(hasattr(TauriDriver, m) or hasattr(TauriDriver, m),
                            f"TauriDriver missing legacy method {m}")

    def test_business_gates_use_composed_tauri_session(self):
        gate_root = CORE_REPO_ROOT / "tooling" / "acceptance" / "gates"
        direct_driver_users = [
            str(path.relative_to(CORE_REPO_ROOT))
            for path in gate_root.rglob("*.py")
            if "TauriDriver" in path.read_text(encoding="utf-8")
        ]
        self.assertEqual(direct_driver_users, [])

    def test_script_timeout_covers_native_renderer_transitions(self):
        from tooling.acceptance.drivers.tauri import SCRIPT_TIMEOUT
        self.assertEqual(SCRIPT_TIMEOUT, 10.0)


class StationDriverTests(unittest.TestCase):
    def test_station_driver_inherits_basedriver(self):
        from tooling.acceptance.drivers.station import StationDriver
        self.assertTrue(issubclass(StationDriver, BaseDriver))

    def test_station_driver_has_no_dom_capabilities(self):
        from tooling.acceptance.drivers.station import StationDriver
        s = StationDriver("http://localhost:9999")
        self.assertFalse(isinstance(s, DomDriver))
        for method in (
            "execute_script",
            "execute_async_script",
            "find_element",
            "find_elements",
            "save_screenshot",
            "get_page_source",
        ):
            self.assertFalse(hasattr(s, method))


class ChromeDriverTests(unittest.TestCase):
    def test_chrome_driver_inherits_basedriver(self):
        from tooling.acceptance.drivers.chrome import ChromeDriver
        self.assertTrue(issubclass(ChromeDriver, BaseDriver))
        self.assertTrue(issubclass(ChromeDriver, DomDriver))

    def test_chrome_driver_constructor_sets_options(self):
        from tooling.acceptance.drivers.chrome import ChromeDriver
        c = ChromeDriver(headless=True, width=1280, height=800)
        self.assertEqual(c.width, 1280)
        self.assertEqual(c.height, 800)
        self.assertTrue(c.headless)


if __name__ == "__main__":
    unittest.main(verbosity=2)
