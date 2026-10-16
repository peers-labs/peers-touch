from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
ACCEPTANCE_ROOT = ROOT / "tooling" / "acceptance"
PLAN_SCRIPT = ROOT / "tooling" / "scripts" / "acceptance-plan.py"
sys.path.insert(0, str(PLAN_SCRIPT.parent))

SPEC = importlib.util.spec_from_file_location("acceptance_plan", PLAN_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"failed to load {PLAN_SCRIPT}")
ACCEPTANCE_PLAN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ACCEPTANCE_PLAN)


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class MessagePublishingContractTest(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self.feature = load(
            ACCEPTANCE_ROOT / "features" / "chat-message-publishing.yaml"
        )
        self.capabilities = load(
            ACCEPTANCE_ROOT / "capabilities" / "chat.yaml"
        )["capabilities"]
        self.domain = load(ACCEPTANCE_ROOT / "domains" / "chat.yaml")
        self.gates = load(ACCEPTANCE_ROOT / "gates.yaml")["gates"]
        self.registry = load(ACCEPTANCE_ROOT / "registry.yaml")["rules"]

    def test_feature_capability_domain_and_gate_form_one_chat_graph(self) -> None:
        self.assertEqual(self.feature["id"], "chat-message-publishing")
        self.assertEqual(self.feature["status"], "active")
        required_truths = {
            "Conversation publication receipts keyed by stable publishing identity and command ID",
            "Conversation message and event authority sequence",
            "per-device Device Inbox service-plaintext delivery",
            "Conversation transaction notification rows",
            "Desktop Device Messaging Engine and social chat projection",
        }
        self.assertEqual(set(self.feature["truth_sources"]), required_truths)

        matches = [
            capability
            for capability in self.capabilities
            if capability["id"] == "chat-message-publishing"
        ]
        self.assertEqual(len(matches), 1)
        capability = matches[0]
        self.assertEqual(capability["domain"], "chat")
        self.assertEqual(capability["features"], ["chat-message-publishing"])
        self.assertIn("chat-message-publishing", self.domain["capabilities"])

        gate = self.gates["chat-message-publishing-native-e2e"]
        self.assertEqual(gate["environment"], "home-station")
        self.assertEqual(gate["provisioner"], "home-station")
        self.assertEqual(gate["requiredRuntimeCells"], ["desktop-macos-native"])
        self.assertEqual(
            gate["argv"],
            [
                "python3",
                "-m",
                "tooling.acceptance.gates.chat.message_publishing_native_e2e",
            ],
        )

        expected_gates = {
            "proto-build",
            "station-api-ownership",
            "station-messaging-unit",
            "messaging-platform-contract",
            "desktop-check",
            "chat-message-publishing-native-e2e",
        }
        self.assertEqual(set(self.feature["required_gates"]), expected_gates)
        self.assertEqual(set(capability["required_gates"]), expected_gates)

    def test_registry_maps_only_generic_publishing_and_current_bot_adapter(self) -> None:
        matches = [
            rule for rule in self.registry if rule["id"] == "chat-message-publishing"
        ]
        self.assertEqual(len(matches), 1)
        rule = matches[0]
        self.assertEqual(rule["features"], ["chat-message-publishing"])
        paths = set(rule["when"]["paths"])
        for required_path in (
            "apps/station/app/subserver/conversation/application/publishing/**",
            "apps/station/app/subserver/bot/application/registry/**",
            "packages/messaging-core/src/inbox/service_plaintext.rs",
            "apps/desktop/src/components/chat/message/serviceEventAggregation*.ts",
            "apps/desktop/src/acceptance/message_publishing/**",
            "tooling/acceptance/gates/chat/message_publishing_*.py",
        ):
            self.assertIn(required_path, paths)
        self.assertFalse(any("webhook" in path.lower() for path in paths))
        self.assertFalse(
            any("serviceboteventcontent" in path.lower() for path in paths)
        )
        self.assertFalse(
            any("/bot/event" in path.lower() for path in paths)
        )

    def test_message_publishing_range_is_bounded_to_declared_gates(self) -> None:
        paths = [
            "model/domain/chat/publishing.proto",
            "apps/station/app/subserver/conversation/application/publishing/service_test.go",
            "apps/station/app/subserver/conversation/production_publishing_test.go",
            "apps/station/app/subserver/bot/application/registry/service_test.go",
            "packages/messaging-core/tests/service_plaintext_processor_test.rs",
            "apps/desktop/src/components/chat/message/serviceEventAggregation.test.ts",
            "apps/desktop/src/store/socialChat.conversationProjection.test.ts",
            "apps/desktop/src/acceptance/message_publishing/harness.ts",
            "tooling/acceptance/features/chat-message-publishing.yaml",
            "tooling/acceptance/gates/chat/message_publishing_contract_test.py",
            "tooling/acceptance/gates/chat/message_publishing_native_e2e.py",
            "tooling/acceptance/provisioners/home_station.py",
            "tooling/acceptance/tests/test_provisioner_runtime.py",
            "tooling/scripts/acceptance-plan-test.py",
            "tooling/acceptance/capabilities/chat.yaml",
            "tooling/acceptance/domains/chat.yaml",
            "tooling/acceptance/registry.yaml",
        ]
        projection = ACCEPTANCE_PLAN.plan(ACCEPTANCE_ROOT, paths)
        selected = {gate["id"] for gate in projection["selected_gates"]}
        self.assertEqual(
            selected,
            {
                "acceptance-plan-self",
                "acceptance-infra-validation",
                "acceptance-runtime-provisioning-self",
                "acceptance-workflow-contract",
                "proto-build",
                "station-api-ownership",
                "station-messaging-unit",
                "messaging-platform-contract",
                "desktop-check",
                "chat-message-publishing-native-e2e",
            },
        )


if __name__ == "__main__":
    unittest.main()
