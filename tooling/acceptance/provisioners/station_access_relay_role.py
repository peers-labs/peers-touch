from __future__ import annotations

import dataclasses
import json
import re
import shutil
import socket
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Optional

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
    resolve_deployment_environment_path,
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
from tooling.acceptance.remote_platform import RemotePlatform
from tooling.acceptance.transports.ssh import SshTarget, SshTransport
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
from tooling.scripts.deploy.windows_runtime import (
    WindowsRuntimeConfig,
    execute as execute_windows_runtime,
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
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_RELAY_SECRET_FILES = frozenset(
    {
        "auth-secret",
        "relay-operator.key",
        "relay-signing.key",
        "relay-tls.key",
        "relay.crt",
    }
)


def _required(values: Mapping[str, str], key: str) -> str:
    value = values.get(key, "").strip()
    if not value:
        raise BlockedError(
            reason=f"Active profile is missing {key}",
            resource=f"profile:{key}",
        )
    return value


def _powershell_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _sha256_digest(value: object) -> str:
    normalized = str(value or "").lower()
    return normalized.removeprefix("sha256:")


def _protected_secret_files(
    value: object,
) -> Optional[list[dict[str, Any]]]:
    if not isinstance(value, list) or len(value) != len(_RELAY_SECRET_FILES):
        return None
    protected: list[dict[str, Any]] = []
    names: set[str] = set()
    for record in value:
        if not isinstance(record, dict):
            return None
        name = record.get("name")
        principals = record.get("principals")
        if (
            not isinstance(name, str)
            or name in names
            or record.get("exists") is not True
            or record.get("nonEmpty") is not True
            or record.get("aclProtected") is not True
            or record.get("expectedPrincipalsPresent") is not True
            or record.get("unexpectedPrincipals") != []
            or record.get("protected") is not True
            or not isinstance(principals, list)
            or not principals
            or any(not isinstance(principal, str) for principal in principals)
        ):
            return None
        names.add(name)
        protected.append(dict(record))
    if names != _RELAY_SECRET_FILES:
        return None
    return sorted(protected, key=lambda record: str(record["name"]))


def _windows_transport(config: WindowsRuntimeConfig) -> SshTransport:
    return SshTransport(
        SshTarget(
            host=config.host,
            user=config.user,
            port=config.ssh_port,
            known_hosts_file=config.known_hosts_file,
            remote_platform=RemotePlatform.WINDOWS,
        )
    )


def _runtime_status(config: WindowsRuntimeConfig) -> dict[str, Any]:
    try:
        return execute_windows_runtime(
            "status",
            config,
            branch="",
        )
    except (OSError, ProvisioningError, RuntimeError) as error:
        raise BlockedError(
            reason=(
                f"Cannot inspect attached {config.role} runtime "
                f"{config.environment_name}: {error}"
            ),
            resource=f"runtime-status:{config.environment_name}",
        ) from error


def _validate_runtime_status(
    status: Mapping[str, Any],
    *,
    config: WindowsRuntimeConfig,
    source_commit: str,
) -> dict[str, Any]:
    process_ids = status.get("processIds")
    deployment = status.get("manifest")
    if (
        status.get("artifactKind") != "windows-native-runtime-status"
        or status.get("environmentName") != config.environment_name
        or status.get("role") != config.role
        or status.get("taskName") != config.task_name
        or status.get("taskRegistered") is not True
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
        or not isinstance(deployment, Mapping)
    ):
        raise BlockedError(
            reason=(
                f"Attached {config.role} runtime status is incomplete or unhealthy"
            ),
            resource=f"runtime-status:{config.environment_name}",
        )

    status_commit = str(status.get("sourceCommit") or "")
    deployment_commit = str(deployment.get("sourceCommit") or "")
    binary_sha256 = _sha256_digest(deployment.get("binarySha256"))
    http_port = deployment.get("httpPort")
    stream_port = deployment.get("streamPort")
    if (
        not commits_match(status_commit, source_commit)
        or not commits_match(deployment_commit, source_commit)
        or not _SHA256.fullmatch(binary_sha256)
        or deployment.get("sourceClean") is not True
        or deployment.get("role") != config.role
        or deployment.get("taskName") != config.task_name
        or http_port != config.http_port
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
        "role": config.role,
        "taskName": config.task_name,
        "processIds": list(process_ids),
        "runtimePath": str(status.get("runtimePath") or ""),
        "sourceCommit": status_commit,
        "binarySha256": binary_sha256,
        "healthUrl": str(status.get("healthUrl") or ""),
        "httpPort": http_port,
        "streamPort": stream_port,
    }


def _relay_runtime_security(
    config: WindowsRuntimeConfig,
    relay_status: Mapping[str, Any],
    station_runtime: Mapping[str, Any],
) -> dict[str, Any]:
    deployment = relay_status.get("manifest")
    if not isinstance(deployment, Mapping):
        raise BlockedError(
            reason="Relay deployment manifest is unavailable",
            resource=f"runtime-status:{config.environment_name}",
        )
    binary_path = str(deployment.get("binaryPath") or "")
    binary_sha256 = _sha256_digest(deployment.get("binarySha256"))
    process_ids = relay_status.get("processIds")
    if (
        not binary_path
        or not _SHA256.fullmatch(binary_sha256)
        or not isinstance(process_ids, list)
        or not process_ids
    ):
        raise BlockedError(
            reason="Relay binary or process identity is unavailable",
            resource=f"runtime-status:{config.environment_name}",
        )

    runtime_path = config.runtime_path.replace("/", "\\")
    station_database = (
        str(station_runtime.get("runtimePath") or "")
        + "\\data\\station.db"
    )
    relay_database = (
        str(relay_status.get("runtimePath") or "")
        + "\\data\\relay.db"
    )
    process_id_list = ",".join(str(process_id) for process_id in process_ids)
    required_files = ",".join(
        _powershell_literal(name) for name in sorted(_RELAY_SECRET_FILES)
    )
    secret_root = _powershell_literal(runtime_path + "\\secrets")
    script = (
        "$ErrorActionPreference='Stop';"
        f"$root=Join-Path $env:USERPROFILE {secret_root};"
        f"$binary={_powershell_literal(binary_path)};"
        f"$stationDb={_powershell_literal(station_database)};"
        f"$relayDb={_powershell_literal(relay_database)};"
        f"$ids=@({process_id_list});"
        f"$required=@({required_files});"
        "$rootAcl=Get-Acl -LiteralPath $root;"
        "$principals=@($rootAcl.Access | ForEach-Object "
        "{$_.IdentityReference.Value} | Sort-Object -Unique);"
        "$allowed=@(\"$env:COMPUTERNAME\\$env:USERNAME\","
        "'NT AUTHORITY\\SYSTEM');"
        "$unexpected=@($principals | Where-Object {$allowed -notcontains $_});"
        "$files=@();"
        "foreach($name in $required){"
        "$path=Join-Path $root $name;"
        "$exists=[bool](Test-Path -LiteralPath $path -PathType Leaf);"
        "$nonEmpty=$false;"
        "$aclProtected=$false;"
        "$filePrincipals=@();"
        "$fileUnexpected=@();"
        "$expectedPrincipalsPresent=$false;"
        "if($exists){"
        "$nonEmpty=[bool]((Get-Item -LiteralPath $path).Length -gt 0);"
        "$fileAcl=Get-Acl -LiteralPath $path;"
        "$aclProtected=[bool]$fileAcl.AreAccessRulesProtected;"
        "$filePrincipals=@($fileAcl.Access | ForEach-Object "
        "{$_.IdentityReference.Value} | Sort-Object -Unique);"
        "$fileUnexpected=@($filePrincipals | "
        "Where-Object {$allowed -notcontains $_});"
        "$expectedPrincipalsPresent=[bool]("
        "@($allowed | Where-Object {$filePrincipals -notcontains $_})."
        "Count -eq 0);"
        "};"
        "$files += [PSCustomObject]@{"
        "name=$name;"
        "exists=$exists;"
        "nonEmpty=$nonEmpty;"
        "aclProtected=$aclProtected;"
        "principals=$filePrincipals;"
        "unexpectedPrincipals=$fileUnexpected;"
        "expectedPrincipalsPresent=$expectedPrincipalsPresent;"
        "protected=[bool]("
        "$exists -and $nonEmpty -and $aclProtected -and "
        "$expectedPrincipalsPresent -and $fileUnexpected.Count -eq 0)"
        "};"
        "};"
        "$processPaths=@(Get-CimInstance Win32_Process | "
        "Where-Object {$ids -contains [int]$_.ProcessId} | "
        "ForEach-Object {$_.ExecutablePath});"
        "$binaryHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $binary)."
        "Hash.ToLowerInvariant();"
        "[PSCustomObject]@{"
        "secretRootExists=[bool](Test-Path -LiteralPath $root -PathType Container);"
        "rootAclProtected=[bool]$rootAcl.AreAccessRulesProtected;"
        "principals=$principals;"
        "unexpectedPrincipals=$unexpected;"
        "requiredSecretFiles=$files;"
        "binarySha256=$binaryHash;"
        "processBinaryMatches=[bool]("
        "$processPaths.Count -eq $ids.Count -and "
        "@($processPaths | Where-Object {$_ -ne $binary}).Count -eq 0);"
        "stationDatabasePath=$stationDb;"
        "stationDatabaseExists=[bool]("
        "(Test-Path -LiteralPath $stationDb -PathType Leaf) -and "
        "((Get-Item -LiteralPath $stationDb).Length -gt 0));"
        "relayDatabasePath=$relayDb;"
        "relayDatabaseExists=[bool]("
        "(Test-Path -LiteralPath $relayDb -PathType Leaf) -and "
        "((Get-Item -LiteralPath $relayDb).Length -gt 0))"
        "} | ConvertTo-Json -Depth 5 -Compress"
    )
    completed = _windows_transport(config).run_argv(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ],
        timeout=30,
        check=False,
    )
    try:
        payload = json.loads(completed.stdout.strip())
    except json.JSONDecodeError as error:
        raise BlockedError(
            reason="Relay runtime security audit returned invalid JSON",
            resource=f"runtime-security:{config.environment_name}",
        ) from error
    if not isinstance(payload, dict):
        raise BlockedError(
            reason="Relay runtime security audit must return an object",
            resource=f"runtime-security:{config.environment_name}",
        )
    files = _protected_secret_files(payload.get("requiredSecretFiles"))
    if (
        completed.returncode != 0
        or payload.get("secretRootExists") is not True
        or payload.get("rootAclProtected") is not True
        or payload.get("unexpectedPrincipals") != []
        or files is None
        or _sha256_digest(payload.get("binarySha256")) != binary_sha256
        or payload.get("processBinaryMatches") is not True
        or payload.get("stationDatabasePath")
        == payload.get("relayDatabasePath")
        or payload.get("stationDatabaseExists") is not True
        or payload.get("relayDatabaseExists") is not True
    ):
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise BlockedError(
            reason=(
                "Relay runtime security ownership is incomplete"
                + (f": {detail[-1000:]}" if detail else "")
            ),
            resource=f"runtime-security:{config.environment_name}",
        )
    return {
        "secretRootExists": True,
        "rootAclProtected": True,
        "principals": list(payload.get("principals") or ()),
        "unexpectedPrincipals": [],
        "requiredProtectedFiles": list(files),
        "binarySha256": binary_sha256,
        "processBinaryMatches": True,
        "stationDatabasePath": str(payload["stationDatabasePath"]),
        "stationDatabaseExists": True,
        "relayDatabasePath": str(payload["relayDatabasePath"]),
        "relayDatabaseExists": True,
    }


