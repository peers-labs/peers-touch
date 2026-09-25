#!/usr/bin/env python3
"""Plan acceptance gates from a git diff range."""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from _acceptance_artifacts import explicit_output_path  # noqa: E402
from tooling.acceptance.core.execution_plan import (  # noqa: E402
    PLAN_DRIFT,
    ExecutionPlanError,
    changed_paths_for_plan,
    discover_active_plan,
    load_formal_plan,
)
from tooling.acceptance.finalizers import load_strict_json_object  # noqa: E402


def load_json_yaml(path: Path) -> dict[str, Any]:
    return load_strict_json_object(path, str(path))


def changed_paths(diff_range: str) -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only", diff_range],
        check=True,
        text=True,
        capture_output=True,
    )
    paths = {
        line.strip()
        for line in result.stdout.splitlines()
        if line.strip()
    }
    if diff_range == "HEAD":
        untracked = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard"],
            check=True,
            text=True,
            capture_output=True,
        )
        paths.update(
            line.strip()
            for line in untracked.stdout.splitlines()
            if line.strip()
        )
    return sorted(paths)


def load_behavior_rules(root: Path) -> list[dict[str, Any]]:
    rules: list[dict[str, Any]] = []
    behavior_dir = root / "behavior-rules"
    if not behavior_dir.exists():
        return rules
    for rule_file in sorted(behavior_dir.glob("*.yaml")):
        data = load_json_yaml(rule_file)
        for rule in data.get("rules", []):
            rule["_source_file"] = str(rule_file.relative_to(root))
            rules.append(rule)
    return rules


def path_matches_any(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) or fnmatch.fnmatch(f"/{path}", pattern)
               for pattern in patterns)


def finalizer_bindings(
    root: Path,
    gates: dict[str, Any],
) -> dict[str, Any]:
    has_catalog_config = any(
        isinstance(gate, dict) and "evidenceFinalizer" in gate
        for gate in gates.values()
    )
    has_capability_declaration = any(
        "finalizerRegistry" in load_json_yaml(path)
        or "requiredEvidenceFinalizers" in load_json_yaml(path)
        for path in sorted((root / "capabilities").glob("*.yaml"))
    )
    if not has_catalog_config and not has_capability_declaration:
        return {}

    from tooling.acceptance.finalizers import load_finalizer_bindings

    return dict(load_finalizer_bindings(root, gates))


def gate_launch_fields(gate_id: str, gate: dict[str, Any]) -> dict[str, Any]:
    has_command = "command" in gate
    has_argv = "argv" in gate
    if has_command == has_argv:
        raise SystemExit(
            f"{gate_id}: gate must define exactly one of command or argv"
        )

    if has_command:
        command = gate["command"]
        if not isinstance(command, str) or not command.strip():
            raise SystemExit(f"{gate_id}: gate command must be a non-empty string")
        launch: dict[str, Any] = {"command": command}
    else:
        argv = gate["argv"]
        if (
            not isinstance(argv, list)
            or not argv
            or any(not isinstance(argument, str) or not argument for argument in argv)
        ):
            raise SystemExit(
                f"{gate_id}: gate argv must be a non-empty list of non-empty strings"
            )
        launch = {"argv": list(argv)}

    if "ephemeralCapabilities" in gate:
        capabilities = gate["ephemeralCapabilities"]
        if (
            not isinstance(capabilities, list)
            or not capabilities
            or any(
                not isinstance(capability, str) or not capability
                for capability in capabilities
            )
            or len(set(capabilities)) != len(capabilities)
        ):
            raise SystemExit(
                f"{gate_id}: ephemeralCapabilities must be a unique, non-empty "
                "list of non-empty strings"
            )
        if not has_argv:
            raise SystemExit(f"{gate_id}: ephemeralCapabilities requires argv")
        if not is_supported_context_argv(argv):
            raise SystemExit(
                f"{gate_id}: ephemeralCapabilities requires a Python module, "
                "script, or -c argv"
            )
        launch["ephemeralCapabilities"] = list(capabilities)

    return launch


def is_supported_context_argv(argv: list[str]) -> bool:
    if len(argv) < 2 or not re.fullmatch(
        r"python(?:\d+(?:\.\d+)*)?",
        Path(argv[0]).name,
    ):
        return False
    if argv[1] == "-m":
        return len(argv) >= 3 and bool(
            re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*", argv[2])
        )
    if argv[1] == "-c":
        return len(argv) >= 3
    return not argv[1].startswith("-") and Path(argv[1]).suffix == ".py"


