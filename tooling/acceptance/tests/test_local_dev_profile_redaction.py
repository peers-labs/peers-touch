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
WINDOWS_GIT_BASH = Path("C:/Program Files/Git/bin/bash.exe")
BASH = shutil.which("bash") or (
    str(WINDOWS_GIT_BASH) if WINDOWS_GIT_BASH.is_file() else "/bin/bash"
)


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
                    "PT_GO_BIN=/synthetic/go/bin",
                    "PT_PYTHON_BIN=/synthetic/python/bin",
                    "PT_NODE_BIN=/synthetic/node/bin",
                    "PT_NPM_BIN=/synthetic/npm/bin",
                    "PT_PROTOC_BIN=/synthetic/protoc/bin",
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
            [BASH, str(self.script_root / script_name), *arguments],
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

    def test_profile_values_are_exported_to_child_processes(self) -> None:
        environment = os.environ.copy()
        environment["PT_DEV_PROFILE_FILE"] = str(self.profile)
        completed = subprocess.run(
            [
                BASH,
                "-c",
                (
                    f'source "{self.script_root / "env.sh"}"; '
                    "bash -c 'printf %s \"$PT_STATION_URL\"'"
                ),
            ],
            cwd=self.project_root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout, "http://station.example:18080")

    def test_profile_tool_bins_are_exported_on_path(self) -> None:
        environment = os.environ.copy()
        environment["PT_DEV_PROFILE_FILE"] = str(self.profile)
        completed = subprocess.run(
            [
                BASH,
                "-c",
                (
                    f'source "{self.script_root / "env.sh"}"; '
                    "bash -c 'case \":$PATH:\" in "
                    "*\":$PT_GO_BIN:\"*) ;; *) exit 11;; esac; "
                    "case \":$PATH:\" in "
                    "*\":$PT_PYTHON_BIN:\"*) ;; *) exit 12;; esac; "
                    "case \":$PATH:\" in "
                    "*\":$PT_NODE_BIN:\"*) ;; *) exit 13;; esac; "
                    "case \":$PATH:\" in "
                    "*\":$PT_NPM_BIN:\"*) ;; *) exit 14;; esac; "
                    "case \":$PATH:\" in "
                    "*\":$PT_PROTOC_BIN:\"*) ;; *) exit 15;; esac'"
                ),
            ],
            cwd=self.project_root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_profile_activation_redacts_sensitive_profile_values(self) -> None:
        completed = self.run_script("profile.sh", "activate", "one")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("PT_STATION_URL=http://station.example:18080", completed.stdout)
        self.assertIn("PT_AGENT_PROVIDER_API_KEY=[REDACTED]", completed.stdout)
        self.assertNotIn(SECRET_CANARY, completed.stdout)
        self.assertNotIn(SECRET_CANARY, completed.stderr)


if __name__ == "__main__":
    unittest.main()
