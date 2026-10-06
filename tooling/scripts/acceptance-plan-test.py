#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
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
    def test_make_entrypoints_default_to_external_evidence_store(self) -> None:
        makefile = (
            ROOT / "tooling" / "make" / "acceptance.mk"
        ).read_text(encoding="utf-8")

        self.assertNotIn(
            "tooling/acceptance/reports/latest-plan.json",
            makefile,
        )
        self.assertIn(
            'ACCEPTANCE_PLAN_OUTPUT_ARG = $(if $(ACCEPTANCE_PLAN),--output "$(ACCEPTANCE_PLAN)",)',
            makefile,
        )
        self.assertIn(
            "acceptance-plan.py --root tooling/acceptance --active-plan",
            makefile,
        )
        self.assertIn(
            'ACCEPTANCE_RUN_PLAN_ARG = $(if $(PLAN),--plan "$(PLAN)",$(if $(ACCEPTANCE_PLAN),--plan "$(ACCEPTANCE_PLAN)",))',
            makefile,
        )

    def test_formal_plan_schedules_closure_without_running_full_candidates(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            acceptance = root / "acceptance"
            acceptance.mkdir()
            (acceptance / "registry.yaml").write_text(
                json.dumps(
                    {
                        "rules": [
                            {
                                "id": "feature",
                                "features": ["feature"],
                                "when": {"paths": ["src/**"]},
                                "require": ["cheap-gate", "runtime-gate"],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            (acceptance / "gates.yaml").write_text(
                json.dumps(
                    {
                        "gates": {
                            "cheap-gate": {
                                "command": "cheap",
                                "tier": "ci-cheap",
                            },
                            "runtime-gate": {
                                "command": "runtime",
                                "tier": "env-evidence",
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )
            execution_plan = root / "plan.md"
            execution_plan.write_text(
                f"""# Plan

> **Status**: active, approved for execution
> **Branch**: `feat/example`
> **Workspace ID**: `{'1' * 16}`
> **Initial HEAD**: `{'a' * 40}`

## Acceptance Execution

```json
{{
  "closures": {{"C1": ["cheap-gate"]}},
  "completion": ["cheap-gate"],
  "full": ["cheap-gate", "runtime-gate"]
}}
```

## Implementation Status

| Closure | Status |
|---|---|
| C1 | in progress |
""",
                encoding="utf-8",
            )
            output = root / "projection.json"
            plan_projection = SimpleNamespace(
                path=execution_plan,
                plan_id="PLAN-1",
                plan_format="stable",
                status="active",
                branch="feat/example",
                workspace_id="1" * 16,
                initial_head="a" * 40,
                current_task_id="TASK-1",
                current_task_path="tasks/TASK-1.md",
                current_task_write_set=("src",),
                current_closure="C1",
                closure_statuses={"C1": "in_progress"},
                acceptance={
                    "closures": {"C1": ["cheap-gate"]},
                    "completion": ["cheap-gate"],
                    "full": ["cheap-gate", "runtime-gate"],
                },
                all_declared_gate_ids=lambda: {"cheap-gate", "runtime-gate"},
                gate_ids=lambda mode: (
                    ["cheap-gate", "runtime-gate"]
                    if mode == "full"
                    else ["cheap-gate"]
                ),
            )
            with (
                patch.object(MODULE, "load_formal_plan", return_value=plan_projection),
                patch.object(
                    sys,
                    "argv",
                    [
                        str(SCRIPT),
                        "--root",
                        str(acceptance),
                        "--execution-plan",
                        str(execution_plan),
                        "--changed-file",
                        "src/example.py",
                        "--output",
                        str(output),
                    ],
                ),
                redirect_stdout(io.StringIO()),
                redirect_stderr(io.StringIO()),
            ):
                result = MODULE.main()

            self.assertEqual(result, 0)
            projection = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(projection["candidate_gates"], ["cheap-gate", "runtime-gate"])
            self.assertEqual(
                [gate["id"] for gate in projection["selected_gates"]],
                ["cheap-gate"],
            )
            self.assertEqual(projection["execution"]["mode"], "closure")

            with (
                patch.object(MODULE, "load_formal_plan", return_value=plan_projection),
                patch.object(
                    sys,
                    "argv",
                    [
                        str(SCRIPT),
                        "--root",
                        str(acceptance),
                        "--execution-plan",
                        str(execution_plan),
                        "--changed-file",
                        "src/example.py",
                        "--full",
                        "--output",
                        str(output),
                    ],
                ),
                redirect_stdout(io.StringIO()),
                redirect_stderr(io.StringIO()),
            ):
                full = MODULE.main()
            self.assertEqual(full, 0)
            full_projection = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(
                [gate["id"] for gate in full_projection["selected_gates"]],
                ["cheap-gate", "runtime-gate"],
            )
            self.assertEqual(full_projection["execution"]["mode"], "full")

            execution_plan.write_text(
                execution_plan.read_text(encoding="utf-8").replace(
                    '["cheap-gate", "runtime-gate"]',
                    '["cheap-gate"]',
                ),
                encoding="utf-8",
            )
            plan_projection.all_declared_gate_ids = lambda: {"cheap-gate"}
            stderr = io.StringIO()
            with (
                patch.object(MODULE, "load_formal_plan", return_value=plan_projection),
                patch.object(
                    sys,
                    "argv",
                    [
                        str(SCRIPT),
                        "--root",
                        str(acceptance),
                        "--execution-plan",
                        str(execution_plan),
                        "--changed-file",
                        "src/example.py",
                        "--output",
                        str(output),
                    ],
                ),
                redirect_stdout(io.StringIO()),
                redirect_stderr(stderr),
            ):
                drift = MODULE.main()
            self.assertEqual(drift, 2)
            self.assertIn("ACCEPTANCE_PLAN_DRIFT", stderr.getvalue())

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

    def test_gate_catalog_diff_returns_only_changed_gate_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            acceptance = Path(tmp) / "acceptance"
            acceptance.mkdir()
            (acceptance / "gates.yaml").write_text(
                json.dumps(
                    {
                        "gates": {
                            "changed-gate": {"command": "new"},
                            "stable-gate": {"command": "stable"},
                        }
                    }
                ),
                encoding="utf-8",
            )
            baseline = subprocess.CompletedProcess(
                args=["git", "show"],
                returncode=0,
                stdout=json.dumps(
                    {
                        "gates": {
                            "changed-gate": {"command": "old"},
                            "stable-gate": {"command": "stable"},
                        }
                    }
                ),
                stderr="",
            )
            with patch.object(
                MODULE.subprocess,
                "run",
                return_value=baseline,
            ):
                self.assertEqual(
                    MODULE.changed_gate_ids(acceptance, "a" * 40),
                    ["changed-gate"],
                )

    def test_gate_catalog_change_does_not_expand_exact_file_rules(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            acceptance = Path(tmp) / "acceptance"
            acceptance.mkdir()
            (acceptance / "registry.yaml").write_text(
                json.dumps(
                    {
                        "rules": [
                            {
                                "id": "business-domain",
                                "features": ["business"],
                                "when": {"paths": ["acceptance/gates.yaml"]},
                                "require": ["unrelated-business-gate"],
                            },
                            {
                                "id": "acceptance-infra",
                                "features": ["acceptance-infra"],
                                "when": {"paths": ["acceptance/**"]},
                                "require": ["infra-self-validation"],
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )
            (acceptance / "gates.yaml").write_text(
                json.dumps(
                    {
                        "gates": {
                            "changed-gate": {"command": "changed"},
                            "infra-self-validation": {"command": "infra"},
                            "unrelated-business-gate": {"command": "business"},
                        }
                    }
                ),
                encoding="utf-8",
            )

            result = MODULE.plan(
                acceptance,
                ["acceptance/gates.yaml"],
                catalog_changed_gate_ids=["changed-gate"],
            )

            self.assertEqual(
                {gate["id"] for gate in result["selected_gates"]},
                {"changed-gate", "infra-self-validation"},
            )
            self.assertNotIn(
                "unrelated-business-gate",
                {gate["id"] for gate in result["selected_gates"]},
            )

    def test_self_check_uses_dedicated_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = EvidenceStore(Path(tmp) / "artifacts", worktree=ROOT)
            self_run = store.begin_run("acceptance-plan-self", source={})
            with patch.dict(os.environ, self_run.subprocess_environment({}), clear=False):
                self.assertEqual(
                    MODULE.default_output_path(True),
                    self_run.run_dir / "reports" / "acceptance-plan-self.json",
                )
            self_run.close()

            plan_run = store.begin_run("acceptance-plan", source={})
            with patch.dict(os.environ, plan_run.subprocess_environment({}), clear=False):
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

    def test_oauth_sources_select_business_and_governance_gates(self) -> None:
        expected = {
            "oauth-login-broker-durable-login",
            "oauth-login-broker-refresh-idempotency",
            "oauth-login-broker-key-rotation",
            "oauth-login-broker-operator",
            "oauth-login-broker-architecture",
            "oauth-login-broker-contract",
        }
        for path in (
            "apps/oauth2-client/internal/bootstrap/container.go",
            "docs/architecture/domains/identity/oauth-login-broker/design.md",
        ):
            with self.subTest(path=path):
                self.assertTrue(expected.issubset(self.selected_ids(path)))

    def test_acceptance_tooling_selects_all_self_validation_gates(self) -> None:
        expected = {
            "acceptance-plan-self",
            "acceptance-infra-validation",
            "acceptance-workflow-contract",
            "acceptance-runtime-provisioning-self",
        }
        self.assertTrue(
            expected.issubset(
                self.selected_ids(
                    "tooling/acceptance/provisioners/oauth2_client_local.py"
                )
            )
        )

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

    def test_prekey_owner_selects_native_two_client(self) -> None:
        selected = self.selected_ids(
            "apps/desktop/src-tauri/src/messaging/prekeys.rs"
        )
        self.assertIn("chat-native-current-profile-two-client-e2e", selected)
        self.assertIn("chat-native-two-client-e2e", selected)

    def test_friend_request_owners_select_native_onboarding(self) -> None:
        for path in (
            "apps/desktop/src-tauri/src/interface/tauri_commands/social.rs",
            "apps/station/app/subserver/social/domain/"
            "federated_friend_request.go",
            "apps/station/app/subserver/social/infrastructure/"
            "federated_friend_request_store.go",
        ):
            with self.subTest(path=path):
                selected = self.selected_ids(path)
                self.assertIn(
                    "chat-lifecycle-onboarding-e2e",
                    selected,
                )

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
        self.assertIn("station-api-ownership", selected)
        self.assertNotIn("chat-native-two-client-e2e", selected)

    def test_station_chat_change_selects_api_ownership(self) -> None:
        selected = self.selected_ids(
            "apps/station/app/subserver/conversation/production_http.go"
        )
        self.assertIn("station-api-ownership", selected)

    def test_gateway_only_handler_selects_no_desktop_product_gate(self) -> None:
        selected = self.selected_ids(
            "apps/desktop/src-tauri/src/interface/http_gateway/handler.rs"
        )
        self.assertEqual(
            selected,
            {"chat-lifecycle-tree-zero-reference-e2e"},
        )

    def test_mobile_social_gateway_selects_chat_and_contacts_gates(self) -> None:
        selected = self.selected_ids(
            "apps/mobile/src/services/gateways/socialGateway.ts"
        )
        self.assertEqual(
            selected,
            {
                "chat-lifecycle-tree-zero-reference-e2e",
                "mobile-simulator-social-convergence-e2e",
                "mobile-simulator-chat-contacts-e2e",
            },
        )

    def test_mobile_shared_projection_owners_select_all_social_gates(self) -> None:
        expected = {
            "chat-lifecycle-tree-zero-reference-e2e",
            "mobile-simulator-social-convergence-e2e",
            "mobile-simulator-chat-contacts-e2e",
            "mobile-simulator-moments-e2e",
            "mobile-simulator-settings-e2e",
        }
        for path in (
            "apps/mobile/src/runtimes/socialEventIngress.ts",
            "apps/mobile/src/runtimes/socialProjectionRuntime.ts",
        ):
            with self.subTest(path=path):
                self.assertEqual(expected, self.selected_ids(path))

        runtime_registry_gates = self.selected_ids(
            "apps/mobile/src/runtimes/runtimeRegistry.ts"
        )
        self.assertTrue(expected.issubset(runtime_registry_gates))

    def test_mobile_domain_projection_owners_select_targeted_social_gates(
        self,
    ) -> None:
        self.assertEqual(
            {
                "chat-lifecycle-tree-zero-reference-e2e",
                "mobile-simulator-social-convergence-e2e",
                "mobile-simulator-moments-e2e",
            },
            self.selected_ids(
                "apps/mobile/src/runtimes/momentsProjectionDescriptor.ts"
            ),
        )
        self.assertEqual(
            {
                "chat-lifecycle-tree-zero-reference-e2e",
                "mobile-simulator-social-convergence-e2e",
                "mobile-simulator-settings-e2e",
            },
            self.selected_ids(
                "apps/mobile/src/runtimes/profileProjectionDescriptor.ts"
            ),
        )

    def test_mobile_command_callers_select_recovery_and_product_gates(
        self,
    ) -> None:
        recovery_gates = {
            "mobile-contract-static",
            "mobile-hard-cut-static",
            "mobile-simulator-recovery-e2e",
            "mobile-simulator-recovery-ui-e2e",
        }
        chat_contact_gates = {
            "mobile-simulator-social-convergence-e2e",
            "mobile-simulator-chat-contacts-e2e",
        }
        moment_gates = {
            "mobile-simulator-social-convergence-e2e",
            "mobile-simulator-moments-e2e",
        }

        for path in (
            "apps/mobile/src/features/chat/chatCommands.ts",
            "apps/mobile/src/features/social/contactCommands.ts",
        ):
            with self.subTest(path=path):
                selected = self.selected_ids(path)
                self.assertTrue(recovery_gates.issubset(selected))
                self.assertTrue(chat_contact_gates.issubset(selected))

        selected = self.selected_ids(
            "apps/mobile/src/pages/moments/MomentCommentsSection.tsx"
        )
        self.assertTrue(recovery_gates.issubset(selected))
        self.assertTrue(moment_gates.issubset(selected))

    def test_mobile_simulator_provisioner_selects_runtime_lifecycle(self) -> None:
        selected = self.selected_ids(
            "tooling/acceptance/provisioners/mobile_simulator.py"
        )
        self.assertIn(
            "mobile-simulator-runtime-lifecycle-e2e",
            selected,
        )

    def test_mobile_station_runtime_selects_station_lifecycle_proof(self) -> None:
        selected = self.selected_ids(
            "apps/mobile/src/runtimes/stationRuntime.ts"
        )
        self.assertIn("mobile-contract-static", selected)
        self.assertIn("mobile-simulator-runtime-lifecycle-e2e", selected)
        self.assertIn("mobile-simulator-station-lifecycle-e2e", selected)
        self.assertNotIn("mobile-native-lifecycle-e2e", selected)

    def test_mobile_service_bindings_select_all_runtime_consumers(self) -> None:
        selected = self.selected_ids(
            "tooling/acceptance/provisioners/mobile_service_bindings.py"
        )
        self.assertNotIn("mobile-native-access-e2e", selected)
        self.assertIn("mobile-simulator-station-lifecycle-e2e", selected)
        self.assertIn("mobile-simulator-runtime-lifecycle-e2e", selected)

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
