#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("acceptance-plan.py")
ROOT = SCRIPT.parents[2]
sys.path.insert(0, str(ROOT))

from tooling.acceptance.core import (
    RUN_GATE_ENV,
    RUN_ID_ENV,
    RUN_WORKSPACE_ENV,
    EvidenceStore,
)

SPEC = importlib.util.spec_from_file_location("acceptance_plan", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"failed to load {SCRIPT}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ChangedPathsTests(unittest.TestCase):
    def test_head_includes_untracked_files(self) -> None:
        responses = [
            subprocess.CompletedProcess(
                args=["git", "diff"],
                returncode=0,
                stdout="tracked.py\n",
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=["git", "ls-files"],
                returncode=0,
                stdout="new.py\n",
                stderr="",
            ),
        ]
        with patch.object(MODULE.subprocess, "run", side_effect=responses):
            self.assertEqual(
                MODULE.changed_paths("HEAD"),
                ["new.py", "tracked.py"],
            )

    def test_explicit_range_excludes_worktree_untracked_files(self) -> None:
        response = subprocess.CompletedProcess(
            args=["git", "diff"],
            returncode=0,
            stdout="committed.py\n",
            stderr="",
        )
        with patch.object(MODULE.subprocess, "run", return_value=response) as run:
            self.assertEqual(
                MODULE.changed_paths("main...HEAD"),
                ["committed.py"],
            )
            run.assert_called_once()

    def test_self_check_uses_dedicated_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = EvidenceStore(Path(tmp) / "artifacts", worktree=ROOT)
            self_run = store.begin_run("acceptance-plan-self", source={})
            with patch.dict(os.environ, self_run.subprocess_environment({}), clear=True):
                self.assertEqual(
                    MODULE.default_output_path(True),
                    self_run.run_dir / "reports" / "acceptance-plan-self.json",
                )
            self_run.close()

            plan_run = store.begin_run("acceptance-plan", source={})
            with patch.dict(os.environ, plan_run.subprocess_environment({}), clear=True):
                self.assertEqual(
                    MODULE.default_output_path(False),
                    plan_run.run_dir / "reports" / "plan.json",
                )
            plan_run.close()

    def test_self_check_does_not_overwrite_latest_plan(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            acceptance = root / "acceptance"
            acceptance.mkdir()
            (acceptance / "registry.yaml").write_text(
                '{"version": 1, "rules": []}',
                encoding="utf-8",
            )
            (acceptance / "gates.yaml").write_text(
                '{"version": 1, "gates": {}}',
                encoding="utf-8",
            )
            artifacts = root / "artifacts"
            environment = os.environ.copy()
            for variable in (
                RUN_WORKSPACE_ENV,
                RUN_GATE_ENV,
                RUN_ID_ENV,
            ):
                environment.pop(variable, None)
            environment["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(artifacts)
            for extra in ([], ["--self-check"]):
                subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPT),
                        "--root",
                        str(acceptance),
                        *extra,
                        "--changed-file",
                        "example.py",
                    ],
                    cwd=ROOT,
                    env=environment,
                    check=True,
                    capture_output=True,
                    text=True,
                )
            store = EvidenceStore(artifacts, worktree=ROOT)
            normal = store.latest("acceptance-plan")
            self_check = store.latest("acceptance-plan-self")
            self.assertNotEqual(normal["runId"], self_check["runId"])
            self.assertEqual(
                set(normal["artifacts"]),
                {"plan"},
            )
            self.assertEqual(
                set(self_check["artifacts"]),
                {"plan"},
            )


