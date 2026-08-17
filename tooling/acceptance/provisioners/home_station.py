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
    "chat-native-multi-device-e2e": ("alice", "bob"),
    "chat-native-recovery-e2e": ("alice", "bob"),
    "chat-native-group-mls-e2e": ("alice", "bob", "charlie"),
}

CLIENT_ROLES = {
    "chat-native-two-client-e2e": ("alice", "bob"),
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
        return tuple(refs), values

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
        worktrees = [
            Path(item).expanduser().resolve()
            for item in os.environ.get(
                "CHAT_NATIVE_CLIENT_WORKTREES",
                str(REPO_ROOT),
            ).split(",")
            if item.strip()
        ]
        if len(worktrees) == 1:
            worktrees *= len(roles)
        if len(worktrees) != len(roles):
            raise BlockedError(
                reason=(
                    f"{gate_id} requires one client worktree per runtime "
                    f"({len(roles)} required, {len(worktrees)} supplied)"
                ),
                resource="client-isolation:worktrees",
            )

        gateway_base = int(os.environ.get("CHAT_NATIVE_GATEWAY_PORT", "3330"))
        renderer_base = int(os.environ.get("CHAT_NATIVE_RENDERER_PORT", "3510"))
        webdriver_base = int(
            os.environ.get("CHAT_NATIVE_WEBDRIVER_PORT", "4445")
        )
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

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
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
            if attestation.proto_digest != local_proto_digest:
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
                station=attestation,
            )
            self._manifest = manifest
            if gate_id == "chat-federated-browser-prereq":
                return self._ready(manifest)

            credential_refs, credential_values = self._resolve_credentials()
            password = credential_values.get("chat-password", "")
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
                password=password,
                credential_ref=credential_refs[0],
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
        except BlockedError as error:
            return self._blocked(
                self._manifest,
                reason=error.reason,
                resource=error.resource,
            )
