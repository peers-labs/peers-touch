from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any, Mapping

from tooling.acceptance.core import (
    ArtifactRef,
    EvidenceError,
    EvidenceStore,
    GateError,
)
from tooling.acceptance.gates.release.operation_contract import (
    validate_journey_set, validate_trace_binding,
)


SOURCE_FIELDS = ("commit", "workspaceDigest", "canonicalWorktreeHash")
OPERATION_ANALYSIS_GATE_ID = "release-0.0.1-operation-analysis"
OPERATION_REPORT_ROLE = "release-operation-analysis-report"
OPERATION_JOURNEY_COUNT = 18


@dataclass(frozen=True)
class GateInspection:
    gate_id: str
    run_id: str | None
    status: str
    detail: str
    manifest: dict[str, Any] | None = None

    def summary(self) -> dict[str, Any]:
        value = asdict(self)
        value.pop("manifest")
        return value


def parse_source_identity(
    value: object,
    *,
    require_clean: bool = True,
) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise GateError("release source identity must be an object")
    source = {
        field: value.get(field)
        for field in SOURCE_FIELDS
    }
    if any(not isinstance(item, str) or not item for item in source.values()):
        raise GateError("release source identity is incomplete")
    if require_clean and source["workspaceDigest"] != "clean":
        raise GateError("release source identity is not clean")
    return source  # type: ignore[return-value]


def parse_source_environment(
    raw: str,
    *,
    fallback: Mapping[str, str],
) -> dict[str, str]:
    if not raw:
        return parse_source_identity(fallback)
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise GateError("release aggregate source is malformed") from error
    return parse_source_identity(value)


def parse_current_results(
    raw: str,
    *,
    expected_source: Mapping[str, str],
) -> dict[str, dict[str, Any]]:
    if not raw:
        raise GateError("current Acceptance aggregate results are required")
    try:
        envelope = json.loads(raw)
    except json.JSONDecodeError as error:
        raise GateError("current Acceptance aggregate results are malformed") from error
    if (
        not isinstance(envelope, dict)
        or set(envelope) != {"source", "results"}
        or envelope.get("source") != dict(expected_source)
        or not isinstance(envelope.get("results"), list)
    ):
        raise GateError(
            "current Acceptance aggregate results do not match the release source"
        )
    results: dict[str, dict[str, Any]] = {}
    for item in envelope["results"]:
        if not isinstance(item, dict):
            raise GateError("current Acceptance aggregate contains a malformed result")
        gate_id = item.get("id")
        if not isinstance(gate_id, str) or not gate_id:
            raise GateError("current Acceptance aggregate result has no Gate ID")
        if gate_id in results:
            raise GateError(
                f"current Acceptance aggregate repeats Gate {gate_id!r}"
            )
        results[gate_id] = item
    return results


def validate_operation_analysis_report(
    value: Mapping[str, Any],
    *,
    store: EvidenceStore | None = None,
    expected_source: Mapping[str, str] | None = None,
) -> None:
    required = {
        "artifactKind": "acceptance-gate-evidence-report",
        "gateId": OPERATION_ANALYSIS_GATE_ID,
        "planId": "release-0.0.1-mobile-ios-desktop-acceptance-20261017",
        "status": "PASS",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "uxVerdict": "通过",
    }
    if any(value.get(key) != expected for key, expected in required.items()):
        raise GateError("operation analysis report is not a completed proof")
    if value.get("journeyCount") != OPERATION_JOURNEY_COUNT:
        raise GateError("operation analysis report has incomplete journey coverage")
    journeys = validate_journey_set(value.get("journeys"))
    if store is not None:
        source = parse_source_identity(expected_source or value.get("source"))
        if value.get("source") != source:
            raise GateError("operation analysis report source does not match")
        for journey in journeys:
            for field in ("interactionTrace", "screenshot"):
                validate_review_artifact(store, journey.get(field), expected_source=source)
            validate_trace_binding(store, journey, expected_source=source)
    if value.get("openBlockers"):
        raise GateError("operation analysis report still has release blockers")
    if not isinstance(value.get("roadmap"), Mapping):
        raise GateError("operation analysis report has no UX roadmap")


