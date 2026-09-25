from __future__ import annotations

import unittest
from pathlib import Path

from tooling.acceptance.core import EnvironmentContract
from tooling.acceptance.gates.chat.storage_governance_runner import (
    storage_snapshot_is_valid,
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


if __name__ == "__main__":
    unittest.main()
