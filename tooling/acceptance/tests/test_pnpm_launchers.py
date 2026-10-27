"""Real installed launcher environment and rejection boundary checks."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.input_owners import pnpm_launchers as owner
from tooling.acceptance.input_owners.installed_inputs import executable_input


class PnpmLaunchersTest(unittest.TestCase):
    def fixture(self, root: Path) -> tuple[Path, Path]:
        package = root / "node_modules/tool"
        (package / "bin").mkdir(parents=True)
        manifest = package / "package.json"
        manifest.write_text(json.dumps({
            "name": "tool", "version": "1.0.0", "bin": {"tool": "bin/tool.cjs"},
        }))
        entry = package / "bin/tool.cjs"
        entry.write_text(
            "#!/usr/bin/env node\n"
            f"require('node:fs').writeFileSync({json.dumps(str(root / 'tool-executed'))},'ran');\n"
        )
        launcher = root / "node_modules/.bin/tool"
        launcher.parent.mkdir()
        launcher.write_text(owner.TEMPLATE.format(
            node_path=str(root / "lookup"), entry="../tool/bin/tool.cjs",
        ))
        launcher.chmod(0o755)
        return launcher, entry

    def test_launcher_entry_content_drift_and_unknown_template_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            launcher, entry = self.fixture(root)
            first = owner.launcher_entry(launcher, "tool")
            self.assertEqual(first[0], entry)
            self.assertEqual(first[1]["localNode"], "absent")
            metadata = entry.stat()
            entry.write_text(entry.read_text().replace("'ran'", "'run'"))
            os.utime(entry, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
            second = owner.launcher_entry(launcher, "tool")
            self.assertNotEqual(first[1]["entryBytes"], second[1]["entryBytes"])
            text = launcher.read_text()
            for name, changed in {
                "extra-command": text + "touch marker\n",
                "relative-search": text.replace(str(root / "lookup"), "relative"),
                "shell-substitution": text.replace(str(root / "lookup"), "$(touch marker)"),
                "shell-variable": text.replace(str(root / "lookup"), "$HOME/lookup"),
                "changed-entry": text.replace('exec node  "', 'exec node  --require outside "'),
            }.items():
                launcher.write_text(changed)
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, "template"):
                    owner.launcher_entry(launcher, "tool")
            launcher.write_text(text)
            (entry.parent.parent / "package.json").write_text('{"bin":{"tool":"other.js"}}')
            with self.assertRaises(FileNotFoundError):
                owner.launcher_entry(launcher, "tool")
            self.assertFalse((root / "marker").exists())

    def test_search_root_preserves_absence_links_and_lookup_drift(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            search = root / "search"
            self.assertEqual(owner.search_root(search), {"state": "absent"})
            search.mkdir()
            package = root / "package"
            package.mkdir()
            scope = search / "@scope"
            scope.mkdir()
            link = scope / "package"
            link.symlink_to(package)
            broken = search / "broken"
            broken.symlink_to(root / "missing")
            code = search / "legacy.js"
            code.write_text("first")
            first = owner.search_root(search)
            self.assertEqual(first["entries"]["@scope/package"]["selection"]["resolved"], str(package))
            self.assertEqual(first["entries"]["broken"]["brokenLink"], str(root / "missing"))
            metadata = code.stat()
            code.write_text("other")
            os.utime(code, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
            second = owner.search_root(search)
            self.assertNotEqual(first, second)
            (root / "missing").mkdir()
            self.assertNotEqual(second, owner.search_root(search))
            link.unlink()
            link.symlink_to(root / "missing")
            self.assertNotEqual(first, owner.search_root(search))
            with self.assertRaisesRegex(ValueError, "directory"):
                owner.search_root(code)

    @unittest.skipUnless(os.sys.platform == "darwin" and shutil.which("node") and shutil.which("pnpm"), "macOS Node/pnpm")
    def test_actual_launcher_environment_stops_before_tool_and_rejects_drift(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            launcher, entry = self.fixture(root)
            (root / "package.json").write_text('{"name":"fixture","version":"1.0.0"}')
            installation = {"node": executable_input("node")}
            with patch.dict(os.environ, {
                "NODE_DISABLE_COMPILE_CACHE": "1", "NODE_OPTIONS": "", "NODE_PATH": "",
            }):
                value = owner.pnpm_launcher_inputs(root, ("tool",), installation)
                self.assertEqual(value["qualification"], "LAUNCHER_ENVIRONMENT_INPUTS_ONLY")
                self.assertEqual(value["bins"]["tool"]["runtime"]["entry"], str(entry))
                self.assertEqual(value["bins"]["tool"]["runtime"]["nodePath"], str(root / "lookup"))
                self.assertIn(str(root / "lookup"), value["searchRoots"])
                self.assertFalse((root / "tool-executed").exists())
                original = owner.search_root
                calls = 0

                def changing(path):
                    nonlocal calls
                    calls += 1
                    if calls == 1:
                        launcher.write_text(launcher.read_text() + "\n")
                    return original(path)

                with patch.object(owner, "search_root", side_effect=changing):
                    with self.assertRaisesRegex(ValueError, "template"):
                        owner.pnpm_launcher_inputs(root, ("tool",), installation)
                self.assertGreater(calls, 0)
                for names in ((), ("tool", "tool"), ("../tool",)):
                    with self.subTest(names=names), self.assertRaises(ValueError):
                        owner.pnpm_launcher_inputs(root, names, installation)
                for key, changed in (("NODE_OPTIONS", "--require=foreign"), ("NODE_PATH", "foreign")):
                    with self.subTest(key=key), patch.dict(os.environ, {key: changed}):
                        with self.assertRaisesRegex(ValueError, "closed Node"):
                            owner.pnpm_launcher_inputs(root, ("tool",), installation)
                self.assertFalse((root / "tool-executed").exists())


if __name__ == "__main__":
    unittest.main()
