"""Actual Node delegate execution and material metadata input drift."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.input_owners.metadata_toolchain import (
    COMMAND, GATE_ID, metadata_observation, pnpm_metadata,
)
from tooling.acceptance.input_owners.pnpm_toolchain import pnpm_entry
from tooling.acceptance.input_owners.rust_toolchain import cargo_configurations


class CargoConfigurationInputsTest(unittest.TestCase):
    def test_include_bytes_and_optional_presence_are_material(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "config.toml").write_text(
                'include = [{path = "included.toml"}, '
                '{path = "optional.toml", optional = true}]\n'
            )
            included = root / "included.toml"
            included.write_text('[build]\njobs = 1\n')
            first = cargo_configurations([root])
            metadata = included.stat()
            included.write_text('[build]\njobs = 2\n')
            os.utime(included, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
            second = cargo_configurations([root])
            self.assertNotEqual(first, second)
            (root / "optional.toml").write_text('[build]\njobs = 3\n')
            self.assertNotEqual(second, cargo_configurations([root]))

    def test_required_absence_cycle_and_unknown_include_reject(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / "config.toml"
            for text in (
                'include = [{path = "missing.toml"}]\n',
                'include = [{path = "config.toml"}]\n',
                'include = [{path = "other.toml", executable = true}]\n',
            ):
                config.write_text(text)
                with self.subTest(text=text), self.assertRaises(ValueError):
                    cargo_configurations([root])

    def test_other_gate_command_and_live_runtime_do_not_qualify(self):
        for gate in (
            {"id": "other", "command": COMMAND},
            {"id": GATE_ID, "command": "cargo test"},
            {"id": GATE_ID, "command": COMMAND, "provisioner": "live"},
            {"id": GATE_ID, "command": COMMAND, "ephemeralCapabilities": ["live"]},
        ):
            with self.subTest(gate=gate), patch.dict(
                os.environ, {
                    "NODE_DISABLE_COMPILE_CACHE": "1",
                    "npm_config_manage_package_manager_versions": "false",
                },
            ), self.assertRaises(ValueError):
                metadata_observation(
                    {"gate": gate, "source": {"commit": "source"},
                     "contextDigest": "candidate"}, root=Path.cwd(),
                )


@unittest.skipUnless(os.sys.platform == "darwin" and shutil.which("node"), "macOS Node")
class PnpmMetadataInputsTest(unittest.TestCase):
    def test_real_delegate_output_and_same_size_installation_drift(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / "installed"
            (package / "bin").mkdir(parents=True)
            entry = package / "bin" / "pnpm.cjs"
            entry.write_text(
                "#!/usr/bin/env node\n"
                "if (process.argv[2] === '--version') {\n"
                " require('node:fs').writeSync(1, '9.12.0\\n'); process.exit(0);\n}\n"
                "const value = process.argv[2] === 'config' "
                "? {'manage-package-manager-versions': false} : [];\n"
                "require('node:fs').writeSync(1, JSON.stringify(value));\n"
            )
            entry.chmod(0o755)
            (package / "package.json").write_text(json.dumps({
                "name": "pnpm", "version": "9.12.0", "bin": {"pnpm": "bin/pnpm.cjs"},
            }))
            dependency = package / "dependency.js"
            dependency.write_text("module.exports = 1;\n")
            original_which = shutil.which

            def selected(name, *args, **kwargs):
                return str(entry) if name == "pnpm" else original_which(name, *args, **kwargs)

            with patch("shutil.which", side_effect=selected), patch.dict(
                os.environ, {"NODE_DISABLE_COMPILE_CACHE": "1"},
            ):
                first = pnpm_metadata(root)
                self.assertEqual(first["observations"]["workspace"]["result"], [])
                metadata = dependency.stat()
                dependency.write_text("module.exports = 2;\n")
                os.utime(dependency, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
                second = pnpm_metadata(root)
                self.assertNotEqual(first["installation"], second["installation"])
                self.assertNotEqual(first["delegateInputs"], second["delegateInputs"])
                self.assertEqual(first["observations"], second["observations"])
                entry.write_text("#!/bin/sh\nexec node unknown.js\n")
                with self.assertRaises(ValueError):
                    pnpm_entry()


if __name__ == "__main__":
    unittest.main()
