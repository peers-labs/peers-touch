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
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
REQUIRED_SKILLS = (
    "pt-goal-orchestrator",
    "pt-trae-host-adapter",
    "pt-cursor-host-adapter",
    "pt-codex-host-adapter",
)
RECEIPT_KEYS = {
    "kind",
    "state",
    "workspaceId",
    "branch",
    "sourceHead",
    "host",
    "installedAt",
    "catalogDigest",
    "catalogEntryCount",
    "catalogGitState",
    "catalogStatusDigest",
}


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
        (self.root / "Makefile").write_text(
            "include tooling/make/setup.mk\n",
            encoding="utf-8",
        )
        for name in REQUIRED_SKILLS:
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
                                    for name in REQUIRED_SKILLS
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

    def environment(self) -> dict[str, str]:
        return {
            **os.environ,
            "PT_MACHINE_DEV_ROOT": str(self.root / "machine"),
        }

    def install(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["make", "skills", "IDE=codex"],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )

    def audit(self, host: str | None = "codex") -> subprocess.CompletedProcess[str]:
        command = [
            "python3",
            "tooling/scripts/skill-rollout-audit.py",
            "--root",
            str(self.root),
        ]
        if host is not None:
            command.extend(["--host", host])
        return subprocess.run(
            command,
            cwd=self.root,
            capture_output=True,
            text=True,
            env=self.environment(),
            check=False,
        )

    def receipt(self) -> Path:
        return next(
            (self.root / "machine/workspaces").glob(
                "*/workflow/skill-rollout.json"
            )
        )

    def test_install_is_out_of_band_and_requires_no_session_ack(self) -> None:
        legacy = self.root / ".agents/skills/pt-trae-goal-orchestrator"
        legacy.mkdir(parents=True)
        (legacy / "SKILL.md").write_text("legacy\n", encoding="utf-8")
        machine = self.root / "machine"
        machine.mkdir()
        workspace_id = hashlib.sha256(
            str(self.root.resolve()).encode()
        ).hexdigest()[:16]
        (machine / "work.json").write_text(
            json.dumps(
                {
                    "declarations": {
                        "active": {
                            "workspaceId": workspace_id,
                            "state": "ACTIVE",
                            "workItemId": "WORK-01",
                        }
                    }
                }
            ),
            encoding="utf-8",
        )

        completed = self.install()

        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn('"status": "INSTALLED"', completed.stdout)
        self.assertFalse(legacy.exists())
        self.assertEqual(
            len(
                list(
                    (self.root / ".agents/retired-project-skills").glob(
                        "pt-trae-goal-orchestrator.*"
                    )
                )
            ),
            1,
        )
        for name in REQUIRED_SKILLS:
            self.assertTrue((self.root / ".agents/skills" / name).is_symlink())

        receipt = json.loads(self.receipt().read_text(encoding="utf-8"))
        self.assertEqual(set(receipt), RECEIPT_KEYS)
        self.assertEqual(receipt["state"], "INSTALLED")
        (machine / "work.json").unlink()
        audit = self.audit()
        self.assertEqual(audit.returncode, 0, audit.stdout + audit.stderr)
        self.assertEqual(json.loads(audit.stdout)["status"], "PASS")

    def test_receipt_shape_identity_state_and_timestamp_fail_closed(self) -> None:
        self.assertEqual(self.install().returncode, 0)
        receipt_path = self.receipt()
        original = json.loads(receipt_path.read_text(encoding="utf-8"))
        mutations = (
            (
                "extra-field",
                {**original, "schemaVersion": 1},
                "receipt-fields-invalid",
            ),
            ("wrong-state", {**original, "state": "PENDING"}, "state-mismatch"),
            ("wrong-branch", {**original, "branch": "other"}, "branch-mismatch"),
            (
                "bad-installed-at",
                {**original, "installedAt": "not-a-time"},
                "installed-at-invalid",
            ),
        )
        for name, value, expected in mutations:
            with self.subTest(name=name):
                receipt_path.write_text(json.dumps(value), encoding="utf-8")
                audit = self.audit()
                self.assertEqual(audit.returncode, 2)
                self.assertIn(f"rollout-{expected}", audit.stdout)

    def test_install_and_audit_reject_projection_escape_or_wrong_target(self) -> None:
        external = self.root / "external"
        external.mkdir()
        (self.root / ".agents").symlink_to(external, target_is_directory=True)
        completed = self.install()
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
        completed = self.install()
        self.assertEqual(completed.returncode, 2)
        self.assertIn("HOST_PROJECTION_ESCAPE", completed.stdout)
        shutil.rmtree(self.root / ".agents")

        self.assertEqual(self.install().returncode, 0)
        projected = self.root / ".agents/skills/pt-goal-orchestrator"
        projected.unlink()
        projected.symlink_to(self.root / "tooling/skills/pt-codex-host-adapter")
        audit = self.audit()
        self.assertEqual(audit.returncode, 2)
        self.assertIn("wrong-project-skill-target", audit.stdout)

    def test_install_rejects_canonical_skill_source_symlink(self) -> None:
        source = self.root / "tooling/skills/pt-goal-orchestrator"
        shutil.rmtree(source)
        external = self.root / "external-skill"
        external.mkdir()
        (external / "SKILL.md").write_text("external\n", encoding="utf-8")
        source.symlink_to(external, target_is_directory=True)

        completed = self.install()

        self.assertEqual(completed.returncode, 2)
        self.assertIn("CANONICAL_SKILL_SOURCE_INVALID", completed.stdout)
        audit = self.audit(host=None)
        self.assertEqual(audit.returncode, 2)
        self.assertIn("canonical-source-symlink", audit.stdout)

    def test_audit_binds_recursive_dirty_skill_catalog(self) -> None:
        nested = self.root / "tooling/skills/pt-goal-orchestrator/references"
        nested.mkdir()
        content = nested / "contract.md"
        content.write_text("initial\n", encoding="utf-8")
        self.assertEqual(self.install().returncode, 0)
        content.write_text("changed\n", encoding="utf-8")

        audit = self.audit()

        self.assertEqual(audit.returncode, 2)
        findings = json.loads(audit.stdout)["rolloutReceipt"]["findings"]
        self.assertIn("rollout-catalogDigest-mismatch", findings)
        self.assertNotIn("rollout-catalogStatusDigest-mismatch", findings)

    def test_audit_propagates_registry_failures(self) -> None:
        registry = self.root / "tooling/acceptance/registry.yaml"
        registry.write_text("not-json\n", encoding="utf-8")
        audit = self.audit(host=None)
        self.assertEqual(audit.returncode, 2)
        self.assertEqual(
            json.loads(audit.stdout)["acceptanceRegistry"]["error"],
            "registry-not-json",
        )

        registry.unlink()
        audit = self.audit(host=None)
        self.assertEqual(audit.returncode, 2)
        self.assertEqual(
            json.loads(audit.stdout)["acceptanceRegistry"]["error"],
            "registry-missing",
        )

        registry.write_text('{"version":1,"rules":[]}\n', encoding="utf-8")
        audit = self.audit(host=None)
        self.assertEqual(audit.returncode, 2)
        self.assertEqual(
            json.loads(audit.stdout)["acceptanceRegistry"][
                "missingCanonicalMatchers"
            ],
            list(REQUIRED_SKILLS),
        )

        registry.write_text(
            json.dumps({"version": 999, "rules": []}) + "\n",
            encoding="utf-8",
        )
        audit = self.audit(host=None)
        self.assertEqual(audit.returncode, 2)
        self.assertEqual(
            json.loads(audit.stdout)["acceptanceRegistry"]["error"],
            "registry-schema-invalid",
        )

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

        audit = self.audit(host=None)

        self.assertEqual(audit.returncode, 2)
        self.assertIn("binding-canonical-invalid", audit.stdout)

    def test_legacy_scan_ignores_foreign_plans_but_checks_explicit_paths(self) -> None:
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
        (local_dev / "dev-work.mjs").write_text(
            "console.log("
            + json.dumps(json.dumps({"declarations": [declaration]}))
            + ");\n",
            encoding="utf-8",
        )
        (machine / "work.json").write_text(
            json.dumps({"declarations": {"invalid": declaration}}),
            encoding="utf-8",
        )

        audit = self.audit(host=None)

        self.assertEqual(audit.returncode, 2)
        findings = json.loads(audit.stdout)["workflowIdentity"][
            "identityFindings"
        ]
        self.assertIn("declaration-plan-locator-missing", findings)
        self.assertIn("declaration-current-task-mismatch", findings)

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
