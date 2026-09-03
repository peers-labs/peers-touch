from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_ROOT = REPO_ROOT / "tooling" / "scripts" / "local-dev"
SECRET_CANARY = "provider-secret-must-not-leak"


class LocalDevProfileRedactionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.project_root = Path(self.temporary_directory.name) / "fixture-worktree"
        self.script_root = self.project_root / "tooling" / "scripts" / "local-dev"
        self.profile_root = self.project_root / ".local" / "dev" / "profiles"
        self.active_root = self.project_root / ".local" / "dev" / "active"
        self.script_root.mkdir(parents=True)
        self.profile_root.mkdir(parents=True)
        self.active_root.mkdir(parents=True)
        for script_name in (
            "config.sh",
            "env.sh",
            "profile.sh",
            "redact-env.sh",
        ):
            shutil.copy2(SCRIPT_ROOT / script_name, self.script_root / script_name)

        self.profile = self.profile_root / "one.env"
        self.profile.write_text(
            "\n".join(
                (
                    "PT_DEV_PROFILE=one",
                    "PT_STATION_URL=http://station.example:18080",
                    f"PT_AGENT_PROVIDER_API_KEY={SECRET_CANARY}",
                    "PT_AGENT_DEFAULT_MODEL_ID=model-1",
                )
            )
            + "\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def run_script(self, script_name: str, *arguments: str) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["PT_SHARED_LOCAL_DIR"] = str(self.project_root / "missing-shared")
        return subprocess.run(
            ["/bin/bash", str(self.script_root / script_name), *arguments],
            cwd=self.project_root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_config_redacts_sensitive_profile_values(self) -> None:
        active_profile = self.active_root / "fixture-worktree.env"
        active_profile.symlink_to(Path("../profiles/one.env"))

        completed = self.run_script("config.sh")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("PT_STATION_URL=http://station.example:18080", completed.stdout)
        self.assertIn("PT_AGENT_PROVIDER_API_KEY=[REDACTED]", completed.stdout)
        self.assertNotIn(SECRET_CANARY, completed.stdout)
        self.assertNotIn(SECRET_CANARY, completed.stderr)

    def test_profile_activation_redacts_sensitive_profile_values(self) -> None:
        completed = self.run_script("profile.sh", "activate", "one")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("PT_STATION_URL=http://station.example:18080", completed.stdout)
        self.assertIn("PT_AGENT_PROVIDER_API_KEY=[REDACTED]", completed.stdout)
        self.assertNotIn(SECRET_CANARY, completed.stdout)
        self.assertNotIn(SECRET_CANARY, completed.stderr)


if __name__ == "__main__":
    unittest.main()
