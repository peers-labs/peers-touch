from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.lease import (
    ProfileLease,
    ProfileLeaseUnavailable,
)
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    EnvironmentContract,
    RuntimeManifest,
)


REPO_ROOT = Path(__file__).resolve().parents[3]


class DummyProvisioner(EnvironmentProvisioner):
    environment_id = "lease-test"

    def provision(self, gate_id: str) -> RuntimeManifest:
        return self._new_base_manifest(gate_id)


class ProfileLeaseTests(unittest.TestCase):
    def test_conflict_reports_current_owner_and_release_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {"PT_PROFILE_LEASE_DIR": directory},
        ):
            first = ProfileLease("station-three", "first-owner")
            second = ProfileLease("station-three", "second-owner")
            first.acquire()
            with self.assertRaisesRegex(
                ProfileLeaseUnavailable,
                "first-owner",
            ):
                second.acquire()
            first.release()
            first.release()
            second.acquire()
            second.release()

    def test_process_exit_releases_os_lease(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment = os.environ.copy()
            environment["PT_PROFILE_LEASE_DIR"] = directory
            environment["PYTHONPATH"] = str(REPO_ROOT)
            child = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    (
                        "from tooling.acceptance.core.lease import ProfileLease;"
                        "import time;"
                        "lease=ProfileLease('station-three','child-owner');"
                        "lease.acquire();"
                        "print('ready',flush=True);"
                        "time.sleep(60)"
                    ),
                ],
                cwd=REPO_ROOT,
                env=environment,
                stdout=subprocess.PIPE,
                text=True,
            )
            try:
                self.assertEqual(child.stdout.readline().strip(), "ready")
                with patch.dict(
                    os.environ,
                    {"PT_PROFILE_LEASE_DIR": directory},
                ), self.assertRaises(ProfileLeaseUnavailable):
                    ProfileLease("station-three", "parent-owner").acquire()
            finally:
                child.terminate()
                child.wait(timeout=10)
                if child.stdout is not None:
                    child.stdout.close()

            with patch.dict(
                os.environ,
                {"PT_PROFILE_LEASE_DIR": directory},
            ):
                lease = ProfileLease("station-three", "parent-owner")
                lease.acquire()
                lease.release()

    def test_provisioner_maps_conflict_to_structured_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {"PT_PROFILE_LEASE_DIR": directory},
        ):
            held = ProfileLease("station-three", "deploy-owner")
            held.acquire()
            provisioner = DummyProvisioner(
                EnvironmentContract(id="lease-test")
            )
            try:
                with self.assertRaisesRegex(
                    BlockedError,
                    "deploy-owner",
                ) as caught:
                    provisioner.acquire_profile_lease(
                        "station-three",
                        "gate-owner",
                    )
                self.assertEqual(
                    caught.exception.resource,
                    "profile-lease:station-three",
                )
            finally:
                held.release()

    def test_deploy_script_uses_shared_profile_lease(self) -> None:
        source = (
            REPO_ROOT / "tooling" / "scripts" / "deploy" / "deploy.sh"
        ).read_text(encoding="utf-8")
        self.assertIn("PT_PROFILE_LEASE_HELD", source)
        self.assertIn("tooling.acceptance.core.lease", source)
        self.assertIn('--resource "$env_name"', source)


if __name__ == "__main__":
    unittest.main()