def planned_gate(
    gate_id: str,
    gate: dict[str, Any],
    finalizer_binding: Any | None = None,
) -> dict[str, Any]:
    planned = {
        "id": gate_id,
        **gate_launch_fields(gate_id, gate),
        "timeout_seconds": gate.get("timeout_seconds", 600),
        "environment": gate.get("environment", "local"),
        "provisioner": gate.get("provisioner", ""),
        "tier": gate.get("tier", "local-evidence"),
        "description": gate.get("description", ""),
        "required_by": [],
    }
    if finalizer_binding is not None:
        planned["evidenceFinalizer"] = finalizer_binding.plan_config()
    return planned


def plan(root: Path, paths: list[str]) -> dict[str, Any]:
    registry = load_json_yaml(root / "registry.yaml")
    gates = load_json_yaml(root / "gates.yaml").get("gates", {})
    bindings = finalizer_bindings(root, gates)
    behavior_rules = load_behavior_rules(root)
    selected: dict[str, dict[str, Any]] = {}
    impacted_features: set[str] = set()
    matched_rules: list[dict[str, Any]] = []

    for rule in registry.get("rules", []):
        patterns = rule.get("when", {}).get("paths", [])
        matched_paths = [path for path in paths if path_matches_any(path, patterns)]
        if not matched_paths:
            continue
        matched_rules.append({"id": rule.get("id"), "paths": matched_paths, "type": "path-rule"})
        impacted_features.update(rule.get("features", []))
        for gate_id in rule.get("require", []):
            if gate_id not in gates:
                raise SystemExit(f"gate {gate_id!r} referenced by rule {rule.get('id')!r} is missing")
            selected.setdefault(
                gate_id,
                planned_gate(gate_id, gates[gate_id], bindings.get(gate_id)),
            )
            selected[gate_id]["required_by"].append(rule.get("id"))

    for rule in behavior_rules:
        when = rule.get("when", {})
        path_patterns = when.get("paths", [])
        matched_paths = [
            path for path in paths if path_matches_any(path, path_patterns)
        ]
        if not matched_paths:
            continue
        matched_rules.append({
            "id": rule.get("id"),
            "paths": matched_paths,
            "type": "behavior-rule",
            "source": rule.get("_source_file", ""),
        })
        impacted_features.update(rule.get("features", []))
        for gate_id in rule.get("require", []):
            if gate_id not in gates:
                raise SystemExit(f"gate {gate_id!r} referenced by behavior rule {rule.get('id')!r} is missing")
            selected.setdefault(
                gate_id,
                planned_gate(gate_id, gates[gate_id], bindings.get(gate_id)),
            )
            selected[gate_id]["required_by"].append(f"behavior:{rule.get('id')}")

    return {
        "changed_paths": paths,
        "matched_rules": matched_rules,
        "impacted_features": sorted(impacted_features),
        "selected_gates": list(selected.values()),
    }


