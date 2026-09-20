from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tooling.acceptance.core import lease as lease_module
from tooling.acceptance.core.lease import (
    RemoteGitSourceLease,
    _remote_git_source_lease_argv,
    _remote_git_source_lease_script,
)
from tooling.acceptance.transports.ssh import RemotePlatform


class WindowsLeaseTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows pipe semantics")
    def test_remote_lease_waits_for_ready_on_windows_pipe(self) -> None:
        lease = RemoteGitSourceLease(
            "windows-cell",
            "runtime-cell:windows:run-a",
            host="windows.example",
            user="acceptance",
            deploy_path="runtime/windows-cell",
            remote_platform=RemotePlatform.WINDOWS,
        )
        command = [
            sys.executable,
            "-c",
            "import sys; print('READY', flush=True); sys.stdin.read()",
        ]

        with patch.object(lease, "_command", return_value=command):
            lease.acquire()
            lease.release()

    def test_windows_profile_lock_uses_msvcrt_byte_range_lock(self) -> None:
        calls: list[tuple[int, int, int]] = []
        fake_msvcrt = SimpleNamespace(
            LK_NBLCK=2,
            LK_UNLCK=0,
            locking=lambda descriptor, mode, size: calls.append(
                (descriptor, mode, size)
            ),
        )
        with tempfile.NamedTemporaryFile(mode="a+", encoding="utf-8") as handle:
            with (
                patch.object(lease_module.os, "name", "nt"),
                patch.dict(sys.modules, {"msvcrt": fake_msvcrt}),
            ):
                self.assertTrue(lease_module._try_file_lock(handle))
                lease_module._unlock_file(handle)

            handle.seek(0)
            self.assertEqual(handle.read(), "\0")

        self.assertEqual([call[1:] for call in calls], [(2, 1), (0, 1)])

    def test_windows_remote_lease_uses_python_and_encoded_powershell(self) -> None:
        lease = RemoteGitSourceLease(
            "windows-cell",
            "runtime-cell:windows:run-a",
            host="windows.example",
            user="acceptance",
            deploy_path="runtime/windows-cell",
            remote_platform=RemotePlatform.WINDOWS,
        )

        command = lease._command()

        self.assertEqual(
            lease.transport.target.remote_platform,
            RemotePlatform.WINDOWS,
        )
        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertTrue(command[-1].startswith("powershell.exe "))
        self.assertIn("-EncodedCommand", command[-1])

    def test_windows_remote_lease_script_uses_msvcrt_and_safe_paths(self) -> None:
        argv = _remote_git_source_lease_argv(
            "runtime/windows-cell",
            "runtime-cell:windows:run-a",
            RemotePlatform.WINDOWS,
        )

        self.assertEqual(argv[0], "python")
        self.assertEqual(argv[3], "runtime-windows-cell")
        self.assertIn("source-leases", argv[2])
        self.assertIn("import msvcrt", argv[2])
        self.assertIn("msvcrt.LK_NBLCK", argv[2])
        self.assertIn("seek(1 if os.name == 'nt' else 0)", argv[2])
        self.assertIn("getattr(signal, name, None)", argv[2])

    def test_posix_remote_lease_keeps_python3_exec_contract(self) -> None:
        command = _remote_git_source_lease_script(
            "runtime/linux-cell",
            "runtime-cell:linux:run-a",
        )

        self.assertTrue(command.startswith("exec python3 -c "))
        self.assertIn("import fcntl", command)

    def test_profile_lease_default_uses_platform_temp_directory(self) -> None:
        with patch.dict(lease_module.os.environ, {}, clear=True):
            path = lease_module.lease_path("windows-cell")

        self.assertEqual(
            path,
            Path(tempfile.gettempdir())
            / "peers-touch-profile-leases"
            / "windows-cell.lock",
        )


if __name__ == "__main__":
    unittest.main()
