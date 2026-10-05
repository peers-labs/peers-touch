from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core.suite_runtime import (
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
)
from tooling.development.secure_content import result_aggregate
from tooling.development.secure_content.schema_activation import (
    ArtifactConflict,
    PROFILE_RESULT_KIND,
    canonical_digest,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
GENERATION = "a" * 40
WORKSPACE_ID = "0123456789abcdef"
POST_CUT_EPOCH_ID = "w12-post-cut-epoch"
W12_SUITE_RUNTIME_ID = "w12-suite-runtime"
FINAL_CUT_COMPLETED_AT = "2026-09-19T09:59:00.000Z"
PRODUCT_COMPLETED_AT = "2026-09-19T10:01:00.000Z"


def _write_private_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    path.chmod(0o600)


def _product_final_cut_bindings(
    bindings: dict[str, dict[str, str]],
) -> dict[str, dict[str, str]]:
    return {
        profile: {
            "resultDigest": binding["result_digest"],
            "resetId": binding["reset_id"],
            "schemaAttestationDigest": binding[
                "schema_attestation_digest"
            ],
            "stationRuntimeIdentity": binding[
                "station_runtime_identity"
            ],
        }
        for profile, binding in bindings.items()
    }


def _product_child(
    root: Path,
    *,
    workstream: str,
    variant: str,
    run_id: str,
    spec: result_aggregate.ChildSpec,
    runtime_manifest_digest: str | None = None,
    runtime_manifest_ref: str | None = None,
    final_cut_bindings: dict[str, dict[str, str]] | None = None,
    post_cut_epoch_id: str | None = None,
    completed_at: str = PRODUCT_COMPLETED_AT,
) -> Path:
    if runtime_manifest_digest is None or runtime_manifest_ref is None:
        manifest_path, manifest_digest = _runtime_manifest(
            root,
            run_id=run_id,
            journey_id=spec.journey_id,
            spec=spec,
            final_cut_bindings=final_cut_bindings,
            post_cut_epoch_id=post_cut_epoch_id,
            manifest_scope=variant if workstream == "W12" else None,
        )
        runtime_manifest_digest = manifest_digest
        runtime_manifest_ref = str(manifest_path)
    path = (
        root
        / workstream
        / ("product" if workstream == "W12" else "")
        / GENERATION
        / variant
        / run_id
        / "result.json"
    )
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
        "completedAt": completed_at,
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
    if final_cut_bindings is not None:
        if post_cut_epoch_id is None:
            raise AssertionError("post_cut_epoch_id is required")
        value["finalCutBindings"] = _product_final_cut_bindings(
            final_cut_bindings
        )
        value["postCutEpochId"] = post_cut_epoch_id
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
    final_cut_bindings: dict[str, dict[str, str]] | None = None,
    post_cut_epoch_id: str | None = None,
    manifest_scope: str | None = None,
) -> tuple[Path, str]:
    path = root / "runtime-owner" / run_id
    if manifest_scope is not None:
        path /= manifest_scope
    path /= "runtime.json"
    fixture: dict[str, object] = {
        "schema_version": 1,
        "kind": "peers-touch-fixture-manifest",
        "fixture_set_id": post_cut_epoch_id or f"fixture-{run_id}",
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
    if final_cut_bindings is not None:
        if post_cut_epoch_id is None:
            raise AssertionError("post_cut_epoch_id is required")
        value["final_cut_bindings"] = {
            profile: dict(binding)
            for profile, binding in final_cut_bindings.items()
        }
        value["post_cut_epoch_id"] = post_cut_epoch_id
    digest = canonical_digest(value)
    value["manifest_digest"] = digest
    _write_private_json(path, value)
    return path, digest


def _fixture_manifest_digest(runtime_path: Path) -> str:
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    return str(runtime["fixture_manifest_digest"])


def _reset_child(
    root: Path,
    *,
    profile: str,
    intent: str,
    completed_at: str = FINAL_CUT_COMPLETED_AT,
) -> dict[str, str]:
    is_final_cut = intent == "FINAL_CUT"
    reset_id = f"reset-{intent.lower().replace('_', '-')}-{profile}"
    service_id = "station-four" if profile == "four" else "station-five-arm"
    runtime_identity = f"runtime-{intent.lower()}-{profile}"
    directory = (
        root
        / ("W12" if is_final_cut else "W12A")
        / ("final-cut" if is_final_cut else "activation")
        / GENERATION
        / profile
        / reset_id
    )
    attestation: dict[str, object] = {
        "schema_version": 1,
        "source_commit": GENERATION,
        "workspace_id": WORKSPACE_ID,
        "profile_id": profile,
        "deployment_environment": f"{profile}-development",
        "destructive_scope": f"{service_id}-social-private",
        "station_service_id": service_id,
        "station_peer_id": f"peer-{profile}",
        "station_runtime_identity": runtime_identity,
        "service_attestation_digest": "1" * 64,
        "reset_intent": intent,
        "reset_manifest_digest": "2" * 64,
        "completed_journal_digest": "3" * 64,
        "canonical_private_schema_digest": "4" * 64,
        "retired_columns_absent": True,
        "public_snapshot_digest": "5" * 64,
        "created_at": completed_at,
    }
    attestation["attestation_digest"] = canonical_digest(attestation)
    attestation_path = (
        directory / "canonical-private-schema-attestation.json"
    )
    _write_private_json(attestation_path, attestation)
    result: dict[str, object] = {
        "schema_version": 1,
        "kind": PROFILE_RESULT_KIND,
        "workstream_id": (
            f"W12F-{'FOUR' if profile == 'four' else 'FIVEARM'}"
            if is_final_cut
            else f"W12A-{'FOUR' if profile == 'four' else 'FIVEARM'}"
        ),
        "task_id": "W12" if is_final_cut else "W12D",
        "generation_id": GENERATION,
        "source_commit": GENERATION,
        "workspace_id": WORKSPACE_ID,
        "profile_id": profile,
        "reset_id": reset_id,
        "reset_intent": intent,
        "schema_attestation_ref": {
            "path": attestation_path.relative_to(root).as_posix(),
            "sha256": hashlib.sha256(attestation_path.read_bytes()).hexdigest(),
        },
        "schema_attestation_digest": attestation["attestation_digest"],
        "journal_state": "COMPLETE",
        "status": "PASS",
        "claim": (
            "FINAL_RESET_COMPLETE_ONLY"
            if is_final_cut
            else "CANONICAL_SCHEMA_ACTIVE_ONLY"
        ),
        "completed_at": completed_at,
    }
    result["result_digest"] = canonical_digest(result)
    _write_private_json(directory / "result.json", result)
    return {
        "result_digest": str(result["result_digest"]),
        "reset_id": reset_id,
        "schema_attestation_digest": str(
            attestation["attestation_digest"]
        ),
        "station_runtime_identity": runtime_identity,
    }


def _reset_bindings(
    root: Path,
    *,
    intent: str = "FINAL_CUT",
    completed_at: str = FINAL_CUT_COMPLETED_AT,
) -> dict[str, dict[str, str]]:
    return {
        profile: _reset_child(
            root,
            profile=profile,
            intent=intent,
            completed_at=completed_at,
        )
        for profile in ("four", "fiveArm")
    }


def _w12_product_children(
    root: Path,
    *,
    final_cut_bindings: dict[str, dict[str, str]],
    post_cut_epoch_id: str = POST_CUT_EPOCH_ID,
    completed_at: str = PRODUCT_COMPLETED_AT,
) -> dict[str, Path]:
    paths: dict[str, Path] = {}
    for variant, spec in result_aggregate.SPECS["W12"].variants.items():
        if spec is None:
            continue
        paths[variant] = _product_child(
            root,
            workstream="W12",
            variant=variant,
            run_id=W12_SUITE_RUNTIME_ID,
            spec=spec,
            final_cut_bindings=final_cut_bindings,
            post_cut_epoch_id=post_cut_epoch_id,
            completed_at=completed_at,
        )
    _write_w12_suite_runtime_report(
        root,
        suite_runtime_id=W12_SUITE_RUNTIME_ID,
        post_cut_epoch_id=post_cut_epoch_id,
        result_digests={
            variant: str(
                json.loads(path.read_text(encoding="utf-8"))["resultDigest"]
            )
            for variant, path in paths.items()
        },
    )
    return paths


def _write_w12_suite_runtime_report(
    root: Path,
    *,
    suite_runtime_id: str,
    post_cut_epoch_id: str,
    result_digests: dict[str, str],
) -> Path:
    ledger = SuiteRuntimeLedger(
        result_aggregate.W12_SUITE_RUNTIME_CONTRACT,
        suite_runtime_id=suite_runtime_id,
        source_digest=GENERATION,
        fixture_epoch=post_cut_epoch_id,
    )
    ledger.record(
        SuiteRuntimeAction.PROVISION,
        resource_id="runtime:w12",
    )
    for scenario_id in (
        result_aggregate.W12_SUITE_RUNTIME_CONTRACT.scenario_ids
    ):
        ledger.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario_id,
        )
        ledger.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario_id,
            resource_id=f"{scenario_id}:ui",
        )
        ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario_id,
            resource_id=f"{scenario_id}:receiver",
        )
        result_digest = result_digests.get(scenario_id)
        if result_digest is not None:
            ledger.record(
                SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                scenario_id=scenario_id,
                resource_id=f"scenario-result:{result_digest}",
            )
        ledger.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario_id,
        )
    ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
    path = (
        root
        / "runtime-owner"
        / suite_runtime_id
        / "suite-runtime.json"
    )
    _write_private_json(path, ledger.require_valid())
    return path


