from __future__ import annotations

import inspect
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.social import desktop_private_e2e as module
from tooling.acceptance.gates.social.cross_station_support import (
    ValidatedSuiteResult,
)
from tooling.acceptance.gates.social.desktop_private_e2e import (
    EXPLICITLY_UNPROVEN_SCENARIOS,
    HISTORICAL_SCENARIOS,
    SAME_STATION_SCENARIO,
    SOURCE_COMMANDS,
    SocialPrivateDesktopGate,
    _validate_attached_suite,
)


class SocialPrivateDesktopGateTest(unittest.TestCase):
    def _suite(self) -> ValidatedSuiteResult:
        payload = {
            "proofState": "UNPROVEN",
            "controlCommit": "a" * 40,
            "sourceCommit": "b" * 40,
            "scenarioResults": {
                SAME_STATION_SCENARIO: {
                    "status": "PASS",
                    "evidenceRefs": [
                        "same-station-regression-receiver",
                    ],
                },
            },
            "resourceReuse": {
                "provisioningRuns": 1,
                "clientLaunches": 3,
                "maxConcurrentNativeClients": 2,
                "newAccountRegistrations": 3,
                "stationBuilds": 0,
                "stationDeployments": 0,
                "desktopBuilds": 0,
                "clientReplacements": ["bob2"],
                "fixtureOnlyClients": ["eve"],
            },
            "runtimeManifest": {
                "state": "FIXTURE_READY",
                "runId": "css09-suite-runtime",
            },
            "cleanup": {"status": "CLEANED"},
            "suiteRuntimeReportDigest": "c" * 64,
        }
        return ValidatedSuiteResult(
            path=Path("/tmp/result.json"),
            payload=payload,
            suite_runtime_path=Path("/tmp/suite-runtime.json"),
            suite_runtime_report={},
            supporting_artifacts=(),
        )

    def test_gate_attaches_current_css09_suite_without_runtime_owner(
        self,
    ) -> None:
        gate = SocialPrivateDesktopGate()
        suite = self._suite()
        with (
            mock.patch.object(
                module,
                "run_source_commands",
                return_value=[{"name": "source-check"}],
            ) as run_commands,
            mock.patch.object(
                module,
                "load_suite_result",
                return_value=suite,
            ) as load_suite,
            mock.patch.object(module, "attach_suite_evidence") as attach,
        ):
            result = gate.run()

        run_commands.assert_called_once_with(gate, SOURCE_COMMANDS)
        load_suite.assert_called_once_with()
        attach.assert_called_once_with(gate, suite)
        self.assertEqual(
            suite.payload["runtimeManifest"],
            gate.report.manifest,
        )
        self.assertEqual([SAME_STATION_SCENARIO], result["provenScope"])
        self.assertEqual(
            list(EXPLICITLY_UNPROVEN_SCENARIOS),
            result["unprovenScenarios"],
        )
        self.assertEqual(
            list(HISTORICAL_SCENARIOS),
            result["historicalScenarios"],
        )

    def test_missing_same_station_result_is_rejected(self) -> None:
        suite = self._suite()
        suite.payload["scenarioResults"].pop(SAME_STATION_SCENARIO)

        with self.assertRaisesRegex(GateError, "same-Station regression"):
            _validate_attached_suite(suite.payload)

    def test_same_station_receiver_evidence_is_required(self) -> None:
        suite = self._suite()
        suite.payload["scenarioResults"][SAME_STATION_SCENARIO][
            "evidenceRefs"
        ] = []

        with self.assertRaisesRegex(GateError, "receiver-visible evidence"):
            _validate_attached_suite(suite.payload)

    def test_resource_expansion_is_rejected(self) -> None:
        suite = self._suite()
        suite.payload["resourceReuse"]["maxConcurrentNativeClients"] = 3

        with self.assertRaisesRegex(GateError, "resource budget"):
            _validate_attached_suite(suite.payload)

    def test_replacement_identity_drift_is_rejected(self) -> None:
        suite = self._suite()
        suite.payload["resourceReuse"]["clientReplacements"] = ["bob"]

        with self.assertRaisesRegex(GateError, "resource budget"):
            _validate_attached_suite(suite.payload)

    def test_runtime_manifest_is_required(self) -> None:
        suite = self._suite()
        suite.payload.pop("runtimeManifest")

        with self.assertRaisesRegex(GateError, "runtime manifest"):
            _validate_attached_suite(suite.payload)

    def test_old_w7_runtime_owner_path_is_absent(self) -> None:
        source = inspect.getsource(module)

        self.assertNotIn("run-social-desktop-acceptance-suite", source)
        self.assertNotIn("_runtime_owner_command", source)


if __name__ == "__main__":
    unittest.main()
