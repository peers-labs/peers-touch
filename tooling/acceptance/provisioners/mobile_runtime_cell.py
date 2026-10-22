"""Mobile cell projection over the existing physical Provisioner's authority.

This adapter never builds, installs, launches, or leases a second client. Device
handles and Appium capabilities stay inside MobileNativeProvisioner.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tooling.acceptance.core import BlockedError, source_identity
from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.evidence_store import ArtifactRef
from tooling.acceptance.core.provisioning import ProvisioningState
from tooling.acceptance.gates.mobile.proof_contracts import (
    validate_contract_payload,
)
from tooling.acceptance.provisioners.mobile_native import (
    MobileNativeProvisioner,
    MobileNativeRuntimeManifest,
)


@dataclass(frozen=True)
class MobileCellEvidence:
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return dict(self.payload)


class MobileRuntimeCellLifecycle:
    def __init__(
        self, cell_id: str, *, provisioner: MobileNativeProvisioner | None,
    ) -> None:
        self.cell_id = cell_id
        self.platform = {
            "mobile-ios-native": "ios",
            "mobile-android-native": "android",
        }[cell_id]
        self.provisioner = provisioner
        self._attached = False

    def ready(self, gate_id: str) -> MobileCellEvidence:
        owner = self.provisioner
        if not isinstance(owner, MobileNativeProvisioner):
            raise BlockedError(
                reason="physical Mobile cell requires its existing native environment owner",
                resource=self.cell_id,
            )
        manifest = owner._manifest
        if (
            not isinstance(manifest, MobileNativeRuntimeManifest)
            or manifest.gate_id != gate_id
            or manifest.state != ProvisioningState.FIXTURE_READY
            or not manifest.cleanup_registered
        ):
            raise BlockedError(
                reason="Mobile cell cannot attach before source-bound environment readiness",
                resource=self.cell_id,
            )
        source = source_identity(REPO_ROOT)
        if (
            manifest.source_commit != source["commit"]
            or manifest.workspace_digest != source["workspaceDigest"]
        ):
            raise BlockedError(reason="Mobile cell source is stale", resource=self.cell_id)
        spec = owner._native_spec
        projection = owner._source_projection
        store = owner._artifact_store
        if spec is None or projection is None or store is None:
            raise BlockedError(reason="Mobile cell authorities are unavailable", resource=self.cell_id)
        clients = [client for client in spec.clients if client.platform == self.platform]
        if not clients:
            raise BlockedError(reason="physical platform client is absent", resource=self.cell_id)
        build_ref = projection.applications[self.platform]["buildAttestation"]
        build = store.read_json(build_ref)
        if build.get("artifactKind") == "mobile-native-scenario-build-attestation":
            validate_contract_payload(
                {**build, "artifactKind": "mobile-application-build-attestation"},
                expected_kind="mobile-application-build-attestation",
                expected_run_id=build_ref.run_id,
                expected_gate_id=gate_id,
                expected_workspace_id=build_ref.workspace_id,
            )
        elif build.get("artifactKind") == "mobile-application-build-attestation":
            validate_contract_payload(
                build,
                expected_kind="mobile-application-build-attestation",
                expected_run_id=build_ref.run_id,
                expected_gate_id=gate_id,
                expected_workspace_id=build_ref.workspace_id,
            )
        else:
            raise BlockedError(reason="Mobile build contract is invalid", resource=self.cell_id)
        identity = build.get("buildIdentity", {})
        if (
            build.get("producer") != "mobile-native-build"
            or identity.get("platform") != self.platform
            or identity.get("sourceCommit") != source["commit"]
            or identity.get("workspaceDigest") != source["workspaceDigest"]
        ):
            raise BlockedError(reason="Mobile build identity is stale", resource=self.cell_id)
        binary_ref = ArtifactRef.from_dict(build["artifact"]["artifactRef"])
        store.resolve(binary_ref)
        leases = {}
        for client in clients:
            if client.id not in owner._physical_devices or client.id not in owner._device_leases:
                raise BlockedError(reason="physical device authority is absent", resource=self.cell_id)
            reference = projection.clients[client.id]["physicalDeviceLease"]
            validate_contract_payload(
                store.read_json(reference),
                expected_kind="physical-device-lease",
                expected_run_id=build_ref.run_id,
                expected_gate_id=gate_id,
                expected_workspace_id=build_ref.workspace_id,
            )
            if (reference.run_id, reference.gate_id) != (build_ref.run_id, gate_id):
                raise BlockedError(reason="device/build run identity differs", resource=self.cell_id)
            leases[client.id] = reference.to_dict()
        owner._require_heartbeat_healthy()
        self._attached = True
        return MobileCellEvidence({
            "artifactKind": "acceptance-mobile-runtime-cell-manifest",
            "cellId": self.cell_id,
            "gateId": gate_id,
            "runId": build_ref.run_id,
            "provisioningRunId": manifest.run_id,
            "state": "LEASED",
            "platform": self.platform,
            "source": source,
            "buildAttestation": build_ref.to_dict(),
            "physicalDeviceLeases": leases,
            "lifecycleOwner": "environment-provisioner",
            "attachmentMode": "attach-only",
            "cleanupRegistered": True,
            "cleanupResources": list(manifest.cleanup_resources),
        })

    def status(self) -> dict[str, Any]:
        return {"cellId": self.cell_id, "attached": self._attached}

    def logs(self, tail: int = 200) -> str:
        return ""

    def stop(self) -> dict[str, Any]:
        self._attached = False
        return {
            "cellId": self.cell_id,
            "status": "detached",
            "resourceCleanupOwner": "environment-provisioner",
        }
