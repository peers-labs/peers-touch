"""Source-only regressions for Suite publication and resource failure ordering."""

from __future__ import annotations

import os
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tooling.acceptance.core import GateError
from tooling.acceptance.core.errors import DriverError
from tooling.acceptance.core.suite_runtime import SuiteRuntimeAction
from tooling.acceptance.drivers.tauri import EXPECTED_URL
from tooling.acceptance.gates.desktop.profile_notifications_e2e import (
    DesktopProfileNotificationsGate,
)
from tooling.acceptance.gates.desktop.profile_notifications_journey import (
    _reject_pending_friend_request,
    _request_has_status,
    native_click,
)
from tooling.acceptance.provisioners.desktop_profile_notifications_suite import (
    DesktopProfileNotificationsSuite,
    read_native_source_identity,
)


MODULE = "tooling.acceptance.provisioners.desktop_profile_notifications_suite"
GATE_MODULE = "tooling.acceptance.gates.desktop.profile_notifications_e2e"
JOURNEY_MODULE = "tooling.acceptance.gates.desktop.profile_notifications_journey"


class DesktopProfileNotificationsGateTest(unittest.TestCase):
    def test_gate_report_declares_complete_source_traceability(self) -> None:
        report = DesktopProfileNotificationsGate().report.to_dict()

        self.assertEqual(report["phase"], "DUI-C1-C9")
        self.assertEqual(report["bom"], list(DesktopProfileNotificationsGate.bom))
        self.assertEqual(report["spec"], ["DUI-C1-C9"])
        self.assertEqual(report["gate"], DesktopProfileNotificationsGate.gate_id)

    def test_gate_loads_the_parent_owned_runtime_manifest(self) -> None:
        with (
            patch.dict(os.environ, {
                "PT_ACCEPTANCE_RUNTIME_MANIFEST": "/tmp/profile-runtime.json",
            }),
            patch(f"{GATE_MODULE}.load_runtime_manifest", return_value={}) as loader,
            patch(f"{GATE_MODULE}.EphemeralGateClient.from_environment", return_value=None),
        ):
            with self.assertRaisesRegex(GateError, "parent-owned Suite"):
                DesktopProfileNotificationsGate().run()
        loader.assert_called_once_with(
            Path("/tmp/profile-runtime.json"),
            DesktopProfileNotificationsGate.gate_id,
        )

    def test_gate_rejects_a_missing_runtime_manifest(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(GateError, "PT_ACCEPTANCE_RUNTIME_MANIFEST is required"):
                DesktopProfileNotificationsGate().run()


class NativePointerDeliveryTest(unittest.TestCase):
    def test_native_click_retries_only_until_a_trusted_trigger_click(self) -> None:
        missed = {
            "events": [{
                "type": "click",
                "trusted": True,
                "hitsTrigger": False,
            }],
        }
        delivered = {
            "events": [{
                "type": "click",
                "trusted": True,
                "hitsTrigger": True,
            }],
        }
        with patch(
            f"{JOURNEY_MODULE}._native_click_once",
            side_effect=(missed, delivered),
        ) as click_once:
            result = native_click(
                MagicMock(),
                MagicMock(),
                '[aria-haspopup="dialog"]',
                (MagicMock(),),
            )

        self.assertEqual(click_once.call_count, 2)
        self.assertEqual(result["attempts"], [missed, delivered])

    def test_native_click_fails_after_bounded_untrusted_attempts(self) -> None:
        missed = {
            "events": [{
                "type": "click",
                "trusted": False,
                "hitsTrigger": True,
            }],
        }
        with (
            patch(
                f"{JOURNEY_MODULE}._native_click_once",
                side_effect=(missed, missed, missed),
            ) as click_once,
            self.assertRaisesRegex(GateError, "after 3 attempts"),
        ):
            native_click(
                MagicMock(),
                MagicMock(),
                '[aria-haspopup="dialog"]',
                (MagicMock(),),
            )

        self.assertEqual(click_once.call_count, 3)


class NotificationFixtureRecoveryTest(unittest.TestCase):
    def test_request_status_matches_only_the_exact_authority_row(self) -> None:
        projection = {
            "requests": [
                {"id": "request-1", "status": 1},
                {"id": "request-2", "status": 3},
            ],
        }
        self.assertTrue(_request_has_status(projection, "request-2", 3))
        self.assertFalse(_request_has_status(projection, "request-1", 3))

    def test_conflict_is_recovered_when_authority_is_terminal(self) -> None:
        receiver = MagicMock()
        receiver.invoke_app_result.return_value = {
            "ok": False,
            "error": {"code": "CONFLICT"},
        }
        with patch(
            f"{JOURNEY_MODULE}.call_async_harness",
            return_value={"requests": [{"id": "request-1", "status": 3}]},
        ):
            _reject_pending_friend_request(
                receiver,
                "ptid:sender",
                {"home_station_peer_id": "station-1"},
                "request-1",
                "federation-1",
                "recovery failed",
            )

    def test_command_error_is_recovered_when_authority_is_terminal(self) -> None:
        receiver = MagicMock()
        receiver.invoke_app_result.side_effect = DriverError("CONFLICT")
        with patch(
            f"{JOURNEY_MODULE}.call_async_harness",
            return_value={"requests": [{"id": "request-1", "status": 3}]},
        ):
            _reject_pending_friend_request(
                receiver,
                "ptid:sender",
                {"home_station_peer_id": "station-1"},
                "request-1",
                "federation-1",
                "recovery failed",
            )

    def test_conflict_fails_when_authority_remains_pending(self) -> None:
        receiver = MagicMock()
        receiver.invoke_app_result.return_value = {
            "ok": False,
            "error": {"code": "CONFLICT"},
        }
        with (
            patch(
                f"{JOURNEY_MODULE}.call_async_harness",
                return_value={"requests": [{"id": "request-1", "status": 1}]},
            ),
            self.assertRaisesRegex(GateError, "recovery failed"),
        ):
            _reject_pending_friend_request(
                receiver,
                "ptid:sender",
                {"home_station_peer_id": "station-1"},
                "request-1",
                "federation-1",
                "recovery failed",
            )


class NativeSourceIdentityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.session = MagicMock()
        self.session.process_id = 321
        self.session.execute_script.return_value = EXPECTED_URL
        self.binding = MagicMock()
        self.binding.binary_identity.return_value = {
            "sourceCommit": "a" * 40, "sha256": "b" * 64,
        }
        self.identity = {
            "sourceCommit": "a" * 40,
            "processId": 321,
            "executableSha256": "b" * 64,
            "rendererArtifactSha256": "c" * 64,
        }

    def test_profile_identity_has_no_private_moments_dependency(self) -> None:
        with patch(f"{MODULE}.call_async_harness", return_value=self.identity) as harness:
            self.assertEqual(self.identity, read_native_source_identity(
                self.session, self.binding, "a" * 40,
            ))
        harness.assert_called_once_with(
            self.session, "sourceIdentity", {}, namespace="runtime", script_timeout=30,
        )

    def test_browser_renderer_is_rejected_by_the_native_url_contract(self) -> None:
        self.session.execute_script.return_value = "http://localhost/"
        with patch(f"{MODULE}.call_async_harness", return_value=self.identity):
            with self.assertRaisesRegex(GateError, "embeddedRenderer"):
                read_native_source_identity(self.session, self.binding, "a" * 40)

    def test_renderer_identity_reads_the_live_page_location(self) -> None:
        with patch(f"{MODULE}.call_async_harness", return_value=self.identity):
            read_native_source_identity(self.session, self.binding, "a" * 40)
        self.session.execute_script.assert_called_once_with(
            "return location.origin",
        )
        self.session.get_current_url.assert_not_called()

    def test_stale_source_wrong_process_and_wrong_binary_are_rejected(self) -> None:
        for field, value in (
            ("sourceCommit", "d" * 40), ("processId", 322),
            ("executableSha256", "e" * 64), ("rendererArtifactSha256", ""),
        ):
            with self.subTest(field=field), patch(
                f"{MODULE}.call_async_harness", return_value={**self.identity, field: value},
            ):
                with self.assertRaisesRegex(GateError, "Suite process and binary"):
                    read_native_source_identity(self.session, self.binding, "a" * 40)


class DesktopProfileNotificationsSuiteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.binding = MagicMock()
        self.binding.finalize_cleanup.return_value = {"cleanupErrors": []}
        self.binding.binding_proof_evidence.return_value = {"proofCount": 2}
        self.writer = MagicMock()
        self.writer.write_json.return_value.to_dict.return_value = {"path": "suite/result.json"}
        self.suite = DesktopProfileNotificationsSuite(
            {
                "runId": "source-test-suite",
                "source": {"commit": "a" * 40, "workspaceDigest": "clean"},
                "clients": [{"id": "receiver"}, {"id": "sender"}],
            },
            self.binding,
            self.writer,
        )
        self.suite.actor_manifest_ref = {"path": "runtime/actors.json"}
        for role in ("receiver", "sender"):
            session = MagicMock()
            session.process_id = None
            self.suite.sessions[role] = session
            self.suite.ledger.record(SuiteRuntimeAction.CLIENT_LAUNCH, resource_id=role)
            self.suite.ledger.record(SuiteRuntimeAction.LOGIN, resource_id=role)
        self.profile = {"assertions": {f"C{index}": True for index in range(1, 7)}}
        self.notifications = {"assertions": {f"C{index}": True for index in range(7, 10)}}

    def tearDown(self) -> None:
        self.binding.finalize_cleanup.return_value = {"cleanupErrors": []}
        self.suite.close()

    def test_success_publishes_one_complete_generation_after_cleanup(self) -> None:
        def publish(path, payload, *, role):
            del payload, role
            for session in self.suite.sessions.values():
                session.stop.assert_called_once()
            self.binding.finalize_cleanup.assert_called_once()
            reference = MagicMock()
            reference.to_dict.return_value = {"path": path}
            return reference

        self.writer.write_json.side_effect = publish
        with (
            patch(f"{MODULE}.run_profile_journey", return_value=self.profile),
            patch(f"{MODULE}.run_notifications_journey", return_value=self.notifications),
        ):
            result = self.suite.run(time.monotonic() + 30, threading.Event())
            repeated = self.suite.run(time.monotonic() + 30, threading.Event())
        self.assertEqual(result, repeated)
        published = [call.args[0] for call in self.writer.write_json.call_args_list]
        self.assertEqual(["suite/runtime.json", "suite/result.json"], published)
        report = self.suite.ledger.require_valid()
        self.assertEqual(2, report["metrics"]["completedScenarios"])
        self.assertEqual("cleanup-complete", report["events"][-1]["action"])
        self.suite.close()
        self.binding.finalize_cleanup.assert_called_once()

    def test_failed_scenario_releases_both_clients_without_publishing_results(self) -> None:
        with (
            patch(f"{MODULE}.run_profile_journey", return_value=self.profile),
            patch(f"{MODULE}.run_notifications_journey", side_effect=GateError("receiver assertion failed")),
        ):
            with self.assertRaisesRegex(GateError, "receiver assertion failed"):
                self.suite.run(time.monotonic() + 30, threading.Event())
        self.writer.write_json.assert_not_called()
        for session in self.suite.sessions.values():
            session.stop.assert_called_once()
        self.binding.finalize_cleanup.assert_called_once()

    def test_cleanup_failure_prevents_successful_publication(self) -> None:
        self.binding.finalize_cleanup.return_value = {"cleanupErrors": ["port still held"]}
        with (
            patch(f"{MODULE}.run_profile_journey", return_value=self.profile),
            patch(f"{MODULE}.run_notifications_journey", return_value=self.notifications),
        ):
            with self.assertRaisesRegex(GateError, "resource cleanup failed"):
                self.suite.run(time.monotonic() + 30, threading.Event())
        self.writer.write_json.assert_not_called()
        for session in self.suite.sessions.values():
            session.stop.assert_called_once()


if __name__ == "__main__":
    unittest.main()
