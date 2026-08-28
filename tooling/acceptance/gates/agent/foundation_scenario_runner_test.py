from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.gates.agent import foundation_scenario_runner
from tooling.acceptance.gates.agent.foundation_direct_adapter import (
    DirectRuntimeProbeInput,
)
from tooling.acceptance.gates.agent.foundation_direct_adapter_test import (
    capture,
)
from tooling.acceptance.gates.agent.foundation_group_one_probe import (
    GroupOneProbeError,
)
from tooling.acceptance.gates.agent.foundation_group_one_scenarios import (
    evaluate_as_f04,
)
from tooling.acceptance.gates.agent.foundation_group_one_scenarios_test import (
    valid_as_f04_capture,
)


class DirectProbeHarnessClient:
    def __init__(self, *, mismatch: bool = False) -> None:
        self.mismatch = mismatch

    def harness(
        self,
        _method: str,
        payload: dict[str, object] | None = None,
        timeout: float = 120,
    ) -> dict[str, object]:
        del timeout
        request = payload or {}
        probe = DirectRuntimeProbeInput(
            platform=str(request["platform"]),
            locale=str(request["locale"]),
            cell=str(request["cell"]),
            sample_id=str(request["sampleId"]),
        )
        result = capture(probe)
        facts = valid_as_f04_capture(probe.platform)
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_as_f04(
            facts,
            platform=probe.platform,
        )
        if self.mismatch:
            result["assertions"]["denialExecutedZero"] = False
        return result


class FoundationScenarioRunnerProfileTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temporary_directory.name) / "two"
        self.active_profile = (
            self.repo_root / ".local" / "dev" / "active" / "two.env"
        )
        self.active_profile.parent.mkdir(parents=True)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def load_profile(self, resolved_name: str) -> dict[str, str]:
        manifest = {"profile": {"resolvedName": resolved_name}}
        with patch.object(
            foundation_scenario_runner,
            "REPO_ROOT",
            self.repo_root,
        ):
            return foundation_scenario_runner._load_profile_env(manifest)

    def test_loads_the_provisioned_active_profile(self) -> None:
        self.active_profile.write_text(
            "PT_DEV_PROFILE=two\nPT_AGENT_DEFAULT_MODEL_ID=model\n",
            encoding="utf-8",
        )

        profile = self.load_profile("two")

        self.assertEqual(profile["PT_DEV_PROFILE"], "two")
        self.assertEqual(profile["PT_AGENT_DEFAULT_MODEL_ID"], "model")

    def test_rejects_a_missing_active_profile(self) -> None:
        with self.assertRaisesRegex(
            foundation_scenario_runner.ScenarioRunnerError,
            "active profile cannot be resolved",
        ):
            self.load_profile("two")

    def test_rejects_a_different_active_profile_identity(self) -> None:
        self.active_profile.write_text(
            "PT_DEV_PROFILE=one\n",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(
            foundation_scenario_runner.ScenarioRunnerError,
            "active profile identity does not match",
        ):
            self.load_profile("two")

    def test_maps_the_exact_profile_provider_fixture(self) -> None:
        config = foundation_scenario_runner._agent_provider_config(
            {
                "PT_AGENT_PROVIDER_ID": "ark",
                "PT_AGENT_PROVIDER_API_KEY": "credential",
                "PT_AGENT_DEFAULT_MODEL_ID": "endpoint-model",
                "PT_AGENT_PROVIDER_BASE_URL": "https://provider.example/v1",
            }
        )

        self.assertEqual(
            config,
            {
                "providerId": "ark",
                "apiKey": "credential",
                "modelId": "endpoint-model",
                "baseUrl": "https://provider.example/v1",
            },
        )

    def test_rejects_an_incomplete_profile_provider_fixture(self) -> None:
        with self.assertRaisesRegex(
            foundation_scenario_runner.ScenarioRunnerError,
            "PT_AGENT_PROVIDER_BASE_URL",
        ):
            foundation_scenario_runner._agent_provider_config(
                {
                    "PT_AGENT_PROVIDER_ID": "ark",
                    "PT_AGENT_PROVIDER_API_KEY": "credential",
                    "PT_AGENT_DEFAULT_MODEL_ID": "endpoint-model",
                }
            )

    def test_direct_probe_runs_independent_group_one_oracle(self) -> None:
        probe_input = DirectRuntimeProbeInput(
            platform="desktop_app",
            locale="en",
            cell="AS-F04",
            sample_id="sample-001",
        )

        result = foundation_scenario_runner._make_direct_probe(
            DirectProbeHarnessClient()
        )(probe_input)

        self.assertTrue(result["assertions"]["autoPolicyExecutedOnce"])

    def test_direct_probe_rejects_harness_assertion_drift(self) -> None:
        probe_input = DirectRuntimeProbeInput(
            platform="desktop_app",
            locale="en",
            cell="AS-F04",
            sample_id="sample-001",
        )

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "assertions do not match production scenario facts",
        ):
            foundation_scenario_runner._make_direct_probe(
                DirectProbeHarnessClient(mismatch=True)
            )(probe_input)


if __name__ == "__main__":
    unittest.main()
