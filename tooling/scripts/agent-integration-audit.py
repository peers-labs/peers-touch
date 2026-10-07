#!/usr/bin/env python3
"""Fail-closed host-neutral agent integration audit for one worktree."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
from datetime import datetime
from functools import lru_cache
from pathlib import Path


REQUIRED_SKILLS = (
    "pt-goal-orchestrator",
    "pt-trae-host-adapter",
    "pt-cursor-host-adapter",
    "pt-codex-host-adapter",
)
LEGACY_SKILL = "pt-trae-goal-orchestrator"
PLUGIN_NAME = "pt-ew-plugin"
TRAE_HOOK_EVENTS = (
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
)
CURSOR_HOOK_EVENTS = (
    ("sessionStart", "sessionStart"),
    ("beforeSubmitPrompt", "beforeSubmitPrompt"),
    ("preToolUse", "preToolUse"),
    ("stop", "stop"),
)
WORKFLOW_KERNEL_FILES = (
    "tooling/scripts/architecture/module-governance.mjs",
    "tooling/scripts/local-dev/workflow-action-store.mjs",
    "tooling/scripts/local-dev/workflow-anchor.mjs",
    "tooling/scripts/local-dev/workflow-binding-projection.mjs",
    "tooling/scripts/local-dev/workflow-binding-store.mjs",
    "tooling/scripts/local-dev/workflow-binding.mjs",
    "tooling/scripts/local-dev/workflow-host-adapters.mjs",
    "tooling/scripts/local-dev/workflow-kernel.mjs",
    "tooling/scripts/local-dev/workflow-owner-command-policy.mjs",
    "tooling/scripts/local-dev/workflow-owner-reference.mjs",
    "tooling/scripts/local-dev/workflow-state-inspector.mjs",
    "tooling/scripts/local-dev/workflow-tool-intent.mjs",
)
CANONICAL_INTEGRATION_GATE = "acceptance-workflow-contract"
REQUIRED_INTEGRATION_MATCHERS = {
    **{
        name: f"tooling/skills/{name}/**"
        for name in REQUIRED_SKILLS
    },
    "pt-ew-plugin": "tooling/plugins/pt-ew-plugin/**",
    "workflow-kernel": "tooling/scripts/local-dev/workflow-*.mjs",
}
INTEGRATION_RECEIPT_KEYS = {
    "kind",
    "state",
    "operation",
    "workspaceId",
    "branch",
    "sourceHead",
    "host",
    "installedAt",
    "integrationDigest",
    "integrationEntryCount",
    "integrationGitState",
    "integrationStatusDigest",
    "callbackProof",
}
SCAN_ROOTS = (
    "AGENTS.md",
    "docs/global",
    "docs/architecture/engineering/development-workflow",
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
    "tooling/scripts/install-agent-integration.sh",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/review/skill-check.sh",
}


@lru_cache(maxsize=1)
def integration_control_module():
    path = Path(__file__).resolve().with_name("agent-integration-control.py")
    spec = importlib.util.spec_from_file_location(
        "agent_integration_control",
        path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("AGENT_INTEGRATION_CONTROL_INVALID")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--host", choices=("trae", "cursor", "codex"))
    parser.add_argument("--all-worktrees", action="store_true")
    parser.add_argument("--workspace")
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
    workspace: str | None = None,
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
    plugin = root / "tooling" / "plugins" / PLUGIN_NAME
    if required_host == "codex":
        projected = root / ".agents" / "plugins" / PLUGIN_NAME
        if not projected.is_symlink() or not projected.exists():
            findings.append(
                {
                    "path": ".agents/plugins",
                    "issue": f"missing-project-plugin:{PLUGIN_NAME}",
                }
            )
        elif projected.resolve(strict=True) != plugin.resolve(strict=True):
            findings.append(
                {
                    "path": ".agents/plugins",
                    "issue": f"wrong-project-plugin-target:{PLUGIN_NAME}",
                }
            )
    elif required_host == "cursor":
        hooks_path = root / ".cursor" / "hooks.json"
        try:
            hooks_value = json.loads(hooks_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            findings.append(
                {"path": ".cursor/hooks.json", "issue": "cursor-hooks-invalid"}
            )
        else:
            hooks = hooks_value.get("hooks")
            if (
                hooks_value.get("version") != 1
                or not isinstance(hooks, dict)
            ):
                findings.append(
                    {"path": ".cursor/hooks.json", "issue": "cursor-hooks-invalid"}
                )
            else:
                expected_script = str(
                    (plugin / "scripts" / "hook-entry.mjs").resolve(strict=True)
                )
                for cursor_event, host_event in CURSOR_HOOK_EVENTS:
                    entries = hooks.get(cursor_event)
                    expected = (
                        f'node "{expected_script}" --host cursor '
                        f'--event {host_event}'
                    )
                    managed = [
                        item
                        for item in entries
                        if isinstance(item, dict)
                        and item.get("command") == expected
                    ] if isinstance(entries, list) else []
                    valid = (
                        len(managed) == 1
                        and managed[0].get("failClosed") is True
                        and managed[0].get("timeout") == 5
                        and (
                            cursor_event != "preToolUse"
                            or managed[0].get("matcher") == "*"
                        )
                        and (
                            cursor_event != "stop"
                            or managed[0].get("loop_limit") == 8
                        )
                    )
                    if not valid:
                        findings.append(
                            {
                                "path": ".cursor/hooks.json",
                                "issue": f"managed-hook-invalid:{cursor_event}",
                            }
                        )
    elif required_host == "trae":
        try:
            control = integration_control_module()
            workspace_file, workspace_roots, bootstrap_root = (
                control.resolve_trae_workspace(root, workspace)
            )
        except Exception:
            findings.append(
                {
                    "path": ".trae/hooks.json",
                    "issue": "trae-workspace-bootstrap-invalid",
                }
            )
        else:
            projection_roots = set(
                control.trae_hook_projection_roots(
                    root,
                    workspace_roots,
                    bootstrap_root,
                )
            )
            for workspace_root in workspace_roots:
                hooks_path = workspace_root / ".trae" / "hooks.json"
                hook_label = (
                    ".trae/hooks.json"
                    if workspace_root == root
                    else str(hooks_path)
                )
                if not hooks_path.exists():
                    if workspace_root in projection_roots:
                        findings.append(
                            {
                                "path": hook_label,
                                "issue": "trae-hooks-invalid",
                            }
                        )
                    continue
                try:
                    hooks_value = json.loads(
                        hooks_path.read_text(encoding="utf-8")
                    )
                except (OSError, json.JSONDecodeError):
                    findings.append(
                        {
                            "path": hook_label,
                            "issue": "trae-hooks-invalid",
                        }
                    )
                    continue
                hooks = hooks_value.get("hooks")
                if not isinstance(hooks, dict):
                    findings.append(
                        {
                            "path": hook_label,
                            "issue": "trae-hooks-invalid",
                        }
                    )
                    continue
                for event in TRAE_HOOK_EVENTS:
                    entries = hooks.get(event)
                    managed = (
                        [
                            entry
                            for entry in entries
                            if control.is_managed_trae_hook_entry(entry)
                        ]
                        if isinstance(entries, list)
                        else []
                    )
                    expected = control.canonical_trae_hook_entry(
                        root,
                        event,
                        workspace_file,
                    )
                    valid = (
                        managed == [expected]
                        if workspace_root in projection_roots
                        else managed == []
                    )
                    if valid:
                        continue
                    findings.append(
                        {
                            "path": hook_label,
                            "issue": f"managed-hook-invalid:{event}",
                        }
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
    plugin = root / "tooling" / "plugins" / PLUGIN_NAME
    if plugin.is_symlink() or not plugin.is_dir():
        findings.append(
            {
                "path": f"tooling/plugins/{PLUGIN_NAME}",
                "issue": "canonical-plugin-invalid",
            }
        )
    else:
        for candidate in plugin.rglob("*"):
            if candidate.is_symlink():
                findings.append(
                    {
                        "path": candidate.relative_to(root).as_posix(),
                        "issue": "canonical-plugin-invalid",
                    }
                )
    return findings


def canonical_integration_catalog(root: Path) -> dict[str, object]:
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
                    "path": candidate.relative_to(root).as_posix(),
                    "mode": candidate.stat().st_mode & 0o777,
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            )
    plugin = root / "tooling" / "plugins" / PLUGIN_NAME
    required_plugin_files = (
        plugin / ".codex-plugin" / "plugin.json",
        plugin / "hooks.json",
        plugin / "scripts" / "hook-entry.mjs",
    )
    kernel_sources = [root / relative for relative in WORKFLOW_KERNEL_FILES]
    if (
        any(not candidate.is_file() for candidate in required_plugin_files)
        or any(source.is_symlink() or not source.is_file() for source in kernel_sources)
    ):
        return {
            "status": "BLOCKED",
            "findings": [
                {
                    "path": f"tooling/plugins/{PLUGIN_NAME}",
                    "issue": "canonical-integration-invalid",
                }
            ],
        }
    for candidate in sorted(plugin.rglob("*")):
        if not candidate.is_file():
            continue
        content = candidate.read_bytes()
        entries.append(
            {
                "path": candidate.relative_to(root).as_posix(),
                "mode": candidate.stat().st_mode & 0o777,
                "size": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    for source in kernel_sources:
        content = source.read_bytes()
        entries.append(
            {
                "path": source.relative_to(root).as_posix(),
                "mode": source.stat().st_mode & 0o777,
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
            "tooling/plugins",
            *WORKFLOW_KERNEL_FILES,
        ],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout
    return {
        "status": "PASS",
        "findings": [],
        "integrationDigest": hashlib.sha256(serialized).hexdigest(),
        "integrationEntryCount": len(entries),
        "integrationGitState": "CLEAN" if not status else "DIRTY",
        "integrationStatusDigest": hashlib.sha256(status).hexdigest(),
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
        r"## Plan\s+```json\s+(\{.*?\})\s+```",
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


def resolved_plan_mount(root: Path) -> dict[str, object] | None:
    completed = subprocess.run(
        [
            "node",
            "tooling/scripts/plan/plan-mount.mjs",
            "status",
            "--repo-root",
            str(root),
        ],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        try:
            failure = json.loads(completed.stderr)
        except json.JSONDecodeError:
            failure = {}
        if failure.get("error", {}).get("code") == "PLAN_MOUNT_REQUIRED":
            return None
        raise RuntimeError(
            completed.stderr.strip()
            or completed.stdout.strip()
            or "canonical Plan mount resolution failed"
        )
    value = json.loads(completed.stdout)
    if (
        value.get("ok") is not True
        or not isinstance(value.get("mount"), dict)
        or not isinstance(value.get("snapshot"), dict)
        or not isinstance(value.get("run"), dict)
    ):
        raise RuntimeError(
            "canonical Plan mount resolver returned an invalid result"
        )
    return {
        "mount": value["mount"],
        "snapshot": value["snapshot"],
        "run": value["run"],
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
    execution = None
    manifest: dict[str, object] = {}
    current_task = None
    plan_legacy_claims: list[str] = []
    findings: list[str] = []
    try:
        execution = resolved_plan_mount(root)
    except (OSError, RuntimeError, json.JSONDecodeError):
        findings.append("plan-mount-canonical-invalid")
    if execution is not None:
        mount = execution["mount"]
        snapshot = execution["snapshot"]
        run = execution["run"]
        plan_path = root / str(mount.get("planPath") or "")
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
        if run.get("state") == "active" and current_task is None:
            findings.append("active-plan-current-task-missing")
        execution_binding = snapshot.get("executionBinding")
        if mount.get("workspaceId") != workspace_id:
            findings.append("mount-workspace-mismatch")
        if manifest.get("planId") != mount.get("planId"):
            findings.append("mount-plan-mismatch")
        if not isinstance(execution_binding, dict):
            findings.append("snapshot-execution-binding-missing")
        else:
            if execution_binding.get("workspaceId") != workspace_id:
                findings.append("snapshot-workspace-mismatch")
            if execution_binding.get("branch") != branch:
                findings.append("snapshot-branch-mismatch")
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
                if execution is None:
                    if any(value is not None for value in locator):
                        findings.append("unmounted-declaration-plan-locator")
                    else:
                        declaration_mode = "UNTRACKED_PRE_PLAN"
                else:
                    declaration_mode = "TRACKED"
                    if not all(
                        isinstance(value, str) and bool(value)
                        for value in locator
                    ):
                        findings.append("declaration-plan-locator-missing")
                    if candidate.get("taskId") != current_task:
                        findings.append("declaration-current-task-mismatch")
                    mount = execution["mount"]
                    if (
                        candidate.get("planId") != mount.get("planId")
                        or candidate.get("planPath") != mount.get("planPath")
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
        "planMount": execution,
        "planStatus": (
            execution["run"].get("state")
            if execution is not None
            else None
        ),
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
            "missingCanonicalMatchers": list(REQUIRED_INTEGRATION_MATCHERS),
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
            "missingCanonicalMatchers": list(REQUIRED_INTEGRATION_MATCHERS),
            "error": "registry-schema-invalid",
        }
    matchers: list[str] = []
    canonical_with_gate: set[str] = set()
    expected_matchers = REQUIRED_INTEGRATION_MATCHERS
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
                "missingCanonicalMatchers": list(REQUIRED_INTEGRATION_MATCHERS),
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
                "missingCanonicalMatchers": list(REQUIRED_INTEGRATION_MATCHERS),
                "error": "registry-require-invalid",
            }
        if CANONICAL_INTEGRATION_GATE in required:
            canonical_with_gate.update(paths)
    legacy = sorted({item for item in matchers if LEGACY_SKILL in item})
    canonical = sorted(
        item
        for item in canonical_with_gate
        if item in expected_matchers.values()
    )
    missing_canonical = [
        name
        for name in REQUIRED_INTEGRATION_MATCHERS
        if expected_matchers[name] not in canonical
    ]
    return {
        "status": "BLOCKED" if legacy or missing_canonical else "PASS",
        "legacyMatchers": legacy,
        "canonicalMatchers": canonical,
        "missingCanonicalMatchers": missing_canonical,
    }


def installed_callback_probe(
    root: Path,
    host: str | None,
    workspace: str | None = None,
) -> dict[str, object]:
    if host is None:
        return {"status": "NOT_REQUESTED"}
    if host != "trae":
        return {"status": "NOT_APPLICABLE"}
    try:
        control = integration_control_module()
        workspace_file, _, _ = control.resolve_trae_workspace(
            root,
            workspace,
        )
        proof = control.probe_installed_trae_hook(
            root,
            root / ".trae",
            workspace_file,
        )
        expected = dict(control.TRAE_CALLBACK_PROOF)
    except Exception as error:
        return {"status": "BLOCKED", "code": str(error)}
    if proof != expected:
        return {
            "status": "BLOCKED",
            "code": "TRAE_HOOK_PROBE_PROOF_INVALID",
            "proof": proof,
        }
    return {"status": "PASS", "proof": proof}


def integration_receipt(
    identity: dict[str, object],
    host: str | None,
    catalog: dict[str, object],
    callback_probe: dict[str, object],
) -> dict[str, object]:
    if host is None:
        return {"status": "NOT_REQUESTED", "findings": []}
    path = (
        machine_dev_root()
        / "workspaces"
        / str(identity["workspaceId"])
        / "workflow"
        / "agent-integration.json"
    )
    if not path.is_file():
        return {
            "status": "BLOCKED",
            "findings": ["integration-receipt-missing"],
            "path": str(path),
        }
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {
            "status": "BLOCKED",
            "findings": ["integration-receipt-invalid"],
            "path": str(path),
        }
    if not isinstance(value, dict):
        return {
            "status": "BLOCKED",
            "findings": ["integration-receipt-invalid"],
            "path": str(path),
        }
    findings = []
    if set(value) != INTEGRATION_RECEIPT_KEYS:
        findings.append("integration-receipt-fields-invalid")
    installed_at = None
    try:
        installed_at = datetime.fromisoformat(
            str(value.get("installedAt")).replace("Z", "+00:00")
        )
    except ValueError:
        pass
    if value.get("kind") != "peers-touch-agent-integration":
        findings.append("integration-kind-mismatch")
    if value.get("state") != "INSTALLED":
        findings.append("integration-state-mismatch")
    if value.get("operation") not in {
        "skills",
        "skills-hard-cut",
        "skills-gc",
    }:
        findings.append("integration-operation-mismatch")
    if value.get("host") != host:
        findings.append("integration-host-mismatch")
    expected_callback_proof = (
        callback_probe.get("proof")
        if host == "trae"
        else {"status": "NOT_APPLICABLE"}
    )
    if value.get("callbackProof") != expected_callback_proof:
        findings.append("integration-callback-proof-invalid")
    if value.get("workspaceId") != identity["workspaceId"]:
        findings.append("integration-workspace-mismatch")
    if value.get("branch") != identity["branch"]:
        findings.append("integration-branch-mismatch")
    if value.get("sourceHead") != identity["head"]:
        findings.append("integration-head-mismatch")
    for field in (
        "integrationDigest",
        "integrationEntryCount",
        "integrationGitState",
        "integrationStatusDigest",
    ):
        if value.get(field) != catalog.get(field):
            findings.append(f"{field}-mismatch")
    if installed_at is None:
        findings.append("integration-installed-at-invalid")
    return {
        "status": "PASS" if not findings else "BLOCKED",
        "findings": findings,
        "path": str(path),
        "receipt": value,
    }


def audit_root(
    root: Path,
    host: str | None = None,
    workspace: str | None = None,
) -> dict[str, object]:
    if not (root / ".git").exists():
        return {"root": str(root), "status": "BLOCKED", "error": "not-a-worktree"}
    missing = [
        name
        for name in REQUIRED_SKILLS
        if not (root / "tooling" / "skills" / name / "SKILL.md").is_file()
    ]
    legacy_source = root / "tooling" / "skills" / LEGACY_SKILL
    identity = workflow_identity(root)
    execution = identity.get("planMount")
    mount = (
        execution.get("mount")
        if isinstance(execution, dict)
        else None
    )
    bound_plan_paths = (
        (str(mount["planPath"]),)
        if isinstance(mount, dict) and isinstance(mount.get("planPath"), str)
        else ()
    )
    catalog = canonical_integration_catalog(root)
    callback_probe = installed_callback_probe(root, host, workspace)
    report = {
        "root": str(root),
        "status": "PASS",
        "missingCanonicalSkills": missing,
        "canonicalSourceFindings": catalog["findings"],
        "canonicalIntegrationCatalog": catalog,
        "legacySourcePresent": legacy_source.exists(),
        "legacyReferences": legacy_references(root, bound_plan_paths),
        "host": host,
        "hostProjectionFindings": host_projection_findings(
            root,
            host,
            workspace,
        ),
        "workflowIdentity": identity,
        "acceptanceRegistry": acceptance_registry(root),
        "installedCallbackProbe": callback_probe,
        "integrationReceipt": integration_receipt(
            identity,
            host,
            catalog,
            callback_probe,
        ),
    }
    if (
        missing
        or report["canonicalIntegrationCatalog"]["status"] == "BLOCKED"
        or report["legacySourcePresent"]
        or report["legacyReferences"]
        or report["hostProjectionFindings"]
        or report["workflowIdentity"]["identityFindings"]
        or report["acceptanceRegistry"]["status"] == "BLOCKED"
        or report["installedCallbackProbe"]["status"] == "BLOCKED"
        or report["integrationReceipt"]["findings"]
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
        reports = [
            audit_root(item, options.host, options.workspace)
            for item in worktree_roots(root)
        ]
        payload = {
            "status": (
                "PASS"
                if reports and all(item["status"] == "PASS" for item in reports)
                else "BLOCKED"
            ),
            "worktrees": reports,
        }
    else:
        payload = audit_root(root, options.host, options.workspace)
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if payload["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
