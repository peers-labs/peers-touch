"""Shared broad-Acceptance admission through the Development Session owner."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


class AcceptanceAdmissionError(RuntimeError):
    """Raised before any broad Acceptance work starts."""


def require_acceptance_admission(
    repo_root: Path,
    session: str | None,
    mode: str,
    *,
    runner: Any = subprocess.run,
) -> dict[str, Any]:
    if not session:
        raise AcceptanceAdmissionError(
            "ACCEPTANCE_SESSION_REQUIRED: broad Acceptance requires "
            "an explicit Development Session"
        )
    completed = runner(
        [
            "node",
            "tooling/scripts/plan/acceptance-admission.mjs",
            "--repo-root",
            str(repo_root),
            "--session",
            session,
            "--mode",
            mode,
        ],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        try:
            payload = json.loads(detail)
            error = payload.get("error", {})
            code = error.get("code", "ACCEPTANCE_ADMISSION_FAILED")
            message = error.get("message", "Acceptance admission failed")
            detail = f"{code}: {message}"
        except (json.JSONDecodeError, AttributeError):
            detail = f"ACCEPTANCE_ADMISSION_FAILED: {detail}"
        raise AcceptanceAdmissionError(detail)
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise AcceptanceAdmissionError(
            "ACCEPTANCE_ADMISSION_FAILED: admission returned invalid JSON"
        ) from error
    if result.get("ok") is not True:
        raise AcceptanceAdmissionError(
            "ACCEPTANCE_ADMISSION_FAILED: admission did not return PASS"
        )
    return result
