#!/usr/bin/env python3

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent / "local-dev"


class LocalDevProfileResolutionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        workspace = Path(self.temp_dir.name)
        self.project_root = workspace / "project"
        self.env_root = workspace / "env"
        scripts = self.project_root / "tooling" / "scripts" / "local-dev"
        scripts.mkdir(parents=True)
        shutil.copy2(SCRIPT_DIR / "env.sh", scripts / "env.sh")
        shutil.copy2(SCRIPT_DIR / "config.sh", scripts / "config.sh")
        shutil.copy2(SCRIPT_DIR / "profile.sh", scripts / "profile.sh")
        shutil.copy2(SCRIPT_DIR / "redact-env.sh", scripts / "redact-env.sh")
        self.config_script = scripts / "config.sh"
        self.profile_script = scripts / "profile.sh"

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

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def run_config(self, **environment: str) -> str:
        process_environment = os.environ.copy()
        process_environment.update(environment)
        return subprocess.run(
            ["/bin/bash", str(self.config_script)],
            check=True,
            capture_output=True,
            env=process_environment,
            text=True,
        ).stdout

    def test_config_uses_same_canonical_env_profile_as_runtime(self) -> None:
        output = self.run_config()

        self.assertIn(f"File: {self.canonical_profile}", output)
        self.assertIn(
            "PT_STATION_URL=http://canonical.example:18080",
            output,
        )
        self.assertNotIn("stale-cache.example", output)
        self.assertNotIn("wrong-shared-profile", output)
        self.assertIn("PT_API_TOKEN=[REDACTED]", output)
        self.assertNotIn("canonical-secret-token", output)

    def test_explicit_profile_override_remains_authoritative(self) -> None:
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

        output = self.run_config(PT_DEV_PROFILE_FILE=str(override))

        self.assertIn(f"File: {override}", output)
        self.assertIn(
            "PT_STATION_URL=http://override.example:19080",
            output,
        )
        self.assertNotIn("canonical.example", output)

    def test_activation_refreshes_local_cache_from_env_source(self) -> None:
        subprocess.run(
            ["/bin/bash", str(self.profile_script), "activate", "three"],
            check=True,
            capture_output=True,
            env=os.environ.copy(),
            text=True,
        )

        local_dev = self.project_root / ".local" / "dev"
        local_profile = local_dev / "profiles" / "three.env"
        active_profile = local_dev / "active" / "project.env"
        self.assertEqual(
            local_profile.read_text(encoding="utf-8"),
            self.canonical_profile.read_text(encoding="utf-8"),
        )
        self.assertEqual(os.readlink(active_profile), "../profiles/three.env")


if __name__ == "__main__":
    unittest.main()
