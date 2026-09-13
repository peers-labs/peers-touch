from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
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
        self.env_root = Path(self.temporary_directory.name) / "env"
        self.script_root.mkdir(parents=True)
        self.profile_root.mkdir(parents=True)
        self.active_root.mkdir(parents=True)
        for script_name in (
            "config.sh",
            "env.sh",
            "environment-creation-authorization.py",
            "profile.sh",
            "redact-env.sh",
        ):
            shutil.copy2(SCRIPT_ROOT / script_name, self.script_root / script_name)

        canonical_profile_root = self.env_root / "peers-touch" / "one"
        canonical_profile_root.mkdir(parents=True)
        self.profile = canonical_profile_root / "profile.env.example"
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
        subprocess.run(["git", "init", "-q"], cwd=self.env_root, check=True)
        subprocess.run(
            ["git", "config", "user.name", "Local Dev Test"],
            cwd=self.env_root,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.email", "local-dev-test@example.invalid"],
            cwd=self.env_root,
            check=True,
        )
        subprocess.run(["git", "add", "."], cwd=self.env_root, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "test: add canonical profile"],
            cwd=self.env_root,
            check=True,
        )
        shutil.copy2(self.profile, self.profile_root / "one.env")

    def tearDown(self) -> None:
        path = Path(self.temporary_directory.name)
        self.temporary_directory._finalizer.detach()
        for attempt in range(5):
            try:
                shutil.rmtree(path)
                return
            except FileNotFoundError:
                return
            except OSError:
                if attempt == 4:
                    raise
                time.sleep(0.05)

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
