from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tooling.development.secure_content import result_aggregate
from tooling.development.secure_content.schema_activation import (
    ArtifactConflict,
    canonical_digest,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
GENERATION = "a" * 40
WORKSPACE_ID = "0123456789abcdef"


def _write_private_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    path.chmod(0o600)


def _product_child(
    root: Path,
    *,
    workstream: str,
    variant: str,
    run_id: str,
    spec: result_aggregate.ChildSpec,
) -> Path:
    path = root / workstream / GENERATION / variant / run_id / "result.json"
    value: dict[str, object] = {
        "schemaVersion": 1,
        "kind": result_aggregate.RESULT_KIND,
        "taskId": workstream,
        "workstreamId": workstream,
        "generationId": GENERATION,
        "variantId": variant,
        "runId": run_id,
        "workItemId": spec.work_item_id,
        "journeyId": spec.journey_id,
        "scenarioId": f"scenario-{variant}",
        "runtime": spec.runtime,
        "verificationClass": "FUNCTIONAL_CHECK",
        "result": "PASS",
        "proofState": "UNPROVEN",
        "workspaceId": WORKSPACE_ID,
        "branch": "feat/federation",
        "sourceCommit": GENERATION,
        "sessionId": "session",
        "declarationId": f"{spec.work_item_id}-{WORKSPACE_ID}",
        "declarationDigest": "b" * 64,
        "runtimeBindingDigest": "c" * 64,
        "profile": None,
        "profiles": sorted(spec.profiles),
        "clients": sorted(spec.clients),
        "startedAt": "2026-09-19T10:00:00.000Z",
        "completedAt": "2026-09-19T10:01:00.000Z",
        "durationMs": 60000,
        "commandDigest": "d" * 64,
        "runtimeManifestDigest": "e" * 64,
        "runtimeManifestRef": "/tmp/runtime.json",
        "serviceIds": ["station-four"],
        "fixtureManifestDigest": "f" * 64,
        "checks": [],
        "artifactRefs": [str(path)],
    }
    value["resultDigest"] = canonical_digest(value)
    _write_private_json(path, value)
    return path


class ResultAggregateOwnerTest(unittest.TestCase):
    def owner(self, root: Path) -> result_aggregate.ResultAggregateOwner:
        return result_aggregate.ResultAggregateOwner(
            repo_root=REPO_ROOT,
            result_root=root,
            identity_loader=lambda: {
                "workspaceId": WORKSPACE_ID,
                "head": GENERATION,
            },
        )

    def test_aggregates_exact_w2_variant_set_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = result_aggregate.SPECS["W2"]
            for variant, child_spec in spec.variants.items():
                assert child_spec is not None
                _product_child(
                    root,
                    workstream="W2",
                    variant=variant,
                    run_id=f"run-{variant}",
                    spec=child_spec,
                )

            result = self.owner(root).aggregate(
                workstream="W2",
                required=("desktop", "ios", "android"),
                generation_id=GENERATION,
            )

            self.assertEqual("PASS", result["result"])
            self.assertEqual("UNPROVEN", result["proofState"])
            self.assertEqual(GENERATION, result["sourceCommit"])
            self.assertEqual(GENERATION, result["runtimeSourceCommit"])
            self.assertEqual(GENERATION, result["controlHead"])
            self.assertEqual(0, result["sourceTransitionCount"])
            self.assertEqual(64, len(result["sourceProjectionDigest"]))
            self.assertEqual(
                ["desktop", "ios", "android"],
                [child["variantId"] for child in result["children"]],
            )
            aggregate_path = (
                root / "W2" / GENERATION / "aggregate" / "result.json"
            )
            self.assertTrue(aggregate_path.is_file())
            with self.assertRaises(ArtifactConflict):
                self.owner(root).aggregate(
                    workstream="W2",
                    required=("desktop", "ios", "android"),
                    generation_id=GENERATION,
                )

    def test_rejects_missing_duplicate_and_tampered_children(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = result_aggregate.SPECS["W2"]
            desktop = spec.variants["desktop"]
            assert desktop is not None
            _product_child(
                root,
                workstream="W2",
                variant="desktop",
                run_id="run-desktop",
                spec=desktop,
            )
            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "requires exactly one child",
            ):
                self.owner(root).aggregate(
                    workstream="W2",
                    required=("desktop", "ios", "android"),
                    generation_id=GENERATION,
                )

            for variant in ("ios", "android"):
                child_spec = spec.variants[variant]
                assert child_spec is not None
                _product_child(
                    root,
                    workstream="W2",
                    variant=variant,
                    run_id=f"run-{variant}",
                    spec=child_spec,
                )
            duplicate = root / "W2" / GENERATION / "ios" / "retry" / "result.json"
            duplicate.parent.mkdir(parents=True)
            duplicate.write_bytes(
                (
                    root
                    / "W2"
                    / GENERATION
                    / "ios"
                    / "run-ios"
                    / "result.json"
                ).read_bytes()
            )
            duplicate.chmod(0o600)
            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "found 2",
            ):
                self.owner(root).aggregate(
                    workstream="W2",
                    required=("desktop", "ios", "android"),
                    generation_id=GENERATION,
                )

            duplicate.unlink()
            android_path = (
                root
                / "W2"
                / GENERATION
                / "android"
                / "run-android"
                / "result.json"
            )
            android = json.loads(android_path.read_text(encoding="utf-8"))
            android["runtime"] = "desktop"
            _write_private_json(android_path, android)
            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "invalid runtime",
            ):
                self.owner(root).aggregate(
                    workstream="W2",
                    required=("desktop", "ios", "android"),
                    generation_id=GENERATION,
                )

    def test_rejects_activation_result_as_final_cut(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = (
                root
                / "W12"
                / "final-cut"
                / GENERATION
                / "four"
                / "reset-four"
                / "result.json"
            )
            result: dict[str, object] = {
                "kind": "secure-content-schema-activation-result",
                "workstream_id": "W12A-FOUR",
                "task_id": "W12A",
                "generation_id": GENERATION,
                "source_commit": GENERATION,
                "workspace_id": WORKSPACE_ID,
                "profile_id": "four",
                "reset_intent": "SCHEMA_ACTIVATION",
                "journal_state": "COMPLETE",
                "status": "PASS",
                "claim": "CANONICAL_SCHEMA_ACTIVE_ONLY",
            }
            result["result_digest"] = canonical_digest(result)
            _write_private_json(path, result)

            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "invalid workstream_id",
            ):
                self.owner(root)._load_final_cut_child(
                    generation=GENERATION,
                    variant="final-cut-four",
                )

    def test_requires_complete_exact_variant_set(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "requires exactly desktop,ios,android",
            ):
                self.owner(Path(directory)).aggregate(
                    workstream="W2",
                    required=("desktop", "ios"),
                    generation_id=GENERATION,
                )

    def test_rejects_stale_generation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "differs from the exact worktree HEAD",
            ):
                self.owner(Path(directory)).aggregate(
                    workstream="W2",
                    required=("desktop", "ios", "android"),
                    generation_id="b" * 40,
                )


if __name__ == "__main__":
    unittest.main()
