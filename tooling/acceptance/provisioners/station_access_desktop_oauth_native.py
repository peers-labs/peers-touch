from __future__ import annotations

import dataclasses
import hashlib
import hmac
import re
import shutil
import socket
import tempfile
import threading
import time
from collections.abc import Mapping
from pathlib import Path

from tooling.acceptance.core import (
    EphemeralCapabilityHandler,
    EphemeralGateLaunchContext,
    EphemeralHandlerCleanup,
)
from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.attestation import (
    commits_match,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import (
    BlockedError,
    EphemeralCapabilityBlocked,
    ProvisioningError,
)
from tooling.acceptance.core.provisioner import (
    EnvironmentProvisioner,
    load_env_file,
    resolve_deployment_environment_path,
)
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
)
from tooling.acceptance.transports.ssh import SshTarget, SshTransport


GATE_ID = "station-access-desktop-oauth-native-e2e"
CLIENT_ID = "oauth-login"
SIGNER_CAPABILITY_ID = "station-access.oauth-bridge-signer"
SIGN_OPERATION = "sign"
SECRET_CREDENTIAL_ID = "oauth-bridge-secret"
_SAFE_REMOTE_PATH = re.compile(r"^[A-Za-z0-9._/-]+$")


def oauth_bridge_signature_message(
    provider: str,
    provider_user_id: str,
    email: str,
    timestamp: str,
) -> str:
    return f"{provider}:{provider_user_id}:{email}:{timestamp}"


def _station_restart_script(
    deploy_path: str,
    restart_command: str,
    *,
    enable_bridge_secret: bool,
) -> str:
    if (
        not deploy_path
        or deploy_path.startswith("/")
        or ".." in Path(deploy_path).parts
        or not _SAFE_REMOTE_PATH.fullmatch(deploy_path)
        or "\n" in restart_command
        or "\0" in restart_command
    ):
        raise ValueError("Desktop OAuth Station restart contract is invalid")
    prefix = f'set -eu\ncd "$HOME/{deploy_path}"\n'
    if not enable_bridge_secret:
        return prefix + f"unset PEERS_OAUTH_BRIDGE_SECRET\n{restart_command}\n"
    marker = " up -d station"
    if restart_command.count(marker) != 1 or not restart_command.endswith(marker):
        raise ValueError(
            "Desktop OAuth Station restart must end with 'up -d station'"
        )
    command_with_override = restart_command[: -len(marker)] + " -f - up -d station"
    return (
        prefix
        + 'IFS= read -r PEERS_OAUTH_BRIDGE_SECRET\n'
        + 'test -n "$PEERS_OAUTH_BRIDGE_SECRET"\n'
        + "export PEERS_OAUTH_BRIDGE_SECRET\n"
        + "cat <<'PT_OAUTH_BRIDGE_OVERRIDE' | "
        + command_with_override
        + "\nservices:\n"
        + "  station:\n"
        + "    environment:\n"
        + "      PEERS_OAUTH_BRIDGE_SECRET: ${PEERS_OAUTH_BRIDGE_SECRET:?}\n"
        + "PT_OAUTH_BRIDGE_OVERRIDE\n"
    )


