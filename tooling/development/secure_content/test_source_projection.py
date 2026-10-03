from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from tooling.development.secure_content.source_projection import (
    SourceProjectionError,
    _canonical_digest,
    resolve_runtime_source_identity,
)


RUNTIME_SOURCE = "a" * 40
LEGACY_RUNTIME_SOURCE = "0" * 40
CONTROL_HEAD = "b" * 40
WORKSPACE_ID = "0123456789abcdef"


def _write_activation(
    root: Path,
    generation: str = RUNTIME_SOURCE,
    *,
    task_id: str = "W12D",
    workstream_id: str = "W12D",
) -> None:
    path = root / "W12A" / "activation" / generation / "aggregate" / "result.json"
    path.parent.mkdir(parents=True)
    value = {
        "schema_version": 1,
        "kind": "secure-content-schema-activation-aggregate",
        "task_id": task_id,
        "workstream_id": workstream_id,
        "workspace_id": WORKSPACE_ID,
        "generation_id": generation,
        "source_commit": generation,
        "source_freeze_digest": "d" * 64,
        "source_freeze_ref": {
            "path": f"W12A/source/{generation}/result.json",
            "sha256": "e" * 64,
        },
        "reset_intent": "SCHEMA_ACTIVATION",
        "profiles": ["four", "fiveArm"],
        "children": [
            {
                "profile_id": profile,
                "reset_id": f"{index:032x}",
                "result_digest": f"{index + 1:064x}",
                "result_ref": {
                    "path": (
                        f"W12A/activation/{generation}/{profile}/"
                        f"{index:032x}/result.json"
                    ),
                    "sha256": f"{index + 2:064x}",
                },
                "schema_attestation_digest": f"{index + 3:064x}",
            }
            for index, profile in enumerate(("four", "fiveArm"), start=1)
        ],
        "status": "PASS",
        "claim": "CANONICAL_SCHEMA_ACTIVE_ONLY",
        "completed_at": "2026-09-26T04:51:55.534957Z",
    }
    value["result_digest"] = _canonical_digest(value)
    path.write_text(json.dumps(value), encoding="utf-8")
    path.chmod(0o600)


