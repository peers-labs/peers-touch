from __future__ import annotations

import ast
import unittest
from pathlib import Path

from tooling.acceptance.core import (
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
    validate_suite_runtime_report,
)
from tooling.acceptance.gates.chat.message_publishing_native_e2e import (
    GATE_ID,
    RUNTIME_CONTRACT,
    SCENARIO_IDS,
    _field,
    _unwrap_data,
)


ROOT = Path(__file__).resolve().parents[4]
GATE = (
    ROOT
    / "tooling"
    / "acceptance"
    / "gates"
    / "chat"
    / "message_publishing_native_e2e.py"
)
HARNESS = (
    ROOT
    / "apps"
    / "desktop"
    / "src"
    / "acceptance"
    / "message_publishing"
    / "harness.ts"
)


class MessagePublishingNativeGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = GATE.read_text(encoding="utf-8")
        self.harness = HARNESS.read_text(encoding="utf-8")
        self.tree = ast.parse(self.source)

    def test_contract_is_one_suite_with_eight_attach_only_scenarios(self) -> None:
        self.assertEqual(GATE_ID, "chat-message-publishing-native-e2e")
        self.assertEqual(len(SCENARIO_IDS), 8)
        self.assertEqual(RUNTIME_CONTRACT.scenario_ids, SCENARIO_IDS)
        self.assertEqual(
            RUNTIME_CONTRACT.entry_check_id,
            "message-publishing-native-functional",
        )
        self.assertEqual(RUNTIME_CONTRACT.max_provisioning_runs, 1)
        self.assertEqual(RUNTIME_CONTRACT.max_client_launches, 2)
        self.assertEqual(RUNTIME_CONTRACT.min_warm_reuse_rate, 0.85)
        self.assertTrue(RUNTIME_CONTRACT.require_attach_only_scenarios)
        self.assertTrue(RUNTIME_CONTRACT.require_receiver_visible_proof)
        self.assertFalse(RUNTIME_CONTRACT.allow_client_replacement)

    def test_suite_ledger_accepts_one_login_and_pre_scenario_restart(self) -> None:
        ledger = SuiteRuntimeLedger(
            RUNTIME_CONTRACT,
            suite_runtime_id="message-publishing:test",
            source_digest="a" * 40,
            fixture_epoch="fixture-a",
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="home-station:one",
        )
        ledger.record(
            SuiteRuntimeAction.ACCOUNT_PROVISION,
            resource_id="alice-reviewed-existing-account",
        )
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id="alice-native-initial",
        )
        ledger.record(
            SuiteRuntimeAction.LOGIN,
            resource_id="alice-owner-session",
        )
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id="alice-native-relaunch",
        )
        for scenario_id in SCENARIO_IDS:
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id=scenario_id,
            )
            ledger.record(
                SuiteRuntimeAction.UI_ACTION,
                scenario_id=scenario_id,
                resource_id="alice-native",
            )
            ledger.record(
                SuiteRuntimeAction.RECEIVER_ASSERTION,
                scenario_id=scenario_id,
                resource_id="alice-visible-projection",
            )
            ledger.record(
                SuiteRuntimeAction.SCENARIO_END,
                scenario_id=scenario_id,
            )
        ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)

        report = ledger.require_valid()
        self.assertEqual(report["metrics"]["provisioningRuns"], 1)
        self.assertEqual(report["metrics"]["clientLaunches"], 2)
        self.assertEqual(report["metrics"]["completedScenarios"], 8)
        self.assertEqual(report["metrics"]["warmReuseRate"], 0.875)
        self.assertEqual(
            validate_suite_runtime_report(
                report,
                expected_contract=RUNTIME_CONTRACT,
            ),
            report,
        )

    def test_runner_has_no_reset_or_second_actor_path(self) -> None:
        self.assertNotIn("CHAT_ACCEPTANCE_RESET", self.source)
        self.assertNotIn("FIXTURE_RESET", self.source)
        self.assertIn('len(manifest.get("clients", [])) != 1', self.source)
        self.assertEqual(
            self.source.count('create_bound_session(\n            "alice"'),
            1,
        )
        self.assertEqual(
            self.source.count("SuiteRuntimeAction.LOGIN,"),
            1,
        )
        self.assertEqual(
            self.source.count("SuiteRuntimeAction.CLIENT_LAUNCH,"),
            2,
        )
        self.assertNotIn("SuiteRuntimeAction.CLIENT_REPLACEMENT", self.source)

    def test_client_readiness_requires_hydrated_active_device_identity(self) -> None:
        self.assertIn('"hydrateActiveActor"', self.source)
        self.assertEqual(
            self.source.count('and value.get("actorPtid") == self.owner_ptid'),
            2,
        )
        self.assertEqual(
            self.source.count('and value.get("active") is True'),
            2,
        )

    def test_runtime_setup_is_inside_cleanup_envelope(self) -> None:
        run_method = next(
            node
            for node in ast.walk(self.tree)
            if isinstance(node, ast.FunctionDef) and node.name == "run"
        )
        source = ast.get_source_segment(self.source, run_method) or ""
        self.assertLess(source.index("try:"), source.index("self._launch_client()"))
        self.assertIn("finally:", source)
        self.assertIn("self._cleanup", source)

    def test_runner_keeps_http_authority_out_of_native_harness(self) -> None:
        self.assertIn('"/message-publishing/grants/create"', self.source)
        self.assertIn('"/message-publishing/grants/list"', self.source)
        self.assertIn('"/message-publishing/grants/rotate-secret"', self.source)
        self.assertIn('"/message-publishing/grants/revoke"', self.source)
        self.assertIn('f"/message-ingress/{publishing_id}"', self.source)
        self.assertNotIn("/message-publishing/", self.harness)
        self.assertNotIn("/message-ingress/", self.harness)
        self.assertNotIn("publicationReceipt", self.harness)

    def test_harness_exposes_receiver_and_cleanup_oracles_only(self) -> None:
        for method in (
            "receiverSnapshot",
            "openReceiverMessage",
            "locateReceiverMessage",
            "createBot",
            "revokeBot",
            "disableChatNotifications",
            "restoreChatNotifications",
            "uploadAttachment",
            "deleteAttachment",
        ):
            self.assertIn(method, self.harness)
        for receiver_field in (
            "messageCount",
            "unreadBeforeOpen",
            "notificationCount",
            "serviceMessage",
            "aggregation",
        ):
            self.assertIn(receiver_field, self.harness)

    def test_cleanup_revokes_every_mutable_fixture_and_releases_client(self) -> None:
        cleanup = next(
            node
            for node in ast.walk(self.tree)
            if isinstance(node, ast.FunctionDef) and node.name == "_cleanup"
        )
        cleanup_source = ast.get_source_segment(self.source, cleanup) or ""
        for marker in (
            "restoreChatNotifications",
            "deleteAttachment",
            "revokeBot",
            '"/message-publishing/grants/revoke"',
            "revokedCredentialRejected",
            "release_all",
            "finalize_cleanup",
            "CLEANUP_COMPLETE",
        ):
            self.assertIn(marker, cleanup_source)

    def test_every_scenario_records_ui_and_receiver_proof(self) -> None:
        run_scenario = next(
            node
            for node in ast.walk(self.tree)
            if isinstance(node, ast.FunctionDef)
            and node.name == "_run_scenario"
        )
        method_source = ast.get_source_segment(self.source, run_scenario) or ""
        self.assertIn("SuiteRuntimeAction.UI_ACTION", method_source)
        self.assertIn(
            "SuiteRuntimeAction.RECEIVER_ASSERTION",
            method_source,
        )
        for scenario_id in SCENARIO_IDS:
            self.assertIn(f'"{scenario_id}"', self.source)

    def test_response_helpers_accept_proto_and_json_field_names(self) -> None:
        self.assertEqual(
            _field({"publishing_id": "a"}, "publishing_id", "publishingId"),
            "a",
        )
        self.assertEqual(
            _field({"publishingId": "b"}, "publishing_id", "publishingId"),
            "b",
        )
        self.assertEqual(_unwrap_data({"data": {"ok": True}}), {"ok": True})
        self.assertEqual(_unwrap_data({"ok": True}), {"ok": True})


if __name__ == "__main__":
    unittest.main()