class OAuthBridgeSignerCapabilityHandler(EphemeralCapabilityHandler):
    def __init__(self, secret: str) -> None:
        if not secret:
            raise ValueError("OAuth bridge signer secret is required")
        self._secret = bytearray(secret.encode("utf-8"))
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return (SIGN_OPERATION,)

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        if self._closed:
            return ()
        return (self._secret.decode("utf-8"),)

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        if (
            self._closed
            or operation != SIGN_OPERATION
            or cancellation.is_set()
            or time.monotonic() >= deadline_monotonic
        ):
            raise EphemeralCapabilityBlocked(
                "Desktop OAuth bridge signer is unavailable",
                resource=SIGNER_CAPABILITY_ID,
            )
        fields = {
            name: payload.get(name)
            for name in ("provider", "providerUserId", "email", "timestamp")
        }
        if any(not isinstance(value, str) or not value for value in fields.values()):
            raise EphemeralCapabilityBlocked(
                "Desktop OAuth bridge signing fields are incomplete",
                resource=SIGNER_CAPABILITY_ID,
            )
        message = oauth_bridge_signature_message(
            str(fields["provider"]),
            str(fields["providerUserId"]),
            str(fields["email"]),
            str(fields["timestamp"]),
        )
        signature = hmac.new(
            bytes(self._secret),
            message.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return {"algorithm": "HMAC-SHA256", "signature": signature}

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        del operation
        return dict(response)

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason, deadline_monotonic
        self._zeroize()
        return True

    def close(self) -> EphemeralHandlerCleanup:
        self._zeroize()
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)

    def _zeroize(self) -> None:
        for index in range(len(self._secret)):
            self._secret[index] = 0
        self._secret.clear()
        self._closed = True


def _available_ports(count: int) -> tuple[int, ...]:
    listeners = [socket.socket() for _ in range(count)]
    try:
        for listener in listeners:
            listener.bind(("127.0.0.1", 0))
        return tuple(int(listener.getsockname()[1]) for listener in listeners)
    finally:
        for listener in listeners:
            listener.close()


