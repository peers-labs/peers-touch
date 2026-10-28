"""Real Node resolution, transitive installation drift and source-owner limits."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.input_owners.node_toolchain import (
    node_installation, node_source_observation,
)


REPO_ROOT = Path(__file__).resolve().parents[3]


@unittest.skipUnless(os.sys.platform == "darwin" and shutil.which("node"), "macOS Node owner")
class NodeInputOwnerTest(unittest.TestCase):
    def package(self, root: Path, name: str, dependencies=None):
        package = root / "node_modules" / name
        package.mkdir(parents=True)
        (package / "package.json").write_text(json.dumps({
            "name": name, "version": "1.0.0", "main": "index.js",
            "dependencies": dependencies or {},
        }))
        (package / "index.js").write_text("module.exports = 1;\n")
        return package

    def test_real_resolution_binds_transitive_code_and_package_link_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "check.js").write_text("require('fixture-a');\n")
            first = self.package(root, "fixture-a", {"fixture-b": "*"})
            second = self.package(root, "fixture-b")
            imports = [{"origin": "check.js", "name": "fixture-a"}]
            original = node_installation(root, imports)
            self.assertEqual(len(original["packages"]), 2)
            (second / "index.js").write_text("module.exports = 2;\n")
            changed = node_installation(root, imports)
            self.assertNotEqual(original["packages"], changed["packages"])
            replacement = root / "replacement"
            shutil.copytree(first, replacement)
            shutil.rmtree(first)
            first.symlink_to(replacement, target_is_directory=True)
            moved = node_installation(root, imports)
            self.assertNotEqual(changed["resolutions"], moved["resolutions"])

    def test_missing_required_package_and_undeclared_external_link_reject(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "check.js").write_text("require('fixture-a');\n")
            package = self.package(root, "fixture-a", {"fixture-b": "*"})
            imports = [{"origin": "check.js", "name": "fixture-a"}]
            with self.assertRaises(ValueError):
                node_installation(root, imports)
            self.package(root, "fixture-b")
            external = root / "outside.js"
            external.write_text("unowned external code")
            (package / "escaped.js").symlink_to(external)
            with self.assertRaises(ValueError):
                node_installation(root, imports)

    def test_optional_absence_and_newly_installed_package_are_distinct(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "check.js").write_text("require('fixture-a');\n")
            package = self.package(root, "fixture-a")
            manifest = package / "package.json"
            value = json.loads(manifest.read_text())
            value["optionalDependencies"] = {"fixture-b": "*"}
            manifest.write_text(json.dumps(value))
            imports = [{"origin": "check.js", "name": "fixture-a"}]
            absent = node_installation(root, imports)
            self.package(root, "fixture-b")
            present = node_installation(root, imports)
            self.assertNotEqual(absent["resolutions"], present["resolutions"])

    def test_native_package_loader_configuration_and_foreign_origin_reject(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "check.js").write_text("require('fixture-a');\n")
            package = self.package(root, "fixture-a")
            imports = [{"origin": "check.js", "name": "fixture-a"}]
            (package / "addon.node").write_bytes(b"native extension")
            with self.assertRaises(ValueError):
                node_installation(root, imports)
            (package / "addon.node").unlink()
            with patch.dict(os.environ, {"NODE_OPTIONS": "--require=foreign.js"}):
                with self.assertRaises(ValueError):
                    node_installation(root, imports)
            with self.assertRaises(ValueError):
                node_installation(root, [{"origin": "../foreign.js", "name": "fixture-a"}])

    def test_live_equipment_and_unknown_toolchain_do_not_become_source_inputs(self):
        for extra, tools in (
            ({"environment": "live"}, []),
            ({"provisioner": "runtime"}, []),
            ({"requiredRuntimeCells": ["native"]}, []),
            ({"ephemeralCapabilities": ["runtime"]}, []),
            ({}, ["cargo"]),
            ({}, ["pnpm"]),
        ):
            with self.subTest(extra=extra, tools=tools), self.assertRaises(ValueError):
                node_source_observation(
                    "source", {"gate": {"id": "source", **extra},
                               "source": {"commit": "source"}, "contextDigest": "candidate"},
                    root=REPO_ROOT, tools=tools, imports=[],
                )


if __name__ == "__main__":
    unittest.main()
