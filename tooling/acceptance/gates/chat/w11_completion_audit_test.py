from __future__ import annotations

import json
import unittest
from pathlib import Path

from tooling.acceptance.core.errors import EvidenceManifestInvalid
from tooling.acceptance.core.evidence_store import workspace_id
from tooling.acceptance.gates.chat.w11_completion_audit import (
    check_native_report_identity,
    check_report_status,
    commit_identities_match,
    immutable_results_by_gate,
    load_aggregate_source_identity,
    load_gate_evidence,
    runtime_cell_gates,
)


class _Store:
    workspace_id = "0123456789abcdef"

    def __init__(
        self,
        manifest: dict,
        report: dict | None = None,
        runtime_manifest: dict | None = None,
        environment_manifest: dict | None = None,
        station_attestation: dict | None = None,
    ) -> None:
        self.manifest = manifest
        self.report = report
        self.runtime_manifest = runtime_manifest
        self.environment_manifest = environment_manifest
        self.station_attestation = station_attestation

    def read_json(self, reference: object) -> dict:
        path = getattr(reference, "path", "")
        if path == "manifest.json":
            return self.manifest
        if path == "runtime/runtime-cell-manifest.json":
            if self.runtime_manifest is None:
                raise AssertionError("runtime manifest unavailable")
            return self.runtime_manifest
        if path == "runtime/environment-manifest.json":
            if self.environment_manifest is None:
                raise AssertionError("environment manifest unavailable")
            return self.environment_manifest
        if path == "runtime/services/station/attestation.json":
            if self.station_attestation is None:
                raise AssertionError("Station attestation unavailable")
            return self.station_attestation
        if self.report is None:
            raise AssertionError("report unavailable")
        return self.report


def _source() -> dict[str, str]:
    return {
        "commit": "a" * 40,
        "workspaceDigest": "clean",
        "canonicalWorktreeHash": "0123456789abcdef",
    }


class CommitIdentityTests(unittest.TestCase):
    def test_accepts_full_and_abbreviated_commit_identity(self) -> None:
        full = "a" * 40
        self.assertTrue(commit_identities_match(full, full[:12]))
        self.assertTrue(commit_identities_match(full[:12], full))

    def test_rejects_invalid_or_different_commit_identity(self) -> None:
        self.assertFalse(commit_identities_match("a" * 40, "b" * 12))
        self.assertFalse(commit_identities_match("a" * 40, "not-a-commit"))
        self.assertFalse(commit_identities_match("a" * 6, "a" * 40))


def _report() -> dict:
    binary_digest = "d" * 64
    return {
        "artifactKind": "acceptance-gate-evidence-report",
        "gateId": "chat-native-product-closure-e2e",
        "status": "PASS",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "sampleEmissionAllowed": True,
        "assertions": [{"name": "journey", "passed": True}],
        "runtime": {
            "runtimeCell": "desktop-linux-native",
            "runtimeCellRunId": "cell-run-a",
            "sourceIdentity": {
                "orchestrator": _source(),
                "station": {
                    "attestationArtifact": _station_reference(),
                    "deploymentEnvironment": "chat-native-disposable-station",
                    "endpoint": "http://station.example:18132",
                    "kind": "station",
                    "liveCommit": _source()["commit"],
                    "protocolDigest": "3" * 64,
                    "workspaceDigest": "clean",
                },
                "stationLive": {"build_commit": _source()["commit"]},
                "binary": {
                    "sourceCommit": _source()["commit"],
                    "sha256": binary_digest,
                },
                "runtimeCell": {
                    "artifactKind": "acceptance-runtime-cell-manifest",
                    "cellId": "desktop-linux-native",
                    "gateId": "chat-native-product-closure-e2e",
                    "runId": "cell-run-a",
                    "state": "LEASED",
                    "source": {
                        "mode": "git-object-sync",
                        "commit": _source()["commit"],
                        "workspaceDigest": "clean",
                        "binarySha256": binary_digest,
                        "remoteCheckoutClean": True,
                        "remoteSourceDigest": "e" * 64,
                    },
                    "platform": {
                        "os": "linux",
                        "architecture": "x86_64",
                        "isolationKind": "container",
                        "imageDigest": "f" * 64,
                    },
                    "transport": {
                        "kind": "ssh",
                        "hostIdentitySha256": "1" * 64,
                        "hostKeySha256": "2" * 64,
                    },
                },
            },
        },
    }


