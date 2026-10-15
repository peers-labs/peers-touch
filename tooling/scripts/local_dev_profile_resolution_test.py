#!/usr/bin/env python3

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent / "local-dev"


class LocalDevProfileResolutionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        workspace = Path(self.temp_dir.name).resolve()
        self.project_root = workspace / "project"
        self.env_root = workspace / "env"
        scripts = self.project_root / "tooling" / "scripts" / "local-dev"
        scripts.mkdir(parents=True)
        for name in (
            "config.sh",
            "env.sh",
            "machine-dev-lease.py",
            "machine-dev-registry.mjs",
            "machine-dev.mjs",
            "profile.sh",
            "redact-env.sh",
            "workspace-lifecycle-lock.mjs",
        ):
            shutil.copy2(SCRIPT_DIR / name, scripts / name)
        library = self.project_root / "tooling" / "scripts" / "lib"
        library.mkdir(parents=True)
        shutil.copy2(
            SCRIPT_DIR.parent / "lib" / "machine-dev-paths.mjs",
            library / "machine-dev-paths.mjs",
        )
        self.config_script = scripts / "config.sh"
        self.profile_script = scripts / "profile.sh"
        self.machine_script = scripts / "machine-dev.mjs"
        self.machine_dev_root = workspace / "machine-dev"

        local_dev = self.project_root / ".local" / "dev"
        profiles = local_dev / "profiles"
        active = local_dev / "active"
        profiles.mkdir(parents=True)
        active.mkdir()
        (local_dev / "profile").write_text(
            "wrong-shared-profile\n",
            encoding="utf-8",
        )

        canonical_dir = self.env_root / "peers-touch" / "three"
        canonical_dir.mkdir(parents=True)
        self.canonical_profile = canonical_dir / "profile.env.example"
        self.canonical_profile.write_text(
            "\n".join(
                (
                    "PT_DEV_PROFILE=three",
                    "PT_STATION_MODE=remote",
                    "PT_STATION_URL=http://canonical.example:18080",
                    "PT_API_TOKEN=canonical-secret-token",
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
            ["git", "commit", "-qm", "test: add canonical profile"],
            cwd=self.env_root,
            check=True,
        )

        local_profile = profiles / "three.env"
        local_profile.write_text(
            "\n".join(
                (
                    "PT_DEV_PROFILE=three",
                    "PT_STATION_MODE=remote",
                    "PT_STATION_URL=http://stale-cache.example:18132",
                    "",
                )
            ),
            encoding="utf-8",
        )
        (active / "project.env").symlink_to("../profiles/three.env")

        subprocess.run(
            ["git", "init", "-qb", "feat/test"],
            cwd=self.project_root,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Local Dev Test"],
            cwd=self.project_root,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.email", "local-dev-test@example.invalid"],
            cwd=self.project_root,
            check=True,
        )
        (self.project_root / "README.md").write_text("fixture\n", encoding="utf-8")
        subprocess.run(["git", "add", "README.md"], cwd=self.project_root, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "test: initialize workspace"],
            cwd=self.project_root,
            check=True,
        )

    def tearDown(self) -> None:
        path = Path(self.temp_dir.name)
        self.temp_dir._finalizer.detach()
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

    def process_environment(self, **environment: str) -> dict[str, str]:
        process_environment = os.environ.copy()
        process_environment["PT_MACHINE_DEV_ROOT"] = str(self.machine_dev_root)
        process_environment.update(environment)
        return process_environment

    def run_config_result(
        self,
        **environment: str,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["/bin/bash", str(self.config_script)],
            capture_output=True,
            env=self.process_environment(**environment),
            text=True,
            check=False,
        )

    def run_config(self, **environment: str) -> str:
        result = self.run_config_result(**environment)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def run_profile(
        self,
        command: str,
        profile: str,
        **environment: str,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["/bin/bash", str(self.profile_script), command, profile],
            capture_output=True,
            env=self.process_environment(**environment),
            text=True,
            check=False,
        )

    def run_machine(
        self,
        action: str,
        *arguments: str,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "node",
                str(self.machine_script),
                action,
                "--workspace-root",
                str(self.project_root),
                "--env-repo",
                str(self.env_root),
                *arguments,
            ],
            capture_output=True,
            env=self.process_environment(),
            text=True,
            check=False,
        )

    def register_profile(
        self,
        profile: str,
        *,
        slot: int = 5,
    ) -> subprocess.CompletedProcess[str]:
        return self.run_machine(
            "register",
            "--profile",
            profile,
            "--slot",
            str(slot),
            "--capabilities",
            "station.connect",
            "--purpose",
            "local dev profile resolution test",
            "--owner",
            "local-dev-test@example.invalid",
        )

    def test_config_uses_same_canonical_env_profile_as_runtime(self) -> None:
        registered = self.register_profile("three")
        self.assertEqual(registered.returncode, 0, registered.stderr)
        output = self.run_config()

        self.assertIn(f"Profile file : {self.canonical_profile}", output)
        self.assertIn(
            "PT_STATION_URL=http://canonical.example:18080",
            output,
        )
        self.assertNotIn("stale-cache.example", output)
        self.assertNotIn("wrong-shared-profile", output)
        self.assertIn("PT_API_TOKEN=[REDACTED]", output)
        self.assertNotIn("canonical-secret-token", output)

    def test_explicit_profile_override_remains_authoritative(self) -> None:
        registered = self.register_profile("three")
        self.assertEqual(registered.returncode, 0, registered.stderr)
        override = Path(self.temp_dir.name) / "override.env"
        override.write_text(
            "\n".join(
                (
                    "PT_DEV_PROFILE=override",
                    "PT_STATION_MODE=remote",
                    "PT_STATION_URL=http://override.example:19080",
                    "",
                )
            ),
            encoding="utf-8",
        )

        output = self.run_config(
            PT_DEV_PROFILE_FILE=str(override),
            PT_DEV_PROFILE_FILE_AUTHORITY="acceptance-runtime-manifest",
            PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT=str(override.parent),
        )

        self.assertIn(f"Profile file : {override.resolve()}", output)
        self.assertIn(
            "PT_STATION_URL=http://override.example:19080",
            output,
        )
        self.assertNotIn("canonical.example", output)

    def test_explicit_profile_override_rejects_missing_runtime_authority(self) -> None:
        registered = self.register_profile("three")
        self.assertEqual(registered.returncode, 0, registered.stderr)
        override = Path(self.temp_dir.name) / "override.env"
        override.write_text(
            "PT_DEV_PROFILE=override\nPT_STATION_MODE=remote\n",
            encoding="utf-8",
        )

        result = self.run_config_result(PT_DEV_PROFILE_FILE=str(override))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "requires acceptance-runtime-manifest authority",
            result.stderr + result.stdout,
        )

    def test_legacy_activation_command_is_removed(self) -> None:
        local_profile = (
            self.project_root / ".local" / "dev" / "profiles" / "three.env"
        )
        before = local_profile.read_text(encoding="utf-8")
        result = self.run_profile("activate", "three")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "Usage: profile.sh {init|list}",
            result.stderr + result.stdout,
        )

        self.assertEqual(local_profile.read_text(encoding="utf-8"), before)
        active_profile = (
            self.project_root / ".local" / "dev" / "active" / "project.env"
        )
        self.assertEqual(os.readlink(active_profile), "../profiles/three.env")

    def test_config_rejects_untracked_env_profile(self) -> None:
        untracked_dir = self.env_root / "peers-touch" / "untracked"
        untracked_dir.mkdir()
        (untracked_dir / "profile.env.example").write_text(
            "\n".join(
                (
                    "PT_DEV_PROFILE=untracked",
                    "PT_DEV_SLOT=2",
                    "PT_STATION_MODE=remote",
                    "PT_STATION_URL=http://untracked.example:18080",
                    "",
                )
            ),
            encoding="utf-8",
        )
        result = self.register_profile("untracked")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "cannot resolve profile definition",
            result.stderr + result.stdout,
        )

    def test_config_rejects_dirty_tracked_env_profile(self) -> None:
        self.canonical_profile.write_text(
            self.canonical_profile.read_text(encoding="utf-8")
            + "PT_STATION_URL=http://dirty.example:18080\n",
            encoding="utf-8",
        )

        result = self.register_profile("three")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "dirty or untracked environment definitions",
            result.stderr + result.stdout,
        )

    def test_config_accepts_worktree_local_profile(self) -> None:
        local_profile = self.project_root / ".local" / "dev" / "profiles" / "local.env"
        local_profile.write_text(
            "\n".join(
                (
                    "PT_DEV_PROFILE=local",
                    "PT_DEV_SLOT=4",
                    "PT_STATION_MODE=compose",
                    "PT_STATION_URL=http://127.0.0.1:18480",
                    "",
                )
            ),
            encoding="utf-8",
        )
        result = self.register_profile("local")

        self.assertEqual(result.returncode, 0, result.stderr)
        output = self.run_config()
        self.assertIn("PT_DEV_PROFILE=local", output)

    def test_profile_init_creates_local_profile_without_receipt(self) -> None:
        created = self.run_profile("init", "local-one", SLOT="5")
        self.assertEqual(created.returncode, 0, created.stderr)

        registered = self.register_profile("local-one", slot=5)
        self.assertEqual(registered.returncode, 0, registered.stderr)
        output = self.run_config()
        self.assertIn("PT_DEV_PROFILE=local-one", output)
        self.assertIn("PT_DEV_SLOT=5", output)

        repeated = self.run_profile("init", "local-one", SLOT="5")
        self.assertNotEqual(repeated.returncode, 0)
        self.assertIn("never overwrites", repeated.stderr + repeated.stdout)

    def test_local_profile_changes_are_read_directly(self) -> None:
        created = self.run_profile("init", "local-four", SLOT="9")
        self.assertEqual(created.returncode, 0, created.stderr)
        registered = self.register_profile("local-four", slot=9)
        self.assertEqual(registered.returncode, 0, registered.stderr)

        profile = self.project_root / ".local" / "dev" / "profiles" / "local-four.env"
        profile.write_text(
            profile.read_text(encoding="utf-8")
            + "PT_STATION_URL=http://modified.example:19080\n",
            encoding="utf-8",
        )
        output = self.run_config()
        self.assertIn("PT_STATION_URL=http://modified.example:19080", output)


if __name__ == "__main__":
    unittest.main()
