from __future__ import annotations

import os
import subprocess
import sys
import unittest

from tooling.acceptance.core.errors import ProvisioningError
from tooling.scripts.deploy.source_sync import _run_follow_up


@unittest.skipIf(os.name == "nt", "pass_fds is POSIX-only")
class SourceSyncCliTests(unittest.TestCase):
    def test_continuation_inherits_machine_lease_descriptor(self) -> None:
        read_fd, write_fd = os.pipe()
        self.addCleanup(os.close, read_fd)
        os.write(write_fd, b"x")
        os.close(write_fd)

        environment = os.environ.copy()
        environment["PT_MACHINE_LEASE_FD"] = str(read_fd)
        returncode = _run_follow_up(
            [
                sys.executable,
                "-c",
                (
                    "import os, sys; "
                    "fd = int(os.environ['PT_MACHINE_LEASE_FD']); "
                    "raise SystemExit(0 if os.read(fd, 1) == b'x' else 1)"
                ),
            ],
            environment=environment,
        )

        self.assertEqual(returncode, 0)

    def test_continuation_rejects_closed_machine_lease_descriptor(self) -> None:
        read_fd, write_fd = os.pipe()
        os.close(read_fd)
        os.close(write_fd)
        environment = os.environ.copy()
        environment["PT_MACHINE_LEASE_FD"] = str(read_fd)

        with self.assertRaisesRegex(
            ProvisioningError,
            "file descriptor is invalid",
        ):
            _run_follow_up(
                [sys.executable, "-c", "raise SystemExit(0)"],
                environment=environment,
            )


if __name__ == "__main__":
    unittest.main()
