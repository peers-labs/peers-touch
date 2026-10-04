from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]


def load_integration_control():
    path = REPO_ROOT / "tooling/scripts/agent-integration-control.py"
    spec = importlib.util.spec_from_file_location("agent_integration_control", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_integration_audit():
    path = REPO_ROOT / "tooling/scripts/agent-integration-audit.py"
    spec = importlib.util.spec_from_file_location("agent_integration_audit", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AgentIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.machine = self.root / "machine"
        self.home.mkdir(mode=0o700)
        (self.root / ".git").mkdir()
        (self.root / "tooling/make").mkdir(parents=True)
        (self.root / "tooling/scripts").mkdir(parents=True)
        shutil.copy2(
            REPO_ROOT / "tooling/make/setup.mk",
            self.root / "tooling/make/setup.mk",
        )
        for name in (
            "install-agent-integration.sh",
            "agent-integration-audit.py",
            "agent-integration-control.py",
        ):
            shutil.copy2(
                REPO_ROOT / "tooling/scripts" / name,
                self.root / "tooling/scripts" / name,
            )
        shutil.copytree(
            REPO_ROOT / "tooling/plugins/pt-ew-plugin",
            self.root / "tooling/plugins/pt-ew-plugin",
        )
        ledger_validator = (
            self.root / "tooling/scripts/local-dev/dev-work-ledger.mjs"
        )
        ledger_validator.parent.mkdir(parents=True)
        for name in (
            "active-work-store.mjs",
            "dev-session-schema.mjs",
            "dev-work-schema.mjs",
            "workflow-anchor.mjs",
            "workflow-action-store.mjs",
            "workflow-snapshot-core.mjs",
            "workflow-binding-projection.mjs",
            "workflow-binding-store.mjs",
            "workflow-binding.mjs",
            "workflow-host-adapters.mjs",
            "workflow-kernel.mjs",
            "workflow-state-inspector.mjs",
            "workflow-tool-intent.mjs",
            "workspace-lifecycle-lock.mjs",
        ):
            shutil.copy2(
                REPO_ROOT / "tooling/scripts/local-dev" / name,
                self.root / "tooling/scripts/local-dev" / name,
            )
        architecture_parser = (
            self.root / "tooling/scripts/architecture/module-governance.mjs"
        )
        architecture_parser.parent.mkdir(parents=True)
        shutil.copy2(
            REPO_ROOT / "tooling/scripts/architecture/module-governance.mjs",
            architecture_parser,
        )
        machine_paths = "tooling/scripts/lib/machine-dev-paths.mjs"
        destination = self.root / machine_paths
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO_ROOT / machine_paths, destination)
        module_stubs = {
            "tooling/scripts/plan/plan-package.mjs":
                "export function loadPlanPackage() { throw new Error('fixture only'); }\n",
            "tooling/scripts/plan/workspace-plan-binding.mjs":
                "export function resolveWorkspacePlanBinding() { throw new Error('fixture only'); }\n",
            "tooling/scripts/local-dev/dev-session-store.mjs":
                """
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export function loadSessionStore() { throw new Error('fixture only'); }
export function createSessionStore(state, options) {
  const directory = path.join(
    process.env.PT_MACHINE_DEV_ROOT,
    'workspaces',
    options.workspaceId,
    'workflow',
    options.workItemId,
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(directory, 'session.json'),
    JSON.stringify({
      schemaVersion: 1,
      kind: 'peers-touch-development-session',
      state,
      eventCount: 1,
      eventDigest: 'a'.repeat(64),
    }),
    { mode: 0o600 },
  );
}
""".lstrip(),
        }
        for relative, source in module_stubs.items():
            stub = self.root / relative
            stub.parent.mkdir(parents=True, exist_ok=True)
            stub.write_text(source, encoding="utf-8")
        shell_quote_source = REPO_ROOT / "node_modules/shell-quote"
        shell_quote_fixture = self.root / "node_modules/shell-quote"
        shell_quote_fixture.mkdir(parents=True)
        for name in ("index.js", "parse.js", "quote.js", "package.json"):
            shutil.copy2(
                shell_quote_source / name,
                shell_quote_fixture / name,
            )
        (self.root / "tooling/scripts/local-dev/dev-work.mjs").write_text(
            """
import { readFileSync } from 'node:fs';
const ledger = JSON.parse(
  readFileSync(process.env.PT_MACHINE_DEV_ROOT + '/work.json', 'utf8'),
);
console.log(JSON.stringify({
  declarations: Object.values(ledger.declarations),
}));
""".lstrip(),
            encoding="utf-8",
        )
        ledger_validator.write_text(
            """
import { readFileSync } from 'node:fs';
export function readLedger(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.declarations === null ||
    typeof value.declarations !== 'object' ||
    Array.isArray(value.declarations)
  ) {
    throw new Error('MACHINE_WORK_LEDGER_INVALID');
  }
  return value;
}
export function processStartIdentity() { return 'fixture'; }
""".lstrip(),
            encoding="utf-8",
        )
        (self.root / "Makefile").write_text(
            "include tooling/make/setup.mk\n", encoding="utf-8"
        )
        for name in (
            "pt-ew",
            "pt-goal-orchestrator",
            "pt-trae-host-adapter",
            "pt-cursor-host-adapter",
            "pt-codex-host-adapter",
        ):
            skill = self.root / "tooling/skills" / name
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: test\n---\n# Test\n",
                encoding="utf-8",
            )
        registry = self.root / "tooling/acceptance/registry.yaml"
        registry.parent.mkdir(parents=True)
        registry.write_text(
            json.dumps(
                {
                    "version": 1,
                    "rules": [
                        {
                            "id": "host-neutral-skills",
                            "when": {
                                "paths": [
                                    f"tooling/skills/{name}/**"
                                    for name in (
                                        "pt-goal-orchestrator",
                                        "pt-trae-host-adapter",
                                        "pt-cursor-host-adapter",
                                        "pt-codex-host-adapter",
                                    )
                                ] + [
                                    "tooling/plugins/pt-ew-plugin/**",
                                    "tooling/scripts/local-dev/workflow-*.mjs",
                                ]
                            },
                            "require": ["acceptance-workflow-contract"],
                        }
                    ],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        subprocess.run(["git", "init"], cwd=self.root, check=True, capture_output=True)
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
        for attempt in range(3):
            try:
                self.temporary.cleanup()
                return
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(0.05)

    def environment(self, _session: str = "") -> dict[str, str]:
        environment = {
            **os.environ,
            "HOME": str(self.home),
            "USERPROFILE": str(self.home),
            "PT_MACHINE_DEV_ROOT": str(self.machine),
        }
        for name in (
            "ICUBE_CODEMAIN_SESSION",
            "CURSOR_SESSION_ID",
            "CURSOR_TRACE_ID",
            "CODEX_THREAD_ID",
            "CODEX_SESSION_ID",
        ):
            environment.pop(name, None)
        return environment

    def install_trae_fixture(
        self,
        workspace: Path | None = None,
    ) -> subprocess.CompletedProcess[str]:
        command = ["make", "skills", "IDE=trae"]
        if workspace is not None:
            command.append(f"WORKSPACE={workspace}")
        return subprocess.run(
            command,
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )

    def audit_trae_fixture(
        self,
        workspace: Path | None = None,
    ) -> subprocess.CompletedProcess[str]:
        command = [
            "python3",
            "tooling/scripts/agent-integration-audit.py",
            "--root",
            str(self.root),
            "--host",
            "trae",
        ]
        if workspace is not None:
            command.extend(["--workspace", str(workspace)])
        return subprocess.run(
            command,
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )

    def prepare_codex_projection(self) -> None:
        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        for actions in self.machine.glob("workspaces/*/workflow/actions"):
            shutil.rmtree(actions)

    def write_live_declaration(self, state: str) -> None:
        now_value = datetime.now(timezone.utc)
        now = now_value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        expires_at = (now_value + timedelta(minutes=10)).isoformat(
            timespec="milliseconds",
        ).replace("+00:00", "Z")
        declaration = {
            "declarationId": "OTHER-fedcba9876543210",
            "workItemId": "OTHER",
            "sessionId": "SESSION-OTHER",
            "workspaceId": "fedcba9876543210",
            "branch": "other",
            "sourceHead": "a" * 40,
            "owner": "other@test.invalid",
            "purpose": "unrelated fixture",
            "journeyId": None,
            "state": state,
            "createdAt": now,
            "heartbeatAt": now,
            "expiresAt": expires_at,
            "sourceClaims": [],
            "runtimeClaims": [],
            "planPath": None,
            "planId": None,
            "taskId": None,
        }
        serialized = json.dumps(
            declaration,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
        declaration["declarationDigest"] = hashlib.sha256(serialized).hexdigest()
        (self.machine / "work.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "kind": "peers-touch-development-work-ledger",
                    "updatedAt": now,
                    "declarations": {
                        declaration["declarationId"]: declaration,
                    },
                }
            ),
            encoding="utf-8",
        )

    def seed_live_workflow_state(self, mode: str) -> None:
        self.machine.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.machine.chmod(0o700)
        script = (
            "import { pathToFileURL } from 'node:url';"
            "const [bindingPath, projectionPath, actionPath, repoRoot, "
            "machineRoot, mode] = process.argv.slice(-6);"
            "const binding = await import(pathToFileURL(bindingPath));"
            "const projection = await import(pathToFileURL(projectionPath));"
            "const action = await import(pathToFileURL(actionPath));"
            "const sessionSchema = await import(pathToFileURL("
            "repoRoot + '/tooling/scripts/local-dev/dev-session-schema.mjs'));"
            "const sessionStore = await import(pathToFileURL("
            "repoRoot + '/tooling/scripts/local-dev/dev-session-store.mjs'));"
            "const activeWork = await import(pathToFileURL("
            "repoRoot + '/tooling/scripts/local-dev/active-work-store.mjs'));"
            "const now = new Date();"
            "const owner = binding.bindWorkflowOwner("
            "'trae', 'visible-chat', repoRoot, { machineRoot, now }"
            ").binding;"
            "const ownerProjection = projection.projectWorkflowBinding({"
            "binding: owner, now"
            "});"
            "if (mode === 'assignment') {"
            "const sessionId = 'SESSION-1';"
            "const workItemId = 'WORK-1';"
            "const state = sessionSchema.createInitialSessionState({"
            "sessionId,"
            "workItemId,"
            "planId: 'PLAN-1',"
            "taskId: 'TASK-1',"
            "workspaceId: owner.workspaceId,"
            "branch: 'test',"
            "journeyId: 'JOURNEY-1',"
            "executionMode: 'build'"
            "}, now.toISOString());"
            "sessionStore.createSessionStore(state, {"
            "workspaceId: owner.workspaceId, workItemId, now"
            "});"
            "activeWork.updateActiveWorkRecord({"
            "workspaceId: owner.workspaceId,"
            "workItemId,"
            "planId: 'PLAN-1',"
            "planPath: 'docs/architecture/test/execution-plans/test/plan.md',"
            "planStatus: 'active',"
            "currentTaskId: 'TASK-1',"
            "currentTaskPath: "
            "'docs/architecture/test/execution-plans/test/tasks/TASK-1.md',"
            "taskStatus: 'in_progress',"
            "sessionId,"
            "journeyId: 'JOURNEY-1',"
            "devState: 'BOUND',"
            "branch: 'test',"
            "initialHead: '1'.repeat(40),"
            "expectedHead: '2'.repeat(40)"
            "}, { workspaceId: owner.workspaceId, now });"
            "binding.createWorkflowBindingAssignment(ownerProjection, {"
            "assignmentId: 'reviewer-1',"
            "role: 'REVIEWER',"
            "workflowSessionId: sessionId,"
            "operationId: 'review-1',"
            "leaseMs: 60_000"
            "}, { machineRoot, now });"
            "} else {"
            "const receipt = action.recordWorkflowAction({"
            "machineRoot,"
            "rootBindingDigest: owner.digest,"
            "binding: {"
            "workspaceId: owner.workspaceId,"
            "workItemId: null,"
            "planId: null,"
            "taskId: null,"
            "sessionId: null"
            "},"
            "actor: {"
            "host: owner.host,"
            "bindingDigest: owner.digest,"
            "role: owner.role,"
            "rootBindingDigest: owner.digest,"
            "parentBindingDigest: null,"
            "assignmentDigest: null"
            "},"
            "operation: {"
            "family: 'OWNER_CONTROL',"
            "label: mode.startsWith('installer-')"
            " ? 'skills'"
            " : mode.startsWith('hard-cut-')"
            " ? 'skills-hard-cut'"
            " : mode.startsWith('gc-')"
            " ? 'skills-gc'"
            " : 'status',"
            "targetRef: null"
            "},"
            "progressStamp: 'c'.repeat(64),"
            "leaseMs: 60_000,"
            "now"
            "});"
            "if (mode.endsWith('-authorized') && "
            "!mode.startsWith('installer-')) {"
            "action.issueWorkflowActionGrant(receipt, { machineRoot, now });"
            "}"
            "}"
        )
        completed = subprocess.run(
            [
                "node",
                "--input-type=module",
                "--eval",
                script,
                str(
                    self.root
                    / "tooling/scripts/local-dev/workflow-binding-store.mjs"
                ),
                str(
                    self.root
                    / "tooling/scripts/local-dev/workflow-binding-projection.mjs"
                ),
                str(
                    self.root
                    / "tooling/scripts/local-dev/workflow-action-store.mjs"
                ),
                str(self.root),
                str(self.machine),
                mode,
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_installer_atomic_lock_capture_declares_windows_no_replace(self) -> None:
        control = (
            REPO_ROOT / "tooling/scripts/agent-integration-control.py"
        ).read_text(encoding="utf-8")
        self.assertIn("MoveFileExW", control)
        self.assertIn("0x00000008", control)

    def test_windows_atomic_lock_capture_uses_no_replace_semantics(self) -> None:
        module = load_integration_control()
        calls: list[tuple[str, str, int]] = []

        class MoveFile:
            argtypes = None
            restype = None

            def __call__(self, source: str, destination: str, flags: int) -> int:
                calls.append((source, destination, flags))
                return 1

        class Kernel:
            MoveFileExW = MoveFile()

        with mock.patch.object(module.os.sys, "platform", "win32"), mock.patch.object(
            module.ctypes,
            "WinDLL",
            return_value=Kernel(),
            create=True,
        ):
            self.assertTrue(
                module.atomic_move_no_replace(Path("source"), Path("target"))
            )
        self.assertEqual(calls, [("source", "target", 0x00000008)])

        class ExistingMove(MoveFile):
            def __call__(self, source: str, destination: str, flags: int) -> int:
                return 0

        class ExistingKernel:
            MoveFileExW = ExistingMove()

        with mock.patch.object(module.os.sys, "platform", "win32"), mock.patch.object(
            module.ctypes,
            "WinDLL",
            return_value=ExistingKernel(),
            create=True,
        ), mock.patch.object(module.ctypes, "get_last_error", return_value=183, create=True):
            self.assertFalse(
                module.atomic_move_no_replace(Path("source"), Path("target"))
            )

    def test_ungranted_codex_install_retires_real_legacy_directory(self) -> None:
        legacy = self.root / ".agents/skills/pt-trae-goal-orchestrator"
        legacy.mkdir(parents=True)
        (legacy / "SKILL.md").write_text("legacy\n", encoding="utf-8")
        unrelated = self.root / ".agents/plugins/unrelated"
        unrelated.mkdir(parents=True)
        (unrelated / "keep.txt").write_text("keep\n", encoding="utf-8")
        environment = self.environment("installing-session")
        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertFalse(legacy.exists())
        retired = list(
            (self.root / ".agents/retired-project-skills").glob(
                "pt-trae-goal-orchestrator.*"
            )
        )
        self.assertEqual(len(retired), 1)
        for name in (
            "pt-goal-orchestrator",
            "pt-trae-host-adapter",
            "pt-cursor-host-adapter",
            "pt-codex-host-adapter",
        ):
            self.assertTrue((self.root / ".agents/skills" / name).is_symlink())
        self.assertEqual(
            (
                self.root / ".agents/plugins/pt-ew-plugin"
            ).resolve(strict=True),
            (self.root / "tooling/plugins/pt-ew-plugin").resolve(strict=True),
        )
        self.assertEqual(
            (unrelated / "keep.txt").read_text(encoding="utf-8"),
            "keep\n",
        )

        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(audit.returncode, 0, audit.stdout + audit.stderr)
        self.assertEqual(json.loads(audit.stdout)["status"], "PASS")
        receipt = next(
            (self.root / "machine/workspaces").glob(
                "*/workflow/agent-integration.json"
            )
        )
        receipt_value = json.loads(receipt.read_text(encoding="utf-8"))
        self.assertEqual(receipt_value["state"], "INSTALLED")
        self.assertEqual(
            receipt_value["callbackProof"],
            {"status": "NOT_APPLICABLE"},
        )
        self.assertNotIn("schemaVersion", receipt_value)
        receipt_value["schemaVersion"] = 3
        receipt.write_text(json.dumps(receipt_value), encoding="utf-8")
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertIn("integration-receipt-fields-invalid", audit.stdout)
        receipt_value.pop("schemaVersion")
        receipt_value["branch"] = "other-branch"
        receipt.write_text(json.dumps(receipt_value), encoding="utf-8")
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertIn("integration-branch-mismatch", audit.stdout)
        receipt_value["branch"] = "main"
        receipt_value.pop("installedAt")
        receipt.write_text(json.dumps(receipt_value), encoding="utf-8")
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertIn("integration-receipt-fields-invalid", audit.stdout)

    def test_trae_install_preserves_existing_workspace_files_and_merges_hooks(
        self,
    ) -> None:
        trae = self.root / ".trae"
        trae.mkdir()
        existing_hook = {
            "matcher": "Read",
            "hooks": [{"type": "command", "command": "echo existing"}],
        }
        (trae / "hooks.json").write_text(
            json.dumps(
                {
                    "custom": {"preserved": True},
                    "hooks": {
                        "SessionStart": [existing_hook],
                        "PostToolUse": [existing_hook],
                    },
                }
            ),
            encoding="utf-8",
        )
        (trae / "custom.json").write_text('{"preserved":true}\n', encoding="utf-8")

        self.seed_live_workflow_state("installer-authorized")
        installed = subprocess.run(
            ["make", "skills", "IDE=trae"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("installing-session"),
            check=False,
        )
        self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
        hooks = json.loads((trae / "hooks.json").read_text(encoding="utf-8"))
        self.assertEqual(hooks["custom"], {"preserved": True})
        self.assertEqual(hooks["hooks"]["PostToolUse"][0], existing_hook)
        self.assertEqual(hooks["hooks"]["SessionStart"][0], existing_hook)
        for event in (
            "SessionStart",
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "SubagentStart",
            "SubagentStop",
            "PreCompact",
            "PostCompact",
            "Stop",
        ):
            managed = [
                hook
                for entry in hooks["hooks"][event]
                for hook in entry.get("hooks", [])
                if "pt-ew-plugin" in hook.get("command", "")
            ]
            self.assertEqual(len(managed), 1)
        self.assertEqual(
            (trae / "custom.json").read_text(encoding="utf-8"),
            '{"preserved":true}\n',
        )

        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "trae",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("restarted-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 0, audit.stdout + audit.stderr)

        receipt = next(
            self.machine.glob("workspaces/*/workflow/agent-integration.json")
        )
        self.assertEqual(
            json.loads(receipt.read_text(encoding="utf-8"))["callbackProof"],
            {
                "status": "PASS",
                "hostEvent": "PreToolUse",
                "permissionDecision": "deny",
                "code": "TOOL_INTENT_UNSUPPORTED",
            },
        )

    def test_trae_workspace_projects_bootstrap_source_and_existing_host_roots(
        self,
    ) -> None:
        bootstrap = self.root / "bootstrap"
        connected = self.root / "connected"
        untouched = self.root / "untouched"
        bootstrap.mkdir()
        connected.mkdir()
        untouched.mkdir()
        connected_trae = connected / ".trae"
        connected_trae.mkdir()
        (connected_trae / "hooks.json").write_text(
            json.dumps({"hooks": {}}),
            encoding="utf-8",
        )
        workspace = self.root / "fixture.code-workspace"
        workspace.write_text(
            json.dumps(
                {
                    "folders": [
                        {"path": "bootstrap"},
                        {"path": "."},
                        {"path": "connected"},
                        {"path": "untouched"},
                    ]
                }
            ),
            encoding="utf-8",
        )
        current_hooks = self.root / ".trae/hooks.json"
        current_hooks.parent.mkdir()
        current_hooks.write_text(
            json.dumps(
                {
                    "hooks": {
                        "PreToolUse": [
                            load_integration_control().canonical_trae_hook_entry(
                                self.root,
                                "PreToolUse",
                            )
                        ]
                    }
                }
            ),
            encoding="utf-8",
        )

        installed = self.install_trae_fixture(workspace)
        self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
        bootstrap_hooks = json.loads(
            (bootstrap / ".trae/hooks.json").read_text(encoding="utf-8")
        )
        self.assertIn("--workspace", json.dumps(bootstrap_hooks))
        self.assertIn(
            "pt-ew-plugin",
            current_hooks.read_text(encoding="utf-8"),
        )
        self.assertIn("--workspace", current_hooks.read_text(encoding="utf-8"))
        self.assertIn(
            "pt-ew-plugin",
            (connected_trae / "hooks.json").read_text(encoding="utf-8"),
        )
        self.assertFalse((untouched / ".trae").exists())

        audit = self.audit_trae_fixture(workspace)
        self.assertEqual(audit.returncode, 0, audit.stdout + audit.stderr)

        duplicate_hooks = untouched / ".trae/hooks.json"
        duplicate_hooks.parent.mkdir()
        duplicate_hooks.write_text(
            json.dumps(
                {
                    "hooks": {
                        "PreToolUse": bootstrap_hooks["hooks"]["PreToolUse"],
                    }
                }
            ),
            encoding="utf-8",
        )
        duplicate_audit = self.audit_trae_fixture(workspace)
        self.assertEqual(duplicate_audit.returncode, 2)
        self.assertIn(
            "managed-hook-invalid:SessionStart",
            duplicate_audit.stdout,
        )

    def test_trae_workspace_preflight_never_resets_legacy_state(self) -> None:
        workspace = self.root / "fixture.code-workspace"
        workspace.write_text(
            json.dumps({"folders": [{"path": "missing"}]}),
            encoding="utf-8",
        )
        legacy = self.machine / "conversations/trae/legacy"
        legacy.mkdir(parents=True)

        installed = self.install_trae_fixture(workspace)
        self.assertEqual(installed.returncode, 2)
        self.assertIn("TRAE_WORKSPACE_DESCRIPTOR_INVALID", installed.stdout)
        self.assertTrue(legacy.exists())

        workspace.write_text(
            json.dumps({"folders": [{"path": "."}]}),
            encoding="utf-8",
        )
        retried = subprocess.run(
            ["make", "skills", "IDE=trae", f"WORKSPACE={workspace}"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )
        self.assertEqual(retried.returncode, 0, retried.stdout + retried.stderr)
        self.assertTrue(legacy.exists())

    def test_install_preserves_legacy_conversations_and_action_stores(self) -> None:
        self.seed_live_workflow_state("installer-authorized")
        conversation = self.machine / "conversations/trae/legacy"
        action_store = (
            self.machine
            / "workspaces/0123456789abcdef/workflow/actions"
        )
        conversation.mkdir(parents=True)
        action_store.mkdir(parents=True)
        (conversation / "binding.json").write_text("{}\n", encoding="utf-8")
        (action_store / "receipt.json").write_text("{}\n", encoding="utf-8")

        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertTrue(conversation.is_dir())
        self.assertTrue(action_store.is_dir())

    def test_hard_cut_purges_only_legacy_conversations_and_action_stores(
        self,
    ) -> None:
        self.prepare_codex_projection()
        self.seed_live_workflow_state("hard-cut-authorized")
        conversations = self.machine / "conversations/trae/legacy"
        actions = self.machine / "workspaces/0123456789abcdef/workflow/actions"
        preserved = (
            self.machine
            / "workspaces/0123456789abcdef/workflow/WORK-1/session.json"
        )
        conversations.mkdir(parents=True)
        actions.mkdir(parents=True)
        preserved.parent.mkdir(parents=True)
        (conversations / "execution-binding.json").write_text(
            "{}\n",
            encoding="utf-8",
        )
        (actions / "trae-legacy.json").write_text("{}\n", encoding="utf-8")
        preserved.write_text('{"preserved":true}\n', encoding="utf-8")

        installed = subprocess.run(
            ["make", "skills-hard-cut", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )
        self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
        self.assertFalse((self.machine / "conversations").exists())
        self.assertFalse(actions.exists())
        self.assertTrue(preserved.is_file())

    def test_hard_cut_requires_an_exact_installer_action_grant(self) -> None:
        legacy = self.machine / "conversations/trae/legacy"
        legacy.mkdir(parents=True)

        completed = subprocess.run(
            ["make", "skills-hard-cut", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("WORKFLOW_ACTION_GRANT_UNAVAILABLE", completed.stdout)
        self.assertTrue(legacy.exists())

    def test_hard_cut_refuses_a_live_child_assignment(self) -> None:
        self.seed_live_workflow_state("assignment")
        legacy = self.machine / "conversations/trae/legacy"
        legacy.mkdir(parents=True)

        completed = subprocess.run(
            ["make", "skills-hard-cut", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("GLOBAL_WORKFLOW_NOT_IDLE", completed.stdout)
        self.assertTrue(legacy.exists())

    def test_hard_cut_refuses_a_live_non_installer_action(self) -> None:
        self.seed_live_workflow_state("action")
        legacy = self.machine / "conversations/trae/legacy"
        legacy.mkdir(parents=True)

        completed = subprocess.run(
            ["make", "skills-hard-cut", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("GLOBAL_WORKFLOW_NOT_IDLE", completed.stdout)
        self.assertTrue(legacy.exists())

    def test_hard_cut_rejects_an_unrelated_seeded_installer_action(self) -> None:
        self.seed_live_workflow_state("hard-cut-action")
        legacy = self.machine / "conversations/trae/legacy"
        legacy.mkdir(parents=True)

        completed = subprocess.run(
            ["make", "skills-hard-cut", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("WORKFLOW_ACTION_GRANT_UNAVAILABLE", completed.stdout)
        self.assertTrue(legacy.exists())

    def test_hard_cut_accepts_the_exact_granted_installer_action_once(self) -> None:
        self.prepare_codex_projection()
        self.seed_live_workflow_state("hard-cut-authorized")
        legacy = self.machine / "conversations/trae/legacy"
        legacy.mkdir(parents=True)

        completed = subprocess.run(
            ["make", "skills-hard-cut", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertFalse(legacy.exists())

    def test_hard_cut_validates_all_targets_before_deleting_any_store(self) -> None:
        legacy = self.machine / "conversations/trae/legacy"
        legacy.mkdir(parents=True)
        action_store = (
            self.machine
            / "workspaces/0123456789abcdef/workflow/actions"
            / f"{'a' * 64}.json"
        )
        action_store.parent.mkdir(parents=True)
        action_store.write_text("{}\n", encoding="utf-8")

        completed = subprocess.run(
            ["make", "skills-hard-cut", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("WORKFLOW_ACTION_STORE_INVALID", completed.stdout)
        self.assertTrue(legacy.exists())
        self.assertTrue(action_store.exists())

    def test_hard_cut_rejects_an_unsafe_target_before_grant_consumption(
        self,
    ) -> None:
        self.seed_live_workflow_state("hard-cut-authorized")
        external = self.root / "external-conversations"
        external.mkdir()
        (self.machine / "conversations").symlink_to(
            external,
            target_is_directory=True,
        )

        completed = subprocess.run(
            ["make", "skills-hard-cut", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("LEGACY_BINDING_RESET_INVALID", completed.stdout)
        self.assertFalse(
            any(
                self.machine.glob(
                    "workspaces/*/workflow/agent-integration.json"
                )
            )
        )

    def test_skills_gc_removes_only_retired_project_projections(self) -> None:
        self.prepare_codex_projection()
        self.seed_live_workflow_state("gc-authorized")
        skills = self.root / ".agents/skills/pt-goal-orchestrator"
        retired_skill = (
            self.root
            / ".agents/retired-project-skills/pt-goal-orchestrator.old"
        )
        retired_plugin = (
            self.root
            / ".agents/retired-project-plugins/pt-ew-plugin.old"
        )
        retired_skill.mkdir(parents=True)
        retired_plugin.mkdir(parents=True)

        completed = subprocess.run(
            ["make", "skills-gc", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertTrue(skills.is_dir())
        self.assertFalse(retired_skill.parent.exists())
        self.assertFalse(retired_plugin.parent.exists())

    def test_skills_gc_rejects_a_hard_cut_grant(self) -> None:
        self.seed_live_workflow_state("hard-cut-authorized")
        retired = self.root / ".agents/retired-project-skills/legacy"
        retired.mkdir(parents=True)

        completed = subprocess.run(
            ["make", "skills-gc", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("GLOBAL_WORKFLOW_NOT_IDLE", completed.stdout)
        self.assertTrue(retired.is_dir())

    def test_skills_gc_rejects_an_unrelated_live_declaration(self) -> None:
        self.seed_live_workflow_state("gc-authorized")
        self.write_live_declaration("ACTIVE")
        retired = self.root / ".agents/retired-project-skills/legacy"
        retired.mkdir(parents=True)

        completed = subprocess.run(
            ["make", "skills-gc", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("GLOBAL_WORKFLOW_NOT_IDLE", completed.stdout)
        self.assertTrue(retired.is_dir())

    def test_trae_audit_rejects_missing_pre_tool_use_matcher(self) -> None:
        installed = self.install_trae_fixture()
        self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
        hooks_path = self.root / ".trae/hooks.json"
        hooks = json.loads(hooks_path.read_text(encoding="utf-8"))
        del hooks["hooks"]["PreToolUse"][-1]["matcher"]
        hooks_path.write_text(json.dumps(hooks), encoding="utf-8")

        audit = self.audit_trae_fixture()

        self.assertEqual(audit.returncode, 2, audit.stdout + audit.stderr)
        payload = json.loads(audit.stdout)
        self.assertIn(
            {
                "path": ".trae/hooks.json",
                "issue": "managed-hook-invalid:PreToolUse",
            },
            payload["hostProjectionFindings"],
        )
        self.assertEqual(payload["installedCallbackProbe"]["status"], "BLOCKED")

    def test_trae_audit_rejects_modified_pre_tool_use_entry_shape(self) -> None:
        installed = self.install_trae_fixture()
        self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
        hooks_path = self.root / ".trae/hooks.json"
        original = json.loads(hooks_path.read_text(encoding="utf-8"))
        mutations = (
            ("timeout", "timeout", 6),
            ("type", "type", "shell"),
            ("command", "command", "node invalid"),
        )

        for name, field, value in mutations:
            with self.subTest(field=name):
                hooks = json.loads(json.dumps(original))
                hooks["hooks"]["PreToolUse"][-1]["hooks"][0][field] = value
                hooks_path.write_text(json.dumps(hooks), encoding="utf-8")

                audit = self.audit_trae_fixture()

                self.assertEqual(audit.returncode, 2, audit.stdout + audit.stderr)
                payload = json.loads(audit.stdout)
                self.assertIn(
                    {
                        "path": ".trae/hooks.json",
                        "issue": "managed-hook-invalid:PreToolUse",
                    },
                    payload["hostProjectionFindings"],
                )
                self.assertEqual(
                    payload["installedCallbackProbe"]["status"],
                    "BLOCKED",
                )

        hooks = json.loads(json.dumps(original))
        hooks["hooks"]["PreToolUse"][-1]["unexpected"] = True
        hooks_path.write_text(json.dumps(hooks), encoding="utf-8")
        audit = self.audit_trae_fixture()
        self.assertEqual(audit.returncode, 2, audit.stdout + audit.stderr)
        self.assertIn(
            {
                "path": ".trae/hooks.json",
                "issue": "managed-hook-invalid:PreToolUse",
            },
            json.loads(audit.stdout)["hostProjectionFindings"],
        )

    def test_trae_audit_reexecutes_callback_and_binding_probe(self) -> None:
        installed = self.install_trae_fixture()
        self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
        receipt = next(
            self.machine.glob("workspaces/*/workflow/agent-integration.json")
        )
        receipt_value = json.loads(receipt.read_text(encoding="utf-8"))
        stale_proof = dict(receipt_value["callbackProof"])
        hook_entry = (
            self.root
            / "tooling/plugins/pt-ew-plugin/scripts/hook-entry.mjs"
        )
        hook_entry.write_text(
            "#!/usr/bin/env node\n"
            "process.stdout.write(JSON.stringify({hookSpecificOutput:{"
            "hookEventName:'PreToolUse',permissionDecision:'deny',"
            "permissionDecisionReason:'TOOL_INTENT_UNSUPPORTED: stale'"
            "}})+'\\n');\n",
            encoding="utf-8",
        )
        catalog = load_integration_audit().canonical_integration_catalog(self.root)
        self.assertEqual(catalog["status"], "PASS")
        for field in (
            "integrationDigest",
            "integrationEntryCount",
            "integrationGitState",
            "integrationStatusDigest",
        ):
            receipt_value[field] = catalog[field]
        receipt.write_text(json.dumps(receipt_value), encoding="utf-8")

        audit = self.audit_trae_fixture()

        self.assertEqual(audit.returncode, 2, audit.stdout + audit.stderr)
        payload = json.loads(audit.stdout)
        self.assertEqual(payload["hostProjectionFindings"], [])
        self.assertEqual(payload["canonicalIntegrationCatalog"]["status"], "PASS")
        self.assertEqual(
            payload["integrationReceipt"]["receipt"]["callbackProof"],
            stale_proof,
        )
        self.assertEqual(
            payload["installedCallbackProbe"],
            {
                "status": "BLOCKED",
                "code": "TRAE_HOOK_PROBE_BINDING_INVALID",
            },
        )

    def test_trae_install_does_not_leave_false_installed_receipt(
        self,
    ) -> None:
        environment = self.environment("installing-session")
        self.seed_live_workflow_state("installer-authorized")
        initial = subprocess.run(
            ["make", "skills", "IDE=trae"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(initial.returncode, 0, initial.stdout + initial.stderr)
        receipt = next(
            self.machine.glob("workspaces/*/workflow/agent-integration.json")
        )
        self.assertEqual(
            json.loads(receipt.read_text(encoding="utf-8"))["state"],
            "INSTALLED",
        )

        hook_entry = (
            self.root
            / "tooling/plugins/pt-ew-plugin/scripts/hook-entry.mjs"
        )
        hook_entry.write_text(
            "#!/usr/bin/env node\nprocess.stdout.write('\\n{}\\n');\n",
            encoding="utf-8",
        )
        for actions in self.machine.glob("workspaces/*/workflow/actions"):
            shutil.rmtree(actions)
        self.seed_live_workflow_state("installer-authorized")
        failed = subprocess.run(
            ["make", "skills", "IDE=trae"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(failed.returncode, 2, failed.stdout + failed.stderr)
        self.assertIn("TRAE_HOOK_PROBE_RESPONSE_UNSUPPORTED", failed.stdout)
        blocked = json.loads(receipt.read_text(encoding="utf-8"))
        self.assertEqual(blocked["state"], "BLOCKED")
        self.assertNotEqual(blocked["state"], "INSTALLED")
        self.assertEqual(blocked["installedAt"], None)

        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "trae",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(audit.returncode, 2, audit.stdout + audit.stderr)
        self.assertIn("integration-state-mismatch", audit.stdout)

    def test_cursor_install_merges_native_fail_closed_hooks(self) -> None:
        cursor = self.root / ".cursor"
        cursor.mkdir()
        existing_hook = {
            "command": ".cursor/hooks/existing.sh",
            "timeout": 10,
        }
        (cursor / "hooks.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "custom": {"preserved": True},
                    "hooks": {
                        "sessionStart": [existing_hook],
                        "afterFileEdit": [existing_hook],
                    },
                }
            ),
            encoding="utf-8",
        )
        self.seed_live_workflow_state("installer-authorized")
        installed = subprocess.run(
            ["make", "skills", "IDE=cursor"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("installing-session"),
            check=False,
        )
        self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
        hooks = json.loads((cursor / "hooks.json").read_text(encoding="utf-8"))
        self.assertEqual(hooks["version"], 1)
        self.assertEqual(hooks["custom"], {"preserved": True})
        self.assertEqual(hooks["hooks"]["afterFileEdit"], [existing_hook])
        self.assertEqual(hooks["hooks"]["sessionStart"][0], existing_hook)
        for event in (
            "sessionStart",
            "beforeSubmitPrompt",
            "preToolUse",
            "stop",
        ):
            managed = [
                item
                for item in hooks["hooks"][event]
                if "pt-ew-plugin" in item.get("command", "")
            ]
            self.assertEqual(len(managed), 1)
            self.assertIs(managed[0]["failClosed"], True)
        self.assertEqual(hooks["hooks"]["preToolUse"][-1]["matcher"], "*")

        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "cursor",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("restarted-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 0, audit.stdout + audit.stderr)
        hooks["hooks"]["preToolUse"][-1]["failClosed"] = False
        (cursor / "hooks.json").write_text(
            json.dumps(hooks),
            encoding="utf-8",
        )
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "cursor",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("restarted-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2, audit.stdout + audit.stderr)
        self.assertIn("managed-hook-invalid:preToolUse", audit.stdout)

    def test_install_with_live_declaration_is_nonblocking(self) -> None:
        machine = self.root / "machine"
        for state in ("DECLARED", "ACTIVE", "RELEASING"):
            with self.subTest(state=state):
                shutil.rmtree(machine, ignore_errors=True)
                self.seed_live_workflow_state("installer-authorized")
                self.write_live_declaration(state)
                completed = subprocess.run(
                    ["make", "skills", "IDE=codex"],
                    cwd=self.root,
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    text=True,
                    env=self.environment("installing-session"),
                    check=False,
                )
                self.assertEqual(
                    completed.returncode,
                    0,
                    completed.stdout + completed.stderr,
                )
                self.assertTrue(
                    (self.root / ".agents/skills/pt-goal-orchestrator").is_symlink()
                )

    def test_install_with_unrelated_live_action_is_nonblocking(self) -> None:
        self.seed_live_workflow_state("action")
        self.seed_live_workflow_state("installer-authorized")

        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=self.environment("installing-session"),
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertTrue(
            (self.root / ".agents/skills/pt-goal-orchestrator").is_symlink()
        )

    def test_audit_rejects_a_versioned_integration_receipt(self) -> None:
        self.seed_live_workflow_state("installer-authorized")
        installed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=self.environment("installing-session"),
            check=False,
        )
        self.assertEqual(installed.returncode, 0, installed.stderr)
        receipt = next(
            (self.root / "machine/workspaces").glob(
                "*/workflow/agent-integration.json"
            )
        )
        value = json.loads(receipt.read_text(encoding="utf-8"))
        value["schemaVersion"] = 3
        receipt.write_text(json.dumps(value), encoding="utf-8")

        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertIn("integration-receipt-fields-invalid", audit.stdout)

    def test_install_rejects_a_schema_invalid_work_ledger(self) -> None:
        machine = self.root / "machine"
        machine.mkdir()
        (machine / "work.json").write_text(
            '{"notDeclarations":{}}\n',
            encoding="utf-8",
        )
        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=self.environment("installing-session"),
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("MACHINE_WORK_LEDGER_INVALID", completed.stdout)
        self.assertFalse(
            (self.root / ".agents/skills/pt-goal-orchestrator").exists()
        )

    def test_install_and_audit_reject_projection_escape_or_wrong_target(self) -> None:
        external = self.root / "external"
        external.mkdir()
        (self.root / ".agents").symlink_to(external, target_is_directory=True)
        self.seed_live_workflow_state("installer-authorized")
        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=self.environment("installing-session"),
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("HOST_PROJECTION_ESCAPE", completed.stdout)
        (self.root / ".agents").unlink()

        (self.root / ".agents/skills/pt-trae-goal-orchestrator").mkdir(
            parents=True
        )
        retired_external = self.root / "retired-external"
        retired_external.mkdir()
        (self.root / ".agents/retired-project-skills").symlink_to(
            retired_external,
            target_is_directory=True,
        )
        shutil.rmtree(self.machine / "workspaces", ignore_errors=True)
        self.seed_live_workflow_state("installer-authorized")
        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=self.environment("installing-session"),
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("HOST_PROJECTION_ESCAPE", completed.stdout)
        shutil.rmtree(self.root / ".agents")

        shutil.rmtree(self.machine / "workspaces", ignore_errors=True)
        self.seed_live_workflow_state("installer-authorized")
        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=self.environment("installing-session"),
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        projected = self.root / ".agents/skills/pt-goal-orchestrator"
        projected.unlink()
        projected.symlink_to(self.root / "tooling/skills/pt-codex-host-adapter")
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("restarted-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertIn("wrong-project-skill-target", audit.stdout)

    def test_install_rejects_canonical_skill_source_symlink(self) -> None:
        source = self.root / "tooling/skills/pt-goal-orchestrator"
        shutil.rmtree(source)
        external = self.root / "external-skill"
        external.mkdir()
        (external / "SKILL.md").write_text("external\n", encoding="utf-8")
        source.symlink_to(external, target_is_directory=True)
        self.seed_live_workflow_state("installer-authorized")
        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=self.environment("installing-session"),
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("CANONICAL_SKILL_SOURCE_INVALID", completed.stdout)
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("audit-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertIn("canonical-source-symlink", audit.stdout)

    def test_install_never_reclaims_an_unowned_work_lock(self) -> None:
        machine = self.root / "machine"
        machine.mkdir()
        lock = machine / "work.lock"
        lock.write_text(
            json.dumps(
                {
                    "pid": 999999,
                    "processStart": "stale",
                    "createdAt": "2026-09-19T00:00:00.000Z",
                }
            ),
            encoding="utf-8",
        )
        environment = self.environment("installing-session")
        environment["PT_AGENT_INTEGRATION_LOCK_TIMEOUT_SECONDS"] = "0.05"
        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("MACHINE_WORK_LEDGER_LOCKED", completed.stdout)
        self.assertTrue(lock.is_file())

    def test_install_waits_while_ledger_stale_recovery_is_claimed(self) -> None:
        machine = self.root / "machine"
        machine.mkdir()
        lock = machine / "work.lock"
        lock.write_text(
            json.dumps(
                {
                    "pid": 999999,
                    "processStart": "stale",
                    "createdAt": "2026-09-19T00:00:00.000Z",
                }
            ),
            encoding="utf-8",
        )
        process_start = subprocess.run(
            ["ps", "-o", "lstart=", "-p", str(os.getpid())],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        lock_stat = lock.stat()
        Path(f"{lock}.recovery").write_text(
            json.dumps(
                {
                    "pid": os.getpid(),
                    "processStart": process_start,
                    "createdAt": "2026-09-19T00:00:00.000Z",
                    "lockDev": lock_stat.st_dev,
                    "lockIno": lock_stat.st_ino,
                }
            ),
            encoding="utf-8",
        )
        environment = self.environment("installing-session")
        environment["PT_AGENT_INTEGRATION_LOCK_TIMEOUT_SECONDS"] = "0.05"
        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("MACHINE_WORK_LEDGER_LOCKED", completed.stdout)
        self.assertTrue(lock.is_file())

    def test_install_reclaims_an_orphaned_recovery_claim(self) -> None:
        machine = self.root / "machine"
        machine.mkdir()
        recovery = machine / "work.lock.recovery"
        recovery.write_text(
            json.dumps(
                {
                    "pid": 999999,
                    "processStart": "stale",
                    "createdAt": "2026-09-19T00:00:00.000Z",
                    "lockDev": 0,
                    "lockIno": 0,
                }
            ),
            encoding="utf-8",
        )
        self.seed_live_workflow_state("installer-authorized")
        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=self.environment("installing-session"),
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertFalse(recovery.exists())

    def test_audit_binds_recursive_dirty_integration_catalog(self) -> None:
        nested = self.root / "tooling/skills/pt-goal-orchestrator/references"
        nested.mkdir()
        content = nested / "contract.md"
        content.write_text("version one\n", encoding="utf-8")
        installing = self.environment("installing-session")
        self.seed_live_workflow_state("installer-authorized")
        completed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=installing,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        content.write_text("version two\n", encoding="utf-8")
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("restarted-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        findings = json.loads(audit.stdout)["integrationReceipt"]["findings"]
        self.assertIn("integrationDigest-mismatch", findings)
        self.assertNotIn("integrationStatusDigest-mismatch", findings)

    def test_integration_catalog_binds_architecture_governance_parser(
        self,
    ) -> None:
        control = load_integration_control()
        canonical_root = self.root.resolve(strict=True)
        _, _, before = control.canonical_integration_catalog(canonical_root)
        parser = (
            canonical_root
            / "tooling/scripts/architecture/module-governance.mjs"
        )
        parser.write_text(
            parser.read_text(encoding="utf-8") + "\n// changed\n",
            encoding="utf-8",
        )
        _, _, after = control.canonical_integration_catalog(canonical_root)

        self.assertNotEqual(
            before["integrationDigest"],
            after["integrationDigest"],
        )
        self.assertEqual(
            before["integrationEntryCount"],
            after["integrationEntryCount"],
        )

    def test_audit_rejects_architecture_parser_drift_after_install(
        self,
    ) -> None:
        environment = self.environment("installing-session")
        self.seed_live_workflow_state("installer-authorized")
        installed = subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(installed.returncode, 0, installed.stderr)
        parser = (
            self.root.resolve(strict=True)
            / "tooling/scripts/architecture/module-governance.mjs"
        )
        parser.write_text(
            parser.read_text(encoding="utf-8") + "\n// drift\n",
            encoding="utf-8",
        )

        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("restarted-session"),
            check=False,
        )

        self.assertEqual(audit.returncode, 2, audit.stdout + audit.stderr)
        findings = json.loads(audit.stdout)["integrationReceipt"]["findings"]
        self.assertIn("integrationDigest-mismatch", findings)

    def test_audit_propagates_registry_parse_failure(self) -> None:
        registry = self.root / "tooling/acceptance/registry.yaml"
        registry.write_text("not-json\n", encoding="utf-8")
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("audit-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertEqual(
            json.loads(audit.stdout)["acceptanceRegistry"]["error"],
            "registry-not-json",
        )

    def test_audit_fails_closed_when_registry_or_canonical_matchers_are_missing(
        self,
    ) -> None:
        registry = self.root / "tooling/acceptance/registry.yaml"
        registry.unlink()
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("audit-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertEqual(
            json.loads(audit.stdout)["acceptanceRegistry"]["error"],
            "registry-missing",
        )

        registry.write_text('{"version":1,"rules":[]}\n', encoding="utf-8")
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("audit-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertEqual(
            json.loads(audit.stdout)["acceptanceRegistry"][
                "missingCanonicalMatchers"
            ],
            [
                "pt-goal-orchestrator",
                "pt-trae-host-adapter",
                "pt-cursor-host-adapter",
                "pt-codex-host-adapter",
                "pt-ew-plugin",
                "workflow-kernel",
            ],
        )

        registry.write_text(
            json.dumps(
                {
                    "version": 1,
                    "rules": [
                        {
                            "id": "forged-canonical-text",
                            "when": {"paths": ["docs/**"]},
                            "notes": list(
                                (
                                    "pt-goal-orchestrator",
                                    "pt-trae-host-adapter",
                                    "pt-cursor-host-adapter",
                                    "pt-codex-host-adapter",
                                )
                            ),
                            "require": [],
                        }
                    ],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("audit-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertEqual(
            len(
                json.loads(audit.stdout)["acceptanceRegistry"][
                    "missingCanonicalMatchers"
                ]
            ),
            6,
        )

    def test_audit_rejects_spoofed_registry_schema_and_matchers(self) -> None:
        registry = self.root / "tooling/acceptance/registry.yaml"
        registry.write_text(
            json.dumps(
                {
                    "version": 999,
                    "rules": [
                        {
                            "id": "spoofed",
                            "when": {
                                "paths": [
                                    f"archive/{name}-not-live"
                                    for name in (
                                        "pt-goal-orchestrator",
                                        "pt-trae-host-adapter",
                                        "pt-cursor-host-adapter",
                                        "pt-codex-host-adapter",
                                    )
                                ]
                            },
                            "require": [],
                        }
                    ],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("audit-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertEqual(
            json.loads(audit.stdout)["acceptanceRegistry"]["error"],
            "registry-schema-invalid",
        )

    def test_audit_rejects_canonical_source_ancestor_symlink_escape(self) -> None:
        external = self.root / "external-tooling"
        shutil.copytree(self.root / "tooling", external)
        shutil.rmtree(self.root / "tooling")
        (self.root / "tooling").symlink_to(external, target_is_directory=True)
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("audit-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertIn("canonical-source-symlink", audit.stdout)

    def test_audit_uses_canonical_plan_binding_validation(self) -> None:
        machine = self.root / "machine"
        workspace_id = hashlib.sha256(
            str(self.root.resolve()).encode()
        ).hexdigest()[:16]
        binding = (
            machine
            / "workspaces"
            / workspace_id
            / "workflow"
            / "plan-binding.json"
        )
        binding.parent.mkdir(parents=True)
        binding.write_text(
            json.dumps(
                {
                    "workspaceId": workspace_id,
                    "planId": "PLAN-01",
                    "planPath": "missing-plan.md",
                }
            ),
            encoding="utf-8",
        )
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("audit-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertIn("binding-canonical-invalid", audit.stdout)

    def test_audit_accepts_canonical_normalization_of_legacy_binding(self) -> None:
        module = load_integration_audit()
        workspace_id = hashlib.sha256(
            str(self.root.resolve()).encode()
        ).hexdigest()[:16]
        branch = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=self.root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        legacy = {
            "schemaVersion": 1,
            "kind": "peers-touch-workspace-plan-binding",
            "workspaceId": workspace_id,
            "canonicalRoot": str(self.root.resolve()),
            "planId": "PLAN-01",
            "planPath": "plan.md",
            "boundAt": "2026-09-19T00:00:00.000Z",
            "boundBy": "test",
        }
        normalized = {
            **legacy,
            "schemaVersion": 2,
            "generation": 1,
            "recordDigest": "a" * 64,
        }
        binding_path = (
            self.machine
            / "workspaces"
            / workspace_id
            / "workflow"
            / "plan-binding.json"
        )
        binding_path.parent.mkdir(parents=True)
        binding_path.write_text(json.dumps(legacy), encoding="utf-8")
        manifest = {
            "planId": "PLAN-01",
            "status": "completed",
            "binding": {
                "workspaceId": workspace_id,
                "branch": branch,
            },
            "scope": {
                "sourceClaims": [
                    {
                        "mode": "exclusive-write",
                        "pathPrefix": "tooling/scripts",
                    }
                ]
            },
        }

        with mock.patch.object(
            module,
            "machine_dev_root",
            return_value=self.machine,
        ), mock.patch.object(
            module,
            "resolved_plan_binding",
            return_value=normalized,
        ), mock.patch.object(
            module,
            "validated_plan_status",
            return_value={"currentTaskId": None},
        ), mock.patch.object(
            module,
            "structured_plan",
            return_value=manifest,
        ):
            identity = module.workflow_identity(self.root)

        self.assertEqual(identity["identityFindings"], [])
        self.assertEqual(identity["planBinding"], normalized)

    def test_legacy_scan_ignores_foreign_plans_but_checks_bound_plan(self) -> None:
        module = load_integration_audit()
        foreign = (
            self.root
            / "docs/architecture/mobile/execution-plans/foreign-plan.md"
        )
        foreign.parent.mkdir(parents=True)
        foreign.write_text(
            "`pt-trae-goal-orchestrator NEXT` is a live instruction.\n",
            encoding="utf-8",
        )

        self.assertEqual(module.legacy_references(self.root), [])
        findings = module.legacy_references(
            self.root,
            ("docs/architecture/mobile/execution-plans/foreign-plan.md",),
        )
        self.assertEqual(len(findings), 1)
        self.assertEqual(
            findings[0]["path"],
            "docs/architecture/mobile/execution-plans/foreign-plan.md",
        )

    def test_audit_rejects_tracked_declaration_without_plan_task_locator(
        self,
    ) -> None:
        machine = self.root / "machine"
        workspace_id = hashlib.sha256(
            str(self.root.resolve()).encode()
        ).hexdigest()[:16]
        branch = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=self.root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        binding = {
            "schemaVersion": 2,
            "kind": "peers-touch-workspace-plan-binding",
            "workspaceId": workspace_id,
            "canonicalRoot": str(self.root.resolve()),
            "planId": "PLAN-01",
            "planPath": "plan.md",
            "generation": 2,
            "boundAt": "2026-09-19T00:00:00.000Z",
            "boundBy": "test",
            "recordDigest": "a" * 64,
        }
        binding_path = (
            machine
            / "workspaces"
            / workspace_id
            / "workflow"
            / "plan-binding.json"
        )
        binding_path.parent.mkdir(parents=True)
        binding_path.write_text(json.dumps(binding), encoding="utf-8")
        (self.root / "plan.md").write_text(
            "## Plan Package\n```json\n"
            + json.dumps(
                {
                    "planId": "PLAN-01",
                    "status": "active",
                    "binding": {
                        "workspaceId": workspace_id,
                        "branch": branch,
                    },
                    "scope": {
                        "sourceClaims": [
                            {
                                "mode": "exclusive-write",
                                "pathPrefix": "tooling/skills",
                            }
                        ]
                    },
                }
            )
            + "\n```\n",
            encoding="utf-8",
        )
        plan_scripts = self.root / "tooling/scripts/plan"
        plan_scripts.mkdir(exist_ok=True)
        (plan_scripts / "workspace-plan-binding.mjs").write_text(
            f"console.log({json.dumps(json.dumps({'ok': True, 'binding': binding}))});\n",
            encoding="utf-8",
        )
        (plan_scripts / "planctl.mjs").write_text(
            'console.log(JSON.stringify({ok:true,currentTaskId:"TASK-01"}));\n',
            encoding="utf-8",
        )
        local_dev = self.root / "tooling/scripts/local-dev"
        local_dev.mkdir(exist_ok=True)
        declaration = {
            "workspaceId": workspace_id,
            "branch": branch,
            "sourceHead": head,
            "sourceClaims": [
                {
                    "mode": "exclusive-write",
                    "pathPrefix": "tooling/skills",
                }
            ],
            "state": "ACTIVE",
            "workItemId": "WORK-01",
            "heartbeatAt": "2026-09-19T00:00:00.000Z",
            "planId": None,
            "planPath": None,
            "taskId": None,
        }
        valid_declaration = {
            **declaration,
            "workItemId": "WORK-02",
            "heartbeatAt": "2026-09-19T01:00:00.000Z",
            "planId": "PLAN-01",
            "planPath": "plan.md",
            "taskId": "TASK-01",
        }
        (machine / "work.json").write_text(
            json.dumps(
                {
                    "declarations": {
                        "older-invalid": declaration,
                        "newer-valid": valid_declaration,
                    }
                }
            ),
            encoding="utf-8",
        )
        (local_dev / "dev-work.mjs").write_text(
            "console.log("
            + json.dumps(
                json.dumps(
                    {
                        "declarations": [
                            declaration,
                            valid_declaration,
                        ]
                    }
                )
            )
            + ");\n",
            encoding="utf-8",
        )
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/agent-integration-audit.py",
                "--root",
                str(self.root),
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("audit-session"),
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        findings = json.loads(audit.stdout)["workflowIdentity"][
            "identityFindings"
        ]
        self.assertIn("declaration-plan-locator-missing", findings)
        self.assertIn("declaration-current-task-mismatch", findings)
        self.assertNotIn("binding-canonical-mismatch", findings)
        self.assertEqual(
            json.loads(audit.stdout)["workflowIdentity"][
                "activeDeclaration"
            ]["workItemId"],
            "WORK-02",
        )


if __name__ == "__main__":
    unittest.main()