def _artifact_reference(
    store: EvidenceStore,
    raw: object,
    *,
    manifest: Mapping[str, Any],
    expected_gate_id: str,
    expected_run_id: str,
) -> ArtifactRef:
    try:
        reference = ArtifactRef.from_dict(raw)
    except (EvidenceError, TypeError, ValueError) as error:
        raise GateError("release evidence artifact reference is invalid") from error
    if (
        reference.workspace_id != store.workspace_id
        or reference.gate_id != expected_gate_id
        or reference.run_id != expected_run_id
        or reference.to_dict()
        not in tuple(manifest.get("artifacts", {}).values())
    ):
        raise GateError("release evidence artifact identity is inconsistent")
    store.resolve(reference)
    return reference


def validate_review_artifact(
    store: EvidenceStore,
    raw: object,
    *,
    expected_source: Mapping[str, str],
) -> dict[str, dict[str, str]]:
    try:
        if not isinstance(raw, Mapping) or set(raw) != {
            "artifact",
            "runManifest",
        }:
            raise GateError(
                "operation review evidence must include artifact and runManifest"
            )
        reference = ArtifactRef.from_dict(raw["artifact"])
        manifest_reference = ArtifactRef.from_dict(raw["runManifest"])
        if (
            manifest_reference.workspace_id != store.workspace_id
            or manifest_reference.gate_id != reference.gate_id
            or manifest_reference.run_id != reference.run_id
            or manifest_reference.path != "manifest.json"
        ):
            raise GateError("operation review run manifest identity is invalid")
        manifest = store.read_json(manifest_reference)
    except (EvidenceError, TypeError, ValueError) as error:
        raise GateError("operation review artifact is unavailable") from error
    run_id = manifest.get("runId")
    if (
        run_id != reference.run_id
        or manifest.get("artifactKind") != "acceptance-run-manifest"
        or manifest.get("state") != "DURABLE"
        or manifest.get("workspaceId") != store.workspace_id
        or manifest.get("gateId") != reference.gate_id
        or manifest.get("source") != dict(expected_source)
        or manifest.get("redaction", {}).get("status") != "passed"
    ):
        raise GateError(
            "operation review artifact is not current exact-source evidence"
        )
    _artifact_reference(
        store,
        reference.to_dict(),
        manifest=manifest,
        expected_gate_id=reference.gate_id,
        expected_run_id=reference.run_id,
    )
    return {
        "artifact": reference.to_dict(),
        "runManifest": manifest_reference.to_dict(),
    }


def artifact_by_role(
    store: EvidenceStore,
    manifest: Mapping[str, Any],
    role: str,
) -> tuple[ArtifactRef, dict[str, Any]]:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, Mapping) or role not in artifacts:
        raise GateError(f"release evidence is missing artifact role {role!r}")
    gate_id = manifest.get("gateId")
    run_id = manifest.get("runId")
    if not isinstance(gate_id, str) or not isinstance(run_id, str):
        raise GateError("release evidence manifest identity is invalid")
    reference = _artifact_reference(
        store,
        artifacts[role],
        manifest=manifest,
        expected_gate_id=gate_id,
        expected_run_id=run_id,
    )
    return reference, store.read_json(reference)


def _validate_cleanup(
    store: EvidenceStore,
    manifest: Mapping[str, Any],
    result: Mapping[str, Any],
) -> None:
    cleanup_status = result.get("cleanupStatus", "not-required")
    if cleanup_status not in {"passed", "not-required"}:
        raise GateError(
            f"cleanup status is {cleanup_status!r}, expected passed or not-required"
        )
    if cleanup_status == "not-required":
        return
    reference = _artifact_reference(
        store,
        result.get("cleanupArtifact"),
        manifest=manifest,
        expected_gate_id=str(manifest["gateId"]),
        expected_run_id=str(manifest["runId"]),
    )
    cleanup = store.read_json(reference)
    if (
        cleanup.get("artifactKind")
        != "acceptance-provisioner-cleanup-result"
        or cleanup.get("status") != "passed"
        or cleanup.get("completionStatus") != "DONE"
        or cleanup.get("proofStatus") != "PROVEN"
    ):
        raise GateError("immutable provisioner cleanup evidence did not pass")


