from __future__ import annotations

import unittest
from unittest.mock import patch

from tooling.acceptance.core import DriverError
from tooling.acceptance.gates.mobile.simulator_social_e2e import (
    ENVIRONMENT_ID,
    SCENARIO_GATES,
    SimulatorSocialGate,
)
from tooling.acceptance.gates.mobile.simulator_e2e import SimulatorGateBlocked
from tooling.acceptance.gates.mobile.messaging_journey import MessagingActor


class Artifacts:
    run_id = "20260904T120000000000Z-" + ("1" * 32)

    class Store:
        workspace_id = "a" * 16

    store = Store()

    def __init__(self) -> None:
        self.completed: dict[str, object] = {}
        self.writes: list[tuple[str, object, str | None]] = []

    def __enter__(self) -> "Artifacts":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def write_json(
        self,
        path: str,
        value: object,
        *,
        role: str | None = None,
    ) -> None:
        self.writes.append((path, value, role))

    def complete(self, **values: object) -> None:
        self.completed = values


class SimulatorSocialGateTests(unittest.TestCase):
    def test_canonical_simulator_gate_claims_declared_proof(self) -> None:
        artifacts = Artifacts()
        gate = SimulatorSocialGate("social-convergence")
        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(
                gate,
                "_load_social_manifest",
                return_value={"environmentId": ENVIRONMENT_ID},
            ),
            patch.object(
                gate,
                "_run_social_journey",
                return_value=gate._result_base("PASS"),
            ),
            patch.object(gate, "_cleanup_sessions"),
        ):
            exit_code = gate.execute()

        self.assertEqual(exit_code, 0)
        self.assertEqual(artifacts.completed["status"], "PASS")
        self.assertEqual(artifacts.completed["completion_status"], "DONE")
        self.assertEqual(artifacts.completed["proof_status"], "PROVEN")
        result = next(
            value
            for path, value, _role in artifacts.writes
            if path.endswith("/result.json")
        )
        self.assertEqual(
            result["artifactKind"],
            "acceptance-gate-evidence-report",
        )
        self.assertEqual(result["gateId"], gate.gate_id)
        self.assertEqual(result["phase"], "W5 Simulator Social Convergence")
        self.assertEqual(result["bom"], ["W5", "W5-OWNER"])
        self.assertEqual(result["spec"], ["MS-AG06"])
        self.assertEqual(result["gate"], gate.gate_id)
        self.assertFalse(result["physicalDeviceClaimed"])
        self.assertIn(
            "physical-device hardware behavior",
            result["unprovenScope"],
        )

    def test_cleanup_failure_does_not_hide_primary_failure(self) -> None:
        artifacts = Artifacts()
        gate = SimulatorSocialGate("social-convergence")

        def record_cleanup_failure(_artifacts: Artifacts) -> None:
            gate.cleanup.append(
                {
                    "clientId": "sim-ios",
                    "resource": "product-harness",
                    "status": "failed",
                    "errorType": "DriverError",
                }
            )

        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(
                gate,
                "_load_social_manifest",
                return_value={"environmentId": ENVIRONMENT_ID},
            ),
            patch.object(
                gate,
                "_run_social_journey",
                side_effect=DriverError("station.add failed"),
            ),
            patch.object(
                gate,
                "_cleanup_sessions",
                side_effect=record_cleanup_failure,
            ),
        ):
            exit_code = gate.execute()

        result = next(
            value
            for path, value, _role in artifacts.writes
            if path.endswith("/result.json")
        )
        self.assertEqual(exit_code, 1)
        self.assertEqual(result["reason"], "station.add failed")
        self.assertEqual(
            result["cleanupReason"],
            "simulator social cleanup was incomplete",
        )

    def test_gate_ids_are_stable_and_scenario_specific(self) -> None:
        self.assertEqual(
            SCENARIO_GATES,
            {
                "social-convergence": (
                    "mobile-simulator-social-convergence-e2e"
                ),
                "chat-contacts": "mobile-simulator-chat-contacts-e2e",
                "recovery": "mobile-simulator-recovery-e2e",
                "recovery-ui": "mobile-simulator-recovery-ui-e2e",
                "moments": "mobile-simulator-moments-e2e",
                "storage-cache-cleanup": "chat-storage-cache-clear-e2e",
                "storage-batch-clear": (
                    "chat-storage-mobile-batch-clear-e2e"
                ),
                "storage-conversation-clear": (
                    "chat-storage-delete-reclaim-e2e"
                ),
                "storage-retention": "chat-storage-retention-e2e",
            },
        )
        self.assertNotEqual(
            SimulatorSocialGate("social-convergence").gate_id,
            SimulatorSocialGate("chat-contacts").gate_id,
        )

    def test_scenario_gate_id_is_bound_before_managed_context_validation(
        self,
    ) -> None:
        with patch(
            "tooling.acceptance.core.gate._managed_run_context_active",
            return_value=False,
        ) as managed_context:
            gate = SimulatorSocialGate("storage-cache-cleanup")

        self.assertEqual(gate.gate_id, "chat-storage-cache-clear-e2e")
        managed_context.assert_called_once_with("chat-storage-cache-clear-e2e")

    def test_missing_runtime_manifest_blocks_before_journey(self) -> None:
        artifacts = Artifacts()
        gate = SimulatorSocialGate("social-convergence")

        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(
                gate,
                "_load_social_manifest",
                side_effect=SimulatorGateBlocked(
                    "runtime manifest missing",
                    f"{ENVIRONMENT_ID}:manifest",
                ),
            ) as load_manifest,
            patch.object(gate, "_run_social_journey") as run_journey,
            patch.object(gate, "_cleanup_sessions"),
        ):
            exit_code = gate.execute()

        self.assertEqual(exit_code, 2)
        load_manifest.assert_called_once()
        run_journey.assert_not_called()
        result = next(
            value
            for path, value, _role in artifacts.writes
            if path.endswith("/result.json")
        )
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(
            result["blockedResource"],
            f"{ENVIRONMENT_ID}:manifest",
        )

    def test_runtime_manifest_requires_only_same_station_service(self) -> None:
        gate = SimulatorSocialGate("recovery")

        with (
            patch.dict(
                "os.environ",
                {"PT_ACCEPTANCE_RUNTIME_MANIFEST": "/tmp/direct.json"},
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "load_runtime_manifest",
                return_value={"environmentId": ENVIRONMENT_ID},
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "require_runtime_service",
            ) as require_service,
        ):
            manifest = gate._load_social_manifest()

        self.assertEqual(manifest["environmentId"], ENVIRONMENT_ID)
        require_service.assert_called_once_with(
            manifest,
            "station",
            "station",
        )

    def test_cross_station_manifest_cannot_satisfy_direct_gate(self) -> None:
        gate = SimulatorSocialGate("recovery")

        with (
            patch.dict(
                "os.environ",
                {"PT_ACCEPTANCE_RUNTIME_MANIFEST": "/tmp/social.json"},
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "load_runtime_manifest",
                return_value={"environmentId": "mobile-social-simulator"},
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "require_runtime_service",
            ),
        ):
            with self.assertRaisesRegex(
                SimulatorGateBlocked,
                ENVIRONMENT_ID,
            ):
                gate._load_social_manifest()

    def test_unknown_scenario_fails_before_runtime_allocation(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported"):
            SimulatorSocialGate("unknown")

    def test_recovery_ui_uses_restart_and_authoritative_draft_readback(
        self,
    ) -> None:
        draft = {
            "kind": "chat",
            "targetId": "recovery-ui-run",
            "payloadSha256": "a" * 64,
        }

        class Session:
            def call_action(
                self,
                action: str,
                _payload: object = None,
            ) -> object:
                if action == "reliability.draft.write":
                    return draft
                if action == "lifecycle.restart":
                    return {"requested": True, "scope": "webview"}
                if action == "recovery.snapshot":
                    return {
                        "states": [{
                            "kind": "draft-restore-pending",
                            "actions": ["restore", "discard"],
                        }],
                    }
                if action == "reliability.snapshot":
                    return {
                        "runtime": {},
                        "commands": [],
                        "drafts": [draft],
                        "checkpoints": [],
                    }
                raise AssertionError(action)

        result = SimulatorSocialGate(
            "recovery-ui"
        )._run_recovery_ui_journey(
            session=Session(),
            journey_id="run",
        )

        self.assertEqual(result["visibleState"], "draft-restore-pending")
        self.assertEqual(result["actions"], ["restore", "discard"])

    def test_storage_cache_cleanup_requires_physical_release_and_preserves_draft(
        self,
    ) -> None:
        draft = {
            "kind": "chat",
            "targetId": "storage-run-draft",
            "payloadSha256": "c" * 64,
        }

        class Session:
            def __init__(self) -> None:
                self.refresh_attempts = 0
                self.snapshots = [
                    {
                        "physicalTotalBytes": 3_000_000,
                        "cacheBytes": 2_100_000,
                        "confirmVisible": False,
                        "resultState": "",
                        "releasedBytes": 0,
                    },
                    {
                        "physicalTotalBytes": 3_000_000,
                        "cacheBytes": 2_100_000,
                        "confirmVisible": True,
                        "resultState": "",
                        "releasedBytes": 0,
                    },
                    {
                        "physicalTotalBytes": 800_000,
                        "cacheBytes": 0,
                        "confirmVisible": False,
                        "resultState": "succeeded",
                        "releasedBytes": 2_200_000,
                    },
                ]

            def call_action(
                self,
                action: str,
                _payload: object = None,
            ) -> object:
                if action == "storage.cache.seed":
                    return {"sizeBytes": 2 * 1024 * 1024}
                if action == "reliability.draft.write":
                    return draft
                if action == "reliability.draft.read":
                    return [draft]
                if action == "reliability.draft.action":
                    return {"drafts": []}
                if action == "getRealtimeDevice":
                    return {
                        "actorPtid": "ptid:alice",
                        "deviceId": "device-one",
                        "active": True,
                    }
                if action == "navigation.apply":
                    return {}
                raise AssertionError(action)

            def execute_script(self, script: str) -> object:
                if "data-chat-storage-refresh" in script:
                    self.refresh_attempts += 1
                    return self.refresh_attempts >= 3
                if "data-chat-storage-summary" in script:
                    return self.snapshots.pop(0)
                return True

        session = Session()
        with patch(
            "tooling.acceptance.gates.mobile.simulator_social_e2e.time.sleep",
        ):
            result = SimulatorSocialGate(
                "storage-cache-cleanup"
            )._run_storage_cache_cleanup_journey(
                session=session,
                journey_id="run",
            )

        self.assertEqual(session.refresh_attempts, 3)
        self.assertEqual(result["releasedBytes"], 2_200_000)
        self.assertTrue(result["draftPreserved"])
        self.assertTrue(result["messagingIdentityPreserved"])
        self.assertTrue(result["confirmationObserved"])

    def test_storage_conversation_clear_requires_reclaim_and_restart_absence(
        self,
    ) -> None:
        fixture = {
            "conversationId": "conversation-clear",
            "messageId": "message-clear",
        }

        class Session:
            def __init__(self) -> None:
                self.projection_reads = 0
                self.snapshots = [
                    {
                        "physicalTotalBytes": 4_000_000,
                        "messageBytes": 2_100_000,
                        "conversationIds": ["conversation-clear"],
                    },
                    {
                        "physicalTotalBytes": 1_500_000,
                        "messageBytes": 0,
                        "conversationIds": [],
                    },
                ]

            def call_action(self, action: str, payload: object = None) -> object:
                if action == "storage.conversation-clear.seed":
                    return fixture
                if action == "getRealtimeDevice":
                    return {
                        "actorPtid": "ptid:alice",
                        "deviceId": "device-one",
                        "active": True,
                    }
                if action in {"navigation.apply", "messaging.reconcile"}:
                    return {}
                if action == "messaging.projection.read":
                    self.projection_reads += 1
                    messages = (
                        [{"messageId": "message-clear"}]
                        if self.projection_reads == 1
                        else []
                    )
                    return {
                        "messages": {"conversation-clear": messages},
                    }
                if action == "messaging.search":
                    return []
                if action == "lifecycle.restart":
                    return {"requested": True, "scope": "webview"}
                raise AssertionError((action, payload))

            def execute_script(self, script: str) -> object:
                if "data-chat-storage-summary" in script:
                    return self.snapshots.pop(0)
                if "data-chat-conversation-clear-result" in script:
                    return {"releasedBytes": 2_500_000}
                return True

        session = Session()
        with patch(
            "tooling.acceptance.gates.mobile.simulator_social_e2e.time.sleep",
        ):
            result = SimulatorSocialGate(
                "storage-conversation-clear"
            )._run_storage_conversation_clear_journey(
                session=session,
                journey_id="run",
            )

        self.assertEqual(result["releasedBytes"], 2_500_000)
        self.assertTrue(result["plaintextAbsent"])
        self.assertTrue(result["searchEntryAbsent"])
        self.assertTrue(result["restartStable"])
        self.assertTrue(result["messagingIdentityPreserved"])

    def test_storage_batch_clear_requires_two_selected_restart_stable_items(
        self,
    ) -> None:
        fixtures = [
            {
                "conversationId": "conversation-clear-a",
                "messageId": "message-clear-a",
            },
            {
                "conversationId": "conversation-clear-b",
                "messageId": "message-clear-b",
            },
        ]

        class Session:
            def __init__(self) -> None:
                self.seed_index = 0
                self.snapshots = [
                    {
                        "physicalTotalBytes": 8_000_000,
                        "messageBytes": 4_200_000,
                        "conversationIds": [
                            "conversation-clear-a",
                            "conversation-clear-b",
                        ],
                        "conversationReclaimableBytes": {
                            "conversation-clear-a": 2_100_000,
                            "conversation-clear-b": 2_100_000,
                        },
                    },
                    {
                        "physicalTotalBytes": 2_000_000,
                        "messageBytes": 0,
                        "conversationIds": [],
                    },
                ]

            def call_action(self, action: str, payload: object = None) -> object:
                if action == "storage.conversation-clear.seed":
                    fixture = fixtures[self.seed_index]
                    self.seed_index += 1
                    return fixture
                if action == "getRealtimeDevice":
                    return {
                        "actorPtid": "ptid:alice",
                        "deviceId": "device-one",
                        "active": True,
                    }
                if action in {
                    "navigation.apply",
                    "messaging.reconcile",
                }:
                    return {}
                if action == "messaging.projection.read":
                    conversation_id = payload["conversationId"]
                    return {"messages": {conversation_id: []}}
                if action == "messaging.search":
                    return []
                if action == "lifecycle.restart":
                    return {"requested": True, "scope": "webview"}
                raise AssertionError((action, payload))

            def execute_script(self, script: str, *_args: object) -> object:
                if "data-chat-storage-summary" in script:
                    return self.snapshots.pop(0)
                if "data-chat-storage-selected" in script:
                    return [
                        "conversation-clear-a",
                        "conversation-clear-b",
                    ]
                if "data-chat-storage-batch-confirm" in script:
                    return 4_200_000
                if "data-chat-storage-batch-result" in script:
                    return {
                        "succeeded": 2,
                        "failed": 0,
                        "releasedBytes": 6_000_000,
                    }
                return True

        session = Session()
        with patch(
            "tooling.acceptance.gates.mobile.simulator_social_e2e.time.sleep",
        ):
            result = SimulatorSocialGate(
                "storage-batch-clear"
            )._run_storage_batch_clear_journey(
                session=session,
                journey_id="run",
            )

        self.assertEqual(result["conversationIds"], [
            "conversation-clear-a",
            "conversation-clear-b",
        ])
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["releasedBytes"], 6_000_000)
        self.assertEqual(result["estimatedReclaimableBytes"], 4_200_000)
        self.assertTrue(result["restartStable"])
        self.assertTrue(result["messagingIdentityPreserved"])

    def test_storage_retention_journey_requires_prune_protection_and_restart(self) -> None:
        fixture = {
            "conversationId": "conversation-retention",
            "prunedMessageId": "message-pruned",
            "protectedMessageId": "message-protected",
            "recentMessageId": "message-recent",
        }

        class Session:
            def __init__(self) -> None:
                self.snapshots = [
                    {
                        "physicalTotalBytes": 4_000_000,
                        "messageBytes": 2_100_000,
                        "conversationIds": ["conversation-retention"],
                    },
                    {
                        "physicalTotalBytes": 1_500_000,
                        "retentionPreset": "4",
                        "retentionResultState": "succeeded",
                        "retentionReleasedBytes": 2_500_000,
                    },
                    {
                        "physicalTotalBytes": 1_500_000,
                        "retentionPreset": "4",
                    },
                ]

            def call_action(self, action: str, payload: object = None) -> object:
                if action == "storage.retention.seed":
                    return fixture
                if action == "getRealtimeDevice":
                    return {
                        "actorPtid": "ptid:alice",
                        "deviceId": "device-one",
                        "active": True,
                    }
                if action == "navigation.apply":
                    return {}
                if action == "lifecycle.restart":
                    return {"requested": True, "scope": "webview"}
                if action == "messaging.projection.read":
                    return {
                        "messages": {
                            "conversation-retention": [
                                {"messageId": "message-protected"},
                                {"messageId": "message-recent"},
                            ]
                        }
                    }
                raise AssertionError(action)

            def execute_script(self, script: str) -> object:
                if "data-chat-storage-summary" in script:
                    return self.snapshots.pop(0)
                return True

        with patch(
            "tooling.acceptance.gates.mobile.simulator_social_e2e.time.sleep",
        ):
            result = SimulatorSocialGate(
                "storage-retention"
            )._run_storage_retention_journey(
                session=Session(),
                journey_id="run",
            )

        self.assertEqual(result["retentionPreset"], "4")
        self.assertEqual(result["releasedBytes"], 2_500_000)
        self.assertTrue(result["prunedMessageAbsent"])
        self.assertTrue(result["protectedMessagePreserved"])
        self.assertTrue(result["recentMessagePreserved"])
        self.assertTrue(result["restartStable"])

    def test_moments_journey_requires_receiver_and_rollback_readback(
        self,
    ) -> None:
        draft = {
            "kind": "moment",
            "targetId": "moment-compose-run",
            "payloadSha256": "b" * 64,
        }

        class SenderSession:
            def call_action(
                self,
                action: str,
                payload: object = None,
            ) -> object:
                if action == "moments.publish":
                    return {
                        "postId": "post-1",
                        "authorPtid": "ptid:alice",
                        "text": "mobile-moment-run",
                    }
                if action == "moments.comment":
                    return {"commentId": "reply-1"}
                if action == "reliability.draft.write":
                    return draft
                if action == "lifecycle.restart":
                    return {"requested": True, "scope": "webview"}
                if action == "reliability.draft.read":
                    return [draft]
                if action == "reliability.draft.action":
                    return {"drafts": []}
                raise AssertionError((action, payload))

        class ReceiverSession:
            def call_action(
                self,
                action: str,
                payload: object = None,
            ) -> object:
                if action == "moments.feed.read":
                    return {
                        "posts": [{
                            "postId": "post-1",
                            "authorPtid": "ptid:alice",
                            "text": "mobile-moment-run",
                        }]
                    }
                if action == "moments.react":
                    if isinstance(payload, dict) and payload.get("active"):
                        return [{
                            "kind": 1,
                            "count": "1",
                            "reactedByViewer": True,
                        }]
                    return []
                if action == "moments.comment":
                    return {"commentId": "comment-1"}
                if action == "moments.comments.read":
                    return [
                        {"commentId": "comment-1"},
                        {"commentId": "reply-1"},
                    ]
                raise AssertionError((action, payload))

        sender = MessagingActor(
            client_id="sim-ios",
            role="alice",
            station_url="https://primary.example",
            station_peer_id="station-primary",
            ptid="ptid:alice",
            account_ref="station-account:alice@p.t",
            federated_handle="@alice@primary",
            federation_id="federation-1",
        )
        receiver = MessagingActor(
            client_id="sim-ios-peer",
            role="bob",
            station_url="https://secondary.example",
            station_peer_id="station-secondary",
            ptid="ptid:bob",
            account_ref="station-account:bob@p.t",
            federated_handle="@bob@secondary",
            federation_id="federation-1",
        )

        result = SimulatorSocialGate("moments")._run_moments_journey(
            sender_session=SenderSession(),
            receiver_session=ReceiverSession(),
            sender=sender,
            receiver=receiver,
            journey_id="run",
        )

        self.assertEqual(result["post"]["postId"], "post-1")
        self.assertTrue(result["reactionCommitted"])
        self.assertTrue(result["reactionRolledBack"])
        self.assertTrue(result["draftRestartReadback"])


if __name__ == "__main__":
    unittest.main()
