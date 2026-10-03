from __future__ import annotations

import dataclasses
import json
import os
import subprocess
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from collections.abc import Callable
from pathlib import Path

from ._paths import REPO_ROOT
from .attestation import source_workspace_digest
from .errors import BlockedError, ProvisioningError
from .evidence_store import RunHandle, write_current_artifact
from .launch_context import EphemeralGateLaunchContext
from .lease import (
    ProfileLease,
    ProfileLeaseUnavailable,
    RemoteGitSourceLease,
    RemoteGitSourceLeaseUnavailable,
    normalize_lease_resource,
)
from .provisioning import (
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
    blocked_manifest,
    new_manifest,
)

PROFILE_ENV_OVERRIDES = (
    "PT_AGENT_PROVIDER_ID",
    "PT_AGENT_PROVIDER_API_KEY",
    "PT_AGENT_DEFAULT_MODEL_ID",
    "PT_AGENT_PROVIDER_BASE_URL",
)


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def resolve_machine_profile_environment(
    repo_root: Path | None = None,
    *,
    require_identity_match: bool = True,
) -> tuple[str, Path, int, dict[str, str]]:
    root = (repo_root or REPO_ROOT).resolve()
    configured_env_repo = os.environ.get("PT_ENV_REPO", "").strip()
    env_repo = (
        Path(configured_env_repo).expanduser().resolve()
        if configured_env_repo
        else root.parent / "env"
    )
    machine_dev = (
        root
        / "tooling"
        / "scripts"
        / "local-dev"
        / "machine-dev.mjs"
    )
    try:
        completed = subprocess.run(
            [
                "node",
                str(machine_dev),
                "check",
                "--workspace-root",
                str(root),
                "--env-repo",
                str(env_repo),
            ],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as error:
        raise BlockedError(
            reason=f"Machine Dev profile binding is unavailable: {error}",
            resource="profile:machine-control-plane",
        ) from error
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise BlockedError(
            reason=(
                "Machine Dev profile binding is unavailable: "
                f"{detail or 'machine-dev check returned no output'}"
            ),
            resource="profile:machine-control-plane",
        )
    try:
        resolved = json.loads(completed.stdout)
        binding = resolved["binding"]
        profile = resolved["profile"]
        ports = resolved["ports"]
        profile_name = binding["profile"]
        slot = binding["slot"]
        profile_file = Path(profile["profileFile"]).resolve(strict=True)
    except (
        json.JSONDecodeError,
        KeyError,
        OSError,
        RuntimeError,
        TypeError,
    ) as error:
        raise BlockedError(
            reason=f"Machine Dev profile binding is invalid: {error}",
            resource="profile:machine-control-plane",
        ) from error

    values = load_env_file(profile_file)
    for field in PROFILE_ENV_OVERRIDES:
        injected = os.environ.get(field, "")
        if injected:
            values[field] = injected
    if (
        not isinstance(profile_name, str)
        or not profile_name
        or not isinstance(slot, int)
        or isinstance(slot, bool)
        or slot < 0
    ):
        raise BlockedError(
            reason="Machine Dev profile binding has invalid identity or slot",
            resource="profile:machine-control-plane",
        )
    if (
        resolved.get("authority") != "machine-control-plane"
        or profile.get("sourceState") != "tracked-clean"
    ):
        raise BlockedError(
            reason="Machine Dev profile binding is not authoritative",
            resource="profile:machine-control-plane",
        )
    declared_profile = values.get("PT_DEV_PROFILE", "")
    if require_identity_match and declared_profile != profile_name:
        raise BlockedError(
            reason=(
                f"Profile identity mismatch: PT_DEV_PROFILE={declared_profile} "
                f"but machine binding is {profile_name}"
            ),
            resource=f"profile:identity:{profile_name}",
        )
    port_fields = {
        "desktopAppGateway": "PT_DESKTOP_APP_GATEWAY_PORT",
        "desktopAppWeb": "PT_DESKTOP_APP_WEB_PORT",
        "desktopWebGateway": "PT_DESKTOP_WEB_GATEWAY_PORT",
        "desktopWebWeb": "PT_DESKTOP_WEB_WEB_PORT",
        "mobileWeb": "PT_MOBILE_WEB_PORT",
    }
    values["PT_DEV_SLOT"] = str(slot)
    for machine_field, environment_field in port_fields.items():
        port = ports.get(machine_field)
        if not isinstance(port, int) or isinstance(port, bool) or port <= 0:
            raise BlockedError(
                reason=(
                    "Machine Dev profile binding has an invalid "
                    f"{machine_field} port"
                ),
                resource="profile:machine-control-plane",
            )
        values[environment_field] = str(port)
    return profile_name, profile_file, slot, values


def resolve_deployment_environment_path(
    environment_name: str,
    *,
    repo_root: Path | None = None,
) -> Path:
    root = REPO_ROOT if repo_root is None else repo_root
    resolver = root / "tooling" / "scripts" / "deploy" / "deploy.sh"
    resource = f"deployment-environment:{environment_name}"
    try:
        completed = subprocess.run(
            ["/bin/bash", str(resolver), "resolve", environment_name],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise BlockedError(
            reason=(
                f"Deployment environment {environment_name!r} could not be "
                f"resolved: {error}"
            ),
            resource=resource,
        ) from error

    if completed.returncode != 0:
        detail = (
            completed.stderr.strip()
            or completed.stdout.strip()
            or f"resolver exited with status {completed.returncode}"
        )
        raise BlockedError(
            reason=(
                f"Deployment environment {environment_name!r} could not be "
                f"resolved: {detail}"
            ),
            resource=resource,
        )

    candidates = [
        line.strip()
        for line in completed.stdout.splitlines()
        if line.strip()
    ]
    if len(candidates) != 1:
        raise BlockedError(
            reason=(
                f"Deployment environment {environment_name!r} resolver "
                f"returned {len(candidates)} paths; expected exactly one"
            ),
            resource=resource,
        )
    candidate = Path(candidates[0])
    if not candidate.is_absolute():
        raise BlockedError(
            reason=(
                f"Deployment environment {environment_name!r} resolver "
                f"returned a non-absolute path: {candidate}"
            ),
            resource=resource,
        )
    try:
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise BlockedError(
            reason=(
                f"Deployment environment {environment_name!r} path cannot be "
                f"resolved: {candidate}: {error}"
            ),
            resource=resource,
        ) from error
    if not resolved.is_file():
        raise BlockedError(
            reason=(
                f"Deployment environment {environment_name!r} is not a file: "
                f"{resolved}"
            ),
            resource=resource,
        )
    return resolved


class EnvironmentProvisioner(ABC):
    environment_id = ""

    def __init__(self, contract: EnvironmentContract) -> None:
        if not self.environment_id:
            raise ProvisioningError(
                f"Provisioner subclass {type(self).__name__} must define environment_id"
            )
        if contract.id != self.environment_id:
            raise ProvisioningError(
                f"contract id {contract.id!r} does not match provisioner "
                f"{self.environment_id!r}"
            )
        self.contract = contract
        self._manifest: RuntimeManifest | None = None
        self._cleanup_handlers: list[tuple[str, Callable[[], None]]] = []
        self._resolved_credential_values: tuple[str, ...] = ()
        self._prepared_credentials: (
            tuple[tuple[str, ...], dict[str, str]] | None
        ) = None
        self._credential_preparation_error: Exception | None = None
        self._evidence_run: RunHandle | None = None

    def bind_evidence_run(self, run: RunHandle) -> None:
        if self._manifest is not None:
            raise ProvisioningError(
                "evidence run must be bound before provisioning starts"
            )
        if self._evidence_run is not None and self._evidence_run is not run:
            raise ProvisioningError(
                "provisioner is already bound to another evidence run"
            )
        self._evidence_run = run

    @property
    def evidence_run(self) -> RunHandle:
        if self._evidence_run is None:
            raise ProvisioningError(
                "provisioner requires an explicitly bound evidence run"
            )
        return self._evidence_run

    @abstractmethod
    def provision(self, gate_id: str) -> RuntimeManifest:
        ...

    def create_gate_launch_context(
        self,
        *,
        gate_id: str,
        evidence_run_id: str,
        provisioning_run_id: str,
        required_capabilities: tuple[str, ...],
    ) -> EphemeralGateLaunchContext | None:
        if required_capabilities:
            raise BlockedError(
                reason=(
                    f"Environment {self.environment_id!r} does not provide "
                    "the Gate's required ephemeral capabilities"
                ),
                resource=f"ephemeral-capabilities:{gate_id}",
            )
        return None

    def cleanup(self) -> tuple[str, ...]:
        failures: list[str] = []
        completed: list[str] = []
        for name, handler in reversed(self._cleanup_handlers):
            try:
                handler()
                completed.append(name)
            except Exception as error:
                failures.append(f"{name}: {error}")
        self._cleanup_handlers.clear()
        if failures:
            raise ProvisioningError(f"cleanup failed: {'; '.join(failures)}")
        return tuple(completed)

    def register_cleanup(self, name: str, handler: Callable[[], None]) -> None:
        self._cleanup_handlers.append((name, handler))

    @property
    def resolved_credential_values(self) -> tuple[str, ...]:
        """Return in-memory values resolved by this provisioner instance."""
        return self._resolved_credential_values

    def prepare_credentials(
        self,
    ) -> tuple[tuple[str, ...], dict[str, str]]:
        """Resolve credentials once, before any runtime artifact is written."""
        if self._credential_preparation_error is not None:
            raise self._credential_preparation_error
        if self._prepared_credentials is None:
            try:
                refs, values = self._resolve_credentials()
            except Exception as error:
                self._credential_preparation_error = error
                raise
            self._prepared_credentials = (refs, dict(values))
        refs, values = self._prepared_credentials
        return refs, dict(values)

    def _remember_resolved_credentials(
        self,
        refs: tuple[str, ...],
        values: dict[str, str],
        *,
        sensitive: bool = True,
    ) -> tuple[tuple[str, ...], dict[str, str]]:
        if sensitive:
            short_ids = sorted(
                credential_id
                for credential_id, value in values.items()
                if len(value) < 4
            )
            if short_ids:
                raise BlockedError(
                    reason=(
                        "Resolved credentials are too short for safe evidence "
                        f"redaction: {', '.join(short_ids)}"
                    ),
                    resource="credential-values",
                )
            self._resolved_credential_values = tuple(
                value for value in values.values() if value
            )
        else:
            self._resolved_credential_values = ()
        return refs, values

    def _resolve_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        refs: list[str] = []
        values: dict[str, str] = {}
        self._resolved_credential_values = ()
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
            if len(value) < 4:
                raise BlockedError(
                    reason=(
                        f"Credential {credential.id} from "
                        f"{credential.source_ref} is too short for safe "
                        "evidence redaction"
                    ),
                    resource=f"credential-ref:{credential.source_ref}",
                )
            refs.append(credential.source_ref)
            values[credential.id] = value
            self._resolved_credential_values = tuple(
                resolved
                for resolved in values.values()
                if resolved
            )
        return self._remember_resolved_credentials(tuple(refs), values)

    def acquire_profile_lease(self, resource: str, owner: str) -> None:
        lease = ProfileLease(resource, owner)
        try:
            lease.acquire()
        except ProfileLeaseUnavailable as error:
            raise BlockedError(
                reason=str(error),
                resource=f"profile-lease:{error.resource}",
            ) from error
        self.register_cleanup(
            f"profile-lease:{lease.resource}",
            lease.release,
        )

    def acquire_remote_git_source_lease(
        self,
        resource: str,
        owner: str,
    ) -> None:
        try:
            environment_name = normalize_lease_resource(resource)
        except ValueError as error:
            raise BlockedError(
                reason=str(error),
                resource="source-lease:invalid-resource",
            ) from error
        if environment_name != resource:
            raise BlockedError(
                reason=(
                    f"Station deployment environment {resource!r} is not a "
                    "canonical lease resource"
                ),
                resource="source-lease:invalid-resource",
            )
        environment_path = resolve_deployment_environment_path(environment_name)
        environment = load_env_file(environment_path)
        try:
            lease = RemoteGitSourceLease(
                environment_name,
                owner,
                host=environment.get("PT_DEPLOY_HOST", ""),
                user=environment.get("PT_DEPLOY_USER", ""),
                deploy_path=environment.get("PT_DEPLOY_PATH", ""),
                port=int(environment.get("PT_DEPLOY_SSH_PORT", "22")),
                known_hosts_file=environment.get(
                    "PT_DEPLOY_KNOWN_HOSTS_FILE",
                    "",
                ),
            )
            lease.acquire()
        except (
            ValueError,
            ProvisioningError,
            RemoteGitSourceLeaseUnavailable,
        ) as error:
            raise BlockedError(
                reason=str(error),
                resource=f"source-lease:{environment_name}",
            ) from error
        self.register_cleanup(
            f"source-lease:{lease.resource}",
            lease.release,
        )

    def _git_commit(self) -> str:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        return (
            completed.stdout.strip()
            if completed.returncode == 0
            else "unknown"
        )

    def _git_workspace_digest(self) -> str:
        try:
            return source_workspace_digest(REPO_ROOT)
        except (OSError, subprocess.SubprocessError):
            return "unknown"

    def _resolve_active_profile(self) -> tuple[str, Path, int, dict[str, str]]:
        return resolve_machine_profile_environment(
            REPO_ROOT,
            require_identity_match=self.contract.profile.identity_match,
        )

    def _station_ready(self, station_url: str, health_url: str = "") -> bool:
        url = health_url or f"{station_url.rstrip('/')}/api/oauth/providers"
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                return 200 <= response.status < 300
        except (urllib.error.URLError, OSError, TimeoutError):
            return False

    def _new_base_manifest(self, gate_id: str) -> RuntimeManifest:
        return new_manifest(
            environment_id=self.environment_id,
            gate_id=gate_id,
            requested_profile="unknown",
            resolved_profile="unknown",
            slot=0,
            commit=self._git_commit(),
            worktree=str(REPO_ROOT),
            workspace_digest=self._git_workspace_digest(),
        )

    def _preflighted(
        self,
        manifest: RuntimeManifest,
        *,
        profile_name: str,
        slot: int,
    ) -> RuntimeManifest:
        resolved = dataclasses.replace(
            manifest,
            state=ProvisioningState.PREFLIGHTED,
            profile_requested=profile_name,
            profile_resolved=profile_name,
            profile_slot=slot,
        )
        self._manifest = resolved
        return resolved

    def _blocked(
        self,
        manifest: RuntimeManifest,
        *,
        reason: str,
        resource: str,
    ) -> RuntimeManifest:
        blocked = blocked_manifest(manifest, reason=reason, resource=resource)
        self._manifest = blocked
        return blocked

    def _ready(self, manifest: RuntimeManifest) -> RuntimeManifest:
        for service_id, requirement in self.contract.services.items():
            if not requirement.required:
                continue
            attestation = manifest.services.get(service_id)
            if attestation is None:
                raise BlockedError(
                    reason=(
                        f"Required service {service_id!r} has no runtime attestation"
                    ),
                    resource=f"service-attestation:{service_id}",
                )
            if attestation.service_kind != requirement.kind:
                raise BlockedError(
                    reason=(
                        f"Service {service_id!r} kind {attestation.service_kind!r} "
                        f"does not match contract kind {requirement.kind!r}"
                    ),
                    resource=f"service-attestation:{service_id}",
                )
            if (
                requirement.runtime_identity_required
                and not attestation.runtime_identity
            ):
                raise BlockedError(
                    reason=(
                        f"Service {service_id!r} has no stable runtime identity"
                    ),
                    resource=f"service-identity:{service_id}",
                )
        ready = dataclasses.replace(
            manifest,
            state=ProvisioningState.FIXTURE_READY,
            cleanup_registered=bool(self._cleanup_handlers),
        )
        self._manifest = ready
        return ready

    def write_manifest(self) -> Path:
        if self._manifest is None:
            raise ProvisioningError(
                "cannot write manifest before provision() is called"
            )
        return write_current_artifact(
            "runtime/environment-manifest.json",
            (
                json.dumps(self._manifest.to_dict(), indent=2, sort_keys=True)
                + "\n"
            ).encode("utf-8"),
            repo_root=REPO_ROOT,
        )
