from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.gates.agent import foundation_scenario_runner


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


if __name__ == "__main__":
    unittest.main()
