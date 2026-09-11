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
CLIENT_WORKTREE_NAMES = {
    "alice": "peers-chat-high-chat",
    "bob": "peers-group-chat",
}
CLIENT_WORKTREES_ENV = "PT_CHAT_NATIVE_CLIENT_WORKTREES"
PERSISTENT_STORAGE_ROOTS_ENV = "PT_CHAT_NATIVE_PERSISTENT_STORAGE_ROOTS"
PERSISTENT_STORAGE_MARKER = ".pt-current-profile-state.json"


@dataclasses.dataclass(frozen=True)
class ClientWorktreeIdentity:
    root: Path
    logical_name: str
    common_dir: Path
    head: str
    tree: str
    clean: bool


class NativeTauriCurrentProfileProvisioner(EnvironmentProvisioner):
    """Provision two native clients against the active non-destructive profile."""

    environment_id = "native-tauri-current-profile"

    @staticmethod
    def _storage_seeds(
        profile_name: str,
        client_worktrees: dict[str, ClientWorktreeIdentity],
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
            seeds = tuple(
                client_worktrees[role].root
                / ".local"
                / "dev"
                / "data"
                / profile_name
                / "desktop-app"
                for role in CLIENT_ROLES
            )
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

    @staticmethod
    def _persistent_storage_roots(
        profile_name: str,
        client_worktrees: dict[str, ClientWorktreeIdentity],
    ) -> tuple[Path, ...]:
        raw_roots = os.environ.get(PERSISTENT_STORAGE_ROOTS_ENV, "")
        if raw_roots.strip():
            roots = tuple(
                Path(item.strip()).expanduser().resolve()
                for item in raw_roots.split(",")
                if item.strip()
            )
        else:
            roots = tuple(
                client_worktrees[role].root
                / ".local"
                / "acceptance"
                / "state"
                / "native-tauri-current-profile"
                / profile_name
                / role
                / "desktop-app"
                for role in CLIENT_ROLES
            )
        if len(roots) != len(CLIENT_ROLES) or len(set(roots)) != len(roots):
            raise BlockedError(
                reason=(
                    "Current-profile Native Gate requires one distinct "
                    f"persistent storage root per client ({len(CLIENT_ROLES)} "
                    "required)"
                ),
                resource="client-isolation:persistent-storage",
            )
        return roots

    @staticmethod
    def _assert_storage_tree_is_copyable(root: Path, role: str) -> None:
        if root.is_symlink() or any(path.is_symlink() for path in root.rglob("*")):
            raise BlockedError(
                reason=(
                    f"Current-profile {role} storage seed contains a symlink: "
                    f"{root}"
                ),
                resource=f"client-storage-seed:{role}",
            )
        active_sidecars = sorted(
            path
            for path in root.rglob("*")
            if path.is_file()
            and path.name.endswith(("-wal", "-shm", "-journal"))
        )
        if active_sidecars:
            raise BlockedError(
                reason=(
                    f"Current-profile {role} storage seed is not quiescent"
                ),
                resource=f"client-storage-seed:{role}",
            )

    @classmethod
    def _persistent_storage(
        cls,
        *,
        role: str,
        actor: ActorIdentity,
        profile_name: str,
        worktree: ClientWorktreeIdentity,
        seed_root: Path,
        storage_root: Path,
        run_id: str,
    ) -> Path:
        marker = storage_root / PERSISTENT_STORAGE_MARKER
        expected_marker = {
            "schemaVersion": 1,
            "environmentId": cls.environment_id,
            "role": role,
            "actorPtid": actor.ptid,
            "profile": f"{profile_name}-app",
            "sourceWorktree": str(worktree.root),
            "devicePolicy": "persistent-acceptance",
        }
        if storage_root.exists():
            if storage_root.is_symlink() or not storage_root.is_dir():
                raise BlockedError(
                    reason=(
                        f"Current-profile {role} persistent storage is unsafe"
                    ),
                    resource=f"client-persistent-storage:{role}",
                )
            try:
                actual_marker = json.loads(marker.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                raise BlockedError(
                    reason=(
                        f"Current-profile {role} persistent storage marker "
                        f"is unavailable: {error}"
                    ),
                    resource=f"client-persistent-storage:{role}",
                ) from error
            if actual_marker != expected_marker or not (
                storage_root / "peers-touch"
            ).is_dir():
                raise BlockedError(
                    reason=(
                        f"Current-profile {role} persistent storage identity "
                        "does not match the selected actor/worktree/profile"
                    ),
                    resource=f"client-persistent-storage:{role}",
                )
            return storage_root

        if (
            storage_root == seed_root
            or seed_root in storage_root.parents
            or storage_root in seed_root.parents
        ):
            raise BlockedError(
                reason=(
                    f"Current-profile {role} persistent storage must be "
                    "separate from its read-only source seed"
                ),
                resource=f"client-persistent-storage:{role}",
            )
        cls._assert_storage_tree_is_copyable(seed_root, role)
        storage_root.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = storage_root.with_name(
            f".{storage_root.name}.init-{run_id}"
        )
        if temporary.exists():
            raise BlockedError(
                reason=(
                    f"Current-profile {role} persistent storage initialization "
                    "is already pending"
                ),
                resource=f"client-persistent-storage:{role}",
            )
        try:
            shutil.copytree(seed_root, temporary, symlinks=False)
            desktop_profile = f"{profile_name}-app"
            database_root = (
                temporary
                / "peers-touch"
                / desktop_profile
                / "data"
                / "db"
                / "users"
            )
            if database_root.is_dir():
                for database in database_root.glob("*/chat.main.db*"):
                    if database.is_file():
                        database.unlink()
            session_root = (
                temporary
                / "peers-touch"
                / desktop_profile
                / "data"
                / "auth"
                / "sessions"
            )
            if session_root.is_dir():
                for device_id in session_root.glob("*/device_id"):
                    if device_id.is_file():
                        device_id.unlink()
            marker = temporary / PERSISTENT_STORAGE_MARKER
            marker.write_text(
                json.dumps(expected_marker, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            if os.name != "nt":
                storage_root.parent.chmod(0o700)
                temporary.chmod(0o700)
                marker.chmod(0o600)
            os.replace(temporary, storage_root)
        except Exception as error:
            shutil.rmtree(temporary, ignore_errors=True)
            if isinstance(error, BlockedError):
                raise
            raise BlockedError(
                reason=(
                    f"Current-profile {role} persistent storage "
                    f"initialization failed: {error}"
                ),
                resource=f"client-persistent-storage:{role}",
            ) from error
        return storage_root

    @staticmethod
    def _git_value(root: Path, *args: str) -> str:
        completed = subprocess.run(
            ("git", "-C", str(root), *args),
            capture_output=True,
            text=True,
            check=False,
        )
        value = completed.stdout.strip()
        if completed.returncode != 0 or not value:
            detail = completed.stderr.strip() or "git returned no value"
            raise BlockedError(
                reason=f"Cannot inspect Native client worktree {root}: {detail}",
                resource="client-isolation:worktrees",
            )
        return value

    @classmethod
    def _inspect_worktree(cls, root: Path) -> ClientWorktreeIdentity:
        if not (root / "Makefile").is_file():
            raise BlockedError(
                reason=f"Native client worktree has no Makefile: {root}",
                resource="client-isolation:worktrees",
            )
        canonical_root = Path(
            cls._git_value(root, "rev-parse", "--show-toplevel")
        ).resolve()
        if canonical_root != root:
            raise BlockedError(
                reason=(
                    "Native client worktree must be a canonical Git root: "
                    f"{root}"
                ),
                resource="client-isolation:worktrees",
            )
        common_dir = Path(
            cls._git_value(
                root,
                "rev-parse",
                "--path-format=absolute",
                "--git-common-dir",
            )
        ).resolve()
        status = subprocess.run(
            (
                "git",
                "-C",
                str(root),
                "status",
                "--porcelain",
                "--untracked-files=all",
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        if status.returncode != 0:
            raise BlockedError(
                reason=f"Cannot inspect Native client worktree status: {root}",
                resource="client-isolation:worktrees",
            )
        return ClientWorktreeIdentity(
            root=root,
            logical_name=root.name,
            common_dir=common_dir,
            head=cls._git_value(root, "rev-parse", "HEAD"),
            tree=cls._git_value(root, "rev-parse", "HEAD^{tree}"),
            clean=not status.stdout.strip(),
        )

    @staticmethod
    def _validate_client_worktrees(
        identities: dict[str, ClientWorktreeIdentity],
    ) -> None:
        if set(identities) != set(CLIENT_ROLES):
            raise BlockedError(
                reason=(
                    "Current-profile Native Gate requires one worktree "
                    "for Alice and one for Bob"
                ),
                resource="client-isolation:worktrees",
            )
        for role, expected_name in CLIENT_WORKTREE_NAMES.items():
            identity = identities[role]
            if identity.logical_name != expected_name:
                raise BlockedError(
                    reason=(
                        f"Current-profile actor {role} must run from "
                        f"{expected_name}, got {identity.logical_name}"
                    ),
                    resource=f"client-worktree:{role}",
                )
        roots = {identity.root for identity in identities.values()}
        if len(roots) != len(CLIENT_ROLES):
            raise BlockedError(
                reason=(
                    "Current-profile Native Gate requires two distinct "
                    "client worktrees"
                ),
                resource="client-isolation:worktrees",
            )
        if identities["bob"].root != REPO_ROOT.resolve():
            raise BlockedError(
                reason=(
                    "The current-profile Gate must run from peers-group-chat "
                    "so its existing Bob client initiates the journey"
                ),
                resource="client-worktree:initiator",
            )
        if len(
            {identity.common_dir for identity in identities.values()}
        ) != 1:
            raise BlockedError(
                reason="Native client worktrees do not belong to one repository",
                resource="client-isolation:worktrees",
            )
        dirty = sorted(
            role for role, identity in identities.items() if not identity.clean
        )
        if dirty:
            raise BlockedError(
                reason=(
                    "Current-profile Native client worktrees must be clean: "
                    f"{', '.join(dirty)}"
                ),
                resource="source-identity:worktree-cleanliness",
            )
        trees = {identity.tree for identity in identities.values()}
        if len(trees) != 1:
            raise BlockedError(
                reason=(
                    "peers-chat-high-chat is not synchronized to the "
                    "peers-group-chat source tree"
                ),
                resource="source-identity:worktree-tree",
            )

    @classmethod
    def _client_worktrees(cls) -> dict[str, ClientWorktreeIdentity]:
        raw = os.environ.get(CLIENT_WORKTREES_ENV, "").strip()
        roots: dict[str, Path]
        if raw:
            try:
                configured = json.loads(raw)
            except json.JSONDecodeError as error:
                raise BlockedError(
                    reason=(
                        f"{CLIENT_WORKTREES_ENV} must be a JSON object: {error}"
                    ),
                    resource="client-isolation:worktrees",
                ) from error
            if not isinstance(configured, dict):
                raise BlockedError(
                    reason=f"{CLIENT_WORKTREES_ENV} must be a JSON object",
                    resource="client-isolation:worktrees",
                )
            if set(configured) != set(CLIENT_ROLES) or any(
                not isinstance(path, str) or not path.strip()
                for path in configured.values()
            ):
                raise BlockedError(
                    reason=(
                        f"{CLIENT_WORKTREES_ENV} must map exactly Alice and "
                        "Bob to non-empty worktree paths"
                    ),
                    resource="client-isolation:worktrees",
                )
            roots = {
                str(role): Path(str(path)).expanduser().resolve()
                for role, path in configured.items()
            }
        else:
            completed = subprocess.run(
                ("git", "worktree", "list", "--porcelain"),
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            if completed.returncode != 0:
                raise BlockedError(
                    reason="Cannot discover linked Native client worktrees",
                    resource="client-isolation:worktrees",
                )
            discovered: dict[str, Path] = {}
            for line in completed.stdout.splitlines():
                if not line.startswith("worktree "):
                    continue
                candidate = Path(line.removeprefix("worktree ")).resolve()
                if candidate.name in CLIENT_WORKTREE_NAMES.values():
                    if (
                        candidate.name in discovered
                        and discovered[candidate.name] != candidate
                    ):
                        raise BlockedError(
                            reason=(
                                "Multiple linked worktrees use the required "
                                f"logical name {candidate.name}"
                            ),
                            resource="client-isolation:worktrees",
                        )
                    discovered[candidate.name] = candidate
            roots = {
                role: discovered[name]
                for role, name in CLIENT_WORKTREE_NAMES.items()
                if name in discovered
            }
        identities = {
            role: cls._inspect_worktree(root)
            for role, root in roots.items()
        }
        cls._validate_client_worktrees(identities)
        return identities

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
                device_policy="persistent-acceptance",
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
        actors: tuple[ActorIdentity, ...],
    ) -> tuple[ClientRuntime, ...]:
        declared = {client.id: client for client in self.contract.clients}
        if set(declared) != set(CLIENT_ROLES):
            raise BlockedError(
                reason="Current-profile Native environment must declare Alice and Bob",
                resource=f"gate-environment:{GATE_ID}",
            )
        client_worktrees = self._client_worktrees()
        seed_roots = self._storage_seeds(
            profile_name,
            client_worktrees,
        )
        persistent_roots = self._persistent_storage_roots(
            profile_name,
            client_worktrees,
        )
        actors_by_role = {actor.role: actor for actor in actors}
        if set(actors_by_role) != set(CLIENT_ROLES):
            raise BlockedError(
                reason="Current-profile Native actors are incomplete",
                resource=f"gate-environment:{GATE_ID}",
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
        for index, (role, seed_root, persistent_root) in enumerate(
            zip(CLIENT_ROLES, seed_roots, persistent_roots)
        ):
            storage_root = self._persistent_storage(
                role=role,
                actor=actors_by_role[role],
                profile_name=profile_name,
                worktree=client_worktrees[role],
                seed_root=seed_root,
                storage_root=persistent_root,
                run_id=run_id,
            )
            client = ClientRuntime(
                actor=declared[role].actor,
                runtime="native-tauri",
                worktree=str(client_worktrees[role].root),
                gateway_port=gateway_base + index,
                renderer_port=renderer_base + index,
                webdriver_port=webdriver_base + index,
                profile=desktop_profile,
                storage_root=str(storage_root),
                storage_lifecycle="persistent",
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
                actors=actors,
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
