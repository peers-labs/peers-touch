from __future__ import annotations

import unittest
from pathlib import Path

from tooling.acceptance.core import EnvironmentContract
from tooling.acceptance.gates.chat.storage_governance_runner import (
    storage_snapshot_is_valid,
)
from tooling.acceptance.gates.chat.storage_redaction_recovery_runner import (
    GATE_ID as REDACTION_GATE_ID,
    redaction_snapshot_is_valid,
)
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

    def test_redaction_gate_uses_the_single_station_native_environment(
        self,
    ) -> None:
        contract = EnvironmentContract.from_yaml(
            ROOT / "tooling/acceptance/environments/chat-storage-native.yaml"
        )
        provisioner = get_provisioner(contract)

        self.assertIsInstance(provisioner, ChatStorageNativeProvisioner)
        self.assertEqual(REDACTION_GATE_ID, "chat-storage-redaction-recovery-e2e")


if __name__ == "__main__":
    unittest.main()
