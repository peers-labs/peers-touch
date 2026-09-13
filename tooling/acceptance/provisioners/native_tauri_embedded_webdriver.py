from __future__ import annotations

import dataclasses
import os
import subprocess

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.attestation import (
    commits_match,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    EnvironmentClient,
    ProvisioningState,
    RuntimeManifest,
    ServiceAttestation,
)
from tooling.acceptance.fixtures.chat_native_actors import (
    fixture_password,
    produce_bound_actor_manifest,
)

from .home_station import HomeStationProvisioner
from .remote_source_identity import resolve_remote_source_identity


_SERVICE_PROFILES = {
    "station-four": ("four", "station-four"),
    "station-five": ("fiveArm", "station-five-arm"),
}


class NativeTauriEmbeddedWebDriverProvisioner(HomeStationProvisioner):
    environment_id = "native-tauri-embedded-webdriver"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

    def _resolve_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        return self._remember_resolved_credentials(
            ("fixture:apps/station/app/conf/actor.yml#preset_users",),
            {"chat-password": fixture_password()},
            sensitive=False,
        )

    def _run_preflight_command(
        self,
        command: tuple[str, ...],
        *,
        timeout: int,
        resource: str,
    ) -> None:
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if completed.returncode == 0:
            return
        detail = (
            completed.stderr.strip()
            or completed.stdout.strip()
            or f"exit code {completed.returncode}"
        )
        raise BlockedError(
            reason=f"{' '.join(command)} failed: {detail[-4000:]}",
            resource=resource,
        )

    def _provision_station_services(
        self,
        manifest: RuntimeManifest,
    ) -> dict[str, ServiceAttestation]:
        services: dict[str, ServiceAttestation] = {}
        local_proto_digest = source_proto_digest(REPO_ROOT)
        for service_id, (profile_name, deployment_environment) in (
            _SERVICE_PROFILES.items()
        ):
            profile_path = (
                REPO_ROOT
                / ".local"
                / "dev"
                / "profiles"
                / f"{profile_name}.env"
            )
            deployment_path = (
                REPO_ROOT
                / ".local"
                / "deploy"
                / "envs"
                / f"{deployment_environment}.env"
            )
            if not profile_path.is_file() or not deployment_path.is_file():
                raise BlockedError(
                    reason=(
                        f"Native Chat service {service_id!r} requires profile "
                        f"{profile_name!r} and deployment "
                        f"{deployment_environment!r}"
                    ),
                    resource=f"service-profile:{service_id}",
                )
            profile_env = load_env_file(profile_path)
            deployment_env = load_env_file(deployment_path)
            station_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
            health_url = (
                profile_env.get("PT_STATION_HEALTH_URL", "").strip()
                or deployment_env.get("PT_DEPLOY_HEALTH_URL", "").strip()
            )
            if not station_url or not self._station_ready(
                station_url,
                health_url,
            ):
                raise BlockedError(
                    reason=(
                        f"Native Chat service {service_id!r} is not healthy "
                        f"at its declared profile endpoint"
                    ),
                    resource=f"service-health:{service_id}",
                )
            owner = f"acceptance:{manifest.gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(deployment_environment, owner)
            self.acquire_remote_git_source_lease(
                deployment_environment,
                owner,
            )
            attestation_env = {
                **profile_env,
                "PT_STATION_MODE": "remote",
                "PT_STATION_DEPLOY_ENV": deployment_environment,
            }
            attestation = produce_station_attestation(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                service_id=service_id,
                station_url=station_url,
                profile_env=attestation_env,
                require_runtime_identity=True,
                remote_source_identity_provider=resolve_remote_source_identity,
            )
            if not commits_match(
                attestation.live_commit,
                manifest.source_commit,
            ):
                raise BlockedError(
                    reason=(
                        f"{service_id} commit {attestation.live_commit} does "
                        f"not match client source {manifest.source_commit}"
                    ),
                    resource=f"source-identity:{service_id}:commit",
                )
            if attestation.protocol_digest != local_proto_digest:
                raise BlockedError(
                    reason=(
                        f"{service_id} protocol digest does not match the "
                        "client source"
                    ),
                    resource=f"source-identity:{service_id}:proto",
                )
            services[service_id] = attestation
        return services

    @staticmethod
    def _actor_role_targets(
        roles: tuple[str, ...],
        clients: tuple[ClientRuntime, ...],
        declared_clients: tuple[EnvironmentClient, ...],
        services: dict[str, ServiceAttestation],
    ) -> dict[str, tuple[str, str]]:
        targets: dict[str, tuple[str, str]] = {}
        for role in roles:
            service_ids = {
                binding.service_id
                for client in clients
                if client.actor == role
                for binding_role, binding in client.service_bindings.items()
                if binding_role == "station"
            }
            service_ids.update(
                binding.service_id
                for client in declared_clients
                if client.actor == role
                for binding_role, binding in client.service_bindings.items()
                if binding_role == "station"
            )
            if len(service_ids) != 1:
                raise BlockedError(
                    reason=(
                        f"Native Chat actor role {role!r} must bind to exactly "
                        "one fixture Station"
                    ),
                    resource=f"fixture-binding:{role}",
                )
            service_id = service_ids.pop()
            service = services.get(service_id)
            if service is None:
                raise BlockedError(
                    reason=(
                        f"Native Chat actor role {role!r} binds unknown "
                        f"service {service_id!r}"
                    ),
                    resource=f"fixture-binding:{role}",
                )
            targets[role] = (
                service.endpoint,
                service.deployment_environment,
            )
        return targets

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            services = self._provision_station_services(manifest)
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services=services,
            )
            self._manifest = manifest

            credential_refs, _ = self._resolve_credentials()
            fixture_station_url = profile_env.get(
                "PT_STATION_URL",
                "",
            ).rstrip("/")
            fixture_environment = profile_env.get(
                "PT_STATION_DEPLOY_ENV",
                "",
            ).strip()
            if not fixture_station_url or not fixture_environment:
                raise BlockedError(
                    reason=(
                        "Active profile must identify the approved disposable "
                        "Chat fixture Station"
                    ),
                    resource="fixture-profile",
                )
            fixture = next(
                (
                    item
                    for item in self.contract.fixtures
                    if item.id == "chat-native-actors"
                ),
                None,
            )
            if fixture is None:
                raise BlockedError(
                    reason="Native Chat contract is missing its actor fixture",
                    resource="fixture:chat-native-actors",
                )
            authorization_ref = (
                fixture.authorization_ref or "env:CHAT_ACCEPTANCE_RESET"
            )
            authorization_name = authorization_ref.removeprefix("env:")
            reset_authorized = (
                not fixture.authorization_required
                or os.environ.get(authorization_name) == "1"
            )
            roles = self._actor_roles(gate_id)
            clients = self._clients(gate_id, manifest.run_id, slot)
            _, _, actor_ref = produce_bound_actor_manifest(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                role_targets=self._actor_role_targets(
                    roles,
                    clients,
                    self.contract.clients,
                    services,
                ),
                credential_ref=credential_refs[0] if credential_refs else "",
                reset_authorized=reset_authorized,
            )
            manifest = dataclasses.replace(
                manifest,
                actor_manifest_ref=actor_ref,
                credential_refs=credential_refs,
                clients=clients,
                cleanup_resources=self.contract.cleanup.resources,
            )
            manifest = self._ready(manifest)
        except BlockedError as error:
            return self._blocked(
                self._manifest,
                reason=error.reason,
                resource=error.resource,
            )

        runtime_cell = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_CELL",
            "",
        ).strip()
        if runtime_cell and runtime_cell != "desktop-macos-native":
            return manifest
        try:
            self._run_preflight_command(
                ("make", "acceptance-driver-build"),
                timeout=1200,
                resource="desktop-acceptance-binary:build",
            )
            self._run_preflight_command(
                ("make", "acceptance-driver-smoke"),
                timeout=120,
                resource="desktop-acceptance-binary:smoke",
            )
            return manifest
        except (BlockedError, subprocess.TimeoutExpired) as error:
            if isinstance(error, BlockedError):
                blocked = error
            else:
                blocked = BlockedError(
                    reason=f"{' '.join(error.cmd)} timed out after {error.timeout}s",
                    resource="desktop-acceptance-binary:preflight",
                )
            return self._blocked(
                manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )

    @staticmethod
    def _actor_roles(gate_id: str) -> tuple[str, ...]:
        from .home_station import GATE_ROLES

        roles = GATE_ROLES.get(gate_id)
        if roles is None:
            raise BlockedError(
                reason=f"Native Chat has no actor allocation for {gate_id}",
                resource=f"gate-environment:{gate_id}",
            )
        return roles
