#!/usr/bin/env python3
"""Fail-closed validator for the Core native two-client Chat report."""

from __future__ import annotations

import os
import re
import sys
from typing import Any

from tooling.acceptance.core import (
    ArtifactRef,
    ArtifactSession,
    EvidenceStore,
    REPO_ROOT,
    current_artifact_ref,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    CURRENT_PROFILE_GATE_ID,
    REQUIRED_ASSERTIONS,
    commits_match,
)
from tooling.acceptance.gates.chat.native_support import runtime_station_service


GATE_ID = "chat-native-two-client-e2e"
SOURCE_REPORT_PATH = f"reports/{GATE_ID}.json"
ENVIRONMENT_MANIFEST_PATH = "runtime/environment-manifest.json"
VALIDATED_REPORT_PATH = "reports/chat-native-two-client-validation.json"
REQUIRED_STEPS = {
    "station.identity",
    "fixture.reset",
    "client.authenticated",
    "runtime.source_identity",
    "conversation.open",
    "message.submitted",
    "message.received",
    "message.decrypted",
    "receipt.delivered",
}


class GateError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateError(message)


def load_report(
    store: EvidenceStore,
    gate_id: str = GATE_ID,
) -> tuple[dict[str, Any], ArtifactRef]:
    reference = current_artifact_ref(
        f"reports/{gate_id}.json",
        repo_root=REPO_ROOT,
        media_type="application/json",
    )
    return store.read_json(reference), reference