def _persist_relay_attestation(
    *,
    environment_id: str,
    relay_url: str,
    relay_deployment: str,
    relay_identity: tuple[str, str, str],
    relay_status: Mapping[str, Any],
    station_runtime: Mapping[str, Any],
    relay_runtime: Mapping[str, Any],
    runtime_security: Mapping[str, Any],
) -> ServiceAttestation:
    commit, workspace_digest, protocol_digest = relay_identity
    deployment = relay_status.get("manifest")
    if not isinstance(deployment, Mapping):
        raise BlockedError(
            reason="Relay deployment manifest is unavailable",
            resource=f"runtime-status:{relay_deployment}",
        )
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
        build_time=str(deployment.get("deployedAt") or ""),
        runtime_identity=f"windows-task:{relay_runtime['taskName']}",
    )
    payload = attestation.to_dict()
    payload["runtimeSecurity"] = {
        "attachmentMode": "existing-owner-managed",
        "stationRuntime": dict(station_runtime),
        "relayRuntime": dict(relay_runtime),
        "relayStorageSecurity": dict(runtime_security),
        "streamEndpoint": (
            f"tls://{config_host(relay_url)}:{relay_runtime['streamPort']}"
        ),
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
    route_endpoint: str,
    station_attestation: ServiceAttestation,
    relay_attestation: ServiceAttestation,
) -> ServiceAttestation:
    attestation = ServiceAttestation(
        service_id="station-via-relay",
        service_kind="station",
        environment_id=environment_id,
        deployment_environment=station_attestation.deployment_environment,
        endpoint=route_endpoint,
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
    stream_port = relay_runtime.get("streamPort")
    if (
        isinstance(stream_port, bool)
        or not isinstance(stream_port, int)
        or stream_port <= 0
    ):
        raise BlockedError(
            reason="Relay runtime has no valid stream port",
            resource="relay-stream-endpoint",
        )
    return f"https://{config_host(relay_url)}:{stream_port}"


class StationAccessRelayRoleProvisioner(EnvironmentProvisioner):
    """Attach the role-security Gate to existing Station and Relay runtimes."""

    environment_id = "station-access-relay-role"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)
        self._station_config: WindowsRuntimeConfig | None = None
        self._relay_config: WindowsRuntimeConfig | None = None

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
                    _windows_transport(self._relay_config),
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
                    _windows_transport(self._relay_config),
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
                _windows_transport(self._relay_config),
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
            if not self._station_ready(relay_url, relay_health):
                raise BlockedError(
                    reason=f"Attached Relay is unhealthy at {relay_health}",
                    resource=f"service-health:{relay_deployment}",
                )

            station_config = WindowsRuntimeConfig.load(
                station_deployment,
                resolve_deployment_environment_path(station_deployment),
            )
            relay_config = WindowsRuntimeConfig.load(
                relay_deployment,
                resolve_deployment_environment_path(relay_deployment),
            )
            if (
                station_config.role != "station"
                or relay_config.role != "relay"
                or station_config.host != relay_config.host
            ):
                raise BlockedError(
                    reason="Station and Relay deployment roles are inconsistent",
                    resource=f"profile:{profile_name}",
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

            station_status = _runtime_status(station_config)
            relay_status = _runtime_status(relay_config)
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
                station_runtime["taskName"] == relay_runtime["taskName"]
                or station_runtime["runtimePath"] == relay_runtime["runtimePath"]
                or set(station_runtime["processIds"])
                & set(relay_runtime["processIds"])
            ):
                raise BlockedError(
                    reason="Station and Relay runtime ownership is not isolated",
                    resource=f"runtime-isolation:{profile_name}",
                )
            runtime_security = _relay_runtime_security(
                relay_config,
                relay_status,
                station_runtime,
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
                relay_status=relay_status,
                station_runtime=station_runtime,
                relay_runtime=relay_runtime,
                runtime_security=runtime_security,
            )
            station_route_attestation = _persist_station_route_attestation(
                environment_id=self.environment_id,
                route_endpoint=_relay_route_endpoint(
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
