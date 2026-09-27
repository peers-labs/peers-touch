#!/usr/bin/env python3

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent / "deploy" / "deploy.sh"


class ReviewedDeployEnvResolutionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        workspace = Path(self.temporary_directory.name)
        self.project_root = workspace / "project"
        self.env_root = workspace / "env"
        script_root = self.project_root / "tooling" / "scripts" / "deploy"
        script_root.mkdir(parents=True)
        shutil.copy2(SCRIPT, script_root / "deploy.sh")
        self.script = script_root / "deploy.sh"
        self.source_sync = script_root / "source-sync.sh"
        self.source_sync.write_text(
            "#!/bin/bash\nprintf '%s\\n' \"$PT_DEPLOY_ENV_FILE\"\n",
            encoding="utf-8",
        )
        self.source_sync.chmod(0o700)
        machine_dev = (
            self.project_root
            / "tooling"
            / "scripts"
            / "local-dev"
            / "machine-dev.mjs"
        )
        machine_dev.parent.mkdir(parents=True)
        machine_dev.write_text("process.exit(0);\n", encoding="utf-8")

        definition_root = self.env_root / "peers-touch" / "one" / "deploy"
        definition_root.mkdir(parents=True)
        self.definition = definition_root / "station-one.env.example"
        self.definition.write_text(
            "\n".join(
                (
                    "PT_DEPLOY_HOST=station-one.example",
                    "PT_DEPLOY_USER=developer",
                    "PT_DEPLOY_PATH=peers-touch/repo",
                    "PT_DEPLOY_ROLE=station",
                    "",
                )
            ),
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
            ["git", "commit", "-qm", "test: add deploy env"],
            cwd=self.env_root,
            check=True,
        )

        local_cache = self.project_root / ".local" / "deploy" / "envs"
        local_cache.mkdir(parents=True)
        (local_cache / "station-one.env").write_text(
            "PT_DEPLOY_HOST=wrong-local-cache.example\n",
            encoding="utf-8",
        )

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

    def resolve(self, name: str) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["PT_ENV_REPO"] = str(self.env_root)
        return subprocess.run(
            ["/bin/bash", str(self.script), "resolve", name],
            cwd=self.project_root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

    def synchronize(self, name: str) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.update(
            {
                "PT_ENV_REPO": str(self.env_root),
                "PT_MACHINE_LEASE_KIND": "station.deploy",
                "PT_MACHINE_LEASE_RESOURCE_ID": name,
            }
        )
        return subprocess.run(
            ["/bin/bash", str(self.script), name],
            cwd=self.project_root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_resolves_tracked_clean_env_and_ignores_local_cache(self) -> None:
        result = self.resolve("station-one")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(result.stdout.strip()), self.definition)
        self.assertNotIn("wrong-local-cache", result.stdout)

    def test_source_sync_receives_reviewed_environment_file(self) -> None:
        result = self.synchronize("station-one")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            Path(result.stdout.strip().splitlines()[-1]),
            self.definition,
        )

    def test_rejects_dirty_tracked_deploy_env(self) -> None:
        self.definition.write_text(
            self.definition.read_text(encoding="utf-8")
            + "PT_DEPLOY_PORT=22\n",
            encoding="utf-8",
        )

        result = self.resolve("station-one")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("dirty or untracked topology", result.stderr)

    def test_rejects_untracked_deploy_env(self) -> None:
        untracked = self.env_root / "peers-touch" / "two" / "deploy"
        untracked.mkdir(parents=True)
        (untracked / "station-two.env.example").write_text(
            "PT_DEPLOY_HOST=station-two.example\n",
            encoding="utf-8",
        )

        result = self.resolve("station-two")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not Git-tracked", result.stderr)

    def test_rejects_duplicate_deploy_env_names(self) -> None:
        duplicate = self.env_root / "peers-touch" / "two" / "deploy"
        duplicate.mkdir(parents=True)
        shutil.copy2(self.definition, duplicate / self.definition.name)
        subprocess.run(["git", "add", "."], cwd=self.env_root, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "test: add duplicate deploy env"],
            cwd=self.env_root,
            check=True,
        )

        result = self.resolve("station-one")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("found 2", result.stderr)


if __name__ == "__main__":
    unittest.main()
