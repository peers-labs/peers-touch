"""Installed rustup delegation, compiler bytes and selection failures."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.input_owners import rust_toolchain as owner
from tooling.acceptance.input_owners.installed_inputs import file_digest


@unittest.skipUnless(os.sys.platform == "darwin", "macOS installed compiler owner")
class RustToolchainTest(unittest.TestCase):
    def test_existing_delegates_and_full_installation_changes_are_material(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            cwd = root / "source"
            cwd.mkdir()
            rustup = root / "rustup"
            rustup.write_bytes(b"resolver")
            installation = root / "installed"
            for name in ("bin", "lib", "libexec", "etc"):
                (installation / name).mkdir(parents=True)
            library = installation / "lib/compiler"
            library.write_bytes(b"first")
            for name in ("cargo", "rustc"):
                (installation / "bin" / name).write_bytes(name.encode())
            home = root / "rustup-home"
            home.mkdir()
            (home / "settings.toml").write_text('default_toolchain = "stable"\n')
            environment = {"PATH": "/controlled", "RUSTUP_HOME": str(home), "CARGO_HOME": str(root / "cargo")}
            calls = []

            def selected(name, **kwargs):
                self.assertEqual(kwargs["path"], environment["PATH"])
                return str(rustup)

            def executable(name):
                return {"path": str(name), "resolvedPath": str(Path(name).resolve())}

            def command(arguments, **kwargs):
                calls.append((arguments, kwargs))
                if arguments[1:] == ["show", "active-toolchain"]:
                    output = "stable (default)"
                elif arguments[1] == "which":
                    output = str(installation / "bin" / arguments[-1])
                elif arguments[1:] == ["--print", "sysroot"]:
                    output = str(installation)
                else:
                    raise AssertionError(arguments)
                return subprocess.CompletedProcess(arguments, 0, output, "")

            def image(path, *args, **kwargs):
                self.assertEqual(kwargs["environment"]["RUSTUP_AUTO_INSTALL"], "0")
                return {"executable": executable(path), "bytes": file_digest(Path(path))}

            with patch.object(owner.shutil, "which", side_effect=selected), patch.object(
                owner, "executable_input", side_effect=executable,
            ), patch.object(owner.subprocess, "run", side_effect=command), patch.object(
                owner, "native_tool_observation", side_effect=image,
            ):
                first = owner.rust_installation(cwd, environment)
                metadata = library.stat()
                library.write_bytes(b"other")
                os.utime(library, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
                second = owner.rust_installation(cwd, environment)
                self.assertNotEqual(first["installation"], second["installation"])
                (cwd / "rust-toolchain.toml").write_text('[toolchain]\nchannel = "stable"\n')
                third = owner.rust_installation(cwd, environment)
                self.assertNotEqual(second["selectionFiles"], third["selectionFiles"])
                self.assertEqual(first["activeToolchain"], "stable (default)")
                with self.assertRaises(ValueError):
                    owner.rust_installation(cwd, {**environment, "RUSTUP_HOME": "relative"})
                with patch.object(
                    owner, "native_tool_observation",
                    return_value={"executable": executable(root / "outside")},
                ), self.assertRaises(ValueError):
                    owner.rust_installation(cwd, environment)
            self.assertTrue(calls)
            self.assertTrue(all(
                kwargs["env"]["RUSTUP_AUTO_INSTALL"] == "0" and kwargs["timeout"] == 2
                and kwargs["cwd"] == cwd
                for _, kwargs in calls
            ))
            self.assertNotIn("RUSTUP_AUTO_INSTALL", environment)

    def test_unknown_missing_and_failed_tool_selection_cannot_qualify(self):
        with tempfile.TemporaryDirectory() as temporary:
            cwd = Path(temporary)
            with patch.object(owner.shutil, "which", return_value=None), self.assertRaises(ValueError):
                owner.rust_installation(cwd, {})
            for failure in (
                subprocess.TimeoutExpired("rustup", 2),
                subprocess.CalledProcessError(1, "rustup"),
                PermissionError("rustup"),
            ):
                with self.subTest(failure=type(failure).__name__), patch.object(
                    owner.shutil, "which", return_value="/usr/bin/true",
                ), patch.object(owner.subprocess, "run", side_effect=failure), self.assertRaises(
                    type(failure),
                ):
                    owner.rust_installation(cwd, {})


if __name__ == "__main__":
    unittest.main()
