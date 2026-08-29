from __future__ import annotations

import unittest

from tooling.acceptance.gates.chat.w11_completion_audit import (
    check_native_report_identity,
    check_report_status,
    load_latest_gate_evidence,
)


class _Store:
    workspace_id = "0123456789abcdef"

    def __init__(
        self,
        manifest: dict,
        report: dict | None = None,
        runtime_manifest: dict | None = None,
    ) -> None:
        self.manifest = manifest
        self.report = report
        self.runtime_manifest = runtime_manifest

    def latest(self, gate_id: str, *, runtime_cell: str | None = None) -> dict:
        del gate_id, runtime_cell
        return self.manifest

    def read_json(self, reference: object) -> dict:
        path = getattr(reference, "path", "")
        if path == "runtime/runtime-cell-manifest.json":
            if self.runtime_manifest is None:
                raise AssertionError("runtime manifest unavailable")
            return self.runtime_manifest
        if self.report is None:
            raise AssertionError("report unavailable")
        return self.report


def _source() -> dict[str, str]:
    return {
        "commit": "a" * 40,
        "workspaceDigest": "clean",
        "canonicalWorktreeHash": "0123456789abcdef",
    }


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


def _manifest() -> dict:
    report = _report()
    reference = {
        "artifactKind": "acceptance-artifact-ref",
        "workspaceId": "0123456789abcdef",
        "gateId": "chat-native-product-closure-e2e",
        "runId": "20260829T120000000000Z-" + ("b" * 32),
        "path": "reports/product.json",
        "sha256": "c" * 64,
        "mediaType": "application/json",
    }
    runtime_reference = {
        "artifactKind": "acceptance-artifact-ref",
        "workspaceId": "0123456789abcdef",
        "gateId": "chat-native-product-closure-e2e",
        "runId": reference["runId"],
        "path": "runtime/runtime-cell-manifest.json",
        "sha256": "4" * 64,
        "mediaType": "application/json",
    }
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
            "runtimeCellManifest": runtime_manifest_payload,
            "secretScan": {"status": "passed"},
            "sourceArtifactKind": "acceptance-gate-evidence-report",
            "sourceArtifact": reference,
        },
        "artifacts": {
            "report": reference,
            "runtime-cell-manifest": runtime_reference,
        },
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
    def test_accepts_current_source_linux_evidence(self) -> None:
        manifest = _manifest()
        self.assertNotEqual(
            manifest["result"]["runtimeCellManifest"],
            _immutable_runtime_manifest(),
        )
        accepted = load_latest_gate_evidence(
            _Store(
                manifest,
                _report(),
                _immutable_runtime_manifest(),
            ),
            "chat-native-product-closure-e2e",
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
            load_latest_gate_evidence(
                _Store(manifest, _report(), _immutable_runtime_manifest()),
                "chat-native-product-closure-e2e",
                expected_source=_source(),
                runtime_cell="desktop-linux-native",
                require_report=True,
            )

    def test_rejects_missing_canonical_report(self) -> None:
        manifest = _manifest()
        manifest["result"].pop("sourceArtifact")

        with self.assertRaisesRegex(AssertionError, "canonical evidence report"):
            load_latest_gate_evidence(
                _Store(manifest, _report(), _immutable_runtime_manifest()),
                "chat-native-product-closure-e2e",
                expected_source=_source(),
                runtime_cell="desktop-linux-native",
                require_report=True,
            )

    def test_rejects_wrong_runtime_cell(self) -> None:
        manifest = _manifest()
        manifest["result"]["runtimeCell"] = "desktop-macos-native"

        with self.assertRaisesRegex(AssertionError, "runtime cell"):
            load_latest_gate_evidence(
                _Store(manifest, _report(), _immutable_runtime_manifest()),
                "chat-native-product-closure-e2e",
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
            load_latest_gate_evidence(
                _Store(manifest, _report(), _immutable_runtime_manifest()),
                "chat-native-product-closure-e2e",
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
            load_latest_gate_evidence(
                _Store(_manifest(), _report(), immutable),
                "chat-native-product-closure-e2e",
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
        )

        self.assertIn(
            "chat-native-product-closure-e2e: report runtime-cell identity mismatch: ['runId']",
            errors,
        )


if __name__ == "__main__":
    unittest.main()
