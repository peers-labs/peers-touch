"""Adapt Runner-owned Native sessions to the original private Social helpers."""
from __future__ import annotations

import hashlib
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientError,
    FoundationClientSpec,
    FoundationRuntimeClient,
)
from tooling.acceptance.gates.chat.native_support import (
    NativeClientLifecycleLedger,
    SelectedNativeRuntime,
    verify_runtime_fixture_ready,
)

GATE_ID = "social-cross-station-native-e2e"
SCHEMA_INVENTORY_PATH = "runtime/private-social-schema.json"
CLIENT_BINDINGS = {
    "alice": ("alice", "station-four"),
    "bob": ("bob", "station-five-arm"),
    "eve": ("eve", "station-five-arm"),
    "bob2": ("bob", "station-five-arm"),
}


class PreparedSocialNativeClient:
    """No build, login, port selection or storage owner lives in this adapter."""

    def __init__(self, owner: PreparedSocialNativeRuntime, client_id: str) -> None:
        self.owner = owner
        self.client_id = client_id
        self.spec = FoundationClientSpec.from_mapping(owner.client_specs[client_id])
        self.station_url = owner.service(client_id)["endpoint"].rstrip("/")
        self.harness_namespace = "moments"
        self.session: Any = None

    @property
    def driver(self) -> Any:
        if self.session is None:
            raise FoundationClientError("prepared Social client is not started")
        return self.session.driver

    def start(self) -> None:
        if self.session is not None or self.owner.cleanup_result is not None:
            raise FoundationClientError("prepared Social client cannot start twice")
        if self.client_id == "eve":
            raise FoundationClientError("Eve is a fixture-only actor")
        active = {
            client_id for client_id, client in self.owner.clients.items()
            if client.session is not None
            and any(record.client is client.session and record.process_state != "stopped"
                    for record in self.owner.lifecycle.records)
        }
        predecessor = self.owner.clients.get("bob")
        replacement_ready = predecessor is not None and any(
            record.client is predecessor.session and record.process_state == "stopped"
            and not record.release_errors for record in self.owner.lifecycle.records
        )
        if len(active) >= 2 or (self.client_id == "bob2" and not replacement_ready):
            raise FoundationClientError("Bob2 must replace Bob within two Native windows")
        self.session = self.owner.binding.create_bound_session(
            self.client_id,
            NativeLaunchOptions(window_slot=0 if self.client_id == "alice" else 1,
                                window_count=2),
        )
        self.owner.lifecycle.register(self.session, self.owner.actors[
            CLIENT_BINDINGS[self.client_id][0]
        ]["ptid"])
        self.owner.lifecycle.mark_live(self.session)
        self.owner.lifecycle.mark_restoring(self.session)

    def configure_station(self) -> None:
        # Runtime Binding already configured, observed and proved this Station.
        if self.session is None:
            raise FoundationClientError("prepared Social client is not started")

    def harness(self, method: str, payload: dict[str, Any] | None = None,
                timeout: float = 180) -> Any:
        result = FoundationRuntimeClient.harness(self, method, payload, timeout)
        if method == "restoreSessionWithPassword" and isinstance(result, Mapping):
            if result.get("authenticated") is True:
                self.owner.lifecycle.mark_authenticated(self.session)
        return result

    def stop(self) -> dict[str, Any]:
        failures = self.owner.lifecycle.release(self.session) if self.session is not None else []
        return {"status": "failed" if failures else "clean", "failures": failures}


