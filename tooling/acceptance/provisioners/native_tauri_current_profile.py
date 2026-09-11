from __future__ import annotations

import dataclasses
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request
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
    ActorIdentity,
    ActorManifest,
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
    utc_now,
)
from tooling.acceptance.fixtures.chat_native_actors import (
    ACTOR_ACCOUNTS,
    fixture_password,
    persist_actor_manifest,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
)


GATE_ID = "chat-native-current-profile-two-client-e2e"
CLIENT_ROLES = ("alice", "bob")


class NativeTauriCurrentProfileProvisioner(EnvironmentProvisioner):
    """Provision two native clients against the active non-destructive profile."""

    environment_id = "native-tauri-current-profile"

    @staticmethod
    def _storage_seeds(
        profile_name: str,
    ) -> tuple[Path, ...]:
        raw_seeds = os.environ.get(
            "PT_CHAT_NATIVE_STORAGE_SEEDS",
            "",
        )
        if raw_seeds.strip():
            seeds = tuple(
                Path(item).expanduser().resolve()
                for item in raw_seeds.split(",")
                if item.strip()
            )
        else:
            single_seed = Path(
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
            seeds = (single_seed,)
        if len(seeds) == 1:
            seeds *= len(CLIENT_ROLES)
        if len(seeds) != len(CLIENT_ROLES):
            raise BlockedError(
                reason=(
                    "Current-profile Native Gate requires one storage seed "
                    f"per client ({len(CLIENT_ROLES)} required, "
                    f"{len(seeds)} supplied)"
                ),
                resource="client-isolation:storage-seeds",
            )
        for seed in seeds:
            if not (seed / "peers-touch").is_dir():
                raise BlockedError(
                    reason=(
                        "Current-profile Native Gate requires an existing "
                        f"Desktop identity store at {seed}"
                    ),
                    resource="fixture:desktop-identity-storage",
                )
        return seeds

    def _resolve_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        return self._remember_resolved_credentials(
            ("fixture:apps/station/app/conf/actor.yml#preset_users",),
            {"chat-password": fixture_password()},
            sensitive=False,
        )

    @staticmethod
    def _resolve_existing_actor(
        station_url: str,
        role: str,
        password: str,
    ) -> ActorIdentity:
        account = ACTOR_ACCOUNTS.get(role)
        if not account:
            raise BlockedError(
                reason=f"unsupported current-profile actor role: {role}",
                resource=f"fixture-actor:{role}",
            )
        request = urllib.request.Request(
            f"{station_url.rstrip('/')}/actor/login",
            data=json.dumps(
                {
                    "email": account,
                    "password": password,
                    "device_type": "desktop",
                }
            ).encode("utf-8"),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        token = ""
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                envelope = json.loads(response.read().decode("utf-8"))
            data = (
                envelope.get("data")
                if isinstance(envelope, dict)
                and isinstance(envelope.get("data"), dict)
                else {}
            )
            actor_ref = (
                data.get("actor_ref")
                if isinstance(data.get("actor_ref"), dict)
                else {}
            )
            tokens = (
                data.get("tokens")
                if isinstance(data.get("tokens"), dict)
                else {}
            )
            ptid = str(actor_ref.get("ptid") or "")
            token = str(tokens.get("access_token") or "")
            if not ptid.startswith("ptid:") or not token:
                raise BlockedError(
                    reason=(
                        f"Station login did not resolve canonical actor {role}"
                    ),
                    resource=f"fixture-actor:{role}",
                )
            return ActorIdentity(
                role=role,
                account_ref=f"station-account:{account}",
                ptid=ptid,
                device_policy="existing",
            )
        except (
            urllib.error.URLError,
            OSError,
            TimeoutError,
            json.JSONDecodeError,
        ) as error:
            raise BlockedError(
                reason=f"Cannot resolve existing actor {role}: {error}",
                resource=f"fixture-actor:{role}",
            ) from error
        finally:
            if token:
                logout = urllib.request.Request(
                    f"{station_url.rstrip('/')}/actor/logout",
                    data=b"{}",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                    method="POST",
                )
                try:
                    urllib.request.urlopen(logout, timeout=15).close()
                except (urllib.error.URLError, OSError, TimeoutError) as error:
                    raise BlockedError(
                        reason=(
                            f"Existing actor {role} discovery session could "
                            f"not be released: {error}"
                        ),
                        resource=f"fixture-session:{role}",
                    ) from error

    @staticmethod
    def _port_available(port: int) -> bool:
        return (
            subprocess.run(
                ("lsof", f"-tiTCP:{port}", "-sTCP:LISTEN"),
                capture_output=True,
                text=True,
                check=False,
            ).returncode
            != 0
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
        seed_roots = self._storage_seeds(profile_name)

        run_root = Path(f"/tmp/pt-chat-native-current-{run_id}")
        run_root.mkdir(parents=True, exist_ok=False)
        self.register_cleanup(
            f"client-storage:{run_root}",
            lambda: shutil.rmtree(run_root, ignore_errors=True),
        )
        configured_gateway = int(profile_env["PT_DESKTOP_APP_GATEWAY_PORT"])
        configured_renderer = int(profile_env["PT_DESKTOP_APP_WEB_PORT"])
        configured_webdriver = 4445 + slot * 10
        allocation = next(
            (
                (
                    configured_gateway + offset,
                    configured_renderer + offset,
                    configured_webdriver + offset,
                )
                for offset in range(0, 1_000, 10)
                if all(
                    self._port_available(port)
                    for port in (
                        configured_gateway + offset,
                        configured_gateway + offset + 1,
                        configured_renderer + offset,
                        configured_renderer + offset + 1,
                        configured_webdriver + offset,
                        configured_webdriver + offset + 1,
                    )
                )
            ),
            None,
        )
        if allocation is None:
            raise BlockedError(
                reason="No complete two-client Native port set is available",
                resource="client-isolation:ports",
            )
        gateway_base, renderer_base, webdriver_base = allocation
        desktop_profile = f"{profile_name}-app"
        clients: list[ClientRuntime] = []
        for index, (role, seed_root) in enumerate(
            zip(CLIENT_ROLES, seed_roots)
        ):
            storage_root = run_root / role / "storage"
            shutil.copytree(seed_root, storage_root)
            client = ClientRuntime(
                actor=declared[role].actor,
                runtime="native-tauri",
                worktree=str(REPO_ROOT),
                gateway_port=gateway_base + index,
                renderer_port=renderer_base + index,
                webdriver_port=webdriver_base + index,
                profile=desktop_profile,
                storage_root=str(storage_root),
                id=role,
                required_service_roles=declared[role].required_service_roles,
                service_bindings=declared[role].service_bindings,
            )
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

            credential_refs, credential_values = self.prepare_credentials()
            password = credential_values.get("chat-password", "")
            actors = tuple(
                self._resolve_existing_actor(station_url, role, password)
                for role in CLIENT_ROLES
            )
            _, _, actor_ref = persist_actor_manifest(
                ActorManifest(
                    fixture_id="chat-native-actors",
                    environment_id=self.environment_id,
                    run_id=manifest.run_id,
                    created_at=utc_now(),
                    actors=actors,
                    credential_refs=credential_refs,
                    reset_authorized=False,
                    target_verified=True,
                    initial_state="existing",
                )
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
