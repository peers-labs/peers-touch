from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from tooling.acceptance.gates.agent.agent_v2_candidate_producer import (
    AgentV2CandidateAssembler,
)
from tooling.acceptance.gates.agent.mcp_lifecycle_candidate import (
    AGENT_V2_MCP_GATE,
    MOBILE_MARKERS,
    McpLifecycleMobileAdapter,
    ROOT,
    inspect_candidate_fixture,
)


class McpLifecycleCandidateTest(unittest.TestCase):
    def test_reviewed_matrix_contains_exact_j04_platform_split(self) -> None:
        tuples = AgentV2CandidateAssembler(
            AGENT_V2_MCP_GATE
        ).runtime_tuples

        self.assertEqual(len(tuples), 41)
        self.assertEqual(
            {
                platform: sum(
                    runtime_tuple.platform == platform
                    for runtime_tuple in tuples
                )
                for platform in ("desktop_app", "browser", "mobile_contract")
            },
            {
                "desktop_app": 34,
                "browser": 4,
                "mobile_contract": 3,
            },
        )

    def test_fixture_inspection_reports_zero_residue(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="mca-j04-candidate-test-"
        ) as raw:
            root = Path(raw)
            secret_digest = hashlib.sha256(b"secret").hexdigest()
            (root / "launch-count").write_text("2", encoding="utf-8")
            (root / "side-effect-count").write_text("1", encoding="utf-8")
            (root / "secret-sha256").write_text(
                secret_digest,
                encoding="utf-8",
            )
            (root / "process-1.json").write_text(
                json.dumps({"launch": 1, "pid": 99999999, "port": 1}),
                encoding="utf-8",
            )

            evidence = inspect_candidate_fixture(
                root,
                expected_secret_digest=secret_digest,
            )

        self.assertEqual(evidence["launchCount"], 2)
        self.assertEqual(evidence["sideEffectCount"], 1)
        self.assertEqual(evidence["liveProcessCount"], 0)
        self.assertEqual(evidence["openPortCount"], 0)
        self.assertTrue(evidence["secretDigestMatched"])

    def test_mobile_adapter_runs_each_reviewed_marker_independently(self) -> None:
        calls: list[tuple[str, ...]] = []

        def runner(
            command: tuple[str, ...],
            **_: object,
        ) -> subprocess.CompletedProcess[str]:
            calls.append(command)
            marker = next(
                value
                for value in command
                if value.startswith(r"\[")
            ).replace(r"\[", "[").replace(r"\]", "]")
            report = {
                "success": True,
                "testResults": [{
                    "assertionResults": [{
                        "fullName": f"contract {marker}",
                        "status": "passed",
                    }],
                }],
            }
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps(report),
                stderr="",
            )

        adapter = McpLifecycleMobileAdapter(
            runner=runner,
            now=lambda: datetime(2026, 9, 20, tzinfo=timezone.utc),
        )
        mobile_tuples = [
            runtime_tuple
            for runtime_tuple in AgentV2CandidateAssembler(
                AGENT_V2_MCP_GATE
            ).runtime_tuples
            if runtime_tuple.platform == "mobile_contract"
        ]

        observations = [
            adapter.observe(runtime_tuple)
            for runtime_tuple in mobile_tuples
        ]

        self.assertEqual(len(calls), 3)
        self.assertEqual(
            {runtime_tuple.cell for runtime_tuple in mobile_tuples},
            set(MOBILE_MARKERS),
        )
        self.assertTrue(
            all(
                observation.runtime_attestation.profile == "contract_only"
                and observation.role_observations["zero-execution"]["count"]
                == 0
                for observation in observations
            )
        )

    def test_formal_entrypoint_and_harness_are_connected(self) -> None:
        development = (
            ROOT
            / "tooling/acceptance/gates/agent/mcp_lifecycle_development.py"
        ).read_text(encoding="utf-8")
        harness = (
            ROOT
            / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        desktop_journey = harness[
            harness.index("async function prepareMcpLifecycleDevelopmentJourney("):
            harness.index("async function recoverMcpLifecycleDevelopmentJourney(")
        ]

        self.assertIn('sys.argv[1:] == ["--formal-candidate"]', development)
        self.assertIn("async runMcpLifecycleScenario(", harness)
        self.assertIn(
            "CapabilityAcceptanceScenarioFamily.MCP_J04",
            harness,
        )
        self.assertIn(
            "CapabilityAcceptanceRuntimeProfile.CLIENT_CAPABILITY_TURN",
            harness,
        )
        self.assertIn(
            "'MCP cleanup Agent session surface'",
            harness,
        )
        self.assertIn(
            "'MCP Agent session surface'",
            harness,
        )
        self.assertIn(
            "'MCP unavailable cleanup Agent session surface'",
            harness,
        )
        self.assertIn(
            "await reconcileFoundationToolReceiver();",
            desktop_journey,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
