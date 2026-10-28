"""Installed project byte drift and fail-closed actual resolution contracts."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.input_owners import pnpm_project as owner
from tooling.acceptance.input_owners.installed_inputs import executable_input


class PnpmProjectTest(unittest.TestCase):
    def test_dependency_paths_preserve_versions_and_reject_wrong_inventory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            first, second = str(root / "first"), str(root / "second")
            inventory = [{
                "path": str(root), "dependencies": {
                    "package": {"path": first, "dependencies": {
                        "package": {"path": second},
                    }},
                },
            }]
            self.assertEqual(owner.dependency_paths(inventory, root), {
                first: "package", second: "package",
            })
            for name, value in {
                "missing": [],
                "wrong-project": [{"path": str(root.parent)}],
                "section": [{"path": str(root), "dependencies": []}],
                "no-location": [{"path": str(root), "dependencies": {"package": {}}}],
                "relative": [{"path": str(root), "dependencies": {"package": {"path": "a"}}}],
                "conflict": [{
                    "path": str(root), "dependencies": {
                        "first": {"path": first}, "second": {"path": first},
                    },
                }],
            }.items():
                with self.subTest(name=name), self.assertRaises(ValueError):
                    owner.dependency_paths(value, root)

    def test_project_command_retains_actual_chain_and_rejects_another_delegate(self):
        process = {
            "entry": "/installed/pnpm", "executable": "/installed/node",
            "versions": {"node": "1"}, "architecture": "arm64", "platform": "darwin",
        }
        installation = {
            "node": {"path": "/installed/node"},
            "runs": {"configuration": {"processes": [process]}},
        }
        with patch.object(owner, "pnpm_entry", return_value=(Path("/installed/pnpm"), Path("/installed"))):
            with patch.object(owner, "observe_command", return_value=('{"value":1}', [process])):
                self.assertEqual(
                    owner.project_command(["config", "list", "--json"], Path.cwd(), installation),
                    {"value": 1},
                )
            changed = {**process, "entry": "/another/pnpm"}
            with patch.object(owner, "observe_command", return_value=("{}", [changed])):
                with self.assertRaisesRegex(ValueError, "another installed delegate"):
                    owner.project_command(["config", "list", "--json"], Path.cwd(), installation)
            with patch.object(owner, "observe_command", return_value=("/installed/package", [process])):
                self.assertEqual(owner.project_command(
                    ["list", "--parseable"], Path.cwd(), installation, json_output=False,
                ), "/installed/package")

    def test_dependency_links_bind_optional_absence_and_reject_foreign_resolution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            package = root / "package"
            package.mkdir()
            dependency = root / "dependency"
            dependency.mkdir()
            (dependency / "package.json").write_text('{"name":"dependency","version":"1.0.0"}')
            manifest = {
                "dependencies": {"dependency": "1"},
                "optionalDependencies": {"optional": "1"},
            }
            link = package / "node_modules/dependency"
            link.parent.mkdir()
            link.symlink_to(dependency)
            value = owner.dependency_links(package, manifest, {dependency})
            self.assertEqual(value["dependency"]["target"], str(dependency))
            self.assertIsNone(value["optional"]["target"])
            with self.assertRaisesRegex(ValueError, "outside"):
                owner.dependency_links(package, manifest, set())
            link.unlink()
            with self.assertRaisesRegex(ValueError, "required"):
                owner.dependency_links(package, manifest, {dependency})

    @unittest.skipUnless(os.sys.platform == "darwin" and shutil.which("node"), "macOS Node")
    def test_project_content_drift_workspace_gap_and_native_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            package = root / "node_modules/.pnpm/package@1/node_modules/package"
            package.mkdir(parents=True)
            (package / "package.json").write_text('{"name":"package","version":"1.0.0"}')
            code = package / "index.js"
            code.write_text("module.exports=1")
            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / "package.json").write_text('{"name":"workspace","version":"1.0.0"}')
            (workspace / "index.js").write_text("source")
            (workspace / "dist").mkdir()
            (workspace / "dist/generated.js").write_text("first")
            inventory = [{
                "path": str(root), "dependencies": {
                    "package": {"path": str(package)}, "workspace": {"path": str(workspace)},
                },
            }]
            node = executable_input("node")
            installation = {"node": node}
            execution = {
                "cwd": str(root), "path": os.environ["PATH"],
                "execPath": node["resolvedPath"], "libraries": [],
            }
            config = {}

            paths = [str(root), str(package), str(workspace), str(root / "optional-absent")]

            def command(arguments, *args, **kwargs):
                if arguments[0] == "config":
                    return config
                return "\n".join(paths) if "--parseable" in arguments else inventory

            with patch.object(owner, "pnpm_installation", return_value=installation), patch.object(
                owner, "project_command", side_effect=command,
            ), patch.object(
                owner, "pnpm_entry", return_value=(Path(shutil.which("pnpm")), root),
            ), patch.object(
                owner.subprocess, "run",
                return_value=subprocess.CompletedProcess([], 0, json.dumps(execution), ""),
            ):
                first = owner.pnpm_project_inputs(root)
                self.assertEqual(first["qualification"], "INSTALLED_PROJECT_INPUTS_ONLY")
                self.assertEqual(set(first["installedPackages"]), {str(package)})
                self.assertEqual(set(first["workspaceSources"]), {str(workspace)})
                self.assertEqual(first["unavailablePaths"], {str(root / "optional-absent"): "absent"})
                metadata = code.stat()
                code.write_text("module.exports=2")
                os.utime(code, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
                second = owner.pnpm_project_inputs(root)
                self.assertNotEqual(first["installedPackages"], second["installedPackages"])
                (workspace / "dist/generated.js").write_text("other")
                third = owner.pnpm_project_inputs(root)
                self.assertEqual(second["workspaceSources"], third["workspaceSources"])
                escape = package / "escape"
                escape.symlink_to(workspace)
                with self.assertRaisesRegex(ValueError, "escapes"):
                    owner.pnpm_project_inputs(root)
                escape.unlink()
                paths.append(str(package))
                with self.assertRaisesRegex(ValueError, "flat inventory"):
                    owner.pnpm_project_inputs(root)
                paths.pop()
                for name in ("script-shell", "pnpmfile", "use-node-version"):
                    config[name] = "external"
                    with self.subTest(name=name), self.assertRaises(ValueError):
                        owner.pnpm_project_inputs(root)
                    del config[name]
                native = package / "addon.node"
                native.write_bytes(b"\xcf\xfa\xed\xfe")
                with patch.object(owner, "macos_library_inputs", side_effect=ValueError("missing dependency")):
                    with self.assertRaisesRegex(ValueError, "missing dependency"):
                        owner.pnpm_project_inputs(root)


if __name__ == "__main__":
    unittest.main()
