from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.fixtures.chat_native_reset import (
    CHAT_RESET_TABLES,
    acceptance_station_environment,
    reset_local_client_storage,
    reset_station_chat_state,
)


DISPOSABLE_ENVIRONMENT = {
    "PT_DEPLOY_HOST": "10.37.94.156",
    "PT_DEPLOY_USER": "acceptance",
    "PT_ACCEPTANCE_DISPOSABLE": "1",
    "PT_ACCEPTANCE_STATION_URL": "http://10.37.94.156:18132",
    "PT_ACCEPTANCE_COMPOSE_PROJECT": "pt-chat-acceptance",
    "PT_ACCEPTANCE_STATION_CONTAINER": "pt-chat-station",
    "PT_ACCEPTANCE_POSTGRES_CONTAINER": "pt-chat-postgres",
    "PT_ACCEPTANCE_POSTGRES_VOLUME": "pt-chat-postgres-data",
}


class AcceptanceStationTargetTest(unittest.TestCase):
    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
        return_value=DISPOSABLE_ENVIRONMENT,
    )
    def test_accepts_exact_disposable_station_url(self, _environment) -> None:
        resolved = acceptance_station_environment(
            "http://10.37.94.156:18132/",
            "station-three",
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
                with self.assertRaises(RuntimeError):
                    acceptance_station_environment(station_url, "station-three")

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
        "tooling.acceptance.fixtures.chat_native_reset._remote_transport"
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
        _verify_runtime,
        transport,
    ) -> None:
        reset_station_chat_state("station-three")
        sql = transport.return_value.run_argv.call_args.kwargs["input_text"]
        self.assertIn("actor_sessions", CHAT_RESET_TABLES)
        self.assertIn("TRUNCATE TABLE", sql)
        for table in (
            "conversations",
            "conversation_events",
            "conversation_read_cursors",
            "conversation_delivery_commitments",
            "conversation_delivery_receipts",
            "device_queue_lanes",
            "device_queue_items",
            "recovery_revisions",
            "federation_delivery_inbox",
            "federation_delivery_outbox",
        ):
            self.assertIn(table, CHAT_RESET_TABLES)
        self.assertFalse(
            [table for table in CHAT_RESET_TABLES if table.startswith("messaging_")]
        )
        self.assertNotIn("messaging_", sql)
        self.assertIn("SELECT password_hash INTO STRICT preset_hash", sql)
        self.assertIn(
            "WHERE email IN ('alice@p.t', 'bob@p.t', 'carol@p.t')",
            sql,
        )
        self.assertIn("updated_count <> 3", sql)
        self.assertIn("mutual_follow_count <> 6", sql)
        self.assertIn("INSERT INTO friend_chat_friend_requests", sql)
        self.assertIn("sender_ptid", sql)
        self.assertIn("receiver_ptid", sql)
        self.assertNotIn("sender_did", sql)
        self.assertNotIn("receiver_did", sql)
        for actor in ("alice", "bob", "carol"):
            self.assertIn(
                f"SELECT id, ptid INTO STRICT {actor}_actor_id, {actor}_actor_ptid",
                sql,
            )
            self.assertIn(
                f"coalesce({actor}_actor_ptid, '') ~ '^ptid:.+$'",
                sql,
            )
        self.assertIn("native Chat preset actor PTIDs are invalid", sql)
        self.assertNotIn("_actor_id::text", sql)
        self.assertEqual(sql.count("LEAST("), 3)
        self.assertEqual(sql.count("GREATEST("), 3)
        self.assertIn("'acceptance-alice-bob'", sql)
        self.assertIn("'acceptance-alice-carol'", sql)
        self.assertIn("'acceptance-bob-carol'", sql)

if __name__ == "__main__":
    unittest.main()
