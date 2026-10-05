from __future__ import annotations

import unittest

from tooling.development.secure_content.platform_runtime import (
    load_platform_runtime_contract,
)


class PlatformRuntimeContractTest(unittest.TestCase):
    def test_contract_covers_every_downstream_platform_child(self) -> None:
        contract = load_platform_runtime_contract()

        self.assertEqual("four", contract.controller_profile)
        self.assertEqual(5, contract.controller_slot)
        self.assertEqual(
            set(contract.commands),
            {
                "run-w9-ios",
                "run-w9-android",
                "run-w9-cross-platform",
                "run-w2-desktop",
                "run-w2-ios",
                "run-w2-android",
                "run-w10-desktop",
                "run-w10-ios",
                "run-w10-android",
                "run-w11-desktop",
                "run-w11-ios",
                "run-w11-android",
                "run-w11-chat-desktop",
                "run-w11-chat-ios",
                "run-w11-chat-android",
                "run-final-desktop",
                "run-final-ios",
                "run-final-android",
                "run-final-chat-desktop",
                "run-final-chat-ios",
                "run-final-chat-android",
            },
        )

    def test_mobile_commands_project_typed_isolated_client_specs(self) -> None:
        contract = load_platform_runtime_contract()
        command = contract.command("run-w9-cross-platform")

        clients = command.mobile_clients

        self.assertEqual(
            tuple(client.id for client in clients),
            ("ios_alice", "ios_bob", "android_alice", "android_bob"),
        )
        self.assertEqual(
            {client.runtime for client in clients},
            {"tauri-ios-simulator", "tauri-android-emulator"},
        )
        self.assertEqual(
            len({client.storage_root for client in clients}),
            len(clients),
        )

    def test_commands_own_manifests_and_do_not_accept_manifest_paths(
        self,
    ) -> None:
        contract = load_platform_runtime_contract()

        for command in contract.commands.values():
            with self.subTest(action=command.action):
                self.assertTrue(command.fixture_operations)
                self.assertTrue(command.clients)
                self.assertTrue(command.profiles)
                self.assertNotIn("manifest", command.action)
        self.assertNotIn(
            "full-social",
            contract.command("run-w11-ios").fixture_operations,
        )

    def test_w2_uses_one_task_owner_and_cross_station_mobile_is_isolated(
        self,
    ) -> None:
        contract = load_platform_runtime_contract()
        for action in ("run-w2-desktop", "run-w2-ios", "run-w2-android"):
            self.assertEqual(
                "secure-content-w2",
                contract.command(action).work_item_id,
            )

        self.assertEqual(
            (
                "secure-content-hardcut-ios-alice",
                "secure-content-hardcut-ios-remote_bob",
            ),
            contract.command("run-w11-chat-ios").clients,
        )
        self.assertEqual(
            (
                "secure-content-android-alice",
                "secure-content-android-remote_bob",
            ),
            contract.command("run-final-chat-android").clients,
        )

if __name__ == "__main__":
    unittest.main()
