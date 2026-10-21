from __future__ import annotations

import unittest
from pathlib import Path

from tooling.acceptance.gates.agent.agent_definition_roundtrip import (
    GATE_ID,
    suite_contract,
)
from tooling.acceptance.gates.agent.native_agent_runner import (
    GATE_BY_JOURNEY,
    approved_profile_for_journey,
    provider_configuration_required_for_journey,
)


ROOT = Path(__file__).resolve().parents[4]


class AgentDefinitionRoundtripTest(unittest.TestCase):
    def test_gate_uses_profile_two_and_closed_suite_contract(self) -> None:
        self.assertEqual(GATE_BY_JOURNEY["agent-definition"], GATE_ID)
        self.assertEqual(approved_profile_for_journey("agent-definition"), "two")
        self.assertFalse(
            provider_configuration_required_for_journey("agent-definition")
        )
        contract = suite_contract()
        self.assertEqual(contract.scenario_ids, (
            "definition-create",
            "definition-edit-package",
            "definition-restart",
            "definition-conflict",
        ))
        self.assertEqual(contract.max_provisioning_runs, 1)
        self.assertEqual(contract.max_client_launches, 2)
        self.assertTrue(contract.allow_client_replacement)

    def test_package_roundtrip_uses_production_desktop_api(self) -> None:
        source = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        start = source.index("async roundtripAgentDefinitionPackage")
        end = source.index("async getFoundationAgentState", start)
        method = source[start:end]
        self.assertIn("api.exportAgentPackage(agentId)", method)
        self.assertIn("api.importAgentPackage(exported.package, importedName)", method)
        self.assertIn("api.getAgent(imported.agent.id)", method)
        self.assertNotIn("useAgentStore", method)

    def test_conflict_path_uses_visible_editor_and_station_cas(self) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/chat_profile_scenarios.py"
        ).read_text(encoding="utf-8")
        start = source.index("def conflict_preserves_document_draft")
        conflict = source[start:]
        self.assertIn('"agents_update"', conflict)
        self.assertIn('textarea[aria-label="SOUL.md"]', conflict)
        self.assertIn("ptAgentProfileSaveState", conflict)
        self.assertIn(".ant-message-notice-content", conflict)

    def test_skill_fixture_uses_target_agent_and_binding_authority(self) -> None:
        fixture = (
            ROOT
            / "tooling/acceptance/gates/agent/chat_extension_fixture.py"
        ).read_text(encoding="utf-8")
        scenarios = (
            ROOT
            / "tooling/acceptance/gates/agent/chat_profile_scenarios.py"
        ).read_text(encoding="utf-8")
        self.assertIn('"agent_id": agent_id', fixture)
        self.assertNotIn('"skills_toggle"', fixture)
        self.assertIn('"skill_view"', scenarios)
        self.assertIn("CONTEXT_SEGMENT_TYPE_SKILL_INDEX", scenarios)
        self.assertIn("CONTEXT_SEGMENT_TYPE_SKILL_BODY", scenarios)
        self.assertIn("expected_body_ref", scenarios)


if __name__ == "__main__":
    unittest.main()
