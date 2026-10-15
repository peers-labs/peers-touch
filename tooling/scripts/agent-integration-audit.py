#!/usr/bin/env python3
"""Audit project-local Skills and the independently optional advisory Hook."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shlex
import subprocess
import sys
import tempfile
from functools import lru_cache
from pathlib import Path


PLUGIN_NAME = "pt-ew-plugin"
sys.dont_write_bytecode = True


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
    parser.add_argument("--host", required=True, choices=("trae", "cursor", "codex"))
    parser.add_argument("--workspace")
    return parser.parse_args()


def skill_projection(
    root: Path,
    host: str,
) -> dict[str, object]:
    control = integration_control_module()
    try:
        sources, _plugin, catalog = control.canonical_catalog(root)
        target = control.host_root(root, host, create=False) / "skills"
    except Exception as error:
        return {
            "status": "BLOCKED",
            "findings": [{"code": str(error)}],
        }
    findings: list[dict[str, str]] = []
    canonical_source = sources[0].parent.resolve(strict=True)
    if target.is_symlink():
        if not target.exists() or target.resolve(strict=True) != canonical_source:
            findings.append(
                {"path": str(target), "code": "SKILL_PROJECTION_INVALID"}
            )
    elif not target.is_dir():
        findings.append({"path": str(target), "code": "SKILL_PROJECTION_MISSING"})
    else:
        for source in sources:
            projected = target / source.name
            if (
                not projected.is_symlink()
                or not projected.exists()
                or projected.resolve(strict=True) != source
            ):
                findings.append(
                    {
                        "path": str(projected),
                        "code": "SKILL_PROJECTION_INVALID",
                    }
                )
    return {
        "status": "PASS" if not findings else "BLOCKED",
        "findings": findings,
        **catalog,
    }


def expected_hooks(
    root: Path,
    host: str,
    workspace: str | None,
) -> tuple[Path, dict[str, object]]:
    control = integration_control_module()
    target = control.host_root(root, host, create=False)
    workspace_file = None
    if host == "trae":
        workspace_file, _roots, _selected = control.resolve_trae_workspace(
            root,
            workspace,
        )
    return (
        target / "hooks.json",
        control.planned_hooks(
            root,
            target,
            host,
            workspace_file,
            install=True,
        ),
    )


def hook_projection(
    root: Path,
    host: str,
    workspace: str | None,
) -> dict[str, object]:
    try:
        path, expected = expected_hooks(root, host, workspace)
        actual = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {
            "status": "MISSING",
            "findings": [{"code": "HOOK_PROJECTION_MISSING"}],
        }
    except Exception as error:
        return {
            "status": "INVALID",
            "findings": [{"code": str(error)}],
        }
    if actual != expected:
        return {
            "status": "INVALID",
            "findings": [
                {"path": str(path), "code": "HOOK_PROJECTION_MISMATCH"}
            ],
        }
    return {"status": "PASS", "findings": [], "path": str(path)}


def installed_pre_tool_command(
    root: Path,
    host: str,
    workspace: str | None,
) -> tuple[list[str], int]:
    path, _expected = expected_hooks(root, host, workspace)
    value = json.loads(path.read_text(encoding="utf-8"))
    hooks = value.get("hooks")
    event = "preToolUse" if host == "cursor" else "PreToolUse"
    entries = hooks.get(event) if isinstance(hooks, dict) else None
    if not isinstance(entries, list):
        raise RuntimeError("HOOK_PROJECTION_MISMATCH")
    control = integration_control_module()
    if host == "cursor":
        managed = [
            entry for entry in entries if control.is_managed_cursor_hook(entry)
        ]
        if len(managed) != 1:
            raise RuntimeError("HOOK_PROJECTION_MISMATCH")
        command = managed[0].get("command")
        timeout = managed[0].get("timeout")
    else:
        managed = [
            entry
            for entry in entries
            if control.is_managed_trae_hook_entry(entry)
        ]
        if len(managed) != 1:
            raise RuntimeError("HOOK_PROJECTION_MISMATCH")
        command = managed[0]["hooks"][0].get("command")
        timeout = managed[0]["hooks"][0].get("timeout")
    if not isinstance(command, str) or not isinstance(timeout, int):
        raise RuntimeError("HOOK_PROJECTION_MISMATCH")
    invocation = shlex.split(command)
    if (
        not invocation
        or not Path(invocation[0]).is_absolute()
        or Path(invocation[0]).resolve(strict=True)
        != control.node_binary()
    ):
        raise RuntimeError("HOOK_INTERPRETER_NOT_ABSOLUTE")
    return invocation, timeout


def callback_probe(
    root: Path,
    host: str,
    workspace: str | None,
) -> dict[str, object]:
    if host != "trae":
        return {"status": "NOT_APPLICABLE"}
    try:
        command, timeout = installed_pre_tool_command(root, host, workspace)
        with tempfile.TemporaryDirectory(prefix="pt-hook-audit-") as temporary:
            machine = Path(temporary) / "machine"
            payload = {
                "task_root": str(root),
                "repo_working_dir": str(root),
                "tool_name": "pt_audit_probe",
                "tool_input": {},
            }
            completed = subprocess.run(
                command,
                cwd=root,
                input=json.dumps(payload),
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
                env={
                    **os.environ,
                    "PATH": "/usr/bin:/bin",
                    "PT_MACHINE_DEV_ROOT": str(machine),
                },
            )
        if completed.returncode != 0:
            raise RuntimeError("HOOK_CALLBACK_COMMAND_FAILED")
        response = json.loads(completed.stdout)
        output = response.get("hookSpecificOutput")
        if (
            not isinstance(output, dict)
            or output.get("permissionDecision") != "allow"
            or output.get("hookEventName") != "PreToolUse"
            or "docs/global/workflow.md"
            not in str(output.get("additionalContext") or "")
        ):
            raise RuntimeError("HOOK_CALLBACK_CONTEXT_MISSING")
        return {
            "status": "PASS",
            "permissionDecision": "allow",
            "context": "docs/global/workflow.md",
        }
    except Exception as error:
        return {"status": "INVALID", "code": str(error)}


def audit(
    root_value: str | Path,
    host: str,
    workspace: str | None = None,
) -> dict[str, object]:
    control = integration_control_module()
    root = control.canonical_root(root_value)
    identity = control.source_identity(root)
    skills = skill_projection(root, host)
    hook = hook_projection(root, host, workspace)
    probe = (
        callback_probe(root, host, workspace)
        if hook["status"] == "PASS"
        else {"status": "NOT_RUN"}
    )
    if skills["status"] != "PASS":
        status = "BLOCKED"
    elif hook["status"] != "PASS" or probe["status"] == "INVALID":
        status = "DEGRADED"
    else:
        status = "PASS"
    return {
        "status": status,
        "root": str(root),
        "host": host,
        "source": identity,
        "skills": skills,
        "hook": hook,
        "callbackProbe": probe,
    }


def main() -> int:
    arguments = parse_args()
    try:
        report = audit(arguments.root, arguments.host, arguments.workspace)
    except Exception as error:
        report = {
            "status": "BLOCKED",
            "root": arguments.root,
            "host": arguments.host,
            "code": str(error),
        }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 2 if report["status"] == "BLOCKED" else 0


if __name__ == "__main__":
    raise SystemExit(main())
