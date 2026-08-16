from __future__ import annotations

import dataclasses
import subprocess
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from collections.abc import Callable
from pathlib import Path

from ._paths import MANIFESTS_DIR, REPO_ROOT
from .attestation import source_workspace_digest
from .errors import BlockedError, ProvisioningError
from .provisioning import (
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
    blocked_manifest,
    new_manifest,
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

    @abstractmethod
    def provision(self, gate_id: str) -> RuntimeManifest:
        ...

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
        worktree_id = REPO_ROOT.name
        active_file = (
            REPO_ROOT / ".local" / "dev" / "active" / f"{worktree_id}.env"
        )
        if not active_file.exists() and not active_file.is_symlink():
            raise BlockedError(
                reason=(
                    f"No active profile for worktree {worktree_id!r}. "
                    "Run: make profile PROFILE=<name>"
                ),
                resource=f"profile:active:{worktree_id}",
            )
        try:
            profile_file = active_file.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise BlockedError(
                reason=f"Active profile cannot be resolved: {active_file}: {error}",
                resource=f"profile:symlink:{active_file}",
            ) from error

        values = load_env_file(profile_file)
        profile_name = values.get("PT_DEV_PROFILE", "")
        try:
            slot = int(values.get("PT_DEV_SLOT", "0"))
        except ValueError as error:
            raise BlockedError(
                reason=f"Profile {profile_file} has invalid PT_DEV_SLOT",
                resource=f"profile:slot:{profile_file}",
            ) from error
        if not profile_name:
            raise BlockedError(
                reason=f"Profile {profile_file} is missing PT_DEV_PROFILE",
                resource=f"profile:content:{profile_file}",
            )
        expected_name = profile_file.stem
        if self.contract.profile.identity_match and profile_name != expected_name:
            raise BlockedError(
                reason=(
                    f"Profile identity mismatch: PT_DEV_PROFILE={profile_name} "
                    f"but filename is {expected_name}.env"
                ),
                resource=f"profile:identity:{expected_name}",
            )
        return profile_name, profile_file, slot, values

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
        path = (
            MANIFESTS_DIR
            / f"{self.environment_id}-{self._manifest.run_id}.json"
        )
        return self._manifest.write(path)
