from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.social.desktop_private_e2e import (
    EXPLICITLY_UNPROVEN_SCENARIOS,
    HISTORICAL_SCENARIOS,
    RUNTIME_CLIENT_IDS,
    RUNTIME_SCENARIOS,
    RUNTIME_SERVICE_IDS,
    REQUIRED_SCENARIOS,
    _parse_owner_output,
    _validate_owner_result,
)


class SocialPrivateDesktopGateTest(unittest.TestCase):
    def _result(self, root: Path) -> dict[str, object]:
        suite_report = root / "suite-runtime.json"
        supporting = root / "scenario-evidence.json"
        suite_report_digest = "a" * 64
        suite_report.write_text(
            json.dumps({"reportDigest": suite_report_digest}) + "\n",
            encoding="utf-8",
        )
        supporting.write_text("{}\n", encoding="utf-8")
        return {
            "status": "FUNCTIONAL_PASS",
            "proofState": "UNPROVEN",
            "scenarioResults": {
                scenario_id: "PASS"
                for scenario_id in REQUIRED_SCENARIOS
            },
            "unprovenScenarios": list(EXPLICITLY_UNPROVEN_SCENARIOS),
            "historicalScenarios": list(HISTORICAL_SCENARIOS),
            "resourceReuse": {
                "provisioningRuns": 1,
                "clientLaunches": 5,
                "maxConcurrentNativeClients": 3,
                "newAccountRegistrations": 3,
                "stationBuilds": 0,
                "stationDeployments": 0,
                "desktopBuilds": 0,
                "clientReplacements": ["bob"],
            },
            "suiteRuntimeReport": str(suite_report),
            "suiteRuntimeReportDigest": suite_report_digest,
            "runtimeManifest": {
                "artifactKind": (
                    "social-private-desktop-suite-runtime-manifest"
                ),
                "schemaVersion": 1,
                "state": "FIXTURE_READY",
                "cleanupState": "CLEANED",
                "runId": "social-desktop-suite-run",
                "workspaceId": "1" * 16,
                "sourceCommit": "2" * 40,
                "worktreeSetDigest": "3" * 64,
                "scenarioManifestDigests": {
                    scenario_id: "4" * 64
                    for scenario_id in RUNTIME_SCENARIOS
                },
                "serviceIds": list(RUNTIME_SERVICE_IDS),
                "clientIds": list(RUNTIME_CLIENT_IDS),
                "suiteRuntimeReportDigest": suite_report_digest,
            },
            "supportingArtifacts": [str(supporting)],
        }

    def test_parse_owner_output_uses_terminal_json_line(self) -> None:
        payload = _parse_owner_output('runtime log\n{"status":"ok"}\n')
        self.assertEqual({"status": "ok"}, payload)

    def test_complete_desktop_result_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            suite, supporting, manifest = _validate_owner_result(
                self._result(Path(temp_dir))
            )
            self.assertTrue(suite.is_file())
            self.assertEqual(1, len(supporting))
            self.assertEqual("FIXTURE_READY", manifest["state"])
            self.assertEqual("CLEANED", manifest["cleanupState"])

    def test_sorted_owner_json_preserves_scenario_manifest_closure(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            payload = self._result(Path(temp_dir))
            parsed = _parse_owner_output(
                json.dumps(payload, sort_keys=True)
            )
            _suite, _supporting, manifest = _validate_owner_result(parsed)
            self.assertEqual(
                set(RUNTIME_SCENARIOS),
                set(manifest["scenarioManifestDigests"]),
            )

    def test_runtime_evidence_manifest_is_required(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            payload = self._result(Path(temp_dir))
            payload.pop("runtimeManifest")
            with self.assertRaisesRegex(GateError, "manifest is invalid"):
                _validate_owner_result(payload)

    def test_runtime_evidence_requires_complete_scenario_closure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            payload = self._result(Path(temp_dir))
            payload["runtimeManifest"]["scenarioManifestDigests"].pop(
                "social-bounds"
            )
            with self.assertRaisesRegex(GateError, "closure is invalid"):
                _validate_owner_result(payload)

    def test_missing_scenario_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            payload = self._result(Path(temp_dir))
            payload["scenarioResults"].pop("SOC-SEC-AS16")
            with self.assertRaisesRegex(GateError, "incomplete"):
                _validate_owner_result(payload)

    def test_resource_expansion_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            payload = self._result(Path(temp_dir))
            payload["resourceReuse"]["maxConcurrentNativeClients"] = 4
            with self.assertRaisesRegex(GateError, "resource budget"):
                _validate_owner_result(payload)

    def test_browser_or_mobile_claim_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            payload = self._result(Path(temp_dir))
            payload["unprovenScenarios"] = []
            with self.assertRaisesRegex(GateError, "non-claims"):
                _validate_owner_result(payload)

    def test_historical_scenario_disposition_is_required(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            payload = self._result(Path(temp_dir))
            payload["historicalScenarios"] = []
            with self.assertRaisesRegex(GateError, "historical scenario"):
                _validate_owner_result(payload)


if __name__ == "__main__":
    unittest.main()
