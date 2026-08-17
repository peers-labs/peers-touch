from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (  # noqa: E402
    ArtifactSession,
    EvidenceStore,
    current_artifact_path,
    latest_artifact_path,
    validate_external_output_path,
)


def artifact_session(gate_id: str) -> ArtifactSession:
    effective_gate_id = os.environ.get("PT_ACCEPTANCE_GATE_ID", "").strip()
    return ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id=effective_gate_id or gate_id,
    )


def explicit_output_path(value: str | Path) -> Path:
    return validate_external_output_path(value, repo_root=REPO_ROOT)


def replace_resolved_artifact_paths(
    value: Any,
    resolved_refs: Mapping[str | Path, Mapping[str, Any]],
) -> Any:
    replacements = {
        str(Path(path)): dict(reference)
        for path, reference in resolved_refs.items()
    }

    def replace(item: Any) -> Any:
        if isinstance(item, Mapping):
            return {str(key): replace(child) for key, child in item.items()}
        if isinstance(item, list):
            return [replace(child) for child in item]
        if isinstance(item, tuple):
            return [replace(child) for child in item]
        if isinstance(item, str) and item in replacements:
            return dict(replacements[item])
        return item

    return replace(value)


def output_path(relative_path: str) -> Path:
    return current_artifact_path(relative_path, repo_root=REPO_ROOT)


def latest_path(gate_id: str, role: str) -> Path:
    return latest_artifact_path(
        gate_id,
        role,
        repo_root=REPO_ROOT,
    )


def latest_artifact(
    gate_id: str,
    role: str,
) -> tuple[Path, dict[str, Any]]:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    reference = store.latest_artifact_ref(gate_id, role)
    return store.resolve(reference), reference.to_dict()


def latest_ref(gate_id: str, role: str) -> dict[str, Any]:
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    return store.latest_artifact_ref(gate_id, role).to_dict()


def inspect_command(gate_id: str, role: str) -> str:
    return (
        "python3 tooling/scripts/acceptance-artifact.py cat "
        f"--gate {gate_id} --role {role}"
    )
