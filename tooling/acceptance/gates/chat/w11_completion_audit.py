#!/usr/bin/env python3
"""W11 closure gate: mechanical completion audit driven by closure contract.

Verifies that every deliverable in the closure contract has corresponding
passing evidence:
  - Scan deliverables (path-absent, source-scan, http-route-absent,
    tauri-command-absent, no-duplicate-symbol) are verified by the
    forbidden-scan and duplicate-scan gates passing.
  - Gate deliverables (gates-passed, gate-passed) have passing report
    files with PASS status and zero failed assertions.

This gate is deterministic — it does not perform AI-style judgment.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from tooling.acceptance.core.evidence_store import (
    ArtifactRef,
    ArtifactSession,
    EvidenceStore,
    source_identity,
    workspace_id,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
REPORTS_DIR = REPO_ROOT / "tooling" / "acceptance" / "reports"
MANIFEST_PATH = Path(
    os.environ.get(
        "PT_W11_CONTRACT_MANIFEST",
        str(REPO_ROOT / "tooling" / "acceptance" / "reports" / "w11-contract-manifest.json"),
    )
)
CONTRACT_PATH = Path(
    os.environ.get(
        "PT_W11_CONTRACT",
        str(REPO_ROOT / "tooling" / "acceptance" / "closures" / "messaging-w11.yaml"),
    )
)
GATES_PATH = REPO_ROOT / "tooling" / "acceptance" / "gates.yaml"

SCAN_GATE_MAP = {
    "path-absent": "chat-w11-forbidden-scan",
    "source-scan": "chat-w11-forbidden-scan",
    "http-route-absent": "chat-w11-forbidden-scan",
    "tauri-command-absent": "chat-w11-forbidden-scan",
    "no-duplicate-symbol": "chat-w11-duplicate-scan",
}
CURRENT_RESULTS_ENV = "PT_ACCEPTANCE_CURRENT_RESULTS"
AGGREGATE_SOURCE_ENV = "PT_ACCEPTANCE_AGGREGATE_SOURCE"


def load_aggregate_source_identity(raw: str) -> dict[str, str]:
    try:
        source = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise AssertionError("aggregate source identity is missing or malformed") from error
    required = ("commit", "workspaceDigest", "canonicalWorktreeHash")
    if not isinstance(source, dict) or any(
        not isinstance(source.get(field), str) or not source[field]
        for field in required
    ):
        raise AssertionError("aggregate source identity is missing or malformed")
    if source["workspaceDigest"] != "clean":
        raise AssertionError("aggregate source identity is not clean")
    return {field: source[field] for field in required}


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        print(
            f"FAIL: contract manifest not found at {MANIFEST_PATH}. "
            "Run acceptance-closure-gen.py first.",
            file=sys.stderr,
        )
        sys.exit(2)
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def load_gate_evidence(
    store: EvidenceStore,
    gate_id: str,
    *,
    aggregate_result: dict[str, Any],
    expected_source: dict[str, str],
    runtime_cell: str | None = None,
    require_report: bool = False,
) -> dict:
    manifest_ref = ArtifactRef.from_dict(aggregate_result.get("runManifest", {}))
    if (
        manifest_ref.workspace_id != store.workspace_id
        or manifest_ref.gate_id != gate_id
        or manifest_ref.path != "manifest.json"
    ):
        raise AssertionError(
            f"{gate_id}: aggregate result has no matching immutable run manifest"
        )
    manifest = store.read_json(manifest_ref)
    if (
        manifest.get("artifactKind") != "acceptance-run-manifest"
        or manifest.get("workspaceId") != store.workspace_id
        or manifest.get("gateId") != gate_id
        or manifest.get("runId") != manifest_ref.run_id
        or manifest.get("source") != expected_source
        or manifest.get("redaction", {}).get("status") != "passed"
    ):
        raise AssertionError(
            f"{gate_id}: immutable manifest identity does not match the current source"
        )
    result = manifest.get("result")
    if not isinstance(result, dict) or result.get("status") != "passed":
        status = result.get("status") if isinstance(result, dict) else None
        raise AssertionError(
            f"{gate_id}: immutable Gate status is {status!r}, expected 'passed'"
        )
    if result.get("completionStatus") != "DONE":
        raise AssertionError(
            f"{gate_id}: immutable Gate completionStatus is "
            f"{result.get('completionStatus')!r}, expected 'DONE'"
        )
    if result.get("proofStatus") != "PROVEN":
        raise AssertionError(
            f"{gate_id}: immutable Gate proofStatus is "
            f"{result.get('proofStatus')!r}, expected 'PROVEN'"
        )

    if runtime_cell is not None and result.get("runtimeCell") != runtime_cell:
        raise AssertionError(
            f"{gate_id}: immutable Gate runtime cell is "
            f"{result.get('runtimeCell')!r}, expected {runtime_cell!r}"
        )
    secret_scan = result.get("secretScan")
    if not isinstance(secret_scan, dict) or secret_scan.get("status") != "passed":
        raise AssertionError(f"{gate_id}: immutable Gate secret scan did not pass")

    accepted = {
        "gateId": gate_id,
        "runId": manifest["runId"],
        "runtimeCell": runtime_cell,
    }
    if not require_report:
        return accepted

    source_artifact = result.get("sourceArtifact")
    if (
        result.get("sourceArtifactKind") != "acceptance-gate-evidence-report"
        or not isinstance(source_artifact, dict)
    ):
        raise AssertionError(
            f"{gate_id}: immutable Gate has no canonical evidence report"
        )
    reference = ArtifactRef.from_dict(source_artifact)
    if (
        reference.workspace_id != store.workspace_id
        or reference.gate_id != gate_id
        or reference.run_id != manifest["runId"]
        or reference.to_dict()
        not in tuple(manifest.get("artifacts", {}).values())
    ):
        raise AssertionError(
            f"{gate_id}: canonical evidence report identity is inconsistent"
        )
    report = store.read_json(reference)
    environment_manifest = load_immutable_environment_manifest(
        store,
        manifest,
        gate_id=gate_id,
        expected_source=expected_source,
    )
    station_attestation = load_immutable_station_attestation(
        store,
        manifest,
        environment_manifest,
        gate_id=gate_id,
    )
    runtime_manifest_payload = result.get("runtimeCellManifest")
    if not isinstance(runtime_manifest_payload, dict):
        raise AssertionError(
            f"{gate_id}: immutable Gate has no runtime-cell manifest payload"
        )
    runtime_manifest_ref_value = runtime_manifest_payload.get("_manifest_ref")
    if not isinstance(runtime_manifest_ref_value, dict):
        raise AssertionError(
            f"{gate_id}: runtime-cell manifest has no immutable artifact reference"
        )
    runtime_manifest_ref = ArtifactRef.from_dict(runtime_manifest_ref_value)
    if (
        runtime_manifest_ref.workspace_id != store.workspace_id
        or runtime_manifest_ref.gate_id != gate_id
        or runtime_manifest_ref.run_id != manifest["runId"]
        or runtime_manifest_ref.to_dict()
        not in tuple(manifest.get("artifacts", {}).values())
    ):
        raise AssertionError(
            f"{gate_id}: runtime-cell manifest artifact identity is inconsistent"
        )
    immutable_runtime_manifest = store.read_json(runtime_manifest_ref)
    errors = check_report_status(report, gate_id)
    errors.extend(
        compare_runtime_manifest_identity(
            runtime_manifest_payload,
            immutable_runtime_manifest,
            label=f"{gate_id}: runner runtime-cell manifest",
        )
    )
    errors.extend(
        check_native_report_identity(
            report,
            gate_id,
            expected_source=expected_source,
            runtime_cell=runtime_cell or "",
            expected_runtime_manifest=immutable_runtime_manifest,
            expected_station_attestation=station_attestation,
        )
    )
    if errors:
        raise AssertionError("; ".join(errors))
    accepted["sourceArtifact"] = reference.to_dict()
    return accepted


def load_report(path: Path) -> dict:
    if not path.exists():
        raise AssertionError(f"report missing: {path.relative_to(REPO_ROOT)}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AssertionError(f"report unreadable: {path.relative_to(REPO_ROOT)}: {exc}")


def load_immutable_environment_manifest(
    store: EvidenceStore,
    gate_manifest: dict[str, Any],
    *,
    gate_id: str,
    expected_source: dict[str, str],
) -> dict[str, Any]:
    result = gate_manifest.get("result")
    payload = result.get("manifest") if isinstance(result, dict) else None
    reference_value = (
        payload.get("_manifest_ref")
        if isinstance(payload, dict)
        else None
    )
    if not isinstance(reference_value, dict):
        raise AssertionError(
            f"{gate_id}: Gate has no immutable environment-manifest reference"
        )
    reference = ArtifactRef.from_dict(reference_value)
    if (
        reference.workspace_id != store.workspace_id
        or reference.gate_id != gate_id
        or reference.run_id != gate_manifest.get("runId")
        or reference.to_dict()
        not in tuple(gate_manifest.get("artifacts", {}).values())
    ):
        raise AssertionError(
            f"{gate_id}: environment-manifest artifact identity is inconsistent"
        )
    immutable = store.read_json(reference)
    if (
        immutable.get("artifactKind") != "acceptance-runtime-manifest"
        or immutable.get("gateId") != gate_id
        or immutable.get("state") != "FIXTURE_READY"
        or not source_identities_match(
            immutable.get("source"),
            expected_source,
        )
    ):
        raise AssertionError(
            f"{gate_id}: immutable environment manifest identity is invalid"
        )
    return immutable


def load_immutable_station_attestation(
    store: EvidenceStore,
    gate_manifest: dict[str, Any],
    environment_manifest: dict[str, Any],
    *,
    gate_id: str,
) -> dict[str, Any]:
    services = environment_manifest.get("services")
    station = services.get("station") if isinstance(services, dict) else None
    reference_value = (
        station.get("attestationArtifact")
        if isinstance(station, dict)
        else None
    )
    if not isinstance(reference_value, dict):
        raise AssertionError(
            f"{gate_id}: immutable Station attestation reference is missing"
        )
    reference = ArtifactRef.from_dict(reference_value)
    if (
        reference.workspace_id != store.workspace_id
        or reference.gate_id != gate_id
        or reference.run_id != gate_manifest.get("runId")
        or reference.to_dict()
        not in tuple(gate_manifest.get("artifacts", {}).values())
    ):
        raise AssertionError(
            f"{gate_id}: Station attestation artifact identity is inconsistent"
        )
    attestation = store.read_json(reference)
    if (
        attestation.get("artifactKind") != "service-deployment-attestation"
        or attestation.get("serviceId") != "station"
        or attestation.get("serviceKind") != "station"
    ):
        raise AssertionError(f"{gate_id}: immutable Station attestation is invalid")
    attestation["_artifact_ref"] = reference.to_dict()
    live_metadata = attestation.get("liveMetadata")
    station_errors = check_station_identity(
        station,
        live_metadata,
        attestation,
        expected_source=gate_manifest.get("source", {}),
        label=gate_id,
    )
    if station_errors:
        raise AssertionError("; ".join(station_errors))
    return attestation


def check_report_status(report: dict, label: str) -> list[str]:
    errors: list[str] = []
    status = report.get("status")
    if status != "PASS":
        errors.append(f"{label}: status is {status!r}, expected 'PASS'")
    if report.get("error"):
        errors.append(f"{label}: report contains error: {report['error']}")
    assertions = report.get("assertions", [])
    if not isinstance(assertions, list) or not assertions:
        errors.append(f"{label}: no assertions recorded")
    elif any(
        not isinstance(assertion, dict)
        or assertion.get("passed") is not True
        for assertion in assertions
    ):
        failed = [
            assertion.get("name", "?")
            if isinstance(assertion, dict)
            else "malformed"
            for assertion in assertions
            if not isinstance(assertion, dict)
            or assertion.get("passed") is not True
        ]
        if failed:
            errors.append(f"{label}: failed or malformed assertions: {failed}")
    return errors


def _nested_value(value: dict, path: tuple[str, ...]) -> object:
    current: object = value
    for part in path:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def source_identities_match(
    observed: object,
    expected: dict[str, str],
) -> bool:
    if not isinstance(observed, dict):
        return False
    if (
        observed.get("commit") != expected.get("commit")
        or observed.get("workspaceDigest") != expected.get("workspaceDigest")
    ):
        return False

    expected_worktree_hash = expected.get("canonicalWorktreeHash")
    observed_worktree_hash = observed.get("canonicalWorktreeHash")
    observed_worktree = observed.get("worktree")
    if not expected_worktree_hash or not (
        observed_worktree_hash or observed_worktree
    ):
        return False
    if (
        observed_worktree_hash
        and observed_worktree_hash != expected_worktree_hash
    ):
        return False
    if (
        observed_worktree
        and workspace_id(Path(str(observed_worktree)))
        != expected_worktree_hash
    ):
        return False
    return True


def compare_runtime_manifest_identity(
    observed: dict,
    immutable: dict,
    *,
    label: str,
) -> list[str]:
    identity_fields = (
        ("artifactKind",),
        ("cellId",),
        ("gateId",),
        ("runId",),
        ("state",),
        ("source", "mode"),
        ("source", "commit"),
        ("source", "workspaceDigest"),
        ("source", "remoteSourceDigest"),
        ("source", "remoteCheckoutClean"),
        ("source", "binarySha256"),
        ("platform", "os"),
        ("platform", "architecture"),
        ("platform", "isolationKind"),
        ("platform", "imageDigest"),
        ("transport", "kind"),
        ("transport", "hostIdentitySha256"),
        ("transport", "hostKeySha256"),
    )
    missing = [
        ".".join(path)
        for path in identity_fields
        if _nested_value(immutable, path) is None
    ]
    mismatched = [
        ".".join(path)
        for path in identity_fields
        if _nested_value(observed, path) != _nested_value(immutable, path)
    ]
    errors: list[str] = []
    if missing:
        errors.append(f"{label} immutable identity is incomplete: {missing}")
    if mismatched:
        errors.append(f"{label} identity mismatch: {mismatched}")
    return errors


def check_native_report_identity(
    report: dict,
    label: str,
    *,
    expected_source: dict[str, str],
    runtime_cell: str,
    expected_runtime_manifest: object,
    expected_station_attestation: object,
) -> list[str]:
    errors: list[str] = []
    runtime = report.get("runtime")
    if not isinstance(runtime, dict):
        return [f"{label}: runtime evidence is missing"]
    if runtime.get("runtimeCell") != runtime_cell:
        errors.append(f"{label}: report runtime cell identity mismatch")

    identity = runtime.get("sourceIdentity")
    if not isinstance(identity, dict):
        return errors + [f"{label}: report source identity is missing"]
    orchestrator = identity.get("orchestrator")
    station = identity.get("station")
    station_live = identity.get("stationLive")
    cell = identity.get("runtimeCell")
    binary = identity.get("binary")
    if not source_identities_match(orchestrator, expected_source):
        errors.append(f"{label}: report orchestrator source identity mismatch")
    errors.extend(
        check_station_identity(
            station,
            station_live,
            expected_station_attestation,
            expected_source=expected_source,
            label=label,
        )
    )
    if (
        not isinstance(cell, dict)
        or cell.get("artifactKind")
        != "acceptance-runtime-cell-manifest"
        or cell.get("cellId") != runtime_cell
        or cell.get("gateId") != label
        or not cell.get("runId")
        or cell.get("runId") != runtime.get("runtimeCellRunId")
        or cell.get("state") != "LEASED"
    ):
        errors.append(f"{label}: report runtime-cell manifest identity mismatch")
        return errors
    if not isinstance(expected_runtime_manifest, dict):
        errors.append(
            f"{label}: immutable runtime-cell manifest is missing"
        )
    else:
        errors.extend(
            compare_runtime_manifest_identity(
                cell,
                expected_runtime_manifest,
                label=f"{label}: report runtime-cell",
            )
        )

    cell_source = cell.get("source")
    binary_digest = (
        str(binary.get("sha256") or "")
        if isinstance(binary, dict)
        else ""
    )
    if (
        not isinstance(binary, dict)
        or binary.get("sourceCommit") != expected_source.get("commit")
        or re.fullmatch(r"[0-9a-f]{64}", binary_digest) is None
        or not isinstance(cell_source, dict)
        or cell_source.get("commit") != expected_source.get("commit")
        or cell_source.get("workspaceDigest") != "clean"
        or cell_source.get("binarySha256") != binary_digest
    ):
        errors.append(f"{label}: report source or binary identity mismatch")
    if runtime_cell == "desktop-linux-native":
        platform = cell.get("platform")
        transport = cell.get("transport")
        if (
            not isinstance(cell_source, dict)
            or cell_source.get("remoteCheckoutClean") is not True
            or re.fullmatch(
                r"[0-9a-f]{64}",
                str(cell_source.get("remoteSourceDigest") or ""),
            )
            is None
            or not isinstance(platform, dict)
            or re.fullmatch(
                r"[0-9a-f]{64}",
                str(platform.get("imageDigest") or ""),
            )
            is None
            or not isinstance(transport, dict)
            or re.fullmatch(
                r"[0-9a-f]{64}",
                str(transport.get("hostIdentitySha256") or ""),
            )
            is None
            or re.fullmatch(
                r"[0-9a-f]{64}",
                str(transport.get("hostKeySha256") or ""),
            )
            is None
        ):
            errors.append(f"{label}: Linux runtime attestation is incomplete")
    return errors


def gate_report_filename(gate_id: str) -> str:
    return gate_id.replace("chat-native-", "chat-native-").replace("-e2e", "-run") + ".json"


def _station_live_commit(station_live: object) -> str:
    if not isinstance(station_live, dict):
        return ""
    return str(
        station_live.get("build_commit")
        or station_live.get("buildCommit")
        or ""
    )


def commit_identities_match(left: str, right: str) -> bool:
    if (
        re.fullmatch(r"[0-9a-f]{7,40}", left) is None
        or re.fullmatch(r"[0-9a-f]{7,40}", right) is None
    ):
        return False
    return left.startswith(right) or right.startswith(left)


def check_station_identity(
    station: object,
    station_live: object,
    immutable_attestation: object,
    *,
    expected_source: dict[str, str],
    label: str,
) -> list[str]:
    if not isinstance(station, dict):
        return [f"{label}: report Station attestation is missing"]
    if not isinstance(station_live, dict):
        return [f"{label}: report live Station identity is missing"]
    if not isinstance(immutable_attestation, dict):
        return [f"{label}: immutable Station attestation is missing"]

    live_metadata = immutable_attestation.get("liveMetadata")
    attested_live_commit = (
        str(live_metadata.get("buildCommit") or "")
        if isinstance(live_metadata, dict)
        else ""
    )
    expected_commit = str(expected_source.get("commit") or "")
    expected_fields = {
        "kind": immutable_attestation.get("serviceKind"),
        "endpoint": immutable_attestation.get("endpoint"),
        "deploymentEnvironment": immutable_attestation.get(
            "deploymentEnvironment"
        ),
        "liveCommit": immutable_attestation.get("commit"),
        "workspaceDigest": immutable_attestation.get("workspaceDigest"),
        "protocolDigest": immutable_attestation.get("protocolDigest"),
    }
    mismatched = [
        field
        for field, expected in expected_fields.items()
        if expected is None or station.get(field) != expected
    ]
    if station.get("attestationArtifact") != immutable_attestation.get(
        "_artifact_ref"
    ):
        mismatched.append("attestationArtifact")
    errors: list[str] = []
    if mismatched:
        errors.append(
            f"{label}: report Station attestation mismatch: {sorted(set(mismatched))}"
        )
    if (
        immutable_attestation.get("workspaceDigest") != "clean"
        or immutable_attestation.get("commit") != expected_commit
        or not commit_identities_match(attested_live_commit, expected_commit)
        or not commit_identities_match(
            _station_live_commit(station_live),
            attested_live_commit,
        )
    ):
        errors.append(
            f"{label}: report live Station identity does not match immutable "
            "attestation/current source"
        )
    return errors


def canonical_gate_union(diff_range: str) -> set[str]:
    script_path = REPO_ROOT / "tooling" / "scripts" / "acceptance-plan.py"
    spec = importlib.util.spec_from_file_location(
        "w11_acceptance_plan",
        script_path,
    )
    if spec is None or spec.loader is None:
        raise AssertionError("canonical Acceptance planner cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    scripts_path = str(script_path.parent)
    sys.path.insert(0, scripts_path)
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(scripts_path)
    changed_paths = module.changed_paths(diff_range)
    plan = module.plan(REPO_ROOT / "tooling" / "acceptance", changed_paths)
    selected = plan.get("selected_gates")
    if not isinstance(selected, list) or not selected:
        raise AssertionError(
            f"canonical exact-range plan {diff_range!r} selected no Gates"
        )
    return {
        str(gate.get("id") if isinstance(gate, dict) else gate)
        for gate in selected
    }


def immutable_results_by_gate(
    raw_results: str,
    *,
    expected_gates: set[str],
    allowed_supplemental_gates: set[str],
) -> dict[str, dict[str, Any]]:
    try:
        values = json.loads(raw_results)
    except json.JSONDecodeError as error:
        raise AssertionError("parent aggregate results are malformed") from error
    if not isinstance(values, list):
        raise AssertionError("parent aggregate results must be a list")

    by_gate: dict[str, dict[str, Any]] = {}
    for value in values:
        if not isinstance(value, dict):
            raise AssertionError("parent aggregate contains a malformed result")
        gate_id = value.get("id")
        if not isinstance(gate_id, str) or not gate_id:
            raise AssertionError("parent aggregate result has no Gate identity")
        if gate_id in by_gate:
            raise AssertionError(
                f"parent aggregate contains duplicate Gate {gate_id!r}"
            )
        by_gate[gate_id] = value

    observed = set(by_gate)
    missing = sorted(expected_gates - observed)
    unexpected = sorted(observed - expected_gates - allowed_supplemental_gates)
    if missing or unexpected:
        raise AssertionError(
            "parent aggregate does not match the canonical exact-range Gate "
            f"union: missing={missing}, unexpected={unexpected}"
        )
    return by_gate


def runtime_cell_gates(
    gate_ids: set[str],
    *,
    runtime_cell: str,
) -> set[str]:
    definitions = json.loads(GATES_PATH.read_text(encoding="utf-8")).get(
        "gates",
        {},
    )
    return {
        gate_id
        for gate_id in gate_ids
        if runtime_cell
        in definitions.get(gate_id, {}).get("requiredRuntimeCells", [])
    }


def main() -> int:
    manifest = load_manifest()
    store = EvidenceStore.from_environment(repo_root=REPO_ROOT, worktree=REPO_ROOT)
    observed_source = source_identity(REPO_ROOT)
    errors: list[str] = []
    try:
        expected_source = load_aggregate_source_identity(
            os.environ.get(AGGREGATE_SOURCE_ENV, "")
        )
    except AssertionError as error:
        errors.append(str(error))
        expected_source = {}
    if expected_source and observed_source != expected_source:
        errors.append(
            "aggregate source drift detected: "
            f"expected={expected_source} observed={observed_source}"
        )
    claimed_runtime_cell = manifest.get("claimed_runtime_cell")
    if not isinstance(claimed_runtime_cell, str) or not claimed_runtime_cell:
        print("FAIL: W11 contract manifest has no claimed runtime cell")
        return 1
    canonical_range = manifest.get("canonical_range")
    if not isinstance(canonical_range, str) or "..." not in canonical_range:
        print("FAIL: W11 contract manifest has no canonical three-dot Git range")
        return 1
    retained_gates_value = manifest.get("retained_gates")
    if (
        not isinstance(retained_gates_value, list)
        or any(
            not isinstance(gate_id, str) or not gate_id
            for gate_id in retained_gates_value
        )
    ):
        print("FAIL: W11 contract manifest has invalid retained Gates")
        return 1
    retained_gates = set(retained_gates_value)
    targets = manifest.get("scan_targets", {})
    accepted_gates: list[dict] = []
    passed_reports: list[str] = []
    verified_deliverables: list[str] = []

    required_gates: set[str] = set()
    scan_gates_needed: set[str] = set()
    planned_gates: set[str] = set()

    for did, target in targets.items():
        vtype = target.get("type", "")
        if vtype in SCAN_GATE_MAP:
            scan_gates_needed.add(SCAN_GATE_MAP[vtype])
            verified_deliverables.append(did)
        elif vtype == "gates-passed":
            for gid in target.get("gates", []):
                required_gates.add(gid)
        elif vtype == "gate-passed":
            gid = target.get("gate", "")
            if gid:
                required_gates.add(gid)

    required_gates.discard("chat-w11-completion-audit")
    try:
        planned_gates = canonical_gate_union(canonical_range)
        expected_aggregate_gates = planned_gates | retained_gates
        if required_gates != expected_aggregate_gates:
            missing = sorted(expected_aggregate_gates - required_gates)
            unexpected = sorted(required_gates - expected_aggregate_gates)
            raise AssertionError(
                "closure contract does not match the canonical exact-range "
                "Gate union plus retained obligations: "
                f"missing={missing}, unexpected={unexpected}"
            )
        aggregate_results = immutable_results_by_gate(
            os.environ.get(CURRENT_RESULTS_ENV, ""),
            expected_gates=expected_aggregate_gates,
            allowed_supplemental_gates=scan_gates_needed,
        )
        native_gates = runtime_cell_gates(
            planned_gates,
            runtime_cell=claimed_runtime_cell,
        )
    except Exception as exc:
        errors.append(str(exc))
        aggregate_results = {}
        native_gates = set()

    for gate_id in sorted(scan_gates_needed):
        try:
            accepted_gates.append(
                load_gate_evidence(
                    store,
                    gate_id,
                    aggregate_result=aggregate_results[gate_id],
                    expected_source=expected_source,
                )
            )
        except Exception as exc:
            errors.append(f"scan gate {gate_id!r} evidence unavailable: {exc}")

    for gate_id in sorted(required_gates):
        if gate_id == "chat-w11-completion-audit":
            continue
        try:
            native_gate = gate_id in native_gates
            accepted_gates.append(
                load_gate_evidence(
                    store,
                    gate_id,
                    aggregate_result=aggregate_results[gate_id],
                    expected_source=expected_source,
                    runtime_cell=(
                        claimed_runtime_cell if native_gate else None
                    ),
                    require_report=native_gate,
                )
            )
        except Exception as exc:
            errors.append(str(exc))

    passed = not errors
    closure_verdict = {
        "artifactKind": "chat-w11-closure-verdict",
        "status": "PASS" if passed else "FAIL",
        "completionStatus": "DONE" if passed else "PARTIAL",
        "proofStatus": "PROVEN" if passed else "UNPROVEN",
        "contract": str(CONTRACT_PATH.relative_to(REPO_ROOT)),
        "source": expected_source,
        "observedSource": observed_source,
        "claimedRuntimeCell": claimed_runtime_cell,
        "canonicalRange": canonical_range,
        "canonicalGateUnion": sorted(planned_gates),
        "retainedGateObligations": sorted(retained_gates),
        "unprovenRuntimeCells": [
            cell
            for cell in (
                "desktop-macos-native",
                "desktop-windows-native",
            )
            if cell != claimed_runtime_cell
        ],
        "verifiedDeliverables": verified_deliverables,
        "acceptedGates": accepted_gates,
        "nativeReports": passed_reports,
        "errors": errors,
        "remainingClosureStep": "independent review (pt-github-review)",
        "phase": "MP-W11",
        "bom": ["MP-W11"],
        "spec": ["messaging-w11-closure"],
        "gate": "chat-w11-completion-audit",
    }
    with ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id="chat-w11-completion-audit",
        source=observed_source,
    ) as session:
        reference = session.write_json(
            "reports/chat-w11-closure-verdict.json",
            closure_verdict,
            role="closure-verdict",
        )
        session.complete(
            status="passed" if passed else "failed",
            completion_status="DONE" if passed else "PARTIAL",
            proof_status="PROVEN" if passed else "UNPROVEN",
            runtime={"claimedRuntimeCell": claimed_runtime_cell},
        )

    if errors:
        print("FAIL: W11 completion audit found gaps:")
        for err in errors:
            print(f"  - {err}")
        return 1

    closure_verdict = {
        "artifactKind": "chat-w11-closure-verdict",
        "status": "PASS",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "contract": str(CONTRACT_PATH.relative_to(REPO_ROOT)),
        "verifiedDeliverables": verified_deliverables,
        "nativeReports": passed_reports,
        "remainingClosureStep": "independent review (pt-github-review)",
    }
    out = REPORTS_DIR / "chat-w11-closure-verdict.json"
    out.write_text(json.dumps(closure_verdict, indent=2) + "\n", encoding="utf-8")
    print(
        f"PASS: W11 completion audit — {len(verified_deliverables)} scan "
        f"deliverables, {len(passed_reports)} gate reports verified"
    )
    print(f"  Verdict: {out.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
