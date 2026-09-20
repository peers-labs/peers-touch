from __future__ import annotations

import os
import subprocess
import sys
import unittest

from tooling.scripts.deploy.source_sync import _run_continuation


@unittest.skipIf(os.name == "nt", "pass_fds is POSIX-only")
class SourceSyncCliTests(unittest.TestCase):
    def test_continuation_inherits_machine_lease_descriptor(self) -> None:
        read_fd, write_fd = os.pipe()
        self.addCleanup(os.close, read_fd)
        os.write(write_fd, b"x")
        os.close(write_fd)

        environment = os.environ.copy()
        environment["PT_MACHINE_LEASE_FD"] = str(read_fd)
        result = _run_continuation(
            [
                sys.executable,
                "-c",
                (
                    "import os, sys; "
                    "fd = int(os.environ['PT_MACHINE_LEASE_FD']); "
                    "raise SystemExit(0 if os.read(fd, 1) == b'x' else 1)"
                ),
            ],
            environment,
        )

        self.assertEqual(result.returncode, 0)

    def test_continuation_rejects_closed_machine_lease_descriptor(self) -> None:
        read_fd, write_fd = os.pipe()
        os.close(read_fd)
        os.close(write_fd)
        environment = os.environ.copy()
        environment["PT_MACHINE_LEASE_FD"] = str(read_fd)

        with self.assertRaisesRegex(RuntimeError, "is not open"):
            _run_continuation(
                [sys.executable, "-c", "raise SystemExit(0)"],
                environment,
            )


if __name__ == "__main__":
    unittest.main()
