"""Reviewed Chat fixture targets; the Machine Dev lease owns authority."""

from __future__ import annotations

from contextlib import contextmanager
import json
import os
import subprocess
from collections.abc import Iterable, Iterator

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.reset_authority import require_station_reset_authority


PROFILE_BINDINGS_ENV = "PT_CHAT_FIXTURE_PROFILE_BINDINGS"


def require_reset_lease() -> None:
    scope = os.environ.get("PT_MACHINE_LEASE_RESET_SCOPE", "").strip()
    if not scope:
        raise BlockedError(
            reason="Chat fixture mutation requires its live station.reset lease",
            resource="station.reset:chat-fixture",
        )
    require_station_reset_authority(scope)


def _reviewed_profile(profile: str) -> dict[str, str]:
    # The public registry owner validates both Profile and deployment topology.
    completed = subprocess.run(
        [
            "node", "--input-type=module", "-e",
            (
                "import {resolveProfileDefinition} from "
                "'./tooling/scripts/local-dev/machine-dev-registry.mjs';"
                "const p=resolveProfileDefinition({workspaceRoot:process.cwd(),"
                "envRepo:process.env.PT_ENV_REPO,profile:process.argv[1]});"
                "console.log(JSON.stringify({profile:p.profile,"
                "resetPolicy:p.resetPolicy,environment:p.stationDeployEnvironment,"
                "stationUrl:p.stationUrl}));"
            ),
            profile,
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    if completed.returncode:
        raise BlockedError(
            reason=f"Chat fixture Profile {profile!r} is unavailable or not reviewed",
            resource=f"service-profile:{profile}",
        )
    target = json.loads(completed.stdout)
    if target["resetPolicy"] != "agent-resettable":
        raise BlockedError(
            reason=f"PROFILE_RESET_PROTECTED: Chat fixture Profile {profile!r}",
            resource=f"service-profile:{profile}",
        )
    return target


@contextmanager
def bound_reset_profiles(profiles: Iterable[str]) -> Iterator[None]:
    require_reset_lease()
    bindings = reviewed_profile_bindings(profiles)
    previous = os.environ.get(PROFILE_BINDINGS_ENV)
    os.environ[PROFILE_BINDINGS_ENV] = json.dumps(bindings)
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop(PROFILE_BINDINGS_ENV, None)
        else:
            os.environ[PROFILE_BINDINGS_ENV] = previous


def reviewed_profile_bindings(profiles: Iterable[str]) -> dict[str, str]:
    bindings: dict[str, str] = {}
    for profile in sorted(set(profiles)):
        target = _reviewed_profile(profile)
        environment = target["environment"]
        if not environment or environment in bindings:
            raise ValueError("Chat fixture Profiles require distinct deployment targets")
        bindings[environment] = profile
    if not bindings:
        raise ValueError("Chat fixture requires at least one reviewed Profile")
    return bindings


def bound_reset_target(
    environment: str,
    station_url: str,
) -> dict[str, str] | None:
    raw = os.environ.get(PROFILE_BINDINGS_ENV)
    if raw is None:
        return None
    require_reset_lease()
    bindings = json.loads(raw)
    profile = bindings.get(environment) if isinstance(bindings, dict) else None
    if not isinstance(profile, str):
        raise BlockedError(
            reason=f"Chat fixture deployment {environment!r} has no Profile binding",
            resource=f"fixture-target:{environment}",
        )
    target = _reviewed_profile(profile)
    if (
        target["environment"] != environment
        or station_url.rstrip("/") not in {"", target["stationUrl"].rstrip("/")}
    ):
        raise BlockedError(
            reason=f"Chat fixture Profile {profile!r} does not match the reset target",
            resource=f"fixture-target:{environment}",
        )
    return target
