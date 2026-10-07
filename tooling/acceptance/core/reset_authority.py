"""Canonical destructive Station reset authority."""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ._paths import REPO_ROOT
from .errors import BlockedError


STATION_RESET_AUTHORITY_PREFIX = "station.reset:"


def station_reset_authorization_ref(scope: str) -> str:
    normalized = _reset_scope(scope)
    return f"{STATION_RESET_AUTHORITY_PREFIX}{normalized}"


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
    )
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
