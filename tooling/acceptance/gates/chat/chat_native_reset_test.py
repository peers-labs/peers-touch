from __future__ import annotations

from contextlib import closing
from pathlib import Path
import json
import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.fixtures.chat_native_reset import (
    CHAT_TABLES,
    RETIRED_CHAT_TABLES,
    FixtureActorRecord,
    _remote_transport,
    acceptance_station_environment,
    duplicate_acceptance_queue_delivery,
    fixture_friendship_federation_id,
    read_fixture_actor,
    reset_local_client_storage,
    reset_station_chat_state,
    seed_cross_station_contact,
    seed_same_station_contact,
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


class FixtureFederationIdentityTest(unittest.TestCase):
    def test_federation_id_is_order_independent_and_actor_bound(self) -> None:
        expected = fixture_friendship_federation_id("ptid:alice", "ptid:bob")
        self.assertEqual(
            fixture_friendship_federation_id("ptid:bob", "ptid:alice"),
            expected,
        )
        self.assertNotEqual(
            fixture_friendship_federation_id("ptid:alice", "ptid:charlie"),
            expected,
        )

    def test_federation_id_rejects_missing_or_duplicate_actors(self) -> None:
        with self.assertRaisesRegex(ValueError, "two distinct actor PTIDs"):
            fixture_friendship_federation_id("", "ptid:bob")
        with self.assertRaisesRegex(ValueError, "two distinct actor PTIDs"):
            fixture_friendship_federation_id("ptid:alice", "ptid:alice")


class DisposableAcceptanceTargetTest(unittest.TestCase):
    @patch(
        "tooling.acceptance.fixtures.chat_native_reset."
        "active_profile_environment",
        return_value={
            "PT_DEV_PROFILE": "sixwin",
            "PT_STATION_MODE": "local",
            "PT_STATION_URL": "http://127.0.0.1:18080",
        },
    )
    def test_accepts_exact_active_local_source_station(
        self,
        _profile,
    ) -> None:
        resolved = acceptance_station_environment(
            "http://127.0.0.1:18080/",
            "local",
        )

        self.assertEqual(
            resolved["PT_ACCEPTANCE_RUNTIME_KIND"],
            "local-source",
        )
        self.assertEqual(
            Path(resolved["PT_ACCEPTANCE_LOCAL_DATABASE"]),
            (
                Path(__file__).resolve().parents[4]
                / ".local"
                / "dev"
                / "data"
                / "sixwin"
                / "station.db"
            ).resolve(),
        )

    @patch(
        "tooling.acceptance.fixtures.chat_native_reset."
        "active_profile_environment",
        return_value={
            "PT_DEV_PROFILE": "sixwin",
            "PT_STATION_MODE": "local",
            "PT_STATION_URL": "http://127.0.0.1:18080",
        },
    )
    def test_rejects_non_loopback_local_source_station(
        self,
        _profile,
    ) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "Local source Chat Acceptance target mismatch",
        ):
            acceptance_station_environment(
                "http://10.36.3.187:18080",
                "local",
            )

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

    @patch.dict(os.environ, {"CHAT_ACCEPTANCE_RESET": "1"})
    def test_local_source_reset_recreates_only_profile_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "station.db"
            wal = Path(f"{database}-wal")
            shm = Path(f"{database}-shm")
            for path in (database, wal, shm):
                path.write_text("stale", encoding="utf-8")
            environment = {
                "PT_ACCEPTANCE_RUNTIME_KIND": "local-source",
                "PT_ACCEPTANCE_LOCAL_DATABASE": str(database),
            }
            with patch(
                "tooling.acceptance.fixtures.chat_native_reset."
                "active_profile_environment",
                return_value={
                    "PT_STATION_URL": "http://127.0.0.1:18080",
                },
            ), patch(
                "tooling.acceptance.fixtures.chat_native_reset."
                "_local_source_environment",
                return_value=environment,
            ), patch(
                "tooling.acceptance.fixtures.chat_native_reset."
                "verify_disposable_station_runtime",
            ) as verify, patch(
                "tooling.acceptance.fixtures.chat_native_reset.subprocess.run",
            ) as run:
                run.return_value.returncode = 0
                reset_station_chat_state("local")

            self.assertEqual(verify.call_count, 2)
            self.assertFalse(database.exists())
            self.assertFalse(wal.exists())
            self.assertFalse(shm.exists())
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[0].args[0][-1], "station")
            self.assertTrue(
                str(run.call_args_list[1].args[0][-1]).endswith(
                    "station-dev.sh"
                )
            )

    @patch.dict(os.environ, {"CHAT_ACCEPTANCE_RESET": "1"})
    def test_local_source_queue_replay_duplicates_acked_item(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "station.db"
            with closing(sqlite3.connect(database)) as connection:
                connection.executescript(
                    """
CREATE TABLE device_queue_items (
  id INTEGER PRIMARY KEY,
  item_id TEXT,
  recipient_ptid TEXT,
  recipient_device_id TEXT,
  lane_sequence INTEGER,
  idempotency_key TEXT,
  event_id TEXT,
  event_sequence INTEGER NOT NULL,
  conversation_id TEXT,
  payload_type INTEGER,
  opaque_payload BLOB,
  payload_sha256 BLOB,
  state INTEGER,
  attempt_count INTEGER,
  lease_consumer_id TEXT,
  lease_consumer_epoch INTEGER,
  lease_expires_at TEXT,
  first_queued_at TEXT,
  next_attempt_at TEXT,
  expires_at TEXT,
  consumed_at TEXT,
  acked_at TEXT,
  consumption_receipt_id TEXT,
  last_error_code TEXT,
  last_reject_consumer_epoch INTEGER
);
CREATE TABLE device_queue_lanes (
  recipient_ptid TEXT,
  recipient_device_id TEXT,
  next_sequence INTEGER NOT NULL,
  acked_through INTEGER NOT NULL,
  active_consumer_id TEXT,
  active_consumer_epoch INTEGER NOT NULL,
  PRIMARY KEY (recipient_ptid, recipient_device_id)
);
INSERT INTO device_queue_items VALUES (
  1, 'source-item', 'ptid:bob', 'bob-device', 7, 'source-key',
  'event-1', 3, 'conversation-1', 1, x'0102', x'0304', 5, 1,
  '', 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
  '2099-01-01 00:00:00', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
  'receipt-1', '', 0
);
INSERT INTO device_queue_lanes VALUES (
  'ptid:bob', 'bob-device', 7, 7, '', 1
);
"""
                )
            environment = {
                "PT_ACCEPTANCE_RUNTIME_KIND": "local-source",
                "PT_ACCEPTANCE_LOCAL_DATABASE": str(database),
            }
            with patch(
                "tooling.acceptance.fixtures.chat_native_reset."
                "acceptance_station_environment",
                return_value=environment,
            ), patch(
                "tooling.acceptance.fixtures.chat_native_reset."
                "verify_disposable_station_runtime",
            ):
                evidence = duplicate_acceptance_queue_delivery(
                    "http://127.0.0.1:18080",
                    "source-item",
                    "ptid:bob",
                    "bob-device",
                )

            with closing(sqlite3.connect(database)) as connection:
                duplicate = connection.execute(
                    """
SELECT lane_sequence, event_id, event_sequence, state, attempt_count,
       opaque_payload, payload_sha256, consumption_receipt_id,
       last_error_code
FROM device_queue_items
WHERE item_id = ?
""",
                    (evidence["duplicateItemId"],),
                ).fetchone()
                next_sequence = connection.execute(
                    """
SELECT next_sequence
FROM device_queue_lanes
WHERE recipient_ptid = 'ptid:bob'
  AND recipient_device_id = 'bob-device'
"""
                ).fetchone()[0]

            self.assertEqual(
                duplicate,
                (
                    8,
                    "event-1",
                    3,
                    1,
                    0,
                    b"\x01\x02",
                    b"\x03\x04",
                    None,
                    "",
                ),
            )
            self.assertEqual(next_sequence, 8)
            self.assertEqual(evidence["sourceItemId"], "source-item")
            self.assertEqual(evidence["laneSequence"], 8)
            self.assertEqual(evidence["payloadSha256"], "0304")

    def test_reads_fixture_actor_from_owned_local_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "station.db"
            import sqlite3

            with closing(sqlite3.connect(database)) as connection:
                connection.execute(
                    """
CREATE TABLE touch_actor (
  email TEXT,
  origin TEXT,
  ptid TEXT,
  preferred_username TEXT,
  name TEXT,
  summary TEXT,
  icon TEXT,
  image TEXT,
  url TEXT,
  federated_handle TEXT,
  home_station_peer_id TEXT,
  home_station_domain TEXT,
  visibility INTEGER,
  locator_seq INTEGER
)
"""
                )
                connection.execute(
                    """
INSERT INTO touch_actor VALUES (
  'alice@p.t', 'local', 'ptid:alice', 'alice', 'Alice',
  '', '', '', 'http://127.0.0.1:18080/actors/alice',
  '@alice@127.0.0.1', 'peer-sixwin', '127.0.0.1', 1, 1
)
"""
                )
                connection.commit()
            environment = {
                "PT_ACCEPTANCE_RUNTIME_KIND": "local-source",
                "PT_ACCEPTANCE_LOCAL_DATABASE": str(database),
            }
            with patch(
                "tooling.acceptance.fixtures.chat_native_reset."
                "acceptance_station_environment",
                return_value=environment,
            ), patch(
                "tooling.acceptance.fixtures.chat_native_reset."
                "verify_disposable_station_runtime",
            ):
                actor = read_fixture_actor(
                    "http://127.0.0.1:18080",
                    "local",
                    "alice@p.t",
                )

            self.assertEqual(actor.ptid, "ptid:alice")
            self.assertEqual(actor.home_station_peer_id, "peer-sixwin")

    def test_same_station_contact_seeds_canonical_sqlite_projection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "station.db"
            import sqlite3

            with closing(sqlite3.connect(database)) as connection:
                connection.executescript(
                    """
CREATE TABLE federation (
  federation_id TEXT PRIMARY KEY, name TEXT, description TEXT, status TEXT,
  policy_type TEXT, sequencer_station_peer_id TEXT, genesis_hash BLOB,
  head_hash BLOB, head_seq INTEGER, created_by_actor_ptid TEXT,
  created_by_station_peer_id TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE federation_station_membership (
  federation_id TEXT, station_peer_id TEXT, station_name TEXT,
  station_url TEXT, role TEXT, status TEXT, joined_at TEXT,
  approved_by_event_id TEXT,
  UNIQUE (federation_id, station_peer_id)
);
CREATE TABLE social_friend_requests (
  request_id TEXT PRIMARY KEY, federation_id TEXT,
  authority_station_peer_id TEXT, sender_ptid TEXT, receiver_ptid TEXT,
  sender_actor_ref_bytes BLOB, receiver_actor_ref_bytes BLOB,
  sender_home_station_peer_id TEXT, receiver_home_station_peer_id TEXT,
  message TEXT, state INTEGER, sequence INTEGER, last_event_hash BLOB,
  last_event_bytes BLOB, authority_confirmed INTEGER, created_at TEXT,
  responded_at TEXT
);
CREATE TABLE social_relationship_projections (
  owner_ptid TEXT, peer_ptid TEXT, request_id TEXT,
  accepted_event_id TEXT, accepted_event_hash BLOB, accepted_at TEXT,
  PRIMARY KEY (owner_ptid, peer_ptid)
);
"""
                )
            actor = FixtureActorRecord(
                ptid="ptid:alice",
                preferred_username="alice",
                name="Alice",
                summary="",
                icon="",
                image="",
                url="http://127.0.0.1:18080/actors/alice",
                federated_handle="@alice@127.0.0.1",
                home_station_peer_id="peer-sixwin",
                home_station_domain="127.0.0.1:18080",
                visibility=1,
                locator_seq=1,
            )
            peer = FixtureActorRecord(
                ptid="ptid:bob",
                preferred_username="bob",
                name="Bob",
                summary="",
                icon="",
                image="",
                url="http://127.0.0.1:18080/actors/bob",
                federated_handle="@bob@127.0.0.1",
                home_station_peer_id="peer-sixwin",
                home_station_domain="127.0.0.1:18080",
                visibility=1,
                locator_seq=1,
            )
            environment = {
                "PT_ACCEPTANCE_RUNTIME_KIND": "local-source",
                "PT_ACCEPTANCE_LOCAL_DATABASE": str(database),
            }
            with patch(
                "tooling.acceptance.fixtures.chat_native_reset."
                "acceptance_station_environment",
                return_value=environment,
            ), patch(
                "tooling.acceptance.fixtures.chat_native_reset."
                "verify_disposable_station_runtime",
            ), patch(
                "tooling.acceptance.fixtures.chat_native_reset."
                "_encode_social_proto",
                return_value=b"canonical-proto",
            ):
                seed_same_station_contact(
                    "http://127.0.0.1:18080",
                    "sixwin",
                    actor,
                    peer,
                )
                seed_same_station_contact(
                    "http://127.0.0.1:18080",
                    "sixwin",
                    actor,
                    peer,
                )

            with closing(sqlite3.connect(database)) as connection:
                request = connection.execute(
                    """
SELECT state, sequence, authority_confirmed
FROM social_friend_requests
"""
                ).fetchone()
                relationships = connection.execute(
                    """
SELECT owner_ptid, peer_ptid
FROM social_relationship_projections
ORDER BY owner_ptid
"""
                ).fetchall()
                memberships = connection.execute(
                    "SELECT count(*) FROM federation_station_membership"
                ).fetchone()[0]

            self.assertEqual(request, (2, 2, 1))
            self.assertEqual(
                relationships,
                [("ptid:alice", "ptid:bob"), ("ptid:bob", "ptid:alice")],
            )
            self.assertEqual(memberships, 1)

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