class StationAccessDesktopOAuthNativeProvisioner(EnvironmentProvisioner):
    environment_id = "station-access-desktop-oauth-native"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)
        self._bridge_secret = ""

    def create_gate_launch_context(
        self,
        *,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
        required_capabilities: tuple[str, ...],
    ) -> EphemeralGateLaunchContext:
        if (
            gate_id != GATE_ID
            or required_capabilities != (SIGNER_CAPABILITY_ID,)
        ):
            raise BlockedError(
                reason="Desktop OAuth bridge signer contract is incomplete",
                resource=f"ephemeral-capabilities:{gate_id}",
            )
        if (
            self._manifest is None
            or not self._manifest.is_ready()
            or evidence_run_id == provisioning_run_id
            or evidence_run_id != self.evidence_run.run_id
            or provisioning_run_id != self._manifest.run_id
            or not self._bridge_secret
        ):
            raise BlockedError(
                reason="Desktop OAuth bridge signer authorities are not ready",
                resource=f"ephemeral-capabilities:{gate_id}:run-identities",
            )
        context = EphemeralGateLaunchContext(
            required_capabilities=required_capabilities
        )
        context.register_capability(
            SIGNER_CAPABILITY_ID,
            OAuthBridgeSignerCapabilityHandler(self._bridge_secret),
        )
        return context

    def _restart_remote_station(
        self,
        deployment_environment: str,
        secret: str | None,
    ) -> None:
        deploy_values = load_env_file(
            resolve_deployment_environment_path(deployment_environment)
        )
        if deploy_values.get("PT_DEPLOY_ROLE", "").strip() != "station":
            raise BlockedError(
                reason="Desktop OAuth deployment target is not a Station",
                resource=f"deployment-environment:{deployment_environment}",
            )
        try:
            transport = SshTransport(
                SshTarget(
                    host=deploy_values.get("PT_DEPLOY_HOST", ""),
                    user=deploy_values.get("PT_DEPLOY_USER", ""),
                    port=int(deploy_values.get("PT_DEPLOY_SSH_PORT", "22")),
                    known_hosts_file=deploy_values.get(
                        "PT_DEPLOY_KNOWN_HOSTS_FILE",
                        "",
                    ),
                )
            )
            script = _station_restart_script(
                deploy_values.get("PT_DEPLOY_PATH", ""),
                deploy_values.get("PT_DEPLOY_RESTART_CMD", ""),
                enable_bridge_secret=secret is not None,
            )
            completed = transport.run_argv(
                ("/bin/bash", "-c", script),
                timeout=300,
                input_text=f"{secret}\n" if secret is not None else None,
            )
        except (OSError, ProvisioningError, ValueError) as error:
            raise BlockedError(
                reason=f"Desktop OAuth Station secret activation failed: {error}",
                resource=f"station:{deployment_environment}",
            ) from error
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise BlockedError(
                reason=(
                    "Desktop OAuth Station secret activation failed"
                    + (f": {detail[-1000:]}" if detail else "")
                ),
                resource=f"station:{deployment_environment}",
            )

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id != GATE_ID:
                raise BlockedError(
                    reason=f"unsupported Desktop OAuth Gate: {gate_id}",
                    resource=f"gate-environment:{gate_id}",
                )
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            if manifest.workspace_digest != "clean":
                raise BlockedError(
                    reason="Desktop OAuth native proof requires a clean worktree",
                    resource="source-identity:worktree-cleanliness",
                )

            station_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
            health_url = profile_env.get("PT_STATION_HEALTH_URL", "").strip()
            deployment_environment = profile_env.get(
                "PT_STATION_DEPLOY_ENV",
                "",
            ).strip()
            if not station_url or not deployment_environment:
                raise BlockedError(
                    reason="Active profile is missing its Station deployment binding",
                    resource="profile:station-binding",
                )
            if profile_env.get("PT_STATION_MODE", "") != "remote":
                raise BlockedError(
                    reason="Desktop OAuth proof requires an isolated remote Station",
                    resource="profile:remote-station",
                )
            if not self._station_ready(station_url, health_url):
                raise BlockedError(
                    reason=f"Profile Station is not ready at {station_url}",
                    resource=f"station:{station_url}",
                )

            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(deployment_environment, owner)
            if profile_env.get("PT_STATION_MODE", "local") == "remote":
                self.acquire_remote_git_source_lease(
                    deployment_environment,
                    owner,
                )
            credential_refs, credential_values = self.prepare_credentials()
            bridge_secret = credential_values.get(SECRET_CREDENTIAL_ID, "")
            if len(credential_refs) != 1 or not bridge_secret:
                raise BlockedError(
                    reason="Desktop OAuth bridge secret fixture is unavailable",
                    resource=f"credential:{SECRET_CREDENTIAL_ID}",
                )
            self._bridge_secret = bridge_secret
            self.register_cleanup(
                f"oauth-bridge-secret:{deployment_environment}",
                lambda: self._restart_remote_station(
                    deployment_environment,
                    None,
                ),
            )
            self._restart_remote_station(
                deployment_environment,
                bridge_secret,
            )
            deadline = time.monotonic() + 120
            while not self._station_ready(station_url, health_url):
                if time.monotonic() >= deadline:
                    raise BlockedError(
                        reason="Station did not recover with the OAuth bridge secret",
                        resource=f"station:{station_url}",
                    )
                time.sleep(1)
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

            declared = {client.id: client for client in self.contract.clients}
            if set(declared) != {CLIENT_ID}:
                raise BlockedError(
                    reason="Desktop OAuth environment must declare one login client",
                    resource=f"gate-environment:{gate_id}",
                )
            runtime_root = Path(
                tempfile.mkdtemp(prefix=f"pt-desktop-oauth-{manifest.run_id}-")
            )
            self.register_cleanup(
                f"client-storage:{runtime_root}",
                lambda: shutil.rmtree(runtime_root, ignore_errors=True),
            )
            client_contract = declared[CLIENT_ID]
            gateway_port, renderer_port, webdriver_port = _available_ports(3)
            client = ClientRuntime(
                id=CLIENT_ID,
                actor=client_contract.actor,
                runtime="native-tauri",
                worktree=str(REPO_ROOT),
                gateway_port=gateway_port,
                renderer_port=renderer_port,
                webdriver_port=webdriver_port,
                profile=f"{profile_name}-oauth-login",
                storage_root=str(runtime_root / "storage"),
                required_service_roles=client_contract.required_service_roles,
                service_bindings=client_contract.service_bindings,
            )
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services={attestation.service_id: attestation},
                credential_refs=credential_refs,
                clients=(client,),
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (BlockedError, KeyError, OSError, ValueError) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Desktop OAuth provisioning failed: {error}",
                    resource="station-access-desktop-oauth-native",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
