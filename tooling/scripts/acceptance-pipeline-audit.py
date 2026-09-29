#!/usr/bin/env python3
"""Audit reusable Acceptance Suite contracts and runtime reports."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core.errors import SuiteRuntimeError
from tooling.acceptance.core.suite_runtime import (
    RuntimeReuseContract,
    validate_suite_runtime_report,
)


TASK_BLOCK_PATTERN = re.compile(
    r"^## Task Slice\s*$\s*```json\s*$\s*(\{[\s\S]*?\})\s*```",
    re.MULTILINE,
)
MANIFEST_BLOCK_PATTERN = re.compile(
    r"^## Plan Package\s*$\s*```json\s*$\s*(\{[\s\S]*?\})\s*```",
    re.MULTILINE,
)


class PipelineAuditError(RuntimeError):
    pass


def _display_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.name


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PipelineAuditError(f"cannot read JSON {path}: {error}") from error


def _extract_json(pattern: re.Pattern[str], text: str, source: Path) -> Any:
    matches = pattern.findall(text)
    if len(matches) != 1:
        raise PipelineAuditError(
            f"{source} must contain exactly one matching JSON block"
        )
    try:
        return json.loads(matches[0])
    except json.JSONDecodeError as error:
        raise PipelineAuditError(
            f"{source} contains invalid JSON: {error}"
        ) from error


def _load_plan_tasks(plan_path: Path) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    try:
        plan_text = plan_path.read_text(encoding="utf-8")
    except OSError as error:
        raise PipelineAuditError(f"cannot read Plan {plan_path}: {error}") from error
    manifest = _extract_json(
        MANIFEST_BLOCK_PATTERN,
        plan_text,
        plan_path,
    )
    if not isinstance(manifest, dict):
        raise PipelineAuditError("Plan Package must be an object")
    tasks: dict[str, dict[str, Any]] = {}
    for entry in manifest.get("tasks", []):
        if not isinstance(entry, dict):
            raise PipelineAuditError("Plan Task entries must be objects")
        task_id = entry.get("id")
        task_ref = entry.get("path")
        if not isinstance(task_id, str) or not isinstance(task_ref, str):
            raise PipelineAuditError("Plan Task entry is missing id or path")
        task_path = plan_path.parent / task_ref
        try:
            task_text = task_path.read_text(encoding="utf-8")
        except OSError as error:
            raise PipelineAuditError(
                f"cannot read Task Slice {task_path}: {error}"
            ) from error
        task = _extract_json(TASK_BLOCK_PATTERN, task_text, task_path)
        if not isinstance(task, dict) or task.get("taskId") != task_id:
            raise PipelineAuditError(
                f"Task Slice {task_path} does not match {task_id}"
            )
        tasks[task_id] = task
    return manifest, tasks


def _task_audit(task: Mapping[str, Any]) -> dict[str, Any]:
    task_id = str(task.get("taskId") or "")
    findings: list[dict[str, str]] = []
    contract_payload = task.get("runtimeReuse")
    if contract_payload is None:
        findings.append(
            {
                "code": "RUNTIME_REUSE_CONTRACT_MISSING",
                "detail": f"Task {task_id} does not declare runtimeReuse",
            }
        )
        return {
            "taskId": task_id,
            "result": "FAIL",
            "runtimeProofState": "NOT_RUN",
            "findings": findings,
        }
    try:
        contract = RuntimeReuseContract.from_dict(contract_payload)
    except SuiteRuntimeError as error:
        findings.append(error.to_dict())
        return {
            "taskId": task_id,
            "result": "FAIL",
            "runtimeProofState": "NOT_RUN",
            "findings": findings,
        }

    checks = task.get("checks")
    if not isinstance(checks, list):
        findings.append(
            {
                "code": "SUITE_ENTRY_CHECK_MISSING",
                "detail": f"Task {task_id} has no checks",
            }
        )
    else:
        matching = [
            check
            for check in checks
            if isinstance(check, dict)
            and check.get("id") == contract.entry_check_id
            and check.get("verificationClass") == "FUNCTIONAL_CHECK"
        ]
        if len(matching) != 1:
            findings.append(
                {
                    "code": "SUITE_ENTRY_CHECK_MISSING",
                    "detail": (
                        f"Task {task_id} must expose exactly one functional "
                        f"entry check {contract.entry_check_id!r}"
                    ),
                }
            )
    return {
        "taskId": task_id,
        "result": "PASS" if not findings else "FAIL",
        "runtimeProofState": "NOT_RUN",
        "contract": contract.to_dict(),
        "findings": findings,
    }


def audit_pipeline(
    *,
    plan_path: Path,
    task_ids: Sequence[str],
    runtime_reports: Sequence[Path] = (),
) -> dict[str, Any]:
    manifest, tasks = _load_plan_tasks(plan_path)
    selected = tuple(task_ids) if task_ids else tuple(
        task_id
        for task_id, task in tasks.items()
        if "runtimeReuse" in task
    )
    if not selected:
        raise PipelineAuditError(
            "no runtimeReuse Task was selected for audit"
        )
    unknown = sorted(set(selected) - set(tasks))
    if unknown:
        raise PipelineAuditError(
            f"unknown Task IDs: {', '.join(unknown)}"
        )
    task_results = [_task_audit(tasks[task_id]) for task_id in selected]
    selected_contracts = tuple(
        RuntimeReuseContract.from_dict(result["contract"])
        for result in task_results
        if result["result"] == "PASS"
    )
    report_results: list[dict[str, Any]] = []
    for report_path in runtime_reports:
        try:
            report = validate_suite_runtime_report(_read_json(report_path))
            report_contract = RuntimeReuseContract.from_dict(
                report["contract"]
            )
            if report_contract not in selected_contracts:
                raise SuiteRuntimeError(
                    "SUITE_RUNTIME_CONTRACT_MISMATCH",
                    "runtime report does not match a selected Task contract",
                )
        except SuiteRuntimeError as error:
            report_results.append(
                {
                    "path": _display_path(report_path),
                    "result": "FAIL",
                    "findings": [error.to_dict()],
                }
            )
        else:
            report_results.append(
                {
                    "path": _display_path(report_path),
                    "result": "PASS",
                    "suiteRuntimeId": report["suiteRuntimeId"],
                    "metrics": report["metrics"],
                    "findings": [],
                }
            )
    findings = [
        finding
        for result in (*task_results, *report_results)
        for finding in result["findings"]
    ]
    return {
        "artifactKind": "acceptance-pipeline-audit",
        "planId": manifest.get("planId"),
        "planPath": _display_path(plan_path),
        "taskResults": task_results,
        "runtimeReports": report_results,
        "findings": findings,
        "result": "PASS" if not findings else "FAIL",
        "proofState": (
            "SUPPORTING"
            if runtime_reports and not findings
            else "NOT_RUN"
            if not runtime_reports and not findings
            else "UNPROVEN"
        ),
    }


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument(
        "--tasks",
        default="",
        help="Comma-separated Task IDs; defaults to every runtimeReuse Task",
    )
    parser.add_argument(
        "--runtime-report",
        action="append",
        default=[],
        type=Path,
    )
    parser.add_argument("--output", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    task_ids = tuple(
        task_id.strip()
        for task_id in args.tasks.split(",")
        if task_id.strip()
    )
    try:
        result = audit_pipeline(
            plan_path=args.plan.resolve(),
            task_ids=task_ids,
            runtime_reports=tuple(
                report.resolve() for report in args.runtime_report
            ),
        )
    except PipelineAuditError as error:
        result = {
            "artifactKind": "acceptance-pipeline-audit",
            "result": "FAIL",
            "proofState": "UNPROVEN",
            "findings": [
                {
                    "code": "ACCEPTANCE_PIPELINE_AUDIT_INPUT_INVALID",
                    "detail": str(error),
                }
            ],
        }
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    sys.stdout.write(rendered)
    return 0 if result["result"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
