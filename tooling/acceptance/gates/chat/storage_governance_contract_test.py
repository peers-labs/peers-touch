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

    def test_cache_cleanup_is_shared_scope_fenced_and_native_visible(self) -> None:
        core = (
            ROOT / "packages/messaging-core/src/storage_governance/cache.rs"
        ).read_text(encoding="utf-8")
        schema = (
            ROOT / "packages/messaging-core/src/store/schema.rs"
        ).read_text(encoding="utf-8")
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
        desktop_ui = (
            ROOT / "apps/desktop/src/components/settings/ChatStorageSettings.tsx"
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
        mobile_ui = (
            ROOT / "apps/mobile/src/pages/settings/SettingsSections.tsx"
        ).read_text(encoding="utf-8")

        for symbol in (
            "ChatStorageClass",
            "CacheCleanupJournalRepository",
            "prepare_cache_cleanup",
            "execute_cache_cleanup",
            "finalize_cache_cleanup",
            "ProtectedCandidate",
            "CompactionPending",
        ):
            self.assertIn(symbol, core)
        for table in ("chat_cleanup_journal", "chat_cleanup_items"):
            self.assertIn(table, schema)
        self.assertIn("pub async fn chat_storage_clear_cache(", desktop_command)
        self.assertIn("messaging_commands::chat_storage_clear_cache", desktop_main)
        self.assertIn("chatStorageClearCache", desktop_runtime)
        self.assertIn("isChatStorageResultForScope", desktop_runtime)
        self.assertIn("data-chat-storage-clear-confirm", desktop_ui)
        self.assertIn("data-chat-storage-released-bytes", desktop_ui)
        self.assertIn("pub async fn chat_storage_clear_cache(", mobile_command)
        self.assertEqual(mobile_registry.count("chat_storage_clear_cache"), 2)
        self.assertIn("chat_storage_acceptance_seed_cache", mobile_registry)
        self.assertIn("chatStorageClearCache", mobile_runtime)
        self.assertIn("isChatStorageResultForScope", mobile_runtime)
        self.assertIn("data-chat-storage-clear-confirm", mobile_ui)
        self.assertIn("data-chat-storage-released-bytes", mobile_ui)
        self.assertIn("data-mobile-device-cache-clear", mobile_ui)

    def test_cache_cleanup_gate_uses_one_station_mobile_runtime(self) -> None:
        gates = json.loads(
            (ROOT / "tooling/acceptance/gates.yaml").read_text(encoding="utf-8")
        )["gates"]
        gate = gates["chat-storage-cache-clear-e2e"]
        environment = json.loads(
            (
                ROOT
                / "tooling/acceptance/environments/mobile-direct-simulator.yaml"
            ).read_text(encoding="utf-8")
        )

        self.assertEqual(gate["environment"], "mobile-direct-simulator")
        self.assertEqual(gate["provisioner"], "mobile-direct-simulator")
        self.assertEqual(set(environment["services"]), {"station"})
        self.assertIn("storage.cache.seed", environment["harness"]["required_actions"])
        self.assertIn(
            "env -u PT_ACCEPTANCE_WORKSPACE_ID "
            "-u PT_ACCEPTANCE_GATE_ID "
            "-u PT_ACCEPTANCE_RUN_ID python3 -m unittest",
            gate["command"],
        )
        self.assertIn("--scenario storage-cache-cleanup", gate["command"])

    def test_retention_is_shared_scope_fenced_and_native_visible(self) -> None:
        proto = (ROOT / "model/domain/chat/storage.proto").read_text(encoding="utf-8")
        core = (
            ROOT / "packages/messaging-core/src/storage_governance/retention.rs"
        ).read_text(encoding="utf-8")
        schema = (
            ROOT / "packages/messaging-core/src/store/schema.rs"
        ).read_text(encoding="utf-8")
        desktop_command = (
            ROOT
            / "apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs"
        ).read_text(encoding="utf-8")
        desktop_main = (
            ROOT / "apps/desktop/src-tauri/src/main.rs"
        ).read_text(encoding="utf-8")
        mobile_command = (
            ROOT / "apps/mobile/src-tauri/src/messaging/commands.rs"
        ).read_text(encoding="utf-8")
        mobile_registry = (
            ROOT / "apps/mobile/src-tauri/src/commands/mod.rs"
        ).read_text(encoding="utf-8")
        desktop_ui = (
            ROOT / "apps/desktop/src/components/settings/ChatStorageSettings.tsx"
        ).read_text(encoding="utf-8")
        mobile_ui = (
            ROOT / "apps/mobile/src/pages/settings/SettingsSections.tsx"
        ).read_text(encoding="utf-8")
        recovery = (
            ROOT / "apps/desktop/src-tauri/src/messaging/recovery.rs"
        ).read_text(encoding="utf-8")

        self.assertIn("message ChatStorageRetentionRequest", proto)
        for symbol in (
            "ChatRetentionPreset",
            "RetentionRepository",
            "build_retention_plan",
            "sequence_is_above_retention_floor",
        ):
            self.assertIn(symbol, core)
        for table in (
            "chat_storage_policy",
            "chat_retention_floor",
            "messaging_authority_events",
        ):
            self.assertIn(table, schema)
        self.assertIn("pub async fn chat_storage_set_retention(", desktop_command)
        self.assertIn("messaging_commands::chat_storage_set_retention", desktop_main)
        self.assertIn("pub async fn chat_storage_set_retention(", mobile_command)
        self.assertEqual(mobile_registry.count("chat_storage_set_retention"), 2)
        self.assertIn("chat_storage_acceptance_seed_retention", mobile_registry)
        self.assertIn("data-chat-storage-retention-option", desktop_ui)
        self.assertIn("data-chat-storage-retention-option", mobile_ui)
        self.assertIn("MESSAGING_RECOVERY_FORMAT_VERSION: u32 = 4", recovery)
        self.assertIn("retention_floors", recovery)

    def test_retention_gate_uses_one_station_mobile_runtime(self) -> None:
        gates = json.loads(
            (ROOT / "tooling/acceptance/gates.yaml").read_text(encoding="utf-8")
        )["gates"]
        gate = gates["chat-storage-retention-e2e"]
        environment = json.loads(
            (
                ROOT
                / "tooling/acceptance/environments/mobile-direct-simulator.yaml"
            ).read_text(encoding="utf-8")
        )

        self.assertEqual(gate["environment"], "mobile-direct-simulator")
        self.assertEqual(gate["provisioner"], "mobile-direct-simulator")
        self.assertEqual(set(environment["services"]), {"station"})
        self.assertIn("storage.retention.seed", environment["harness"]["required_actions"])
        self.assertIn("--scenario storage-retention", gate["command"])

    def test_conversation_clear_is_connected_and_physically_proven(self) -> None:
        gates = json.loads(
            (ROOT / "tooling/acceptance/gates.yaml").read_text(encoding="utf-8")
        )["gates"]
        registry = json.loads(
            (ROOT / "tooling/acceptance/registry.yaml").read_text(
                encoding="utf-8"
            )
        )["rules"]
        domain = json.loads(
            (ROOT / "tooling/acceptance/domains/chat.yaml").read_text(
                encoding="utf-8"
            )
        )
        capabilities = json.loads(
            (ROOT / "tooling/acceptance/capabilities/chat.yaml").read_text(
                encoding="utf-8"
            )
        )["capabilities"]
        feature = json.loads(
            (
                ROOT
                / "tooling/acceptance/features/"
                "chat-storage-conversation-clear.yaml"
            ).read_text(encoding="utf-8")
        )
        environment = json.loads(
            (
                ROOT
                / "tooling/acceptance/environments/mobile-direct-simulator.yaml"
            ).read_text(encoding="utf-8")
        )
        core = (
            ROOT
            / "packages/messaging-core/src/storage_governance/"
            "conversation_clear.rs"
        ).read_text(encoding="utf-8")
        desktop_ui = (
            ROOT / "apps/desktop/src/components/chat/ChatDetailPanel.tsx"
        ).read_text(encoding="utf-8")
        mobile_ui = (
            ROOT / "apps/mobile/src/pages/ChatPage.tsx"
        ).read_text(encoding="utf-8")

        expected_gates = [
            "chat-storage-delete-reclaim-e2e",
            "chat-storage-dead-contract-zero-e2e",
        ]
        capability = next(
            item
            for item in capabilities
            if item["id"] == "chat-storage-conversation-clear"
        )
        rule = next(
            item
            for item in registry
            if item["id"] == "chat-storage-conversation-clear"
        )

        self.assertEqual(feature["required_gates"], expected_gates)
        self.assertEqual(capability["required_gates"], expected_gates)
        self.assertEqual(rule["require"], expected_gates)
        self.assertIn(
            "chat-storage-conversation-clear",
            domain["capabilities"],
        )
        for symbol in (
            "ConversationClearRepository",
            "build_conversation_clear_plan",
            "pruned_through_sequence",
            "authority_event_hash",
        ):
            self.assertIn(symbol, core)
        self.assertIn('data-chat-history-action="clear"', desktop_ui)
        self.assertIn("data-chat-actions-open", mobile_ui)
        self.assertIn("data-chat-conversation-clear-result", mobile_ui)
        self.assertIn(
            "storage.conversation-clear.seed",
            environment["harness"]["required_actions"],
        )
        delete_gate = gates["chat-storage-delete-reclaim-e2e"]
        self.assertEqual(delete_gate["environment"], "mobile-direct-simulator")
        self.assertEqual(
            delete_gate["provisioner"],
            "mobile-direct-simulator",
        )
        self.assertIn(
            "--scenario storage-conversation-clear",
            delete_gate["command"],
        )
        self.assertIn("pnpm --dir apps/desktop check", delete_gate["command"])
        self.assertNotIn("apps/desktop exec tsc -b", delete_gate["command"])
        self.assertEqual(
            gates["chat-storage-dead-contract-zero-e2e"]["environment"],
            "local",
        )

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

    def test_redaction_recovery_gate_is_connected_to_chat_domain(self) -> None:
        gates = json.loads(
            (ROOT / "tooling/acceptance/gates.yaml").read_text(encoding="utf-8")
        )["gates"]
        registry = json.loads(
            (ROOT / "tooling/acceptance/registry.yaml").read_text(
                encoding="utf-8"
            )
        )["rules"]
        domain = json.loads(
            (ROOT / "tooling/acceptance/domains/chat.yaml").read_text(
                encoding="utf-8"
            )
        )
        capabilities = json.loads(
            (ROOT / "tooling/acceptance/capabilities/chat.yaml").read_text(
                encoding="utf-8"
            )
        )["capabilities"]
        gate = gates["chat-storage-redaction-recovery-e2e"]
        rule = next(
            item
            for item in registry
            if item["id"] == "chat-storage-redaction-recovery"
        )
        capability = next(
            item
            for item in capabilities
            if item["id"] == "chat-storage-redaction-recovery"
        )

        self.assertEqual(gate["environment"], "chat-storage-native")
        self.assertEqual(gate["provisioner"], "chat-storage-native")
        self.assertIn(
            "chat-storage-redaction-recovery",
            domain["capabilities"],
        )
        self.assertEqual(
            capability["required_gates"],
            ["chat-storage-redaction-recovery-e2e"],
        )
        self.assertEqual(
            rule["require"],
            ["chat-storage-redaction-recovery-e2e"],
        )
        self.assertIn(
            "storage_redaction_recovery_runner",
            gate["command"],
        )

    def test_redaction_snapshot_exposes_durable_proof_without_plaintext(
        self,
    ) -> None:
        store = (
            ROOT / "apps/desktop/src-tauri/src/messaging/store.rs"
        ).read_text(encoding="utf-8")
        runner = (
            ROOT
            / "tooling/acceptance/gates/chat/"
            "storage_redaction_recovery_runner.py"
        ).read_text(encoding="utf-8")

        for marker in (
            '"plaintextEmpty"',
            '"hiddenForActor"',
            '"redactionTombstones"',
            '"searchEntryCount"',
            '"attachmentProjectionCount"',
            '"attachmentTransferCount"',
            '"redactionCleanup"',
        ):
            self.assertIn(marker, store)
        self.assertNotIn('"plaintext": row.get', store)
        for marker in (
            '"redaction.restart"',
            '"redaction.restore"',
            '"recovery_redaction_reconciliation"',
            '"redacted_plaintext_absent"',
            "self.arm_recovery_feedback_probe(actor)",
            "self.recovery_feedback_observed(actor)",
            "self.stop_recovery_feedback_probe(actor)",
        ):
            self.assertIn(marker, runner)


if __name__ == "__main__":
    unittest.main()
