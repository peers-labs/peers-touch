from __future__ import annotations

import unittest
from pathlib import Path

from tooling.acceptance.core import EnvironmentContract
from tooling.acceptance.gates.chat.storage_governance_runner import (
    storage_snapshot_is_valid,
)
from tooling.acceptance.gates.chat.storage_batch_desktop_runner import (
    BATCH_REQUIRED_ASSERTIONS,
    BATCH_REQUIRED_STEPS,
    GATE_ID as BATCH_GATE_ID,
)
from tooling.acceptance.gates.chat.storage_redaction_recovery_runner import (
    GATE_ID as REDACTION_GATE_ID,
    redaction_command_disposition,
    redaction_snapshot_is_valid,
)
from tooling.acceptance.gates.chat.native_two_client_runner import journey_for_gate
from tooling.acceptance.provisioners import (
    ChatStorageNativeProvisioner,
    get_provisioner,
)


ROOT = Path(__file__).resolve().parents[4]


class StorageGovernanceRunnerTest(unittest.TestCase):
    def test_single_station_environment_resolves_its_business_provisioner(
        self,
    ) -> None:
        contract = EnvironmentContract.from_yaml(
            ROOT / "tooling/acceptance/environments/chat-storage-native.yaml"
        )

        self.assertIsInstance(
            get_provisioner(contract),
            ChatStorageNativeProvisioner,
        )

    def test_accepts_nonzero_snapshot_with_owned_conversation_bytes(self) -> None:
        snapshot = {
            "physicalTotalBytes": 4096,
            "categories": {
                "message": 128,
                "media": 0,
                "cache": 0,
                "system": 3968,
            },
            "conversations": [
                {
                    "conversationId": "conversation-1",
                    "messageBytes": 128,
                    "mediaBytes": 0,
                }
            ],
        }

        self.assertTrue(
            storage_snapshot_is_valid(snapshot, "conversation-1")
        )

    def test_rejects_zero_or_unrelated_conversation_usage(self) -> None:
        snapshot = {
            "physicalTotalBytes": 4096,
            "categories": {
                "message": 0,
                "media": 0,
                "cache": 0,
                "system": 4096,
            },
            "conversations": [
                {
                    "conversationId": "conversation-2",
                    "messageBytes": 0,
                    "mediaBytes": 0,
                }
            ],
        }

        self.assertFalse(
            storage_snapshot_is_valid(snapshot, "conversation-1")
        )

    def test_accepts_complete_durable_redaction_snapshot(self) -> None:
        snapshot = {
            "projection": {
                "plaintextEmpty": True,
                "hiddenForActor": True,
                "retracted": False,
            },
            "redactionTombstones": [
                {
                    "kind": "hidden_for_actor",
                    "authoritySequence": 2,
                    "authorityEventHash": "ab" * 32,
                }
            ],
            "redactionCleanup": [
                {
                    "scopeKind": "actor_hide",
                    "state": "succeeded",
                }
            ],
            "searchEntryCount": 0,
            "attachmentProjectionCount": 0,
            "attachmentTransferCount": 0,
            "consumptionCount": 1,
            "laneSequence": 2,
        }

        self.assertTrue(
            redaction_snapshot_is_valid(
                snapshot,
                kind="hidden_for_actor",
            )
        )

    def test_rejects_redaction_snapshot_with_plaintext_or_no_tombstone(
        self,
    ) -> None:
        snapshot = {
            "projection": {
                "plaintextEmpty": False,
                "hiddenForActor": False,
                "retracted": True,
            },
            "redactionTombstones": [],
            "redactionCleanup": [
                {
                    "scopeKind": "retract",
                    "state": "compacting",
                }
            ],
            "searchEntryCount": 0,
            "attachmentProjectionCount": 0,
            "attachmentTransferCount": 0,
            "consumptionCount": 1,
            "laneSequence": 2,
        }

        self.assertFalse(
            redaction_snapshot_is_valid(snapshot, kind="retracted")
        )

    def test_accepts_terminal_file_cleanup_without_rolling_back_redaction(
        self,
    ) -> None:
        snapshot = {
            "projection": {
                "plaintextEmpty": True,
                "hiddenForActor": False,
                "retracted": True,
            },
            "redactionTombstones": [
                {
                    "kind": "retracted",
                    "authoritySequence": 3,
                    "authorityEventHash": "cd" * 32,
                }
            ],
            "redactionCleanup": [
                {
                    "scopeKind": "retract",
                    "state": "failed_terminal",
                }
            ],
            "searchEntryCount": 0,
            "attachmentProjectionCount": 0,
            "attachmentTransferCount": 0,
            "consumptionCount": 1,
            "laneSequence": 3,
        }

        self.assertTrue(
            redaction_snapshot_is_valid(snapshot, kind="retracted")
        )

    def test_retries_only_an_authority_head_stale_redaction_command(
        self,
    ) -> None:
        snapshot = {
            "intent": {"state": "failed"},
            "outbox": {
                "state": "failed",
                "lastErrorCode": "authority_head_stale",
            },
        }

        self.assertEqual(
            redaction_command_disposition(
                snapshot,
                kind="hidden_for_actor",
            ),
            "retry_authority_head",
        )
        snapshot["outbox"]["lastErrorCode"] = "permission_denied"
        self.assertEqual(
            redaction_command_disposition(
                snapshot,
                kind="hidden_for_actor",
            ),
            "failed",
        )

    def test_redaction_gate_uses_the_single_station_native_environment(
        self,
    ) -> None:
        contract = EnvironmentContract.from_yaml(
            ROOT / "tooling/acceptance/environments/chat-storage-native.yaml"
        )
        provisioner = get_provisioner(contract)

        self.assertIsInstance(provisioner, ChatStorageNativeProvisioner)
        self.assertEqual(REDACTION_GATE_ID, "chat-storage-redaction-recovery-e2e")
        self.assertEqual(
            journey_for_gate(REDACTION_GATE_ID),
            "storage-redaction-recovery",
        )

    def test_batch_gate_uses_visible_desktop_storage_controls(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ROOT / "tooling/acceptance/environments/chat-storage-native.yaml"
        )
        provisioner = get_provisioner(contract)
        desktop_ui = (
            ROOT
            / "apps/desktop/src/components/settings/ChatStorageSettings.tsx"
        ).read_text(encoding="utf-8")

        self.assertIsInstance(provisioner, ChatStorageNativeProvisioner)
        self.assertEqual(
            journey_for_gate(BATCH_GATE_ID),
            "storage-batch-clear",
        )
        for assertion in (
            "storage_batch_explicit_selection",
            "storage_batch_confirmation_context",
            "storage_batch_progress_visible",
            "storage_batch_estimated_reclaimable",
            "storage_batch_partial_failure_retry",
            "storage_batch_scope_change_isolated",
            "storage_batch_unselected_preserved",
        ):
            self.assertIn(assertion, BATCH_REQUIRED_ASSERTIONS)
        for step in (
            "storage.batch.confirm",
            "storage.batch.partial_failure",
            "storage.batch.retry",
            "storage.batch.scope_change",
            "storage.batch.restart",
        ):
            self.assertIn(step, BATCH_REQUIRED_STEPS)
        self.assertIn("data-chat-storage-batch-manage", desktop_ui)
        self.assertIn("data-chat-storage-batch-confirm-apply", desktop_ui)
        runner = (
            ROOT
            / "tooling/acceptance/gates/chat/storage_batch_desktop_runner.py"
        ).read_text(encoding="utf-8")
        self.assertIn('"seedConversationClear"', runner)
        self.assertIn("data-chat-storage-batch-estimated-bytes", runner)
        self.assertIn("control?.matches('input')", runner)
        self.assertIn("Desktop batch selection controls", runner)
        self.assertIn("self._conversation_selected(", runner)
        self.assertIn("self.restart_client(actor)", runner)
        self.assertIn('"configureStorageBatchScenario"', runner)
        self.assertIn('"restoreStorageScope"', runner)
        self.assertNotIn("client.driver.refresh()", runner)
        self.assertNotIn('"createGroup"', runner)


if __name__ == "__main__":
    unittest.main()