def _run_id() -> str:
    return "20260829T120000000000Z-" + ("b" * 32)


def _artifact_reference(path: str, sha256: str) -> dict:
    return {
        "artifactKind": "acceptance-artifact-ref",
        "workspaceId": "0123456789abcdef",
        "gateId": "chat-native-product-closure-e2e",
        "runId": _run_id(),
        "path": path,
        "sha256": sha256,
        "mediaType": "application/json",
    }


def _station_reference() -> dict:
    return _artifact_reference(
        "runtime/services/station/attestation.json",
        "5" * 64,
    )


def _station_attestation() -> dict:
    return {
        "artifactKind": "service-deployment-attestation",
        "serviceId": "station",
        "serviceKind": "station",
        "deploymentEnvironment": "chat-native-disposable-station",
        "endpoint": "http://station.example:18132",
        "commit": _source()["commit"],
        "workspaceDigest": "clean",
        "protocolDigest": "3" * 64,
        "liveMetadata": {"buildCommit": _source()["commit"]},
    }


def _immutable_station_attestation() -> dict:
    return {
        **_station_attestation(),
        "_artifact_ref": _station_reference(),
    }


def _environment_manifest() -> dict:
    return {
        "artifactKind": "acceptance-runtime-manifest",
        "gateId": "chat-native-product-closure-e2e",
        "state": "FIXTURE_READY",
        "source": _source(),
        "services": {
            "station": {
                "deploymentEnvironment": "chat-native-disposable-station",
                "endpoint": "http://station.example:18132",
                "kind": "station",
                "liveCommit": _source()["commit"],
                "protocolDigest": "3" * 64,
                "workspaceDigest": "clean",
                "attestationArtifact": _station_reference(),
            }
        },
    }


def _manifest() -> dict:
    report = _report()
    reference = _artifact_reference("reports/product.json", "c" * 64)
    runtime_reference = _artifact_reference(
        "runtime/runtime-cell-manifest.json",
        "4" * 64,
    )
    environment_reference = _artifact_reference(
        "runtime/environment-manifest.json",
        "6" * 64,
    )
    runtime_manifest_payload = {
        **report["runtime"]["sourceIdentity"]["runtimeCell"],
        "_manifest_ref": runtime_reference,
    }
    return {
        "artifactKind": "acceptance-run-manifest",
        "workspaceId": "0123456789abcdef",
        "gateId": "chat-native-product-closure-e2e",
        "runId": reference["runId"],
        "source": _source(),
        "redaction": {"status": "passed"},
        "result": {
            "status": "passed",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "runtimeCell": "desktop-linux-native",
            "manifest": {
                **_environment_manifest(),
                "_manifest_ref": environment_reference,
            },
            "runtimeCellManifest": runtime_manifest_payload,
            "secretScan": {"status": "passed"},
            "sourceArtifactKind": "acceptance-gate-evidence-report",
            "sourceArtifact": reference,
        },
        "artifacts": {
            "report": reference,
            "environment-manifest": environment_reference,
            "runtime-cell-manifest": runtime_reference,
            "station-attestation": _station_reference(),
        },
    }


def _aggregate_result() -> dict:
    return {
        "id": "chat-native-product-closure-e2e",
        "runManifest": _artifact_reference("manifest.json", "7" * 64),
    }


def _immutable_runtime_manifest() -> dict:
    return {
        **_report()["runtime"]["sourceIdentity"]["runtimeCell"],
        "display": {
            "sessionType": "x11",
            "displayId": ":0",
            "connectedOutput": True,
        },
        "nativeAdapter": {
            "inputBackend": "x11-xtest",
            "windowBackend": "x11-ewmh",
            "screenshotBackend": "x11-root",
        },
        "lease": {
            "ownerRunId": "cell-run-a",
            "cleanupRegistered": True,
        },
    }


