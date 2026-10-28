"""Installed input identity, bounded readers and synchronous failure cleanup."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from tooling.acceptance.core.execution_budget import digest
from tooling.acceptance.input_owners import installed_inputs


class InstalledInputsTest(unittest.TestCase):
    def test_tree_digest_preserves_bytes_modes_links_references_and_exclusions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "node_modules"
            root.mkdir(mode=0o700)
            code = root / "a.js"
            code.write_bytes(b"installed-code")
            code.chmod(0o640)
            (root / "b.js").symlink_to("a.js")
            for name in (".vite", ".vitest", "excluded"):
                child = root / name
                child.mkdir()
                (child / "output").write_text("outside material closure")
            expected = digest({
                "entries": {
                    "a.js": digest({
                        "bytes": hashlib.sha256(b"installed-code").hexdigest(), "mode": 0o640,
                    }),
                    "b.js": digest({
                        "link": "a.js",
                        "target": digest({"reference": str(code.resolve())}), "mode": 0o640,
                    }),
                },
                "mode": root.stat().st_mode & 0o777,
            })
            options = {"excluded_children": frozenset({"excluded"})}
            self.assertEqual(installed_inputs.tree_digest(root, **options), expected)
            before = code.stat()
            code.write_bytes(b"changed---code")
            os.utime(code, ns=(before.st_atime_ns, before.st_mtime_ns))
            changed = installed_inputs.tree_digest(root, **options)
            self.assertNotEqual(changed, expected)
            code.chmod(0o600)
            self.assertNotEqual(installed_inputs.tree_digest(root, **options), changed)

    def test_tree_digest_reads_all_content_with_four_readers_and_eight_pending_tasks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index in range(320):
                (root / f"{index:03}").write_bytes(bytes([index % 256]) * (index + 1))
            release, four_readers, eight_tasks = (
                threading.Event(), threading.Event(), threading.Event(),
            )
            lock = threading.Lock()
            counts = {"active": 0, "peak": 0, "pending": 0, "pendingPeak": 0}
            observed, output = {}, {}
            real_read = installed_inputs.file_digest

            def read(path):
                with lock:
                    counts["active"] += 1
                    counts["peak"] = max(counts["peak"], counts["active"])
                    if counts["active"] == 4:
                        four_readers.set()
                try:
                    if not release.wait(2):
                        raise RuntimeError("test reader release unavailable")
                    value = real_read(path)
                    with lock:
                        observed[path.name] = value
                    return value
                finally:
                    with lock:
                        counts["active"] -= 1

            class FutureResult:
                def __init__(self, future):
                    self.future = future

                def result(self):
                    try:
                        return self.future.result()
                    finally:
                        with lock:
                            counts["pending"] -= 1

            class ObservedExecutor(ThreadPoolExecutor):
                def submit(self, *args, **kwargs):
                    with lock:
                        counts["pending"] += 1
                        counts["pendingPeak"] = max(counts["pendingPeak"], counts["pending"])
                        if counts["pending"] == 8:
                            eight_tasks.set()
                    return FutureResult(super().submit(*args, **kwargs))

            def observe():
                try:
                    output["digest"] = installed_inputs.tree_digest(root)
                except BaseException as error:
                    output["error"] = error

            with patch.object(installed_inputs, "file_digest", side_effect=read), patch.object(
                installed_inputs, "ThreadPoolExecutor", ObservedExecutor,
            ):
                caller = threading.Thread(target=observe)
                caller.start()
                try:
                    self.assertTrue(four_readers.wait(1), "independent file reads must overlap")
                    self.assertTrue(eight_tasks.wait(1), "bounded submission must fill its window")
                finally:
                    release.set()
                    caller.join(3)
            self.assertFalse(caller.is_alive())
            self.assertNotIn("error", output)
            self.assertEqual(counts, {
                "active": 0, "peak": 4, "pending": 0, "pendingPeak": 8,
            })
            self.assertEqual(observed, {
                f"{index:03}": hashlib.sha256(bytes([index % 256]) * (index + 1)).hexdigest()
                for index in range(320)
            })
            self.assertEqual(output["digest"], installed_inputs.tree_digest(root))
            self.assertFalse(any(
                thread.name.startswith("installed-input") for thread in threading.enumerate()
            ))

    def test_tree_digest_rejects_failed_reads_links_and_resources_without_reader_leaks(self):
        class ObservationCancelled(BaseException):
            pass

        for kind in ("read-error", "cancel", "escaped-link", "broken-link", "fifo"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / "installation"
                root.mkdir()
                (root / "a").write_bytes(b"material")
                outside = root.parent / "outside"
                outside.write_bytes(b"undeclared")
                if kind == "escaped-link":
                    (root / "z").symlink_to(outside)
                elif kind == "broken-link":
                    (root / "z").symlink_to("missing")
                elif kind == "fifo":
                    os.mkfifo(root / "z")
                expected = {
                    "read-error": PermissionError, "cancel": ObservationCancelled,
                    "escaped-link": ValueError, "broken-link": FileNotFoundError,
                    "fifo": ValueError,
                }[kind]
                real_read = installed_inputs.file_digest

                def read(path):
                    if kind in {"read-error", "cancel"}:
                        raise expected("read did not complete")
                    return real_read(path)

                with patch.object(installed_inputs, "file_digest", side_effect=read):
                    with self.assertRaises(expected):
                        installed_inputs.tree_digest(root)
                self.assertFalse(any(
                    thread.name.startswith("installed-input") for thread in threading.enumerate()
                ))

    def test_tree_digest_accepts_only_the_explicit_external_regular_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "installation"
            root.mkdir()
            external = root.parent / "framework"
            external.write_bytes(b"framework-code")
            (root / "framework").symlink_to(external)
            with self.assertRaises(ValueError):
                installed_inputs.tree_digest(root)
            allowed = frozenset({external.resolve()})
            first = installed_inputs.tree_digest(root, linked_files=allowed)
            external.write_bytes(b"changed-framework")
            self.assertNotEqual(first, installed_inputs.tree_digest(root, linked_files=allowed))
            (root / "directory").symlink_to(root.parent)
            with self.assertRaises(ValueError):
                installed_inputs.tree_digest(root, linked_files=allowed | {root.parent})
            with self.assertRaises(ValueError):
                installed_inputs.tree_digest(root / "missing")

    @unittest.skipUnless(os.sys.platform == "darwin", "Mach-O library input owner")
    def test_macos_library_inputs_distinguish_self_id_and_actual_dependencies(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "fixture.c"
            source.write_text("int fixture(void) { return 1; }\n")
            dependency = root / "dependency.dylib"
            subprocess.run(
                ["/usr/bin/xcrun", "clang", "-dynamiclib", str(source),
                 "-install_name", str(dependency), "-o", str(dependency)],
                check=True, capture_output=True, timeout=10,
            )
            source.write_text(
                "extern int fixture(void);\nint client(void) { return fixture(); }\n"
            )
            client = root / "client.dylib"
            subprocess.run(
                ["/usr/bin/xcrun", "clang", "-dynamiclib", str(source),
                 str(dependency), "-install_name", str(root / "producer-only-id"),
                 "-o", str(client)],
                check=True, capture_output=True, timeout=10,
            )
            with self.subTest(kind="self-id-not-a-dependency"):
                observed = installed_inputs.macos_library_inputs([client])
                self.assertEqual(
                    observed[str(dependency)], installed_inputs.file_digest(dependency),
                )
                self.assertNotIn(str(root / "producer-only-id"), observed)
            dependency.unlink()
            with self.subTest(kind="actual-missing-dependency"), self.assertRaises(
                (ValueError, FileNotFoundError),
            ):
                installed_inputs.macos_library_inputs([client])


if __name__ == "__main__":
    unittest.main()
