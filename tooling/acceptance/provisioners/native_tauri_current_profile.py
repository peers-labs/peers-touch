from __future__ import annotations

import dataclasses
import hashlib
import re
import secrets
import shutil
import socket
import tempfile
import threading
import time
from collections.abc import Mapping
from pathlib import Path

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.attestation import (
    commits_match,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import (
    BlockedError, EphemeralCapabilityBlocked, EphemeralLaunchCleanupFailed,
)
from tooling.acceptance.core.launch_context import (
    EphemeralCapabilityHandler,
    EphemeralGateLaunchContext,
    EphemeralHandlerCleanup,
)
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ActorIdentity,
    ActorManifest,
    ClientRuntime,
    ProvisioningState,
    RuntimeManifest,
    utc_now,
)
from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic
from tooling.acceptance.core.redaction import redact_text_with_values
from tooling.acceptance.fixtures.chat_native_actors import (
    fixture_avatar,
    persist_actor_manifest,
)
from tooling.acceptance.fixtures.chat_native_reset import (
    read_fixture_actors,
    seed_bound_contacts,
    seed_run_actor_avatars,
)
from tooling.acceptance.provisioners.preset_actor import resolve_existing_preset_actor
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
)
from tooling.acceptance.provisioners.station_equipment import equip_station_profile


GATE_ID = "chat-native-current-profile-two-client-e2e"
SUBMITTED_COMMAND_RECOVERY_GATE_ID = "chat-native-submitted-command-recovery-e2e"
SUPPORTED_GATE_IDS = frozenset({GATE_ID, SUBMITTED_COMMAND_RECOVERY_GATE_ID})
CLIENT_ROLES = ("alice", "bob")
LOGIN_CAPABILITY_ID = "chat.runtime-account-login"


class RuntimeAccountLoginHandler(EphemeralCapabilityHandler):
    """Keep signup credentials in the parent and authenticate a bound WebView."""

    def __init__(self, password: str, clients: tuple[ClientRuntime, ...],
                 accounts: dict[str, str], station_url: str) -> None:
        self._password = bytearray(password.encode())
        self._clients = {client.actor: client for client in clients}
        self._accounts = dict(accounts)
        self._station_url = station_url

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return ("authenticate",)

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return (self._password.decode(),) if self._password else ()

    def invoke(self, operation: str, payload: Mapping[str, object], *,
               deadline_monotonic: float,
               cancellation: threading.Event) -> Mapping[str, object]:
        role, session_id = payload.get("role"), payload.get("sessionId")
        if (
            operation != "authenticate" or set(payload) != {"role", "sessionId"}
            or not isinstance(role, str) or role not in self._clients
            or not isinstance(session_id, str)
            or re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", session_id) is None
            or not self._password or cancellation.is_set()
            or time.monotonic() >= deadline_monotonic
        ):
            raise EphemeralCapabilityBlocked(
                "Run-account login requires a live bound client",
                resource=LOGIN_CAPABILITY_ID,
            )
        from tooling.acceptance.core.harness import call_async_harness
        from tooling.acceptance.drivers.tauri import TauriDriver

        client = self._clients[str(role)]
        driver = TauriDriver(port=client.webdriver_port)
        try:
            driver.borrow_session(session_id)
            timeout = min(30, deadline_monotonic - time.monotonic())
            binding = call_async_harness(
                driver, "bindingState", {}, namespace="stationAccess",
                script_timeout=timeout,
            )
            if (
                driver.driver.current_url != "tauri://localhost"
                or not isinstance(binding, dict)
                or str(binding.get("activeUrl") or "").rstrip("/") != self._station_url
                or cancellation.is_set()
            ):
                raise EphemeralCapabilityBlocked(
                    "Run-account login Station binding differs from its Profile",
                    resource=LOGIN_CAPABILITY_ID,
                )
            result = call_async_harness(
                driver, "loginWithPassword",
                {"account": self._accounts[str(role)], "password": self._password.decode()},
                namespace="chat",
                script_timeout=min(30, deadline_monotonic - time.monotonic()),
            )
            return {"authenticated": isinstance(result, dict) and result.get("authenticated") is True}
        finally:
            driver.stop()

    def project_response(self, operation: str,
                         response: Mapping[str, object]) -> Mapping[str, object]:
        del operation
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason, deadline_monotonic
        self.close()
        return True

    def close(self) -> EphemeralHandlerCleanup:
        self._password[:] = b"\0" * len(self._password)
        self._password.clear()
        self._accounts.clear()
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)