class BehaviorRuleTests(unittest.TestCase):
    def selected_ids(self, path: str) -> set[str]:
        result = MODULE.plan(ROOT / "tooling" / "acceptance", [path])
        return {gate["id"] for gate in result["selected_gates"]}

    def test_rejects_duplicate_behavior_rule_authority_keys(self) -> None:
        cases = (
            '"when":{"paths":["src/**"]},"when":{"paths":[]}',
            '"features":["feature"],"features":[]',
            '"require":["must-run"],"require":[]',
        )
        for duplicate_fields in cases:
            with self.subTest(duplicate_fields=duplicate_fields):
                with tempfile.TemporaryDirectory() as temp_dir:
                    root = Path(temp_dir)
                    behavior_dir = root / "behavior-rules"
                    behavior_dir.mkdir()
                    (behavior_dir / "rule.yaml").write_text(
                        '{"rules":[{"id":"rule",'
                        f"{duplicate_fields}"
                        "}]}",
                        encoding="utf-8",
                    )
                    with self.assertRaisesRegex(ValueError, "duplicate key"):
                        MODULE.load_behavior_rules(root)

    def test_direct_receipt_owner_selects_native_two_client(self) -> None:
        selected = self.selected_ids(
            "apps/desktop/src-tauri/src/messaging/direct.rs"
        )
        self.assertIn("chat-native-two-client-e2e", selected)
        self.assertIn("chat-desktop-gateway-e2e", selected)

    def test_unrelated_messaging_file_does_not_select_native_two_client(self) -> None:
        selected = self.selected_ids(
            "apps/desktop/src-tauri/src/messaging/prekeys.rs"
        )
        self.assertNotIn("chat-native-two-client-e2e", selected)
        self.assertIn("chat-desktop-gateway-e2e", selected)

    def test_agent_tool_surfaces_select_governed_tool_and_foundation_gates(
        self,
    ) -> None:
        for path in (
            "apps/desktop/src/components/messages/AssistantMessage.tsx",
            "apps/desktop/src/components/messages/actions/types.ts",
            "apps/desktop/src/store/streaming/handler.ts",
        ):
            with self.subTest(path=path):
                selected = self.selected_ids(path)
                self.assertIn("agent-v2-governed-tool-loop-e2e", selected)

        selected = self.selected_ids(
            "apps/desktop/src/store/streaming/handler.ts"
        )
        self.assertIn("agent-v2-kernel-foundation-e2e", selected)

    def test_proto_only_change_does_not_select_native_two_client(self) -> None:
        selected = self.selected_ids("model/domain/chat/receipt.proto")
        self.assertNotIn("chat-native-two-client-e2e", selected)

    def test_gateway_only_handler_does_not_select_native_two_client(self) -> None:
        selected = self.selected_ids(
            "apps/desktop/src-tauri/src/interface/http_gateway/handler.rs"
        )
        self.assertNotIn("chat-native-two-client-e2e", selected)
        self.assertIn("chat-desktop-gateway-e2e", selected)

    def test_acceptance_framework_change_selects_provisioning_self_gate(self) -> None:
        selected = self.selected_ids(
            "tooling/acceptance/core/provisioning.py"
        )
        self.assertIn("acceptance-plan-self", selected)
        self.assertIn("acceptance-runtime-provisioning-self", selected)

    def test_agent_replay_and_identity_owners_select_stream_resilience(self) -> None:
        for path in (
            "apps/desktop/src-tauri/src/application/agent_turn/mod.rs",
            "apps/desktop/src/components/OpStatusTray.tsx",
            "apps/desktop/src/kernel/identityRuntime.ts",
            "apps/desktop/src/services/identityHandlers.ts",
            "apps/desktop/src/store/chatOperationEvent.test.ts",
        ):
            with self.subTest(path=path):
                self.assertIn(
                    "agent-stream-resilience-e2e",
                    self.selected_ids(path),
                )

    def test_shared_agent_native_runner_selects_implemented_journeys(self) -> None:
        for path in (
            "tooling/acceptance/gates/agent/native_agent_runner.py",
            "tooling/acceptance/provisioners/home_station.py",
        ):
            with self.subTest(path=path):
                selected = self.selected_ids(path)
                self.assertIn("agent-stream-resilience-e2e", selected)
                self.assertIn("agent-attachment-e2e", selected)


