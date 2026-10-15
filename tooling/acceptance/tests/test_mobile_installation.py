from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.provisioners.mobile_installation import (
    ANDROID_ADB_PACKAGE_SHA256_ADAPTER,
    AndroidInstalledArtifact,
    MobileInstallationError,
    execute_android_installation,
    load_mobile_device_descriptor,
)


EXPECTED_SHA256 = "a" * 64
OTHER_SHA256 = "b" * 64


class RecordingAndroidAdapter:
    adapter_id = ANDROID_ADB_PACKAGE_SHA256_ADAPTER

    def __init__(self, observations: list[AndroidInstalledArtifact]) -> None:
        self.observations = iter(observations)
        self.events: list[str] = []

    def inspect(self, application_id: str) -> AndroidInstalledArtifact:
        self.events.append(f"inspect:{application_id}")
        return next(self.observations)

    def remove(self, application_id: str) -> None:
        self.events.append(f"remove:{application_id}")

    def install(self, package: Path) -> None:
        self.events.append(f"install:{package.name}")

    def activate(self, application_id: str) -> None:
        self.events.append(f"activate:{application_id}")


class MobileInstallationPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.descriptor = load_mobile_device_descriptor(
            REPO_ROOT
            / "tooling"
            / "acceptance"
            / "devices"
            / "oppo-peem00.yaml"
        )
        self.tempdir = tempfile.TemporaryDirectory()
        self.package = Path(self.tempdir.name) / "peers.apk"
        self.package.write_bytes(b"apk")

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def _timestamps(self):
        sequence = iter(
            (
                "2026-10-07T00:00:00Z",
                "2026-10-07T00:00:01Z",
                "2026-10-07T00:00:02Z",
                "2026-10-07T00:00:03Z",
            )
        )
        return lambda: next(sequence)

    def test_descriptor_matches_current_oppo_without_device_identity(self) -> None:
        self.assertTrue(
            self.descriptor.matches(
                {
                    "platform": "android",
                    "manufacturer": "oppo",
                    "model": "PEEM00",
                }
            )
        )
        self.assertFalse(
            self.descriptor.matches(
                {
                    "platform": "android",
                    "manufacturer": "OPPO",
                    "model": "different",
                }
            )
        )
        self.assertEqual(
            self.descriptor.installation.strategy,
            "reuse-exact-artifact",
        )
        self.assertTrue(
            self.descriptor.installation.user_confirmation_on_install
        )

    def test_exact_installed_artifact_is_reused_without_install(self) -> None:
        adapter = RecordingAndroidAdapter(
            [
                AndroidInstalledArtifact(True, EXPECTED_SHA256),
                AndroidInstalledArtifact(True, EXPECTED_SHA256),
            ]
        )

        execution = execute_android_installation(
            self.descriptor.installation,
            adapter,
            application_id="com.peers.touch.mobile",
            package=self.package,
            expected_sha256=EXPECTED_SHA256,
            timestamp=self._timestamps(),
        )

        self.assertTrue(execution.decision.reuses_installed_artifact)
        self.assertEqual(
            adapter.events,
            [
                "inspect:com.peers.touch.mobile",
                "inspect:com.peers.touch.mobile",
                "activate:com.peers.touch.mobile",
            ],
        )
        trace = execution.to_trace(self.descriptor.installation)
        self.assertTrue(trace["exactArtifactMatch"])
        self.assertFalse(trace["install"]["requested"])
        self.assertFalse(trace["install"]["userConfirmationApplicable"])

    def test_mismatched_installed_artifact_is_replaced_once(self) -> None:
        adapter = RecordingAndroidAdapter(
            [
                AndroidInstalledArtifact(True, OTHER_SHA256),
                AndroidInstalledArtifact(False, None),
                AndroidInstalledArtifact(True, EXPECTED_SHA256),
            ]
        )

        execution = execute_android_installation(
            self.descriptor.installation,
            adapter,
            application_id="com.peers.touch.mobile",
            package=self.package,
            expected_sha256=EXPECTED_SHA256,
            timestamp=self._timestamps(),
        )

        self.assertFalse(execution.decision.reuses_installed_artifact)
        self.assertEqual(
            execution.decision.reason,
            "installed-artifact-sha256-mismatch",
        )
        self.assertEqual(
            adapter.events,
            [
                "inspect:com.peers.touch.mobile",
                "remove:com.peers.touch.mobile",
                "inspect:com.peers.touch.mobile",
                "install:peers.apk",
                "inspect:com.peers.touch.mobile",
                "activate:com.peers.touch.mobile",
            ],
        )
        trace = execution.to_trace(self.descriptor.installation)
        self.assertTrue(trace["install"]["requested"])
        self.assertTrue(trace["install"]["userConfirmationApplicable"])

    def test_install_fails_closed_when_readback_hash_differs(self) -> None:
        adapter = RecordingAndroidAdapter(
            [
                AndroidInstalledArtifact(False, None),
                AndroidInstalledArtifact(False, None),
                AndroidInstalledArtifact(True, OTHER_SHA256),
            ]
        )

        with self.assertRaisesRegex(
            MobileInstallationError,
            "does not match",
        ):
            execute_android_installation(
                self.descriptor.installation,
                adapter,
                application_id="com.peers.touch.mobile",
                package=self.package,
                expected_sha256=EXPECTED_SHA256,
                timestamp=self._timestamps(),
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
