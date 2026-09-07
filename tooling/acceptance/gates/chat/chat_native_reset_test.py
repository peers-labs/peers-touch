from __future__ import annotations

from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.fixtures.chat_native_reset import (
    CHAT_TABLES,
    FixtureActorRecord,
    _remote_transport,
    acceptance_station_environment,
    reset_local_client_storage,
    reset_station_chat_state,
    seed_cross_station_contact,
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

    def test_hard_rejects_protected_station_and_webdriver_ports(self) -> None:
        for port in (18080, 4445):
            environment = {
                **DISPOSABLE_ENVIRONMENT,
                "PT_ACCEPTANCE_STATION_URL": (
                    f"http://10.37.94.156:{port}"
                ),
            }
            with self.subTest(port=port):
                with patch(
                    "tooling.acceptance.fixtures.chat_native_reset."
                    "deploy_environment",
                    return_value=environment,
                ):
                    with self.assertRaisesRegex(
                        RuntimeError,
                        f"protected cleanup target port: {port}",
                    ):
                        acceptance_station_environment(
                            f"http://10.37.94.156:{port}",
                            "chat-native-acceptance",
                        )

    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
        return_value={
            **DISPOSABLE_ENVIRONMENT,
            "PT_ACCEPTANCE_STATION_URL": "http://10.37.94.156:18133",
        },
    )
    def test_rejects_unapproved_disposable_station_port(
        self,
        _environment,
    ) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "Disposable Chat Acceptance target mismatch",
        ):
            acceptance_station_environment(
                "http://10.37.94.156:18133",
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

    def test_remote_transport_requires_strict_host_verification(self) -> None:
        transport = _remote_transport(DISPOSABLE_ENVIRONMENT)
        command = transport.command_prefix()

        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertNotIn("StrictHostKeyChecking=no", command)

    @patch(
        "tooling.acceptance.fixtures.chat_native_reset._remote_psql"
    )
    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.verify_disposable_station_runtime"
    )
    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.acceptance_station_environment",
        return_value=DISPOSABLE_ENVIRONMENT,
    )
    def test_cross_station_contact_seeds_complete_accepted_relationship(
        self,
        _environment,
        _runtime,
        remote_psql,
    ) -> None:
        peer = FixtureActorRecord(
            ptid="ptid:v1:actor:peers:p:bob:remote",
            preferred_username="bob",
            name="Bob",
            summary="",
            icon="",
            image="",
            url="https://station-five.example/actors/bob",
            federated_handle="@bob@station-five.example",
            home_station_peer_id="station-five",
            home_station_domain="station-five.example",
            visibility=1,
            locator_seq=1,
        )

        seed_cross_station_contact(
            "http://10.37.94.156:18132",
            "chat-native-acceptance",
            "ptid:v1:actor:peers:p:alice:local",
            peer,
        )

        sql = remote_psql.call_args.args[1]
        follow_insert = sql.index("INSERT INTO follows")
        request_insert = sql.index("INSERT INTO friend_chat_friend_requests")
        self.assertLess(follow_insert, request_insert)
        self.assertIn("LOCK TABLE follows IN SHARE ROW EXCLUSIVE MODE", sql)
        self.assertIn(
            "ON CONFLICT (follower_id, following_id) DO NOTHING",
            sql,
        )
        self.assertIn(
            "SELECT actor_id AS follower_id, peer_id AS following_id",
            sql,
        )
        self.assertIn(
            "SELECT peer_id AS follower_id, actor_id AS following_id",
            sql,
        )
        self.assertIn("relationship_edge_count <> 2", sql)
        self.assertIn(
            "cross-Station accepted relationship is incomplete",
            sql,
        )

    @patch(
        "tooling.acceptance.fixtures.chat_native_reset.SshTransport.run_argv"
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
        reset_station_chat_state("chat-native-acceptance")
        sql = run.call_args.kwargs["input_text"]
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

    def test_station_reset_uses_only_canonical_chat_owner_tables(self) -> None:
        required_tables = {
            "actor_endpoint_directory_versions",
            "conversation_attachment_audits",
            "conversation_authority_plans",
            "conversation_delivery_commitments",
            "conversation_delivery_receipts",
            "conversation_event_projection_grants",
            "conversation_events",
            "conversation_follower_heads",
            "conversation_follower_members",
            "conversation_follower_pending_events",
            "conversation_follower_states",
            "conversation_read_cursors",
            "federation_delivery_inbox",
            "federation_delivery_outbox",
            "key_exchange_identity_keys",
            "recovery_revisions",
            "social_friend_request_commands",
            "social_friend_request_effects",
            "social_friend_requests",
            "social_relationship_projections",
        }

        self.assertEqual(required_tables - set(CHAT_TABLES), set())
        self.assertFalse(
            [table for table in CHAT_TABLES if table.startswith("messaging_")]
        )

if __name__ == "__main__":
    unittest.main()
