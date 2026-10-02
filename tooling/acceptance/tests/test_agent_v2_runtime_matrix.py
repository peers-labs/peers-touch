from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "tooling/scripts/expand-agent-v2-runtime-matrix.py"
MATRIX = (
    REPO_ROOT
    / "tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml"
)


def load_module():
    spec = importlib.util.spec_from_file_location("agent_v2_matrix", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AgentV2RuntimeMatrixTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = load_module()
        cls.reviewed = cls.module.load_matrix(MATRIX)

    def test_reviewed_matrix_expands_exactly(self) -> None:
        tuples, counts = self.module.expand_matrix(self.reviewed)
        self.assertEqual(len(tuples), 742)
        self.assertEqual(len(set(tuples)), 742)
        self.assertEqual(
            counts,
            {
                "agent-v2-capability-binding-e2e": 69,
                "agent-v2-connector-invocation-e2e": 37,
                "agent-v2-evaluation-lab-e2e": 57,
                "agent-v2-governed-tool-loop-e2e": 86,
                "agent-v2-home-command-center-e2e": 33,
                "agent-v2-kernel-foundation-e2e": 419,
                "agent-v2-mcp-lifecycle-e2e": 41,
            },
        )
        self.assertEqual(tuples, sorted(tuples))

    def test_foundation_rows_define_disjoint_role_policies(self) -> None:
        policies = self.module.role_policy_by_row(
            self.reviewed,
            "agent-v2-kernel-foundation-e2e",
        )
        self.assertEqual(len(policies), 10)
        self.assertIn(
            "receiver-dom",
            policies["foundation-desktop-direct"]["required"],
        )
        self.assertIn(
            "contract-evidence",
            policies["foundation-mobile-contract"]["required"],
        )
        self.assertIn(
            "guard-report",
            policies["foundation-d11"]["required"],
        )
        self.assertIn(
            "receiver-dom",
            policies["foundation-mobile-contract"]["not_applicable"],
        )
        profiles = self.module.runtime_attestation_profile_by_row(
            self.reviewed,
            "agent-v2-kernel-foundation-e2e",
        )
        self.assertEqual(profiles["foundation-desktop-direct"], "direct_runtime")
        self.assertEqual(
            profiles["foundation-browser-direct"],
            "direct_runtime_no_local_capability",
        )
        self.assertEqual(
            profiles["foundation-z-desktop-external-runtime"],
            "station_turn",
        )
        self.assertEqual(
            profiles["foundation-z-browser-external-runtime"],
            "station_turn",
        )
        self.assertEqual(profiles["foundation-mobile-contract"], "contract_only")
        self.assertEqual(
            profiles["foundation-d11"],
            "orchestration_guard",
        )

    def test_every_row_declares_profile_and_complete_role_policy(self) -> None:
        gates = {
            row["gate"]
            for row in self.reviewed["rows"]
        }
        for gate_id in gates:
            policies = self.module.role_policy_by_row(
                self.reviewed,
                gate_id,
            )
            profiles = self.module.runtime_attestation_profile_by_row(
                self.reviewed,
                gate_id,
            )
            rows = {
                row["id"]
                for row in self.reviewed["rows"]
                if row["gate"] == gate_id
            }
            self.assertEqual(set(policies), rows)
            self.assertEqual(set(profiles), rows)

    def test_rejects_overlapping_role_policy(self) -> None:
        matrix = copy.deepcopy(self.reviewed)
        matrix["rows"][0]["role_policy"]["not_applicable"].append(
            "cell-results"
        )
        with self.assertRaisesRegex(self.module.MatrixError, "overlaps"):
            self.module.expand_matrix(matrix)

    def test_rejects_role_policy_without_always_roles(self) -> None:
        matrix = copy.deepcopy(self.reviewed)
        matrix["rows"][0]["role_policy"]["always"] = ["cell-results"]
        with self.assertRaisesRegex(
            self.module.MatrixError,
            "must include",
        ):
            self.module.expand_matrix(matrix)

    def test_rejects_missing_role_policy(self) -> None:
        matrix = copy.deepcopy(self.reviewed)
        matrix["rows"][0].pop("role_policy")
        with self.assertRaisesRegex(
            self.module.MatrixError,
            "requires role_policy",
        ):
            self.module.expand_matrix(matrix)

    def test_rejects_role_policy_without_attestation_profile(self) -> None:
        matrix = copy.deepcopy(self.reviewed)
        matrix["rows"][0].pop("runtime_attestation_profile")
        with self.assertRaisesRegex(
            self.module.MatrixError,
            "requires runtime_attestation_profile",
        ):
            self.module.expand_matrix(matrix)

    def test_rejects_unknown_attestation_profile(self) -> None:
        matrix = copy.deepcopy(self.reviewed)
        matrix["rows"][0]["runtime_attestation_profile"] = "synthetic"
        with self.assertRaisesRegex(
            self.module.MatrixError,
            "unknown runtime attestation profile",
        ):
            self.module.expand_matrix(matrix)

    def test_rejects_unknown_sample_set(self) -> None:
        matrix = copy.deepcopy(self.reviewed)
        matrix["rows"][0]["sample_set"] = "missing"
        with self.assertRaisesRegex(self.module.MatrixError, "unknown sample set"):
            self.module.expand_matrix(matrix)

    def test_rejects_duplicate_row_cell(self) -> None:
        matrix = copy.deepcopy(self.reviewed)
        matrix["rows"][0].setdefault("cells", []).append("AS-F01")
        with self.assertRaisesRegex(self.module.MatrixError, "duplicate cell"):
            self.module.expand_matrix(matrix)

    def test_rejects_unresolved_required_if(self) -> None:
        matrix = copy.deepcopy(self.reviewed)
        matrix["rows"][0]["required_if"] = "missing.path"
        with self.assertRaisesRegex(self.module.MatrixError, "unresolved"):
            self.module.expand_matrix(matrix)

    def test_rejects_non_boolean_required_if(self) -> None:
        matrix = copy.deepcopy(self.reviewed)
        matrix["flag"] = "true"
        matrix["rows"][0]["required_if"] = "flag"
        with self.assertRaisesRegex(self.module.MatrixError, "non-boolean"):
            self.module.expand_matrix(matrix)

    def test_rejects_missing_tuple_count(self) -> None:
        matrix = copy.deepcopy(self.reviewed)
        matrix["global_invariants"]["expected_expanded_tuples"] += 1
        with self.assertRaisesRegex(self.module.MatrixError, "missing tuple count"):
            self.module.expand_matrix(matrix)

    def test_rejects_unexpected_tuple_count(self) -> None:
        matrix = copy.deepcopy(self.reviewed)
        matrix["global_invariants"]["expected_expanded_tuples"] -= 1
        with self.assertRaisesRegex(
            self.module.MatrixError, "unexpected tuple count"
        ):
            self.module.expand_matrix(matrix)


if __name__ == "__main__":
    unittest.main()
