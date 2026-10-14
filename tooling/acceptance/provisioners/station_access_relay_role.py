from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import shutil
import socket
import ssl
import subprocess
import tempfile
import urllib.request
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.attestation import (
    commits_match,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.evidence_store import (
    current_artifact_ref,
    workspace_id,
    write_current_artifact,
)
from tooling.acceptance.core.provisioner import (
    EnvironmentProvisioner,
)
from tooling.acceptance.core.provisioning import (
    ActorIdentity,
    ActorManifest,
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
    ServiceAttestation,
    utc_now,
)
from tooling.acceptance.fixtures.chat_native_actors import (
    persist_actor_manifest,
    resolve_existing_actor_identity,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
)
from tooling.acceptance.provisioners.posix_service_runtime import (
    PosixServiceRuntimeConfig,
    audit_posix_relay_security,
    inspect_posix_runtime,
    resolve_posix_relay_trust_anchor,
)
ROLE_SECURITY_GATE_ID = "relay-role-security-contract"
NODE_CONNECTIVITY_NATIVE_GATE_ID = "NCP-G03"
DESKTOP_RELAY_NATIVE_GATE_ID = "station-access-desktop-relay-native-e2e"
DESKTOP_RELAY_WINDOWS_GATE_ID = "station-access-desktop-relay-windows-e2e"
DESKTOP_RELAY_GATE_IDS = frozenset(
    {
        DESKTOP_RELAY_NATIVE_GATE_ID,
        DESKTOP_RELAY_WINDOWS_GATE_ID,
    }
)
DESKTOP_RELAY_CLIENT_ID = "desktop-relay"
NODE_CONNECTIVITY_CLIENT_IDS = ("alice", "bob")
NODE_CONNECTIVITY_STORAGE_ROOTS_ENV = (
    "PT_NCP_NATIVE_PERSISTENT_STORAGE_ROOTS"
)
NODE_CONNECTIVITY_STORAGE_MARKER = ".pt-ncp-native-state.json"
CHAT_FIXTURE_CREDENTIAL_REF = (
    "fixture:apps/station/app/conf/actor.yml#preset_users"
)
SERVICE_RUNTIME_IRRELEVANT_PREFIXES = (
    "apps/desktop/",
    "apps/mobile/",
    "docs/",
    "tooling/acceptance/",
)


def _required(values: Mapping[str, str], key: str) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise BlockedError(
            reason=f"Active profile is missing {key}",
            resource=f"profile:{key}",
        )
    return value


def _service_source_compatibility(
    runtime_commit: str,
    source_commit: str,
) -> dict[str, Any] | None:
    if commits_match(runtime_commit, source_commit):
        return {
            "mode": "exact-commit",
            "runtimeCommit": runtime_commit,
            "sourceCommit": source_commit,
            "changedPathCount": 0,
            "changedPathsSha256": hashlib.sha256(b"").hexdigest(),
        }
    try:
        completed = subprocess.run(
            [
                "git",
                "diff",
                "--name-only",
                "--no-renames",
                "--diff-filter=ACMRTUXB",
                f"{runtime_commit}..{source_commit}",
                "--",
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    changed_paths = tuple(
        sorted(
            {
                line.strip()
                for line in completed.stdout.splitlines()
                if line.strip()
            }
        )
    )
    if any(
        not path.startswith(SERVICE_RUNTIME_IRRELEVANT_PREFIXES)
        for path in changed_paths
    ):
        return None
    encoded_paths = "".join(f"{path}\n" for path in changed_paths).encode(
        "utf-8"
    )
    return {
        "mode": "service-tree-equivalent",
        "runtimeCommit": runtime_commit,
        "sourceCommit": source_commit,
        "changedPathCount": len(changed_paths),
        "changedPathsSha256": hashlib.sha256(encoded_paths).hexdigest(),
    }


def _validate_runtime_status(
    status: Mapping[str, Any],
    *,
    config: PosixServiceRuntimeConfig,
    source_commit: str,
) -> dict[str, Any]:
    process_ids = status.get("processIds")
    build_commit = str(status.get("buildCommit") or "")
    if (
        status.get("artifactKind") != "posix-compose-runtime-status"
        or status.get("environmentName") != config.environment_name
        or status.get("platform") != "linux"
        or status.get("role") != config.role
        or status.get("healthy") is not True
        or status.get("sourceClean") is not True
        or not isinstance(process_ids, list)
        or not process_ids
        or any(
            isinstance(process_id, bool)
            or not isinstance(process_id, int)
            or process_id <= 0
            for process_id in process_ids
        )
    ):
        raise BlockedError(
            reason=(
                f"Attached {config.role} runtime status is incomplete or unhealthy"
            ),
            resource=f"runtime-status:{config.environment_name}",
        )

    status_commit = str(status.get("sourceCommit") or "")
    http_port = status.get("httpPort")
    public_port = status.get("publicPort")
    libp2p_port = status.get("libp2pPort")
    source_compatibility = _service_source_compatibility(
        status_commit,
        source_commit,
    )
    build_compatibility = _service_source_compatibility(
        build_commit,
        source_commit,
    )
    if (
        source_compatibility is None
        or build_compatibility is None
        or not status.get("runtimeOwner")
        or not status.get("containerId")
        or http_port != config.http_port
        or public_port != config.public_port
        or libp2p_port != config.libp2p_port
    ):
        raise BlockedError(
            reason=(
                f"Attached {config.role} runtime identity does not match "
                f"source {source_commit}"
            ),
            resource=f"source-identity:{config.environment_name}",
        )
    return {
        "environmentName": config.environment_name,
        "platform": "linux",
        "role": config.role,
        "runtimeOwner": str(status["runtimeOwner"]),
        "processIds": list(process_ids),
        "runtimePath": str(status.get("runtimePath") or ""),
        "sourceCommit": status_commit,
        "buildCommit": build_commit,
        "buildTime": str(status.get("buildTime") or ""),
        "containerId": str(status["containerId"]),
        "imageDigest": str(status.get("imageDigest") or ""),
        "dataOwner": str(status.get("dataOwner") or ""),
        "httpPort": http_port,
        "publicPort": public_port,
        "libp2pPort": libp2p_port,
        "sourceCompatibility": {
            "runtime": source_compatibility,
            "build": build_compatibility,
        },
    }


def _persist_relay_attestation(
    *,
    environment_id: str,
    relay_url: str,
    relay_deployment: str,
    relay_identity: tuple[str, str, str],
    station_runtime: Mapping[str, Any],
    relay_runtime: Mapping[str, Any],
    runtime_security: Mapping[str, Any],
    trust_anchor: bytes,
    trust_anchor_digest: str,
    relay_peer_id: str,
) -> ServiceAttestation:
    commit, workspace_digest, protocol_digest = relay_identity
    attestation = ServiceAttestation(
        service_id="relay",
        service_kind="relay",
        environment_id=environment_id,
        deployment_environment=relay_deployment,
        endpoint=relay_url,
        live_commit=commit,
        workspace_digest=workspace_digest,
        protocol_digest=protocol_digest,
        artifact_ref={},
        produced_at=utc_now(),
        producer="station-relay-role-attachment",
        build_time=str(relay_runtime.get("buildTime") or ""),
        runtime_identity=relay_peer_id,
    )
    trust_anchor_path = "runtime/services/relay/tls-ca.pem"
    write_current_artifact(
        trust_anchor_path,
        trust_anchor,
        repo_root=REPO_ROOT,
    )
    payload = attestation.to_dict()
    payload["runtimeSecurity"] = {
        "attachmentMode": "existing-owner-managed",
        "stationRuntime": dict(station_runtime),
        "relayRuntime": dict(relay_runtime),
        "relayStorageSecurity": dict(runtime_security),
        "relayPeerId": relay_peer_id,
        "tlsTermination": {
            "implementation": "nginx",
            "runtimeOwner": (
                "docker-compose:"
                + str(relay_runtime["runtimeOwner"]).split(":", 1)[-1].split(
                    "/",
                    1,
                )[0]
                + "/relay-proxy"
            ),
            "upstream": "http://127.0.0.1:18080",
        },
        "circuitEndpoint": (
            f"/dns4/{config_host(relay_url)}/tcp/{relay_runtime['libp2pPort']}"
        ),
        "publicEndpoint": relay_url,
        "tlsTrustAnchor": {
            "sha256": trust_anchor_digest,
            "artifact": current_artifact_ref(
                trust_anchor_path,
                repo_root=REPO_ROOT,
                media_type="application/x-pem-file",
            ).to_dict(),
        },
    }
    relative_path = "runtime/services/relay/attestation.json"
    write_current_artifact(
        relative_path,
        (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8"),
        repo_root=REPO_ROOT,
    )
    return dataclasses.replace(
        attestation,
        artifact_ref=current_artifact_ref(
            relative_path,
            repo_root=REPO_ROOT,
            media_type="application/json",
        ).to_dict(),
    )


def _persist_station_route_attestation(
    *,
    environment_id: str,
    relay_locator: str,
    relay_discovery_endpoint: str,
    station_attestation: ServiceAttestation,
    relay_attestation: ServiceAttestation,
) -> ServiceAttestation:
    attestation = ServiceAttestation(
        service_id="station-via-relay",
        service_kind="station",
        environment_id=environment_id,
        deployment_environment=station_attestation.deployment_environment,
        endpoint=relay_locator,
        live_commit=station_attestation.live_commit,
        workspace_digest=station_attestation.workspace_digest,
        protocol_digest=station_attestation.protocol_digest,
        artifact_ref={},
        produced_at=utc_now(),
        producer="station-relay-role-attachment",
        build_time=station_attestation.build_time,
        runtime_identity=station_attestation.runtime_identity,
    )
    payload = attestation.to_dict()
    payload["route"] = {
        "routeType": "relay",
        "stationServiceId": station_attestation.service_id,
        "stationAttestationRef": dict(station_attestation.artifact_ref),
        "relayServiceId": relay_attestation.service_id,
        "relayAttestationRef": dict(relay_attestation.artifact_ref),
        "relayPeerId": relay_attestation.runtime_identity,
        "discoveryEndpoint": relay_discovery_endpoint,
    }
    relative_path = "runtime/services/station-via-relay/attestation.json"
    write_current_artifact(
        relative_path,
        (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8"),
        repo_root=REPO_ROOT,
    )
    return dataclasses.replace(
        attestation,
        artifact_ref=current_artifact_ref(
            relative_path,
            repo_root=REPO_ROOT,
            media_type="application/json",
        ).to_dict(),
    )


def _available_ports(count: int) -> tuple[int, ...]:
    listeners = [socket.socket() for _ in range(count)]
    try:
        for listener in listeners:
            listener.bind(("127.0.0.1", 0))
        return tuple(int(listener.getsockname()[1]) for listener in listeners)
    finally:
        for listener in listeners:
            listener.close()


def _prepare_node_connectivity_storage(
    *,
    profile_name: str,
    station_peer_id: str,
    actors: tuple[ActorIdentity, ...],
    run_id: str,
) -> dict[str, Path]:
    actors_by_role = {actor.role: actor for actor in actors}
    if (
        set(actors_by_role) != set(NODE_CONNECTIVITY_CLIENT_IDS)
        or not station_peer_id
    ):
        raise BlockedError(
            reason="NCP Native identity scope is incomplete",
            resource="client-isolation:persistent-storage",
        )

    raw_roots = os.environ.get(
        NODE_CONNECTIVITY_STORAGE_ROOTS_ENV,
        "",
    ).strip()
    if raw_roots:
        configured = tuple(
            Path(value.strip()).expanduser().resolve()
            for value in raw_roots.split(",")
            if value.strip()
        )
        if len(configured) != len(NODE_CONNECTIVITY_CLIENT_IDS):
            raise BlockedError(
                reason=(
                    "NCP Native storage override requires one root per client"
                ),
                resource="client-isolation:persistent-storage",
            )
        roots = dict(zip(NODE_CONNECTIVITY_CLIENT_IDS, configured))
    else:
        station_scope = hashlib.sha256(
            station_peer_id.encode("utf-8")
        ).hexdigest()[:16]
        base = (
            Path.home()
            / ".peers-touch"
            / "dev"
            / "workspaces"
            / workspace_id(REPO_ROOT)
            / "runtime"
            / "acceptance-state"
            / "station-access-relay-role"
            / profile_name
            / station_scope
        )
        roots = {
            role: (
                base
                / role
                / hashlib.sha256(
                    actors_by_role[role].ptid.encode("utf-8")
                ).hexdigest()[:16]
                / "desktop-app"
            )
            for role in NODE_CONNECTIVITY_CLIENT_IDS
        }

    if len(set(roots.values())) != len(NODE_CONNECTIVITY_CLIENT_IDS):
        raise BlockedError(
            reason="NCP Native storage roots must be distinct",
            resource="client-isolation:persistent-storage",
        )

    for role, root in roots.items():
        expected_marker = {
            "schemaVersion": 1,
            "environmentId": StationAccessRelayRoleProvisioner.environment_id,
            "gateId": NODE_CONNECTIVITY_NATIVE_GATE_ID,
            "profile": f"{profile_name}-{role}",
            "role": role,
            "actorPtid": actors_by_role[role].ptid,
            "stationPeerId": station_peer_id,
            "devicePolicy": "persistent-acceptance",
        }
        marker = root / NODE_CONNECTIVITY_STORAGE_MARKER
        if root.exists():
            if (
                root.is_symlink()
                or not root.is_dir()
                or any(path.is_symlink() for path in root.rglob("*"))
            ):
                raise BlockedError(
                    reason=f"NCP Native {role} storage root is unsafe",
                    resource=f"client-persistent-storage:{role}",
                )
            try:
                actual_marker = json.loads(
                    marker.read_text(encoding="utf-8")
                )
            except (OSError, json.JSONDecodeError) as error:
                raise BlockedError(
                    reason=(
                        f"NCP Native {role} storage marker is unavailable: "
                        f"{error}"
                    ),
                    resource=f"client-persistent-storage:{role}",
                ) from error
            if actual_marker != expected_marker:
                raise BlockedError(
                    reason=(
                        f"NCP Native {role} storage identity does not match "
                        "the selected Station Actor"
                    ),
                    resource=f"client-persistent-storage:{role}",
                )
            continue

        root.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = root.with_name(f".{root.name}.init-{run_id}")
        if temporary.exists():
            raise BlockedError(
                reason=(
                    f"NCP Native {role} storage initialization is already "
                    "pending"
                ),
                resource=f"client-persistent-storage:{role}",
            )
        try:
            temporary.mkdir(mode=0o700)
            temporary_marker = (
                temporary / NODE_CONNECTIVITY_STORAGE_MARKER
            )
            temporary_marker.write_text(
                json.dumps(expected_marker, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            if os.name != "nt":
                temporary_marker.chmod(0o600)
            os.replace(temporary, root)
        except Exception as error:
            shutil.rmtree(temporary, ignore_errors=True)
            if isinstance(error, BlockedError):
                raise
            raise BlockedError(
                reason=(
                    f"NCP Native {role} storage initialization failed: "
                    f"{error}"
                ),
                resource=f"client-persistent-storage:{role}",
            ) from error
    return roots


def config_host(endpoint: str) -> str:
    from urllib.parse import urlparse

    host = urlparse(endpoint).hostname
    if not host:
        raise BlockedError(
            reason=f"Relay endpoint has no host: {endpoint}",
            resource="profile:PT_RELAY_URL",
        )
    return host


def _relay_discovery_endpoint(
    relay_url: str,
    relay_runtime: Mapping[str, Any],
) -> str:
    parsed = urlparse(relay_url)
    public_port = relay_runtime.get("publicPort")
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or isinstance(public_port, bool)
        or not isinstance(public_port, int)
        or public_port <= 0
        or (parsed.port or 443) != public_port
    ):
        raise BlockedError(
            reason="Relay runtime has no valid public HTTPS endpoint",
            resource="relay-public-endpoint",
        )
    return relay_url.rstrip("/")


def _relay_peer_identity(
    relay_url: str,
    relay_health_url: str,
    trust_anchor: bytes,
) -> str:
    relay_origin = urlparse(relay_url)
    health = urlparse(relay_health_url)
    if (
        relay_origin.scheme.lower() != "https"
        or health.scheme.lower() != "https"
        or not relay_origin.hostname
        or health.hostname != relay_origin.hostname
        or (health.port or 443) != (relay_origin.port or 443)
    ):
        raise BlockedError(
            reason="Relay health endpoint is outside the attested Relay origin",
            resource="relay-runtime-identity",
        )
    try:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        context.load_verify_locations(cadata=trust_anchor.decode("ascii"))
        request = urllib.request.Request(
            relay_health_url,
            headers={"Accept": "application/json"},
            method="GET",
        )
        with urllib.request.urlopen(
            request,
            context=context,
            timeout=10,
        ) as response:
            raw = response.read(4097)
            status = response.status
            final_url = response.geturl()
    except (OSError, UnicodeError, ValueError) as error:
        raise BlockedError(
            reason=f"Cannot verify Relay runtime identity: {error}",
            resource="relay-runtime-identity",
        ) from error
    if (
        status != 200
        or final_url.rstrip("/") != relay_health_url.rstrip("/")
        or len(raw) > 4096
    ):
        raise BlockedError(
            reason="Relay health identity response is not canonical",
            resource="relay-runtime-identity",
        )
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise BlockedError(
            reason="Relay health identity response is invalid JSON",
            resource="relay-runtime-identity",
        ) from error
    if not isinstance(payload, dict):
        raise BlockedError(
            reason="Relay health identity response is incomplete",
            resource="relay-runtime-identity",
        )
    peer_id = str(payload.get("peer_id") or "").strip()
    if (
        payload.get("role") != "relay"
        or payload.get("status") != "ready"
        or not peer_id
        or len(peer_id) > 255
    ):
        raise BlockedError(
            reason="Relay health identity response is incomplete",
            resource="relay-runtime-identity",
        )
    return peer_id


class StationAccessRelayRoleProvisioner(EnvironmentProvisioner):
    """Attach Station Access Gates to existing Station and Relay runtimes."""

    environment_id = "station-access-relay-role"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)
        self._station_config: PosixServiceRuntimeConfig | None = None
        self._relay_config: PosixServiceRuntimeConfig | None = None
        self._relay_trust_anchor: bytes | None = None

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id not in {
                ROLE_SECURITY_GATE_ID,
                NODE_CONNECTIVITY_NATIVE_GATE_ID,
                *DESKTOP_RELAY_GATE_IDS,
            }:
                raise BlockedError(
                    reason=f"{self.environment_id} does not support {gate_id}",
                    resource=f"gate-environment:{gate_id}",
                )
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            if manifest.workspace_digest != "clean":
                raise BlockedError(
                    reason="Relay role proof requires a clean exact-source worktree",
                    resource="source-identity:workspace",
                )
            if (
                _required(profile_env, "PT_STATION_MODE") != "remote"
                or _required(profile_env, "PT_RELAY_MODE") != "remote"
            ):
                raise BlockedError(
                    reason=(
                        "Relay role proof requires remote Station and "
                        "Relay bindings"
                    ),
                    resource=f"profile:{profile_name}",
                )

            station_url = _required(profile_env, "PT_STATION_URL").rstrip("/")
            station_health = _required(
                profile_env,
                "PT_STATION_HEALTH_URL",
            )
            station_deployment = _required(
                profile_env,
                "PT_STATION_DEPLOY_ENV",
            )
            relay_url = _required(profile_env, "PT_RELAY_URL").rstrip("/")
            relay_health = _required(profile_env, "PT_RELAY_HEALTH_URL")
            relay_deployment = _required(
                profile_env,
                "PT_RELAY_DEPLOY_ENV",
            )
            if not self._station_ready(station_url, station_health):
                raise BlockedError(
                    reason=f"Attached Station is unhealthy at {station_health}",
                    resource=f"service-health:{station_deployment}",
                )
            station_config = PosixServiceRuntimeConfig.load(
                station_deployment,
                expected_role="station",
            )
            relay_config = PosixServiceRuntimeConfig.load(
                relay_deployment,
                expected_role="relay",
            )
            self._station_config = station_config
            self._relay_config = relay_config

            station_identity = resolve_remote_source_identity(
                station_deployment
            )
            relay_identity = resolve_remote_source_identity(relay_deployment)
            for deployment, identity in (
                (station_deployment, station_identity),
                (relay_deployment, relay_identity),
            ):
                if (
                    _service_source_compatibility(
                        identity[0],
                        manifest.source_commit,
                    )
                    is None
                    or identity[1] != "clean"
                    or identity[2] != source_proto_digest(REPO_ROOT)
                ):
                    raise BlockedError(
                        reason=(
                            f"Deployment {deployment} does not match the "
                            "clean local source and protocol"
                        ),
                        resource=f"source-identity:{deployment}",
                    )

            station_status = inspect_posix_runtime(station_config)
            relay_status = inspect_posix_runtime(relay_config)
            station_runtime = _validate_runtime_status(
                station_status,
                config=station_config,
                source_commit=manifest.source_commit,
            )
            relay_runtime = _validate_runtime_status(
                relay_status,
                config=relay_config,
                source_commit=manifest.source_commit,
            )
            if (
                station_runtime["runtimeOwner"]
                == relay_runtime["runtimeOwner"]
                or station_runtime["dataOwner"] == relay_runtime["dataOwner"]
            ):
                raise BlockedError(
                    reason="Station and Relay runtime ownership is not isolated",
                    resource=f"runtime-isolation:{profile_name}",
                )
            runtime_security = audit_posix_relay_security(
                relay_config,
                station_runtime=station_runtime,
                relay_runtime=relay_runtime,
            )
            trust_anchor, trust_anchor_digest = (
                resolve_posix_relay_trust_anchor(relay_deployment)
            )
            self._relay_trust_anchor = trust_anchor
            relay_peer_id = _relay_peer_identity(
                relay_url,
                relay_health,
                trust_anchor,
            )
            station_attestation = produce_station_attestation(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                service_id="station",
                station_url=station_url,
                profile_env={
                    "PT_STATION_MODE": "remote",
                    "PT_STATION_DEPLOY_ENV": station_deployment,
                },
                require_runtime_identity=True,
                remote_source_identity_provider=resolve_remote_source_identity,
            )
            relay_attestation = _persist_relay_attestation(
                environment_id=self.environment_id,
                relay_url=relay_url,
                relay_deployment=relay_deployment,
                relay_identity=relay_identity,
                station_runtime=station_runtime,
                relay_runtime=relay_runtime,
                runtime_security=runtime_security,
                trust_anchor=trust_anchor,
                trust_anchor_digest=trust_anchor_digest,
                relay_peer_id=relay_peer_id,
            )
            station_route_attestation = _persist_station_route_attestation(
                environment_id=self.environment_id,
                relay_locator=relay_url,
                relay_discovery_endpoint=_relay_discovery_endpoint(
                    relay_url,
                    relay_runtime,
                ),
                station_attestation=station_attestation,
                relay_attestation=relay_attestation,
            )
            clients: tuple[ClientRuntime, ...] = ()
            cleanup_resources: tuple[str, ...] = ()
            actor_manifest_ref: dict[str, Any] | None = None
            credential_refs: tuple[str, ...] = ()
            actors: tuple[ActorIdentity, ...] = ()
            client_ids: tuple[str, ...] = ()
            if gate_id in DESKTOP_RELAY_GATE_IDS:
                client_ids = (DESKTOP_RELAY_CLIENT_ID,)
            elif gate_id == NODE_CONNECTIVITY_NATIVE_GATE_ID:
                client_ids = NODE_CONNECTIVITY_CLIENT_IDS
                actors = tuple(
                    dataclasses.replace(
                        resolve_existing_actor_identity(station_url, role),
                        device_policy="persistent-acceptance",
                    )
                    for role in NODE_CONNECTIVITY_CLIENT_IDS
                )

            if client_ids:
                declared = {
                    client.id: client for client in self.contract.clients
                }
                missing_clients = sorted(set(client_ids) - set(declared))
                if missing_clients:
                    raise BlockedError(
                        reason=(
                            "Relay environment is missing Native clients: "
                            + ", ".join(missing_clients)
                        ),
                        resource=f"gate-environment:{gate_id}",
                    )
                storage_roots: dict[str, Path]
                storage_lifecycle = "ephemeral"
                if gate_id == NODE_CONNECTIVITY_NATIVE_GATE_ID:
                    storage_roots = _prepare_node_connectivity_storage(
                        profile_name=profile_name,
                        station_peer_id=station_attestation.runtime_identity,
                        actors=actors,
                        run_id=manifest.run_id,
                    )
                    storage_lifecycle = "persistent"
                else:
                    runtime_root = Path(
                        tempfile.mkdtemp(
                            prefix=f"pt-relay-native-{manifest.run_id}-"
                        )
                    )
                    self.register_cleanup(
                        f"client-storage:{runtime_root}",
                        lambda: shutil.rmtree(
                            runtime_root,
                            ignore_errors=True,
                        ),
                    )
                    storage_roots = {
                        client_id: runtime_root / client_id / "storage"
                        for client_id in client_ids
                    }
                ports = _available_ports(3 * len(client_ids))
                clients = tuple(
                    ClientRuntime(
                        id=client_id,
                        actor=client_contract.actor,
                        runtime=client_contract.runtime,
                        worktree=str(REPO_ROOT),
                        gateway_port=ports[index * 3],
                        renderer_port=ports[index * 3 + 1],
                        webdriver_port=ports[index * 3 + 2],
                        profile=f"{profile_name}-{client_id}",
                        storage_root=str(storage_roots[client_id]),
                        storage_lifecycle=storage_lifecycle,
                        required_service_roles=(
                            client_contract.required_service_roles
                        ),
                        service_bindings=client_contract.service_bindings,
                    )
                    for index, client_id in enumerate(client_ids)
                    for client_contract in (declared[client_id],)
                )
                cleanup_resources = self.contract.cleanup.resources
            if gate_id == NODE_CONNECTIVITY_NATIVE_GATE_ID:
                _, _, actor_manifest_ref = persist_actor_manifest(
                    ActorManifest(
                        fixture_id="node-connectivity-existing-actors",
                        environment_id=self.environment_id,
                        run_id=manifest.run_id,
                        created_at=utc_now(),
                        actors=actors,
                        credential_refs=(CHAT_FIXTURE_CREDENTIAL_REF,),
                        reset_authorized=False,
                        target_verified=True,
                        initial_state="existing",
                    )
                )
                credential_refs = (CHAT_FIXTURE_CREDENTIAL_REF,)
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services={
                    "station": station_attestation,
                    "relay": relay_attestation,
                    "station-via-relay": station_route_attestation,
                },
                actor_manifest_ref=actor_manifest_ref,
                credential_refs=credential_refs,
                clients=clients,
                cleanup_resources=cleanup_resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (OSError, ProvisioningError, RuntimeError, ValueError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Relay role attachment failed: {error}",
                    resource=f"environment:{self.environment_id}",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