def _validate_canonical_report(
    store: EvidenceStore,
    manifest: Mapping[str, Any],
    result: Mapping[str, Any],
) -> None:
    if result.get("sourceArtifactKind") != "acceptance-gate-evidence-report":
        raise GateError("environment Gate has no canonical product evidence report")
    reference = _artifact_reference(
        store,
        result.get("sourceArtifact"),
        manifest=manifest,
        expected_gate_id=str(manifest["gateId"]),
        expected_run_id=str(manifest["runId"]),
    )
    report = store.read_json(reference)
    if (
        report.get("artifactKind") != "acceptance-gate-evidence-report"
        or report.get("gateId") != manifest.get("gateId")
        or report.get("status") != "PASS"
        or report.get("completionStatus") not in {None, "DONE"}
        or report.get("proofStatus") not in {None, "PROVEN"}
        or report.get("sampleEmissionAllowed") is False
    ):
        raise GateError("canonical product evidence report is incomplete")


def inspect_gate(
    store: EvidenceStore,
    gate_id: str,
    *,
    expected_source: Mapping[str, str],
    current_result: Mapping[str, Any] | None = None,
    require_current_result: bool = False,
    require_canonical_report: bool = False,
    required_runtime_cells: tuple[str, ...] = (),
) -> GateInspection:
    try:
        if require_current_result:
            if current_result is None:
                return GateInspection(
                    gate_id,
                    None,
                    "MISSING",
                    "current aggregate result is missing",
                )
            reference = ArtifactRef.from_dict(current_result.get("runManifest", {}))
            if (
                reference.workspace_id != store.workspace_id
                or reference.gate_id != gate_id
                or reference.path != "manifest.json"
            ):
                raise GateError("current aggregate run manifest identity is invalid")
            manifest = store.read_json(reference)
            if (
                current_result.get("id") != gate_id
                or current_result.get("status") != "passed"
                or current_result.get("completionStatus") != "DONE"
                or current_result.get("proofStatus") != "PROVEN"
            ):
                raise GateError(
                    "current aggregate result is not passed/DONE/PROVEN"
                )
        else:
            manifest = store.latest(gate_id)
    except EvidenceError as error:
        return GateInspection(
            gate_id,
            None,
            (
                "MISSING"
                if "latest pointer is unavailable" in str(error)
                else "ERROR"
            ),
            str(error),
        )
    except (GateError, TypeError, ValueError) as error:
        return GateInspection(gate_id, None, "ERROR", str(error))

    run_id = manifest.get("runId")
    if (
        manifest.get("artifactKind") != "acceptance-run-manifest"
        or manifest.get("state") != "DURABLE"
        or manifest.get("workspaceId") != store.workspace_id
        or manifest.get("gateId") != gate_id
        or not isinstance(run_id, str)
        or not run_id
    ):
        return GateInspection(
            gate_id,
            run_id if isinstance(run_id, str) else None,
            "ERROR",
            "authoritative run manifest identity is invalid",
            manifest,
        )
    if manifest.get("source") != dict(expected_source):
        return GateInspection(
            gate_id,
            run_id,
            "STALE",
            "run manifest source does not match the release source",
            manifest,
        )

    result = manifest.get("result")
    try:
        if (
            not isinstance(result, Mapping)
            or result.get("status") != "passed"
            or result.get("completionStatus") != "DONE"
            or result.get("proofStatus") != "PROVEN"
            or result.get("secretScan", {}).get("status") != "passed"
            or manifest.get("redaction", {}).get("status") != "passed"
        ):
            raise GateError(
                "run manifest is not passed/DONE/PROVEN with clean evidence"
            )
        runtime_cell = result.get("runtimeCell")
        if required_runtime_cells and runtime_cell not in required_runtime_cells:
            raise GateError(
                f"runtime cell is {runtime_cell!r}, expected one of "
                f"{list(required_runtime_cells)!r}"
            )
        _validate_cleanup(store, manifest, result)
        if require_canonical_report:
            _validate_canonical_report(store, manifest, result)
    except (EvidenceError, GateError, TypeError, ValueError) as error:
        return GateInspection(
            gate_id,
            run_id,
            "FAIL",
            str(error),
            manifest,
        )
    return GateInspection(gate_id, run_id, "PASS", "PASS", manifest)
