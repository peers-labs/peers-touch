"""Canonical destructive Station reset authority."""

from __future__ import annotations

import json
import importlib.util
import math
import os
import subprocess
import time
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

from ._paths import REPO_ROOT
from .errors import BlockedError
from .resource_diagnostic import ResourceDiagnostic


STATION_RESET_AUTHORITY_PREFIX = "station.reset:"
HELD_LEASE_VALIDATION_TIMEOUT_SECONDS = 10


def station_reset_authorization_ref(scope: str) -> str:
    normalized = _reset_scope(scope)
    return f"{STATION_RESET_AUTHORITY_PREFIX}{normalized}"


@lru_cache(maxsize=1)
def _machine_lease_owner():
    path = REPO_ROOT / "tooling/scripts/local-dev/machine-dev-lease.py"
    spec = importlib.util.spec_from_file_location("machine_dev_lease_owner", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("canonical Machine Dev lease owner is unavailable")
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    return owner


def acquire_station_reset_authority(
    scope: str,
    *,
    budget_seconds: float,
    repo_root: Path = REPO_ROOT,
):
    """Acquire through the canonical owner; the caller retains the real FD."""
    normalized = _reset_scope(scope)
    if not math.isfinite(budget_seconds) or budget_seconds <= 0:
        raise ValueError("reset lease requires a positive remaining lifecycle budget")
    started = time.monotonic()
    command = [
        "node", str(repo_root / "tooling/scripts/local-dev/machine-dev.mjs"),
        "validate-lease", "--workspace-root", str(repo_root),
        "--resource-kind", "station.reset", "--resource-id", normalized,
        "--reset-scope", normalized,
        "--budget-seconds", str(math.ceil(budget_seconds)),
    ]
    if os.environ.get("PT_ENV_REPO"):
        command += ["--env-repo", os.environ["PT_ENV_REPO"]]
    completed = subprocess.run(
        command, cwd=repo_root, capture_output=True, text=True,
        check=False, timeout=budget_seconds,
    )
    if completed.returncode != 0:
        try:
            rejection = json.loads(completed.stderr)
        except json.JSONDecodeError:
            rejection = {}
        raise BlockedError(
            reason=(
                f"Machine Dev reset lease rejected: "
                f"{rejection.get('code', 'RUNTIME_IDENTITY_MISMATCH')}: "
                f"{rejection.get('message', 'current binding validation failed')}"
            ),
            resource=station_reset_authorization_ref(normalized),
        )
    request = json.loads(completed.stdout)
    if (
        request.get("resourceKind") != "station.reset"
        or request.get("resourceId") != normalized
        or not request.get("workspaceId")
        or not request.get("leaseFile")
        or not request.get("source", {}).get("head")
        or not request.get("source", {}).get("branch")
    ):
        raise _blocked(normalized)
    remaining = budget_seconds - (time.monotonic() - started)
    if remaining <= 0:
        raise TimeoutError("reset lease preparation exhausted its lifecycle budget")
    request["budgetSeconds"] = math.ceil(remaining)
    command += [
        "--expected-branch", request["source"]["branch"],
        "--expected-head", request["source"]["head"],
    ]
    owner = _machine_lease_owner()
    try:
        return owner.MachineLease(
            request, command, reset_scope=normalized,
        ).acquire()
    except owner.MachineLeaseError as error:
        raise BlockedError(
            reason=f"Machine Dev reset lease rejected: {error.code}: {error}",
            resource=station_reset_authorization_ref(normalized),
        ) from error


def require_station_reset_authority(
    scope: str,
    *,
    repo_root: Path = REPO_ROOT,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, Any]:
    normalized = _reset_scope(scope)
    expected = {
        "PT_MACHINE_LEASE_KIND": "station.reset",
        "PT_MACHINE_LEASE_RESOURCE_ID": normalized,
        "PT_MACHINE_LEASE_RESET_SCOPE": normalized,
    }
    for name, value in expected.items():
        if os.environ.get(name, "").strip() != value:
            raise _blocked(normalized)

    raw_fd = os.environ.get("PT_MACHINE_LEASE_FD", "").strip()
    lease_id = os.environ.get("PT_MACHINE_LEASE_ID", "").strip()
    try:
        lease_fd = int(raw_fd)
        if lease_fd < 3:
            raise ValueError
        os.fstat(lease_fd)
    except (OSError, ValueError):
        raise _blocked(normalized) from None
    if not lease_id:
        raise _blocked(normalized)

    try:
        completed = runner(
            [
                "node",
                "tooling/scripts/local-dev/machine-dev.mjs",
                "verify-held",
                "--workspace-root",
                str(repo_root),
                "--resource-kind",
                "station.reset",
                "--resource-id",
                normalized,
                "--reset-scope",
                normalized,
                "--budget-seconds",
                "1",
            ],
            cwd=repo_root,
            env=os.environ.copy(),
            pass_fds=(lease_fd,),
            capture_output=True,
            text=True,
            check=False,
            timeout=HELD_LEASE_VALIDATION_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        resource = station_reset_authorization_ref(normalized)
        raise BlockedError(
            reason="Machine Dev held reset lease validation exceeded its subprocess deadline",
            resource=resource,
            diagnostic=ResourceDiagnostic.observed(
                owner="machine-dev-lease",
                recovery_action="Inspect the held-lease validator and reacquire the exact reset scope.",
                resource=resource,
                expected={"validation": "current", "timeoutSeconds": HELD_LEASE_VALIDATION_TIMEOUT_SECONDS},
                observed={"validation": "timed-out", "timeoutSeconds": error.timeout},
            ),
        ) from error
    if completed.returncode != 0:
        raise _blocked(normalized)
    try:
        receipt = json.loads(completed.stdout)
    except json.JSONDecodeError:
        raise _blocked(normalized) from None
    if (
        not isinstance(receipt, dict)
        or receipt.get("leaseId") != lease_id
        or receipt.get("resourceKind") != "station.reset"
        or receipt.get("resourceId") != normalized
        or receipt.get("validation") != "current"
    ):
        raise _blocked(normalized)
    return receipt


def _reset_scope(scope: str) -> str:
    normalized = str(scope).strip()
    if not normalized or normalized != scope:
        raise ValueError("Station reset scope must be a canonical string")
    return normalized


def _blocked(scope: str) -> BlockedError:
    return BlockedError(
        reason=(
            "Destructive Station reset requires the exact live station.reset "
            f"lease for scope {scope!r}"
        ),
        resource=station_reset_authorization_ref(scope),
    )
