from __future__ import annotations

import dataclasses
import os
import re
import shutil
import socket
import subprocess
import tempfile
from collections.abc import Mapping
from pathlib import Path

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
    "station-four": "four",
    "station-five": "fiveArm",
}
_CROSS_STATION_SOCIAL_SERVICE_PROFILES = {
    "station-four": "four",
    "station-five-arm": "fiveArm",
}
_CROSS_STATION_SOCIAL_GATE_ROLES = {
    "social-cross-station-native-e2e": ("alice", "bob", "eve"),
}
_CROSS_STATION_SOCIAL_GATE_CLIENTS = {
    "social-cross-station-native-e2e": ("alice", "bob", "eve", "bob2"),
}
PROFILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class NativeTauriEmbeddedWebDriverProvisioner(HomeStationProvisioner):
    environment_id = "native-tauri-embedded-webdriver"
    fixture_id = "chat-native-actors"
    default_authorization_ref = "env:CHAT_ACCEPTANCE_RESET"
    product_label = "Native Chat"

    def __init__(
        self,
        contract: EnvironmentContract,
        *,
        station_profiles: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(contract)
        self._station_profiles = dict(
            _SERVICE_PROFILES
            if not station_profiles
            else station_profiles
        )

    def _required_station_profiles(self) -> dict[str, str]:
        expected = {
            service_id
            for service_id, service in self.contract.services.items()
            if service.kind == "station"
        }
        provided = set(self._station_profiles)
        missing = sorted(expected - provided)
        unexpected = sorted(provided - expected)
        if missing or unexpected:
            detail = []
            if missing:
                detail.append(f"missing={','.join(missing)}")
            if unexpected:
                detail.append(f"unexpected={','.join(unexpected)}")
            raise BlockedError(
                reason=(
                    f"{self.product_label} Station profiles must be specified "
                    "at run time "
                    "with --station-profile SERVICE_ID=PROFILE "
                    f"({'; '.join(detail)})"
                ),
                resource="station-profile-bindings",
            )
        invalid = sorted(
            profile_name
            for profile_name in self._station_profiles.values()
            if not PROFILE_NAME_PATTERN.fullmatch(profile_name)
        )
        if invalid:
            raise BlockedError(
                reason=f"Invalid Station profile name: {invalid[0]!r}",
                resource="station-profile-bindings",
            )
        duplicates = sorted(
            profile_name
            for profile_name in set(self._station_profiles.values())
            if list(self._station_profiles.values()).count(profile_name) > 1
        )
        if duplicates:
            raise BlockedError(
                reason=(
                    "Distinct Station services require distinct runtime profiles; "
                    f"duplicate={duplicates[0]!r}"
                ),
                resource="station-profile-bindings",
            )
        return dict(self._station_profiles)

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
        for service_id, profile_name in self._required_station_profiles().items():
            profile_path = (
                REPO_ROOT
                / ".local"
                / "dev"
                / "profiles"
                / f"{profile_name}.env"
            )
            if not profile_path.is_file():
                raise BlockedError(
                    reason=(
                        f"{self.product_label} service {service_id!r} requires runtime "
                        f"profile {profile_name!r}"
                    ),
                    resource=f"service-profile:{service_id}",
                )
            profile_env = load_env_file(profile_path)
            declared_profile = profile_env.get("PT_DEV_PROFILE", "").strip()
            if declared_profile != profile_name:
                raise BlockedError(
                    reason=(
                        f"Station profile {profile_name!r} declares "
                        f"PT_DEV_PROFILE={declared_profile!r}"
                    ),
                    resource=f"service-profile:{service_id}",
                )
            mode = (
                profile_env.get("PT_STATION_MODE", "local").strip() or "local"
            )
            deployment_environment = profile_env.get(
                "PT_STATION_DEPLOY_ENV",
                "",
            ).strip() or profile_name
            deployment_env: dict[str, str] = {}
            if mode == "remote":
                deployment_path = (
                    REPO_ROOT
                    / ".local"
                    / "deploy"
                    / "envs"
                    / f"{deployment_environment}.env"
                )
                if not deployment_path.is_file():
                    raise BlockedError(
                        reason=(
                            f"Station profile {profile_name!r} references "
                            f"missing deployment environment "
                            f"{deployment_environment!r}"
                        ),
                        resource=f"service-profile:{service_id}",
                    )
                deployment_env = load_env_file(deployment_path)
            station_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
            health_url = (
                profile_env.get("PT_STATION_HEALTH_URL", "").strip()
                or deployment_env.get("PT_DEPLOY_HEALTH_URL", "").strip()
            )
            if not station_url:
                raise BlockedError(
                    reason=f"Station profile {profile_name!r} has no endpoint",
                    resource=f"service-profile:{service_id}",
                )
            owner = f"acceptance:{manifest.gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(deployment_environment, owner)
            if mode == "remote":
                self.acquire_remote_git_source_lease(
                    deployment_environment,
                    owner,
                )
            if not self._station_ready(station_url, health_url):
                if mode == "remote":
                    raise BlockedError(
                        reason=(
                            f"{self.product_label} service {service_id!r} is not "
                            "healthy at its declared profile endpoint"
                        ),
                        resource=f"service-health:{service_id}",
                    )
                station_environment = {
                    **os.environ,
                    "PT_DEV_PROFILE_FILE": str(profile_path),
                }
                station_script = (
                    REPO_ROOT
                    / "tooling"
                    / "scripts"
                    / "local-dev"
                    / "station-dev.sh"
                )
                completed = subprocess.run(
                    ["bash", str(station_script)],
                    cwd=REPO_ROOT,
                    env=station_environment,
                    capture_output=True,
                    text=True,
                    timeout=180,
                    check=False,
                )
                if completed.returncode != 0 or not self._station_ready(
                    station_url,
                    health_url,
                ):
                    detail = (
                        completed.stderr.strip()
                        or completed.stdout.strip()
                        or "Station remained unavailable"
                    )
                    raise BlockedError(
                        reason=f"Local Station provisioning failed: {detail}",
                        resource=f"service-health:{service_id}",
                    )

                def stop_local_station(
                    environment: dict[str, str] = station_environment,
                ) -> None:
                    stop_script = (
                        REPO_ROOT
                        / "tooling"
                        / "scripts"
                        / "local-dev"
                        / "stop.sh"
                    )
                    stopped = subprocess.run(
                        ["bash", str(stop_script), "station"],
                        cwd=REPO_ROOT,
                        env=environment,
                        capture_output=True,
                        text=True,
                        timeout=60,
                        check=False,
                    )
                    if stopped.returncode != 0:
                        detail = (
                            stopped.stderr.strip()
                            or stopped.stdout.strip()
                            or "unknown station-stop failure"
                        )
                        raise RuntimeError(detail)

                self.register_cleanup(
                    f"local-station:{service_id}",
                    stop_local_station,
                )
            attestation = produce_station_attestation(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                service_id=service_id,
                station_url=station_url,
                profile_env=profile_env,
                require_runtime_identity=True,
                remote_source_identity_provider=(
                    resolve_remote_source_identity
                    if mode == "remote"
                    else None
                ),
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
                        f"{self.product_label} actor role {role!r} must bind to exactly "
                        "one fixture Station"
                    ),
                    resource=f"fixture-binding:{role}",
                )
            service_id = service_ids.pop()
            service = services.get(service_id)
            if service is None:
                raise BlockedError(
                    reason=(
                        f"{self.product_label} actor role {role!r} binds unknown "
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
            profile_name, _, slot, _ = self._resolve_active_profile()
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
            fixture = next(
                (
                    item
                    for item in self.contract.fixtures
                    if item.id == self.fixture_id
                ),
                None,
            )
            if fixture is None:
                raise BlockedError(
                    reason=(
                        f"{self.product_label} contract is missing its "
                        f"{self.fixture_id} fixture"
                    ),
                    resource=f"fixture:{self.fixture_id}",
                )
            authorization_ref = (
                fixture.authorization_ref or self.default_authorization_ref
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


class CrossStationSocialNativeProvisioner(
    NativeTauriEmbeddedWebDriverProvisioner
):
    environment_id = "cross-station-social-native"
    required_profile = "four"
    required_slot = 13
    fixture_id = "cross-station-social-actors"
    default_authorization_ref = "env:SOCIAL_CROSS_STATION_ACCEPTANCE_RESET"
    product_label = "Cross-Station Social"

    def __init__(
        self,
        contract: EnvironmentContract,
        *,
        station_profiles: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(
            contract,
            station_profiles=(
                _CROSS_STATION_SOCIAL_SERVICE_PROFILES
                if not station_profiles
                else station_profiles
            ),
        )

    def _resolve_active_profile(self) -> tuple[str, Path, int, dict[str, str]]:
        profile, profile_path, slot, environment = (
            super()._resolve_active_profile()
        )
        if profile != self.required_profile or slot != self.required_slot:
            raise BlockedError(
                reason=(
                    "Cross-Station Social requires active profile four "
                    "at slot 13"
                ),
                resource="profile:four",
            )
        return profile, profile_path, slot, environment

    def _clients(
        self,
        gate_id: str,
        run_id: str,
        slot: int,
    ) -> tuple[ClientRuntime, ...]:
        roles = _CROSS_STATION_SOCIAL_GATE_CLIENTS.get(gate_id)
        if roles is None:
            raise BlockedError(
                reason=(
                    "Cross-Station Social has no client allocation for gate "
                    f"{gate_id}"
                ),
                resource=f"gate-environment:{gate_id}",
            )
        contract_clients = {client.id: client for client in self.contract.clients}
        missing_clients = sorted(set(roles) - set(contract_clients))
        if missing_clients:
            raise BlockedError(
                reason=(
                    "Environment contract has no allocation for clients: "
                    f"{', '.join(missing_clients)}"
                ),
                resource=f"gate-environment:{gate_id}",
            )

        gateway_base = 3330 + slot * 100
        renderer_base = 3510 + slot * 100
        webdriver_base = 4445 + slot * 10
        run_root = (
            Path(tempfile.gettempdir())
            / f"pt-social-cross-station-{run_id}-{gate_id}"
        )
        clients = tuple(
            ClientRuntime(
                actor=contract_clients[role].actor,
                runtime="native-tauri",
                worktree=str(REPO_ROOT),
                gateway_port=gateway_base + index,
                renderer_port=renderer_base + index,
                webdriver_port=webdriver_base + index,
                profile=f"social-cross-station-{role}",
                storage_root=str(run_root / role / "storage"),
                id=role,
                required_service_roles=(
                    contract_clients[role].required_service_roles
                ),
                service_bindings=contract_clients[role].service_bindings,
            )
            for index, role in enumerate(roles)
        )
        for client in clients:
            for label, port in (
                ("gateway", client.gateway_port),
                ("renderer", client.renderer_port),
                ("webdriver", client.webdriver_port),
            ):
                with socket.socket() as probe:
                    if probe.connect_ex(("127.0.0.1", port)) == 0:
                        raise BlockedError(
                            reason=(
                                f"{client.id} {label} port {port} is "
                                "already in use"
                            ),
                            resource=f"client-isolation:{label}-port:{port}",
                        )
        self.register_cleanup(
            f"client-storage:{run_root}",
            lambda: shutil.rmtree(run_root, ignore_errors=True),
        )
        return clients

    @staticmethod
    def _actor_roles(gate_id: str) -> tuple[str, ...]:
        roles = _CROSS_STATION_SOCIAL_GATE_ROLES.get(gate_id)
        if roles is None:
            raise BlockedError(
                reason=(
                    "Cross-Station Social has no actor allocation for gate "
                    f"{gate_id}"
                ),
                resource=f"gate-environment:{gate_id}",
            )
        return roles
