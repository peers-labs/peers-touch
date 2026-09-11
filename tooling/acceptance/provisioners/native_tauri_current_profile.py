from __future__ import annotations

import dataclasses
import os
import shutil
import socket
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
from tooling.acceptance.fixtures.chat_native_actors import (
    fixture_password,
    produce_existing_actor_manifest,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
)


GATE_ID = "chat-native-current-profile-two-client-e2e"
CLIENT_ROLES = ("alice", "bob")


class NativeTauriCurrentProfileProvisioner(EnvironmentProvisioner):
    """Provision two native clients against the active non-destructive profile."""

    environment_id = "native-tauri-current-profile"

    def _resolve_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        return self._remember_resolved_credentials(
            ("fixture:apps/station/app/conf/actor.yml#preset_users",),
            {"chat-password": fixture_password()},
            sensitive=False,
        )

    @staticmethod
    def _assert_port_available(role: str, label: str, port: int) -> None:
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                raise BlockedError(
                    reason=f"{role} {label} port {port} is already in use",
                    resource=f"client-isolation:{label}-port:{port}",
                )

    def _clients(
        self,
        *,
        run_id: str,
        profile_name: str,
        profile_env: dict[str, str],
        slot: int,
    ) -> tuple[ClientRuntime, ...]:
        declared = {client.id: client for client in self.contract.clients}
        if set(declared) != set(CLIENT_ROLES):
            raise BlockedError(
                reason="Current-profile Native environment must declare Alice and Bob",
                resource=f"gate-environment:{GATE_ID}",
            )
        seed_root = Path(
            os.environ.get(
                "PT_CHAT_NATIVE_STORAGE_SEED",
                str(
                    REPO_ROOT
                    / ".local"
                    / "dev"
                    / "data"
                    / profile_name
                    / "desktop-app"
                ),
            )
        ).expanduser().resolve()
        if not (seed_root / "peers-touch").is_dir():
            raise BlockedError(
                reason=(
                    "Current-profile Native Gate requires an existing Desktop "
                    f"identity store at {seed_root}"
                ),
                resource="fixture:desktop-identity-storage",
            )

        run_root = Path(f"/tmp/pt-chat-native-current-{run_id}")
        run_root.mkdir(parents=True, exist_ok=False)
        self.register_cleanup(
            f"client-storage:{run_root}",
            lambda: shutil.rmtree(run_root, ignore_errors=True),
        )
        gateway_base = int(profile_env["PT_DESKTOP_APP_GATEWAY_PORT"])
        renderer_base = int(profile_env["PT_DESKTOP_APP_WEB_PORT"])
        webdriver_base = 4445 + slot * 10
        clients: list[ClientRuntime] = []
        for index, role in enumerate(CLIENT_ROLES):
            storage_root = run_root / role / "storage"
            shutil.copytree(seed_root, storage_root)
            client = ClientRuntime(
                actor=declared[role].actor,
                runtime="native-tauri",
                worktree=str(REPO_ROOT),
                gateway_port=gateway_base + index * 10,
                renderer_port=renderer_base + index * 10,
                webdriver_port=webdriver_base + index,
                profile=profile_name,
                storage_root=str(storage_root),
                id=role,
                required_service_roles=declared[role].required_service_roles,
                service_bindings=declared[role].service_bindings,
            )
            for label, port in (
                ("gateway", client.gateway_port),
                ("renderer", client.renderer_port),
                ("webdriver", client.webdriver_port),
            ):
                self._assert_port_available(role, label, port)
            clients.append(client)
        return tuple(clients)

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id != GATE_ID:
                raise BlockedError(
                    reason=f"unsupported current-profile Native Gate: {gate_id}",
                    resource=f"gate-environment:{gate_id}",
                )
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            station_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
            health_url = profile_env.get("PT_STATION_HEALTH_URL", "").strip()
            deployment_environment = profile_env.get(
                "PT_STATION_DEPLOY_ENV",
                "",
            ).strip()
            if (
                profile_env.get("PT_STATION_MODE") != "remote"
                or not station_url
                or not deployment_environment
            ):
                raise BlockedError(
                    reason=(
                        "Current-profile Native Gate requires an installed "
                        "remote Station profile"
                    ),
                    resource="profile:remote-station",
                )
            if not self._station_ready(station_url, health_url):
                raise BlockedError(
                    reason=f"Profile Station is not ready at {station_url}",
                    resource=f"station:{station_url}",
                )

            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(deployment_environment, owner)
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

            credential_refs, _ = self.prepare_credentials()
            _, _, actor_ref = produce_existing_actor_manifest(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                station_url=station_url,
                deployment_environment=deployment_environment,
                roles=CLIENT_ROLES,
                credential_ref=credential_refs[0],
            )
            clients = self._clients(
                run_id=manifest.run_id,
                profile_name=profile_name,
                profile_env=profile_env,
                slot=slot,
            )
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services={attestation.service_id: attestation},
                actor_manifest_ref=actor_ref,
                credential_refs=credential_refs,
                clients=clients,
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (BlockedError, KeyError, OSError, ValueError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Current-profile Native provisioning failed: {error}",
                    resource="native-current-profile",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
