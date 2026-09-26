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
from tooling.acceptance.core.provisioning import (
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
)
from tooling.acceptance.fixtures.chat_native_actors import produce_actor_manifest
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
)

from .home_station import HomeStationProvisioner


GATE_IDS = frozenset(
    {
        "chat-storage-accounting-e2e",
        "chat-storage-redaction-recovery-e2e",
    }
)


class ChatStorageNativeProvisioner(HomeStationProvisioner):
    """Provision one Station and two isolated native clients for Chat storage."""

    environment_id = "chat-storage-native"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

    @staticmethod
    def _run_preflight_command(
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

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id not in GATE_IDS:
                raise BlockedError(
                    reason=f"Chat storage native does not support gate {gate_id}",
                    resource=f"gate-environment:{gate_id}",
                )
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            if profile_env.get("PT_STATION_MODE", "").strip() != "remote":
                raise BlockedError(
                    reason="Chat storage native requires a remote Station",
                    resource="profile:PT_STATION_MODE",
                )
            station_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
            health_url = profile_env.get("PT_STATION_HEALTH_URL", "").strip()
            deployment_environment = profile_env.get(
                "PT_STATION_DEPLOY_ENV",
                "",
            ).strip()
            if not station_url or not deployment_environment:
                raise BlockedError(
                    reason=(
                        "Chat storage native requires Station URL and "
                        "deployment identity"
                    ),
                    resource="profile:station",
                )
            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(deployment_environment, owner)
            self.acquire_remote_git_source_lease(
                deployment_environment,
                owner,
            )
            if not self._station_ready(station_url, health_url):
                raise BlockedError(
                    reason=(
                        f"Remote Station is not reachable at {station_url}; "
                        "deploy through the approved profile first"
                    ),
                    resource=f"station:{station_url}",
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
            if not commits_match(
                attestation.live_commit,
                manifest.source_commit,
            ):
                raise BlockedError(
                    reason=(
                        f"Station commit {attestation.live_commit} does not "
                        f"match client source {manifest.source_commit}"
                    ),
                    resource="source-identity:commit",
                )
            if attestation.protocol_digest != source_proto_digest(REPO_ROOT):
                raise BlockedError(
                    reason=(
                        "Station and client protocol digests do not match"
                    ),
                    resource="source-identity:proto",
                )
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services={"station": attestation},
            )
            self._manifest = manifest
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
                    reason=(
                        "Chat storage native contract is missing its actor "
                        "fixture"
                    ),
                    resource="fixture:chat-native-actors",
                )
            authorization_name = (
                fixture.authorization_ref or "env:CHAT_ACCEPTANCE_RESET"
            ).removeprefix("env:")
            reset_authorized = (
                not fixture.authorization_required
                or os.environ.get(authorization_name) == "1"
            )
            credential_refs, _ = self._resolve_credentials()
            _, _, actor_ref = produce_actor_manifest(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                station_url=station_url,
                deployment_environment=deployment_environment,
                roles=("alice", "bob"),
                credential_ref=credential_refs[0] if credential_refs else "",
                reset_authorized=reset_authorized,
            )
            clients = super()._clients(
                "chat-native-two-client-e2e",
                manifest.run_id,
                slot,
            )
            manifest = dataclasses.replace(
                manifest,
                actor_manifest_ref=actor_ref,
                credential_refs=credential_refs,
                clients=clients,
                cleanup_resources=self.contract.cleanup.resources,
            )
            manifest = self._ready(manifest)
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
        except (BlockedError, ValueError, subprocess.TimeoutExpired) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=(
                        f"{' '.join(error.cmd)} timed out after "
                        f"{error.timeout}s"
                    ),
                    resource="desktop-acceptance-binary:preflight",
                )
            )
            return self._blocked(
                manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
