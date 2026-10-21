"""Source-bound physical Host Suite evidence consumption.

The physical Suite owner produces this evidence after reverse cleanup. This
module never provisions devices or substitutes source checks for Host proof.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    BlockedError,
    GateError,
    REPO_ROOT,
    RuntimeReuseContract,
    SuiteRuntimeError,
    source_identity,
    validate_suite_runtime_report,
    write_current_artifact,
)
from tooling.acceptance.core.evidence_store import ArtifactRef, EvidenceStore
from tooling.acceptance.gates.mobile.proof_contracts import (
    validate_contract_payload,
    validate_historical_lease_acquisition_payload,
)
from tooling.acceptance.provisioners.mobile_native_build import (
    canonical_json_bytes,
    embedded_identity_digest,
    parse_build_identity,
)


HOST_SCENARIOS = {
    "android": (
        "android-back",
        "android-push",
        "android-media",
        "android-killed-process",
    ),
    "ios": ("ios-push", "ios-background", "ios-system-actions"),
}

HOST_ASSERTIONS = {
    "android-back": ("overlayClosed", "detailExited", "rootSystemHandoff"),
    "android-push": ("tokenRotated", "providerDelivered", "notificationTap"),
    "android-media": ("fullResolutionImage", "video", "document", "receiverVisible"),
    "android-killed-process": ("processKilled", "durableWake", "restartRecovered"),
    "ios-push": ("registrationSucceeded", "registrationFailureObserved", "providerDelivered"),
    "ios-background": ("expirationObserved", "rescheduled", "durableWake"),
    "ios-system-actions": ("settingsOpened", "shareCompleted", "admissionObserved"),
}


def reuse_contract(platform: str) -> RuntimeReuseContract:
    scenarios = HOST_SCENARIOS[platform]
    return RuntimeReuseContract(
        entry_check_id=f"uca0{'2' if platform == 'android' else '3'}-{platform}-suite",
        scenario_ids=scenarios,
        max_provisioning_runs=1,
        max_client_launches=1,
        min_warm_reuse_rate=0.75 if platform == "android" else 0.66,
        require_attach_only_scenarios=True,
        require_receiver_visible_proof=True,
        allow_client_replacement=False,
    )


def validate_runtime_evidence(
    path: Path,
    *,
    platform: str,
    expected_source: dict[str, str],
    store: EvidenceStore | None = None,
) -> dict[str, Any]:
    if not path.is_file():
        raise BlockedError(
            reason="current-source physical Host Suite evidence is unavailable",
            resource=f"mobile-{platform}-native",
        )
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or set(value) != {
        "artifactKind", "source", "runtimeCells", "suiteRuntime", "scenarios",
        "runtimeManifest",
        "deviceCleanup",
    }:
        raise GateError("physical Host Suite evidence schema is invalid")
    if (
        value["artifactKind"] != f"unified-client-{platform}-host-runtime-evidence"
        or value["source"] != expected_source
        or value["runtimeCells"] != [f"mobile-{platform}-native"]
    ):
        raise GateError("physical Host Suite evidence source or runtime cell is stale")
    try:
        suite = validate_suite_runtime_report(
            value["suiteRuntime"], expected_contract=reuse_contract(platform)
        )
    except SuiteRuntimeError as error:
        raise GateError(str(error)) from error
    expected_digest = (
        expected_source["commit"]
        if expected_source["workspaceDigest"] == "clean"
        else expected_source["workspaceDigest"].removeprefix("sha256:")
    )
    if suite["sourceDigest"] != expected_digest:
        raise GateError("physical Host Suite source digest is stale")
    evidence_store = store or EvidenceStore.from_environment(repo_root=REPO_ROOT)
    cell_ref = ArtifactRef.from_dict(value["runtimeManifest"])
    cell = evidence_store.read_json(cell_ref)
    gate_id = f"unified-client-{platform}-host-e2e"
    if (
        cell_ref.gate_id != gate_id
        or cell.get("artifactKind") != "acceptance-mobile-runtime-cell-manifest"
        or cell.get("cellId") != f"mobile-{platform}-native"
        or cell.get("platform") != platform
        or cell.get("gateId") != gate_id
        or cell.get("runId") != cell_ref.run_id
        or cell.get("source") != expected_source
        or cell.get("state") != "LEASED"
        or cell.get("attachmentMode") != "attach-only"
        or cell.get("lifecycleOwner") != "environment-provisioner"
        or cell.get("cleanupRegistered") is not True
    ):
        raise GateError("physical Host runtime manifest identity is invalid")
    def read_ref(raw: Any, *, media_type: str | None = None) -> Path:
        reference = ArtifactRef.from_dict(raw)
        if (
            reference.gate_id != gate_id
            or reference.run_id != cell_ref.run_id
            or (media_type is not None and reference.media_type != media_type)
        ):
            raise GateError("physical Host artifact belongs to another run or media type")
        result = evidence_store.resolve(reference)
        if result.stat().st_size == 0:
            raise GateError("physical Host artifact is empty")
        return result

    build = json.loads(read_ref(cell["buildAttestation"]).read_text(encoding="utf-8"))
    if build.get("artifactKind") not in {
        "mobile-application-build-attestation",
        "mobile-native-scenario-build-attestation",
    }:
        raise GateError("physical Host build artifact kind is invalid")
    validate_contract_payload(
        {**build, "artifactKind": "mobile-application-build-attestation"},
        expected_kind="mobile-application-build-attestation",
        expected_run_id=cell_ref.run_id,
        expected_gate_id=gate_id,
        expected_workspace_id=cell_ref.workspace_id,
    )
    identity = parse_build_identity(canonical_json_bytes(build["buildIdentity"]).decode("ascii"))
    signing = build["signing"]
    if (
        build.get("producer") != "mobile-native-build"
        or build.get("gateId") != gate_id
        or build.get("runId") != cell_ref.run_id
        or identity["platform"] != platform
        or identity["sourceCommit"] != expected_source["commit"]
        or identity["workspaceDigest"] != expected_source["workspaceDigest"]
        or build.get("embeddedIdentitySha256") != embedded_identity_digest(identity)
        or signing.get("policyId") != "mobile-acceptance-debug"
        or signing.get("applicationIdentifier") != identity["applicationId"]
        or not signing.get("certificateSha256")
    ):
        raise GateError("physical Host signed build identity is invalid")
    binary = ArtifactRef.from_dict(build["artifact"]["artifactRef"])
    read_ref(binary.to_dict(), media_type="application/octet-stream")
    if (
        build["artifact"]["sha256"] != f"sha256:{binary.sha256}"
        or evidence_store.resolve(binary).stat().st_size != build["artifact"]["sizeBytes"]
    ):
        raise GateError("physical Host build binary digest differs")
    leases = cell.get("physicalDeviceLeases")
    if not isinstance(leases, dict) or not leases:
        raise GateError("physical Host device leases are absent")
    cleanup = value["deviceCleanup"]
    if not isinstance(cleanup, dict) or set(cleanup) != set(leases):
        raise GateError("physical Host device cleanup set is incomplete")
    for client_id, lease in leases.items():
        acquisition = json.loads(read_ref(lease).read_text(encoding="utf-8"))
        validate_historical_lease_acquisition_payload(
            acquisition,
            expected_run_id=cell_ref.run_id,
            expected_gate_id=gate_id,
            expected_workspace_id=cell_ref.workspace_id,
        )
        checks = acquisition.get("checks", {})
        if (
            acquisition.get("artifactKind") != "physical-device-lease"
            or acquisition.get("clientId") != client_id
            or acquisition.get("platform") != platform
            or acquisition.get("destinationClassRef") != f"{platform}-physical"
            or checks.get("connected") is not True
            or checks.get("physical") is not True
            or checks.get("simulator") is not False
        ):
            raise GateError("physical Host device acquisition is invalid")
        outcome = json.loads(read_ref(cleanup[client_id]).read_text(encoding="utf-8"))
        validate_contract_payload(
            outcome,
            expected_kind="mobile-lease-outcome",
            expected_run_id=cell_ref.run_id,
            expected_gate_id=gate_id,
            expected_workspace_id=cell_ref.workspace_id,
        )
        if (
            outcome.get("artifactKind") != "mobile-lease-outcome"
            or outcome.get("acquisition") != lease
            or outcome.get("finalState") != "RELEASED"
            or outcome.get("cleanupCompleted") is not True
            or outcome.get("baselineRestored") is not True
            or outcome.get("identityReverified") is not True
            or outcome.get("failureCode")
        ):
            raise GateError("physical Host device cleanup is unproven")
    scenarios = value["scenarios"]
    if not isinstance(scenarios, dict) or set(scenarios) != set(HOST_SCENARIOS[platform]):
        raise GateError("physical Host Suite scenarios are incomplete")
    for scenario_id, scenario in scenarios.items():
        fields = {
            *HOST_ASSERTIONS[scenario_id], "uiAction", "receiverVisible", "physicalDevice",
            "uiArtifact", "receiverArtifact", "observationArtifact",
        }
        if (
            not isinstance(scenario, dict)
            or set(scenario) != fields
            or any(
                scenario[field] is not True
                for field in fields - {"uiArtifact", "receiverArtifact", "observationArtifact"}
            )
        ):
            raise GateError(f"physical Host lifecycle proof is incomplete: {scenario_id}")
        for field in ("uiArtifact", "receiverArtifact"):
            screenshot = read_ref(scenario[field], media_type="image/png")
            with screenshot.open("rb") as stream:
                if stream.read(8) != b"\x89PNG\r\n\x1a\n":
                    raise GateError("physical Host screenshot is not a PNG")
        observation = json.loads(
            read_ref(scenario["observationArtifact"], media_type="application/json")
            .read_text(encoding="utf-8")
        )
        if (
            observation.get("scenarioId") != scenario_id
            or observation.get("source") != expected_source
            or observation.get("binarySha256") != binary.sha256
            or observation.get("deviceClientId") not in leases
            or observation.get("assertions") != {
                assertion: True for assertion in HOST_ASSERTIONS[scenario_id]
            }
        ):
            raise GateError("physical Host observation identity or assertions are invalid")
    return value


class UnifiedHostSuiteGate(AcceptanceGate):
    spec = (
        "docs/architecture/platform/client/cross-client-runtime/"
        "execution-plans/20261017-unified-client-architecture/plan.md",
    )
    bom = ("UCA-20261017",)

    def __init__(
        self, *, platform: str, reuse_suite_runtime: bool,
        runtime_evidence: Path | None, blockers: list[str],
    ) -> None:
        if platform not in HOST_SCENARIOS:
            raise GateError("unsupported physical Host platform")
        if not reuse_suite_runtime:
            raise GateError("physical Host Gate requires one reusable Suite Runtime")
        self.gate_id = f"unified-client-{platform}-host-e2e"
        self.phase = "UCA-02" if platform == "android" else "UCA-03"
        self.platform = platform
        self.runtime_evidence = runtime_evidence
        self.blockers = blockers
        super().__init__()

    def run(self) -> dict[str, Any]:
        cells = [f"mobile-{self.platform}-native"]
        self.report.runtime.update({"runtimeCells": cells})
        if self.runtime_evidence is None:
            if not self.blockers:
                from .unified_host_runtime import observe_host_runtime

                observation = observe_host_runtime(self.platform)
                write_current_artifact(
                    "evidence/mobile/host-entry.json",
                    (json.dumps(observation, sort_keys=True) + "\n").encode(),
                    repo_root=REPO_ROOT,
                )
                self.blockers = [
                    "host-push-provider-driver-missing",
                    "host-system-lifecycle-scenario-drivers-missing",
                    "host-suite-terminal-publication-missing",
                ]
            blockers = self.blockers or ["receiver-visible-host-suite-not-executed"]
            self.report.runtime.update({"status": "UNPROVEN", "blockers": blockers})
            raise BlockedError(
                reason="physical Host Suite unavailable: " + ", ".join(blockers),
                resource=cells[0],
            )
        evidence = validate_runtime_evidence(
            self.runtime_evidence,
            platform=self.platform,
            expected_source=source_identity(REPO_ROOT),
        )
        write_current_artifact(
            "reports/suite-runtime.json",
            (json.dumps(evidence["suiteRuntime"], sort_keys=True) + "\n").encode(),
            repo_root=REPO_ROOT,
        )
        self.assert_condition(
            "physical_host_lifecycle",
            True,
            "current-source physical Host scenarios and terminal Suite cleanup validated",
        )
        return {
            "runtimeCells": cells,
            "suiteRuntime": evidence["suiteRuntime"],
            "scenarioIds": list(HOST_SCENARIOS[self.platform]),
        }