class W11CompletionAuditTests(unittest.TestCase):
    def test_aggregate_source_identity_requires_clean_complete_snapshot(self) -> None:
        self.assertEqual(
            load_aggregate_source_identity(json.dumps(_source())),
            _source(),
        )
        for invalid in (
            "",
            "{",
            json.dumps({"commit": "a" * 40}),
            json.dumps({**_source(), "workspaceDigest": "sha256:dirty"}),
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(
                    AssertionError,
                    "aggregate source identity",
                ):
                    load_aggregate_source_identity(invalid)

    def test_accepts_current_source_linux_evidence(self) -> None:
        manifest = _manifest()
        self.assertNotEqual(
            manifest["result"]["runtimeCellManifest"],
            _immutable_runtime_manifest(),
        )
        accepted = load_gate_evidence(
            _Store(
                manifest,
                _report(),
                _immutable_runtime_manifest(),
                _environment_manifest(),
                _station_attestation(),
            ),
            "chat-native-product-closure-e2e",
            aggregate_result=_aggregate_result(),
            expected_source=_source(),
            runtime_cell="desktop-linux-native",
            require_report=True,
        )

        self.assertEqual(accepted["runtimeCell"], "desktop-linux-native")
        self.assertIn("sourceArtifact", accepted)

    def test_rejects_stale_source(self) -> None:
        manifest = _manifest()
        manifest["source"] = {**_source(), "commit": "d" * 40}

        with self.assertRaisesRegex(AssertionError, "current source"):
            load_gate_evidence(
                _Store(
                    manifest,
                    _report(),
                    _immutable_runtime_manifest(),
                    _environment_manifest(),
                    _station_attestation(),
                ),
                "chat-native-product-closure-e2e",
                aggregate_result=_aggregate_result(),
                expected_source=_source(),
                runtime_cell="desktop-linux-native",
                require_report=True,
            )

    def test_rejects_latest_pointer_substitution_without_immutable_ref(self) -> None:
        with self.assertRaisesRegex(
            EvidenceManifestInvalid,
            "artifact reference",
        ):
            load_gate_evidence(
                _Store(
                    _manifest(),
                    _report(),
                    _immutable_runtime_manifest(),
                    _environment_manifest(),
                    _station_attestation(),
                ),
                "chat-native-product-closure-e2e",
                aggregate_result={"id": "chat-native-product-closure-e2e"},
                expected_source=_source(),
                runtime_cell="desktop-linux-native",
                require_report=True,
            )

    def test_rejects_missing_canonical_report(self) -> None:
        manifest = _manifest()
        manifest["result"].pop("sourceArtifact")

        with self.assertRaisesRegex(AssertionError, "canonical evidence report"):
            load_gate_evidence(
                _Store(
                    manifest,
                    _report(),
                    _immutable_runtime_manifest(),
                    _environment_manifest(),
                    _station_attestation(),
                ),
                "chat-native-product-closure-e2e",
                aggregate_result=_aggregate_result(),
                expected_source=_source(),
                runtime_cell="desktop-linux-native",
                require_report=True,
            )

    def test_rejects_wrong_runtime_cell(self) -> None:
        manifest = _manifest()
        manifest["result"]["runtimeCell"] = "desktop-macos-native"

        with self.assertRaisesRegex(AssertionError, "runtime cell"):
            load_gate_evidence(
                _Store(
                    manifest,
                    _report(),
                    _immutable_runtime_manifest(),
                    _environment_manifest(),
                    _station_attestation(),
                ),
                "chat-native-product-closure-e2e",
                aggregate_result=_aggregate_result(),
                expected_source=_source(),
                runtime_cell="desktop-linux-native",
                require_report=True,
            )

    def test_rejects_missing_immutable_runtime_manifest_reference(self) -> None:
        manifest = _manifest()
        manifest["result"]["runtimeCellManifest"].pop("_manifest_ref")

        with self.assertRaisesRegex(
            AssertionError,
            "no immutable artifact reference",
        ):
            load_gate_evidence(
                _Store(
                    manifest,
                    _report(),
                    _immutable_runtime_manifest(),
                    _environment_manifest(),
                    _station_attestation(),
                ),
                "chat-native-product-closure-e2e",
                aggregate_result=_aggregate_result(),
                expected_source=_source(),
                runtime_cell="desktop-linux-native",
                require_report=True,
            )

    def test_rejects_runtime_identity_changed_in_immutable_artifact(self) -> None:
        immutable = _immutable_runtime_manifest()
        immutable["source"]["commit"] = "8" * 40

        with self.assertRaisesRegex(
            AssertionError,
            "runner runtime-cell manifest identity mismatch",
        ):
            load_gate_evidence(
                _Store(
                    _manifest(),
                    _report(),
                    immutable,
                    _environment_manifest(),
                    _station_attestation(),
                ),
                "chat-native-product-closure-e2e",
                aggregate_result=_aggregate_result(),
                expected_source=_source(),
                runtime_cell="desktop-linux-native",
                require_report=True,
            )

    def test_rejects_malformed_or_failed_assertion(self) -> None:
        report = _report()
        report["assertions"] = [{"name": "journey", "passed": False}, "bad"]

        errors = check_report_status(
            report,
            "chat-native-product-closure-e2e",
        )

        self.assertTrue(
            any("failed or malformed assertions" in error for error in errors)
        )

    def test_rejects_report_with_stale_internal_source_identity(self) -> None:
        report = _report()
        report["runtime"]["sourceIdentity"]["orchestrator"]["commit"] = "9" * 40

        errors = check_native_report_identity(
            report,
            "chat-native-product-closure-e2e",
            expected_source=_source(),
            runtime_cell="desktop-linux-native",
            expected_runtime_manifest=report["runtime"]["sourceIdentity"][
                "runtimeCell"
            ],
            expected_station_attestation=_immutable_station_attestation(),
        )

        self.assertIn(
            "chat-native-product-closure-e2e: report orchestrator source identity mismatch",
            errors,
        )

    def test_accepts_path_bound_report_source_identity(self) -> None:
        report = _report()
        worktree = "/workspace/peers-group-chat"
        expected_source = {
            **_source(),
            "canonicalWorktreeHash": workspace_id(Path(worktree)),
        }
        report["runtime"]["sourceIdentity"]["orchestrator"] = {
            "commit": expected_source["commit"],
            "workspaceDigest": expected_source["workspaceDigest"],
            "worktree": worktree,
        }

        errors = check_native_report_identity(
            report,
            "chat-native-product-closure-e2e",
            expected_source=expected_source,
            runtime_cell="desktop-linux-native",
            expected_runtime_manifest=report["runtime"]["sourceIdentity"][
                "runtimeCell"
            ],
            expected_station_attestation=_immutable_station_attestation(),
        )

        self.assertNotIn(
            "chat-native-product-closure-e2e: report orchestrator source identity mismatch",
            errors,
        )

    def test_rejects_path_bound_report_from_another_worktree(self) -> None:
        report = _report()
        report["runtime"]["sourceIdentity"]["orchestrator"] = {
            "commit": _source()["commit"],
            "workspaceDigest": _source()["workspaceDigest"],
            "worktree": "/workspace/another-worktree",
        }

        errors = check_native_report_identity(
            report,
            "chat-native-product-closure-e2e",
            expected_source={
                **_source(),
                "canonicalWorktreeHash": workspace_id(
                    Path("/workspace/peers-group-chat")
                ),
            },
            runtime_cell="desktop-linux-native",
            expected_runtime_manifest=report["runtime"]["sourceIdentity"][
                "runtimeCell"
            ],
            expected_station_attestation=_immutable_station_attestation(),
        )

        self.assertIn(
            "chat-native-product-closure-e2e: report orchestrator source identity mismatch",
            errors,
        )

    def test_rejects_report_with_mismatched_runtime_cell_run(self) -> None:
        report = _report()
        report["runtime"]["runtimeCellRunId"] = "cell-run-b"

        errors = check_native_report_identity(
            report,
            "chat-native-product-closure-e2e",
            expected_source=_source(),
            runtime_cell="desktop-linux-native",
            expected_runtime_manifest=report["runtime"]["sourceIdentity"][
                "runtimeCell"
            ],
            expected_station_attestation=_immutable_station_attestation(),
        )

        self.assertIn(
            "chat-native-product-closure-e2e: report runtime-cell manifest identity mismatch",
            errors,
        )

    def test_rejects_report_not_bound_to_runner_runtime_manifest(self) -> None:
        report = _report()
        runner_manifest = dict(
            report["runtime"]["sourceIdentity"]["runtimeCell"]
        )
        runner_manifest["runId"] = "cell-run-b"

        errors = check_native_report_identity(
            report,
            "chat-native-product-closure-e2e",
            expected_source=_source(),
            runtime_cell="desktop-linux-native",
            expected_runtime_manifest=runner_manifest,
            expected_station_attestation=_immutable_station_attestation(),
        )

        self.assertIn(
            "chat-native-product-closure-e2e: report runtime-cell identity mismatch: ['runId']",
            errors,
        )

    def test_rejects_report_station_attestation_substitution(self) -> None:
        report = _report()
        report["runtime"]["sourceIdentity"]["station"]["protocolDigest"] = "9" * 64

        errors = check_native_report_identity(
            report,
            "chat-native-product-closure-e2e",
            expected_source=_source(),
            runtime_cell="desktop-linux-native",
            expected_runtime_manifest=report["runtime"]["sourceIdentity"][
                "runtimeCell"
            ],
            expected_station_attestation=_immutable_station_attestation(),
        )

        self.assertTrue(
            any("Station attestation mismatch" in error for error in errors)
        )

    def test_rejects_report_live_station_not_bound_to_current_source(self) -> None:
        report = _report()
        report["runtime"]["sourceIdentity"]["stationLive"]["build_commit"] = "9" * 40

        errors = check_native_report_identity(
            report,
            "chat-native-product-closure-e2e",
            expected_source=_source(),
            runtime_cell="desktop-linux-native",
            expected_runtime_manifest=report["runtime"]["sourceIdentity"][
                "runtimeCell"
            ],
            expected_station_attestation=_immutable_station_attestation(),
        )

        self.assertTrue(
            any("live Station identity" in error for error in errors)
        )

    def test_accepts_abbreviated_live_station_commit(self) -> None:
        report = _report()
        report["runtime"]["sourceIdentity"]["stationLive"]["build_commit"] = (
            _source()["commit"][:12]
        )

        errors = check_native_report_identity(
            report,
            "chat-native-product-closure-e2e",
            expected_source=_source(),
            runtime_cell="desktop-linux-native",
            expected_runtime_manifest=report["runtime"]["sourceIdentity"][
                "runtimeCell"
            ],
            expected_station_attestation=_immutable_station_attestation(),
        )

        self.assertEqual(errors, [])

    def test_accepts_exact_parent_aggregate_gate_union(self) -> None:
        results = immutable_results_by_gate(
            json.dumps(
                [
                    {"id": "gate-a", "runManifest": {"immutable": "a"}},
                    {"id": "gate-b", "runManifest": {"immutable": "b"}},
                    {"id": "chat-w11-forbidden-scan", "runManifest": {}},
                ]
            ),
            expected_gates={"gate-a", "gate-b"},
            allowed_supplemental_gates={"chat-w11-forbidden-scan"},
        )

        self.assertEqual(set(results), {
            "gate-a",
            "gate-b",
            "chat-w11-forbidden-scan",
        })

    def test_classifies_native_gate_from_catalog_not_name(self) -> None:
        gates = runtime_cell_gates(
            {
                "chat-contact-message-resilience-e2e",
                "station-messaging-unit",
            },
            runtime_cell="desktop-linux-native",
        )

        self.assertEqual(gates, {"chat-contact-message-resilience-e2e"})

    def test_rejects_parent_aggregate_missing_canonical_gate(self) -> None:
        with self.assertRaisesRegex(AssertionError, "missing=\\['gate-b'\\]"):
            immutable_results_by_gate(
                json.dumps([{"id": "gate-a", "runManifest": {}}]),
                expected_gates={"gate-a", "gate-b"},
                allowed_supplemental_gates=set(),
            )

    def test_rejects_parent_aggregate_with_unexpected_gate(self) -> None:
        with self.assertRaisesRegex(AssertionError, "unexpected=\\['stale-gate'\\]"):
            immutable_results_by_gate(
                json.dumps(
                    [
                        {"id": "gate-a", "runManifest": {}},
                        {"id": "stale-gate", "runManifest": {}},
                    ]
                ),
                expected_gates={"gate-a"},
                allowed_supplemental_gates=set(),
            )

    def test_rejects_parent_aggregate_duplicate_gate(self) -> None:
        with self.assertRaisesRegex(AssertionError, "duplicate Gate"):
            immutable_results_by_gate(
                json.dumps(
                    [
                        {"id": "gate-a", "runManifest": {}},
                        {"id": "gate-a", "runManifest": {}},
                    ]
                ),
                expected_gates={"gate-a"},
                allowed_supplemental_gates=set(),
            )


if __name__ == "__main__":
    unittest.main()
