from __future__ import annotations

import dataclasses
import os
import shutil
import socket
import subprocess
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
from tooling.acceptance.fixtures.chat_native_actors import produce_actor_manifest


GATE_ROLES = {
    "chat-native-two-client-e2e": ("alice", "bob"),
    "chat-native-interactions-e2e": ("alice", "bob", "charlie"),
    "chat-native-typing-e2e": ("alice", "bob", "charlie"),
    "chat-native-multi-device-e2e": ("alice", "bob"),
    "chat-native-recovery-e2e": ("alice", "bob"),
    "chat-native-group-mls-e2e": ("alice", "bob", "charlie"),
}

AGENT_V2_FOUNDATION_GATE = "agent-v2-kernel-foundation-e2e"
AGENT_V2_PROFILE = os.environ.get("PT_ACCEPTANCE_APPROVED_PROFILE", "one")
AGENT_V2_CREDENTIAL_REFS = (
    "profile:CHAT_NATIVE_DEMO_PASSWORD",
    "profile:PT_AGENT_PROVIDER_API_KEY",
    "profile:PT_AGENT_DEFAULT_MODEL_ID",
)

CLIENT_ROLES = {
    "chat-native-two-client-e2e": ("alice", "bob"),
    "chat-native-interactions-e2e": ("alice", "bob", "charlie"),
    "chat-native-typing-e2e": ("alice", "bob", "charlie"),
    "chat-native-multi-device-e2e": ("alice", "bob1", "bob2"),
    "chat-native-recovery-e2e": ("alice", "bob"),
    "chat-native-group-mls-e2e": ("alice", "bob", "charlie"),
}


