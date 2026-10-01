from __future__ import annotations

import hashlib
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
    runtime_manifest_digest: str | None = None,
    runtime_manifest_ref: str | None = None,
) -> Path:
    if runtime_manifest_digest is None or runtime_manifest_ref is None:
        manifest_path, manifest_digest = _runtime_manifest(
            root,
            run_id=run_id,
            journey_id=spec.journey_id,
            spec=spec,
        )
        runtime_manifest_digest = manifest_digest
        runtime_manifest_ref = str(manifest_path)
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
        "runtimeManifestDigest": runtime_manifest_digest,
        "runtimeManifestRef": runtime_manifest_ref,
        "serviceIds": sorted(spec.required_service_ids or {"station-four"}),
        "fixtureManifestDigest": _fixture_manifest_digest(
            Path(runtime_manifest_ref)
        ),
        "checks": [],
        "artifactRefs": [str(path)],
    }
    value["resultDigest"] = canonical_digest(value)
    _write_private_json(path, value)
    return path


def _runtime_manifest(
    root: Path,
    *,
    run_id: str,
    journey_id: str,
    spec: result_aggregate.ChildSpec,
    continuation: dict[str, object] | None = None,
) -> tuple[Path, str]:
    path = root / "runtime-owner" / run_id / "runtime.json"
    fixture: dict[str, object] = {
        "schema_version": 1,
        "kind": "peers-touch-fixture-manifest",
        "fixture_set_id": f"fixture-{run_id}",
        "source_checkpoint": GENERATION,
        "handles": [
            {
                "kind": f"{capability}-fixture",
                "opaque_id": f"handle-{capability}",
                "owner": owner,
                "capability": capability,
                "expected_identity_digest": "f" * 64,
            }
            for capability, owner in (
                spec.required_fixture_owners or {}
            ).items()
        ],
    }
    fixture["manifest_digest"] = canonical_digest(fixture)
    fixture_path = path.parent / "fixture.json"
    _write_private_json(fixture_path, fixture)
    value: dict[str, object] = {
        "schema_version": 3,
        "kind": "peers-touch-runtime-manifest",
        "run_id": run_id,
        "journey_id": journey_id,
        "source": {"commit": GENERATION},
        "services": {
            service_id: {}
            for service_id in sorted(
                spec.required_service_ids or {"station-four"}
            )
        },
        "clients": [
            {"id": client_id}
            for client_id in sorted(spec.clients)
        ],
        "fixture_manifest_ref": {
            "path": fixture_path.name,
            "sha256": hashlib.sha256(fixture_path.read_bytes()).hexdigest(),
        },
        "fixture_manifest_digest": fixture["manifest_digest"],
    }
    if continuation is not None:
        value["continuation"] = continuation
    digest = canonical_digest(value)
    value["manifest_digest"] = digest
    _write_private_json(path, value)
    return path, digest


def _fixture_manifest_digest(runtime_path: Path) -> str:
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    return str(runtime["fixture_manifest_digest"])


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

    def test_w8_audience_requires_two_profiles_and_remote_client(self) -> None:
        audience = result_aggregate.SPECS["W8"].variants["audience"]
        comment = result_aggregate.SPECS["W8"].variants["comment"]
        assert audience is not None
        assert comment is not None

        self.assertEqual(
            frozenset({"four", "fiveArm"}),
            audience.profiles,
        )
        self.assertEqual(
            frozenset(
                {
                    "secure-content-desktop-alice",
                    "secure-content-desktop-bob",
                    "secure-content-desktop-eve",
                    "secure-content-desktop-remote-recipient",
                }
            ),
            audience.clients,
        )
        self.assertEqual(frozenset({"four"}), comment.profiles)
        for variant in ("subtype", "object", "delete-block", "bounds"):
            self.assertEqual(
                frozenset({"four"}),
                result_aggregate.SPECS["W8"].variants[variant].profiles,
            )

    def test_w8_aggregate_verifies_runtime_service_and_fixture_bindings(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = result_aggregate.SPECS["W8"]
            for variant, child_spec in spec.variants.items():
                assert child_spec is not None
                _product_child(
                    root,
                    workstream="W8",
                    variant=variant,
                    run_id=f"run-{variant}",
                    spec=child_spec,
                )

            result = self.owner(root).aggregate(
                workstream="W8",
                required=tuple(spec.variants),
                generation_id=GENERATION,
            )

            self.assertEqual("PASS", result["result"])

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = result_aggregate.SPECS["W8"]
            for variant, child_spec in spec.variants.items():
                assert child_spec is not None
                _product_child(
                    root,
                    workstream="W8",
                    variant=variant,
                    run_id=f"run-{variant}",
                    spec=child_spec,
                )
            (
                root
                / "runtime-owner"
                / "run-audience"
                / "fixture.json"
            ).unlink()

            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "fixture manifest is unavailable",
            ):
                self.owner(root).aggregate(
                    workstream="W8",
                    required=tuple(spec.variants),
                    generation_id=GENERATION,
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

    def test_accepts_one_owner_linked_w7_desktop_continuation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = result_aggregate.SPECS["W7"]
            desktop = spec.variants["desktop"]
            browser = spec.variants["browser"]
            assert desktop is not None
            assert browser is not None
            parent_run_id = "w7-parent"
            parent_manifest_path, parent_manifest_digest = _runtime_manifest(
                root,
                run_id=parent_run_id,
                journey_id=desktop.journey_id,
                spec=desktop,
            )
            parent_path = _product_child(
                root,
                workstream="W7",
                variant="desktop",
                run_id=parent_run_id,
                spec=desktop,
                runtime_manifest_digest=parent_manifest_digest,
                runtime_manifest_ref=str(parent_manifest_path),
            )
            parent = json.loads(parent_path.read_text(encoding="utf-8"))
            parent["result"] = "BLOCKED"
            parent["firstFailure"] = {
                "kind": "BLOCKED_RUNTIME_ACTION_REQUIRED",
                "owner": "secure-content-w7-runtime",
                "retryable": True,
                "stage": "FUNCTIONAL_RUNNING",
                "summary": "restart required",
            }
            parent["resultDigest"] = canonical_digest(
                {
                    key: value
                    for key, value in parent.items()
                    if key != "resultDigest"
                }
            )
            _write_private_json(parent_path, parent)

            restart_request_id = "restart-bob"
            child_run_id = (
                f"{parent_run_id}-c-"
                + hashlib.sha256(
                    f"{parent_run_id}:{restart_request_id}".encode("utf-8")
                ).hexdigest()[:12]
            )
            child_manifest_path, child_manifest_digest = _runtime_manifest(
                root,
                run_id=child_run_id,
                journey_id=desktop.journey_id,
                spec=desktop,
                continuation={
                    "parent_manifest_digest": parent_manifest_digest,
                    "restart_request_id": restart_request_id,
                },
            )
            child_path = _product_child(
                root,
                workstream="W7",
                variant="desktop",
                run_id=child_run_id,
                spec=desktop,
                runtime_manifest_digest=child_manifest_digest,
                runtime_manifest_ref=str(child_manifest_path),
            )
            _product_child(
                root,
                workstream="W7",
                variant="browser",
                run_id="w7-browser",
                spec=browser,
            )

            result = self.owner(root).aggregate(
                workstream="W7",
                required=("desktop", "browser"),
                generation_id=GENERATION,
            )

            self.assertEqual(
                child_path.relative_to(root).as_posix(),
                result["children"][0]["resultRef"]["path"],
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
