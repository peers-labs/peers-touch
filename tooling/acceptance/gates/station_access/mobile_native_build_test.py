from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.station_access.mobile_native_build import (
    MobileNativeBuildGate,
    validate_mobile_native_build,
)


class MobileNativeBuildGateTest(unittest.TestCase):
    def manifest(self, artifact: Path) -> dict[str, object]:
        return {
            "artifactKind": "acceptance-runtime-manifest",
            "environmentId": "mobile-simulator",
            "state": "FIXTURE_READY",
            "source": {
                "commit": "a" * 40,
                "workspaceDigest": "clean",
            },
            "clients": [
                {
                    "runtime": "tauri-ios-simulator",
                }
            ],
            "mobileSimulator": {
                "applications": {
                    "ios": {
                        "artifact": str(artifact),
                        "sha256": "b" * 64,
                    }
                }
            },
        }

    def test_accepts_source_bound_ios_simulator_application(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "Peers.app"
            artifact.mkdir()

            result = validate_mobile_native_build(self.manifest(artifact))

        self.assertEqual(result["runtime"], "tauri-ios-simulator")
        self.assertEqual(result["sourceCommit"], "a" * 40)

    def test_rejects_missing_application(self) -> None:
        with self.assertRaisesRegex(GateError, "artifact is invalid"):
            validate_mobile_native_build(
                self.manifest(Path("/missing/Peers.app"))
            )

    def test_gate_records_build_and_source_assertions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "Peers.app"
            artifact.mkdir()
            gate = MobileNativeBuildGate(manifest=self.manifest(artifact))

            result = gate.run()

        self.assertEqual(result["artifact"], "Peers.app")
        self.assertEqual(
            {assertion.name for assertion in gate.report.assertions},
            {
                "mobile_native_ios_simulator_build",
                "mobile_native_build_source_bound",
            },
        )


if __name__ == "__main__":
    unittest.main()
