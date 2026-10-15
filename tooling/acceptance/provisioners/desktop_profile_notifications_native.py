"""Prepare one non-reset Native Desktop Suite against the active remote Profile."""

from __future__ import annotations

import dataclasses
import os
import socket
import sys
from contextlib import contextmanager
from typing import Iterator

from tooling.acceptance.core import EphemeralGateLaunchContext
from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.attestation import commits_match, produce_station_attestation, source_proto_digest
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import ClientRuntime, EnvironmentContract, ProvisioningState, RuntimeManifest
from tooling.acceptance.drivers.native import resolve_native_desktop_runtime
from tooling.acceptance.fixtures.desktop_profile_accounts import (
    PROFILE_ACCOUNT_PASSWORD,
    prepare_profile_accounts,
    profile_account_storage,
)
from tooling.acceptance.fixtures.desktop_profile_contract import CAPABILITY_ID, GATE_ID
from tooling.acceptance.provisioners.remote_source_identity import resolve_remote_source_identity

from .desktop_profile_notifications_suite import (
    DesktopProfileNotificationsHandler,
    DesktopProfileNotificationsSuite,
)


class DesktopProfileNotificationsNativeProvisioner(EnvironmentProvisioner):
    environment_id = "desktop-profile-notifications-native"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)
        self._suite: DesktopProfileNotificationsSuite | None = None
        self._accounts: dict[str, str] = {}

    def prepare_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        return self._remember_resolved_credentials(
            (), {"desktop-profile-password": PROFILE_ACCOUNT_PASSWORD},
        )

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id != GATE_ID or sys.platform != "darwin":
                raise BlockedError(
                    reason="Profile and notification Suite requires its macOS Gate",
                    resource=f"gate-environment:{gate_id}",
                )
            profile, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(self._manifest, profile_name=profile, slot=slot)
            if manifest.workspace_digest != "clean":
                raise BlockedError(reason="Native Suite requires clean source", resource="source-identity:cleanliness")
            station_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
            deployment = profile_env.get("PT_STATION_DEPLOY_ENV", "")
            if profile_env.get("PT_STATION_MODE") != "remote" or not station_url or not deployment:
                raise BlockedError(reason="Native Suite requires a remote Station Profile", resource="profile:station-binding")
            if not self._station_ready(station_url, profile_env.get("PT_STATION_HEALTH_URL", "")):
                raise BlockedError(reason="Profile Station is unavailable", resource=f"station:{station_url}")
            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(deployment, owner)
            self.acquire_remote_git_source_lease(deployment, owner)
            attestation = produce_station_attestation(
                environment_id=self.environment_id, run_id=manifest.run_id,
                service_id="station", station_url=station_url, profile_env=profile_env,
                require_runtime_identity=True,
                remote_source_identity_provider=resolve_remote_source_identity,
            )
            if not commits_match(attestation.live_commit, manifest.source_commit):
                raise BlockedError(reason="Station and Desktop source commits differ", resource="source-identity:commit")
            if attestation.protocol_digest != source_proto_digest(REPO_ROOT):
                raise BlockedError(reason="Station and Desktop protocols differ", resource="source-identity:proto")
            contracts = {client.id: client for client in self.contract.clients}
            if set(contracts) != {"receiver", "sender"}:
                raise BlockedError(reason="Suite requires receiver and sender clients", resource="native-suite:clients")
            clients = []
            for role, contract in contracts.items():
                with socket.socket() as probe:
                    probe.bind(("127.0.0.1", 0))
                    port = int(probe.getsockname()[1])
                clients.append(ClientRuntime(
                    id=role, actor=contract.actor, runtime="native-tauri", worktree=str(REPO_ROOT),
                    renderer_port=port, webdriver_port=port, profile=f"{profile}-{role}",
                    storage_root=str(profile_account_storage(self.evidence_run.store.workspace_id, role)),
                    storage_lifecycle="persistent",
                    required_service_roles=contract.required_service_roles,
                    service_bindings=contract.service_bindings,
                ))
            self.register_cleanup("native-profile-notifications-suite", self._close_suite)
            manifest = self._ready(dataclasses.replace(
                manifest, state=ProvisioningState.PROVISIONED,
                services={"station": attestation}, clients=tuple(clients),
                cleanup_resources=self.contract.cleanup.resources,
            ))
            self._accounts = prepare_profile_accounts(
                station_url, self.evidence_run.store.workspace_id,
            )
            self._suite = DesktopProfileNotificationsSuite(
                manifest.to_dict(),
                resolve_native_desktop_runtime(
                    "desktop-macos-native", gate_id=gate_id, source_commit=manifest.source_commit,
                ),
                self.evidence_run,
            )
            return manifest
        except (BlockedError, KeyError, OSError, ValueError) as error:
            blocked = error if isinstance(error, BlockedError) else BlockedError(
                reason=f"Native Suite provisioning failed: {error}", resource=self.environment_id,
            )
            return self._blocked(self._manifest, reason=blocked.reason, resource=blocked.resource)

    @contextmanager
    def _evidence_environment(self) -> Iterator[None]:
        """Bind legacy native proof writers to this explicit parent evidence run."""
        environment = self.evidence_run.subprocess_environment()
        keys = (
            "PT_ACCEPTANCE_ARTIFACT_ROOT", "PT_ACCEPTANCE_WORKSPACE_ID",
            "PT_ACCEPTANCE_GATE_ID", "PT_ACCEPTANCE_RUN_ID", "PT_ACCEPTANCE_REDACTION_VALUES",
        )
        previous = {key: os.environ.get(key) for key in keys}
        try:
            os.environ.update({key: environment[key] for key in keys})
            yield
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def create_gate_launch_context(
        self,
        *,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
        required_capabilities: tuple[str, ...],
    ) -> EphemeralGateLaunchContext:
        if (
            gate_id != GATE_ID or required_capabilities != (CAPABILITY_ID,)
            or self._manifest is None or not self._manifest.is_ready() or self._suite is None
            or evidence_run_id != self.evidence_run.run_id
            or provisioning_run_id != self._manifest.run_id or evidence_run_id == provisioning_run_id
        ):
            raise BlockedError(reason="Native Suite launch authorities are incomplete", resource=CAPABILITY_ID)
        # The framework has leased the required runtime cell before this callback.
        with self._evidence_environment():
            actors = self._suite.prepare(self._accounts)
        self._suite.actor_manifest_ref = self.evidence_run.write_json(
            "runtime/actors.json", actors, role="desktop-profile-notification-actors",
        ).to_dict()
        context = EphemeralGateLaunchContext(
            required_capabilities=required_capabilities,
            request_timeout_seconds=1800, quiesce_timeout_seconds=180,
        )
        context.register_capability(CAPABILITY_ID, DesktopProfileNotificationsHandler(self._suite))
        return context

    def _close_suite(self) -> None:
        if self._suite is not None:
            self._suite.close()
