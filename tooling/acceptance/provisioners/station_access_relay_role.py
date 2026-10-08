from __future__ import annotations

import dataclasses
import json
import shutil
import socket
import tempfile
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
from tooling.acceptance.core.launch_context import EphemeralGateLaunchContext
from tooling.acceptance.core.evidence_store import (
    current_artifact_ref,
    write_current_artifact,
)
from tooling.acceptance.core.provisioner import (
    EnvironmentProvisioner,
)
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
    ServiceAttestation,
    utc_now,
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
from tooling.acceptance.gates.station_access.relay_enrollment_e2e import (
    CAPABILITY_ID as ENROLLMENT_CAPABILITY_ID,
    GATE_ID as ENROLLMENT_GATE_ID,
    RelayEnrollmentCapabilityHandler,
)
from tooling.acceptance.gates.station_access.relay_endpoint_discovery_contract import (
    CAPABILITY_ID as DISCOVERY_CAPABILITY_ID,
    GATE_ID as DISCOVERY_GATE_ID,
    RelayEndpointDiscoveryCapabilityHandler,
)
from tooling.acceptance.gates.station_access.relay_opaque_tunnel_e2e import (
    CAPABILITY_ID as OPAQUE_TUNNEL_CAPABILITY_ID,
    GATE_ID as OPAQUE_TUNNEL_GATE_ID,
    RelayOpaqueTunnelCapabilityHandler,
)
ROLE_SECURITY_GATE_ID = "relay-role-security-contract"
DESKTOP_RELAY_NATIVE_GATE_ID = "station-access-desktop-relay-native-e2e"
DESKTOP_RELAY_WINDOWS_GATE_ID = "station-access-desktop-relay-windows-e2e"
DESKTOP_RELAY_GATE_IDS = frozenset(
    {
        DESKTOP_RELAY_NATIVE_GATE_ID,
        DESKTOP_RELAY_WINDOWS_GATE_ID,
    }
)
DESKTOP_RELAY_CLIENT_ID = "desktop-relay"