class SourceProjectionTest(unittest.TestCase):
    def test_ignores_historical_w12a_aggregate_owner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result_root = Path(directory)
            _write_activation(
                result_root,
                LEGACY_RUNTIME_SOURCE,
                task_id="W12A",
                workstream_id="W12A",
            )
            _write_activation(result_root)

            identity = resolve_runtime_source_identity(
                repo_root=Path(__file__).resolve().parents[3],
                result_root=result_root,
                control_identity={
                    "workspaceId": WORKSPACE_ID,
                    "head": CONTROL_HEAD,
                    "branch": "feat/federation",
                },
                projection_validator=lambda **_: SimpleNamespace(
                    transition_count=2,
                    transition_digest="c" * 64,
                ),
                ancestor_checker=lambda *_: True,
                distance=lambda _root, ancestor, _descendant: (
                    1 if ancestor == RUNTIME_SOURCE else 2
                ),
            )

            self.assertEqual(RUNTIME_SOURCE, identity["runtimeSourceCommit"])

    def test_resolves_nearest_activated_ancestor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result_root = Path(directory)
            _write_activation(result_root)
            calls: list[tuple[str, str]] = []

            def validate(**values: object) -> SimpleNamespace:
                calls.append(
                    (
                        str(values["runtime_source_commit"]),
                        str(values["control_head"]),
                    )
                )
                return SimpleNamespace(
                    transition_count=2,
                    transition_digest="c" * 64,
                )

            identity = resolve_runtime_source_identity(
                repo_root=Path(__file__).resolve().parents[3],
                result_root=result_root,
                control_identity={
                    "workspaceId": WORKSPACE_ID,
                    "head": CONTROL_HEAD,
                    "branch": "feat/federation",
                },
                projection_validator=validate,
                ancestor_checker=lambda _root, _ancestor, _descendant: True,
                distance=lambda _root, _ancestor, _descendant: 2,
            )

            self.assertEqual([(RUNTIME_SOURCE, CONTROL_HEAD)], calls)
            self.assertEqual(RUNTIME_SOURCE, identity["head"])
            self.assertEqual(RUNTIME_SOURCE, identity["runtimeSourceCommit"])
            self.assertEqual(CONTROL_HEAD, identity["controlHead"])
            self.assertEqual(2, identity["transitionCount"])

    def test_rejects_tampered_activation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result_root = Path(directory)
            _write_activation(result_root)
            path = (
                result_root
                / "W12A"
                / "activation"
                / RUNTIME_SOURCE
                / "aggregate"
                / "result.json"
            )
            value = json.loads(path.read_text(encoding="utf-8"))
            value["status"] = "BLOCKED"
            path.write_text(json.dumps(value), encoding="utf-8")

            with self.assertRaisesRegex(
                SourceProjectionError,
                "identity is invalid",
            ):
                resolve_runtime_source_identity(
                    repo_root=Path(__file__).resolve().parents[3],
                    result_root=result_root,
                    control_identity={
                        "workspaceId": WORKSPACE_ID,
                        "head": CONTROL_HEAD,
                    },
                    projection_validator=lambda **_: SimpleNamespace(
                        transition_count=0,
                        transition_digest="c" * 64,
                    ),
                    ancestor_checker=lambda *_: True,
                    distance=lambda *_: 0,
                )

    def test_rejects_tampered_historical_w12a_aggregate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result_root = Path(directory)
            _write_activation(
                result_root,
                task_id="W12A",
                workstream_id="W12A",
            )
            path = (
                result_root
                / "W12A"
                / "activation"
                / RUNTIME_SOURCE
                / "aggregate"
                / "result.json"
            )
            value = json.loads(path.read_text(encoding="utf-8"))
            value["workspace_id"] = "fedcba9876543210"
            path.write_text(json.dumps(value), encoding="utf-8")

            with self.assertRaisesRegex(
                SourceProjectionError,
                "identity is invalid",
            ):
                resolve_runtime_source_identity(
                    repo_root=Path(__file__).resolve().parents[3],
                    result_root=result_root,
                    control_identity={
                        "workspaceId": WORKSPACE_ID,
                        "head": CONTROL_HEAD,
                    },
                    projection_validator=lambda **_: SimpleNamespace(
                        transition_count=0,
                        transition_digest="c" * 64,
                    ),
                    ancestor_checker=lambda *_: True,
                    distance=lambda *_: 0,
                )

    def test_rejects_obsolete_w12a_aggregate_task(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result_root = Path(directory)
            _write_activation(
                result_root,
                task_id="W12A",
            )

            with self.assertRaisesRegex(
                SourceProjectionError,
                "identity is invalid",
            ):
                resolve_runtime_source_identity(
                    repo_root=Path(__file__).resolve().parents[3],
                    result_root=result_root,
                    control_identity={
                        "workspaceId": WORKSPACE_ID,
                        "head": CONTROL_HEAD,
                    },
                    projection_validator=lambda **_: SimpleNamespace(
                        transition_count=0,
                        transition_digest="c" * 64,
                    ),
                    ancestor_checker=lambda *_: True,
                    distance=lambda *_: 0,
                )

    def test_rejects_obsolete_w12a_aggregate_workstream(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result_root = Path(directory)
            _write_activation(
                result_root,
                workstream_id="W12A",
            )

            with self.assertRaisesRegex(
                SourceProjectionError,
                "identity is invalid",
            ):
                resolve_runtime_source_identity(
                    repo_root=Path(__file__).resolve().parents[3],
                    result_root=result_root,
                    control_identity={
                        "workspaceId": WORKSPACE_ID,
                        "head": CONTROL_HEAD,
                    },
                    projection_validator=lambda **_: SimpleNamespace(
                        transition_count=0,
                        transition_digest="c" * 64,
                    ),
                    ancestor_checker=lambda *_: True,
                    distance=lambda *_: 0,
                )


if __name__ == "__main__":
    unittest.main()
