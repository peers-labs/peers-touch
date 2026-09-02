"""Adversarial tests for the Mobile cleanup evidence finalizer."""

import hashlib
import json
import unittest


from tooling.acceptance.gates.mobile.cleanup_evidence_finalizer import (
    FINALIZER_ID,
    REQUIRED_CLEANUP_ROLE_KINDS,
    build_child_outcome,
)


def _make_artifact(role_name, discriminator=None, kind=None, extra_fields=None):
    value = {"kind": kind or REQUIRED_CLEANUP_ROLE_KINDS.get(role_name, "unknown")}
    if extra_fields:
        value.update(extra_fields)
    return {
        "roleName": role_name,
        "discriminator": discriminator,
        "ref": {"workspaceId": "ws", "gateId": "g", "runId": "r", "path": "p"},
        "payload": {"value": value, "payloadDigest": "abc123"},
        "payloadDigest": "abc123",
    }


def _make_snapshot(artifacts, snapshot_digest="aaa"):
    return {
        "workspaceId": "ws",
        "gateId": "mobile-native-access-e2e",
        "evidenceRunId": "run-1",
        "snapshotDigest": snapshot_digest,
        "evaluationTime": "2026-09-02T00:00:00+00:00",
        "artifacts": artifacts,
        "runtimeManifestRef": {"workspaceId": "ws", "gateId": "g", "runId": "r", "path": "m"},
        "sourceCommit": "abc",
        "workspaceDigest": "def",
        "canonicalWorktreeHash": "ghi",
    }


def _make_input(snapshot):
    return {
        "invocation": {
            "invocationDigest": "inv-digest",
            "workspaceId": "ws",
            "gateId": "mobile-native-access-e2e",
            "evidenceRunId": "run-1",
        },
        "context": {
            "primaryResultDigest": "primary-digest",
        },
        "snapshot": snapshot,
        "finalizerInputDigest": "input-digest",
    }


class TestCleanupEvidenceFinalizer(unittest.TestCase):

    def test_validated_with_all_required_roles(self):
        artifacts = [
            _make_artifact("mobile-lease-outcome", "alice"),
            _make_artifact("mobile-redaction-audit", "alice"),
            _make_artifact("station-post-cleanup-proof", "primary"),
        ]
        snapshot = _make_snapshot(artifacts)
        result = build_child_outcome(_make_input(snapshot))
        self.assertEqual(result["status"], "VALIDATED")
        self.assertIsNone(result["failureCode"])
        self.assertIsNone(result["diagnostic"])
        self.assertEqual(len(result["validatedRoleInstances"]), 3)

    def test_rejected_missing_role(self):
        artifacts = [
            _make_artifact("mobile-lease-outcome", "alice"),
            _make_artifact("mobile-redaction-audit", "alice"),
        ]
        snapshot = _make_snapshot(artifacts)
        result = build_child_outcome(_make_input(snapshot))
        self.assertEqual(result["status"], "REJECTED")
        self.assertEqual(result["failureCode"], "FINALIZER_REJECTED")
        self.assertIn("station-post-cleanup-proof", result["diagnostic"])

    def test_rejected_empty_artifacts(self):
        snapshot = _make_snapshot([])
        result = build_child_outcome(_make_input(snapshot))
        self.assertEqual(result["status"], "REJECTED")
        self.assertIn("no artifacts", result["diagnostic"])

    def test_rejected_null_payload(self):
        artifacts = [
            _make_artifact("mobile-lease-outcome", "alice"),
            _make_artifact("mobile-redaction-audit", "alice"),
            {
                "roleName": "station-post-cleanup-proof",
                "discriminator": "primary",
                "ref": {"workspaceId": "ws", "gateId": "g", "runId": "r", "path": "p"},
                "payload": None,
                "payloadDigest": None,
            },
        ]
        snapshot = _make_snapshot(artifacts)
        result = build_child_outcome(_make_input(snapshot))
        self.assertEqual(result["status"], "REJECTED")
        self.assertIn("no payload", result["diagnostic"])

    def test_rejected_wrong_kind(self):
        artifacts = [
            _make_artifact("mobile-lease-outcome", "alice"),
            _make_artifact("mobile-redaction-audit", "alice"),
            _make_artifact("station-post-cleanup-proof", "primary", kind="wrong-kind"),
        ]
        snapshot = _make_snapshot(artifacts)
        result = build_child_outcome(_make_input(snapshot))
        self.assertEqual(result["status"], "REJECTED")
        self.assertIn("kind mismatch", result["diagnostic"])

    def test_rejected_non_object_value(self):
        artifacts = [
            _make_artifact("mobile-lease-outcome", "alice"),
            _make_artifact("mobile-redaction-audit", "alice"),
            {
                "roleName": "station-post-cleanup-proof",
                "discriminator": "primary",
                "ref": {"workspaceId": "ws", "gateId": "g", "runId": "r", "path": "p"},
                "payload": {"value": "not-an-object", "payloadDigest": "x"},
                "payloadDigest": "x",
            },
        ]
        snapshot = _make_snapshot(artifacts)
        result = build_child_outcome(_make_input(snapshot))
        self.assertEqual(result["status"], "REJECTED")
        self.assertIn("not an object", result["diagnostic"])

    def test_validated_multiple_discriminators(self):
        artifacts = [
            _make_artifact("mobile-lease-outcome", "alice"),
            _make_artifact("mobile-lease-outcome", "bob"),
            _make_artifact("mobile-redaction-audit", "alice"),
            _make_artifact("station-post-cleanup-proof", "primary"),
            _make_artifact("station-post-cleanup-proof", "secondary"),
        ]
        snapshot = _make_snapshot(artifacts)
        result = build_child_outcome(_make_input(snapshot))
        self.assertEqual(result["status"], "VALIDATED")
        self.assertEqual(len(result["validatedRoleInstances"]), 5)

    def test_outcome_has_digest(self):
        artifacts = [
            _make_artifact("mobile-lease-outcome", "alice"),
            _make_artifact("mobile-redaction-audit", "alice"),
            _make_artifact("station-post-cleanup-proof", "primary"),
        ]
        snapshot = _make_snapshot(artifacts)
        result = build_child_outcome(_make_input(snapshot))
        self.assertIn("childOutcomeDigest", result)
        self.assertEqual(len(result["childOutcomeDigest"]), 64)

    def test_extra_roles_ignored(self):
        artifacts = [
            _make_artifact("mobile-lease-outcome", "alice"),
            _make_artifact("mobile-redaction-audit", "alice"),
            _make_artifact("station-post-cleanup-proof", "primary"),
            _make_artifact("some-other-role", "extra"),
        ]
        snapshot = _make_snapshot(artifacts)
        result = build_child_outcome(_make_input(snapshot))
        self.assertEqual(result["status"], "VALIDATED")
        self.assertEqual(len(result["validatedRoleInstances"]), 3)

    def test_finalizer_id_correct(self):
        self.assertEqual(
            FINALIZER_ID, "mobile.native.oauth-cleanup-evidence"
        )

    def test_required_roles_match_proof_contract(self):
        self.assertEqual(
            set(REQUIRED_CLEANUP_ROLE_KINDS),
            {"mobile-lease-outcome", "mobile-redaction-audit", "station-post-cleanup-proof"},
        )


if __name__ == "__main__":
    unittest.main()
