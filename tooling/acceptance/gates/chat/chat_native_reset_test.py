from __future__ import annotations

from pathlib import Path
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.fixtures.chat_native_reset import (
    CHAT_TABLES,
    RETIRED_CHAT_TABLES,
    FixtureActorRecord,
    _remote_transport,
    acceptance_station_environment,
    prepare_local_friend_request_lifecycle,
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

    @patch.dict(os.environ, {}, clear=True)
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

    def test_accepts_exact_profile_authorized_protected_station(self) -> None:
        deployment = {
            "PT_DEPLOY_HOST": "10.37.245.247",
            "PT_DEPLOY_USER": "acceptance",
            "PT_DEPLOY_RESTART_CMD": (
                "docker compose -p pt-station -f compose.yml "
                "up -d station"
            ),
        }
        profile = {
            "PT_DEV_PROFILE": "four",
            "PT_STATION_DEPLOY_ENV": "station-four",
            "PT_STATION_URL": "http://10.37.245.247:18080",
        }
        with patch.dict(
            os.environ,
            {"CHAT_ACCEPTANCE_RESET_PROFILE": "four"},
            clear=True,
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset."
            "active_profile_environment",
            return_value=profile,
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
            return_value=deployment,
        ):
            resolved = acceptance_station_environment(
                "",
                "station-four",
            )

        self.assertEqual(
            resolved["PT_ACCEPTANCE_STATION_URL"],
            "http://10.37.245.247:18080",
        )
        self.assertEqual(
            resolved["PT_ACCEPTANCE_STATION_CONTAINER"],
            "pt-station-station-1",
        )
        self.assertEqual(
            resolved["PT_ACCEPTANCE_POSTGRES_CONTAINER"],
            "pt-station-postgres-1",
        )
        self.assertEqual(
            resolved["PT_ACCEPTANCE_POSTGRES_VOLUME"],
            "pt-station_pg_data",
        )

    def test_rejects_profile_authorization_for_another_target(self) -> None:
        deployment = {
            "PT_DEPLOY_HOST": "10.37.245.247",
            "PT_DEPLOY_USER": "acceptance",
            "PT_DEPLOY_RESTART_CMD": (
                "docker compose -p pt-station -f compose.yml "
                "up -d station"
            ),
        }
        profile = {
            "PT_DEV_PROFILE": "four",
            "PT_STATION_DEPLOY_ENV": "station-four",
            "PT_STATION_URL": "http://10.37.245.247:18080",
        }
        with patch.dict(
            os.environ,
            {"CHAT_ACCEPTANCE_RESET_PROFILE": "five"},
            clear=True,
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset."
            "active_profile_environment",
            return_value=profile,
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
            return_value=deployment,
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "Profile-authorized Chat Acceptance reset target mismatch",
            ):
                acceptance_station_environment(
                    "http://10.37.245.247:18080",
                    "station-four",
                )

    def test_accepts_exact_environment_authorized_protected_stations(self) -> None:
        deployments = {
            "station-four": {
                "PT_DEPLOY_HOST": "10.37.245.247",
                "PT_DEPLOY_USER": "acceptance",
                "PT_DEPLOY_HEALTH_URL": (
                    "http://10.37.245.247:18080/sub-oss/healthz"
                ),
                "PT_DEPLOY_RESTART_CMD": (
                    "docker compose -p pt-station -f compose.yml "
                    "up -d station"
                ),
            },
            "station-five-arm": {
                "PT_DEPLOY_HOST": "10.37.221.38",
                "PT_DEPLOY_USER": "acceptance",
                "PT_DEPLOY_HEALTH_URL": (
                    "http://10.37.221.38:18080/sub-oss/healthz"
                ),
                "PT_DEPLOY_RESTART_CMD": (
                    "docker compose -p pt-station -f compose.yml "
                    "up -d station"
                ),
            },
        }
        with patch.dict(
            os.environ,
            {
                "CHAT_ACCEPTANCE_RESET_ENVIRONMENTS": (
                    "station-four,station-five-arm"
                )
            },
            clear=True,
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset."
            "deploy_environment",
            side_effect=lambda name: deployments[name],
        ):
            four = acceptance_station_environment(
                "http://10.37.245.247:18080",
                "station-four",
            )
            five = acceptance_station_environment(
                "http://10.37.221.38:18080",
                "station-five-arm",
            )
            five_from_environment = acceptance_station_environment(
                "",
                "station-five-arm",
            )

        self.assertEqual(
            four["PT_ACCEPTANCE_STATION_URL"],
            "http://10.37.245.247:18080",
        )
        self.assertEqual(
            five["PT_ACCEPTANCE_STATION_URL"],
            "http://10.37.221.38:18080",
        )
        self.assertEqual(
            five_from_environment["PT_ACCEPTANCE_STATION_URL"],
            "http://10.37.221.38:18080",
        )
        self.assertEqual(four["PT_ACCEPTANCE_COMPOSE_PROJECT"], "pt-station")
        self.assertEqual(five["PT_ACCEPTANCE_COMPOSE_PROJECT"], "pt-station")

    def test_rejects_unlisted_environment_authorization(self) -> None:
        deployment = {
            "PT_DEPLOY_HOST": "10.37.221.38",
            "PT_DEPLOY_USER": "acceptance",
            "PT_DEPLOY_HEALTH_URL": (
                "http://10.37.221.38:18080/sub-oss/healthz"
            ),
            "PT_DEPLOY_RESTART_CMD": (
                "docker compose -p pt-station -f compose.yml "
                "up -d station"
            ),
        }
        with patch.dict(
            os.environ,
            {"CHAT_ACCEPTANCE_RESET_ENVIRONMENTS": "station-four"},
            clear=True,
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset."
            "deploy_environment",
            return_value=deployment,
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "Environment-authorized Chat Acceptance reset target mismatch",
            ):
                acceptance_station_environment(
                    "http://10.37.221.38:18080",
                    "station-five-arm",
                )

    def test_rejects_ambiguous_reset_authorization_modes(self) -> None:
        with patch.dict(
            os.environ,
            {
                "CHAT_ACCEPTANCE_RESET_PROFILE": "four",
                "CHAT_ACCEPTANCE_RESET_ENVIRONMENTS": "station-four",
            },
            clear=True,
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset."
            "deploy_environment",
            return_value={},
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "exactly one authorization mode",
            ):
                acceptance_station_environment(
                    "http://10.37.245.247:18080",
                    "station-four",
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

    def test_friend_request_lifecycle_removes_only_the_selected_pair(
        self,
    ) -> None:
        sender_ptid = "ptid:v1:actor:peers:p:alice:fingerprint"
        receiver_ptid = "ptid:v1:actor:peers:p:bob:fingerprint"
        with patch.dict(
            os.environ,
            {"CHAT_ACCEPTANCE_RESET": "1"},
            clear=True,
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset."
            "deploy_environment",
            return_value=DISPOSABLE_ENVIRONMENT,
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset."
            "acceptance_station_environment",
            return_value=DISPOSABLE_ENVIRONMENT,
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset."
            "verify_disposable_station_runtime",
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset._remote_psql",
        ) as remote_psql:
            prepare_local_friend_request_lifecycle(
                "chat-native-acceptance",
                sender_ptid,
                receiver_ptid,
            )

        sql = remote_psql.call_args.args[1]
        self.assertIn("DELETE FROM follows", sql)
        self.assertIn(sender_ptid, sql)
        self.assertIn(receiver_ptid, sql)
        self.assertIn(
            "friend-request lifecycle relationship reset is incomplete",
            sql,
        )

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
        actor = FixtureActorRecord(
            ptid="ptid:v1:actor:peers:p:alice:local",
            preferred_username="alice",
            name="Alice",
            summary="",
            icon="",
            image="",
            url="https://station-four.example/actors/alice",
            federated_handle="@alice@station-four.example",
            home_station_peer_id="station-four",
            home_station_domain="station-four.example",
            visibility=1,
            locator_seq=1,
        )
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
            actor,
            peer,
        )

        sql = remote_psql.call_args.args[1]
        self.assertIn("INSERT INTO follows", sql)
        self.assertIn("INSERT INTO federation", sql)
        self.assertIn("INSERT INTO federation_station_membership", sql)
        self.assertIn("INSERT INTO social_friend_requests", sql)
        self.assertIn("INSERT INTO social_relationship_projections", sql)
        self.assertNotIn("INSERT INTO friend_chat_friend_requests", sql)
        self.assertNotIn("DELETE FROM touch_actor", sql)
        self.assertIn("ON CONFLICT (federated_handle) DO UPDATE SET", sql)
        self.assertIn("touch_actor.origin = 'remote_cached'", sql)
        self.assertIn(
            "cross-Station remote Actor projection is incomplete",
            sql,
        )
        self.assertIn("authority_confirmed", sql)
        self.assertIn("canonical accepted Friend Request projection", sql)
        self.assertIn("Chat fixture Federation membership", sql)
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
    @patch.dict(os.environ, {"CHAT_ACCEPTANCE_RESET": "1"})
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
        self.assertIn("friend_chat_friend_requests", RETIRED_CHAT_TABLES)
        self.assertIn("friend_chat_friendships", CHAT_TABLES)
        self.assertIn("TRUNCATE TABLE", sql)
        self.assertIn("FROM pg_tables", sql)
        self.assertIn("tablename = ANY", sql)
        self.assertIn("IF existing_tables IS NOT NULL", sql)
        self.assertNotIn(
            f"TRUNCATE TABLE {', '.join(CHAT_TABLES)}",
            sql,
        )
        self.assertIn(
            f"DROP TABLE IF EXISTS {', '.join(RETIRED_CHAT_TABLES)} CASCADE",
            sql,
        )
        self.assertIn("SELECT password_hash INTO STRICT preset_hash", sql)
        self.assertIn(
            "WHERE email IN ('alice@p.t', 'bob@p.t', 'carol@p.t')",
            sql,
        )
        self.assertIn("updated_count <> 3", sql)
        self.assertIn("mutual_follow_count <> 6", sql)
        self.assertIn("WITH preset_edges(follower_id, following_id)", sql)
        self.assertIn("INSERT INTO follows", sql)
        self.assertIn(
            "WHERE NOT EXISTS",
            sql,
        )
        self.assertNotIn("INSERT INTO friend_chat_friend_requests", sql)
        self.assertNotIn("INSERT INTO social_friend_requests", sql)
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

    @patch.dict(os.environ, {}, clear=True)
    def test_station_reset_requires_explicit_authorization(self) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "CHAT_ACCEPTANCE_RESET=1 is required",
        ):
            reset_station_chat_state("chat-native-acceptance")

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
            "key_exchange_direct_fetch_receipts",
            "key_exchange_identity_keys",
            "key_exchange_mls_fetch_receipts",
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
        self.assertEqual(set(CHAT_TABLES) & set(RETIRED_CHAT_TABLES), set())
        self.assertNotIn("touch_actor", CHAT_TABLES)
        self.assertNotIn("touch_actor", RETIRED_CHAT_TABLES)
        self.assertEqual(
            {
                "conversation_command_proposals",
                "envelope_idempotency",
                "envelope_inbox",
                "envelope_outbox",
                "federated_endpoint_manifests",
                "messaging_event_projection_targets",
                "messaging_follower_conversations",
                "messaging_follower_event_receipts",
                "messaging_follower_members",
                "messaging_follower_pending_events",
            }
            - set(RETIRED_CHAT_TABLES),
            set(),
        )

if __name__ == "__main__":
    unittest.main()
