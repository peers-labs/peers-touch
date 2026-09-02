"""Tests for generic finalizer registration and protected binding."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core.finalization_contracts import (
    domain_separated_sha256,
)
from tooling.acceptance.finalizers import registry as REGISTRY


class FinalizerRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.repo_root = Path(self.temp_dir.name)
        self.acceptance_root = self.repo_root / "tooling" / "acceptance"
        (self.acceptance_root / "capabilities").mkdir(parents=True)
        (self.repo_root / "synthetic").mkdir()

    def write(self, relative_path: str, content: str) -> None:
        path = self.repo_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def raw_sha256(self, relative_path: str) -> str:
        return hashlib.sha256(
            (self.repo_root / relative_path).read_bytes()
        ).hexdigest()

    def refresh_protected_registry_binding(self, registry_path: str) -> None:
        baseline_path = "synthetic/protected.json"
        baseline_file = self.repo_root / baseline_path
        baseline = json.loads(baseline_file.read_text(encoding="utf-8"))
        baseline["registryFileDigest"] = self.raw_sha256(registry_path)
        baseline_file.write_text(
            json.dumps(baseline, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        capability_path = (
            self.acceptance_root / "capabilities" / "synthetic.yaml"
        )
        capability = json.loads(capability_path.read_text(encoding="utf-8"))
        capability["finalizerRegistry"]["protectedBaselineDigest"] = (
            domain_separated_sha256(
                "pt.acceptance.finalization.protected-baseline.v1",
                baseline,
            )
        )
        capability["finalizerRegistry"]["protectedBaselineFileSha256"] = (
            self.raw_sha256(baseline_path)
        )
        capability_path.write_text(
            json.dumps(capability, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def install_valid_contract(self) -> tuple[dict[str, object], str]:
        finalizer_id = "synthetic.finalizer"
        registry_path = "synthetic/finalizers.json"
        baseline_path = "synthetic/protected.json"
        contract_schema_path = "synthetic/contract.json"
        source_paths = [
            contract_schema_path,
            "synthetic/finalizer.py",
            "synthetic/generator.py",
        ]
        self.write(contract_schema_path, '{"type":"object"}\n')
        self.write(source_paths[1], "def finalize(value):\n    return value\n")
        self.write(source_paths[2], "def generate():\n    return None\n")
        source_digest = REGISTRY._source_digest(
            self.repo_root,
            tuple(source_paths),
        )
        role_names = ["synthetic.cleanup", "synthetic.primary"]
        role_digest = domain_separated_sha256(
            "pt.acceptance.finalization.role-projection.v1",
            {
                "finalizerId": finalizer_id,
                "evidenceRoleNames": role_names,
            },
        )
        registry_document = {
            "entries": [
                {
                    "finalizerId": finalizer_id,
                    "entrypoint": "synthetic.finalizer",
                    "sourcePaths": source_paths,
                    "sourceDigest": source_digest,
                    "contractRoleProjectionDigest": role_digest,
                    "evidenceRoleNames": role_names,
                }
            ]
        }
        self.write(
            registry_path,
            json.dumps(registry_document, sort_keys=True) + "\n",
        )
        mapping_digest = domain_separated_sha256(
            "pt.acceptance.finalization.requirement-mapping.v1",
            {
                "gateId": "synthetic-gate",
                "finalizerId": finalizer_id,
                "finalizerRegistryPath": registry_path,
                "protectedBaselinePath": baseline_path,
            },
        )
        baseline = {
            "gateId": "synthetic-gate",
            "finalizerId": finalizer_id,
            "requirementMappingDigest": mapping_digest,
            "registryFilePath": registry_path,
            "registryFileDigest": self.raw_sha256(registry_path),
            "contractSchemaPath": contract_schema_path,
            "contractSchemaDigest": self.raw_sha256(contract_schema_path),
            "entrypointSourcePath": source_paths[1],
            "entrypointSourceDigest": self.raw_sha256(source_paths[1]),
            "generatorSourcePath": source_paths[2],
            "generatorSourceDigest": self.raw_sha256(source_paths[2]),
        }
        self.write(
            baseline_path,
            json.dumps(baseline, sort_keys=True) + "\n",
        )
        declaration = {
            "path": registry_path,
            "protectedBaseline": baseline_path,
            "protectedBaselineDigest": domain_separated_sha256(
                "pt.acceptance.finalization.protected-baseline.v1",
                baseline,
            ),
            "protectedBaselineFileSha256": self.raw_sha256(baseline_path),
        }
        capability_root = {
            "version": 1,
            "finalizerRegistry": declaration,
            "requiredEvidenceFinalizers": {
                "synthetic-gate": finalizer_id,
            },
            "capabilities": [],
        }
        self.write(
            "tooling/acceptance/capabilities/synthetic.yaml",
            json.dumps(capability_root, sort_keys=True) + "\n",
        )
        gates = {
            "synthetic-gate": {
                "command": "true",
                "evidenceFinalizer": {
                    "id": finalizer_id,
                    "timeoutSeconds": 30,
                    "inputByteLimit": 4096,
                },
            }
        }
        return gates, registry_path

    def test_loads_immutable_exact_binding(self) -> None:
        gates, _ = self.install_valid_contract()

        bindings = REGISTRY.load_finalizer_bindings(
            self.acceptance_root,
            gates,
        )

        binding = bindings["synthetic-gate"]
        self.assertEqual(binding.mapping.gate_id, "synthetic-gate")
        self.assertEqual(
            binding.requirement.protected_baseline_path,
            "synthetic/protected.json",
        )
        self.assertEqual(
            binding.plan_config(),
            {
                "id": "synthetic.finalizer",
                "timeoutSeconds": 30,
                "inputByteLimit": 4096,
            },
        )
        with self.assertRaises(TypeError):
            bindings["other"] = binding

    def test_rejects_dynamic_argv_and_mapping_mismatch(self) -> None:
        gates, _ = self.install_valid_contract()
        gates["synthetic-gate"]["evidenceFinalizer"]["argv"] = ["dynamic"]
        with self.assertRaisesRegex(ValueError, "unknown=.*argv"):
            REGISTRY.load_finalizer_bindings(self.acceptance_root, gates)

        gates, _ = self.install_valid_contract()
        gates["synthetic-gate"]["evidenceFinalizer"]["id"] = "other.finalizer"
        with self.assertRaisesRegex(ValueError, "mapping/config mismatch"):
            REGISTRY.load_finalizer_bindings(self.acceptance_root, gates)

    def test_rejects_imported_native_source_outside_closure(self) -> None:
        gates, _ = self.install_valid_contract()
        self.write("synthetic/finalizer.py", "import synthetic.helper\n")
        self.write("synthetic/helper.so", "synthetic native extension")

        with self.assertRaisesRegex(
            ValueError,
            "forbidden native or bytecode source",
        ):
            REGISTRY.load_finalizer_bindings(self.acceptance_root, gates)

    def test_rejects_import_outside_source_and_stdlib_allowlists(self) -> None:
        gates, _ = self.install_valid_contract()
        self.write("synthetic/finalizer.py", "import requests\n")

        with self.assertRaisesRegex(ValueError, "unsupported import is forbidden"):
            REGISTRY.load_finalizer_bindings(self.acceptance_root, gates)

    def test_rejects_non_python_source_path(self) -> None:
        gates, registry_path = self.install_valid_contract()
        registry_file = self.repo_root / registry_path
        document = json.loads(registry_file.read_text(encoding="utf-8"))
        self.write("synthetic/unbound.json", "{}\n")
        document["entries"][0]["sourcePaths"].append("synthetic/unbound.json")
        document["entries"][0]["sourcePaths"].sort()
        document["entries"][0]["sourceDigest"] = REGISTRY._source_digest(
            self.repo_root,
            tuple(document["entries"][0]["sourcePaths"]),
        )
        registry_file.write_text(
            json.dumps(document, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        self.refresh_protected_registry_binding(registry_path)

        with self.assertRaisesRegex(
            ValueError,
            "sourcePaths contain unsupported non-Python files",
        ):
            REGISTRY.load_finalizer_bindings(self.acceptance_root, gates)

    def test_rejects_unknown_id_invalid_bounds_and_stale_source(self) -> None:
        gates, _ = self.install_valid_contract()
        gates["synthetic-gate"]["evidenceFinalizer"]["timeoutSeconds"] = 61
        with self.assertRaisesRegex(ValueError, "timeoutSeconds"):
            REGISTRY.load_finalizer_bindings(self.acceptance_root, gates)

        gates, _ = self.install_valid_contract()
        self.write("synthetic/finalizer.py", "changed = True\n")
        with self.assertRaisesRegex(ValueError, "sourceDigest"):
            REGISTRY.load_finalizer_bindings(self.acceptance_root, gates)

    def test_rejects_duplicate_ids_roles_sources_and_path_escape(self) -> None:
        gates, registry_path = self.install_valid_contract()
        registry_file = self.repo_root / registry_path
        document = json.loads(registry_file.read_text(encoding="utf-8"))
        document["entries"].append(dict(document["entries"][0]))
        registry_file.write_text(json.dumps(document), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "duplicate finalizer"):
            REGISTRY.load_finalizer_registry(self.repo_root, registry_path)

        for field, value, expected in (
            (
                "evidenceRoleNames",
                ["synthetic.cleanup", "synthetic.cleanup"],
                "duplicates",
            ),
            (
                "sourcePaths",
                ["synthetic/finalizer.py", "synthetic/finalizer.py"],
                "duplicates",
            ),
            (
                "sourcePaths",
                ["../outside.py"],
                "relative",
            ),
        ):
            gates, registry_path = self.install_valid_contract()
            registry_file = self.repo_root / registry_path
            document = json.loads(registry_file.read_text(encoding="utf-8"))
            document["entries"][0][field] = value
            registry_file.write_text(json.dumps(document), encoding="utf-8")
            with self.subTest(field=field, value=value):
                with self.assertRaisesRegex(ValueError, expected):
                    REGISTRY.load_finalizer_registry(
                        self.repo_root,
                        registry_path,
                    )

    def test_rejects_duplicate_json_keys_in_protected_inputs(self) -> None:
        cases = (
            (
                "synthetic/finalizers.json",
                '{"entries":[],"entries":[]}',
                lambda gates: REGISTRY.load_finalizer_bindings(
                    self.acceptance_root,
                    gates,
                ),
            ),
            (
                "synthetic/protected.json",
                '{"gateId":"synthetic-gate","gateId":"synthetic-gate"}',
                lambda gates: REGISTRY.load_finalizer_bindings(
                    self.acceptance_root,
                    gates,
                ),
            ),
            (
                "tooling/acceptance/capabilities/synthetic.yaml",
                '{"capabilities":[],"capabilities":[]}',
                lambda gates: REGISTRY.load_finalizer_bindings(
                    self.acceptance_root,
                    gates,
                ),
            ),
        )
        for path, content, load in cases:
            gates, _ = self.install_valid_contract()
            self.write(path, content)
            with self.subTest(path=path):
                with self.assertRaisesRegex(ValueError, "duplicate key"):
                    load(gates)

    def test_strict_loader_rejects_lossy_json_values(self) -> None:
        path = self.repo_root / "authority.json"
        cases = (
            ('{"value":"\\ud800"}', "non-scalar Unicode"),
            ('{"value":9007199254740992}', "I-JSON safe range"),
            ('{"value":1e-9999}', "lossy number"),
            ('{"value":9007199254740991.5}', "lossy number"),
            ('{"value":9007199254740993.0}', "lossy number"),
        )

        for content, expected in cases:
            path.write_text(content, encoding="utf-8")
            with self.subTest(content=content):
                with self.assertRaisesRegex(ValueError, expected):
                    REGISTRY.load_strict_json_object(
                        path,
                        "authority document",
                    )

        path.write_text('{"duration":0.125}', encoding="utf-8")
        self.assertEqual(
            REGISTRY.load_strict_json_object(
                path,
                "authority document",
            ),
            {"duration": 0.125},
        )

    def test_rejects_entrypoint_that_does_not_match_protected_source(self) -> None:
        gates, registry_path = self.install_valid_contract()
        registry_file = self.repo_root / registry_path
        registry = json.loads(registry_file.read_text(encoding="utf-8"))
        registry["entries"][0]["entrypoint"] = "os"
        registry_file.write_text(
            json.dumps(registry, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        baseline_path = self.repo_root / "synthetic/protected.json"
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        baseline["registryFileDigest"] = self.raw_sha256(registry_path)
        baseline_path.write_text(
            json.dumps(baseline, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        capability_path = (
            self.acceptance_root / "capabilities" / "synthetic.yaml"
        )
        capability = json.loads(capability_path.read_text(encoding="utf-8"))
        capability["finalizerRegistry"]["protectedBaselineDigest"] = (
            domain_separated_sha256(
                "pt.acceptance.finalization.protected-baseline.v1",
                baseline,
            )
        )
        capability["finalizerRegistry"]["protectedBaselineFileSha256"] = (
            self.raw_sha256("synthetic/protected.json")
        )
        capability_path.write_text(
            json.dumps(capability, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(
            ValueError,
            "entrypoint/source path mismatch",
        ):
            REGISTRY.load_finalizer_bindings(self.acceptance_root, gates)

    def test_rejects_dynamic_source_loading(self) -> None:
        for source in (
            'import importlib\nMODULE = importlib.import_module("synthetic.helper")\n',
            'from importlib import import_module as load\n'
            'MODULE = load("synthetic.helper")\n',
            'MODULE = __import__("synthetic.helper")\n',
            'import importlib\n'
            'MODULE = getattr(importlib, "import_module")("synthetic.helper")\n',
            'loader = __import__\nMODULE = loader("synthetic.helper")\n',
            'import runpy\nMODULE = runpy.run_path("synthetic/helper.py")\n',
            'from importlib.machinery import SourceFileLoader\n'
            'MODULE = SourceFileLoader("helper", "synthetic/helper.py")'
            ".load_module()\n",
            'loader = __builtins__["__import__"]\n'
            'MODULE = loader("synthetic.helper")\n',
            'import sys\n'
            'loader = sys.modules["builtins"].__dict__["__import__"]\n'
            'MODULE = loader("synthetic.helper")\n',
            'import operator, sys\n'
            'load = operator.attrgetter("__im" + "port__")'
            '(sys.modules["built" + "ins"])\n'
            'MODULE = load("synthetic.helper")\n',
            'def marker():\n    return None\n'
            'namespace = marker.__globals__\n'
            'load = namespace["__built" + "ins__"]["__im" + "port__"]\n'
            'MODULE = load("synthetic.helper")\n',
            "SUBCLASSES = object.__subclasses__()\n",
        ):
            gates, _ = self.install_valid_contract()
            self.write("synthetic/finalizer.py", source)
            with self.subTest(source=source):
                with self.assertRaisesRegex(
                    ValueError,
                    "dynamic source loading is forbidden",
                ):
                    REGISTRY.load_finalizer_bindings(
                        self.acceptance_root,
                        gates,
                    )

    def test_accepts_imported_repository_source_inside_closure(self) -> None:
        _, registry_path = self.install_valid_contract()
        self.write(
            "synthetic/finalizer.py",
            "from synthetic.helper import finalize_value\n",
        )
        self.write(
            "synthetic/helper.py",
            "def finalize_value(value):\n    return value\n",
        )
        registry_file = self.repo_root / registry_path
        registry_document = json.loads(
            registry_file.read_text(encoding="utf-8")
        )
        source_paths = sorted(
            [
                *registry_document["entries"][0]["sourcePaths"],
                "synthetic/helper.py",
            ]
        )
        registry_document["entries"][0]["sourcePaths"] = source_paths
        registry_document["entries"][0]["sourceDigest"] = (
            REGISTRY._source_digest(
                self.repo_root,
                tuple(source_paths),
            )
        )
        registry_file.write_text(
            json.dumps(registry_document, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        registry = REGISTRY.load_finalizer_registry(
            self.repo_root,
            registry_path,
        )
        self.assertEqual(
            registry.require("synthetic.finalizer").source_paths,
            tuple(source_paths),
        )

    def test_rejects_entrypoint_shadowed_by_package(self) -> None:
        gates, _ = self.install_valid_contract()
        self.write(
            "synthetic/finalizer/__init__.py",
            "def finalize(value):\n    return value\n",
        )

        with self.assertRaisesRegex(ValueError, "shadowed by a package"):
            REGISTRY.load_finalizer_bindings(self.acceptance_root, gates)

    def test_rejects_unprotected_parent_package_initializer(self) -> None:
        gates, _ = self.install_valid_contract()
        self.write("synthetic/__init__.py", "PACKAGE_SIDE_EFFECT = True\n")

        with self.assertRaisesRegex(
            ValueError,
            "package initializer is absent from sourcePaths",
        ):
            REGISTRY.load_finalizer_bindings(self.acceptance_root, gates)

    def test_rejects_imported_repository_source_outside_closure(self) -> None:
        gates, _ = self.install_valid_contract()
        self.write(
            "synthetic/finalizer.py",
            "from synthetic.helper import finalize_value\n",
        )
        self.write(
            "synthetic/helper.py",
            "def finalize_value(value):\n    return value\n",
        )

        with self.assertRaisesRegex(
            ValueError,
            "imported repository source is absent from sourcePaths",
        ):
            REGISTRY.load_finalizer_bindings(self.acceptance_root, gates)