class GateLaunchContractTests(unittest.TestCase):
    def test_plan_preserves_context_argv_and_capabilities(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "registry.yaml").write_text(
                json.dumps(
                    {
                        "rules": [
                            {
                                "id": "context-rule",
                                "when": {"paths": ["src/**"]},
                                "require": ["context-gate"],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            (root / "gates.yaml").write_text(
                json.dumps(
                    {
                        "gates": {
                            "context-gate": {
                                "argv": ["python3", "-m", "example.gate"],
                                "ephemeralCapabilities": [
                                    "example.echo",
                                    "example.deny",
                                ],
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            result = MODULE.plan(root, ["src/example.py"])

        gate = result["selected_gates"][0]
        self.assertEqual(gate["argv"], ["python3", "-m", "example.gate"])
        self.assertEqual(
            gate["ephemeralCapabilities"],
            ["example.echo", "example.deny"],
        )
        self.assertNotIn("command", gate)

    def test_legacy_command_remains_the_only_launch_form(self) -> None:
        gate = MODULE.planned_gate(
            "legacy-gate",
            {"command": "python3 legacy_gate.py"},
        )

        self.assertEqual(gate["command"], "python3 legacy_gate.py")
        self.assertNotIn("argv", gate)
        self.assertNotIn("ephemeralCapabilities", gate)

    def test_rejects_dual_launch_truth(self) -> None:
        with self.assertRaisesRegex(
            SystemExit,
            "exactly one of command or argv",
        ):
            MODULE.planned_gate(
                "invalid-gate",
                {
                    "command": "python3 legacy_gate.py",
                    "argv": ["python3", "context_gate.py"],
                },
            )

    def test_rejects_command_capability_declaration(self) -> None:
        with self.assertRaisesRegex(
            SystemExit,
            "ephemeralCapabilities requires argv",
        ):
            MODULE.planned_gate(
                "invalid-gate",
                {
                    "command": "python3 legacy_gate.py",
                    "ephemeralCapabilities": ["example.echo"],
                },
            )

    def test_rejects_non_python_context_argv(self) -> None:
        with self.assertRaisesRegex(
            SystemExit,
            "requires a Python module, script, or -c argv",
        ):
            MODULE.planned_gate(
                "invalid-context-gate",
                {
                    "argv": ["node", "gate.js"],
                    "ephemeralCapabilities": ["example.echo"],
                },
            )


class FinalizerPlanningTests(unittest.TestCase):
    @dataclass(frozen=True)
    class Binding:
        config: dict[str, object]

        def plan_config(self) -> dict[str, object]:
            return dict(self.config)

    def test_rejects_duplicate_gate_catalog_keys(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            gates_path = Path(temp_dir) / "gates.yaml"
            gates_path.write_text(
                '{"gates":{"finalizer-gate":{"evidenceFinalizer":{},'
                '"evidenceFinalizer":{}}}}',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "duplicate key"):
                MODULE.load_json_yaml(gates_path)

            gates_path.write_text(
                '{"gates":{"finalizer-gate":{"timeoutSeconds":NaN}}}',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "invalid number"):
                MODULE.load_json_yaml(gates_path)

    def test_selected_gate_preserves_validated_finalizer_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "registry.yaml").write_text(
                json.dumps(
                    {
                        "rules": [
                            {
                                "id": "finalizer-rule",
                                "when": {"paths": ["src/**"]},
                                "require": ["finalizer-gate"],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            (root / "gates.yaml").write_text(
                json.dumps(
                    {
                        "gates": {
                            "finalizer-gate": {
                                "command": "true",
                                "evidenceFinalizer": {
                                    "id": "synthetic.finalizer",
                                    "timeoutSeconds": 30,
                                    "inputByteLimit": 4096,
                                },
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            binding = self.Binding(
                {
                    "id": "synthetic.finalizer",
                    "timeoutSeconds": 30,
                    "inputByteLimit": 4096,
                }
            )
            with patch.object(
                MODULE,
                "finalizer_bindings",
                return_value={"finalizer-gate": binding},
            ):
                result = MODULE.plan(root, ["src/example.py"])

        self.assertEqual(
            result["selected_gates"][0]["evidenceFinalizer"],
            binding.config,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
