import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]


def load_rollout_control():
    path = REPO_ROOT / "tooling/scripts/skill-rollout-control.py"
    spec = importlib.util.spec_from_file_location("skill_rollout_control", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_rollout_audit():
    path = REPO_ROOT / "tooling/scripts/skill-rollout-audit.py"
    spec = importlib.util.spec_from_file_location("skill_rollout_audit", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SkillRolloutTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / ".git").mkdir()
        (self.root / "tooling/make").mkdir(parents=True)
        (self.root / "tooling/scripts").mkdir(parents=True)
        shutil.copy2(
            REPO_ROOT / "tooling/make/setup.mk",
            self.root / "tooling/make/setup.mk",
        )
        for name in (
            "install-project-skills.sh",
            "skill-rollout-audit.py",
            "skill-rollout-control.py",
        ):
            shutil.copy2(
                REPO_ROOT / "tooling/scripts" / name,
                self.root / "tooling/scripts" / name,
            )
        ledger_validator = (
            self.root / "tooling/scripts/local-dev/dev-work-ledger.mjs"
        )
        ledger_validator.parent.mkdir(parents=True)
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
""".lstrip(),
            encoding="utf-8",
        )
        (self.root / "Makefile").write_text(
            "include tooling/make/setup.mk\n", encoding="utf-8"
        )
        for name in (
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

    def environment(self, session: str) -> dict[str, str]:
        environment = {
            **os.environ,
            "PT_MACHINE_DEV_ROOT": str(self.root / "machine"),
            "PT_AGENT_SESSION_ID": session,
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

    def test_atomic_lock_capture_declares_windows_no_replace(self) -> None:
        control = (
            REPO_ROOT / "tooling/scripts/skill-rollout-control.py"
        ).read_text(encoding="utf-8")
        ledger = (
            REPO_ROOT / "tooling/scripts/local-dev/dev-work-ledger.mjs"
        ).read_text(encoding="utf-8")
        for source in (control, ledger):
            self.assertIn("MoveFileExW", source)
            self.assertIn("0x00000008", source)

    def test_windows_atomic_lock_capture_uses_no_replace_semantics(self) -> None:
        module = load_rollout_control()
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

    def test_noninteractive_codex_install_retires_real_legacy_directory(self) -> None:
        legacy = self.root / ".agents/skills/pt-trae-goal-orchestrator"
        legacy.mkdir(parents=True)
        (legacy / "SKILL.md").write_text("legacy\n", encoding="utf-8")
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

        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/skill-rollout-audit.py",
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
        self.assertEqual(audit.returncode, 2, audit.stderr)
        self.assertEqual(
            json.loads(audit.stdout)["rolloutReceipt"]["findings"],
            ["rollout-restart-required"],
        )
        acknowledged = subprocess.run(
            ["make", "skill-rollout-ack", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=environment,
            check=False,
        )
        self.assertEqual(acknowledged.returncode, 2, acknowledged.stderr)
        self.assertIn("ROLLOUT_RESTART_NOT_OBSERVED", acknowledged.stdout)
        ambiguous_environment = self.environment("installing-session")
        ambiguous_environment["CODEX_SESSION_ID"] = "different-session"
        acknowledged = subprocess.run(
            ["make", "skill-rollout-ack", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=ambiguous_environment,
            check=False,
        )
        self.assertEqual(acknowledged.returncode, 2, acknowledged.stderr)
        self.assertIn("HOST_SESSION_ID_AMBIGUOUS", acknowledged.stdout)
        renamed_environment = self.environment("unused-session")
        renamed_environment.pop("PT_AGENT_SESSION_ID")
        renamed_environment["CODEX_SESSION_ID"] = "installing-session"
        acknowledged = subprocess.run(
            ["make", "skill-rollout-ack", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=renamed_environment,
            check=False,
        )
        self.assertEqual(acknowledged.returncode, 2, acknowledged.stderr)
        self.assertIn("ROLLOUT_RESTART_NOT_OBSERVED", acknowledged.stdout)
        restarted_environment = self.environment("restarted-session")
        acknowledged = subprocess.run(
            ["make", "skill-rollout-ack", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=restarted_environment,
            check=False,
        )
        self.assertEqual(acknowledged.returncode, 0, acknowledged.stderr)
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/skill-rollout-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=restarted_environment,
            check=False,
        )
        self.assertEqual(audit.returncode, 0, audit.stdout + audit.stderr)
        self.assertEqual(json.loads(audit.stdout)["status"], "PASS")
        receipt = next(
            (self.root / "machine/workspaces").glob(
                "*/workflow/skill-rollout.json"
            )
        )
        receipt_value = json.loads(receipt.read_text(encoding="utf-8"))
        self.assertNotIn("schemaVersion", receipt_value)
        receipt_value["schemaVersion"] = 3
        receipt.write_text(json.dumps(receipt_value), encoding="utf-8")
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/skill-rollout-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=restarted_environment,
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertIn("rollout-receipt-fields-invalid", audit.stdout)
        receipt_value.pop("schemaVersion")
        receipt_value["branch"] = "other-branch"
        receipt.write_text(json.dumps(receipt_value), encoding="utf-8")
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/skill-rollout-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=restarted_environment,
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertIn("rollout-branch-mismatch", audit.stdout)
        receipt_value["branch"] = "main"
        receipt_value.pop("installedAt")
        receipt.write_text(json.dumps(receipt_value), encoding="utf-8")
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/skill-rollout-audit.py",
                "--root",
                str(self.root),
                "--host",
                "codex",
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=restarted_environment,
            check=False,
        )
        self.assertEqual(audit.returncode, 2)
        self.assertIn("rollout-restart-evidence-invalid", audit.stdout)

    def test_install_rejects_every_live_worktree_declaration(self) -> None:
        machine = self.root / "machine"
        machine.mkdir()
        workspace_id = hashlib.sha256(
            str(self.root.resolve()).encode()
        ).hexdigest()[:16]
        for state in ("DECLARED", "ACTIVE", "RELEASING"):
            with self.subTest(state=state):
                (machine / "work.json").write_text(
                    json.dumps(
                        {
                            "declarations": {
                                "active": {
                                    "workspaceId": workspace_id,
                                    "state": state,
                                    "workItemId": "WORK-01",
                                    "heartbeatAt": "2026-09-19T00:00:00.000Z",
                                }
                            }
                        }
                    ),
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
                self.assertIn("ACTIVE_ACTION_IN_FLIGHT", completed.stdout)
                self.assertFalse(
                    (self.root / ".agents/skills/pt-goal-orchestrator").exists()
                )

    def test_ack_rejects_a_versioned_rollout_receipt(self) -> None:
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
                "*/workflow/skill-rollout.json"
            )
        )
        value = json.loads(receipt.read_text(encoding="utf-8"))
        value["schemaVersion"] = 3
        receipt.write_text(json.dumps(value), encoding="utf-8")

        acknowledged = subprocess.run(
            ["make", "skill-rollout-ack", "IDE=codex"],
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment("restarted-session"),
            check=False,
        )
        self.assertEqual(acknowledged.returncode, 2)
        self.assertIn("ROLLOUT_ACK_MISMATCH", acknowledged.stdout)

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
                "tooling/scripts/skill-rollout-audit.py",
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
                "tooling/scripts/skill-rollout-audit.py",
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
        environment["PT_SKILL_ROLLOUT_LOCK_TIMEOUT_SECONDS"] = "0.05"
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
        environment["PT_SKILL_ROLLOUT_LOCK_TIMEOUT_SECONDS"] = "0.05"
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

    def test_audit_binds_recursive_dirty_skill_catalog(self) -> None:
        nested = self.root / "tooling/skills/pt-goal-orchestrator/references"
        nested.mkdir()
        content = nested / "contract.md"
        content.write_text("version one\n", encoding="utf-8")
        installing = self.environment("installing-session")
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
                "tooling/scripts/skill-rollout-audit.py",
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
        findings = json.loads(audit.stdout)["rolloutReceipt"]["findings"]
        self.assertIn("rollout-catalogDigest-mismatch", findings)
        self.assertNotIn("rollout-catalogStatusDigest-mismatch", findings)

    def test_audit_propagates_registry_parse_failure(self) -> None:
        registry = self.root / "tooling/acceptance/registry.yaml"
        registry.write_text("not-json\n", encoding="utf-8")
        audit = subprocess.run(
            [
                "python3",
                "tooling/scripts/skill-rollout-audit.py",
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
                "tooling/scripts/skill-rollout-audit.py",
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
                "tooling/scripts/skill-rollout-audit.py",
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
                "tooling/scripts/skill-rollout-audit.py",
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
            4,
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
                "tooling/scripts/skill-rollout-audit.py",
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
                "tooling/scripts/skill-rollout-audit.py",
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
                "tooling/scripts/skill-rollout-audit.py",
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

    def test_legacy_scan_ignores_foreign_plans_but_checks_bound_plan(self) -> None:
        module = load_rollout_audit()
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
            "schemaVersion": 1,
            "kind": "peers-touch-workspace-plan-binding",
            "workspaceId": workspace_id,
            "canonicalRoot": str(self.root.resolve()),
            "planId": "PLAN-01",
            "planPath": "plan.md",
            "boundAt": "2026-09-19T00:00:00.000Z",
            "boundBy": "test",
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
        plan_scripts.mkdir()
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
                "tooling/scripts/skill-rollout-audit.py",
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
        self.assertEqual(
            json.loads(audit.stdout)["workflowIdentity"][
                "activeDeclaration"
            ]["workItemId"],
            "WORK-02",
        )

    def test_blocked_plan_accepts_its_blocked_task_locator(self) -> None:
        module = load_rollout_audit()
        machine = self.root / "machine"
        workspace_id = hashlib.sha256(
            str(self.root.resolve()).encode()
        ).hexdigest()[:16]
        branch = "main"
        head = "a" * 40
        binding = {
            "schemaVersion": 1,
            "kind": "peers-touch-workspace-plan-binding",
            "workspaceId": workspace_id,
            "canonicalRoot": str(self.root.resolve()),
            "planId": "PLAN-01",
            "planPath": "plan.md",
            "boundAt": "2026-09-19T00:00:00.000Z",
            "boundBy": "test",
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
        (machine / "work.json").write_text(
            json.dumps({"declarations": {}}),
            encoding="utf-8",
        )
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
            "planId": "PLAN-01",
            "planPath": "plan.md",
            "taskId": "TASK-01",
        }
        status = {
            "status": "blocked",
            "currentTaskId": None,
            "taskStatuses": {"TASK-01": "blocked"},
        }
        manifest = {
            "status": "blocked",
            "planId": "PLAN-01",
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

        def git_value(_root: Path, *args: str) -> str:
            return branch if args == ("branch", "--show-current") else head

        with mock.patch.object(module, "machine_dev_root", return_value=machine), \
            mock.patch.object(module, "git_value", side_effect=git_value), \
            mock.patch.object(module, "resolved_plan_binding", return_value=binding), \
            mock.patch.object(module, "validated_plan_status", return_value=status), \
            mock.patch.object(module, "structured_plan", return_value=manifest), \
            mock.patch.object(module, "validated_work_ledger", return_value=[declaration]):
            identity = module.workflow_identity(self.root)

        self.assertNotIn(
            "declaration-current-task-mismatch",
            identity["identityFindings"],
        )
        self.assertEqual(identity["activeDeclaration"]["taskId"], "TASK-01")


if __name__ == "__main__":
    unittest.main()
