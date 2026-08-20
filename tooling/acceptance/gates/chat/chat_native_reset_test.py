from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.fixtures.chat_native_reset import (
    CHAT_TABLES,
    profile_three_environment,
    reset_local_client_storage,
    reset_station_messaging_state,
)


class ProfileThreeTargetTest(unittest.TestCase):
    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
        return_value={
            "PT_DEPLOY_HOST": "10.37.94.156",
            "PT_DEPLOY_USER": "acceptance",
        },
    )
    def test_accepts_exact_profile_three_station_url(self, _environment) -> None:
        resolved = profile_three_environment("http://10.37.94.156:18080/")
        self.assertEqual(resolved["PT_DEPLOY_HOST"], "10.37.94.156")

    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
        return_value={
            "PT_DEPLOY_HOST": "10.37.94.156",
            "PT_DEPLOY_USER": "acceptance",
        },
    )
    def test_rejects_non_profile_three_targets(self, _environment) -> None:
        for station_url in (
            "http://127.0.0.1:18080",
            "http://10.37.94.156:8080",
            "http://10.37.94.156:18080/other",
            "http://10.37.94.156:18080/?target=other",
        ):
            with self.subTest(station_url=station_url):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "Profile Three target mismatch",
                ):
                    profile_three_environment(station_url)

    def test_reset_removes_stale_session_vault_and_recreates_storage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stale_session = (
                root
                / "alice"
                / "storage"
                / "peers-touch"
                / "desktop"
                / "data"
                / "auth"
                / "sessions"
                / "stale.json"
            )
            stale_session.parent.mkdir(parents=True)
            stale_session.write_text("stale", encoding="utf-8")

            reset = reset_local_client_storage(["alice"], root)

            self.assertEqual(reset, 1)
            storage = root / "alice" / "storage"
            self.assertTrue(storage.is_dir())
            self.assertEqual(list(storage.iterdir()), [])

    def test_reset_rejects_unknown_account_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(
                RuntimeError,
                "unsupported native Chat fixture account",
            ):
                reset_local_client_storage(["../outside"], Path(directory))

    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.subprocess.run"
    )
    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
        return_value={
            "PT_DEPLOY_HOST": "10.37.94.156",
            "PT_DEPLOY_USER": "acceptance",
        },
    )
    def test_station_reset_clears_sessions_and_restores_preset_credentials(
        self,
        _environment,
        run,
    ) -> None:
        reset_station_messaging_state("station-three")
        sql = run.call_args.kwargs["input"]
        self.assertIn("actor_sessions", CHAT_TABLES)
        self.assertIn("TRUNCATE TABLE", sql)
        self.assertIn("SELECT password_hash INTO STRICT preset_hash", sql)
        self.assertIn(
            "WHERE email IN ('alice@p.t', 'bob@p.t', 'carol@p.t')",
            sql,
        )
        self.assertIn("updated_count <> 3", sql)

    def test_station_reset_rejects_other_deploy_environments(self) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "restricted to station-three",
        ):
            reset_station_messaging_state("station-1")


if __name__ == "__main__":
    unittest.main()
