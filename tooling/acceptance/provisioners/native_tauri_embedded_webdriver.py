from __future__ import annotations

import subprocess
from pathlib import Path

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioning import (
    EnvironmentContract,
    RuntimeManifest,
)

from .home_station import HomeStationProvisioner


ACTOR_FIXTURE = REPO_ROOT / "apps" / "station" / "app" / "conf" / "actor.yml"


def _fixture_password(path: Path) -> str:
    current_email = ""
    passwords: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("email:"):
            current_email = line.split(":", 1)[1].strip().strip("'\"")
        elif current_email and line.startswith("password:"):
            passwords[current_email] = line.split(":", 1)[1].strip().strip("'\"")
            current_email = ""

    values = {passwords.get("alice@p.t"), passwords.get("bob@p.t")}
    values.discard(None)
    values.discard("")
    if len(values) != 1:
        raise BlockedError(
            reason="Committed Alice/Bob Acceptance fixture passwords are missing or inconsistent",
            resource="fixture:apps/station/app/conf/actor.yml",
        )
    return values.pop()


class NativeTauriEmbeddedWebDriverProvisioner(HomeStationProvisioner):
    environment_id = "native-tauri-embedded-webdriver"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

    def _resolve_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        return (
            ("fixture:apps/station/app/conf/actor.yml#preset_users",),
            {"chat-password": _fixture_password(ACTOR_FIXTURE)},
        )

    def _run_preflight_command(
        self,
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
        manifest = super().provision(gate_id)
        if not manifest.is_ready():
            return manifest
        try:
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
        except (BlockedError, subprocess.TimeoutExpired) as error:
            if isinstance(error, BlockedError):
                blocked = error
            else:
                blocked = BlockedError(
                    reason=f"{' '.join(error.cmd)} timed out after {error.timeout}s",
                    resource="desktop-acceptance-binary:preflight",
                )
            return self._blocked(
                manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
