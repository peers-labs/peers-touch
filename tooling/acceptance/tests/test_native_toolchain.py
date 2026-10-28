"""Actual native image observation and SDK input rejection boundaries."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.input_owners import native_toolchain as owner


UUID = "01234567-89AB-CDEF-0123-456789ABCDEF"


@unittest.skipUnless(os.sys.platform == "darwin", "macOS installed tool owner")
class NativeToolchainTest(unittest.TestCase):
    def test_actual_loaded_dependency_content_and_output_are_material(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            library = root / "library.dylib"
            code = root / "library.c"
            source = root / "main.c"
            source.write_text(
                '#include <stdio.h>\nextern int number(void);\n'
                'int main(void) { printf("%d\\n", number()); return 0; }\n'
            )
            binary = root / "tool"

            def compile_library(number):
                code.write_text(f"int number(void) {{ return {number}; }}\n")
                subprocess.run(
                    ["/usr/bin/xcrun", "clang", "-dynamiclib", str(code),
                     "-install_name", str(library), "-o", str(library)],
                    check=True, capture_output=True, timeout=10,
                )

            compile_library(7)
            subprocess.run(
                ["/usr/bin/xcrun", "clang", str(source), str(library), "-o", str(binary)],
                check=True, capture_output=True, timeout=10,
            )
            first = owner.native_tool_observation(binary, [], cwd=root, environment={})
            self.assertEqual(first["output"], "7")
            self.assertIn(str(library), first["images"])
            self.assertEqual(first["images"][str(library)]["resolved"], str(library))
            with self.subTest(identity="first-json-roundtrip"):
                self.assertEqual(json.loads(json.dumps(first)), first)
            compile_library(8)
            second = owner.native_tool_observation(binary, [], cwd=root, environment={})
            self.assertEqual(second["output"], "8")
            with self.subTest(identity="changed-json-roundtrip"):
                self.assertEqual(json.loads(json.dumps(second)), second)
            self.assertNotEqual(
                first["images"][str(library)]["bytes"], second["images"][str(library)]["bytes"],
            )
            with self.assertRaises(subprocess.CalledProcessError):
                library.unlink()
                owner.native_tool_observation(binary, [], cwd=root, environment={})

    def test_image_inventory_rejects_unknown_child_duplicate_and_missing_images(self):
        executable = Path("/usr/bin/true")
        image = f"dyld[1]: <{UUID}> {executable.resolve()}"
        for name, stderr in {
            "unknown": image + "\nunknown stderr",
            "child": image + f"\ndyld[2]: <{UUID}> /usr/lib/libSystem.B.dylib",
            "duplicate": image + "\n" + image,
            "missing-executable": f"dyld[1]: <{UUID}> /usr/lib/libSystem.B.dylib",
            "unknown-delay": image + "\ndyld[1]: move loaded to delayed: unobserved",
        }.items():
            with self.subTest(name=name), patch.object(
                owner.subprocess, "run",
                return_value=subprocess.CompletedProcess([], 0, "", stderr),
            ), self.assertRaises(ValueError):
                owner.native_tool_observation(executable, [], cwd=Path.cwd(), environment={})
        completed = subprocess.CompletedProcess(
            [], 0, "version", image + "\ndyld[1]: move loaded to delayed: true",
        )
        with patch.object(owner.subprocess, "run", return_value=completed):
            value = owner.native_tool_observation(executable, [], cwd=Path.cwd(), environment={})
        self.assertEqual(value["delayedImages"], ["true"])
        self.assertEqual(value["output"], "version")
        with self.assertRaises(ValueError):
            owner.native_tool_observation(
                executable, [], cwd=Path.cwd(), environment={"DYLD_INSERT_LIBRARIES": "unknown"},
            )

    def test_sdk_and_compiler_resource_drift_invalidate_installed_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            sdk = root / "sdk"
            sdk.mkdir()
            header = sdk / "header.h"
            header.write_text("version1")
            tools = root / "usr"
            for name in ("bin", "lib", "include"):
                (tools / name).mkdir(parents=True)
            resource = tools / "lib/clang"
            resource.mkdir()
            builtins = resource / "builtins.h"
            builtins.write_text("first")
            for name in ("clang", "clang++", "ar", "ranlib", "ld"):
                (tools / "bin" / name).write_text("installed")

            def select(arguments, **kwargs):
                if arguments[-1] == "--show-sdk-path":
                    return str(sdk)
                if arguments[-1] == "--show-sdk-version":
                    return "1.0"
                return str(tools / "bin" / arguments[-1])

            def binary(name):
                return {"resolvedPath": str(Path(name).resolve()), "path": str(name)}

            with patch.object(owner, "native_selection", side_effect=select), patch.object(
                owner, "executable_input", side_effect=binary,
            ), patch.object(
                owner, "native_tool_observation",
                side_effect=lambda path, *a, **kw: {"executable": binary(path)},
            ), patch.object(
                owner.subprocess, "run",
                return_value=subprocess.CompletedProcess([], 0, str(resource), ""),
            ):
                first = owner.macos_sdk_installation(root, {})
                metadata = header.stat()
                header.write_text("version2")
                os.utime(header, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
                second = owner.macos_sdk_installation(root, {})
                self.assertNotEqual(first["sdk"]["bytes"], second["sdk"]["bytes"])
                builtins.write_text("other")
                third = owner.macos_sdk_installation(root, {})
                self.assertNotEqual(second["toolchain"], third["toolchain"])
                with self.assertRaises(ValueError):
                    owner.macos_sdk_installation(root, {"SDKROOT": str(root)})
                with self.assertRaises(ValueError):
                    owner.macos_sdk_installation(root, {"SDKROOT": "macosx"})
            json.dumps(first)


if __name__ == "__main__":
    unittest.main()
