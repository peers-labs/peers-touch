"""Social's concrete Native entry consumes its selected parent scope."""
import os
from pathlib import Path
import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