def _resign_product(path: Path, value: dict[str, object]) -> None:
    value.pop("resultDigest", None)
    value["resultDigest"] = canonical_digest(value)
    _write_private_json(path, value)


def _resign_manifest_and_product(
    product_path: Path,
    manifest: dict[str, object],
    product: dict[str, object],
) -> None:
    manifest.pop("manifest_digest", None)
    manifest["manifest_digest"] = canonical_digest(manifest)
    manifest_path = Path(str(product["runtimeManifestRef"]))
    _write_private_json(manifest_path, manifest)
    product["runtimeManifestDigest"] = manifest["manifest_digest"]
    _resign_product(product_path, product)


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
            self.assertEqual(("desktop",), tuple(spec.variants))
            desktop = spec.variants["desktop"]
            assert desktop is not None
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
            result = self.owner(root).aggregate(
                workstream="W7",
                required=("desktop",),
                generation_id=GENERATION,
            )

            self.assertEqual(
                child_path.relative_to(root).as_posix(),
                result["children"][0]["resultRef"]["path"],
            )

    def test_w12_aggregate_binds_final_cut_and_post_cut_epoch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bindings = _reset_bindings(root)
            _w12_product_children(root, final_cut_bindings=bindings)

            result = self.owner(root).aggregate(
                workstream="W12",
                required=tuple(result_aggregate.SPECS["W12"].variants),
                generation_id=GENERATION,
            )

            self.assertEqual("PASS", result["result"])
            self.assertEqual(POST_CUT_EPOCH_ID, result["postCutEpochId"])
            self.assertEqual(
                _product_final_cut_bindings(bindings),
                result["finalCutBindings"],
            )
            self.assertEqual(
                W12_SUITE_RUNTIME_ID,
                result["suiteRuntime"]["suiteRuntimeId"],
            )
            self.assertEqual(
                POST_CUT_EPOCH_ID,
                result["suiteRuntime"]["fixtureEpoch"],
            )
            self.assertEqual(
                json.loads(
                    (
                        root
                        / "runtime-owner"
                        / W12_SUITE_RUNTIME_ID
                        / "suite-runtime.json"
                    ).read_text(encoding="utf-8")
                )["reportDigest"],
                result["suiteRuntime"]["reportDigest"],
            )
            self.assertEqual(
                list(result_aggregate.SPECS["W12"].variants),
                [child["variantId"] for child in result["children"]],
            )

    def test_w12_rejects_missing_suite_runtime_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bindings = _reset_bindings(root)
            _w12_product_children(root, final_cut_bindings=bindings)
            (
                root
                / "runtime-owner"
                / W12_SUITE_RUNTIME_ID
                / "suite-runtime.json"
            ).unlink()

            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "Suite Runtime report is invalid",
            ):
                self.owner(root).aggregate(
                    workstream="W12",
                    required=tuple(result_aggregate.SPECS["W12"].variants),
                    generation_id=GENERATION,
                )

    def test_w12_rejects_suite_runtime_report_without_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bindings = _reset_bindings(root)
            _w12_product_children(root, final_cut_bindings=bindings)
            report_path = (
                root
                / "runtime-owner"
                / W12_SUITE_RUNTIME_ID
                / "suite-runtime.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["events"] = report["events"][:-1]
            report["reportDigest"] = canonical_digest(
                {
                    key: value
                    for key, value in report.items()
                    if key != "reportDigest"
                }
            )
            _write_private_json(report_path, report)

            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "Suite Runtime report is invalid",
            ):
                self.owner(root).aggregate(
                    workstream="W12",
                    required=tuple(result_aggregate.SPECS["W12"].variants),
                    generation_id=GENERATION,
                )

    def test_w12_rejects_suite_runtime_identity_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bindings = _reset_bindings(root)
            _w12_product_children(root, final_cut_bindings=bindings)
            report_path = (
                root
                / "runtime-owner"
                / W12_SUITE_RUNTIME_ID
                / "suite-runtime.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["suiteRuntimeId"] = "another-suite-runtime"
            report["reportDigest"] = canonical_digest(
                {
                    key: value
                    for key, value in report.items()
                    if key != "reportDigest"
                }
            )
            _write_private_json(report_path, report)

            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "Suite Runtime report binding is invalid",
            ):
                self.owner(root).aggregate(
                    workstream="W12",
                    required=tuple(result_aggregate.SPECS["W12"].variants),
                    generation_id=GENERATION,
                )

    def test_w12_rejects_unbound_suite_runtime_observations(self) -> None:
        for mutation in ("missing", "wrong", "swapped"):
            with (
                self.subTest(mutation=mutation),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                bindings = _reset_bindings(root)
                paths = _w12_product_children(
                    root,
                    final_cut_bindings=bindings,
                )
                result_digests = {
                    variant: str(
                        json.loads(path.read_text(encoding="utf-8"))[
                            "resultDigest"
                        ]
                    )
                    for variant, path in paths.items()
                }
                if mutation == "missing":
                    result_digests.pop("desktop")
                elif mutation == "wrong":
                    result_digests["desktop"] = "f" * 64
                else:
                    result_digests["desktop"], result_digests["ios"] = (
                        result_digests["ios"],
                        result_digests["desktop"],
                    )
                _write_w12_suite_runtime_report(
                    root,
                    suite_runtime_id=W12_SUITE_RUNTIME_ID,
                    post_cut_epoch_id=POST_CUT_EPOCH_ID,
                    result_digests=result_digests,
                )

                with self.assertRaisesRegex(
                    result_aggregate.AggregateError,
                    "report child bindings are invalid",
                ):
                    self.owner(root).aggregate(
                        workstream="W12",
                        required=tuple(
                            result_aggregate.SPECS["W12"].variants
                        ),
                        generation_id=GENERATION,
                    )

    def test_w12_rejects_duplicate_suite_runtime_observation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bindings = _reset_bindings(root)
            _w12_product_children(root, final_cut_bindings=bindings)
            report_path = (
                root
                / "runtime-owner"
                / W12_SUITE_RUNTIME_ID
                / "suite-runtime.json"
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            observation_index = next(
                index
                for index, event in enumerate(report["events"])
                if event["action"] == "supporting-observation"
            )
            report["events"].insert(
                observation_index + 1,
                dict(report["events"][observation_index]),
            )
            for sequence, event in enumerate(report["events"], start=1):
                event["sequence"] = sequence
            report["reportDigest"] = canonical_digest(
                {
                    key: value
                    for key, value in report.items()
                    if key != "reportDigest"
                }
            )
            _write_private_json(report_path, report)

            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "report child bindings are invalid",
            ):
                self.owner(root).aggregate(
                    workstream="W12",
                    required=tuple(result_aggregate.SPECS["W12"].variants),
                    generation_id=GENERATION,
                )

    def test_w12_rejects_missing_product_or_manifest_binding(self) -> None:
        for target in ("product", "manifest"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bindings = _reset_bindings(root)
                paths = _w12_product_children(
                    root,
                    final_cut_bindings=bindings,
                )
                product_path = paths["desktop"]
                product = json.loads(
                    product_path.read_text(encoding="utf-8")
                )
                if target == "product":
                    product.pop("finalCutBindings")
                    _resign_product(product_path, product)
                else:
                    manifest_path = Path(str(product["runtimeManifestRef"]))
                    manifest = json.loads(
                        manifest_path.read_text(encoding="utf-8")
                    )
                    manifest.pop("final_cut_bindings")
                    _resign_manifest_and_product(
                        product_path,
                        manifest,
                        product,
                    )

                with self.assertRaisesRegex(
                    result_aggregate.AggregateError,
                    "final-cut binding is invalid",
                ):
                    self.owner(root).aggregate(
                        workstream="W12",
                        required=tuple(
                            result_aggregate.SPECS["W12"].variants
                        ),
                        generation_id=GENERATION,
                    )

    def test_w12_rejects_wrong_final_cut_binding(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bindings = _reset_bindings(root)
            paths = _w12_product_children(
                root,
                final_cut_bindings=bindings,
            )
            product_path = paths["desktop"]
            product = json.loads(product_path.read_text(encoding="utf-8"))
            manifest_path = Path(str(product["runtimeManifestRef"]))
            manifest = json.loads(
                manifest_path.read_text(encoding="utf-8")
            )
            product["finalCutBindings"]["four"][
                "stationRuntimeIdentity"
            ] = "wrong-runtime-four"
            manifest["final_cut_bindings"]["four"][
                "station_runtime_identity"
            ] = "wrong-runtime-four"
            _resign_manifest_and_product(product_path, manifest, product)

            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "final-cut binding is invalid",
            ):
                self.owner(root).aggregate(
                    workstream="W12",
                    required=tuple(result_aggregate.SPECS["W12"].variants),
                    generation_id=GENERATION,
                )

    def test_w12_rejects_activation_binding_substitution(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            final_cut_bindings = _reset_bindings(root)
            activation_bindings = _reset_bindings(
                root,
                intent="SCHEMA_ACTIVATION",
            )
            paths = _w12_product_children(
                root,
                final_cut_bindings=final_cut_bindings,
            )
            product_path = paths["desktop"]
            product = json.loads(product_path.read_text(encoding="utf-8"))
            manifest_path = Path(str(product["runtimeManifestRef"]))
            manifest = json.loads(
                manifest_path.read_text(encoding="utf-8")
            )
            product["finalCutBindings"] = _product_final_cut_bindings(
                activation_bindings
            )
            manifest["final_cut_bindings"] = activation_bindings
            _resign_manifest_and_product(product_path, manifest, product)

            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "final-cut binding is invalid",
            ):
                self.owner(root).aggregate(
                    workstream="W12",
                    required=tuple(result_aggregate.SPECS["W12"].variants),
                    generation_id=GENERATION,
                )

    def test_w12_rejects_non_unified_post_cut_epoch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bindings = _reset_bindings(root)
            paths = _w12_product_children(
                root,
                final_cut_bindings=bindings,
            )
            product_path = paths["ios"]
            product = json.loads(product_path.read_text(encoding="utf-8"))
            manifest_path = Path(str(product["runtimeManifestRef"]))
            manifest = json.loads(
                manifest_path.read_text(encoding="utf-8")
            )
            product["postCutEpochId"] = "another-post-cut-epoch"
            manifest["post_cut_epoch_id"] = "another-post-cut-epoch"
            _resign_manifest_and_product(product_path, manifest, product)

            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "do not share postCutEpochId",
            ):
                self.owner(root).aggregate(
                    workstream="W12",
                    required=tuple(result_aggregate.SPECS["W12"].variants),
                    generation_id=GENERATION,
                )

    def test_w12_rejects_product_before_final_cut_completion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bindings = _reset_bindings(
                root,
                completed_at=PRODUCT_COMPLETED_AT,
            )
            _w12_product_children(root, final_cut_bindings=bindings)

            with self.assertRaisesRegex(
                result_aggregate.AggregateError,
                "final-cut completion must precede product child start",
            ):
                self.owner(root).aggregate(
                    workstream="W12",
                    required=tuple(result_aggregate.SPECS["W12"].variants),
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
