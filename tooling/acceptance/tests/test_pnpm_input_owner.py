"""Actual Node execution for installed pnpm delegation and input drift."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.input_owners.pnpm_toolchain import pnpm_installation


@unittest.skipUnless(os.sys.platform == "darwin" and shutil.which("node"), "macOS Node")
class PnpmInputOwnerTest(unittest.TestCase):
    def package(self, directory: Path, version: str, child: Path | None = None) -> Path:
        (directory / "bin").mkdir(parents=True)
        (directory / "dist").mkdir()
        manifest = {"name": "pnpm", "version": version, "bin": {"pnpm": "bin/pnpm.cjs"}}
        (directory / "package.json").write_text(json.dumps(manifest))
        entry = directory / "bin/pnpm.cjs"
        entry.write_text("#!/usr/bin/env node\nrequire('../dist/pnpm.cjs');\n")
        entry.chmod(0o755)
        delegate = ""
        if child is not None:
            delegate = (
                "if (process.env.npm_config_manage_package_manager_versions !== 'false') {\n"
                f" const result = require('node:child_process').spawnSync({json.dumps(str(child))}, "
                "process.argv.slice(2), {stdio:'inherit',env:{...process.env,"
                "npm_config_manage_package_manager_versions:'false'}});\n"
                " process.exit(result.status ?? 1);\n}\n"
            )
        (directory / "dist/pnpm.cjs").write_text(
            delegate +
            "const result = process.argv[2] === '--version' "
            f"? {json.dumps(version)} : JSON.stringify({{'manage-package-manager-versions':"
            "process.env.npm_config_manage_package_manager_versions !== 'false'});\n"
            "require('node:fs').writeSync(1, result + '\\n');\n"
        )
        return entry

    def test_actual_delegate_chain_binds_each_installation_and_resolution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            wanted = root / "pnpm-home/.tools/pnpm/9.12.0/bin/pnpm"
            wanted.parent.mkdir(parents=True)
            child = self.package(root / "child", "9.12.0")
            wanted.symlink_to(child)
            parent = self.package(root / "parent", "10.25.0", wanted)
            (root / "package.json").write_text('{"packageManager":"pnpm@9.12.0"}')
            original_which = shutil.which

            def selected(name, *args, **kwargs):
                return str(parent) if name == "pnpm" else original_which(name, *args, **kwargs)

            with patch("shutil.which", side_effect=selected), patch.dict(os.environ, {
                "NODE_DISABLE_COMPILE_CACHE": "1", "NODE_OPTIONS": "",
                "PNPM_HOME": str(root / "pnpm-home"),
                "npm_config_manage_package_manager_versions": "",
            }):
                original = pnpm_installation(root)
                self.assertEqual(original["runs"]["version"]["result"], "9.12.0")
                self.assertEqual(
                    [value["entry"] for value in original["runs"]["version"]["processes"]],
                    [str(child.resolve()), str(parent.resolve())],
                )
                self.assertEqual(len(original["installations"]), 2)
                self.assertTrue(all(
                    value["optionalCache"] == {"absent": True}
                    for value in original["runs"]["version"]["processes"]
                ))
                code = child.parent.parent / "unused.js"
                code.write_text("module.exports = 1;\n")
                first = pnpm_installation(root)
                metadata = code.stat()
                code.write_text("module.exports = 2;\n")
                os.utime(code, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
                second = pnpm_installation(root)
                self.assertNotEqual(first["installations"], second["installations"])
                self.assertEqual(first["runs"], second["runs"])
                wanted.unlink()
                with self.assertRaises(ValueError):
                    pnpm_installation(root)

    def test_nested_project_uses_its_actual_workspace_package_manager(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            child = self.package(root / "child", "9.12.0")
            wanted = root / "pnpm-home/.tools/pnpm/9.12.0/bin/pnpm"
            wanted.parent.mkdir(parents=True)
            wanted.symlink_to(child)
            parent = self.package(root / "parent", "10.25.0", wanted)
            (root / "pnpm-workspace.yaml").write_text("packages:\n  - apps/*\n")
            (root / "package.json").write_text('{"packageManager":"pnpm@9.12.0"}')
            project = root / "apps/desktop"
            project.mkdir(parents=True)
            (project / "package.json").write_text('{"name":"desktop","version":"1.0.0"}')
            original_which = shutil.which

            def selected(name, *args, **kwargs):
                return str(parent) if name == "pnpm" else original_which(name, *args, **kwargs)

            with patch("shutil.which", side_effect=selected), patch.dict(os.environ, {
                "NODE_DISABLE_COMPILE_CACHE": "1", "NODE_OPTIONS": "",
                "PNPM_HOME": str(root / "pnpm-home"),
                "npm_config_manage_package_manager_versions": "",
                "NPM_CONFIG_WORKSPACE_DIR": "", "npm_config_workspace_dir": "",
            }):
                value = pnpm_installation(project)
                self.assertEqual(value["runs"]["version"]["result"], "9.12.0")
                self.assertEqual(len(value["installations"]), 2)
                self.assertIn(str(child.resolve()), value["installations"])
                self.assertEqual(
                    value["projectSelection"]["manifest"], str(root / "package.json"),
                )
                with patch.dict(os.environ, {"NPM_CONFIG_WORKSPACE_DIR": str(root)}):
                    with self.assertRaisesRegex(ValueError, "workspace origin"):
                        pnpm_installation(project)
                (project / "pnpm-workspace.yml").write_text("packages: []")
                with self.assertRaisesRegex(ValueError, "workspace manifest"):
                    pnpm_installation(project)

    def test_cache_hooks_loader_and_unqualified_selection_reject(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            entry = self.package(root / "installed", "9.12.0")
            (root / "package.json").write_text('{"packageManager":"pnpm@9.12.0"}')
            original_which = shutil.which

            def selected(name, *args, **kwargs):
                return str(entry) if name == "pnpm" else original_which(name, *args, **kwargs)

            with patch("shutil.which", side_effect=selected), patch.dict(os.environ, {
                "NODE_DISABLE_COMPILE_CACHE": "1", "NODE_OPTIONS": "",
                "npm_config_manage_package_manager_versions": "false",
            }):
                self.assertEqual(
                    len(pnpm_installation(root)["runs"]["version"]["processes"]), 1,
                )
                cache = root / "installed/node_modules/v8-compile-cache"
                cache.mkdir(parents=True)
                (cache / "index.js").write_text("module.exports = {};\n")
                with self.subTest(kind="optional-cache-present"), self.assertRaises(ValueError):
                    pnpm_installation(root)
                shutil.rmtree(cache)
                (root / ".pnpmfile.cjs").write_text("module.exports = {};\n")
                with self.subTest(kind="implicit-hook"), self.assertRaises(ValueError):
                    pnpm_installation(root)
                (root / ".pnpmfile.cjs").unlink()
                for key, value in (
                    ("NODE_OPTIONS", "--require=outside.js"),
                    ("NODE_DISABLE_COMPILE_CACHE", ""),
                ):
                    with self.subTest(kind=key), patch.dict(os.environ, {key: value}):
                        with self.assertRaises(ValueError):
                            pnpm_installation(root)
                (root / "package.json").write_text('{"packageManager":"pnpm@latest"}')
                with self.subTest(kind="non-exact-version"), self.assertRaises(ValueError):
                    pnpm_installation(root)


if __name__ == "__main__":
    unittest.main()
