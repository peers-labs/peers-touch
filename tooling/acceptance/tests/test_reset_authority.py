from __future__ import annotations

import json
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.reset_authority import (
    require_station_reset_authority,
    station_reset_authorization_ref,
)


class StationResetAuthorityTest(unittest.TestCase):
    def test_requires_exact_inherited_station_reset_lease(self) -> None:
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(
            BlockedError
        ) as blocked:
            require_station_reset_authority("mobile-fixture")

        self.assertEqual(
            blocked.exception.resource,
            "station.reset:mobile-fixture",
        )

    def test_verifies_live_lease_through_machine_dev_owner(self) -> None:
        read_fd, write_fd = os.pipe()
        self.addCleanup(os.close, read_fd)
        self.addCleanup(os.close, write_fd)
        calls: list[tuple[list[str], dict[str, object]]] = []

        def runner(
            command: list[str],
            **kwargs: object,
        ) -> subprocess.CompletedProcess[str]:
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps(
                    {
                        "leaseId": "lease-1",
                        "resourceKind": "station.reset",
                        "resourceId": "mobile-fixture",
                        "validation": "current",
                    }
                ),
                stderr="",
            )

        with patch.dict(
            os.environ,
            {
                "PT_MACHINE_LEASE_FD": str(read_fd),
                "PT_MACHINE_LEASE_ID": "lease-1",
                "PT_MACHINE_LEASE_KIND": "station.reset",
                "PT_MACHINE_LEASE_RESOURCE_ID": "mobile-fixture",
                "PT_MACHINE_LEASE_RESET_SCOPE": "mobile-fixture",
            },
            clear=True,
        ):
            receipt = require_station_reset_authority(
                "mobile-fixture",
                repo_root=Path("/repo"),
                runner=runner,
            )

        self.assertEqual(receipt["leaseId"], "lease-1")
        command, options = calls[0]
        self.assertEqual(command[:3], ["node", "tooling/scripts/local-dev/machine-dev.mjs", "verify-held"])
        self.assertIn("--reset-scope", command)
        self.assertEqual(options["pass_fds"], (read_fd,))
        self.assertEqual(options["cwd"], Path("/repo"))

    def test_rejects_non_current_or_mismatched_receipt(self) -> None:
        read_fd, write_fd = os.pipe()
        self.addCleanup(os.close, read_fd)
        self.addCleanup(os.close, write_fd)

        def runner(
            command: list[str],
            **_kwargs: object,
        ) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps(
                    {
                        "leaseId": "another-lease",
                        "resourceKind": "station.reset",
                        "resourceId": "mobile-fixture",
                        "validation": "current",
                    }
                ),
                stderr="",
            )

        with patch.dict(
            os.environ,
            {
                "PT_MACHINE_LEASE_FD": str(read_fd),
                "PT_MACHINE_LEASE_ID": "lease-1",
                "PT_MACHINE_LEASE_KIND": "station.reset",
                "PT_MACHINE_LEASE_RESOURCE_ID": "mobile-fixture",
                "PT_MACHINE_LEASE_RESET_SCOPE": "mobile-fixture",
            },
            clear=True,
        ), self.assertRaises(BlockedError):
            require_station_reset_authority(
                "mobile-fixture",
                runner=runner,
            )

    def test_authorization_ref_is_canonical(self) -> None:
        self.assertEqual(
            station_reset_authorization_ref("mobile-fixture"),
            "station.reset:mobile-fixture",
        )
        with self.assertRaises(ValueError):
            station_reset_authorization_ref(" mobile-fixture ")


if __name__ == "__main__":
    unittest.main()
