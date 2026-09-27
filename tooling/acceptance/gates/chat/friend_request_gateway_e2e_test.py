from __future__ import annotations

import unittest
from unittest.mock import call, patch

from tooling.acceptance.gates.chat import friend_request_gateway_e2e as gate


class RecordingReport:
    def __init__(self) -> None:
        self.assertions: list[tuple[str, bool, str | None]] = []

    def add_assertion(
        self,
        name: str,
        passed: bool,
        detail: str | None = None,
    ) -> None:
        self.assertions.append((name, passed, detail))


class FriendRequestGatewayContractTests(unittest.TestCase):
    def test_login_uses_canonical_account_field(self) -> None:
        actor = gate.ActorCredentials(
            name="alice",
            email="alice@p.t",
            password="1",
            actor_ptid="ptid:alice",
        )
        with patch.object(
            gate,
            "gateway_access_login",
            return_value={
                "actor_ptid": "ptid:alice",
            },
        ) as access_login, patch.object(
            gate,
            "gateway_status",
            return_value={
                "account_id": "account-alice",
                "actor_ptid": "ptid:alice",
                "messaging_profile_matches": True,
            },
        ) as gateway_status:
            gate.gateway_login("http://127.0.0.1:3140", actor)

        access_login.assert_called_once_with(
            gate.gateway_command,
            "http://127.0.0.1:3140",
            "alice@p.t",
            "1",
        )
        gateway_status.assert_called_once_with(
            "http://127.0.0.1:3140",
            "acceptance_current_session",
        )

    def test_flow_uses_complete_friend_request_command_context(self) -> None:
        alice = gate.ActorCredentials(
            name="alice",
            email="alice@p.t",
            password="1",
            actor_ptid="ptid:alice",
        )
        bob = gate.ActorCredentials(
            name="bob",
            email="bob@p.t",
            password="1",
            actor_ptid="ptid:bob",
        )
        pending = {
            "request_id": "request-1",
            "sender_ptid": alice.actor_ptid,
            "sender_home_station_peer_id": "station-four-peer",
            "federation_id": "federation-1",
        }
        report = RecordingReport()

        with patch.object(
            gate,
            "gateway_url",
            return_value="http://127.0.0.1:3140",
        ), patch.object(
            gate,
            "station_url",
            return_value="http://station-four:18080",
        ), patch.object(
            gate,
            "fixture_actor",
            side_effect=[alice, bob],
        ), patch.object(
            gate,
            "gateway_login",
            side_effect=lambda _gateway, actor: actor,
        ), patch.object(
            gate,
            "gateway_logout",
        ) as gateway_logout, patch.object(
            gate,
            "gateway_command",
            return_value={},
        ) as gateway_command, patch.object(
            gate,
            "get_federation_context",
            return_value=("federation-1", "station-four-peer"),
        ), patch.object(
            gate,
            "gateway_proto_command",
            return_value=b"protobuf",
        ) as gateway_proto_command, patch.object(
            gate,
            "wait_for_pending_request",
            return_value=pending,
        ), patch.object(
            gate,
            "wait_for_friendship",
            return_value={
                "target_actor_ptid": bob.actor_ptid,
                "following": True,
                "followed_by": True,
            },
        ):
            result = gate.run_friend_request_flow(report)

        self.assertEqual(gateway_logout.call_count, 2)
        self.assertEqual(
            gateway_command.call_args_list,
            [
                call(
                    "http://127.0.0.1:3140",
                    "station_add",
                    {"url": "http://station-four:18080"},
                    timeout=10,
                ),
                call(
                    "http://127.0.0.1:3140",
                    "station_set_active",
                    {"url": "http://station-four:18080"},
                    timeout=10,
                ),
            ],
        )
        self.assertEqual(
            gateway_proto_command.call_args_list,
            [
                call(
                    "http://127.0.0.1:3140",
                    "social_friend_request_send",
                    {
                        "receiver_ptid": bob.actor_ptid,
                        "receiver_home_station_peer_id": "station-four-peer",
                        "federation_id": "federation-1",
                        "message": "acceptance gate friend request",
                    },
                ),
                call(
                    "http://127.0.0.1:3140",
                    "social_friend_request_list",
                    {"status": 1, "limit": 200, "offset": 0},
                ),
                call(
                    "http://127.0.0.1:3140",
                    "social_friend_request_accept",
                    {
                        "request_id": "request-1",
                        "sender_ptid": alice.actor_ptid,
                        "sender_home_station_peer_id": "station-four-peer",
                        "federation_id": "federation-1",
                        "message": "",
                    },
                ),
                call(
                    "http://127.0.0.1:3140",
                    "social_get_relationship",
                    {"target_actor_ptid": bob.actor_ptid},
                ),
            ],
        )
        self.assertTrue(result["friendship_confirmed"])
        self.assertEqual(
            [name for name, passed, _detail in report.assertions if passed],
            [
                "station_configured",
                "actor_a_login_via_gateway",
                "federation_available",
                "actor_a_sends_friend_request",
                "actor_b_login_via_gateway",
                "actor_b_sees_pending_request",
                "actor_b_accepts_friend_request",
                "friendship_established",
            ],
        )


if __name__ == "__main__":
    unittest.main()
