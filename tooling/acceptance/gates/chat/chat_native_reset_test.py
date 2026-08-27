from __future__ import annotations

from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.fixtures.chat_native_reset import (
    CHAT_TABLES,
    acceptance_station_environment,
    reset_local_client_storage,
    reset_station_messaging_state,
    verify_disposable_station_runtime,
)


DISPOSABLE_ENVIRONMENT = {
    "PT_DEPLOY_HOST": "10.37.94.156",
    "PT_DEPLOY_USER": "acceptance",
    "PT_ACCEPTANCE_DISPOSABLE": "1",
    "PT_ACCEPTANCE_STATION_URL": "http://10.37.94.156:18132",
    "PT_ACCEPTANCE_COMPOSE_PROJECT": "pt-chat-native-acceptance",
    "PT_ACCEPTANCE_STATION_CONTAINER": "pt-chat-native-acceptance-station-1",
    "PT_ACCEPTANCE_POSTGRES_CONTAINER": "pt-chat-native-acceptance-postgres-1",
    "PT_ACCEPTANCE_POSTGRES_VOLUME": "pt-chat-native-acceptance_pg_data",
}


class DisposableAcceptanceTargetTest(unittest.TestCase):
    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
        return_value=DISPOSABLE_ENVIRONMENT,
    )
    def test_accepts_exact_disposable_station_url(self, _environment) -> None:
        resolved = acceptance_station_environment(
            "http://10.37.94.156:18132/",
            "chat-native-acceptance",
        )
        self.assertEqual(resolved["PT_DEPLOY_HOST"], "10.37.94.156")

    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
        return_value=DISPOSABLE_ENVIRONMENT,
    )
    def test_rejects_non_disposable_targets(self, _environment) -> None:
        for station_url in (
            "http://127.0.0.1:18080",
            "http://10.37.94.156:8080",
            "http://10.37.94.156:18132/other",
            "http://10.37.94.156:18132/?target=other",
        ):
            with self.subTest(station_url=station_url):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "Disposable Chat Acceptance target mismatch",
                ):
                    acceptance_station_environment(
                        station_url,
                        "chat-native-acceptance",
                    )

    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
        return_value={
            **DISPOSABLE_ENVIRONMENT,
            "PT_ACCEPTANCE_DISPOSABLE": "0",
        },
    )
    def test_rejects_shared_persistent_station(self, _environment) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "Disposable Chat Acceptance target mismatch",
        ):
            acceptance_station_environment(
                "http://10.37.94.156:18132",
                "station-three",
            )

    @patch(
        "tooling.acceptance.fixtures.chat_native_reset._remote_command"
    )
    def test_runtime_identity_binds_compose_project_and_volume(
        self,
        remote_command,
    ) -> None:
        remote_command.side_effect = [
            json.dumps({
                "Config": {
                    "Labels": {
                        "com.docker.compose.project": (
                            "pt-chat-native-acceptance"
                        ),
                        "com.docker.compose.service": "station",
                    },
                },
                "State": {"Running": True},
                "Mounts": [],
            }),
            json.dumps({
                "Config": {
                    "Labels": {
                        "com.docker.compose.project": (
                            "pt-chat-native-acceptance"
                        ),
                        "com.docker.compose.service": "postgres",
                    },
                },
                "State": {"Running": True},
                "Mounts": [{
                    "Name": "pt-chat-native-acceptance_pg_data",
                    "Destination": "/var/lib/postgresql/data",
                }],
            }),
        ]

        actual = verify_disposable_station_runtime({
            **DISPOSABLE_ENVIRONMENT,
            "PT_ACCEPTANCE_ENVIRONMENT": "chat-native-acceptance",
        })

        self.assertEqual(
            actual["postgresVolume"],
            "pt-chat-native-acceptance_pg_data",
        )

    @patch(
        "tooling.acceptance.fixtures.chat_native_reset._remote_command"
    )
    def test_runtime_identity_rejects_shared_postgres_volume(
        self,
        remote_command,
    ) -> None:
        remote_command.side_effect = [
            json.dumps({
                "Config": {
                    "Labels": {
                        "com.docker.compose.project": (
                            "pt-chat-native-acceptance"
                        ),
                        "com.docker.compose.service": "station",
                    },
                },
                "State": {"Running": True},
                "Mounts": [],
            }),
            json.dumps({
                "Config": {
                    "Labels": {
                        "com.docker.compose.project": (
                            "pt-chat-native-acceptance"
                        ),
                        "com.docker.compose.service": "postgres",
                    },
                },
                "State": {"Running": True},
                "Mounts": [{
                    "Name": "pt-station-a_pg_data",
                    "Destination": "/var/lib/postgresql/data",
                }],
            }),
        ]

        with self.assertRaisesRegex(RuntimeError, "volume mismatch"):
            verify_disposable_station_runtime({
                **DISPOSABLE_ENVIRONMENT,
                "PT_ACCEPTANCE_ENVIRONMENT": "chat-native-acceptance",
            })

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
        "tooling.acceptance.fixtures.chat_native_reset.verify_disposable_station_runtime"
    )
    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
        return_value=DISPOSABLE_ENVIRONMENT,
    )
    def test_station_reset_clears_sessions_and_restores_preset_credentials(
        self,
        _environment,
        _runtime,
        run,
    ) -> None:
        reset_station_messaging_state("chat-native-acceptance")
        sql = run.call_args.kwargs["input"]
        self.assertIn("actor_sessions", CHAT_TABLES)
        self.assertIn("friend_chat_friend_requests", CHAT_TABLES)
        self.assertIn("friend_chat_friendships", CHAT_TABLES)
        self.assertIn("TRUNCATE TABLE", sql)
        self.assertIn("SELECT password_hash INTO STRICT preset_hash", sql)
        self.assertIn(
            "WHERE email IN ('alice@p.t', 'bob@p.t', 'carol@p.t')",
            sql,
        )
        self.assertIn("updated_count <> 3", sql)
        self.assertIn("mutual_follow_count <> 6", sql)
        self.assertIn("INSERT INTO friend_chat_friend_requests", sql)
        self.assertIn("'acceptance-alice-bob'", sql)
        self.assertIn("'acceptance-alice-carol'", sql)
        self.assertIn("'acceptance-bob-carol'", sql)

if __name__ == "__main__":
    unittest.main()
