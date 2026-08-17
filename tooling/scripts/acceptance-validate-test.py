#!/usr/bin/env python3
"""Tests for Acceptance domain structural validation."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("acceptance-validate.py")
SPEC = importlib.util.spec_from_file_location("acceptance_validate", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DomainContractClosureTests(unittest.TestCase):
    def test_synthetic_plan_loads_sibling_script_dependencies(self) -> None:
        result = MODULE.run_plan_for_paths(
            MODULE.REPO_ROOT,
            MODULE.REPO_ROOT / "tooling/acceptance",
            ["tooling/acceptance/registry.yaml"],
        )

        self.assertIn("acceptance-framework", result["impacted_features"])
        self.assertIn(
            "acceptance-plan-self",
            {gate["id"] for gate in result["selected_gates"]},
        )

    def test_rejects_missing_gate_wiring_and_environment_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            acceptance_root = Path(temp_dir)
            capabilities = [
                {
                    "id": "chat-capability",
                    "features": ["chat-feature"],
                    "required_gates": ["native-gate"],
                }
            ]
            features = [
                {
                    "id": "chat-feature",
                    "required_gates": ["native-gate", "missing-gate"],
                }
            ]
            gate_defs = {
                "native-gate": {
                    "environment": "native-tauri-embedded-webdriver",
                }
            }

            with self.assertRaisesRegex(
                RuntimeError,
                r"STRUCTURAL_GAP[\s\S]*missing-gate"
                r"[\s\S]*PROVISIONING_WIRING_MISSING"
                r"[\s\S]*ENVIRONMENT_CONTRACT_MISSING",
            ):
                MODULE.validate_domain_contract_closure(
                    acceptance_root,
                    "chat",
                    capabilities,
                    features,
                    gate_defs,
                    "",
                )

    def test_rejects_invalid_environment_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            acceptance_root = Path(temp_dir)
            environments = acceptance_root / "environments"
            environments.mkdir()
            (environments / "home-station.yaml").write_text(
                "{invalid",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                RuntimeError,
                "ENVIRONMENT_CONTRACT_INVALID",
            ):
                MODULE.validate_domain_contract_closure(
                    acceptance_root,
                    "chat",
                    [
                        {
                            "id": "chat-capability",
                            "features": ["chat-feature"],
                            "required_gates": ["native-gate"],
                        }
                    ],
                    [{"id": "chat-feature", "required_gates": ["native-gate"]}],
                    {
                        "native-gate": {
                            "environment": "home-station",
                            "provisioner": "home-station",
                        }
                    },
                    "",
                )

    def test_rejects_environment_contract_id_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            acceptance_root = Path(temp_dir)
            environments = acceptance_root / "environments"
            environments.mkdir()
            (environments / "home-station.yaml").write_text(
                '{"id": "local-desktop-gateway"}\n',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                RuntimeError,
                r"ENVIRONMENT_CONTRACT_INVALID[\s\S]*does not match",
            ):
                MODULE.validate_domain_contract_closure(
                    acceptance_root,
                    "chat",
                    [
                        {
                            "id": "chat-capability",
                            "features": ["chat-feature"],
                            "required_gates": ["native-gate"],
                        }
                    ],
                    [{"id": "chat-feature", "required_gates": ["native-gate"]}],
                    {
                        "native-gate": {
                            "environment": "home-station",
                            "provisioner": "home-station",
                        }
                    },
                    "",
                )

    def test_rejects_unregistered_provisioner(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            acceptance_root = Path(temp_dir)
            environments = acceptance_root / "environments"
            environments.mkdir()
            (environments / "fedp5.yaml").write_text(
                '{"id": "fedp5"}\n',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                RuntimeError,
                "PROVISIONER_UNREGISTERED",
            ):
                MODULE.validate_domain_contract_closure(
                    acceptance_root,
                    "federation",
                    [
                        {
                            "id": "federation-capability",
                            "features": ["federation-feature"],
                            "required_gates": ["federation-gate"],
                        }
                    ],
                    [
                        {
                            "id": "federation-feature",
                            "required_gates": ["federation-gate"],
                        }
                    ],
                    {
                        "federation-gate": {
                            "environment": "fedp5",
                            "provisioner": "fedp5",
                        }
                    },
                    "",
                )

    def test_accepts_registered_non_local_environment_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            acceptance_root = Path(temp_dir)
            environments = acceptance_root / "environments"
            environments.mkdir()
            (environments / "home-station.yaml").write_text(
                '{"id": "home-station"}\n',
                encoding="utf-8",
            )

            required_gates = MODULE.validate_domain_contract_closure(
                acceptance_root,
                "chat",
                [
                    {
                        "id": "chat-capability",
                        "features": ["chat-feature"],
                        "required_gates": ["native-gate"],
                    }
                ],
                [{"id": "chat-feature", "required_gates": ["native-gate"]}],
                {
                    "native-gate": {
                        "command": "true",
                        "environment": "home-station",
                        "provisioner": "home-station",
                        "tier": "env-evidence",
                    }
                },
                "",
            )

            self.assertEqual(required_gates, {"native-gate"})

    def test_validate_domain_ignores_invalid_unrelated_gate(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            acceptance_root = repo_root / "tooling" / "acceptance"
            for directory in ("domains", "capabilities", "features"):
                (acceptance_root / directory).mkdir(parents=True, exist_ok=True)

            self._write_json(
                acceptance_root / "domains" / "selected.yaml",
                {
                    "id": "selected",
                    "capabilities": ["selected-capability"],
                    "validation_gate_id": "selected-validation",
                },
            )
            self._write_json(
                acceptance_root / "capabilities" / "selected.yaml",
                {
                    "capabilities": [
                        {
                            "id": "selected-capability",
                            "domain": "selected",
                            "direction": "acceptance_validates_product",
                            "features": ["selected-feature"],
                            "required_gates": ["selected-gate"],
                            "synthetic_paths": ["selected/path.py"],
                            "evidence": {
                                "truth_sources": ["selected-truth"],
                                "proven_by": ["selected-gate"],
                                "proven_scope": ["selected behavior"],
                                "unproven_scope": [],
                            },
                        }
                    ]
                },
            )
            self._write_json(
                acceptance_root / "features" / "selected.yaml",
                {
                    "id": "selected-feature",
                    "required_gates": ["selected-gate"],
                },
            )
            self._write_json(
                acceptance_root / "gates.yaml",
                {
                    "gates": {
                        "selected-gate": {
                            "command": "true",
                            "environment": "local",
                            "tier": "ci-cheap",
                        },
                        "selected-validation": {
                            "command": "true",
                            "environment": "local",
                            "tier": "ci-structure",
                        },
                        "unrelated-invalid-gate": {
                            "environment": "invalid-environment",
                            "tier": "invalid-tier",
                        },
                    }
                },
            )

            with (
                mock.patch.object(
                    MODULE,
                    "latest_passed_gates",
                    return_value=set(),
                ),
                mock.patch.object(
                    MODULE,
                    "run_plan_for_paths",
                    return_value={
                        "impacted_features": ["selected-feature"],
                        "selected_gates": [{"id": "selected-gate"}],
                    },
                ),
            ):
                report, results = MODULE.validate_domain(
                    repo_root,
                    acceptance_root,
                    "selected",
                    False,
                    object(),
                )

            self.assertEqual(report["domain"], "selected")
            self.assertEqual(results[0]["status"], "structurally_valid")

    @staticmethod
    def _write_json(path: Path, value: object) -> None:
        path.write_text(
            json.dumps(value, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
