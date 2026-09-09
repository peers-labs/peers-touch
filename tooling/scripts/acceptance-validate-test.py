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


class GateLaunchContractTests(unittest.TestCase):
    def test_rejects_duplicate_gate_catalog_keys(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            gates_path = Path(temp_dir) / "gates.yaml"
            gates_path.write_text(
                '{"gates":{"finalizer-gate":{"evidenceFinalizer":{},'
                '"evidenceFinalizer":{}}}}',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "duplicate key"):
                MODULE.load(gates_path)

            gates_path.write_text(
                '{"gates":{"finalizer-gate":{"timeout_seconds":1e999}}}',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "invalid number"):
                MODULE.load(gates_path)

    def test_accepts_each_canonical_launch_form(self) -> None:
        MODULE.validate_gate_catalog(
            {
                "legacy-gate": {
                    "command": "python3 legacy_gate.py",
                    "environment": "local",
                    "tier": "ci-cheap",
                },
                "context-gate": {
                    "argv": ["python3", "-m", "example.gate"],
                    "ephemeralCapabilities": [
                        "example.echo",
                        "example.deny",
                    ],
                    "environment": "local",
                    "tier": "ci-cheap",
                },
            },
            {"legacy-gate", "context-gate"},
        )

    def test_discovers_registered_environment_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            acceptance_root = Path(temp_dir)
            environment_dir = acceptance_root / "environments"
            environment_dir.mkdir()
            (environment_dir / "synthetic-runtime.yaml").write_text(
                '{"id":"synthetic-runtime"}\n',
                encoding="utf-8",
            )

            MODULE.validate_gate_catalog(
                {
                    "environment-gate": {
                        "command": "true",
                        "environment": "synthetic-runtime",
                        "tier": "env-evidence",
                    }
                },
                {"environment-gate"},
                acceptance_root=acceptance_root,
            )

            with self.assertRaisesRegex(RuntimeError, "invalid environment"):
                MODULE.validate_gate_catalog(
                    {
                        "unknown-environment-gate": {
                            "command": "true",
                            "environment": "not-registered",
                            "tier": "env-evidence",
                        }
                    },
                    {"unknown-environment-gate"},
                    acceptance_root=acceptance_root,
                )

    def test_rejects_invalid_launch_forms(self) -> None:
        cases = [
            (
                {},
                "exactly one of command or argv",
            ),
            (
                {"command": "true", "argv": ["true"]},
                "exactly one of command or argv",
            ),
            (
                {"command": ""},
                "command must be a non-empty string",
            ),
            (
                {"argv": []},
                "argv must be a non-empty list of non-empty strings",
            ),
            (
                {"argv": ["python3", ""]},
                "argv must be a non-empty list of non-empty strings",
            ),
        ]

        for launch, expected_error in cases:
            with self.subTest(launch=launch):
                with self.assertRaisesRegex(RuntimeError, expected_error):
                    MODULE.validate_gate_catalog(
                        {
                            "invalid-gate": {
                                **launch,
                                "environment": "local",
                                "tier": "ci-cheap",
                            }
                        },
                        {"invalid-gate"},
                    )

    def test_rejects_invalid_ephemeral_capabilities(self) -> None:
        cases = [
            (
                {
                    "command": "true",
                    "ephemeralCapabilities": ["example.echo"],
                },
                "ephemeralCapabilities requires argv",
            ),
            (
                {
                    "argv": ["true"],
                    "ephemeralCapabilities": [],
                },
                "unique, non-empty list of non-empty strings",
            ),
            (
                {
                    "argv": ["true"],
                    "ephemeralCapabilities": ["example.echo", "example.echo"],
                },
                "unique, non-empty list of non-empty strings",
            ),
            (
                {
                    "argv": ["true"],
                    "ephemeralCapabilities": ["example.echo", 1],
                },
                "unique, non-empty list of non-empty strings",
            ),
            (
                {
                    "argv": ["node", "gate.js"],
                    "ephemeralCapabilities": ["example.echo"],
                },
                "requires a Python module, script, or -c argv",
            ),
        ]

        for launch, expected_error in cases:
            with self.subTest(launch=launch):
                with self.assertRaisesRegex(RuntimeError, expected_error):
                    MODULE.validate_gate_catalog(
                        {
                            "invalid-gate": {
                                **launch,
                                "environment": "local",
                                "tier": "ci-cheap",
                            }
                        },
                        {"invalid-gate"},
                    )

    def test_argv_gate_participates_in_inheritance_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            module_path = (
                repo_root
                / "tooling"
                / "acceptance"
                / "gates"
                / "example"
                / "gate.py"
            )
            module_path.parent.mkdir(parents=True)
            module_path.write_text("def main():\n    return 0\n", encoding="utf-8")

            with self.assertRaisesRegex(
                RuntimeError,
                "ACCEPTANCE_GATE_CONTRACT_VIOLATION",
            ):
                MODULE.validate_gate_inheritance(
                    repo_root,
                    {
                        "context-gate": {
                            "argv": [
                                "python3",
                                "-m",
                                "tooling.acceptance.gates.example.gate",
                            ]
                        }
                    },
                    {"context-gate"},
                )


class FinalizerContractTests(unittest.TestCase):
    def test_no_declaration_and_no_config_is_not_required(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            acceptance_root = Path(temp_dir)
            (acceptance_root / "capabilities").mkdir()

            self.assertEqual(
                MODULE.validate_finalizer_contracts(acceptance_root, {}),
                {},
            )

    def test_rejects_catalog_config_without_protected_mapping(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            acceptance_root = Path(temp_dir)
            (acceptance_root / "capabilities").mkdir()

            with self.assertRaisesRegex(
                ValueError,
                "has no protected requiredEvidenceFinalizers mapping",
            ):
                MODULE.validate_finalizer_contracts(
                    acceptance_root,
                    {
                        "synthetic-gate": {
                            "evidenceFinalizer": {
                                "id": "synthetic.finalizer",
                                "timeoutSeconds": 30,
                                "inputByteLimit": 4096,
                            }
                        }
                    },
                )


class DomainContractClosureTests(unittest.TestCase):
    SOURCE = {
        "commit": "current-head",
        "workspaceDigest": "clean",
        "canonicalWorktreeHash": "0123456789abcdef",
    }

    def setUp(self) -> None:
        source_patch = mock.patch.object(
            MODULE,
            "source_identity",
            return_value=self.SOURCE,
        )
        source_patch.start()
        self.addCleanup(source_patch.stop)

    def latest_store(self, content: str) -> mock.Mock:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        run_path = Path(temp_dir.name) / "run.json"
        run_path.write_text(content, encoding="utf-8")
        store = mock.Mock()
        store.latest_artifact_ref.return_value = object()
        store.resolve.return_value = run_path
        return store

    def test_current_results_fail_closed_on_non_authoritative_json(self) -> None:
        store = self.latest_store(
            json.dumps({"source": self.SOURCE, "results": []})
        )
        source = json.dumps(self.SOURCE, separators=(",", ":"))
        invalid_results = (
            f'{{"source":{source},"results":['
            '{"id":"gate","status":"failed","status":"passed"}]}',
            f'{{"source":{source},"results":['
            '{"id":"gate","status":"passed","duration":NaN}]}',
            f'{{"source":{source},"results":['
            '{"id":"gate","status":"passed"},'
            '{"id":"gate","status":"failed"}]}',
            f'{{"source":{source},"results":'
            '{"id":"gate","status":"passed"}}',
        )

        for current_results in invalid_results:
            with (
                self.subTest(current_results=current_results),
                mock.patch.dict(
                    MODULE.os.environ,
                    {"PT_ACCEPTANCE_CURRENT_RESULTS": current_results},
                ),
            ):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "invalid current Acceptance results",
                ):
                    MODULE.latest_passed_gates(store, "", False)

    def test_current_results_reject_stale_source_identity(self) -> None:
        store = self.latest_store(
            json.dumps({"source": self.SOURCE, "results": []})
        )
        current_results = json.dumps(
            {
                "source": {
                    **self.SOURCE,
                    "commit": "stale-head",
                },
                "results": [],
            }
        )

        with (
            mock.patch.dict(
                MODULE.os.environ,
                {"PT_ACCEPTANCE_CURRENT_RESULTS": current_results},
            ),
            self.assertRaisesRegex(
                RuntimeError,
                "current Acceptance results source does not match current source",
            ),
        ):
            MODULE.latest_passed_gates(store, "", False)

    def test_latest_results_fail_closed_on_non_authoritative_json(self) -> None:
        for latest_run in (
            '{"results":[{"id":"gate","status":"failed","status":"passed"}]}',
            '{"results":[{"id":"gate","status":"passed","duration":NaN}]}',
        ):
            with self.subTest(latest_run=latest_run):
                store = self.latest_store(latest_run)
                with self.assertRaisesRegex(
                    RuntimeError,
                    "invalid latest Acceptance run",
                ):
                    MODULE.latest_passed_gates(store, "", False)

    def test_latest_results_reject_stale_source_identity(self) -> None:
        store = self.latest_store(
            json.dumps(
                {
                    "source": {
                        **self.SOURCE,
                        "commit": "stale-head",
                    },
                    "results": [
                        {
                            "id": "stale-gate",
                            "status": "passed",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                        }
                    ],
                }
            )
        )

        with self.assertRaisesRegex(
            RuntimeError,
            "latest Acceptance run source does not match current source",
        ):
            MODULE.latest_passed_gates(store, "", True)

    def test_current_results_admit_only_unique_proven_gate_results(self) -> None:
        store = self.latest_store(
            json.dumps(
                {
                    "source": self.SOURCE,
                    "results": [
                        {
                            "id": "superseded-gate",
                            "status": "passed",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                        }
                    ]
                }
            )
        )
        current_results = json.dumps(
            {
                "source": self.SOURCE,
                "results": [
                    {
                        "id": "proven-gate",
                        "status": "passed",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "duration_seconds": 0.125,
                    },
                    {
                        "id": "partial-gate",
                        "status": "passed",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                    },
                    {
                        "id": "dry-run-gate",
                        "status": "dry-run",
                    },
                    {
                        "id": "superseded-gate",
                        "status": "failed",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                    },
                ],
            }
        )

        with mock.patch.dict(
            MODULE.os.environ,
            {"PT_ACCEPTANCE_CURRENT_RESULTS": current_results},
        ):
            self.assertEqual(
                MODULE.latest_passed_gates(store, "", False),
                {"proven-gate"},
            )

    def test_infra_validation_selects_only_core_self_validation(self) -> None:
        with mock.patch.object(
            MODULE,
            "latest_passed_gates",
            return_value=set(),
        ):
            report, results = MODULE.validate_infra(
                MODULE.REPO_ROOT,
                MODULE.REPO_ROOT / "tooling/acceptance",
                False,
                object(),
                "acceptance-infra-validation",
            )

        self.assertEqual(report["scope"], "acceptance-infra")
        self.assertTrue(results)
        self.assertEqual(
            {result["direction"] for result in results},
            {"acceptance_core_self_validation"},
        )
        self.assertNotIn(
            "federation-validates-acceptance-framework",
            {result["id"] for result in results},
        )

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
            (repo_root / "selected").mkdir(parents=True, exist_ok=True)
            (repo_root / "selected" / "path.py").write_text("", encoding="utf-8")

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
