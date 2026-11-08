"""Profile Station equipment delegates readiness and deployment to Local Dev."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
from collections.abc import Mapping

from tooling.acceptance.core.errors import (
    BlockedError, EphemeralLaunchCleanupFailed, EphemeralLaunchError,
)
from tooling.acceptance.core.evidence_store import current_artifact_ref, write_current_artifact
from tooling.acceptance.core.execution_budget import positive_seconds
from tooling.acceptance.core.launch_context import GateLaunchSpec, GateProcessLauncher
from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic


def equip_station_profiles(
    profiles: Mapping[str, str], source_commit: str, *, repo_root: Path,
) -> None:
    for profile in sorted(set(profiles.values())):
        equip_station_profile(profile, source_commit, repo_root=repo_root)


def equip_station_profile(
    profile_name: str,
    source_commit: str,
    *,
    repo_root: Path,
    timeout_seconds: float = 150,
    social_notification_run_id: str | None = None,
    recreate_runtime: bool = False,
) -> None:
    """Equip before retaining source leases; callers re-attest after locking."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", profile_name):
        raise ValueError("Station equipment requires a canonical Profile name")
    seconds = positive_seconds(timeout_seconds, "Station equipment timeout")
    environment = dict(os.environ)
    for field in (
        "PT_DEV_PROFILE_FILE", "PT_DEV_PROFILE_FILE_AUTHORITY",
        "PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT",
    ):
        environment.pop(field, None)
    environment.update(
        PT_DEV_TARGET_PROFILE=profile_name,
        PT_BUILD_SOURCE_COMMIT=source_commit,
        PT_STATION_SKIP_DEPLOY="false",
        PT_STATION_LEASE_BUDGET_SECONDS=str(max(1, int(seconds))),
    )
    deployment_environment = dict(environment)
    for field in (
        "PT_ACCEPTANCE_ENVIRONMENT", "PT_ACCEPTANCE_RUN_ID",
        "PT_AGENT_CAPABILITY_SCENARIO_CONTROL", "PT_AGENT_EXTERNAL_RUNTIME_ROOT",
        "PT_AGENT_EXTERNAL_START_ARGV_JSON", "PT_AGENT_EXTERNAL_RESUME_ARGV_JSON",
        "PT_AGENT_EXTERNAL_RESET_ARGV_JSON",
        "PT_SOCIAL_ACCEPTANCE_BUILD", "PT_SOCIAL_ACCEPTANCE_RUN_ID",
        "PT_SOCIAL_ACCEPTANCE_PROFILE", "PT_STATION_RECREATE_RUNTIME",
    ):
        deployment_environment.pop(field, None)
    if social_notification_run_id is not None:
        if (not re.fullmatch(r"[0-9a-f]{16}",
                             social_notification_run_id)
                or profile_name.lower().endswith("stable")):
            raise ValueError("Social notification equipment requires a reviewed non-stable run")
        deployment_environment.update(
            PT_SOCIAL_ACCEPTANCE_BUILD="1",
            PT_SOCIAL_ACCEPTANCE_RUN_ID=social_notification_run_id,
            PT_SOCIAL_ACCEPTANCE_PROFILE=profile_name,
        )
        recreate_runtime = True
    if recreate_runtime:
        deployment_environment["PT_STATION_RECREATE_RUNTIME"] = "true"
    observation: dict[str, object] = {"profile": profile_name, "commit": source_commit}

    def capture(stdout: str, stderr: str) -> None:
        if not environment.get("PT_ACCEPTANCE_RUN_ID"):
            return
        relative = f"runtime/station-equipment/{profile_name}.log"
        write_current_artifact(
            relative, (stdout + stderr).encode(), repo_root=repo_root,
            environment=environment,
        )
        observation["log"] = current_artifact_ref(
            relative, repo_root=repo_root, environment=environment,
        ).to_dict()

    try:
        completed = GateProcessLauncher(
            cwd=str(repo_root), environment=deployment_environment,
            termination_timeout_seconds=1,
        ).run(
            GateLaunchSpec((
                "node", str(repo_root / "tooling/devctl/index.mjs"),
                "station", "start", "--target-profile", profile_name, "--json",
            ), seconds, ()),
            None, capture_output=capture,
        )
        observation["exitCode"] = completed.returncode
        if completed.returncode == 0:
            return
        try:
            payload = json.loads(completed.stderr)
            error = payload.get("error", payload)
            observation["machineCode"] = error.get("code")
        except (json.JSONDecodeError, AttributeError):
            pass
    except EphemeralLaunchCleanupFailed:
        raise
    except (OSError, subprocess.TimeoutExpired, EphemeralLaunchError) as error:
        observation["errorType"] = type(error).__name__
    raise BlockedError(
        reason=f"Canonical Station equipment failed for Profile {profile_name!r}",
        resource=f"station-equipment:{profile_name}",
        diagnostic=ResourceDiagnostic.observed(
            owner="tooling/acceptance/provisioners/station_equipment.py",
            recovery_action=(
                "Repair the recorded Local Dev target operation failure, qualify "
                "it under the same budget, then resume the frozen Gate scope."
            ),
            resource=f"station-equipment:{profile_name}",
            expected={"ready": True, "commit": source_commit, "timeoutSeconds": seconds},
            observed=observation,
        ),
    )
