from __future__ import annotations

import hashlib
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tooling.acceptance.core import EnvironmentContract, GateError
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR, REPO_ROOT
from tooling.acceptance.gates.chat.mixed_native_runtime import (
    _environment_id_for_gate,
)
from tooling.acceptance.gates.mobile.simulator_harness_contract import (
    SOCIAL_CROSS_STATION_MIXED_CHILD_HARNESS_ACTIONS,
    child_callable_harness_actions,
)
from tooling.acceptance.gates.social.cross_station_mobile_desktop_e2e import (
    Gate,
    revocation_restart_no_resurrection,
)
from tooling.acceptance.provisioners import (
    SocialCrossStationMobileDesktopProvisioner,
    get_provisioner,
)
from tooling.acceptance.provisioners.mobile_simulator import (
    SIMULATOR_APPIUM_CAPABILITY_ID,
)


GATE_ID = "social-cross-station-mobile-desktop-e2e"
ENVIRONMENT_ID = "social-cross-station-mobile-desktop"


class CrossStationMobileDesktopContractTest(unittest.TestCase):
    def test_gate_environment_and_provisioner_form_one_closure(self) -> None:
        catalog = json.loads(
            (
                REPO_ROOT / "tooling" / "acceptance" / "gates.yaml"
            ).read_text(encoding="utf-8")
        )["gates"]
        gate = catalog[GATE_ID]
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / f"{ENVIRONMENT_ID}.yaml"
        )
        provisioner = get_provisioner(
            contract,
            station_profiles={
                "station-primary": "four",
                "station-secondary": "fiveArm",
            },
        )

        self.assertEqual(gate["environment"], ENVIRONMENT_ID)
        self.assertEqual(gate["provisioner"], ENVIRONMENT_ID)
        self.assertEqual(
            gate["ephemeralCapabilities"],
            [SIMULATOR_APPIUM_CAPABILITY_ID],
        )
        self.assertNotIn("command", gate)
        self.assertEqual(contract.id, ENVIRONMENT_ID)
        self.assertIsInstance(
            provisioner,
            SocialCrossStationMobileDesktopProvisioner,
        )
        self.assertEqual(
            provisioner.cross_station_friendship_roles,
            ("alice", "bob"),
        )
        self.assertTrue(
            provisioner.reset_cross_station_follow_edges,
        )
        self.assertEqual(
            _environment_id_for_gate(GATE_ID),
            ENVIRONMENT_ID,
        )

    def test_environment_declares_two_stations_and_mixed_clients(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / f"{ENVIRONMENT_ID}.yaml"
        )
        clients = {client.id: client for client in contract.clients}

        self.assertEqual(
            set(contract.services),
            {"station-primary", "station-secondary"},
        )
        self.assertEqual(
            {client.runtime for client in clients.values()},
            {"native-tauri", "tauri-ios-simulator"},
        )
        self.assertEqual(
            clients["desktop-alice"]
            .service_bindings["station"].service_id,
            "station-primary",
        )
        self.assertEqual(
            clients["sim-ios"].service_bindings["station"].service_id,
            "station-secondary",
        )
        self.assertEqual(
            clients["sim-ios-peer"].actor,
            "eve",
        )

    def test_mobile_harness_contract_is_exact_and_domain_bounded(self) -> None:
        payload = json.loads(
            (
                ENVIRONMENTS_DIR / f"{ENVIRONMENT_ID}.yaml"
            ).read_text(encoding="utf-8")
        )

        self.assertEqual(
            set(payload["harness"]["required_actions"]),
            SOCIAL_CROSS_STATION_MIXED_CHILD_HARNESS_ACTIONS,
        )
        self.assertEqual(
            child_callable_harness_actions(GATE_ID),
            SOCIAL_CROSS_STATION_MIXED_CHILD_HARNESS_ACTIONS,
        )
        self.assertNotIn(
            "station.add",
            SOCIAL_CROSS_STATION_MIXED_CHILD_HARNESS_ACTIONS,
        )
        self.assertNotIn(
            "access.submit",
            SOCIAL_CROSS_STATION_MIXED_CHILD_HARNESS_ACTIONS,
        )

    def test_fixture_display_name_uses_authoritative_actor_projection(
        self,
    ) -> None:
        gate = object.__new__(Gate)
        gate.runtime = SimpleNamespace(
            actor_fixture=lambda _client_id: {
                "role": "alice",
                "displayName": "Acceptance Profile",
            }
        )

        self.assertEqual(
            gate._fixture_display_name("desktop-alice"),
            "Acceptance Profile",
        )

    def test_fixture_display_name_rejects_role_derived_fallback(self) -> None:
        gate = object.__new__(Gate)
        gate.runtime = SimpleNamespace(
            actor_fixture=lambda _client_id: {"role": "alice"}
        )

        with self.assertRaisesRegex(
            GateError,
            "has no canonical display name",
        ):
            gate._fixture_display_name("desktop-alice")

    def test_desktop_publish_waits_for_remote_delivery_convergence(self) -> None:
        gate = object.__new__(Gate)
        states = iter(
            (
                "REMOTE_DELIVERY_PENDING",
                "REMOTE_DELIVERY_RETRYING",
                "PUBLISHED",
            )
        )
        gate._desktop_moments_action = lambda *_args: {
            "state": next(states),
            "transientPostId": "post-1",
        }

        self.assertIsNone(gate._settled_desktop_publish("desktop-alice"))
        self.assertIsNone(gate._settled_desktop_publish("desktop-alice"))
        self.assertEqual(
            gate._settled_desktop_publish("desktop-alice"),
            {
                "state": "PUBLISHED",
                "transientPostId": "post-1",
            },
        )

    def test_mobile_comment_retries_after_federation_result_delay(self) -> None:
        clock = {"now": 0.0}
        clicks: list[tuple[str, float]] = []
        expected_text_sha256 = hashlib.sha256(b"hello").hexdigest()

        class Runtime:
            @staticmethod
            def wait_until(predicate, _description, *, timeout_seconds):
                del timeout_seconds
                for _ in range(40):
                    result = predicate()
                    if result:
                        return result
                    clock["now"] += 0.25
                raise AssertionError("private Comment did not converge")

        gate = object.__new__(Gate)
        gate.runtime = Runtime()
        gate._mobile_set_value = lambda *_args: None

        def click(
            _client_id: str,
            _selector: str,
            description: str,
        ) -> None:
            clicks.append((description, clock["now"]))

        gate._mobile_click = click

        def mobile_action(_client_id: str, _action: str):
            retry_count = sum(
                description == "Mobile private Comment retry"
                for description, _ in clicks
            )
            draft = {
                "postId": "post-1",
                "textSha256": expected_text_sha256,
                "state": (
                    "COMMENT_POSTED"
                    if retry_count >= 2
                    else "COMMENT_FAILED"
                ),
            }
            if retry_count < 2:
                draft["errorCode"] = "SOCIAL_PRIVATE_COMMENT_20008"
            return {"commentDrafts": [draft]}

        gate._mobile_action = mobile_action

        with patch(
            "tooling.acceptance.gates.social."
            "cross_station_mobile_desktop_e2e.time.monotonic",
            side_effect=lambda: clock["now"],
        ):
            gate._submit_mobile_comment_via_ui(
                "sim-ios",
                "post-1",
                "hello",
            )

        retry_times = [
            timestamp
            for description, timestamp in clicks
            if description == "Mobile private Comment retry"
        ]
        self.assertEqual(retry_times, [1.0, 3.0])

    def test_mobile_reaction_reconciles_before_receiver_assertion(self) -> None:
        states = iter(
            (
                "REACTION_UNKNOWN_OUTCOME",
                "REACTION_COMMITTED",
            )
        )

        class Runtime:
            @staticmethod
            def wait_until(predicate, _description, *, timeout_seconds):
                del timeout_seconds
                for _ in range(2):
                    result = predicate()
                    if result:
                        return result
                raise AssertionError("private Reaction did not converge")

        gate = object.__new__(Gate)
        gate.runtime = Runtime()
        gate._mobile_action = lambda *_args: {
            "reactionCommands": [{
                "commandIdSha256": "a" * 64,
                "postId": "post-1",
                "kind": 2,
                "operation": "REACT",
                "state": next(states),
                "attemptCount": 1,
                "projectionRevision": "0",
            }],
        }

        self.assertEqual(
            gate._wait_for_mobile_reaction("sim-ios", "post-1")["state"],
            "REACTION_COMMITTED",
        )

    def test_mobile_reaction_reports_missing_command_context(self) -> None:
        clock = {"now": 0.0}

        class Runtime:
            @staticmethod
            def wait_until(predicate, _description, *, timeout_seconds):
                del timeout_seconds
                for _ in range(3):
                    result = predicate()
                    if result:
                        return result
                    clock["now"] += 2.5
                raise AssertionError("missing command was not diagnosed")

        gate = object.__new__(Gate)
        gate.runtime = Runtime()
        gate._mobile_action = lambda *_args: {
            "reads": [{
                "postId": "post-1",
                "state": "CONTENT_READY",
            }],
            "reactionCommands": [],
            "errorPresent": False,
        }
        gate._capture_mobile = lambda *_args: {
            "screenshot": {"path": "screenshot.png"},
            "dom": {"path": "page-source.html"},
        }

        with (
            patch(
                "tooling.acceptance.gates.social."
                "cross_station_mobile_desktop_e2e.time.monotonic",
                side_effect=lambda: clock["now"],
            ),
            self.assertRaisesRegex(
                GateError,
                '"postRead":\\{"postId":"post-1","state":"CONTENT_READY"\\}',
            ),
        ):
            gate._wait_for_mobile_reaction("sim-ios", "post-1")

    def test_revoked_mobile_read_uses_reconciled_terminal_projection(self) -> None:
        actions: list[str] = []

        class Runtime:
            @staticmethod
            def wait_until(predicate, _description, *, timeout_seconds):
                del timeout_seconds
                result = predicate()
                if result:
                    return result
                raise AssertionError("revoked projection did not converge")

        gate = object.__new__(Gate)
        gate.runtime = Runtime()

        def mobile_action(
            _client_id: str,
            action: str,
            _payload=None,
        ):
            actions.append(action)
            if action == "moments.private.reconcile":
                return {
                    "reads": [{
                        "postId": "post-1",
                        "state": "DELETED_OR_REVOKED",
                        "errorCode": "RESOURCE_DELETED",
                    }],
                }
            raise AssertionError(
                "terminal private read must not call the access-open action"
            )

        gate._mobile_action = mobile_action

        self.assertEqual(
            gate._wait_for_mobile_private_read(
                "sim-ios",
                "post-1",
                expected_state={
                    "DELETED_OR_REVOKED",
                    "NOT_FOUND_OR_NOT_AUTHORIZED",
                },
            ),
            {
                "postId": "post-1",
                "state": "DELETED_OR_REVOKED",
                "errorCode": "RESOURCE_DELETED",
            },
        )
        self.assertEqual(actions, ["moments.private.reconcile"])

    def test_revocation_restart_accepts_any_terminal_absence_state(self) -> None:
        self.assertTrue(
            revocation_restart_no_resurrection(
                {"state": "CONTENT_READY"},
                {"state": "DELETED_OR_REVOKED"},
                {"state": "NOT_FOUND_OR_NOT_AUTHORIZED"},
            )
        )
        self.assertFalse(
            revocation_restart_no_resurrection(
                {"state": "CONTENT_READY"},
                {"state": "DELETED_OR_REVOKED"},
                {"state": "CONTENT_READY"},
            )
        )

    def test_desktop_feed_identity_requires_human_names_and_safe_sources(
        self,
    ) -> None:
        class Session:
            rows = [
                {
                    "postId": "post-alice",
                    "expectedDisplayName": "Alice",
                    "authorText": "Alice",
                    "sourceText": "Local · Friends",
                },
                {
                    "postId": "post-bob",
                    "expectedDisplayName": "Bob",
                    "authorText": "Bob",
                    "sourceText": "Remote · Friends",
                },
            ]

            def execute_script(self, _script, _expected):
                return self.rows

        class Runtime:
            session = Session()

            @classmethod
            def desktop_session(cls, _client_id):
                return cls.session

            @staticmethod
            def wait_until(predicate, _description, *, timeout_seconds):
                del timeout_seconds
                value = predicate()
                if value:
                    return value
                raise GateError("identity did not converge")

        gate = object.__new__(Gate)
        gate.runtime = Runtime()
        gate.assert_condition = lambda *_args: None

        self.assertEqual(
            [
                row["authorText"]
                for row in gate._wait_desktop_feed_identity(
                    "desktop-alice",
                    {
                        "post-alice": "Alice",
                        "post-bob": "Bob",
                    },
                )
            ],
            ["Alice", "Bob"],
        )

        Runtime.session.rows[1] = {
            **Runtime.session.rows[1],
            "sourceText": "From 10.0.0.2:8080 · Friends",
        }
        with self.assertRaisesRegex(
            GateError,
            "Desktop Moment identity did not converge",
        ):
            gate._wait_desktop_feed_identity(
                "desktop-alice",
                {
                    "post-alice": "Alice",
                    "post-bob": "Bob",
                },
            )

    def test_hidden_feed_cannot_prove_revoked_post_absence(self) -> None:
        clock = {"now": 0.0}

        class Runtime:
            @staticmethod
            def wait_until(predicate, _description, *, timeout_seconds):
                del timeout_seconds
                for _ in range(20):
                    result = predicate()
                    if result:
                        return result
                    clock["now"] += 0.25
                raise AssertionError("foreground feed did not settle")

        class Binding:
            @staticmethod
            def semantic_observe(_client_id, _selector):
                return {"found": False}

        gate = object.__new__(Gate)
        gate.runtime = Runtime()
        gate.mobile_binding = Binding()
        gate._mobile_observe = lambda *_args: clock["now"] >= 1.0

        with patch(
            "tooling.acceptance.gates.social."
            "cross_station_mobile_desktop_e2e.time.monotonic",
            side_effect=lambda: clock["now"],
        ):
            gate._wait_mobile_post_absent("sim-ios", "post-1")

        self.assertGreaterEqual(clock["now"], 2.0)


if __name__ == "__main__":
    unittest.main()
