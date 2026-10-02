from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.social.desktop_private_e2e import (
    EXPLICITLY_UNPROVEN_SCENARIOS,
    REQUIRED_SCENARIOS,
    _parse_owner_output,
    _validate_owner_result,
)


class SocialPrivateDesktopGateTest(unittest.TestCase):
    def _result(self, root: Path) -> dict[str, object]:
        suite_report = root / "suite-runtime.json"
        supporting = root / "scenario-evidence.json"
        suite_report.write_text("{}\n", encoding="utf-8")
        supporting.write_text("{}\n", encoding="utf-8")
        return {
            "status": "FUNCTIONAL_PASS",
            "proofState": "UNPROVEN",
            "scenarioResults": {
                scenario_id: "PASS"
                for scenario_id in REQUIRED_SCENARIOS
            },
            "unprovenScenarios": list(EXPLICITLY_UNPROVEN_SCENARIOS),
            "resourceReuse": {
                "provisioningRuns": 1,
                "maxConcurrentNativeClients": 3,
                "newAccountRegistrations": 0,
                "stationBuilds": 0,
                "stationDeployments": 0,
                "desktopBuilds": 0,
                "clientReplacements": ["bob"],
            },
            "suiteRuntimeReport": str(suite_report),
            "supportingArtifacts": [str(supporting)],
        }

    def test_parse_owner_output_uses_terminal_json_line(self) -> None:
        payload = _parse_owner_output('runtime log\n{"status":"ok"}\n')
        self.assertEqual({"status": "ok"}, payload)

    def test_complete_desktop_result_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            suite, supporting = _validate_owner_result(
                self._result(Path(temp_dir))
            )
            self.assertTrue(suite.is_file())
            self.assertEqual(1, len(supporting))

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


if __name__ == "__main__":
    unittest.main()