class NativeTauriCurrentProfileProvisioner(EnvironmentProvisioner):
    """Own run-local accounts and clients on the selected reviewed Station.

    Account creation uses the existing production registrar. Existing Station
    actors are never reset or imported. Native device/session state is created
    by authentication, survives restart, and is removed at run cleanup.
    """

    environment_id = "native-tauri-current-profile"

    def _resolve_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        return self._remember_resolved_credentials(
            ("auto:chat-current-profile-run-password",),
            {"chat-password": "GateAa1!" + secrets.token_hex(5)},
        )

    def create_gate_launch_context(
        self, *, gate_id: str, evidence_run_id: str, provisioning_run_id: str,
        required_capabilities: tuple[str, ...],
    ) -> EphemeralGateLaunchContext:
        if (
            gate_id not in SUPPORTED_GATE_IDS
            or required_capabilities != (LOGIN_CAPABILITY_ID,)
            or self._manifest is None or not self._manifest.is_ready()
            or evidence_run_id != self.evidence_run.run_id
            or provisioning_run_id != self._manifest.run_id
            or evidence_run_id == provisioning_run_id
        ):
            raise BlockedError(
                reason="Run-account login requires the current ready runtime and evidence run",
                resource=f"ephemeral-capabilities:{gate_id}",
            )
        _, credentials = self.prepare_credentials()
        context = EphemeralGateLaunchContext(required_capabilities=required_capabilities)
        context.register_capability(
            LOGIN_CAPABILITY_ID,
            RuntimeAccountLoginHandler(
                credentials["chat-password"], self._manifest.clients,
                self._runtime_accounts, self._manifest.services["station"].endpoint,
            ),
        )
        return context

    @staticmethod
    def _port_available(port: int) -> bool:
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                return False
        return True

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
        if set(declared) != set(CLIENT_ROLES) or {
            actor.role for actor in actors
        } != set(CLIENT_ROLES):
            raise BlockedError(
                reason="Current-profile Native environment requires Alice and Bob",
                resource=f"gate-environment:{self.environment_id}",
            )
        bases = (
            int(profile_env["PT_DESKTOP_APP_GATEWAY_PORT"]),
            int(profile_env["PT_DESKTOP_APP_WEB_PORT"]),
            4445 + slot * 10,
        )
        allocation = next(
            (
                ports for offset in range(0, 1000, 10)
                if len(set(
                    ports := tuple(
                        base + offset + index
                        for base in bases for index in range(len(CLIENT_ROLES))
                    )
                )) == 6 and all(self._port_available(port) for port in ports)
            ),
            None,
        )
        if allocation is None:
            raise BlockedError(
                reason="No isolated two-client Native port set is available",
                resource="client-isolation:ports",
            )
        run_root = Path(tempfile.mkdtemp(prefix=f"pt-native-profile-{run_id}-"))

        def release_storage() -> None:
            if run_root.exists():
                shutil.rmtree(run_root)

        self.register_cleanup(f"client-storage:{run_root}", release_storage)
        clients = []
        for index, role in enumerate(CLIENT_ROLES):
            storage = run_root / role / "storage"
            storage.mkdir(mode=0o700, parents=True)
            clients.append(ClientRuntime(
                id=role,
                actor=declared[role].actor,
                runtime="native-tauri",
                worktree=str(REPO_ROOT.resolve()),
                gateway_port=allocation[index],
                renderer_port=allocation[2 + index],
                webdriver_port=allocation[4 + index],
                profile=f"{profile_name}-acceptance-{role}",
                storage_root=str(storage),
                storage_lifecycle="ephemeral",
                required_service_roles=declared[role].required_service_roles,
                service_bindings=declared[role].service_bindings,
            ))
        return tuple(clients)

    @staticmethod
    def _prepare_actors(
        station_url: str,
        deployment_environment: str,
        run_id: str,
        password: str,
    ) -> tuple[ActorIdentity, ...]:
        # One production account registrar owns signup semantics across Native
        # Suites. Import at the operation boundary to avoid registry cycles.
        from tooling.development.secure_content.runtime_owner import (
            _register_runtime_account,
        )

        suffix = hashlib.sha256(run_id.encode()).hexdigest()[:10]
        accounts = {
            role: _register_runtime_account(
                station_url, role=role, suffix=suffix, password=password,
            )
            for role in CLIENT_ROLES
        }
        actors = tuple(
            resolve_existing_preset_actor(
                station_url=station_url, role=role, account=accounts[role],
                password=password, device_policy="run-scoped-acceptance",
            )
            for role in CLIENT_ROLES
        )
        seed_run_actor_avatars(
            station_url, deployment_environment,
            {accounts[actor.role]: (actor.ptid, fixture_avatar(actor.role)) for actor in actors},
        )
        records = read_fixture_actors(
            station_url, deployment_environment, tuple(accounts.values()),
        )
        if any(records[accounts[actor.role]].ptid != actor.ptid for actor in actors):
            raise BlockedError(
                reason="Run-created account identity drifted before contact preparation",
                resource="fixture-actor:current-profile",
            )
        alice, bob = (records[accounts[role]] for role in CLIENT_ROLES)
        seed_bound_contacts(
            station_url, deployment_environment,
            ((alice, bob), (bob, alice)), (alice, bob),
        )
        return actors

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id not in SUPPORTED_GATE_IDS:
                raise BlockedError(
                    reason=f"Unsupported current-profile Native Gate: {gate_id}",
                    resource=f"gate-environment:{gate_id}",
                )
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest, profile_name=profile_name, slot=slot,
            )
            station_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
            deployment = profile_env.get("PT_STATION_DEPLOY_ENV", "").strip()
            if profile_env.get("PT_STATION_MODE") != "remote" or not station_url or not deployment:
                raise BlockedError(
                    reason="Current-profile Native Gate requires a reviewed remote Station",
                    resource="profile:remote-station",
                )
            equip_station_profile(profile_name, manifest.source_commit, repo_root=REPO_ROOT)
            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(deployment, owner)
            self.acquire_remote_git_source_lease(deployment, owner)
            health = self._station_health(
                station_url, profile_env.get("PT_STATION_HEALTH_URL", ""),
            )
            if not health["ready"]:
                resource = "service-health:station"
                raise BlockedError(
                    reason="Selected Profile Station is not ready",
                    resource=resource,
                    diagnostic=ResourceDiagnostic.observed(
                        owner="native-tauri-current-profile-provisioner",
                        recovery_action="Repair the recorded Local Dev equipment or post-lease health failure and repeat readback.",
                        resource=resource, expected={"ready": True}, observed=health,
                    ),
                )
            attestation = produce_station_attestation(
                environment_id=self.environment_id, run_id=manifest.run_id,
                service_id="station", station_url=station_url,
                profile_env=profile_env, require_runtime_identity=True,
                remote_source_identity_provider=resolve_remote_source_identity,
            )
            if not commits_match(attestation.live_commit, manifest.source_commit):
                raise BlockedError(
                    reason="Selected Station commit differs from current client source",
                    resource="source-identity:commit",
                    diagnostic=ResourceDiagnostic.observed(
                        owner="native-tauri-current-profile-provisioner",
                        recovery_action="Deploy the current reviewed Station source through its Profile and repeat readback.",
                        resource="source-identity:commit",
                        expected={"commit": manifest.source_commit},
                        observed={"commit": attestation.live_commit, "deployment": deployment},
                    ),
                )
            if attestation.protocol_digest != source_proto_digest(REPO_ROOT):
                raise BlockedError(
                    reason="Station and client protocol digests differ",
                    resource="source-identity:proto",
                )
            credential_refs, credentials = self.prepare_credentials()
            from tooling.development.secure_content.runtime_owner import RuntimeOwnerBlocked

            try:
                actors = self._prepare_actors(
                    station_url, deployment, manifest.run_id, credentials["chat-password"],
                )
            except RuntimeOwnerBlocked as error:
                raise BlockedError(
                    reason=str(error), resource=error.resource,
                    diagnostic=ResourceDiagnostic.observed(
                        owner="native-tauri-current-profile-provisioner",
                        recovery_action="Repair run-account signup through the production account registrar.",
                        resource=error.resource, expected={"signup": "accepted"},
                        observed={"code": error.code, "message": str(error)},
                    ),
                ) from error
            self._runtime_accounts = {
                actor.role: actor.account_ref.removeprefix("station-account:")
                for actor in actors
            }
            _, _, actor_ref = persist_actor_manifest(ActorManifest(
                fixture_id="chat-native-actors",
                environment_id=self.environment_id, run_id=manifest.run_id,
                created_at=utc_now(), actors=actors, credential_refs=credential_refs,
                reset_authorized=False, target_verified=True, initial_state="existing",
            ))
            clients = self._clients(
                run_id=manifest.run_id, profile_name=profile_name,
                profile_env=profile_env, slot=slot, actors=actors,
            )
            manifest = dataclasses.replace(
                manifest, state=ProvisioningState.PROVISIONED,
                services={attestation.service_id: attestation},
                actor_manifest_ref=actor_ref, credential_refs=credential_refs,
                clients=clients, cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except EphemeralLaunchCleanupFailed:
            raise
        except (BlockedError, KeyError, OSError, ValueError, RuntimeError) as error:
            if isinstance(error, BlockedError):
                blocked = error
            else:
                resource = "native-current-profile"
                detail = redact_text_with_values(str(error), self.resolved_credential_values)
                blocked = BlockedError(
                    reason=f"Current-profile Native provisioning failed: {type(error).__name__}: {detail}",
                    resource=resource,
                    diagnostic=ResourceDiagnostic.observed(
                        owner="native-tauri-current-profile-provisioner",
                        recovery_action="Repair the recorded provisioning operation at its owner and repeat the current Profile.",
                        resource=resource, expected={"runtime": "FIXTURE_READY"},
                        observed={"errorType": type(error).__name__, "message": detail},
                    ),
                )
            return self._blocked(
                self._manifest, reason=blocked.reason, resource=blocked.resource,
                diagnostic=blocked.diagnostic,
            )