def _required(values: Mapping[str, str], key: str) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise BlockedError(
            reason=f"Active profile is missing {key}",
            resource=f"profile:{key}",
        )
    return value


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
    stream_port = status.get("streamPort")
    if (
        not commits_match(status_commit, source_commit)
        or not commits_match(build_commit, source_commit)
        or not status.get("runtimeOwner")
        or not status.get("containerId")
        or http_port != config.http_port
        or public_port != config.public_port
        or stream_port != config.stream_port
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
        "streamPort": stream_port,
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
        runtime_identity=str(relay_runtime["runtimeOwner"]),
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
        "streamEndpoint": (
            f"tls://{config_host(relay_url)}:{relay_runtime['streamPort']}"
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
    relay_transport_endpoint: str,
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
        "transportEndpoint": relay_transport_endpoint,
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


def config_host(endpoint: str) -> str:
    from urllib.parse import urlparse

    host = urlparse(endpoint).hostname
    if not host:
        raise BlockedError(
            reason=f"Relay endpoint has no host: {endpoint}",
            resource="profile:PT_RELAY_URL",
        )
    return host


def _relay_route_endpoint(
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


class StationAccessRelayRoleProvisioner(EnvironmentProvisioner):
    """Attach the role-security Gate to existing Station and Relay runtimes."""

    environment_id = "station-access-relay-role"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)
        self._station_config: PosixServiceRuntimeConfig | None = None
        self._relay_config: PosixServiceRuntimeConfig | None = None

    def create_gate_launch_context(
        self,
        *,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
        required_capabilities: tuple[str, ...],
    ) -> EphemeralGateLaunchContext | None:
        if not required_capabilities:
            return None
        if (
            gate_id == OPAQUE_TUNNEL_GATE_ID
            and required_capabilities == (OPAQUE_TUNNEL_CAPABILITY_ID,)
            and self._manifest is not None
            and self._manifest.is_ready()
            and evidence_run_id != provisioning_run_id
            and evidence_run_id == self.evidence_run.run_id
            and provisioning_run_id == self._manifest.run_id
            and self._station_config is not None
            and self._relay_config is not None
        ):
            context = EphemeralGateLaunchContext(
                required_capabilities=required_capabilities
            )
            context.register_capability(
                OPAQUE_TUNNEL_CAPABILITY_ID,
                RelayOpaqueTunnelCapabilityHandler(
                    self._station_config.transport(),
                    self._relay_config.transport(),
                    self._station_config,
                    self._relay_config,
                ),
            )
            return context
        if (
            gate_id == DISCOVERY_GATE_ID
            and required_capabilities == (DISCOVERY_CAPABILITY_ID,)
            and self._manifest is not None
            and self._manifest.is_ready()
            and evidence_run_id != provisioning_run_id
            and evidence_run_id == self.evidence_run.run_id
            and provisioning_run_id == self._manifest.run_id
            and self._station_config is not None
            and self._relay_config is not None
        ):
            context = EphemeralGateLaunchContext(
                required_capabilities=required_capabilities
            )
            context.register_capability(
                DISCOVERY_CAPABILITY_ID,
                RelayEndpointDiscoveryCapabilityHandler(
                    self._station_config.transport(),
                    self._relay_config.transport(),
                    self._station_config,
                    self._relay_config,
                ),
            )
            return context
        if (
            gate_id != ENROLLMENT_GATE_ID
            or required_capabilities != (ENROLLMENT_CAPABILITY_ID,)
            or self._manifest is None
            or not self._manifest.is_ready()
            or evidence_run_id == provisioning_run_id
            or evidence_run_id != self.evidence_run.run_id
            or provisioning_run_id != self._manifest.run_id
            or self._station_config is None
            or self._relay_config is None
        ):
            raise BlockedError(
                reason="Relay enrollment capability contract is incomplete",
                resource=f"ephemeral-capabilities:{gate_id}",
            )
        context = EphemeralGateLaunchContext(
            required_capabilities=required_capabilities
        )
        context.register_capability(
            ENROLLMENT_CAPABILITY_ID,
            RelayEnrollmentCapabilityHandler(
                self._station_config.transport(),
                self._relay_config.transport(),
                self._station_config,
                self._relay_config,
            ),
        )
        return context

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id not in {
                ROLE_SECURITY_GATE_ID,
                ENROLLMENT_GATE_ID,
                DISCOVERY_GATE_ID,
                OPAQUE_TUNNEL_GATE_ID,
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
            _required(profile_env, "PT_RELAY_HEALTH_URL")
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
                    not commits_match(identity[0], manifest.source_commit)
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
            )
            station_route_attestation = _persist_station_route_attestation(
                environment_id=self.environment_id,
                relay_locator=relay_url,
                relay_transport_endpoint=_relay_route_endpoint(
                    relay_url,
                    relay_runtime,
                ),
                station_attestation=station_attestation,
                relay_attestation=relay_attestation,
            )
            clients: tuple[ClientRuntime, ...] = ()
            cleanup_resources: tuple[str, ...] = ()
            if gate_id in DESKTOP_RELAY_GATE_IDS:
                declared = {
                    client.id: client for client in self.contract.clients
                }
                if set(declared) != {DESKTOP_RELAY_CLIENT_ID}:
                    raise BlockedError(
                        reason=(
                            "Desktop Relay environment must declare one "
                            "native client"
                        ),
                        resource=f"gate-environment:{gate_id}",
                    )
                runtime_root = Path(
                    tempfile.mkdtemp(
                        prefix=f"pt-desktop-relay-{manifest.run_id}-"
                    )
                )
                self.register_cleanup(
                    f"client-storage:{runtime_root}",
                    lambda: shutil.rmtree(runtime_root, ignore_errors=True),
                )
                gateway_port, renderer_port, webdriver_port = _available_ports(
                    3
                )
                client_contract = declared[DESKTOP_RELAY_CLIENT_ID]
                clients = (
                    ClientRuntime(
                        id=DESKTOP_RELAY_CLIENT_ID,
                        actor=client_contract.actor,
                        runtime=client_contract.runtime,
                        worktree=str(REPO_ROOT),
                        gateway_port=gateway_port,
                        renderer_port=renderer_port,
                        webdriver_port=webdriver_port,
                        profile=f"{profile_name}-desktop-relay",
                        storage_root=str(runtime_root / "storage"),
                        required_service_roles=(
                            client_contract.required_service_roles
                        ),
                        service_bindings=client_contract.service_bindings,
                    ),
                )
                cleanup_resources = self.contract.cleanup.resources
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services={
                    "station": station_attestation,
                    "relay": relay_attestation,
                    "station-via-relay": station_route_attestation,
                },
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
