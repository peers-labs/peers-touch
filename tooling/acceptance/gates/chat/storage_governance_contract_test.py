from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


class StorageGovernanceContractTest(unittest.TestCase):
    def test_proto_owns_the_complete_storage_contract(self) -> None:
        proto = (ROOT / "model/domain/chat/storage.proto").read_text(encoding="utf-8")

        for declaration in (
            "message ChatStorageScope",
            "message ConversationStorageUsage",
            "message ChatStorageSnapshot",
            "message ChatStoragePolicy",
            "message ChatStorageOperation",
            "message ChatStorageResult",
            "enum ChatStorageErrorCode",
            "CHAT_RETENTION_PRESET_FOREVER",
            "CHAT_RETENTION_PRESET_365_DAYS",
            "CHAT_RETENTION_PRESET_90_DAYS",
            "CHAT_RETENTION_PRESET_30_DAYS",
        ):
            self.assertIn(declaration, proto)

        for generated in (
            "apps/station/frame/touch/model/chat/storage.pb.go",
            "apps/desktop/src/gen/proto/domain/chat/storage_pb.ts",
            "apps/mobile/src/gen/proto/domain/chat/storage_pb.ts",
        ):
            self.assertTrue((ROOT / generated).is_file(), generated)

    def test_shared_core_is_the_only_accounting_policy_owner(self) -> None:
        core = (
            ROOT / "packages/messaging-core/src/storage_governance/mod.rs"
        ).read_text(encoding="utf-8")
        desktop_engine = (
            ROOT / "apps/desktop/src-tauri/src/messaging/engine.rs"
        ).read_text(encoding="utf-8")
        mobile_engine = (
            ROOT / "apps/mobile/src-tauri/src/messaging/engine.rs"
        ).read_text(encoding="utf-8")

        self.assertIn("pub fn measure_storage(", core)
        self.assertIn("FileIdentity", core)
        self.assertNotIn("rusqlite", core)
        self.assertNotIn("tauri", core)
        self.assertIn("measure_storage(StorageAccountingInput", desktop_engine)
        self.assertIn("measure_storage(StorageAccountingInput", mobile_engine)

    def test_both_clients_register_scope_fenced_snapshot_commands(self) -> None:
        desktop_command = (
            ROOT
            / "apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs"
        ).read_text(encoding="utf-8")
        desktop_main = (
            ROOT / "apps/desktop/src-tauri/src/main.rs"
        ).read_text(encoding="utf-8")
        desktop_runtime = (
            ROOT / "apps/desktop/src/runtimes/chatStorageRuntime.ts"
        ).read_text(encoding="utf-8")
        mobile_command = (
            ROOT / "apps/mobile/src-tauri/src/messaging/commands.rs"
        ).read_text(encoding="utf-8")
        mobile_registry = (
            ROOT / "apps/mobile/src-tauri/src/commands/mod.rs"
        ).read_text(encoding="utf-8")
        mobile_runtime = (
            ROOT / "apps/mobile/src/runtimes/chatStorageRuntime.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("pub async fn chat_storage_snapshot(", desktop_command)
        self.assertIn("messaging_commands::chat_storage_snapshot", desktop_main)
        self.assertIn("isChatStorageSnapshotForScope", desktop_runtime)
        self.assertIn("pub async fn chat_storage_snapshot(", mobile_command)
        self.assertEqual(mobile_registry.count("chat_storage_snapshot"), 2)
        self.assertIn("isChatStorageSnapshotForScope", mobile_runtime)

    def test_storage_ui_uses_runtime_projection_and_fixed_zero_api_is_gone(self) -> None:
        desktop_settings = (
            ROOT / "apps/desktop/src/pages/SettingsPage.tsx"
        ).read_text(encoding="utf-8")
        desktop_storage = (
            ROOT / "apps/desktop/src/components/settings/ChatStorageSettings.tsx"
        ).read_text(encoding="utf-8")
        mobile_storage = (
            ROOT / "apps/mobile/src/pages/settings/SettingsSections.tsx"
        ).read_text(encoding="utf-8")
        live_sources = tuple(
            ROOT / path
            for path in (
                "apps/desktop/src-tauri/src/application/system/mod.rs",
                "apps/desktop/src-tauri/src/interface/tauri_commands/system.rs",
                "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
                "apps/desktop/src-tauri/src/main.rs",
                "apps/desktop/src/services/desktop_api.ts",
            )
        )

        self.assertIn("render: () => <ChatStorageSettings />", desktop_settings)
        self.assertIn("useChatStorageProjection()", desktop_storage)
        self.assertIn("useMobileChatStorageProjection()", mobile_storage)
        removed_command = "statistics" + "_get"
        offenders = [
            str(path.relative_to(ROOT))
            for path in live_sources
            if removed_command in path.read_text(encoding="utf-8")
        ]
        self.assertEqual(offenders, [])

    def test_accounting_gate_uses_single_profile_native_runtime(self) -> None:
        gates = json.loads(
            (ROOT / "tooling/acceptance/gates.yaml").read_text(encoding="utf-8")
        )["gates"]
        gate = gates["chat-storage-accounting-e2e"]
        environment = json.loads(
            (
                ROOT
                / "tooling/acceptance/environments/chat-storage-native.yaml"
            ).read_text(encoding="utf-8")
        )
        desktop_storage = (
            ROOT / "apps/desktop/src/components/settings/ChatStorageSettings.tsx"
        ).read_text(encoding="utf-8")

        self.assertEqual(gate["environment"], "chat-storage-native")
        self.assertEqual(gate["provisioner"], "chat-storage-native")
        self.assertEqual(set(environment["services"]), {"station"})
        self.assertEqual(
            {client["id"] for client in environment["clients"]},
            {"alice", "bob"},
        )
        self.assertIn("storage_governance_runner", gate["command"])
        for selector in (
            "data-chat-storage-summary",
            "data-chat-storage-conversation",
            "data-chat-storage-search",
            "data-chat-storage-sort-option",
            "data-chat-storage-refresh",
        ):
            self.assertIn(selector, desktop_storage)


if __name__ == "__main__":
    unittest.main()
