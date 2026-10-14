from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


class AgentIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="pt integration ")
        self.base = Path(self.temporary.name)
        self.root = self.base / "project root"
        self.root.mkdir()
        self.home = self.base / "home"
        self.machine = self.base / "machine"
        self.home.mkdir()

        for name in (
            "agent-integration-control.py",
            "agent-integration-audit.py",
            "install-agent-integration.sh",
        ):
            destination = self.root / "tooling/scripts" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / "tooling/scripts" / name, destination)
        shutil.copytree(
            REPO_ROOT / "tooling/plugins/pt-ew-plugin",
            self.root / "tooling/plugins/pt-ew-plugin",
        )
        shutil.copytree(
            REPO_ROOT / "tooling/scripts/local-dev",
            self.root / "tooling/scripts/local-dev",
        )
        shutil.copytree(
            REPO_ROOT / "tooling/scripts/lib",
            self.root / "tooling/scripts/lib",
        )
        shutil.copytree(
            REPO_ROOT / "tooling/scripts/architecture",
            self.root / "tooling/scripts/architecture",
        )
        for name in (
            "pt-ew",
            "pt-dev-workflow",
            "pt-goal-orchestrator",
            "pt-trae-host-adapter",
            "pt-cursor-host-adapter",
            "pt-codex-host-adapter",
        ):
            shutil.copytree(
                REPO_ROOT / "tooling/skills" / name,
                self.root / "tooling/skills" / name,
            )
        subprocess.run(
            ["git", "init", "-b", "test/integration"],
            cwd=self.root,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.email", "test@example.invalid"],
            cwd=self.root,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"],
            cwd=self.root,
            check=True,
        )
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)
        subprocess.run(
            ["git", "commit", "-m", "fixture"],
            cwd=self.root,
            check=True,
            capture_output=True,
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def environment(self, **overrides: str) -> dict[str, str]:
        return {
            **os.environ,
            "HOME": str(self.home),
            "USERPROFILE": str(self.home),
            "PT_MACHINE_DEV_ROOT": str(self.machine),
            **overrides,
        }

    def workspace_entries(self) -> list[str]:
        return sorted(
            str(relative)
            for item in self.root.rglob("*")
            if ".git" not in (relative := item.relative_to(self.root)).parts
        )

    def control(
        self,
        action: str = "install",
        *,
        host: str = "trae",
        workspace: Path | None = None,
        environment: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        command = [
            sys.executable,
            "tooling/scripts/agent-integration-control.py",
            action,
            "--root",
            str(self.root),
            "--host",
            host,
        ]
        if workspace is not None:
            command.extend(["--workspace", str(workspace)])
        return subprocess.run(
            command,
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
            env=environment or self.environment(),
        )

    def audit(
        self,
        *,
        host: str = "trae",
        workspace: Path | None = None,
    ) -> tuple[subprocess.CompletedProcess[str], dict[str, object]]:
        command = [
            sys.executable,
            "tooling/scripts/agent-integration-audit.py",
            "--root",
            str(self.root),
            "--host",
            host,
        ]
        if workspace is not None:
            command.extend(["--workspace", str(workspace)])
        completed = subprocess.run(
            command,
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
            env=self.environment(),
        )
        return completed, json.loads(completed.stdout)

    def write_unrelated_hook(self) -> bytes:
        hooks = self.root / ".trae/hooks.json"
        hooks.parent.mkdir(parents=True, exist_ok=True)
        hooks.write_text(
            json.dumps(
                {
                    "hooks": {
                        "PreToolUse": [
                            {
                                "matcher": "unrelated",
                                "hooks": [
                                    {
                                        "type": "command",
                                        "command": "/usr/bin/true",
                                        "timeout": 3,
                                    }
                                ],
                            }
                        ]
                    },
                    "owner": "unrelated",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return hooks.read_bytes()

    def test_flow_a03_selected_root_install_uses_absolute_interpreter(self) -> None:
        self.write_unrelated_hook()
        completed = self.control()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["skills"]["status"], "PASS")
        self.assertEqual(report["hook"]["status"], "PASS")
        self.assertFalse(self.machine.exists())

        for name in report["skills"]["installed"]:
            projected = self.root / ".trae/skills" / name
            self.assertTrue(projected.is_symlink())
            self.assertEqual(
                projected.resolve(strict=True),
                (self.root / "tooling/skills" / name).resolve(strict=True),
            )
        hooks = json.loads(
            (self.root / ".trae/hooks.json").read_text(encoding="utf-8")
        )
        self.assertEqual(hooks["owner"], "unrelated")
        self.assertEqual(
            hooks["hooks"]["PreToolUse"][0]["matcher"],
            "unrelated",
        )
        managed = hooks["hooks"]["PreToolUse"][1]["hooks"][0]["command"]
        invocation = shlex.split(managed)
        self.assertTrue(Path(invocation[0]).is_absolute())
        self.assertEqual(Path(invocation[0]).resolve(), Path(shutil.which("node")).resolve())

        audited, audit = self.audit()
        self.assertEqual(audited.returncode, 0, audited.stderr)
        self.assertEqual(audit["status"], "PASS")
        self.assertEqual(audit["callbackProbe"]["permissionDecision"], "allow")
        self.assertEqual(
            audit["callbackProbe"]["context"],
            "docs/global/workflow.md",
        )

    def test_existing_canonical_skill_root_symlink_is_accepted(self) -> None:
        trae = self.root / ".trae"
        trae.mkdir()
        (trae / "skills").symlink_to(
            self.root / "tooling/skills",
            target_is_directory=True,
        )
        self.write_unrelated_hook()

        completed = self.control()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        self.assertEqual(report["skills"]["status"], "PASS")
        self.assertEqual(
            report["skills"]["projection"],
            "canonical-root-symlink",
        )
        self.assertTrue((trae / "skills").is_symlink())

        audited, audit = self.audit()
        self.assertEqual(audited.returncode, 0, audited.stderr)
        self.assertEqual(audit["skills"]["status"], "PASS")

    def test_audit_of_absent_projection_does_not_create_workspace_files(self) -> None:
        before = self.workspace_entries()
        completed, report = self.audit()
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(report["skills"]["status"], "BLOCKED")
        self.assertFalse((self.root / ".trae").exists())
        self.assertEqual(self.workspace_entries(), before)

    def test_flow_a06_hook_failure_does_not_remove_skill_access(self) -> None:
        hooks = self.root / ".trae/hooks.json"
        hooks.parent.mkdir(parents=True)
        original = b"{not-json\n"
        hooks.write_bytes(original)
        completed = self.control()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        self.assertEqual(report["status"], "DEGRADED")
        self.assertEqual(report["skills"]["status"], "PASS")
        self.assertEqual(report["hook"]["status"], "UNAVAILABLE")
        self.assertEqual(hooks.read_bytes(), original)
        self.assertTrue(
            (self.root / ".trae/skills/pt-dev-workflow").is_symlink()
        )
        audited, audit = self.audit()
        self.assertEqual(audited.returncode, 0, audited.stderr)
        self.assertEqual(audit["status"], "DEGRADED")
        self.assertEqual(audit["skills"]["status"], "PASS")

    def test_flow_a19_missing_node_degrades_only_the_hook(self) -> None:
        completed = self.control(
            environment=self.environment(PT_AGENT_NODE_BINARY="/missing/node")
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        self.assertEqual(report["status"], "DEGRADED")
        self.assertEqual(report["hook"]["code"], "NODE_INTERPRETER_MISSING")
        self.assertTrue(
            (self.root / ".trae/skills/pt-dev-workflow").is_symlink()
        )
        self.assertFalse((self.root / ".trae/hooks.json").exists())

    def test_flow_a19_symlink_escape_is_rejected_before_outside_mutation(self) -> None:
        outside = self.base / "outside"
        outside.mkdir()
        (self.root / ".trae").symlink_to(outside, target_is_directory=True)
        completed = self.control()
        self.assertEqual(completed.returncode, 2)
        report = json.loads(completed.stderr)
        self.assertEqual(report["status"], "BLOCKED")
        self.assertIn("HOST_PROJECTION_ESCAPE", report["code"])
        self.assertEqual(list(outside.iterdir()), [])

    def test_skill_projection_symlink_to_outside_is_rejected(self) -> None:
        outside = self.base / "outside-skills"
        outside.mkdir()
        trae = self.root / ".trae"
        trae.mkdir()
        (trae / "skills").symlink_to(outside, target_is_directory=True)

        completed = self.control()
        self.assertEqual(completed.returncode, 2)
        report = json.loads(completed.stderr)
        self.assertIn("HOST_PROJECTION_ESCAPE", report["code"])
        self.assertEqual(list(outside.iterdir()), [])

    def test_flow_a20_multi_root_descriptor_changes_only_selected_root(self) -> None:
        other = self.base / "other root"
        other.mkdir()
        other_hooks = other / ".trae/hooks.json"
        other_hooks.parent.mkdir()
        other_hooks.write_text('{"hooks":{},"owner":"other"}\n', encoding="utf-8")
        original = other_hooks.read_bytes()
        descriptor = self.base / "workspace file.code-workspace"
        descriptor.write_text(
            json.dumps(
                {
                    "folders": [
                        {"path": str(self.root)},
                        {"path": str(other)},
                    ]
                }
            ),
            encoding="utf-8",
        )
        completed = self.control(workspace=descriptor)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(other_hooks.read_bytes(), original)
        self.assertFalse((other / ".trae/skills").exists())

    def test_flow_a20_remove_hook_preserves_skills_and_unrelated_config(self) -> None:
        self.write_unrelated_hook()
        installed = self.control()
        self.assertEqual(installed.returncode, 0, installed.stderr)
        removed = self.control("remove-hook")
        self.assertEqual(removed.returncode, 0, removed.stderr)
        report = json.loads(removed.stdout)
        self.assertEqual(report["hook"]["status"], "REMOVED")
        self.assertTrue(
            (self.root / ".trae/skills/pt-dev-workflow").is_symlink()
        )
        hooks = json.loads(
            (self.root / ".trae/hooks.json").read_text(encoding="utf-8")
        )
        self.assertEqual(hooks["owner"], "unrelated")
        self.assertEqual(len(hooks["hooks"]["PreToolUse"]), 1)
        audited, audit = self.audit()
        self.assertEqual(audited.returncode, 0, audited.stderr)
        self.assertEqual(audit["status"], "DEGRADED")
        self.assertEqual(audit["hook"]["status"], "INVALID")

    def test_installer_sources_have_no_retired_authority_dependency(self) -> None:
        retired = (
            "OWNER_CONTROL",
            "claimWorkflowActionGrant",
            "dev-work-ledger",
            "plan-mount",
            "GLOBAL_WORKFLOW_NOT_IDLE",
            "workflow-binding-store",
        )
        for name in (
            "agent-integration-control.py",
            "agent-integration-audit.py",
            "install-agent-integration.sh",
        ):
            content = (REPO_ROOT / "tooling/scripts" / name).read_text(
                encoding="utf-8"
            )
            for marker in retired:
                self.assertNotIn(marker, content, f"{name}: {marker}")


if __name__ == "__main__":
    unittest.main()
