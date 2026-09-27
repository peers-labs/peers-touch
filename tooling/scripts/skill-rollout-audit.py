#!/usr/bin/env python3
"""Fail-closed host-neutral Skill rollout audit for one worktree."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path


REQUIRED_SKILLS = (
    "pt-goal-orchestrator",
    "pt-trae-host-adapter",
    "pt-cursor-host-adapter",
    "pt-codex-host-adapter",
)
LEGACY_SKILL = "pt-trae-goal-orchestrator"
CANONICAL_ROLLOUT_GATE = "acceptance-workflow-contract"
ROLLOUT_RECEIPT_KEYS = {
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
SCAN_ROOTS = (
    "AGENTS.md",
    "docs/global",
    "docs/architecture/development-workflow",
    "tooling",
)
HISTORICAL_MARKERS = (
    "The Development Workflow named `pt-trae-goal-orchestrator`",
    "The old `pt-trae-goal-orchestrator` source is deleted",
    "docs that route to `pt-trae-goal-orchestrator`",
    'pt-trae-goal-orchestrator|use `TRAE-debugger` workflow',
)
LEGACY_MIGRATION_SOURCES = {
    "tooling/make/setup.mk",
    "tooling/scripts/install-project-skills.sh",
    "tooling/scripts/skill-rollout-audit.py",
    "tooling/scripts/skill-rollout-audit-test.py",
    "tooling/scripts/skill-rollout-control.py",
    "tooling/scripts/review/skill-check.sh",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--host", choices=("trae", "cursor", "codex"))
    parser.add_argument("--all-worktrees", action="store_true")
    return parser.parse_args()


def text_files(root: Path, extra_paths: tuple[str, ...] = ()):
    seen: set[Path] = set()
    for item in (*SCAN_ROOTS, *extra_paths):
        path = root / item
        if path.is_file():
            resolved = path.resolve()
            if resolved not in seen:
                seen.add(resolved)
                yield path
        elif path.is_dir():
            for candidate in path.rglob("*"):
                if (
                    candidate.is_file()
                    and ".git" not in candidate.parts
                    and "archive" not in candidate.parts
                    and candidate.suffix
                    in {".md", ".json", ".yaml", ".yml", ".py", ".mjs", ".sh"}
                    and candidate.resolve() not in seen
                ):
                    seen.add(candidate.resolve())
                    yield candidate


def legacy_references(
    root: Path,
    extra_paths: tuple[str, ...] = (),
) -> list[dict[str, object]]:
    findings: list[dict[str, object]] = []
    for path in text_files(root, extra_paths):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(lines, 1):
            if LEGACY_SKILL not in line:
                continue
            relative = path.relative_to(root).as_posix()
            if relative in LEGACY_MIGRATION_SOURCES or "rg -n" in line:
                continue
            if any(marker in line for marker in HISTORICAL_MARKERS):
                continue
            findings.append(
                {
                    "path": relative,
                    "line": number,
                    "text": line.strip()[:240],
                }
            )
    return findings


def host_projection_findings(
    root: Path,
    required_host: str | None,
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    canonical_names = sorted(
        item.name
        for item in (root / "tooling" / "skills").glob("pt-*")
        if item.is_dir() and (item / "SKILL.md").is_file()
    )
    expected_relative = (
        ".agents/skills"
        if required_host == "codex"
        else f".{required_host}/skills"
        if required_host
        else None
    )
    if expected_relative is not None and not (root / expected_relative).exists():
        findings.append(
            {"path": expected_relative, "issue": "host-projection-missing"}
        )
    for relative in (".trae/skills", ".cursor/skills", ".agents/skills"):
        skills = root / relative
        host_root = skills.parent
        if host_root.is_symlink():
            findings.append({"path": relative, "issue": "host-projection-escape"})
            continue
        retired_root = host_root / "retired-project-skills"
        if retired_root.is_symlink():
            findings.append({"path": relative, "issue": "retired-root-escape"})
        if not skills.exists():
            continue
        if skills.is_symlink():
            findings.append({"path": relative, "issue": "host-projection-escape"})
            continue
        legacy = skills / LEGACY_SKILL
        if legacy.exists() or legacy.is_symlink():
            findings.append({"path": relative, "issue": "legacy-skill-visible"})
        project_projection_present = any(
            (skills / name).exists() or (skills / name).is_symlink()
            for name in REQUIRED_SKILLS
        )
        if not project_projection_present and relative != expected_relative:
            continue
        for name in canonical_names:
            projected = skills / name
            expected = root / "tooling" / "skills" / name
            if not projected.is_symlink() or not projected.exists():
                findings.append(
                    {"path": relative, "issue": f"missing-project-skill:{name}"}
                )
            elif projected.resolve(strict=True) != expected.resolve(strict=True):
                findings.append(
                    {"path": relative, "issue": f"wrong-project-skill-target:{name}"}
                )
    return findings


def canonical_source_findings(root: Path) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    source_root = root / "tooling" / "skills"
    expected_root = root.resolve(strict=True) / "tooling" / "skills"
    if (
        source_root.is_symlink()
        or not source_root.is_dir()
        or source_root.resolve(strict=True) != expected_root
    ):
        return [{"path": "tooling/skills", "issue": "canonical-source-symlink"}]
    for item in sorted(source_root.glob("pt-*")):
        skill = item / "SKILL.md"
        if item.is_symlink() or skill.is_symlink():
            findings.append(
                {
                    "path": item.relative_to(root).as_posix(),
                    "issue": "canonical-source-symlink",
                }
            )
            continue
        if item.is_dir():
            for candidate in item.rglob("*"):
                if candidate.is_symlink():
                    findings.append(
                        {
                            "path": candidate.relative_to(root).as_posix(),
                            "issue": "canonical-source-symlink",
                        }
                    )
    return findings


def canonical_skill_catalog(root: Path) -> dict[str, object]:
    source_root = root / "tooling" / "skills"
    findings = canonical_source_findings(root)
    if findings or not source_root.is_dir():
        return {
            "status": "BLOCKED",
            "findings": findings or [
                {"path": "tooling/skills", "issue": "canonical-source-missing"}
            ],
        }
    entries: list[dict[str, object]] = []
    for item in sorted(source_root.glob("pt-*")):
        if not item.is_dir() or not (item / "SKILL.md").is_file():
            continue
        for candidate in sorted(item.rglob("*")):
            if not candidate.is_file():
                continue
            content = candidate.read_bytes()
            entries.append(
                {
                    "path": candidate.relative_to(source_root).as_posix(),
                    "mode": candidate.stat().st_mode & 0o777,
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            )
    serialized = json.dumps(
        entries,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    status = subprocess.run(
        [
            "git",
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--",
            "tooling/skills",
        ],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout
    return {
        "status": "PASS",
        "findings": [],
        "catalogDigest": hashlib.sha256(serialized).hexdigest(),
        "catalogEntryCount": len(entries),
        "catalogGitState": "CLEAN" if not status else "DIRTY",
        "catalogStatusDigest": hashlib.sha256(status).hexdigest(),
    }


def git_value(root: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", *arguments],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    return completed.stdout.strip()


def machine_dev_root() -> Path:
    override = os.environ.get("PT_MACHINE_DEV_ROOT", "").strip()
    return Path(override) if override else Path.home() / ".peers-touch" / "dev"


def structured_plan(plan_path: Path) -> dict[str, object]:
    if not plan_path.is_file():
        return {}
    content = plan_path.read_text(encoding="utf-8")
    match = re.search(
        r"## Plan Package\s+```json\s+(\{.*?\})\s+```",
        content,
        flags=re.DOTALL,
    )
    return json.loads(match.group(1)) if match else {}


def validated_plan_status(root: Path, plan_path: Path) -> dict[str, object]:
    completed = subprocess.run(
        [
            "node",
            "tooling/scripts/plan/planctl.mjs",
            "status",
            "--plan",
            str(plan_path),
            "--repo-root",
            str(root),
        ],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            completed.stderr.strip()
            or completed.stdout.strip()
            or "canonical Plan validation failed"
        )
    value = json.loads(completed.stdout)
    if not isinstance(value, dict) or value.get("ok") is not True:
        raise RuntimeError("canonical Plan validator returned an invalid result")
    return value


def resolved_plan_binding(root: Path) -> dict[str, object]:
    completed = subprocess.run(
        [
            "node",
            "tooling/scripts/plan/workspace-plan-binding.mjs",
            "resolve",
            "--repo-root",
            str(root),
        ],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            completed.stderr.strip()
            or completed.stdout.strip()
            or "canonical binding resolution failed"
        )
    value = json.loads(completed.stdout)
    binding = value.get("binding") if isinstance(value, dict) else None
    if value.get("ok") is not True or not isinstance(binding, dict):
        raise RuntimeError("canonical binding resolver returned an invalid result")
    return {
        key: binding.get(key)
        for key in (
            "schemaVersion",
            "kind",
            "workspaceId",
            "canonicalRoot",
            "planId",
            "planPath",
            "boundAt",
            "boundBy",
        )
    }


def validated_work_ledger(root: Path) -> list[dict[str, object]]:
    completed = subprocess.run(
        ["node", "tooling/scripts/local-dev/dev-work.mjs", "status-all"],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            completed.stderr.strip()
            or completed.stdout.strip()
            or "canonical work ledger validation failed"
        )
    value = json.loads(completed.stdout)
    declarations = value.get("declarations") if isinstance(value, dict) else None
    if not isinstance(declarations, list):
        raise RuntimeError("canonical work ledger returned an invalid result")
    return [item for item in declarations if isinstance(item, dict)]


def workflow_identity(root: Path) -> dict[str, object]:
    canonical = Path(os.path.realpath(root))
    workspace_id = hashlib.sha256(str(canonical).encode()).hexdigest()[:16]
    branch = git_value(root, "branch", "--show-current")
    head = git_value(root, "rev-parse", "HEAD")
    binding_path = (
        machine_dev_root()
        / "workspaces"
        / workspace_id
        / "workflow"
        / "plan-binding.json"
    )
    binding = None
    binding_invalid = False
    if binding_path.is_file():
        try:
            binding = json.loads(binding_path.read_text(encoding="utf-8"))
            if not isinstance(binding, dict):
                binding = None
                binding_invalid = True
        except (OSError, json.JSONDecodeError):
            binding_invalid = True
    manifest: dict[str, object] = {}
    current_task = None
    plan_legacy_claims: list[str] = []
    findings: list[str] = []
    if binding_invalid:
        findings.append("binding-invalid")
    if binding is not None:
        try:
            canonical_binding = resolved_plan_binding(root)
            if canonical_binding != binding:
                findings.append("binding-canonical-mismatch")
        except (OSError, RuntimeError, json.JSONDecodeError):
            findings.append("binding-canonical-invalid")
        plan_path = root / str(binding.get("planPath") or "")
        try:
            status = validated_plan_status(root, plan_path)
            manifest = structured_plan(plan_path)
        except (OSError, RuntimeError, json.JSONDecodeError):
            status = {}
            manifest = {}
            findings.append("plan-validation-failed")
        scope = manifest.get("scope")
        claims = scope.get("sourceClaims", []) if isinstance(scope, dict) else []
        if not claims:
            findings.append("plan-source-claims-missing")
        plan_legacy_claims = [
            str(claim.get("pathPrefix"))
            for claim in claims
            if isinstance(claim, dict)
            and LEGACY_SKILL in str(claim.get("pathPrefix") or "")
        ]
        if plan_legacy_claims:
            findings.append("plan-legacy-skill-claim")
        current_task = status.get("currentTaskId")
        task_statuses = status.get("taskStatuses")
        if not isinstance(task_statuses, dict):
            task_statuses = {}
        if manifest.get("status") == "active" and current_task is None:
            findings.append("active-plan-current-task-missing")
        if binding.get("workspaceId") != workspace_id:
            findings.append("binding-workspace-mismatch")
        if manifest.get("planId") != binding.get("planId"):
            findings.append("binding-plan-mismatch")
        manifest_binding = manifest.get("binding")
        if not isinstance(manifest_binding, dict):
            findings.append("manifest-binding-missing")
        else:
            if manifest_binding.get("workspaceId") != workspace_id:
                findings.append("manifest-workspace-mismatch")
            if manifest_binding.get("branch") != branch:
                findings.append("manifest-branch-mismatch")
    ledger_path = machine_dev_root() / "work.json"
    declaration = None
    declaration_mode = "NONE"
    declaration_legacy_claims: list[str] = []
    if ledger_path.is_file():
        try:
            declarations = validated_work_ledger(root)
        except (OSError, RuntimeError, json.JSONDecodeError):
            declarations = []
            findings.append("work-ledger-invalid")
        candidates = [
            item
            for item in declarations
            if item.get("workspaceId") == workspace_id
            and item.get("state") in {"ACTIVE", "DECLARED", "RELEASING"}
        ]
        if candidates:
            declaration = max(candidates, key=lambda item: item.get("heartbeatAt", ""))
            for candidate in candidates:
                if candidate.get("branch") != branch:
                    findings.append("declaration-branch-mismatch")
                if candidate.get("sourceHead") != head:
                    findings.append("declaration-head-mismatch")
                if not candidate.get("sourceClaims"):
                    findings.append("declaration-source-claims-missing")
                legacy_claims = [
                    str(claim.get("pathPrefix"))
                    for claim in candidate.get("sourceClaims", [])
                    if isinstance(claim, dict)
                    and LEGACY_SKILL in str(claim.get("pathPrefix") or "")
                ]
                declaration_legacy_claims.extend(legacy_claims)
                if legacy_claims:
                    findings.append("declaration-legacy-skill-claim")
                locator = (
                    candidate.get("planId"),
                    candidate.get("planPath"),
                    candidate.get("taskId"),
                )
                if binding is None:
                    if any(value is not None for value in locator):
                        findings.append("unbound-declaration-plan-locator")
                    else:
                        declaration_mode = "UNTRACKED_PRE_PLAN"
                else:
                    declaration_mode = "TRACKED"
                    if not all(
                        isinstance(value, str) and bool(value)
                        for value in locator
                    ):
                        findings.append("declaration-plan-locator-missing")
                    declared_task_status = task_statuses.get(
                        candidate.get("taskId")
                    )
                    task_matches_lifecycle = (
                        candidate.get("taskId") == current_task
                        or (
                            manifest.get("status") == "completed"
                            and declared_task_status == "done"
                        )
                        or (
                            manifest.get("status") == "blocked"
                            and declared_task_status == "blocked"
                        )
                    )
                    if not task_matches_lifecycle:
                        findings.append("declaration-current-task-mismatch")
                    if (
                        candidate.get("planId") != binding.get("planId")
                        or candidate.get("planPath") != binding.get("planPath")
                    ):
                        findings.append("declaration-plan-mismatch")
    return {
        "branch": branch,
        "workspaceId": workspace_id,
        "head": head,
        "expectedHead": declaration.get("sourceHead") if declaration else head,
        "activeDeclaration": (
            {
                "workItemId": declaration.get("workItemId"),
                "state": declaration.get("state"),
                "taskId": declaration.get("taskId"),
            }
            if declaration
            else None
        ),
        "declarationMode": declaration_mode,
        "planBinding": binding,
        "planStatus": manifest.get("status"),
        "currentTaskId": current_task,
        "planLegacyClaims": plan_legacy_claims,
        "declarationLegacyClaims": declaration_legacy_claims,
        "identityFindings": findings,
    }


def acceptance_registry(root: Path) -> dict[str, object]:
    path = root / "tooling" / "acceptance" / "registry.yaml"
    if not path.is_file():
        return {
            "status": "BLOCKED",
            "legacyMatchers": [],
            "canonicalMatchers": [],
            "missingCanonicalMatchers": list(REQUIRED_SKILLS),
            "error": "registry-missing",
        }
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {
            "status": "BLOCKED",
            "legacyMatchers": [],
            "canonicalMatchers": [],
            "error": "registry-not-json",
        }
    rules = value.get("rules") if isinstance(value, dict) else None
    if (
        not isinstance(value, dict)
        or set(value) != {"version", "rules"}
        or value.get("version") != 1
        or not isinstance(rules, list)
    ):
        return {
            "status": "BLOCKED",
            "legacyMatchers": [],
            "canonicalMatchers": [],
            "missingCanonicalMatchers": list(REQUIRED_SKILLS),
            "error": "registry-schema-invalid",
        }
    matchers: list[str] = []
    canonical_with_gate: set[str] = set()
    expected_matchers = {
        name: f"tooling/skills/{name}/**"
        for name in REQUIRED_SKILLS
    }
    for rule in rules:
        when = rule.get("when") if isinstance(rule, dict) else None
        paths = when.get("paths") if isinstance(when, dict) else None
        if not isinstance(paths, list) or any(
            not isinstance(item, str) for item in paths
        ):
            return {
                "status": "BLOCKED",
                "legacyMatchers": [],
                "canonicalMatchers": [],
                "missingCanonicalMatchers": list(REQUIRED_SKILLS),
                "error": "registry-path-matchers-invalid",
            }
        matchers.extend(paths)
        required = rule.get("require") if isinstance(rule, dict) else None
        if not isinstance(required, list) or any(
            not isinstance(item, str) for item in required
        ):
            return {
                "status": "BLOCKED",
                "legacyMatchers": [],
                "canonicalMatchers": [],
                "missingCanonicalMatchers": list(REQUIRED_SKILLS),
                "error": "registry-require-invalid",
            }
        if CANONICAL_ROLLOUT_GATE in required:
            canonical_with_gate.update(paths)
    legacy = sorted({item for item in matchers if LEGACY_SKILL in item})
    canonical = sorted(
        item
        for item in canonical_with_gate
        if item in expected_matchers.values()
    )
    missing_canonical = [
        name
        for name in REQUIRED_SKILLS
        if expected_matchers[name] not in canonical
    ]
    return {
        "status": "BLOCKED" if legacy or missing_canonical else "PASS",
        "legacyMatchers": legacy,
        "canonicalMatchers": canonical,
        "missingCanonicalMatchers": missing_canonical,
    }


def rollout_receipt(
    identity: dict[str, object],
    host: str | None,
    catalog: dict[str, object],
) -> dict[str, object]:
    if host is None:
        return {"status": "NOT_REQUESTED", "findings": []}
    path = (
        machine_dev_root()
        / "workspaces"
        / str(identity["workspaceId"])
        / "workflow"
        / "skill-rollout.json"
    )
    if not path.is_file():
        return {
            "status": "BLOCKED",
            "findings": ["rollout-receipt-missing"],
            "path": str(path),
        }
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {
            "status": "BLOCKED",
            "findings": ["rollout-receipt-invalid"],
            "path": str(path),
        }
    if not isinstance(value, dict):
        return {
            "status": "BLOCKED",
            "findings": ["rollout-receipt-invalid"],
            "path": str(path),
        }
    findings = []
    if set(value) != ROLLOUT_RECEIPT_KEYS:
        findings.append("rollout-receipt-fields-invalid")
    installed_at = None
    try:
        installed_at = datetime.fromisoformat(
            str(value.get("installedAt")).replace("Z", "+00:00")
        )
    except ValueError:
        pass
    if value.get("kind") != "peers-touch-skill-rollout":
        findings.append("rollout-kind-mismatch")
    if value.get("state") != "INSTALLED":
        findings.append("rollout-state-mismatch")
    if value.get("host") != host:
        findings.append("rollout-host-mismatch")
    if value.get("workspaceId") != identity["workspaceId"]:
        findings.append("rollout-workspace-mismatch")
    if value.get("branch") != identity["branch"]:
        findings.append("rollout-branch-mismatch")
    if value.get("sourceHead") != identity["head"]:
        findings.append("rollout-head-mismatch")
    for field in (
        "catalogDigest",
        "catalogEntryCount",
        "catalogGitState",
        "catalogStatusDigest",
    ):
        if value.get(field) != catalog.get(field):
            findings.append(f"rollout-{field}-mismatch")
    if installed_at is None:
        findings.append("rollout-installed-at-invalid")
    return {
        "status": "PASS" if not findings else "BLOCKED",
        "findings": findings,
        "path": str(path),
        "receipt": value,
    }


def audit_root(root: Path, host: str | None = None) -> dict[str, object]:
    if not (root / ".git").exists():
        return {"root": str(root), "status": "BLOCKED", "error": "not-a-worktree"}
    missing = [
        name
        for name in REQUIRED_SKILLS
        if not (root / "tooling" / "skills" / name / "SKILL.md").is_file()
    ]
    legacy_source = root / "tooling" / "skills" / LEGACY_SKILL
    identity = workflow_identity(root)
    binding = identity.get("planBinding")
    bound_plan_paths = (
        (str(binding["planPath"]),)
        if isinstance(binding, dict) and isinstance(binding.get("planPath"), str)
        else ()
    )
    catalog = canonical_skill_catalog(root)
    report = {
        "root": str(root),
        "status": "PASS",
        "missingCanonicalSkills": missing,
        "canonicalSourceFindings": catalog["findings"],
        "canonicalCatalog": catalog,
        "legacySourcePresent": legacy_source.exists(),
        "legacyReferences": legacy_references(root, bound_plan_paths),
        "host": host,
        "hostProjectionFindings": host_projection_findings(root, host),
        "workflowIdentity": identity,
        "acceptanceRegistry": acceptance_registry(root),
        "rolloutReceipt": rollout_receipt(identity, host, catalog),
    }
    if (
        missing
        or report["canonicalCatalog"]["status"] == "BLOCKED"
        or report["legacySourcePresent"]
        or report["legacyReferences"]
        or report["hostProjectionFindings"]
        or report["workflowIdentity"]["identityFindings"]
        or report["acceptanceRegistry"]["status"] == "BLOCKED"
        or report["rolloutReceipt"]["findings"]
    ):
        report["status"] = "BLOCKED"
    return report


def worktree_roots(root: Path) -> list[Path]:
    completed = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    return [
        Path(line.removeprefix("worktree "))
        for line in completed.stdout.splitlines()
        if line.startswith("worktree ")
    ]


def main() -> int:
    options = parse_args()
    root = Path(os.path.realpath(os.path.abspath(options.root)))
    if options.all_worktrees:
        reports = [audit_root(item, options.host) for item in worktree_roots(root)]
        payload = {
            "status": (
                "PASS"
                if reports and all(item["status"] == "PASS" for item in reports)
                else "BLOCKED"
            ),
            "worktrees": reports,
        }
    else:
        payload = audit_root(root, options.host)
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if payload["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
