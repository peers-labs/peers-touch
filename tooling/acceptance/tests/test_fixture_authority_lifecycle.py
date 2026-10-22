from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import EnvironmentContract, FixtureRequirement
from tooling.acceptance.core.reset_authority import _machine_lease_owner


class SyntheticProvisioner(EnvironmentProvisioner):
    environment_id = "synthetic-reset"

    def provision(self, gate_id):
        raise AssertionError("no product provisioning belongs in this test")


class FixtureAuthorityLifecycleTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "reset.lock"
        self.owner = _machine_lease_owner()
        self.request = {
            "leaseFile": str(self.path),
            "resourceKind": "station.reset",
            "resourceId": "synthetic-fixture",
            "workspaceId": "synthetic-workspace",
            "budgetSeconds": 5,
            "source": {"branch": "synthetic-branch", "head": "a" * 40},
        }
        self.contract = EnvironmentContract(
            id="synthetic-reset",
            fixtures=(FixtureRequirement(
                id="synthetic-fixture", authorization_required=True,
                authorization_ref="station.reset:synthetic-fixture",
            ),),
        )

    def lease(self, command=None):
        lease = self.owner.MachineLease(
            self.request, command or [sys.executable, "-c", "pass"],
            reset_scope="synthetic-fixture",
        )
        self.addCleanup(lease.release)
        return lease

    def test_real_fd_survives_until_resource_cleanup_and_releases_last(self):
        lease = self.lease()
        provisioner = SyntheticProvisioner(self.contract)
        with patch(
            "tooling.acceptance.core.provisioner.acquire_station_reset_authority",
            side_effect=lambda *_args, **_kwargs: lease.acquire(),
        ), patch.dict(os.environ, {}, clear=True):
            environment = provisioner.prepare_fixture_authority(budget_seconds=5)
        fd = int(environment["PT_MACHINE_LEASE_FD"])

        def resource_cleanup():
            os.fstat(fd)
            with self.assertRaises(self.owner.MachineLeaseError):
                self.lease().acquire()

        provisioner.register_cleanup("synthetic-resource", resource_cleanup)
        self.assertEqual(
            provisioner.cleanup(),
            ("synthetic-resource", "station.reset:synthetic-fixture"),
        )
        with self.assertRaises(OSError):
            os.fstat(fd)
        self.assertEqual(self.path.read_text(), "")
        self.lease().acquire()

    def test_failed_post_lock_validation_clears_metadata_and_unlocks(self):
        lease = self.lease([sys.executable, "-c", "raise SystemExit(7)"])
        with self.assertRaises(self.owner.MachineLeaseError):
            lease.acquire()
        self.assertEqual(self.path.read_text(), "")
        self.lease().acquire()

    def test_inherited_fd_is_verified_by_the_canonical_cli(self):
        lease = self.lease().acquire()
        completed = subprocess.run(
            [
                sys.executable, self.owner.__file__, "verify-held",
                "--lease-file", str(self.path),
                "--lease-fd", str(lease.handle.fileno()),
                "--lease-id", lease.metadata["leaseId"],
                "--resource-kind", "station.reset",
                "--resource-id", "synthetic-fixture",
                "--workspace-id", "synthetic-workspace",
            ],
            pass_fds=(lease.handle.fileno(),),
            capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn('"status": "HELD"', completed.stdout)

    def test_resource_failure_still_releases_authority(self):
        lease = self.lease()
        provisioner = SyntheticProvisioner(self.contract)
        with patch(
            "tooling.acceptance.core.provisioner.acquire_station_reset_authority",
            side_effect=lambda *_args, **_kwargs: lease.acquire(),
        ), patch.dict(os.environ, {}, clear=True):
            provisioner.prepare_fixture_authority(budget_seconds=5)
        provisioner.register_cleanup(
            "failed-resource", lambda: (_ for _ in ()).throw(RuntimeError("failed"))
        )
        with self.assertRaisesRegex(RuntimeError, "failed-resource"):
            provisioner.cleanup()
        self.assertEqual(self.path.read_text(), "")
        self.lease().acquire()


if __name__ == "__main__":
    unittest.main()
