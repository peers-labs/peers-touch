#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