class HomeStationProvisioner(EnvironmentProvisioner):
    environment_id = "home-station"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

    def _resolve_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        refs: list[str] = []
        values: dict[str, str] = {}
        for credential in self.contract.credentials:
            try:
                value = credential.resolve()
            except Exception as error:
                raise BlockedError(
                    reason=(
                        f"Cannot resolve credential {credential.id} from "
                        f"{credential.source_ref}: {error}"
                    ),
                    resource=f"credential-ref:{credential.source_ref}",
                ) from error
            refs.append(credential.source_ref)
            values[credential.id] = value
        return self._remember_resolved_credentials(tuple(refs), values)

    def _clients(
        self,
        gate_id: str,
        run_id: str,
    ) -> tuple[ClientRuntime, ...]:
        roles = CLIENT_ROLES.get(gate_id)
        if roles is None:
            raise BlockedError(
                reason=f"Home Station has no client allocation for gate {gate_id}",
                resource=f"gate-environment:{gate_id}",
            )
        worktrees = [REPO_ROOT] * len(roles)

        slot = int(os.environ.get("PT_DEV_SLOT", "0"))
        gateway_base = 3330 + slot * 100
        renderer_base = 3510 + slot * 100
        webdriver_base = 4445 + slot * 10
        run_root = Path(f"/tmp/pt-chat-native-{run_id}-{gate_id}")
        clients = tuple(
            ClientRuntime(
                actor=role,
                runtime="native-tauri",
                worktree=str(worktree),
                gateway_port=gateway_base + index,
                renderer_port=renderer_base + index,
                webdriver_port=webdriver_base + index,
                profile=f"chat-native-{role}",
                storage_root=str(run_root / role / "storage"),
            )
            for index, (role, worktree) in enumerate(zip(roles, worktrees))
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
                                f"{client.actor} {label} port {port} is "
                                "already in use"
                            ),
                            resource=f"client-isolation:{label}-port:{port}",
                        )
        self.register_cleanup(
            f"client-storage:{run_root}",
            lambda: shutil.rmtree(run_root, ignore_errors=True),
        )
        return clients

    def _agent_v2_foundation_client(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> ClientRuntime:
        worktree = Path(
            os.environ.get("PT_AGENT_V2_NATIVE_WORKTREE", str(REPO_ROOT))
        ).expanduser().resolve()
        client = ClientRuntime(
            actor="alice",
            runtime="native-tauri",
            worktree=str(worktree),
            gateway_port=int(
                os.environ.get(
                    "PT_AGENT_V2_NATIVE_GATEWAY_PORT",
                    profile_env.get(
                        "PT_DESKTOP_APP_GATEWAY_PORT",
                        str(3030 + slot * 100),
                    ),
                )
            ),
            renderer_port=int(
                os.environ.get(
                    "PT_AGENT_V2_NATIVE_RENDERER_PORT",
                    profile_env.get(
                        "PT_DESKTOP_APP_WEB_PORT",
                        str(3210 + slot * 100),
                    ),
                )
            ),
            webdriver_port=int(
                os.environ.get("PT_AGENT_V2_NATIVE_WEBDRIVER_PORT", "4445")
            ),
            profile=f"agent-v2-native-{run_id}",
            storage_root=f"/tmp/pt-agent-v2-{run_id}/native/storage",
        )
        self._assert_client_ports_available(client)
        self.register_cleanup(
            f"client-storage:/tmp/pt-agent-v2-{run_id}",
            lambda: shutil.rmtree(
                Path(f"/tmp/pt-agent-v2-{run_id}"),
                ignore_errors=True,
            ),
        )
        return client

    def _agent_v2_foundation_browser_client(
        self,
        run_id: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> ClientRuntime:
        worktree = Path(
            os.environ.get("PT_AGENT_V2_BROWSER_WORKTREE", str(REPO_ROOT))
        ).expanduser().resolve()
        client = ClientRuntime(
            actor="alice",
            runtime="browser",
            worktree=str(worktree),
            gateway_port=int(
                os.environ.get(
                    "PT_AGENT_V2_BROWSER_GATEWAY_PORT",
                    profile_env.get(
                        "PT_DESKTOP_WEB_GATEWAY_PORT",
                        str(3031 + slot * 100),
                    ),
                )
            ),
            renderer_port=int(
                os.environ.get(
                    "PT_AGENT_V2_BROWSER_RENDERER_PORT",
                    profile_env.get(
                        "PT_DESKTOP_WEB_WEB_PORT",
                        str(3211 + slot * 100),
                    ),
                )
            ),
            webdriver_port=int(
                os.environ.get("PT_AGENT_V2_BROWSER_WEBDRIVER_PORT", "4446")
            ),
            profile=f"agent-v2-browser-{run_id}",
            storage_root=f"/tmp/pt-agent-v2-{run_id}/browser/storage",
        )
        self._assert_client_ports_available(client, resource_prefix="browser-")
        return client

    @staticmethod
    def _assert_client_ports_available(
        client: ClientRuntime,
        *,
        resource_prefix: str = "",
    ) -> None:
        for label, port in (
            ("gateway", client.gateway_port),
            ("renderer", client.renderer_port),
            ("webdriver", client.webdriver_port),
        ):
            with socket.socket() as probe:
                if probe.connect_ex(("127.0.0.1", port)) == 0:
                    raise BlockedError(
                        reason=(
                            f"{client.actor} {resource_prefix}{label} port "
                            f"{port} is already in use"
                        ),
                        resource=(
                            f"client-isolation:{resource_prefix}{label}-port:{port}"
                        ),
                    )

    def _agent_v2_foundation_manifest(
        self,
        manifest: RuntimeManifest,
        *,
        station_url: str,
        deployment_environment: str,
        slot: int,
        profile_env: dict[str, str],
    ) -> RuntimeManifest:
        if profile_env.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise BlockedError(
                reason=(
                    "Agent V2 Foundation actor Fixture reset requires "
                    "CHAT_ACCEPTANCE_RESET=1 in the approved profile"
                ),
                resource="fixture-reset:authorization",
            )
        if not profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", ""):
            raise BlockedError(
                reason=(
                    "Agent V2 Foundation requires CHAT_NATIVE_DEMO_PASSWORD "
                    "in the approved profile"
                ),
                resource="credential-ref:profile:CHAT_NATIVE_DEMO_PASSWORD",
            )
        provider_api_key = profile_env.get("PT_AGENT_PROVIDER_API_KEY", "")
        if provider_api_key:
            values = {
                f"prepared-{index}": value
                for index, value in enumerate(self.resolved_credential_values)
            }
            values["PT_AGENT_PROVIDER_API_KEY"] = provider_api_key
            self._remember_resolved_credentials(
                AGENT_V2_CREDENTIAL_REFS,
                values,
            )
        _, _, actor_ref = produce_actor_manifest(
            environment_id=self.environment_id,
            run_id=manifest.run_id,
            station_url=station_url,
            deployment_environment=deployment_environment,
            roles=("alice",),
            credential_ref="profile:CHAT_NATIVE_DEMO_PASSWORD",
            reset_authorized=True,
        )
        return dataclasses.replace(
            manifest,
            actor_manifest_ref=actor_ref,
            credential_refs=AGENT_V2_CREDENTIAL_REFS,
            clients=(
                self._agent_v2_foundation_client(
                    manifest.run_id,
                    slot,
                    profile_env,
                ),
                self._agent_v2_foundation_browser_client(
                    manifest.run_id,
                    slot,
                    profile_env,
                ),
            ),
            cleanup_resources=self.contract.cleanup.resources,
        )

    @staticmethod
    def _validate_agent_v2_profile(
        gate_id: str,
        profile_name: str,
        profile_env: dict[str, str],
    ) -> None:
        if profile_name != AGENT_V2_PROFILE:
            raise BlockedError(
                reason=(
                    f"{gate_id} requires the approved {AGENT_V2_PROFILE} "
                    f"profile; active profile is {profile_name}"
                ),
                resource=f"profile:required:{AGENT_V2_PROFILE}",
            )
        if profile_env.get("PT_STATION_MODE", "local") != "remote":
            raise BlockedError(
                reason=f"{gate_id} requires a source-attested remote Station",
                resource="profile:PT_STATION_MODE",
            )
        if not profile_env.get("PT_STATION_DEPLOY_ENV", "").strip():
            raise BlockedError(
                reason=(
                    f"{gate_id} requires the remote Station deployment identity"
                ),
                resource="profile:PT_STATION_DEPLOY_ENV",
            )

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            if gate_id == AGENT_V2_FOUNDATION_GATE:
                self._validate_agent_v2_profile(
                    gate_id,
                    profile_name,
                    profile_env,
                )
            station_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
            health_url = profile_env.get("PT_STATION_HEALTH_URL", "")
            deployment_environment = (
                profile_env.get("PT_STATION_DEPLOY_ENV", "").strip()
                or profile_name
            )
            self.acquire_profile_lease(
                deployment_environment,
                f"acceptance:{gate_id}:{manifest.run_id}",
            )
            if not station_url:
                raise BlockedError(
                    reason="Active profile is missing PT_STATION_URL",
                    resource="profile:PT_STATION_URL",
                )
            if profile_env.get("PT_STATION_MODE", "local") == "remote":
                self.acquire_remote_git_source_lease(
                    deployment_environment,
                    f"acceptance:{gate_id}:{manifest.run_id}",
                )
            if not self._station_ready(station_url, health_url):
                if profile_env.get("PT_STATION_MODE", "local") != "remote":
                    completed = subprocess.run(
                        ["make", "station"],
                        cwd=REPO_ROOT,
                        capture_output=True,
                        text=True,
                        timeout=180,
                        check=False,
                    )
                    if completed.returncode == 0 and self._station_ready(
                        station_url,
                        health_url,
                    ):
                        def stop_local_station() -> None:
                            stopped = subprocess.run(
                                ["make", "station-stop"],
                                cwd=REPO_ROOT,
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
                            "local-station",
                            stop_local_station,
                        )
                    else:
                        detail = (
                            completed.stderr.strip()
                            or completed.stdout.strip()
                            or "Station remained unavailable"
                        )
                        raise BlockedError(
                            reason=f"Local Station provisioning failed: {detail}",
                            resource=f"station:{station_url}",
                        )
                else:
                    raise BlockedError(
                        reason=(
                            f"Remote Station is not reachable at {station_url}. "
                            "Run make station-check, then deploy through the "
                            "approved git-based Station workflow."
                        ),
                        resource=f"station:{station_url}",
                    )

            attestation = produce_station_attestation(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                service_id="station",
                station_url=station_url,
                profile_env=profile_env,
            )
            local_proto_digest = source_proto_digest(REPO_ROOT)
            if not commits_match(attestation.live_commit, manifest.source_commit):
                raise BlockedError(
                    reason=(
                        f"Station commit {attestation.live_commit} does not match "
                        f"client source commit {manifest.source_commit}"
                    ),
                    resource="source-identity:commit",
                )
            if gate_id == AGENT_V2_FOUNDATION_GATE:
                if manifest.workspace_digest != "clean":
                    raise BlockedError(
                        reason=(
                            "Agent V2 Foundation requires a clean candidate "
                            "worktree before remote proof"
                        ),
                        resource="source-identity:workspace",
                    )
                if not attestation.is_clean_workspace:
                    raise BlockedError(
                        reason=(
                            "Agent V2 Foundation requires a clean remote Station "
                            "deployment"
                        ),
                        resource="source-identity:station-workspace",
                    )
            if attestation.protocol_digest != local_proto_digest:
                raise BlockedError(
                    reason=(
                        "Station and client proto digests do not match; deploy the "
                        "current source before running native proof"
                    ),
                    resource="source-identity:proto",
                )

            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services={attestation.service_id: attestation},
            )
            self._manifest = manifest
            if gate_id == "chat-federated-browser-prereq":
                return self._ready(manifest)
            if gate_id == AGENT_V2_FOUNDATION_GATE:
                manifest = self._agent_v2_foundation_manifest(
                    manifest,
                    station_url=station_url,
                    deployment_environment=deployment_environment,
                    slot=slot,
                    profile_env=profile_env,
                )
                self._manifest = manifest
                return self._ready(manifest)

            credential_refs, _ = self._resolve_credentials()
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
                    reason="home-station contract is missing chat-native-actors fixture",
                    resource="fixture:chat-native-actors",
                )
            authorization_ref = (
                fixture.authorization_ref or "env:CHAT_ACCEPTANCE_RESET"
            )
            authorization_name = (
                authorization_ref[4:]
                if authorization_ref.startswith("env:")
                else authorization_ref
            )
            reset_authorized = (
                not fixture.authorization_required
                or os.environ.get(authorization_name) == "1"
            )
            if not profile_env.get("PT_STATION_DEPLOY_ENV", "").strip():
                raise BlockedError(
                    reason="Active profile is missing PT_STATION_DEPLOY_ENV",
                    resource="profile:PT_STATION_DEPLOY_ENV",
                )
            roles = GATE_ROLES.get(gate_id)
            if roles is None:
                raise BlockedError(
                    reason=f"home-station does not support gate {gate_id}",
                    resource=f"gate-environment:{gate_id}",
                )
            _, _, actor_ref = produce_actor_manifest(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                station_url=station_url,
                deployment_environment=deployment_environment,
                roles=roles,
                credential_ref=credential_refs[0] if credential_refs else "",
                reset_authorized=reset_authorized,
            )
            clients = self._clients(gate_id, manifest.run_id)
            manifest = dataclasses.replace(
                manifest,
                actor_manifest_ref=actor_ref,
                credential_refs=credential_refs,
                clients=clients,
                cleanup_resources=self.contract.cleanup.resources,
            )
            return self._ready(manifest)
        except (BlockedError, ValueError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Native client profile has an invalid port: {error}",
                    resource="profile:native-port",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