def default_output_path(self_check: bool) -> Path:
    from tooling.acceptance.core import current_artifact_path

    name = "acceptance-plan-self.json" if self_check else "plan.json"
    return current_artifact_path(
        f"reports/{name}",
        repo_root=REPO_ROOT,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="tooling/acceptance")
    parser.add_argument("--output")
    parser.add_argument("--range", dest="diff_range", default="HEAD")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--changed-file", action="append", default=[])
    parser.add_argument("--active-plan", action="store_true")
    parser.add_argument("--execution-plan")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--completion", action="store_true")
    mode.add_argument("--full", action="store_true")
    args = parser.parse_args()

    root = Path(args.root)
    formal_plan = None
    execution_mode = (
        "completion" if args.completion else "full" if args.full else "closure"
    )
    try:
        if args.execution_plan:
            formal_plan = load_formal_plan(Path(args.execution_plan))
        elif args.active_plan:
            formal_plan = discover_active_plan(REPO_ROOT)
        paths = args.changed_file or (
            changed_paths_for_plan(REPO_ROOT, formal_plan)
            if formal_plan
            else changed_paths(args.diff_range)
        )
        result = plan(root, paths)
        if formal_plan:
            candidate_ids = [gate["id"] for gate in result["selected_gates"]]
            undeclared = sorted(
                set(candidate_ids) - formal_plan.all_declared_gate_ids()
            )
            if undeclared:
                raise ExecutionPlanError(
                    PLAN_DRIFT,
                    "registry impact contains Gates absent from the formal plan: "
                    + ", ".join(undeclared),
                )
            definitions = load_json_yaml(root / "gates.yaml").get("gates", {})
            bindings = finalizer_bindings(root, definitions)
            selected_ids = formal_plan.gate_ids(execution_mode)
            missing = [
                gate_id for gate_id in selected_ids if gate_id not in definitions
            ]
            if missing:
                raise ExecutionPlanError(
                    PLAN_DRIFT,
                    "formal plan references missing Gates: " + ", ".join(missing),
                )
            result["candidate_gates"] = candidate_ids
            result["selected_gates"] = [
                {
                    **planned_gate(
                        gate_id,
                        definitions[gate_id],
                        bindings.get(gate_id),
                    ),
                    "required_by": [
                        f"formal-plan:{formal_plan.current_closure}"
                        if execution_mode == "closure"
                        else f"formal-plan:{execution_mode}"
                    ],
                }
                for gate_id in selected_ids
            ]
            try:
                formal_plan_path = formal_plan.path.relative_to(REPO_ROOT).as_posix()
            except ValueError:
                formal_plan_path = str(formal_plan.path)
            result["execution"] = {
                "formalPlan": formal_plan_path,
                "planId": formal_plan.plan_id,
                "planFormat": formal_plan.plan_format,
                "branch": formal_plan.branch,
                "currentTaskId": formal_plan.current_task_id,
                "currentTaskPath": formal_plan.current_task_path,
                "closure": formal_plan.current_closure,
                "mode": execution_mode,
                "workspaceId": formal_plan.workspace_id,
            }
    except ExecutionPlanError as error:
        print(f"{error.code}: {error}", file=sys.stderr)
        return 2
    result["range"] = (
        f"{formal_plan.initial_head}..WORKTREE"
        if formal_plan
        else args.diff_range
    )

    artifact_ref: dict[str, str] | None = None
    run = None
    if args.output:
        output = explicit_output_path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(result, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    else:
        from tooling.acceptance.core import (
            RUN_GATE_ENV,
            RUN_ID_ENV,
            EvidenceManifestInvalid,
            EvidenceStore,
            current_artifact_ref,
            source_identity,
            write_current_artifact,
        )

        gate_id = "acceptance-plan-self" if args.self_check else "acceptance-plan"
        relative_path = (
            "reports/acceptance-plan-self.json"
            if args.self_check
            else "reports/plan.json"
        )
        if os.environ.get(RUN_ID_ENV):
            if os.environ.get(RUN_GATE_ENV) != gate_id:
                raise EvidenceManifestInvalid(
                    "acceptance-plan child Gate does not match run context"
                )
            output = write_current_artifact(
                relative_path,
                (
                    json.dumps(result, indent=2, ensure_ascii=False) + "\n"
                ).encode("utf-8"),
                repo_root=REPO_ROOT,
            )
            reference = current_artifact_ref(
                relative_path,
                repo_root=REPO_ROOT,
                media_type="application/json",
            )
            artifact_ref = reference.to_dict()
        else:
            store = EvidenceStore.from_environment(
                repo_root=REPO_ROOT,
                worktree=REPO_ROOT,
            )
            run = store.begin_run(gate_id, source=source_identity(REPO_ROOT))
            try:
                reference = run.write_json(
                    relative_path,
                    result,
                    role="plan",
                )
                run.finalize(
                    result={
                        "status": "passed",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                    }
                )
                run.publish_latest()
                output = store.resolve(reference)
                artifact_ref = reference.to_dict()
            finally:
                run.close()

    print("Acceptance Plan")
    print("===============")
    print(f"range: {result['range']}")
    if formal_plan:
        print(f"formal_plan: {result['execution']['formalPlan']}")
        print(f"closure: {formal_plan.current_closure or 'complete'}")
        print(f"mode: {execution_mode}")
    print(f"changed_paths: {len(result['changed_paths'])}")
    print(f"impacted_features: {', '.join(result['impacted_features']) or 'none'}")
    if result["selected_gates"]:
        for gate in result["selected_gates"]:
            launch = (
                gate["command"]
                if "command" in gate
                else json.dumps(gate["argv"], ensure_ascii=False)
            )
            print(f"[GATE] {gate['id']} [{gate['tier']}/{gate['environment']}]: {launch}")
    else:
        print("[GATE] none")
    print(
        "plan: "
        + (
            json.dumps(artifact_ref, sort_keys=True)
            if artifact_ref is not None
            else str(output)
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
