#!/usr/bin/env python3
"""Render sealed Acceptance observations and actionable diagnostic gaps."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import ArtifactRef
from tooling.acceptance.core.execution_graph import validate_judgment
from tooling.acceptance.core.redaction import redact_text, redact_value


def load(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"report input must be a JSON object: {path}")
    return value


def gate_invocation(gate: dict) -> str:
    if "judgment" in gate:
        validate_judgment(str(gate.get("id", "<unknown>")), gate)
        return f"judgment: {gate['judgment']} ({', '.join(gate['dependsOn'])})"
    command = gate.get("command")
    argv = gate.get("argv")
    if isinstance(command, str) and command.strip() and argv is None:
        return command
    if (
        command is None and isinstance(argv, list) and argv
        and all(isinstance(argument, str) and argument for argument in argv)
    ):
        return shlex.join(argv)
    raise ValueError(
        f"selected Gate {gate.get('id', '<unknown>')!r} "
        "must contain exactly one valid command or argv"
    )


def incomplete(result: dict) -> bool:
    return (
        result.get("status") != "passed"
        or result.get("proofStatus") not in {"PROVEN", "NOT_APPLICABLE"}
    )


def result_diagnostic(result: dict, source: dict, store: Any) -> dict:
    """Project sealed observations; missing evidence never means absent resources."""
    gate_id = result["id"]
    missing: list[str] = []
    sealed = None
    manifest_ref = result.get("runManifest")
    try:
        parent = ArtifactRef.from_dict(manifest_ref)
        sealed = store.read_run_manifest(
            parent, manifest_sha256=parent.sha256, expected_gate_id=gate_id,
        )
        if sealed.get("source") != source:
            missing.append("runManifest.source: mismatch")
            sealed = None
    except (TypeError, ValueError, OSError, RuntimeError):
        missing.append("runManifest: missing or invalid")
    observation = sealed.get("result", {}) if sealed else {}
    for key in ("status", "completionStatus", "proofStatus", "reason", "blockedReason", "blockedResource", "requiredGateIds"):
        if sealed and result.get(key) != observation.get(key):
            missing.append(f"runManifest.result.{key}: mismatch")

    evidence: list[dict] = []
    runtime: dict = {}
    deployments: list[dict] = []
    source_ref = observation.get("sourceArtifact")
    if not isinstance(source_ref, dict):
        missing.append("sourceArtifact: immutable observation missing")
    candidates = [{"path": source_ref, "artifactKind": observation.get("sourceArtifactKind")}]
    if not isinstance(source_ref, dict):
        candidates = []
    candidates += observation.get("evidenceArtifacts", [])
    seen: set[str] = set()
    for item in candidates:
        reference = item.get("path")
        if not isinstance(reference, dict):
            continue
        identity = json.dumps(reference, sort_keys=True)
        if identity in seen:
            continue
        seen.add(identity)
        try:
            ref = ArtifactRef.from_dict(reference)
            if (
                (ref.workspace_id, ref.gate_id, ref.run_id)
                != (parent.workspace_id, parent.gate_id, parent.run_id)
                or reference not in sealed.get("artifacts", {}).values()
            ):
                raise ValueError("artifact outside sealed Gate inventory")
            payload = store.read_json(ref)
        except (TypeError, ValueError, OSError, RuntimeError):
            missing.append(f"evidence: invalid {reference.get('path', '<unknown>')}")
            continue
        evidence.append({"artifact": reference, "kind": payload.get("artifactKind")})
        if payload.get("artifactKind") == "acceptance-runtime-manifest":
            runtime = {
                key: payload[key] for key in (
                    "environmentId", "profile", "state", "source", "services", "clients",
                ) if key in payload
            }
        if "service-deployment-attestation" in {item.get("artifactKind"), payload.get("artifactKind")}:
            deployments.append({
                "artifact": reference,
                "observed": {
                    key: payload[key] for key in (
                        "serviceId", "serviceKind", "endpoint", "deploymentEnvironment",
                        "commit", "workspaceDigest", "producer", "capturedAt",
                    ) if key in payload
                },
                "candidateSource": source,
            })

    diagnostic = observation.get("diagnostic", {})
    if not isinstance(diagnostic, dict):
        diagnostic = {}
    reason = observation.get("blockedReason") or observation.get("reason")
    required = observation.get("requiredGateIds", [])
    if not reason:
        missing.append("reason")
    if not observation.get("sourcePhase"):
        missing.append("producerPhase")
    if not required and not observation.get("blockedResource"):
        missing.append("resource")
    if not required:
        for field in ("owner", "recoveryAction"):
            if not isinstance(diagnostic.get(field), str) or not diagnostic[field].strip():
                missing.append(field)
        checks = diagnostic.get("resourceChecks")
        if not isinstance(checks, list) or not checks:
            missing.append("resourceChecks")
        else:
            for index, check in enumerate(checks):
                valid = (
                    isinstance(check, dict)
                    and isinstance(check.get("resource"), str) and bool(check["resource"].strip())
                    and "expected" in check
                    and (
                        check.get("state") == "OBSERVED" and "observed" in check
                        or check.get("state") == "NOT_EVALUATED" and bool(check.get("reason"))
                    )
                    and check.get("evidenceArtifact") in [item["artifact"] for item in evidence]
                )
                if not valid:
                    missing.append(f"resourceChecks[{index}]: invalid or unverified")
            if not any(
                isinstance(check, dict) and check.get("resource") == observation.get("blockedResource")
                for check in checks
            ):
                missing.append("resourceChecks: blocked resource not covered")
    return redact_value({
        "gateId": gate_id,
        "status": observation.get("status", result.get("status")),
        "reason": reason,
        "reportedReason": result.get("blockedReason") or result.get("reason"),
        "resource": observation.get("blockedResource"),
        "requiredGateIds": required,
        "producerPhase": observation.get("sourcePhase"),
        "contract": observation.get("sourceGate"),
        "sourceArtifact": source_ref,
        "runManifest": manifest_ref,
        "runtime": runtime,
        "deployments": deployments,
        "evidence": evidence,
        "owner": diagnostic.get("owner"),
        "recoveryAction": diagnostic.get("recoveryAction"),
        "resourceChecks": diagnostic.get("resourceChecks"),
        "unrecordedChecks": (
            "No resource-check record was emitted; availability and later checks "
            "remain unknown. Empty services/clients are not an absence finding."
            if not diagnostic.get("resourceChecks") else None
        ),
        "missingFields": missing,
    })


def diagnostic_projection(run: dict, store: Any) -> dict:
    results = run.get("results", [])
    by_id = {result["id"]: result for result in results}
    if len(by_id) != len(results):
        raise ValueError("report contains duplicate Gate results")
    nodes = {
        gate_id: result_diagnostic(result, run.get("source", {}), store)
        for gate_id, result in by_id.items() if incomplete(result)
    }

    def roots(gate_id: str, chain: tuple[str, ...]) -> list[dict]:
        path = [*chain, gate_id]
        if gate_id in chain:
            return [{"chain": path, "gateId": gate_id, "gap": "dependency cycle"}]
        node = nodes.get(gate_id)
        if node is None:
            return [{"chain": path, "gateId": gate_id, "gap": "missing incomplete producer result"}]
        if node["requiredGateIds"]:
            return [
                root for producer in node["requiredGateIds"]
                for root in roots(producer, tuple(path))
            ]
        return [{
            "chain": path, "gateId": gate_id, "resource": node["resource"],
            "reason": node["reason"], "sourceArtifact": node["sourceArtifact"],
            "runManifest": node["runManifest"],
        }]

    for gate_id, node in nodes.items():
        node["rootBlockers"] = roots(gate_id, ())
        for root in node["rootBlockers"]:
            if root.get("gap"):
                node["missingFields"].append(root["gap"])
            elif root["gateId"] != gate_id:
                node["missingFields"].extend(
                    f"root:{root['gateId']}:{field}"
                    for field in nodes[root["gateId"]]["missingFields"]
                    if not field.startswith("root:")
                )
        node["missingFields"] = sorted(set(node["missingFields"]))
        node["diagnosticStatus"] = "DIAGNOSTIC_INCOMPLETE" if node["missingFields"] else "COMPLETE"
    return {
        "artifactKind": "acceptance-run-diagnostics",
        "observationSource": run.get("source", {}),
        "evidenceClass": "SUPPORTING_OBSERVATION",
        "diagnosticStatus": (
            "DIAGNOSTIC_INCOMPLETE"
            if not results or any(node["missingFields"] for node in nodes.values()) else "COMPLETE"
        ),
        "incompleteGateCount": len(nodes),
        "diagnosticallyIncompleteGateCount": sum(bool(node["missingFields"]) for node in nodes.values()),
        "results": list(nodes.values()),
    }


def inline(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, (dict, list)) else str(value)
    return "`" + redact_text(text).replace("`", "&#96;").replace(chr(10), " ") + "`"


def render_report(plan: dict, run: dict, diagnostics: dict) -> str:
    lines = [
        "# Acceptance Report", "",
        f"Diagnostic status: {diagnostics['diagnosticStatus']}.",
        f"Observed source: {inline(run.get('source', {}))}.",
        "This report projects recorded observations; it does not renew historical PASS or prove current product readiness.",
        "", "## Changed Paths", "",
    ]
    lines.extend(f"- {inline(path)}" for path in plan.get("changed_paths", []))
    if not plan.get("changed_paths"):
        lines.append("- none")
    lines.extend(["", "## Impacted Features", ""])
    lines.extend(f"- {inline(feature)}" for feature in plan.get("impacted_features", []))
    if not plan.get("impacted_features"):
        lines.append("- none")
    lines.extend(["", "## Selected Gates", ""])
    for gate in plan.get("selected_gates", []):
        lines.append(
            f"- {inline(gate['id'])} [{gate.get('tier', 'local-evidence')}/"
            f"{gate.get('environment', 'local')}]: {inline(gate_invocation(gate))}"
        )
    if not plan.get("selected_gates"):
        lines.append("- none")
    lines.extend(["", "## Run Results", ""])
    for result in run.get("results", []):
        lines.append(
            f"- {inline(result['id'])}: {inline(result['status'])}; "
            f"proof={inline(result.get('proofStatus', 'UNPROVEN'))}; "
            f"log={inline(result.get('log'))}"
        )
    if not run.get("results"):
        lines.append("- not run")
    lines.extend(["", "## Incomplete Result Diagnostics", ""])
    for node in diagnostics["results"]:
        lines.extend(["", f"### {node['gateId']}", ""])
        for label, key in (
            ("Diagnostic status", "diagnosticStatus"), ("Recorded reason", "reason"),
            ("Input reported reason", "reportedReason"), ("Resource", "resource"),
            ("Producer phase", "producerPhase"), ("Contract", "contract"),
            ("Owner", "owner"), ("Recovery action", "recoveryAction"),
            ("Runtime observations", "runtime"), ("Resource checks", "resourceChecks"),
            ("Unrecorded checks", "unrecordedChecks"), ("Missing diagnostics", "missingFields"),
            ("Source artifact", "sourceArtifact"), ("Sealed Gate result", "runManifest"),
        ):
            lines.append(f"- {label}: {inline(node[key])}")
        for deployment in node["deployments"]:
            lines.append(f"- Deployment observation: {inline(deployment)}")
        for root in node["rootBlockers"]:
            lines.append(f"- Root dependency: {inline(root)}")
    return redact_text("\n".join(lines) + "\n")


def main() -> int:
    from tooling.acceptance.core import RUN_GATE_ENV, ArtifactSession, EvidenceStore

    parser = argparse.ArgumentParser()
    parser.add_argument("--plan")
    parser.add_argument("--run")
    parser.add_argument(
        "--require-diagnostics", action="store_true",
        help="exit 2 when incomplete results lack actionable, verified diagnostics",
    )
    args = parser.parse_args()
    store = EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT)
    plan = load(Path(args.plan)) if args.plan else store.read_json(
        store.latest_artifact_ref("acceptance-plan", "plan")
    )
    run = load(Path(args.run)) if args.run else store.read_json(
        store.latest_artifact_ref("acceptance-run", "run")
    )
    diagnostics = diagnostic_projection(run, store)
    diagnostic_complete = diagnostics["diagnosticStatus"] == "COMPLETE"
    gate_id = os.environ.get(RUN_GATE_ENV) or "acceptance-report"
    with ArtifactSession(repo_root=REPO_ROOT, gate_id=gate_id) as session:
        diagnostic_ref = session.write_json("reports/diagnostics.json", diagnostics, role="diagnostics")
        reference = session.write_bytes(
            "reports/acceptance-report.md", render_report(plan, run, diagnostics).encode("utf-8"),
            media_type="text/markdown", role="report",
        )
        session.complete(
            status="passed" if diagnostic_complete else "blocked",
            completion_status="DONE" if diagnostic_complete else "PARTIAL",
            proof_status="NOT_APPLICABLE",
            runtime={
                "diagnostics": diagnostic_ref.to_dict(),
                "diagnosticStatus": diagnostics["diagnosticStatus"],
                "observationSource": run.get("source", {}),
            },
        )
    print(f"acceptance report: {json.dumps(reference.to_dict(), sort_keys=True)}")
    print(f"diagnostic status: {diagnostics['diagnosticStatus']}")
    return 2 if args.require_diagnostics and not diagnostic_complete else 0


if __name__ == "__main__":
    raise SystemExit(main())
