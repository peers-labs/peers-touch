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
from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic


PROFILE_BINDINGS_ENV = "PT_CHAT_FIXTURE_PROFILE_BINDINGS"


def _blocked(
    reason: str,
    resource: str,
    *,
    expected: object,
    observed: object,
    recovery: str,
) -> BlockedError:
    return BlockedError(
        reason=reason,
        resource=resource,
        diagnostic=ResourceDiagnostic.observed(
            owner="chat-fixture-target",
            recovery_action=recovery,
            resource=resource,
            expected=expected,
            observed=observed,
        ),
    )


def require_reset_lease() -> None:
    scope = os.environ.get("PT_MACHINE_LEASE_RESET_SCOPE", "").strip()
    if not scope:
        raise _blocked(
            reason="Chat fixture mutation requires its live station.reset lease",
            resource="station.reset:chat-fixture",
            expected="non-empty reset scope and canonical live OS-held lease",
            observed={"resetScopePresent": False},
            recovery="Acquire the Fixture's exact-scope Machine Dev reset lease.",
        )
    try:
        require_station_reset_authority(scope)
    except BlockedError as error:
        if error.diagnostic is not None:
            raise
        raise _blocked(
            reason=error.reason,
            resource=error.resource,
            expected={"resetScope": scope, "validation": "current"},
            observed={"validation": "rejected", "reason": error.reason},
            recovery="Reacquire the exact-scope Machine Dev reset lease and inherit its live FD.",
        ) from error


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
        raise _blocked(
            reason=f"Chat fixture Profile {profile!r} is unavailable or not reviewed",
            resource=f"service-profile:{profile}",
            expected={"profile": profile, "registryValidation": "reviewed"},
            observed={"registryExitCode": completed.returncode},
            recovery="Repair the assigned Profile through the Machine Dev registry owner.",
        )
    target = json.loads(completed.stdout)
    if target["resetPolicy"] != "agent-resettable":
        raise _blocked(
            reason=f"PROFILE_RESET_PROTECTED: Chat fixture Profile {profile!r}",
            resource=f"service-profile:{profile}",
            expected={"resetPolicy": "agent-resettable"},
            observed={"profile": profile, "resetPolicy": target["resetPolicy"]},
            recovery="Bind an assigned Agent-resettable Profile; stable targets cannot be reset.",
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


def _bound_profiles() -> dict[str, str] | None:
    raw = os.environ.get(PROFILE_BINDINGS_ENV)
    if raw is None:
        return None
    require_reset_lease()
    try:
        bindings = json.loads(raw)
    except json.JSONDecodeError:
        bindings = None
    if (
        not isinstance(bindings, dict)
        or not bindings
        or any(
            not isinstance(environment, str) or not environment
            or not isinstance(profile, str) or not profile
            for environment, profile in bindings.items()
        )
    ):
        raise _blocked(
            reason="Chat fixture Profile bindings are invalid",
            resource="fixture-target:profile-bindings",
            expected="non-empty deployment-to-reviewed-Profile mapping",
            observed={"validMapping": False},
            recovery="Reprovision the Fixture's reviewed Profile bindings.",
        )
    return bindings


def bound_reset_environment(station_url: str) -> str | None:
    """Resolve implicit targets only from the current reviewed Fixture bindings."""
    bindings = _bound_profiles()
    if bindings is None:
        return None
    candidates = [
        bound_reset_target(environment, "")
        for environment in bindings
    ]
    matches = [
        target for target in candidates
        if target is not None
        and station_url.rstrip("/")
        and target["stationUrl"].rstrip("/") == station_url.rstrip("/")
    ]
    if len(matches) != 1:
        raise _blocked(
            reason="Chat fixture Station URL requires one exact reviewed target",
            resource="fixture-target:station-url",
            expected={"uniqueExactMatch": True, "targets": candidates},
            observed={"stationUrl": station_url, "matchingTargetCount": len(matches)},
            recovery="Use the exact URL of one assigned reviewed Fixture target; repair ambiguous bindings.",
        )
    return matches[0]["environment"]


def bound_reset_target(
    environment: str,
    station_url: str,
) -> dict[str, str] | None:
    bindings = _bound_profiles()
    if bindings is None:
        return None
    profile = bindings.get(environment)
    if not isinstance(profile, str):
        raise _blocked(
            reason=f"Chat fixture deployment {environment!r} has no Profile binding",
            resource=f"fixture-target:{environment}",
            expected={"boundEnvironments": sorted(bindings)},
            observed={"environment": environment, "stationUrl": station_url},
            recovery="Bind the assigned reviewed Profile for this deployment before Fixture use.",
        )
    target = _reviewed_profile(profile)
    if (
        target["environment"] != environment
        or station_url.rstrip("/") not in {"", target["stationUrl"].rstrip("/")}
    ):
        raise _blocked(
            reason=f"Chat fixture Profile {profile!r} does not match the reset target",
            resource=f"fixture-target:{environment}",
            expected=target,
            observed={"environment": environment, "stationUrl": station_url},
            recovery="Use the bound Profile's exact deployment and Station URL; reprovision after target changes.",
        )
    return target