def validate_report(
    report: dict[str, Any],
    *,
    source_ref: ArtifactRef,
    store: EvidenceStore,
    gate_id: str = GATE_ID,
    required_steps: set[str] = REQUIRED_STEPS,
    required_assertions: set[str] = REQUIRED_ASSERTIONS,
) -> None:
    require(
        report.get("gate") == gate_id,
        "unexpected native two-client gate ID",
    )
    require(report.get("status") == "PASS", "native two-client report must pass")
    require(
        str(report.get("station_url") or "").startswith("http"),
        "explicit Station URL is required",
    )

    runtime = report.get("runtime")
    require(isinstance(runtime, dict), "runtime evidence is required")
    runtime_cell = str(runtime.get("runtimeCell") or "")
    expected_runtime_cell = os.environ.get(
        "PT_ACCEPTANCE_RUNTIME_CELL",
        "",
    ).strip()
    require(
        bool(expected_runtime_cell),
        "PT_ACCEPTANCE_RUNTIME_CELL is required",
    )
    require(
        runtime_cell == expected_runtime_cell,
        "runtime cell must match PT_ACCEPTANCE_RUNTIME_CELL",
    )
    require(
        runtime.get("journey") == "direct-delivered-receipt",
        "unexpected native two-client journey",
    )
    source_identity = runtime.get("sourceIdentity")
    require(
        isinstance(source_identity, dict),
        "source identity is required",
    )
    orchestrator = source_identity.get("orchestrator")
    station = source_identity.get("station")
    station_live = source_identity.get("stationLive")
    runtime_identity = source_identity.get("runtimeCell")
    binary_identity = source_identity.get("binary")
    require(
        isinstance(orchestrator, dict),
        "orchestrator source identity is required",
    )
    source_commit = str(orchestrator.get("commit") or "")
    require(
        bool(source_commit)
        and orchestrator.get("workspaceDigest") == "clean",
        "orchestrator source must be a clean commit",
    )
    require(
        isinstance(station, dict)
        and station.get("liveCommit") == source_commit
        and station.get("workspaceDigest") == "clean"
        and re.fullmatch(
            r"[0-9a-f]{64}",
            str(station.get("protocolDigest") or ""),
        )
        is not None,
        "Station attestation must match the clean source and proto",
    )
    require(isinstance(station_live, dict), "live Station identity is required")
    require(
        commits_match(
            str(station_live.get("build_commit") or ""),
            source_commit,
        ),
        "Station/client commit mismatch",
    )
    require(
        isinstance(binary_identity, dict),
        "Native binary identity is required",
    )
    require(
        binary_identity.get("sourceCommit") == source_commit,
        "Native binary source commit mismatch",
    )
    require(
        re.fullmatch(
            r"[0-9a-f]{64}",
            str(binary_identity.get("sha256") or ""),
        )
        is not None,
        "Native binary SHA-256 is required",
    )
    require(
        isinstance(runtime_identity, dict)
        and runtime_identity.get("artifactKind")
        == "acceptance-runtime-cell-manifest"
        and runtime_identity.get("cellId") == runtime_cell
        and runtime_identity.get("gateId") == gate_id
        and runtime_identity.get("state") == "LEASED"
        and runtime_identity.get("runId")
        == runtime.get("runtimeCellRunId"),
        "runtime-cell identity is incomplete or mismatched",
    )
    cell_source = runtime_identity.get("source")
    require(
        isinstance(cell_source, dict)
        and cell_source.get("commit") == source_commit
        and cell_source.get("workspaceDigest") == "clean"
        and cell_source.get("binarySha256")
        == binary_identity.get("sha256"),
        "runtime-cell source identity is stale or dirty",
    )
    if runtime_cell == "desktop-linux-native":
        require(
            cell_source.get("remoteCheckoutClean") is True
            and re.fullmatch(
                r"[0-9a-f]{64}",
                str(cell_source.get("remoteSourceDigest") or ""),
            )
            is not None,
            "runtime-cell remote source is stale or dirty",
        )
        platform = runtime_identity.get("platform")
        require(
            isinstance(platform, dict)
            and re.fullmatch(
                r"[0-9a-f]{64}",
                str(platform.get("imageDigest") or ""),
            )
            is not None,
            "runtime-cell image identity is required",
        )
    manifest = report.get("manifest")
    manifest_ref = current_artifact_ref(
        ENVIRONMENT_MANIFEST_PATH,
        repo_root=REPO_ROOT,
        media_type="application/json",
    )
    require(
        manifest_ref.workspace_id == source_ref.workspace_id
        and manifest_ref.gate_id == source_ref.gate_id
        and manifest_ref.run_id == source_ref.run_id,
        "environment manifest must belong to the current Gate run",
    )
    environment_manifest = store.read_json(manifest_ref)
    manifest_station = runtime_station_service(environment_manifest, "alice")
    require(
        isinstance(manifest, dict)
        and manifest == environment_manifest
        and manifest.get("gateId") == gate_id
        and manifest.get("source") == orchestrator
        and manifest_station == station,
        "embedded environment manifest does not match source identity",
    )

    actors = report.get("actors")
    require(
        isinstance(actors, dict) and set(actors) == {"alice", "bob"},
        "exactly Alice and Bob actor evidence is required",
    )
    for field in ("port", "gateway_port", "storage_root", "pid"):
        values = {str(actor.get(field) or "") for actor in actors.values()}
        require("" not in values and len(values) == 2, f"actors require distinct {field}")
    profiles = {str(actor.get("profile") or "") for actor in actors.values()}
    require("" not in profiles, "actors require a non-empty profile")
    if gate_id != CURRENT_PROFILE_GATE_ID:
        require(
            len(profiles) == 2,
            "actors require distinct profile",
        )
    require(
        all(
            actor.get("runtime") == runtime_cell
            for actor in actors.values()
        ),
        "both actors must use the selected Native Desktop cell",
    )

    assertions = report.get("assertions")
    require(isinstance(assertions, list), "assertions must be a list")
    by_name = {
        str(assertion.get("name") or ""): assertion
        for assertion in assertions
        if isinstance(assertion, dict)
    }
    missing = required_assertions - set(by_name)
    require(not missing, f"required assertions are missing: {sorted(missing)}")
    for name in sorted(required_assertions):
        require(by_name[name].get("passed") is True, f"{name} must pass")

    steps = runtime.get("steps")
    require(isinstance(steps, list), "bounded step evidence is required")
    passed_steps = {
        str(step.get("step") or "")
        for step in steps
        if isinstance(step, dict) and step.get("status") == "pass"
    }
    missing_steps = required_steps - passed_steps
    require(not missing_steps, f"required steps are missing: {sorted(missing_steps)}")
    cleanup = runtime.get("cleanup")
    require(isinstance(cleanup, dict), "cleanup evidence is required")
    for field in (
        "portsReleased",
        "processesReleased",
        "storageReleased",
        "logsReleased",
    ):
        require(cleanup.get(field) is True, f"cleanup {field} must pass")
    require(
        not cleanup.get("cleanupErrors"),
        "cleanup errors must be empty",
    )

    evidence = report.get("evidence")
    require(isinstance(evidence, dict), "evidence map is required")
    for actor in ("alice", "bob"):
        for suffix in ("screenshot", "dom", "app-log"):
            key = f"{actor}-{suffix}"
            entry = evidence.get(key)
            reference = ArtifactRef.from_dict(entry)
            require(
                reference.workspace_id == source_ref.workspace_id
                and reference.gate_id == source_ref.gate_id
                and reference.run_id == source_ref.run_id,
                f"{key} evidence must belong to the current Gate run",
            )
            store.resolve(reference)


def write_validation(
    report: dict[str, Any],
    *,
    source_ref: ArtifactRef,
    gate_id: str = GATE_ID,
    required_assertions: set[str] = REQUIRED_ASSERTIONS,
) -> ArtifactRef:
    output = {
        "artifactKind": "chat-native-two-client-validation",
        "status": "pass",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": False,
        "phase": "chat-native-two-client",
        "bom": ["CHAT-DIRECT-DELIVERED-01"],
        "spec": ["chat-direct-delivered-receipt"],
        "gate": gate_id,
        "sourceArtifact": source_ref.to_dict(),
        "testedCommit": report["runtime"]["sourceIdentity"][
            "orchestrator"
        ]["commit"],
        "assertionCount": len(required_assertions),
    }
    session = ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id=gate_id,
    )
    return session.write_json(
        f"reports/{gate_id}-validation.json",
        output,
        role="validation",
    )


def main() -> int:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    report, source_ref = load_report(store)
    validate_report(
        report,
        source_ref=source_ref,
        store=store,
    )
    validation_ref = write_validation(
        report,
        source_ref=source_ref,
    )
    print("Chat Native Two-Client E2E")
    print("==========================")
    print(f"[OK] source: {source_ref.path}")
    print(f"[OK] report: {validation_ref.path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"chat native two-client validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
