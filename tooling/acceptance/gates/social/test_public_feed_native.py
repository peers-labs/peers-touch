"""Social's concrete Native entry consumes its selected parent scope."""
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from tooling.acceptance.core import GateError
from tooling.acceptance.core.suite_runtime import SuiteRuntimeLedger, SuiteRuntimeError
from tooling.acceptance.core.e2e_preflight import (
    PREFLIGHT_ENV, load_catalog, prepare_e2e, preflight_binding,
)
from tooling.acceptance.core.evidence_store import source_identity
from tooling.acceptance.core.execution_budget import ExecutionBudgetError
from tooling.acceptance.core.execution_graph import compile_graph
from tooling.acceptance.gates.social.public_feed_native import GATE_ID, Gate

ROOT = Path(__file__).resolve().parents[4]


class PublicFeedNativeEntryTest(unittest.TestCase):
    def binding(self):
        catalog = ROOT / "tooling/acceptance/gates.yaml"
        definitions = load_catalog(catalog)
        return preflight_binding(prepare_e2e(
            definitions, compile_graph(definitions, [GATE_ID]),
            source_identity(ROOT), repo_root=ROOT, catalog_path=catalog,
            execution_policy="development",
        ))

    def test_original_social_constructor_consumes_its_parent_scope(self):
        with patch.dict(os.environ, {PREFLIGHT_ENV: self.binding()}), patch.object(
            Gate, "__init__", return_value=None,
        ):
            gate = Gate()
        self.assertEqual(gate.e2e_preflight["selectedGateIds"], [GATE_ID])
        self.assertEqual(gate.e2e_preflight["dispatchGateIds"], [GATE_ID])

    def test_inherited_chat_identity_is_rejected_before_construction(self):
        with patch.dict(os.environ, {PREFLIGHT_ENV: self.binding()}), patch.object(
            Gate, "gate_id", "chat-device-search-native-e2e",
        ), patch.object(Gate, "__init__", return_value=None) as constructor:
            with self.assertRaisesRegex(ExecutionBudgetError, "outside E2E request closure"):
                Gate()
        constructor.assert_not_called()

    def test_original_run_binds_runner_workspace_digest_before_fixture_work(self):
        current = source_identity(ROOT)
        for workspace_digest, expected in (
            (current["workspaceDigest"], current["workspaceDigest"].removeprefix("sha256:")),
            ("clean", current["commit"]),
        ):
            with self.subTest(workspace_digest=workspace_digest):
                gate = object.__new__(Gate)
                gate.manifest = {
                    "source": {**current, "workspaceDigest": workspace_digest},
                    "runId": "source-binding-fixture",
                }
                gate.actor_manifest = {"runId": "source-binding-fixture"}
                gate.active_social_scenario = None
                gate.report = SimpleNamespace(runtime={})
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.SuiteRuntimeLedger",
                    wraps=SuiteRuntimeLedger,
                ) as ledger, patch.object(
                    gate, "verify_fixture_ready", side_effect=RuntimeError("fixture boundary"),
                ), patch.object(gate, "cleanup_clients", return_value={}):
                    with self.assertRaisesRegex(RuntimeError, "fixture boundary"):
                        gate.run()
                self.assertEqual(ledger.call_args.kwargs["source_digest"], expected)

    def test_original_run_rejects_invalid_workspace_digest_before_fixture_work(self):
        gate = object.__new__(Gate)
        gate.manifest = {
            "source": {"commit": "a" * 40, "workspaceDigest": "sha256:invalid"},
            "runId": "source-binding-fixture",
        }
        gate.actor_manifest = {"runId": "source-binding-fixture"}
        with patch.object(gate, "verify_fixture_ready") as fixture:
            with self.assertRaisesRegex(SuiteRuntimeError, "SUITE_RUNTIME_SOURCE_INVALID"):
                gate.run()
        fixture.assert_not_called()

    def test_station_source_uses_app_meta_contract_before_client_launch(self):
        commit = "a" * 40
        for version, accepted in (
            ({"build_commit": commit}, True),
            ({"build_commit": "b" * 40}, False),
            ({"commit": commit}, False),
            ({}, False),
        ):
            with self.subTest(version=version):
                gate = object.__new__(Gate)
                gate.manifest = {
                    "source": {"commit": commit, "workspaceDigest": "clean"},
                    "runId": "version-contract-fixture",
                }
                gate.actor_manifest = {"runId": "version-contract-fixture"}
                gate.client_specs = {
                    "alice": {"actor": "alice"},
                    "bob": {"actor": "bob"},
                    "bob2": {"actor": "bob"},
                }
                gate.active_social_scenario = None
                gate.report = SimpleNamespace(runtime={}, add_assertion=Mock())
                with patch(
                    "tooling.acceptance.gates.social.public_feed_native.read_station_version",
                    return_value=version,
                ), patch(
                    "tooling.acceptance.gates.social.public_feed_native.runtime_station_service",
                    side_effect=lambda manifest, actor: {
                        "endpoint": f"http://{actor}.invalid",
                        "runtimeIdentity": actor,
                    },
                ), patch.object(
                    gate, "verify_fixture_ready",
                ), patch.object(
                    gate, "start_client",
                ) as launch, patch.object(
                    gate, "source_identity", side_effect=RuntimeError("source identity boundary"),
                ), patch.object(gate, "cleanup_clients", return_value={}):
                    if accepted:
                        with self.assertRaisesRegex(RuntimeError, "source identity boundary"):
                            gate.run()
                        self.assertEqual(launch.call_count, 3)
                        self.assertEqual([call.args[0] for call in launch.call_args_list],
                                         ["alice", "bob", "bob2"])
                    else:
                        with self.assertRaisesRegex(GateError, "alice-station-source"):
                            gate.run()
                        launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
