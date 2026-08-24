from __future__ import annotations

import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
RUNNER = ROOT / "tooling" / "acceptance" / "gates" / "agent" / "native_agent_runner.py"
HARNESS = ROOT / "apps" / "desktop" / "src" / "acceptance" / "agent" / "harness.ts"


class AgentNativeRunnerStaticTest(unittest.TestCase):
    def setUp(self) -> None:
        self.source = RUNNER.read_text(encoding="utf-8")
        self.tree = ast.parse(self.source)

    def test_runner_file_exists(self) -> None:
        self.assertTrue(RUNNER.is_file(), f"{RUNNER} must exist")

    def test_runner_uses_canonical_tauri_driver(self) -> None:
        self.assertIn("make", self.source)
        self.assertIn("desktop", self.source)
        self.assertIn("PT_DESKTOP_E2E", self.source)
        self.assertIn("webdriver", self.source.lower())

    def test_runner_does_not_invent_env_vars(self) -> None:
        forbidden = ["AGENT_E2E_STATION_URL", "AGENT_E2E_EMAIL", "AGENT_E2E_PASSWORD"]
        for var in forbidden:
            with self.subTest(var=var):
                self.assertNotIn(var, self.source)

    def test_runner_uses_peers_touch_acceptance_prefix(self) -> None:
        self.assertIn("PEERS_TOUCH_ACCEPTANCE_STATION_URL", self.source)
        self.assertIn("PEERS_TOUCH_ACCEPTANCE_PASSWORD", self.source)
        self.assertIn("PEERS_TOUCH_ACCEPTANCE_ACTOR_EMAIL", self.source)

    def test_runner_accepts_legacy_fallback(self) -> None:
        self.assertIn("CHAT_NATIVE_STATION_URL", self.source)
        self.assertIn("CHAT_NATIVE_DEMO_PASSWORD", self.source)

    def test_runner_default_station_matches_topology(self) -> None:
        self.assertIn("10.37.94.156:18080", self.source)

    def test_runner_enables_e2e_feature(self) -> None:
        self.assertIn("PT_DESKTOP_E2E", self.source)
        self.assertIn("e2e-testing", self.source)

    def test_runner_cleans_up_process_and_driver(self) -> None:
        self.assertIn("driver.quit()", self.source)
        self.assertIn("process.terminate()", self.source)

    def test_runner_emits_evidence_report(self) -> None:
        self.assertIn("agent-native-turn.json", self.source)
        self.assertIn("stationUrl", self.source)
        self.assertIn("startedAt", self.source)
        self.assertIn("completedAt", self.source)

    def test_runner_uses_acceptance_harness(self) -> None:
        self.assertIn("__PT_ACCEPTANCE__", self.source)
        self.assertIn("agent", self.source)

    def test_runner_waits_for_harness(self) -> None:
        self.assertIn("__PT_ACCEPTANCE__", self.source)
        self.assertIn("wait_harness", self.source)
        self.assertIn("agent harness", self.source.lower())

    def test_runner_has_step_telemetry(self) -> None:
        self.assertIn("def step(", self.source)
        self.assertIn("durationMs", self.source)

    def test_no_fixed_sleep_in_runner(self) -> None:
        self.assertNotIn("time.sleep(", self.source)

    def test_runner_uses_selenium(self) -> None:
        self.assertIn("selenium", self.source)
        self.assertIn("webdriver.Remote", self.source)


class AgentHarnessStaticTest(unittest.TestCase):
    def setUp(self) -> None:
        self.assertTrue(HARNESS.is_file(), f"{HARNESS} must exist")
        self.source = HARNESS.read_text(encoding="utf-8")

    def test_harness_registers_agent_namespace(self) -> None:
        self.assertIn("registerAcceptanceHarness('agent'", self.source)

    def test_harness_exposes_login(self) -> None:
        self.assertIn("loginWithPassword", self.source)

    def test_harness_exposes_navigate_to_agent(self) -> None:
        self.assertIn("navigateToAgent", self.source)
        self.assertIn("#/agent", self.source)

    def test_harness_exposes_send_message(self) -> None:
        self.assertIn("sendMessage", self.source)
        self.assertIn("useChatStore", self.source)

    def test_harness_exposes_get_messages(self) -> None:
        self.assertIn("getMessages", self.source)

    def test_harness_exposes_wait_for_response(self) -> None:
        self.assertIn("waitForAssistantResponse", self.source)

    def test_harness_reuses_identity_runtime(self) -> None:
        self.assertIn("identityRuntime", self.source)
        self.assertIn("loginWithPassword", self.source)

    def test_harness_does_not_contain_secrets(self) -> None:
        self.assertNotIn("password =", self.source.replace("password }", ""))


class AgentSelectorsBoundInProductSource(unittest.TestCase):
    def test_composer_selector_bound(self) -> None:
        source = (ROOT / "apps/desktop/src/components/ChatInput.tsx").read_text(encoding="utf-8")
        self.assertIn("data-agent-composer", source)
        self.assertIn("data-agent-send", source)
        self.assertIn("data-agent-capability-warning", source)

    def test_message_selectors_bound(self) -> None:
        assistant = (ROOT / "apps/desktop/src/components/messages/AssistantMessage.tsx").read_text(encoding="utf-8")
        self.assertIn("data-agent-message", assistant)
        self.assertIn("data-role=\"assistant\"", assistant)
        self.assertIn("data-budget-notice", assistant)
        self.assertIn("data-source-badges", assistant)

        user = (ROOT / "apps/desktop/src/components/messages/UserMessage.tsx").read_text(encoding="utf-8")
        self.assertIn("data-agent-message", user)
        self.assertIn("data-role=\"user\"", user)

    def test_tool_approval_selectors_bound(self) -> None:
        source = (ROOT / "apps/desktop/src/components/messages/ToolCallCard.tsx").read_text(encoding="utf-8")
        self.assertIn("data-tool-approve", source)
        self.assertIn("data-tool-deny", source)
        self.assertIn("data-tool-call", source)

if __name__ == "__main__":
    unittest.main()
