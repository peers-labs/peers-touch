from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import REPO_ROOT
from tooling.acceptance.gates.chat.lifecycle_interactions_group import GATE_ID
from tooling.acceptance.gates.chat.native_interactions_runner import main as native_main
from tooling.acceptance.provisioners.home_station import CLIENT_ROLES, GATE_ROLES


class LifecycleInteractionsGroupContractTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (REPO_ROOT / path).read_text(encoding="utf-8")

    def test_formal_gate_is_registered_and_selected(self) -> None:
        gates = json.loads(self.source("tooling/acceptance/gates.yaml"))
        self.assertEqual(
            gates["gates"][GATE_ID]["environment"],
            "native-tauri-embedded-webdriver",
        )
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "plan.json"
            subprocess.run(
                (
                    "python3",
                    "tooling/scripts/acceptance-plan.py",
                    "--changed-file",
                    "apps/desktop/src/components/chat/ChatDetailPanel.tsx",
                    "--changed-file",
                    "model/domain/chat/command.proto",
                    "--changed-file",
                    "tooling/acceptance/gates/chat/lifecycle_interactions_group.py",
                    "--output",
                    str(output),
                ),
                cwd=REPO_ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            selected = {
                gate["id"]
                for gate in json.loads(output.read_text())["selected_gates"]
            }
        self.assertIn(GATE_ID, selected)

    def test_shared_native_runner_exposes_a_reusable_entry_point(self) -> None:
        self.assertTrue(callable(native_main))

    def test_formal_gate_has_native_actor_and_client_allocations(self) -> None:
        expected_roles = ("alice", "bob", "charlie")
        self.assertEqual(GATE_ROLES[GATE_ID], expected_roles)
        self.assertEqual(CLIENT_ROLES[GATE_ID], expected_roles)

    def test_active_client_has_no_legacy_group_mutation_owner(self) -> None:
        active_sources = "\n".join(
            self.source(path)
            for path in (
                "apps/desktop/src/components/chat/ChatDetailPanel.tsx",
                "apps/desktop/src/services/im-service.ts",
                "apps/desktop/src/services/desktop_api.ts",
                "apps/desktop/src-tauri/src/main.rs",
                "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
            )
        )
        for legacy in (
            "group_chat_create_group",
            "group_chat_invite_to_group",
            "group_chat_add_federated_member",
            "group_chat_join_group",
            "group_chat_remove_member",
            "group_chat_recall_message",
            "group_chat_edit_message",
            "group_chat_delete_message",
            "group_chat_update_nickname",
            "group_chat_update_settings",
            "group_chat_mark_read",
            "group_chat_ack_offline_messages",
            "group_chat_update_group",
            "group_chat_leave_group",
            "group_chat_update_member",
            "group_chat_transfer_ownership",
            "group_chat_dissolve_group",
        ):
            self.assertNotIn(legacy, active_sources)

    def test_native_journey_covers_complete_group_lifecycle(self) -> None:
        runner = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        harness = self.source("apps/desktop/src/acceptance/chat/harness.ts")
        for assertion in (
            "group_rename_convergence",
            "group_role_convergence",
            "group_owner_transfer_convergence",
            "group_remote_owner_mutation",
            "group_leave_convergence",
            "group_dissolve_terminal",
            "group_terminal_restart_history",
            "group_legacy_mutation_hard_cut",
        ):
            self.assertIn(assertion, runner)
        for action in (
            "updateGroup",
            "updateGroupMember",
            "transferGroupOwnership",
            "leaveGroup",
            "dissolveGroup",
            "groupLifecycleSnapshot",
        ):
            self.assertIn(action, harness)


if __name__ == "__main__":
    unittest.main()
