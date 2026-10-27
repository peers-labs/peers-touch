"""Runner-owned immutable equipment references for read-only input owners."""

from __future__ import annotations

from typing import Any, Mapping

from .evidence_store import ArtifactRef
from .execution_identity import InputIdentityError


INPUT_ARTIFACT_ROLES = {
    "environment": "runtime/environment-manifest.json",
    "runtimeCell": "runtime/runtime-cell-manifest.json",
}


def capture_input_artifacts(
    gate: Mapping[str, Any], run: Any,
    manifests: Mapping[str, Mapping[str, Any] | None],
    prerequisites: list[dict[str, Any]],
) -> dict[str, Any]:
    """Capture only equipment actually written by this Gate's existing owners."""
    inventory = run.collect_existing_artifacts()
    artifacts = {}
    for role, manifest in manifests.items():
        if manifest is not None:
            ref = ArtifactRef.from_dict(manifest["_manifest_ref"])
            if ref not in inventory.values():
                raise InputIdentityError(f"{gate['id']}: equipment is absent from run inventory")
            artifacts[role] = ref.to_dict()
    value = {
        "artifactKind": "acceptance-gate-input-artifacts",
        "gateId": gate["id"],
        "workspaceId": run.store.workspace_id,
        "runId": run.run_id,
        "artifacts": artifacts,
        "prerequisiteProofs": prerequisites,
    }
    validate_input_artifacts(gate, value, run.store, inventory, prerequisites)
    return value


def validate_input_artifacts(
    gate: Mapping[str, Any], value: Any, store: Any,
    inventory: Mapping[str, Any], prerequisites: list[dict[str, Any]],
) -> None:
    """Revalidate original bytes and identity without finding replacement latests."""
    if (
        not isinstance(value, dict)
        or set(value) != {
            "artifactKind", "gateId", "workspaceId", "runId",
            "artifacts", "prerequisiteProofs",
        }
        or value["artifactKind"] != "acceptance-gate-input-artifacts"
        or value["gateId"] != gate["id"]
        or value["workspaceId"] != store.workspace_id
        or value["prerequisiteProofs"] != prerequisites
        or not isinstance(value["artifacts"], dict)
        or not set(value["artifacts"]) <= set(INPUT_ARTIFACT_ROLES)
    ):
        raise InputIdentityError(f"{gate['id']}: original equipment context is invalid")
    required = set()
    if gate.get("provisioner"):
        required.add("environment")
    if gate.get("requiredRuntimeCells"):
        required.add("runtimeCell")
    if set(value["artifacts"]) != required:
        raise InputIdentityError(f"{gate['id']}: equipment context is incomplete")
    refs = {
        ArtifactRef.from_dict(item) if isinstance(item, dict) else item
        for item in inventory.values()
    }
    for role, item in value["artifacts"].items():
        ref = ArtifactRef.from_dict(item)
        if (
            (ref.workspace_id, ref.gate_id, ref.run_id, ref.path)
            != (store.workspace_id, gate["id"], value["runId"], INPUT_ARTIFACT_ROLES[role])
            or ref not in refs
        ):
            raise InputIdentityError(f"{gate['id']}: equipment reference is not original")
        store.resolve(ref)


def original_input_artifacts(
    gate: Mapping[str, Any], manifest: Mapping[str, Any], store: Any,
) -> tuple[ArtifactRef, dict[str, Any]]:
    ref = ArtifactRef.from_dict(manifest["artifacts"]["input-artifacts"])
    if (
        (ref.workspace_id, ref.gate_id, ref.run_id, ref.path)
        != (store.workspace_id, gate["id"], manifest["runId"], "proof/input-artifacts.json")
    ):
        raise InputIdentityError(f"{gate['id']}: original input context identity changed")
    value = store.read_json(ref)
    if value["runId"] != ref.run_id:
        raise InputIdentityError(f"{gate['id']}: original input context belongs to another run")
    validate_input_artifacts(
        gate, value, store, manifest["artifacts"], manifest["result"].get("prerequisiteProofs", []),
    )
    return ref, value
