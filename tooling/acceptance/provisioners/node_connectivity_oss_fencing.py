from __future__ import annotations

import dataclasses
import hashlib
import json
from pathlib import Path

from tooling.acceptance.core import RuntimeManifest, ServiceAttestation
from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.evidence_store import (
    current_artifact_ref,
    write_current_artifact,
)
from tooling.acceptance.core.provisioning import utc_now

from .node_connectivity_postgres import (
    NodeConnectivityPostgresProcessProvisioner,
)


class NodeConnectivityOSSFencingProvisioner(
    NodeConnectivityPostgresProcessProvisioner
):
    environment_id = "node-connectivity-oss-fencing"
    gate_id = "NCP-G06-OSS"
    service_id = "oss-postgres"
    object_service_id = "oss-object-backend"
    client_ids = ("oss-node-a", "oss-node-b")
    attestation_producer = "node-connectivity-oss-fencing-provisioner"
    failure_label = "OSS Fencing"

    def _shared_root(self, runtime_root: Path) -> Path:
        return (runtime_root / "shared-objects").resolve()

    def _additional_services(
        self,
        *,
        manifest: RuntimeManifest,
        runtime_root: Path,
    ) -> dict[str, ServiceAttestation]:
        shared_root = self._shared_root(runtime_root)
        shared_root.mkdir(parents=True, exist_ok=False)
        stat = shared_root.stat()
        protocol_digest = hashlib.sha256(
            b"peers-touch-shared-fs-generation-v1"
        ).hexdigest()
        attestation = ServiceAttestation(
            service_id=self.object_service_id,
            service_kind="object-storage",
            environment_id=self.environment_id,
            deployment_environment=self.environment_id,
            endpoint=shared_root.as_uri(),
            live_commit=manifest.source_commit,
            workspace_digest=manifest.workspace_digest,
            protocol_digest=protocol_digest,
            artifact_ref={},
            produced_at=utc_now(),
            producer=self.attestation_producer,
            runtime_identity=(
                f"shared-fs:{stat.st_dev}:{stat.st_ino}"
            ),
        )
        payload = attestation.to_dict()
        payload["runtime"] = {
            "driver": "shared-fs",
            "scope": "suite",
            "root": str(shared_root),
            "device": str(stat.st_dev),
            "inode": str(stat.st_ino),
        }
        artifact_path = (
            f"runtime/services/{self.object_service_id}/attestation.json"
        )
        write_current_artifact(
            artifact_path,
            (
                json.dumps(payload, indent=2, sort_keys=True)
                + "\n"
            ).encode("utf-8"),
            repo_root=REPO_ROOT,
        )
        return {
            self.object_service_id: dataclasses.replace(
                attestation,
                artifact_ref=current_artifact_ref(
                    artifact_path,
                    repo_root=REPO_ROOT,
                    media_type="application/json",
                ).to_dict(),
            )
        }

    def _client_storage_root(
        self,
        *,
        client_id: str,
        runtime_root: Path,
    ) -> str:
        del client_id
        return str(self._shared_root(runtime_root))
