from __future__ import annotations

import json
import contextlib
import io
import os
import runpy
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


class AgentIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        roots = [
            REPO_ROOT / "tooling/plugins/pt-ew-plugin",
            REPO_ROOT / "tooling/scripts/local-dev",
            REPO_ROOT / "tooling/scripts/lib",
            REPO_ROOT / "tooling/scripts/architecture",
            *(
                REPO_ROOT / "tooling/skills" / name
                for name in (
                    "pt-ew", "pt-dev-workflow", "pt-goal-orchestrator",
                    "pt-trae-host-adapter", "pt-cursor-host-adapter", "pt-codex-host-adapter",
                )
            ),
        ]
        fixture_files = [
            (path.relative_to(REPO_ROOT), path.read_bytes(), path.stat().st_mode & 0o777)
            for root in roots for path in root.rglob("*") if path.is_file()
            and not path.name.endswith((".test.mjs", "_test.py"))
        ]

        cls.shared = tempfile.TemporaryDirectory(prefix="pt integration source ")
        cls.fixture = Path(cls.shared.name) / "template"
        cls.fixture.mkdir()
        for name in (
            "agent-integration-control.py",
            "agent-integration-audit.py",
            "install-agent-integration.sh",
        ):
            destination = cls.fixture / "tooling/scripts" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / "tooling/scripts" / name, destination)
        for relative, content, mode in fixture_files:
            destination = cls.fixture / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
            destination.chmod(mode)
        dependencies = cls.fixture / "node_modules"
        dependencies.mkdir()
        (dependencies / "yaml").symlink_to(
            REPO_ROOT / "node_modules/yaml", target_is_directory=True
        )
        # A synthetic repository owns its hooks. Global developer hooks may
        # launch this real workspace's tooling and cannot qualify the fixture.
        isolated_hooks = Path(cls.shared.name) / "isolated hooks"
        isolated_hooks.mkdir()
        for command in (
            ["git", "init", "-b", "test/integration"],
            ["git", "config", "user.email", "test@example.invalid"],
            ["git", "config", "user.name", "Test"],
            ["git", "config", "core.hooksPath", str(isolated_hooks)],
            ["git", "add", "."],
            ["git", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"],
        ):
            subprocess.run(command, cwd=cls.fixture, check=True, capture_output=True, timeout=3)
        cls.control_module = runpy.run_path(str(cls.fixture / "tooling/scripts/agent-integration-control.py"))
        cls.audit_module = runpy.run_path(str(cls.fixture / "tooling/scripts/agent-integration-audit.py"))

    @classmethod
    def tearDownClass(cls) -> None:
        cls.shared.cleanup()

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="pt integration ")
        self.base = Path(self.temporary.name)
        # One Suite owns immutable runtime sources and Git identity. Each
        # sequential case resets only its host projections after assertions.
        self.root = self.fixture
        self.home = self.base / "home"
        self.machine = self.base / "machine"
        self.home.mkdir()

    def tearDown(self) -> None:
        for name in (".trae", ".cursor", ".agents"):
            path = self.root / name
            if path.is_symlink():
                path.unlink()
            elif path.exists():
                shutil.rmtree(path)
        self.temporary.cleanup()

    def environment(self, **overrides: str) -> dict[str, str]:
        return {
            **os.environ,
            "HOME": str(self.home),
            "USERPROFILE": str(self.home),
            "PT_MACHINE_DEV_ROOT": str(self.machine),
            "PYTHONDONTWRITEBYTECODE": "1",
            **overrides,
        }

    def workspace_entries(self) -> list[str]:
        entries = []
        for base, directories, files in os.walk(self.root, followlinks=False):
            directories[:] = [name for name in directories if name != ".git"]
            entries.extend(str((Path(base) / name).relative_to(self.root))
                           for name in directories + files)
        return sorted(entries)

    def control(
        self,
        action: str = "install",
        *,
        host: str = "trae",
        workspace: Path | None = None,
        environment: dict[str, str] | None = None,
        subprocess_cli: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        command = [
            os.environ.get("PT_ACCEPTANCE_PYTHON") or sys.executable,
            "tooling/scripts/agent-integration-control.py",
            action,
            "--root",
            str(self.root),
            "--host",
            host,
        ]
        if workspace is not None:
            command.extend(["--workspace", str(workspace)])
        if not subprocess_cli:
            return self.invoke_main(self.control_module, command, environment or self.environment())
        return subprocess.run(
            command,
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
            env=environment or self.environment(),
            timeout=5,
        )

    def audit(
        self,
        *,
        host: str = "trae",
        workspace: Path | None = None,
        subprocess_cli: bool = False,
    ) -> tuple[subprocess.CompletedProcess[str], dict[str, object]]:
        command = [
            os.environ.get("PT_ACCEPTANCE_PYTHON") or sys.executable,
            "tooling/scripts/agent-integration-audit.py",
            "--root",
            str(self.root),
            "--host",
            host,
        ]
        if workspace is not None:
            command.extend(["--workspace", str(workspace)])
        completed = self.invoke_main(self.audit_module, command, self.environment()) if not subprocess_cli else subprocess.run(
            command,
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
            env=self.environment(),
            timeout=5,
        )
        return completed, json.loads(completed.stdout)

    def invoke_main(self, module, command, environment):
        output, errors = io.StringIO(), io.StringIO()
        # Exercise the real CLI owner and filesystem. Only its process entry
        # boundary is in-process; one smoke case below launches actual CLIs.
        with patch.dict(os.environ, environment, clear=True), patch.object(sys, "argv", command[1:]):
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                code = module["main"]()
        return subprocess.CompletedProcess(command, code, output.getvalue(), errors.getvalue())

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
        completed = self.control(subprocess_cli=True)
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

        audited, audit = self.audit(subprocess_cli=True)
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
        other_script = (
            other
            / "tooling/plugins/pt-ew-plugin/scripts/hook-entry.mjs"
        )
        other_script.parent.mkdir(parents=True)
        other_script.write_text("// other root hook\n", encoding="utf-8")
        other_hooks = other / ".trae/hooks.json"
        other_hooks.parent.mkdir()
        other_hooks.write_text(
            json.dumps(
                {
                    "hooks": {
                        "PreToolUse": [
                            {
                                "matcher": "*",
                                "hooks": [
                                    {
                                        "type": "command",
                                        "command": (
                                            f"{shutil.which('node')} "
                                            f"{shlex.quote(str(other_script))} "
                                            "--host trae --event PreToolUse"
                                        ),
                                        "timeout": 5,
                                    }
                                ],
                            }
                        ]
                    },
                    "owner": "other",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
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

    def test_cross_root_managed_hook_is_rejected_and_repaired(self) -> None:
        self.write_unrelated_hook()
        installed = self.control()
        self.assertEqual(installed.returncode, 0, installed.stderr)

        other_script = (
            self.base
            / "foreign root/tooling/plugins/pt-ew-plugin/scripts/hook-entry.mjs"
        )
        other_script.parent.mkdir(parents=True)
        other_script.write_text("// foreign hook\n", encoding="utf-8")
        hooks_path = self.root / ".trae/hooks.json"
        hooks = json.loads(hooks_path.read_text(encoding="utf-8"))
        local_script = str(
            self.root
            / "tooling/plugins/pt-ew-plugin/scripts/hook-entry.mjs"
        )
        for entries in hooks["hooks"].values():
            for entry in entries:
                for hook in entry.get("hooks", []):
                    command = hook.get("command")
                    if isinstance(command, str) and local_script in command:
                        hook["command"] = command.replace(
                            local_script,
                            str(other_script),
                        )
        hooks_path.write_text(
            json.dumps(hooks, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        audited, report = self.audit()
        self.assertEqual(audited.returncode, 0, audited.stderr)
        self.assertEqual(report["status"], "DEGRADED")
        self.assertEqual(report["hook"]["status"], "INVALID")
        self.assertIn(
            "HOOK_PROJECTION_CROSS_ROOT",
            {finding["code"] for finding in report["hook"]["findings"]},
        )
        self.assertEqual(report["callbackProbe"]["status"], "NOT_RUN")

        repaired = self.control()
        self.assertEqual(repaired.returncode, 0, repaired.stderr)
        audited, report = self.audit()
        self.assertEqual(audited.returncode, 0, audited.stderr)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["hook"]["status"], "PASS")

    def test_control_rejects_cross_root_managed_hook_before_write(self) -> None:
        other_script = (
            self.base
            / "foreign root/tooling/plugins/pt-ew-plugin/scripts/hook-entry.mjs"
        )
        other_script.parent.mkdir(parents=True)
        other_script.write_text("// foreign hook\n", encoding="utf-8")
        control = runpy.run_path(
            str(self.root / "tooling/scripts/agent-integration-control.py")
        )
        hooks = {
            "hooks": {
                "PreToolUse": [
                    {
                        "matcher": "*",
                        "hooks": [
                            {
                                "type": "command",
                                "command": (
                                    f"{shutil.which('node')} "
                                    f"{shlex.quote(str(other_script))} "
                                    "--host trae --event PreToolUse"
                                ),
                                "timeout": 5,
                            }
                        ],
                    }
                ]
            }
        }
        with self.assertRaisesRegex(RuntimeError, "HOST_HOOK_CROSS_ROOT"):
            control["validate_managed_hook_locality"](
                self.root,
                hooks,
            )

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