class PreparedSocialNativeRuntime:
    """Validate business topology and delegate all physical lifetime ownership."""

    def __init__(self, selected: SelectedNativeRuntime, *, repo_root: Path) -> None:
        self.manifest = selected.manifest
        self.binding = selected.binding
        self.repo_root = repo_root.resolve()
        manifest, actors = self.manifest, selected.actor_manifest
        verify_runtime_fixture_ready(manifest, actors)
        if (
            manifest.get("gateId") != GATE_ID
            or manifest.get("environmentId") != "cross-station-social-native"
            or actors.get("environmentId") != manifest["environmentId"]
            or actors.get("fixtureId") != "cross-station-social-actors"
            or actors.get("runId") != manifest.get("runId")
            or Path(manifest["source"]["worktree"]).resolve() != self.repo_root
        ):
            raise GateError("private Social preparation source/run/fixture is misbound")
        self.client_specs = {client["id"]: client for client in manifest["clients"]}
        self.actors = {actor["role"]: actor for actor in actors["actors"]}
        if (
            len(self.client_specs) != len(manifest["clients"])
            or set(self.client_specs) != set(CLIENT_BINDINGS)
            or len(self.actors) != len(actors["actors"])
            or set(self.actors) != {"alice", "bob", "eve"}
            or len({actor["ptid"] for actor in self.actors.values()}) != 3
        ):
            raise GateError("private Social preparation actor/client inventory is invalid")
        for role, actor in self.actors.items():
            if not actor["ptid"].startswith("ptid:") or not actor["accountRef"].startswith(
                "station-account:"
            ):
                raise GateError(f"private Social {role} has no canonical account identity")
        for client_id, (role, service_id) in CLIENT_BINDINGS.items():
            spec = self.client_specs[client_id]
            if (
                spec["actor"] != role or spec["runtime"] != "native-tauri"
                or Path(spec["worktree"]).resolve() != self.repo_root
                or spec["required_service_roles"] != ["station"]
                or spec["service_bindings"] != {
                    "station": {"service_id": service_id, "required_kind": "station"}
                }
            ):
                raise GateError(f"private Social prepared client {client_id} is misbound")
            self.service(client_id)
        storage = [Path(spec["storage_root"]).resolve() for spec in self.client_specs.values()]
        if len(set(storage)) != 4 or any(
            left in right.parents for left in storage for right in storage if left != right
        ):
            raise GateError("private Social client storage is not isolated")
        self.lifecycle = NativeClientLifecycleLedger()
        self.clients: dict[str, PreparedSocialNativeClient] = {}
        self.cleanup_result: dict[str, Any] | None = None

    def schema_bindings(self) -> dict[str, Any]:
        from tooling.acceptance.core import ArtifactRef, EvidenceStore, workspace_id
        from tooling.acceptance.core.evidence_store import current_artifact_ref
        from tooling.development.secure_content import runtime_manifest
        from tooling.development.secure_content.runtime_schema import RUNTIME_TARGETS

        store = EvidenceStore.from_environment(repo_root=self.repo_root, worktree=self.repo_root)
        inventory_ref = current_artifact_ref(SCHEMA_INVENTORY_PATH, repo_root=self.repo_root)
        inventory = store.read_json(inventory_ref)
        if (
            inventory.get("artifactKind") != "private-social-schema-inventory"
            or inventory.get("runId") != self.manifest["runId"]
            or inventory.get("sourceCommit") != self.manifest["source"]["commit"]
            or inventory.get("workspaceId") != workspace_id(self.repo_root)
            or set(inventory.get("services", {})) != {"station-four", "station-five-arm"}
        ):
            raise GateError("private Social schema inventory source/run is misbound")
        result = {}
        for role, entry in inventory["services"].items():
            target = RUNTIME_TARGETS.get(entry["profileId"])
            service = self.service("alice" if role == "station-four" else "bob")
            if (
                target is None or entry["physicalServiceId"] != target.service_id
                or entry["deploymentEnvironment"] != target.deployment_environment
                or service["deploymentEnvironment"] != target.deployment_environment
            ):
                raise GateError("private Social physical schema/Profile is misbound")
            raw_ref = entry["attestationRef"]
            ref = ArtifactRef.from_dict({
                **inventory_ref.to_dict(), "path": raw_ref["path"], "sha256": raw_ref["sha256"],
            })
            store.read_json(ref)
            path = store.resolve(ref)
            result[role] = runtime_manifest.load_canonical_private_schema_attestation(
                path, repo_root=self.repo_root,
                source_commit=inventory["sourceCommit"], workspace_id=inventory["workspaceId"],
                service_id=target.service_id, profile_id=target.profile_id,
                deployment_environment=target.deployment_environment,
                station_runtime_identity=service["runtimeIdentity"],
                service_attestation_digest=runtime_manifest.schema_service_attestation_binding_digest(
                    target.service_id, {
                        "kind": service["kind"],
                        "deployment_environment": service["deploymentEnvironment"],
                        "schema_attestation_endpoint": service["endpoint"],
                        "live_commit": service["liveCommit"],
                        "protocol_digest": service["protocolDigest"],
                        "runtime_identity": service["runtimeIdentity"],
                    },
                ),
            )
        self.schema_inventory_ref = inventory_ref.to_dict()
        self.schema_inventory = inventory
        return result

    def attestation(self, client_id: str) -> Any:
        from tooling.acceptance.core import ArtifactRef, EvidenceStore
        from tooling.acceptance.core.provisioning import ServiceAttestation
        service = self.service(client_id)
        raw_ref = service["attestationArtifact"]
        raw = EvidenceStore.from_environment(
            repo_root=self.repo_root, worktree=self.repo_root,
        ).read_json(ArtifactRef.from_dict(raw_ref))
        return ServiceAttestation(
            service_id=CLIENT_BINDINGS[client_id][1], service_kind=service["kind"],
            environment_id=self.manifest["environmentId"],
            deployment_environment=service["deploymentEnvironment"],
            endpoint=service["endpoint"], live_commit=service["liveCommit"],
            workspace_digest=service["workspaceDigest"], protocol_digest=service["protocolDigest"],
            artifact_ref=raw_ref, produced_at=raw["capturedAt"], producer=raw["producer"],
            build_time=raw.get("liveMetadata", {}).get("buildTime", ""),
            runtime_identity=service["runtimeIdentity"],
        )

    def service(self, client_id: str) -> dict[str, Any]:
        from tooling.acceptance.gates.chat.native_support import runtime_station_service
        service = runtime_station_service(self.manifest, client_id)
        if (
            service["liveCommit"] != self.manifest["source"]["commit"]
            or not service.get("runtimeIdentity") or not service.get("endpoint")
        ):
            raise GateError("private Social Station is not on the prepared source")
        return service

    def account(self, role: str) -> str:
        return self.actors[role]["accountRef"].removeprefix("station-account:")

    def client(self, client_id: str) -> PreparedSocialNativeClient:
        if (
            client_id not in CLIENT_BINDINGS or client_id == "eve" or client_id in self.clients
            or self.cleanup_result is not None
        ):
            raise GateError("private Social client allocation is invalid or repeated")
        client = PreparedSocialNativeClient(self, client_id)
        self.clients[client_id] = client
        return client

    def verify_snapshot(self, client_id: str, snapshot: Mapping[str, Any]) -> None:
        role = CLIENT_BINDINGS[client_id][0]
        expected = hashlib.sha256(self.actors[role]["ptid"].encode()).hexdigest()
        if snapshot.get("actorPtidSha256") != expected:
            raise GateError("private Social authenticated actor differs from prepared fixture")

    def verify_source(self) -> None:
        from tooling.acceptance.core.runtime_cell import runtime_source_matches
        if not runtime_source_matches(self.binding.runtime_identity()["source"],
                                      self.manifest["source"]):
            raise GateError("private Social Native source changed within the Suite")

    def cleanup(self) -> dict[str, Any]:
        if self.cleanup_result is None:
            failures = self.lifecycle.release_all()
            sessions = [client.session for client in self.clients.values() if client.session is not None]
            result = self.binding.finalize_cleanup(sessions, self.client_specs)
            failures.extend(result.get("cleanupErrors", []))
            if not all(result.get(field) is True for field in (
                "portsReleased", "processesReleased", "storageReleased", "logsReleased",
            )):
                failures.append({"resource": "private-social-native", "error": "owned resources remain"})
            self.cleanup_result = {**result, "failures": failures}
        if self.cleanup_result["failures"]:
            raise GateError(f"private Social Native cleanup failed: {self.cleanup_result['failures']}")
        return self.cleanup_result
