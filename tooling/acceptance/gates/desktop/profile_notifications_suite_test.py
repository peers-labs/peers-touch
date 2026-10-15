"""Source-only regressions for Suite publication and resource failure ordering."""

from __future__ import annotations

import threading
import time
import unittest
from unittest.mock import MagicMock, patch

from tooling.acceptance.core import GateError
from tooling.acceptance.core.suite_runtime import SuiteRuntimeAction
from tooling.acceptance.provisioners.desktop_profile_notifications_suite import (
    DesktopProfileNotificationsSuite,
    wait_native_source_identity,
)


MODULE = "tooling.acceptance.provisioners.desktop_profile_notifications_suite"


class NativeSourceReadinessTest(unittest.TestCase):
    def test_authenticated_runtime_may_become_ready_after_device_enrollment(self) -> None:
        session = MagicMock()
        identity = {"sourceCommit": "a" * 40}
        with patch(f"{MODULE}.call_async_harness", side_effect=[
            GateError("harness moments.snapshot failed: moments.acceptance.nativeRuntimeIdentityMissing"),
            identity,
        ]) as snapshot:
            self.assertEqual(identity, wait_native_source_identity(session))
        self.assertEqual(2, snapshot.call_count)

    def test_unrelated_harness_failure_is_not_retried(self) -> None:
        with patch(f"{MODULE}.call_async_harness", side_effect=GateError("Station binding differs")) as snapshot:
            with self.assertRaisesRegex(GateError, "Station binding differs"):
                wait_native_source_identity(MagicMock())
        snapshot.assert_called_once()


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
