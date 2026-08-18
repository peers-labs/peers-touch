#!/usr/bin/env python3
"""Aggregate Peers-Touch review, knowledge, and acceptance evidence."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core.errors import EvidenceManifestInvalid


REVIEW_PROFILE_RE = re.compile(r"^\[([A-Za-z0-9_-]+)\]$")
KNOWLEDGE_MATCH_RE = re.compile(r"^- (?P<file>docs/knowledge/\S+) owns (?P<owns>.+?) and matches (?P<changed>.+)$")


def load(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def run_command(command: list[str], cwd: Path) -> dict[str, Any]:
    completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
    return {
        "command": " ".join(command),
        "exit_code": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "ok": completed.returncode == 0,
    }


def collect_changed_paths(repo_root: Path, diff_range: str) -> list[str]:
    tracked = subprocess.run(
        ["git", "diff", "--name-only", diff_range, "--"],
        cwd=repo_root,
        check=True,
        text=True,
        capture_output=True,
    )
    outputs = [tracked.stdout]
    if diff_range == "HEAD":
        untracked = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard"],
            cwd=repo_root,
            check=True,
            text=True,
            capture_output=True,
        )
        outputs.append(untracked.stdout)
    paths = {
        line.strip()
        for line in "\n".join(outputs).splitlines()
        if line.strip()
    }
    return sorted(paths)


def parse_review_profiles(output: str) -> list[str]:
    profiles: list[str] = []
    for line in output.splitlines():
        match = REVIEW_PROFILE_RE.match(line.strip())
        if match:
            profiles.append(match.group(1))
    return sorted(set(profiles))


def parse_knowledge_matches(output: str) -> list[dict[str, str]]:
    matches: list[dict[str, str]] = []
    for line in output.splitlines():
        match = KNOWLEDGE_MATCH_RE.match(line.strip())
        if not match:
            continue
        matches.append(match.groupdict())
    return matches


def run_acceptance_plan(repo_root: Path, root: Path, diff_range: str, changed_paths: list[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    with tempfile.NamedTemporaryFile(prefix="pt-acceptance-plan-", suffix=".json") as plan_file:
        command = [
            "python3",
            "tooling/scripts/acceptance-plan.py",
            "--root",
            str(root),
            "--range",
            diff_range,
            "--output",
            plan_file.name,
        ]
        for path in changed_paths:
            command.extend(["--changed-file", path])
        result = run_command(command, repo_root)
        plan = load(Path(plan_file.name)) if result["ok"] else {}
    return result, plan


def load_capabilities(root: Path) -> list[dict[str, Any]]:
    capabilities: list[dict[str, Any]] = []
    for path in sorted((root / "capabilities").glob("*.yaml")):
        capabilities.extend(load(path).get("capabilities", []))
    return capabilities


def selected_capability_evidence(root: Path, impacted_features: list[str]) -> dict[str, Any]:
    impacted = set(impacted_features)
    selected: list[dict[str, Any]] = []
    proven_scope: list[str] = []
    unproven_scope: list[str] = []
    blocking_unproven_scope: list[str] = []
    informational_unproven_scope: list[str] = []

    for capability in load_capabilities(root):
        features = set(capability.get("features", []))
        if not features & impacted:
            continue
        evidence = capability.get("evidence", {})
        direction = str(capability.get("direction") or "")
        capability_unproven_scope = evidence.get("unproven_scope", [])
        selected.append(
            {
                "id": capability.get("id", ""),
                "domain": capability.get("domain", ""),
                "direction": direction,
                "features": sorted(features & impacted),
                "proven_by": evidence.get("proven_by", []),
                "proven_scope": evidence.get("proven_scope", []),
                "unproven_scope": capability_unproven_scope,
            }
        )
        proven_scope.extend(evidence.get("proven_scope", []))
        unproven_scope.extend(capability_unproven_scope)
        if direction == "product_domain_validates_acceptance":
            informational_unproven_scope.extend(capability_unproven_scope)
        else:
            blocking_unproven_scope.extend(capability_unproven_scope)

    return {
        "selected_capabilities": selected,
        "proven_scope": sorted(set(proven_scope)),
        "unproven_scope": sorted(set(unproven_scope)),
        "blocking_unproven_scope": sorted(set(blocking_unproven_scope)),
        "informational_unproven_scope": sorted(
            set(informational_unproven_scope)
        ),
    }


def classify_gates(gates: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    buckets = {
        "ci_gates": [],
        "local_evidence_gates": [],
        "environment_evidence_gates": [],
        "nightly_or_release_gates": [],
    }
    for gate in gates:
        tier = gate.get("tier", "local-evidence")
        summary = {
            "id": gate.get("id", ""),
            "tier": tier,
            "environment": gate.get("environment", "local"),
            "provisioner": gate.get("provisioner", ""),
            "command": gate.get("command", ""),
            "required_by": gate.get("required_by", []),
        }
        if tier in {"ci-structure", "ci-cheap"}:
            buckets["ci_gates"].append(summary)
        elif tier == "local-evidence":
            buckets["local_evidence_gates"].append(summary)
        elif tier == "env-evidence":
            buckets["environment_evidence_gates"].append(summary)
        else:
            buckets["nightly_or_release_gates"].append(summary)
    return buckets


def gate_result_is_proven(
    gate: dict[str, Any],
    result: dict[str, Any],
    head_commit: str,
) -> bool:
    if not (
        result.get("status") == "passed"
        and result.get("completionStatus") == "DONE"
        and result.get("proofStatus") == "PROVEN"
        and result.get("timedOut") is not True
    ):
        return False
    traceability = result.get("traceability")
    if not isinstance(traceability, dict) or traceability.get("status") != "complete":
        return False
    if not gate.get("provisioner"):
        return True
    manifest = result.get("manifest")
    if not isinstance(manifest, dict) or manifest.get("state") != "FIXTURE_READY":
        return False
    source = manifest.get("source")
    return (
        isinstance(source, dict)
        and source.get("commit") == head_commit
        and source.get("workspaceDigest") == "clean"
    )


def evidence_gaps(evidence: dict[str, Any]) -> list[dict[str, str]]:
    gaps: list[dict[str, str]] = []
    if not evidence["route"]["ok"]:
        gaps.append(
            {
                "kind": "review-routing",
                "impact": "Review profiles could not be established.",
                "next_evidence": "Fix route-change.sh input/range failure and rerun quality evidence.",
            }
        )
    if not evidence["knowledge"]["ok"]:
        gaps.append(
            {
                "kind": "knowledge",
                "impact": "Operational knowledge matching or freshness validation failed.",
                "next_evidence": "Fix knowledge frontmatter/path issues or update the relevant docs/knowledge entry.",
            }
        )
    if not evidence["acceptance"]["plan_ok"]:
        gaps.append(
            {
                "kind": "acceptance-plan",
                "impact": "Product acceptance impact could not be planned.",
                "next_evidence": "Fix acceptance registry/gate references and rerun the plan.",
            }
        )

    for index, scope in enumerate(
        evidence["acceptance"]["blocking_unproven_scope"],
        start=1,
    ):
        gaps.append(
            {
                "kind": f"unproven-product-scope:{index}",
                "impact": scope,
                "next_evidence": "Decide in pt-github-review whether this is blocking, acceptable follow-up, or needs owner waiver.",
            }
        )

    results = {
        result.get("id"): result
        for result in evidence["acceptance"]["latest_run"].get("results", [])
        if isinstance(result, dict) and result.get("id")
    }
    for gate in evidence["acceptance"]["gate_buckets"]["environment_evidence_gates"]:
        result = results.get(gate["id"], {})
        if gate_result_is_proven(gate, result, evidence["head_commit"]):
            continue
        gaps.append(
            {
                "kind": f"environment-gate:{gate['id']}",
                "impact": f"{gate['id']} requires {gate['environment']} and is unproven by this evidence pass.",
                "next_evidence": f"Run `{gate['command']}` in the required environment or record an owner-reviewed waiver.",
            }
        )
    for gate in evidence["acceptance"]["gate_buckets"]["nightly_or_release_gates"]:
        result = results.get(gate["id"], {})
        if gate_result_is_proven(gate, result, evidence["head_commit"]):
            continue
        gaps.append(
            {
                "kind": f"deferred-gate:{gate['id']}",
                "impact": f"{gate['id']} is tier {gate['tier']} and should not be silently treated as PR evidence.",
                "next_evidence": "Run in the scheduled/release lane or keep it as explicit deferred evidence.",
            }
        )
    return gaps


def render_markdown(evidence: dict[str, Any]) -> str:
    lines = [
        "# Quality Evidence",
        "",
        f"- Range: `{evidence['range']}`",
        f"- Ready for pt-github-review: {'yes' if evidence['ready_for_github_review'] else 'no'}",
        "",
        "## Changed Paths",
        "",
    ]
    lines.extend(f"- `{path}`" for path in evidence["changed_paths"])
    if not evidence["changed_paths"]:
        lines.append("- none")

    lines.extend(["", "## Review Profiles", ""])
    lines.extend(f"- `{profile}`" for profile in evidence["route"]["profiles"])
    if not evidence["route"]["profiles"]:
        lines.append("- none")

    lines.extend(["", "## Matched Knowledge", ""])
    for match in evidence["knowledge"]["matches"]:
        lines.append(f"- `{match['file']}` owns `{match['owns']}` and matches `{match['changed']}`")
    if not evidence["knowledge"]["matches"]:
        lines.append("- none")

    acceptance = evidence["acceptance"]
    lines.extend(["", "## Acceptance Impact", ""])
    lines.append(f"- Plan status: {'pass' if acceptance['plan_ok'] else 'fail'}")
    lines.append(f"- Impacted features: {', '.join(f'`{item}`' for item in acceptance['impacted_features']) or 'none'}")

    gate_sections = [
        ("CI Gates", "ci_gates"),
        ("Local Evidence Gates", "local_evidence_gates"),
        ("Environment Evidence Gates", "environment_evidence_gates"),
        ("Nightly/Release Gates", "nightly_or_release_gates"),
    ]
    for title, key in gate_sections:
        lines.extend(["", f"## {title}", ""])
        for gate in acceptance["gate_buckets"][key]:
            lines.append(f"- `{gate['id']}` [{gate['tier']}/{gate['environment']}]: `{gate['command']}`")
        if not acceptance["gate_buckets"][key]:
            lines.append("- none")

    lines.extend(["", "## Product Proven Scope", ""])
    lines.extend(f"- {item}" for item in acceptance["proven_scope"])
    if not acceptance["proven_scope"]:
        lines.append("- none")

    lines.extend(["", "## Blocking Unproven Scope", ""])
    lines.extend(
        f"- {item}" for item in acceptance["blocking_unproven_scope"]
    )
    if not acceptance["blocking_unproven_scope"]:
        lines.append("- none")

    lines.extend(["", "## Informational Reverse-Validation Scope", ""])
    lines.extend(
        f"- {item}" for item in acceptance["informational_unproven_scope"]
    )
    if not acceptance["informational_unproven_scope"]:
        lines.append("- none")

    lines.extend(["", "## Evidence Gaps", ""])
    for gap in evidence["evidence_gaps"]:
        lines.append(f"- `{gap['kind']}`: {gap['impact']} Next evidence: {gap['next_evidence']}")
    if not evidence["evidence_gaps"]:
        lines.append("- none")

    return "\n".join(lines) + "\n"


def is_ready_for_github_review(
    route: dict[str, Any],
    knowledge: dict[str, Any],
    plan_result: dict[str, Any],
    gaps: list[dict[str, str]],
) -> bool:
    return (
        route["ok"]
        and knowledge["ok"]
        and plan_result["ok"]
        and not gaps
    )


def main() -> int:
    from tooling.acceptance.core import (
        RUN_GATE_ENV,
        ArtifactSession,
        EvidenceStore,
    )

    parser = argparse.ArgumentParser()
    parser.add_argument("--range", dest="diff_range", default="HEAD")
    parser.add_argument("--root", default="tooling/acceptance")
    args = parser.parse_args()

    repo_root = REPO_ROOT
    acceptance_root = repo_root / args.root
    changed_paths = collect_changed_paths(repo_root, args.diff_range)
    head_commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()

    route = run_command(["tooling/scripts/review/route-change.sh", "--range", args.diff_range], repo_root)
    knowledge = run_command(["tooling/scripts/review/knowledge-match.sh", "--range", args.diff_range, "--strict"], repo_root)
    plan_result, plan = run_acceptance_plan(repo_root, Path(args.root), args.diff_range, changed_paths)
    capability_evidence = selected_capability_evidence(acceptance_root, plan.get("impacted_features", []))

    store = EvidenceStore.from_environment(
        repo_root=repo_root,
        worktree=repo_root,
    )
    try:
        latest_run = store.read_json(
            store.latest_artifact_ref("acceptance-run", "run")
        )
    except EvidenceManifestInvalid as error:
        latest_run = {
            "artifactKind": "acceptance-run",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "results": [],
            "evidenceReadError": f"{type(error).__name__}: {error}",
        }

    evidence: dict[str, Any] = {
        "range": args.diff_range,
        "head_commit": head_commit,
        "changed_paths": changed_paths,
        "route": {
            "ok": route["ok"],
            "profiles": parse_review_profiles(route["stdout"]),
            "stdout": route["stdout"],
            "stderr": route["stderr"],
        },
        "knowledge": {
            "ok": knowledge["ok"],
            "matches": parse_knowledge_matches(knowledge["stdout"]),
            "stdout": knowledge["stdout"],
            "stderr": knowledge["stderr"],
        },
        "acceptance": {
            "plan_ok": plan_result["ok"],
            "plan_stdout": plan_result["stdout"],
            "plan_stderr": plan_result["stderr"],
            "matched_rules": plan.get("matched_rules", []),
            "impacted_features": plan.get("impacted_features", []),
            "selected_gates": plan.get("selected_gates", []),
            "gate_buckets": classify_gates(plan.get("selected_gates", [])),
            "latest_run": latest_run,
            **capability_evidence,
        },
    }
    evidence["evidence_gaps"] = evidence_gaps(evidence)
    evidence["ready_for_github_review"] = is_ready_for_github_review(
        route,
        knowledge,
        plan_result,
        evidence["evidence_gaps"],
    )

    gate_id = os.environ.get(RUN_GATE_ENV) or "quality-evidence"
    with ArtifactSession(repo_root=repo_root, gate_id=gate_id) as session:
        json_ref = session.write_json(
            "reports/quality-evidence.json",
            evidence,
            role="quality-json",
        )
        markdown_ref = session.write_bytes(
            "reports/quality-evidence.md",
            render_markdown(evidence).encode("utf-8"),
            media_type="text/markdown",
            role="quality-markdown",
        )
        ready = evidence["ready_for_github_review"]
        session.complete(
            status="passed" if ready else "failed",
            completion_status="DONE" if ready else "PARTIAL",
            proof_status="PROVEN" if ready else "UNPROVEN",
        )

    print("Quality Evidence")
    print("================")
    print(f"range: {args.diff_range}")
    print(f"changed_paths: {len(changed_paths)}")
    print(f"review_profiles: {', '.join(evidence['route']['profiles']) or 'none'}")
    print(f"impacted_features: {', '.join(evidence['acceptance']['impacted_features']) or 'none'}")
    print(f"evidence_gaps: {len(evidence['evidence_gaps'])}")
    print(f"json: {json.dumps(json_ref.to_dict(), sort_keys=True)}")
    print(f"markdown: {json.dumps(markdown_ref.to_dict(), sort_keys=True)}")
    return 0 if evidence["ready_for_github_review"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        print(f"quality evidence failed: {error}", file=sys.stderr)
        raise SystemExit(1)
