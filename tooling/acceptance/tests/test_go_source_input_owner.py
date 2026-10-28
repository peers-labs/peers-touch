"""Go input drift and material boundary rejection without building a product."""

from __future__ import annotations

import copy
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.input_owners.go_source_toolchain import (
    COMMAND, GATE_ID, go_source_observation, package_inputs,
)


class GoSourceInputsTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.parent = Path(temporary.name).resolve()
        self.root = self.parent / "repo"
        self.goroot = self.parent / "go"
        self.cache = self.parent / "modules"
        for path in (self.root / "main", self.goroot / "src/fmt", self.cache / "yaml"):
            path.mkdir(parents=True)
            (path / "input.go").write_text("package a\nvar Value = 1\n")
        (self.cache / "yaml/go.mod").write_text("module yaml\n")
        self.records = [
            {"ImportPath": "main", "Dir": str(self.root / "main"),
             "GoFiles": ["input.go"], "Module": {"Main": True}},
            {"ImportPath": "fmt", "Dir": str(self.goroot / "src/fmt"),
             "GoFiles": ["input.go"], "Standard": True},
            {"ImportPath": "yaml", "Dir": str(self.cache / "yaml"),
             "GoFiles": ["input.go"], "Module": {
                 "Dir": str(self.cache / "yaml"), "GoMod": str(self.cache / "yaml/go.mod"),
                 "Version": "v1.0.0", "Sum": "installed-module-sum",
             }},
        ]

    def observe(self, records=None):
        return package_inputs(
            self.records if records is None else records, root=self.root,
            goroot=self.goroot, module_cache=self.cache,
        )

    def test_standard_and_module_same_size_restored_mtime_bytes_are_material(self):
        for path in (self.goroot / "src/fmt/input.go", self.cache / "yaml/input.go"):
            first = self.observe()
            metadata = path.stat()
            path.write_text(path.read_text().replace("1", "2"))
            os.utime(path, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
            self.assertNotEqual(first, self.observe())

    def test_module_manifest_and_new_installed_file_are_material(self):
        first = self.observe()
        (self.cache / "yaml/go.mod").write_text("module other\n")
        second = self.observe()
        self.assertNotEqual(first, second)
        (self.cache / "yaml/additional.go").write_text("package a\n")
        self.assertNotEqual(second, self.observe())

    def test_duplicate_incomplete_cgo_and_native_object_are_rejected(self):
        for change in (
            {"Error": {"Err": "unresolved"}}, {"DepsErrors": [{"Err": "unresolved"}]},
            {"Incomplete": True}, {"CgoFiles": ["native.go"]}, {"SysoFiles": ["native.syso"]},
        ):
            records = copy.deepcopy(self.records)
            records[0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.observe(records)
        with self.assertRaises(ValueError):
            self.observe([*self.records, self.records[0]])

    def test_external_workspace_replacement_and_standard_escape_reject(self):
        changes = (
            (0, {"Dir": str(self.parent)}),
            (1, {"Dir": str(self.root / "main")}),
            (2, {"Module": {"Replace": {"Dir": str(self.root)}}}),
            (2, {"Module": {"Dir": str(self.root), "Version": "v1", "Sum": "sum"}}),
        )
        for index, change in changes:
            records = copy.deepcopy(self.records)
            records[index].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.observe(records)

    def test_external_link_and_relative_escape_reject(self):
        linked = self.goroot / "src/fmt/input.go"
        linked.unlink()
        linked.symlink_to(self.root / "main/input.go")
        with self.assertRaises(ValueError):
            self.observe()
        records = copy.deepcopy(self.records)
        records[0]["GoFiles"] = ["../outside.go"]
        with self.assertRaises(ValueError):
            self.observe(records)

    def test_foreign_command_and_product_equipment_reject_before_tool_probe(self):
        gates = [
            {"id": "other", "command": COMMAND},
            {"id": GATE_ID, "command": "go test ./..."},
            {"id": GATE_ID, "command": COMMAND, "provisioner": "live"},
            {"id": GATE_ID, "command": COMMAND, "requiredRuntimeCells": ["native"]},
            {"id": GATE_ID, "command": COMMAND, "ephemeralCapabilities": ["socket"]},
        ]
        with patch(
            "tooling.acceptance.input_owners.go_source_toolchain.go_installation",
            side_effect=AssertionError("must reject before installed input observation"),
        ):
            for gate in gates:
                with self.subTest(gate=gate), self.assertRaises(ValueError):
                    go_source_observation({
                        "gate": gate, "source": {"commit": "source"}, "contextDigest": "candidate",
                    }, root=self.root)

    def test_catalog_uses_the_exact_qualified_command_and_original_probe_budget(self):
        import json
        from tooling.acceptance.input_owners.go_source_toolchain import OWNER_ID

        catalog = Path(__file__).resolve().parents[1] / "gates.yaml"
        gate = json.loads(catalog.read_text())["gates"][GATE_ID]
        self.assertEqual(gate["command"], COMMAND)
        self.assertEqual(gate["timeout_seconds"], 120)
        self.assertEqual(gate["executionInputs"], {
            "environmentKeys": ["GOPATH", "GOMODCACHE"],
            "identityProbe": {
                "ownerId": OWNER_ID,
                "argv": ["python3", "-B", "-m",
                         "tooling.acceptance.input_owners.go_source_toolchain", "--gate", GATE_ID],
                "timeoutSeconds": 10,
            },
        })


if __name__ == "__main__":
    unittest.main()
