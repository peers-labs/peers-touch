#!/usr/bin/env python3

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent / "deploy.sh"


class DeployOrchestrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        workspace = Path(self.temporary_directory.name)
        self.project_root = workspace / "project"
        self.env_root = workspace / "env"
        self.bin_root = workspace / "bin"
        self.trace = workspace / "ssh.trace"

        script_root = self.project_root / "tooling" / "scripts" / "deploy"
        script_root.mkdir(parents=True)
        shutil.copy2(SCRIPT, script_root / "deploy.sh")
        self.script = script_root / "deploy.sh"

        definition_root = self.env_root / "peers-touch" / "test" / "deploy"
        definition_root.mkdir(parents=True)
        self.definition = definition_root / "station-test.env.example"
        self.definition.write_text(
            "\n".join(
                (
                    "PT_DEPLOY_HOST=station.example",
                    "PT_DEPLOY_USER=developer",
                    "PT_DEPLOY_PATH=peers-touch/repo",
                    "PT_DEPLOY_ROLE=test",
                    "PT_DEPLOY_DEPENDENCIES_CMD='compose up -d postgres livekit'",
                    "PT_DEPLOY_BUILD_CMD='compose build station'",
                    "PT_DEPLOY_RESTART_CMD='compose up -d --no-deps station'",
                    "",
                )
            ),
            encoding="utf-8",
        )
        subprocess.run(["git", "init", "-q"], cwd=self.env_root, check=True)
        subprocess.run(
            ["git", "config", "user.name", "Deploy Test"],
            cwd=self.env_root,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.email", "deploy-test@example.invalid"],
            cwd=self.env_root,
            check=True,
        )
        subprocess.run(["git", "add", "."], cwd=self.env_root, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "test: add deploy env"],
            cwd=self.env_root,
            check=True,
        )

        self.bin_root.mkdir()
        ssh = self.bin_root / "ssh"
        ssh.write_text(
            "#!/usr/bin/env bash\nprintf '%s\\n' \"${!#}\" >> \"$DEPLOY_TEST_TRACE\"\n",
            encoding="utf-8",
        )
        ssh.chmod(0o755)

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

    def test_prepares_dependencies_before_build_and_restarts_service_without_deps(
        self,
    ) -> None:
        environment = os.environ.copy()
        environment.update(
            {
                "PATH": f"{self.bin_root}:{environment['PATH']}",
                "PT_ENV_REPO": str(self.env_root),
                "PT_PROFILE_LEASE_HELD": "1",
                "PT_SOURCE_LEASE_HELD": "1",
                "DEPLOY_TEST_TRACE": str(self.trace),
            }
        )

        result = subprocess.run(
            ["/bin/bash", str(self.script), "station-test"],
            cwd=self.project_root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        commands = self.trace.read_text(encoding="utf-8").splitlines()
        dependencies = next(
            index
            for index, command in enumerate(commands)
            if "compose up -d postgres livekit" in command
        )
        build = next(
            index
            for index, command in enumerate(commands)
            if "compose build station" in command
        )
        restart = next(
            index
            for index, command in enumerate(commands)
            if "compose up -d --no-deps station" in command
        )
        self.assertLess(dependencies, build)
        self.assertLess(build, restart)


if __name__ == "__main__":
    unittest.main()
