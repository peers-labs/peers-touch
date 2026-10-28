"""Canonical, read-only acceptance proof assessment.

EvidenceStore verifies immutable inventory and publication authority. Business
Oracles own which assertions are required; Core rejects incomplete or failed
observations and never treats a caller's PASS label as evidence.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .errors import EvidenceManifestInvalid
from .evidence_store import ArtifactRef, EvidenceStore, canonical_secret_scan
from .finalization_contracts import LatestAuthorityMode


class ProofSourceMismatch(EvidenceManifestInvalid):
    pass


class ProofIncomplete(EvidenceManifestInvalid):
    pass


def assertions_pass(assertions: object) -> bool:
    return (
        isinstance(assertions, list)
        and bool(assertions)
        and all(
            isinstance(item, Mapping)
            and isinstance(item.get("name"), str)
            and bool(item["name"])
            and item.get("passed") is True
            for item in assertions
        )
    )


def require_report_proof(report: Mapping[str, Any], gate_id: str) -> None:
    if (
        report.get("artifactKind") != "acceptance-gate-evidence-report"
        or report.get("gateId") != gate_id
        or report.get("status") not in {"PASS", "passed"}
        or report.get("completionStatus") != "DONE"
        or report.get("proofStatus") != "PROVEN"
        or report.get("error")
        or not assertions_pass(report.get("assertions"))
    ):
        raise ProofIncomplete(f"{gate_id}: source report is unproven")


def read_gate_proof(
    store: EvidenceStore,
    gate_id: str,
    source: Mapping[str, str],
    *,
    result: Mapping[str, Any] | None = None,
    reference: ArtifactRef | None = None,
    gate_definition: Mapping[str, Any] | None = None,
    runtime_cell: str | None = None,
    require_latest: bool = False,
) -> dict[str, Any]:
    """Verify original proof, or select current authority for a coverage query.

    A supplied result must bind its original manifest. Latest is never a repair
    for missing original proof. Original prerequisite refs remain valid when a
    newer legacy run is published; enforced finalizers use their sole authority.
    """
    definition = gate_definition or {}
    authority = None
    if result is not None:
        original = ArtifactRef.from_dict(result.get("runManifest"))
        if reference is not None and original != reference:
            raise EvidenceManifestInvalid(f"{gate_id}: original reference changed")
        reference = original
    if reference is None and runtime_cell is not None:
        reference = store.latest_manifest_ref(gate_id, runtime_cell=runtime_cell)
    if require_latest and runtime_cell is not None:
        if reference != store.latest_manifest_ref(gate_id, runtime_cell=runtime_cell):
            raise EvidenceManifestInvalid(f"{gate_id}: Runtime Cell authority changed")
        require_latest = False
    if reference is None or require_latest or "evidenceFinalizer" in definition:
        authority = store.authoritative_latest(gate_id)
        if "evidenceFinalizer" in definition and (
            authority.authority_mode is not LatestAuthorityMode.FINALIZER_ENFORCED
        ):
            raise EvidenceManifestInvalid(f"{gate_id}: finalizer authority is missing")
        if reference is None:
            if runtime_cell is None:
                reference = ArtifactRef.from_dict(authority.manifest_ref.to_dict())
            else:
                reference = store.latest_manifest_ref(gate_id, runtime_cell=runtime_cell)
        if (
            (runtime_cell is None or "evidenceFinalizer" in definition)
            and authority.manifest_ref.to_dict() != reference.to_dict()
        ):
            raise EvidenceManifestInvalid(f"{gate_id}: publication authority changed")
    if reference.workspace_id != store.workspace_id:
        raise EvidenceManifestInvalid(f"{gate_id}: proof workspace changed")
    store.validate_proof_authority(reference)
    manifest = store.read_run_manifest(
        reference, manifest_sha256=reference.sha256, expected_gate_id=gate_id,
    )
    if manifest.get("source") != dict(source):
        raise ProofSourceMismatch(f"{gate_id}: proof source changed")
    sealed = manifest.get("result")
    if not isinstance(sealed, dict) or any(
        sealed.get(key) != expected
        for key, expected in (
            ("status", "passed"), ("completionStatus", "DONE"),
            ("proofStatus", "PROVEN"),
        )
    ) or sealed.get("cleanupStatus") not in {"passed", "not-required"}:
        raise ProofIncomplete(f"{gate_id}: proof or cleanup is incomplete")
    if "id" in sealed and sealed["id"] != gate_id:
        raise EvidenceManifestInvalid(f"{gate_id}: sealed result identity changed")
    proof_fields = ("status", "completionStatus", "proofStatus", "cleanupStatus")
    if result is not None and (
        result.get("id") != gate_id
        or any(result.get(key) != sealed.get(key) for key in proof_fields)
        or any(
            result[key] != sealed.get(key)
            for key in (
                "sourceArtifact", "sourceArtifactKind", "runtimeCell", "manifest",
                "prerequisiteProofs", "secretScan", "evidenceGateId",
            )
            if key in result
        )
    ):
        raise EvidenceManifestInvalid(f"{gate_id}: result differs from original proof")
    if runtime_cell is not None and sealed.get("runtimeCell") != runtime_cell:
        raise EvidenceManifestInvalid(f"{gate_id}: Runtime Cell changed")
    scan = canonical_secret_scan(sealed.get("secretScan"))
    redaction = manifest.get("redaction")
    if scan["status"] != "passed" or not isinstance(redaction, dict) or (
        redaction.get("status") != "passed"
    ):
        raise ProofIncomplete(f"{gate_id}: evidence scans are incomplete")
    inventory = manifest["artifacts"]
    if not inventory:
        raise EvidenceManifestInvalid(f"{gate_id}: proof inventory is empty")
    if "assertions" in sealed and not assertions_pass(sealed["assertions"]):
        raise EvidenceManifestInvalid(f"{gate_id}: sealed assertions are incomplete")
    runtime = sealed.get("manifest")
    credentials = runtime.get("credentialRefs", []) if isinstance(runtime, dict) else []
    if (
        not isinstance(credentials, list)
        or any(not isinstance(item, str) for item in credentials)
        or scan["scannedCredentialValues"] < sum(
            item.startswith(("auto:", "env:", "file:")) for item in credentials
        )
    ):
        raise EvidenceManifestInvalid(f"{gate_id}: credential scan is incomplete")
    environment = "env-evidence" in {definition.get("tier"), sealed.get("tier")}
    source_ref = sealed.get("sourceArtifact")
    reports: dict[ArtifactRef, Any] = {}
    # Report labels and roles are caller-controlled. Inspect each unique JSON
    # artifact so omitting or redirecting sourceArtifact cannot hide our report.
    for value in inventory.values():
        artifact = ArtifactRef.from_dict(value)
        if artifact.media_type != "application/json" or artifact in reports:
            continue
        report = store.read_json_value(artifact)
        reports[artifact] = report
        if isinstance(report, dict) and (
            report.get("artifactKind") == "acceptance-gate-evidence-report"
            and report.get("gateId") == gate_id
        ):
            require_report_proof(report, gate_id)
    if source_ref is None and sealed.get("sourceArtifactKind") == "acceptance-gate-evidence-report":
        raise EvidenceManifestInvalid(f"{gate_id}: source report binding is missing")
    if source_ref is not None:
        if source_ref not in inventory.values():
            raise EvidenceManifestInvalid(f"{gate_id}: source report is not in inventory")
        artifact = ArtifactRef.from_dict(source_ref)
        report = reports[artifact] if artifact in reports else store.read_json(artifact)
        if not isinstance(report, dict):
            raise EvidenceManifestInvalid(f"{gate_id}: source report must be an object")
        if "acceptance-gate-evidence-report" in {
            report.get("artifactKind"), sealed.get("sourceArtifactKind"),
        }:
            require_report_proof(report, gate_id)
        elif environment:
            raise EvidenceManifestInvalid(f"{gate_id}: source report kind changed")
    if environment:
        if (
            source_ref is None
            or sealed.get("evidenceGateId") != gate_id
            or sealed.get("sourceArtifactKind") != "acceptance-gate-evidence-report"
            or not isinstance(runtime, dict)
            or runtime.get("state") != "FIXTURE_READY"
            or not runtime.get("runId")
            or runtime.get("source") != dict(source)
        ):
            raise EvidenceManifestInvalid(f"{gate_id}: runtime proof is incomplete")
    return manifest
