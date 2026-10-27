"""Manifest fixtures for business aggregate tests; real Store tests cover bytes."""

from __future__ import annotations

from copy import deepcopy
from typing import Any
from unittest.mock import patch

from tooling.acceptance.core import ArtifactRef, EvidenceManifestInvalid
from tooling.acceptance.core.execution_budget import digest
from tooling.acceptance.station_access_evidence import ProducerProofContext


class ManifestFixtureStore:
    workspace_id = "0123456789abcdef"

    def __init__(self, manifests: dict[str, dict[str, Any]]) -> None:
        self.manifests = manifests
        self.calls: list[tuple[str, str | None]] = []
        self._sealed_manifests: dict[str, dict[str, Any]] = {}
        self._artifact_values: dict[ArtifactRef, Any] = {}

    def _seal_manifests(self) -> None:
        self._sealed_manifests = {}
        self._artifact_values = {}
        for gate_id, source_manifest in self.manifests.items():
            manifest = deepcopy(source_manifest)
            manifest["result"]["secretScan"] = {
                "status": "passed",
                "scannedHighEntropyValues": 0,
                "scannedCredentialValues": 0,
                "redactedArtifacts": [],
            }
            artifacts = manifest.setdefault("artifacts", {})
            if not artifacts:
                path = "reports/fixture-support.json"
                artifacts["fixture-support"] = {
                    "artifactKind": "acceptance-artifact-ref",
                    "workspaceId": self.workspace_id,
                    "gateId": gate_id,
                    "runId": manifest["runId"],
                    "path": path,
                    "sha256": "",
                    "mediaType": "application/json",
                }
            for role, raw_reference in tuple(artifacts.items()):
                reference = ArtifactRef.from_dict({
                    **raw_reference,
                    "sha256": "0" * 64,
                })
                value = {
                    "artifactKind": "acceptance-fixture-supporting-evidence",
                    "gateId": gate_id,
                    "role": role,
                }
                reference = ArtifactRef(
                    reference.workspace_id,
                    reference.gate_id,
                    reference.run_id,
                    reference.path,
                    digest(value),
                    reference.media_type,
                )
                artifacts[role] = reference.to_dict()
                self._artifact_values[reference] = value
            self._sealed_manifests[gate_id] = manifest

    def context(self, source: dict[str, str]) -> ProducerProofContext:
        self._seal_manifests()
        refs = {}
        results = {}
        for gate_id, manifest in self._sealed_manifests.items():
            ref = ArtifactRef(
                self.workspace_id, gate_id, manifest["runId"],
                "manifest.json", digest(manifest), "application/json",
            )
            refs[gate_id] = ref
            results[gate_id] = {
                **deepcopy(manifest["result"]), "id": gate_id,
                "runManifest": ref.to_dict(),
            }
        return ProducerProofContext(source, results, refs)

    def read_run_manifest(self, ref, *, manifest_sha256, expected_gate_id):
        original = self.manifests[expected_gate_id]
        sealed = self._sealed_manifests.get(expected_gate_id)
        manifest = (
            sealed
            if sealed is not None and ref.sha256 == digest(sealed)
            else original
        )
        result = manifest["result"]
        self.calls.append((expected_gate_id, result.get("runtimeCell")))
        if (
            ref.sha256 != manifest_sha256 or ref.sha256 != digest(manifest)
            or manifest.get("artifactKind") != "acceptance-run-manifest"
            or manifest.get("state") != "DURABLE"
            or manifest.get("workspaceId") != ref.workspace_id
            or manifest.get("gateId") != ref.gate_id
            or manifest.get("runId") != ref.run_id
        ):
            raise EvidenceManifestInvalid("fixture manifest identity or hash is invalid")
        return manifest

    def validate_proof_authority(self, reference: ArtifactRef) -> None:
        manifest = self._sealed_manifests.get(reference.gate_id)
        if manifest is None:
            raise EvidenceManifestInvalid("fixture proof authority is missing")
        expected = ArtifactRef(
            self.workspace_id,
            reference.gate_id,
            manifest["runId"],
            "manifest.json",
            digest(manifest),
            "application/json",
        )
        if reference != expected:
            raise EvidenceManifestInvalid("fixture proof authority changed")

    def read_json_value(self, reference: ArtifactRef) -> Any:
        if reference not in self._artifact_values:
            raise EvidenceManifestInvalid("fixture artifact is missing")
        return deepcopy(self._artifact_values[reference])

    def read_json(self, reference: ArtifactRef) -> dict[str, Any]:
        value = self.read_json_value(reference)
        if not isinstance(value, dict):
            raise EvidenceManifestInvalid("fixture JSON artifact must be an object")
        return value

    @staticmethod
    def bind(testcase, source, store):
        environment_patch = patch.dict("os.environ", {"PT_ACCEPTANCE_CURRENT_RESULTS": ""})
        environment_patch.start()
        testcase.addCleanup(environment_patch.stop)
        context_patch = patch.object(
            ProducerProofContext, "from_environment",
            side_effect=lambda: store().context(source),
        )
        context_patch.start()
        testcase.addCleanup(context_patch.stop)
