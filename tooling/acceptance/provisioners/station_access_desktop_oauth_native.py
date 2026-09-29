from __future__ import annotations

import dataclasses
import shutil
import socket
import tempfile
from pathlib import Path

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.attestation import (
    commits_match,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
)


GATE_ID = "station-access-desktop-oauth-native-e2e"
CLIENT_ID = "oauth-login"


def _available_ports(count: int) -> tuple[int, ...]:
    listeners = [socket.socket() for _ in range(count)]
    try:
        for listener in listeners:
            listener.bind(("127.0.0.1", 0))
        return tuple(int(listener.getsockname()[1]) for listener in listeners)
    finally:
        for listener in listeners:
            listener.close()


class StationAccessDesktopOAuthNativeProvisioner(EnvironmentProvisioner):
    environment_id = "station-access-desktop-oauth-native"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id != GATE_ID:
                raise BlockedError(
                    reason=f"unsupported Desktop OAuth Gate: {gate_id}",
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
                    reason="Desktop OAuth native proof requires a clean worktree",
                    resource="source-identity:worktree-cleanliness",
                )

            station_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
            health_url = profile_env.get("PT_STATION_HEALTH_URL", "").strip()
            deployment_environment = profile_env.get(
                "PT_STATION_DEPLOY_ENV",
                "",
            ).strip()
            if not station_url or not deployment_environment:
                raise BlockedError(
                    reason="Active profile is missing its Station deployment binding",
                    resource="profile:station-binding",
                )
            if not self._station_ready(station_url, health_url):
                raise BlockedError(
                    reason=f"Profile Station is not ready at {station_url}",
                    resource=f"station:{station_url}",
                )

            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(deployment_environment, owner)
            if profile_env.get("PT_STATION_MODE", "local") == "remote":
                self.acquire_remote_git_source_lease(
                    deployment_environment,
                    owner,
                )
            attestation = produce_station_attestation(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                service_id="station",
                station_url=station_url,
                profile_env=profile_env,
                require_runtime_identity=True,
                remote_source_identity_provider=resolve_remote_source_identity,
            )
            if not commits_match(attestation.live_commit, manifest.source_commit):
                raise BlockedError(
                    reason=(
                        f"Station commit {attestation.live_commit} does not "
                        f"match client source {manifest.source_commit}"
                    ),
                    resource="source-identity:commit",
                )
            if attestation.protocol_digest != source_proto_digest(REPO_ROOT):
                raise BlockedError(
                    reason="Station and client proto digests do not match",
                    resource="source-identity:proto",
                )

            declared = {client.id: client for client in self.contract.clients}
            if set(declared) != {CLIENT_ID}:
                raise BlockedError(
                    reason="Desktop OAuth environment must declare one login client",
                    resource=f"gate-environment:{gate_id}",
                )
            runtime_root = Path(
                tempfile.mkdtemp(prefix=f"pt-desktop-oauth-{manifest.run_id}-")
            )
            self.register_cleanup(
                f"client-storage:{runtime_root}",
                lambda: shutil.rmtree(runtime_root, ignore_errors=True),
            )
            client_contract = declared[CLIENT_ID]
            gateway_port, renderer_port, webdriver_port = _available_ports(3)
            client = ClientRuntime(
                id=CLIENT_ID,
                actor=client_contract.actor,
                runtime="native-tauri",
                worktree=str(REPO_ROOT),
                gateway_port=gateway_port,
                renderer_port=renderer_port,
                webdriver_port=webdriver_port,
                profile=f"{profile_name}-oauth-login",
                storage_root=str(runtime_root / "storage"),
                required_service_roles=client_contract.required_service_roles,
                service_bindings=client_contract.service_bindings,
            )
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services={attestation.service_id: attestation},
                clients=(client,),
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (BlockedError, KeyError, OSError, ValueError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Desktop OAuth provisioning failed: {error}",
                    resource="station-access-desktop-oauth-native",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
