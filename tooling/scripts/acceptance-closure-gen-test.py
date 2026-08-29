from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "tooling" / "scripts" / "acceptance-closure-gen.py"
SPEC = importlib.util.spec_from_file_location("acceptance_closure_gen", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AcceptanceClosureGeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = MODULE.load_yaml(
            REPO_ROOT
            / "tooling"
            / "acceptance"
            / "closures"
            / "messaging-w11.yaml"
        )
        cls.gates = MODULE.load_json(
            REPO_ROOT / "tooling" / "acceptance" / "gates.yaml"
        )["gates"]

    def test_w11_preserves_linux_claim_and_product_closure_gate(self) -> None:
        self.assertEqual(
            MODULE.validate_contract(self.contract, self.gates),
            [],
        )
        plan = MODULE.generate_plan(self.contract, self.gates)
        manifest = MODULE.generate_manifest(self.contract)
        gate_ids = [gate["id"] for gate in plan["selected_gates"]]

        self.assertEqual(
            plan["claimed_runtime_cell"],
            "desktop-linux-native",
        )
        self.assertEqual(
            manifest["claimed_runtime_cell"],
            "desktop-linux-native",
        )
        self.assertIn("chat-native-product-closure-e2e", gate_ids)
        self.assertLess(
            gate_ids.index("chat-native-product-closure-e2e"),
            gate_ids.index("chat-w11-completion-audit"),
        )

    def test_rejects_runtime_cell_not_supported_by_required_gate(self) -> None:
        contract = copy.deepcopy(self.contract)
        contract["claimed_runtime_cell"] = "desktop-unsupported-native"

        errors = MODULE.validate_contract(contract, self.gates)

        self.assertTrue(
            any("does not support claimed runtime cell" in error for error in errors)
        )


if __name__ == "__main__":
    unittest.main()
