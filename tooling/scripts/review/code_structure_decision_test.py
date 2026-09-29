#!/usr/bin/env python3

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.scripts.review import code_structure_decision as decision  # noqa: E402


TARGET = {
    "selector": {"kind": "range", "range": "HEAD"},
    "baseCommit": "abc123",
    "headCommit": "abc123",
    "source": {
        "commit": "abc123",
        "workspaceDigest": "sha256:source",
        "canonicalWorktreeHash": "workspace",
    },
    "scopeFiles": [
        {
            "path": "src/service.ts",
            "status": "REVIEW",
            "reason": "authored-source",
        }
    ],
    "reviewedFiles": ["src/service.ts"],
    "scopeId": f"sha256:{'c' * 64}",
}
RUBRIC_HASH = f"sha256:{'a' * 64}"


def finding(*, blocking: bool) -> dict[str, object]:
    return {
        "findingId": "structure-owner",
        "primaryRuleId": "STRUCT-02",
        "relatedRuleIds": ["STRUCT-05"],
        "blocking": blocking,
        "location": {
            "path": "src/service.ts",
            "lineStart": 10,
            "lineEnd": 12,
        },
        "observedStructure": "Two modules own the same transition.",
        "consequence": "A routine policy change can diverge.",
        "correction": "Move the transition into one owner.",
        "exception": "none",
    }


class DecisionSchemaTests(unittest.TestCase):
    def test_derives_verdict_and_primary_rule_sets(self) -> None:
        record = decision.build_decision(
            {"findings": [finding(blocking=True)]},
            target=TARGET,
            rubric_digest=RUBRIC_HASH,
            signals=["STRUCT-SIGNAL-FILE-LINES@src/service.ts"],
        )

        self.assertEqual(record["verdict"], "REFACTOR_REQUIRED")
        self.assertEqual(record["blockingRuleIds"], ["STRUCT-02"])
        self.assertEqual(record["suggestionRuleIds"], [])
        self.assertNotIn("STRUCT-05", record["blockingRuleIds"])
        self.assertEqual(
            record["coverage"],
            [
                {
                    "path": "src/service.ts",
                    "status": "FINDING",
                    "reason": "findings-recorded",
                    "findingIds": ["structure-owner"],
                }
            ],
        )

    def test_rejects_stale_target(self) -> None:
        record = decision.build_decision(
            {"findings": []},
            target=TARGET,
            rubric_digest=RUBRIC_HASH,
        )
        stale_target = {
            **TARGET,
            "source": {
                **TARGET["source"],
                "workspaceDigest": "sha256:changed",
            },
        }

        with self.assertRaisesRegex(
            decision.DecisionInvalid,
            "target is stale",
        ):
            decision.validate_decision(
                record,
                expected_target=stale_target,
                expected_rubric_hash=RUBRIC_HASH,
            )

    def test_rejects_inconsistent_derived_fields(self) -> None:
        record = decision.build_decision(
            {"findings": []},
            target=TARGET,
            rubric_digest=RUBRIC_HASH,
        )
        record["verdict"] = "REFACTOR_REQUIRED"

        with self.assertRaisesRegex(
            decision.DecisionInvalid,
            "derived fields disagree",
        ):
            decision.validate_decision(
                record,
                expected_target=TARGET,
                expected_rubric_hash=RUBRIC_HASH,
            )

    def test_rejects_unreviewed_advisory_signals(self) -> None:
        record = decision.build_decision(
            {"findings": []},
            target=TARGET,
            rubric_digest=RUBRIC_HASH,
        )

        with self.assertRaisesRegex(
            decision.DecisionInvalid,
            "does not account for every current advisory signal",
        ):
            decision.validate_decision(
                record,
                expected_target=TARGET,
                expected_rubric_hash=RUBRIC_HASH,
                expected_signal_keys=[
                    "STRUCT-SIGNAL-FILE-LINES@src/service.ts"
                ],
            )

    def test_rejects_findings_outside_reviewed_files(self) -> None:
        invalid = finding(blocking=True)
        invalid["location"] = {
            "path": "src/unreviewed.ts",
            "lineStart": 10,
            "lineEnd": 12,
        }

        with self.assertRaisesRegex(
            decision.DecisionInvalid,
            "points outside reviewedFiles",
        ):
            decision.build_decision(
                {"findings": [invalid]},
                target=TARGET,
                rubric_digest=RUBRIC_HASH,
            )

    def test_coverage_accounts_for_pass_and_skipped_files(self) -> None:
        target = {
            **TARGET,
            "scopeFiles": [
                TARGET["scopeFiles"][0],
                {
                    "path": "generated/service.pb.go",
                    "status": "SKIPPED",
                    "reason": "generated-source",
                },
            ],
        }

        record = decision.build_decision(
            {"findings": []},
            target=target,
            rubric_digest=RUBRIC_HASH,
        )

        self.assertEqual(
            [item["status"] for item in record["coverage"]],
            ["PASS", "SKIPPED"],
        )
        self.assertEqual(
            record["coverage"][1]["reason"],
            "generated-source",
        )

    def test_rejects_caller_supplied_signals(self) -> None:
        with self.assertRaisesRegex(
            decision.DecisionInvalid,
            "decision input must contain exactly",
        ):
            decision.build_decision(
                {"findings": [], "signalsReviewed": []},
                target=TARGET,
                rubric_digest=RUBRIC_HASH,
            )


class SourceClassificationTests(unittest.TestCase):
    def test_excludes_generated_and_vendored_paths(self) -> None:
        result = decision.reviewable_source_paths(
            REPO_ROOT,
            [
                "generated/top.ts",
                "gen/proto/top.ts",
                "src/schema.generated.d.ts",
                "src/generated/nested.ts",
                "vendor/lib/source.go",
                "third_party/lib/source.ts",
                "src/service.ts",
            ],
        )

        self.assertEqual(result, ["src/service.ts"])


class TargetSelectionTests(unittest.TestCase):
    def test_path_depth_one_selects_direct_files_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            (root / "src" / "nested").mkdir(parents=True)
            (root / "src" / "root.ts").write_text("export {};\n")
            (root / "src" / "notes.md").write_text("notes\n")
            (root / "src" / "nested" / "child.ts").write_text("export {};\n")
            subprocess.run(["git", "add", "."], cwd=root, check=True)

            normalized, paths = decision.path_scope_paths(root, "src", 1)

        self.assertEqual(normalized, "src")
        self.assertEqual(paths, ["src/notes.md", "src/root.ts"])

    def test_depth_requires_path(self) -> None:
        args = decision.argparse.Namespace(
            diff_range=None,
            review_path=None,
            pull_request=None,
            depth=1,
        )

        with self.assertRaisesRegex(
            decision.DecisionInvalid,
            "--depth requires --path",
        ):
            decision.selector_from_arguments(args)

    def test_pr_selector_resolves_exact_remote_commits(self) -> None:
        response = subprocess.CompletedProcess(
            args=["gh", "pr", "view"],
            returncode=0,
            stdout=(
                '{"baseRefOid":"base123","headRefOid":"head456",'
                '"number":42,"url":"https://github.com/acme/repo/pull/42"}'
            ),
            stderr="",
        )
        with patch.object(
            decision.subprocess,
            "run",
            return_value=response,
        ):
            selector, diff_range = decision.resolve_pr(REPO_ROOT, "42")

        self.assertEqual(diff_range, "base123...head456")
        self.assertEqual(selector["number"], 42)
        self.assertEqual(selector["requested"], "42")

    def test_prepare_derives_signals_and_summary(self) -> None:
        target = TARGET
        with (
            patch.object(
                decision,
                "resolve_review_target",
                return_value=target,
            ),
            patch.object(
                decision,
                "structure_signals",
                return_value=[
                    {
                        "code": "STRUCT-SIGNAL-FILE-LINES",
                        "path": "src/service.ts",
                    }
                ],
            ),
            patch.object(
                decision,
                "rubric_hash",
                return_value=RUBRIC_HASH,
            ),
        ):
            prepared = decision.prepare_review(
                REPO_ROOT,
                {"kind": "range", "range": "HEAD"},
            )

        self.assertEqual(prepared["scopeId"], TARGET["scopeId"])
        self.assertEqual(prepared["summary"]["reviewedFileCount"], 1)
        self.assertEqual(prepared["summary"]["signalCount"], 1)


class _Reference:
    def to_dict(self) -> dict[str, str]:
        return {"gateId": decision.GATE_ID, "role": decision.ARTIFACT_ROLE}


class _Store:
    def __init__(self, record: dict[str, object]) -> None:
        self.record = record

    def latest_artifact_ref(self, _gate: str, _role: str) -> _Reference:
        return _Reference()

    def read_json(self, _reference: _Reference) -> dict[str, object]:
        return self.record


class _FailingStore:
    def __init__(self, error: Exception) -> None:
        self.error = error

    def latest_artifact_ref(self, _gate: str, _role: str) -> _Reference:
        raise self.error


class DecisionCollectionTests(unittest.TestCase):
    def test_verification_exit_codes_preserve_blocking_verdicts(self) -> None:
        self.assertEqual(
            decision.verification_exit_code(
                {"required": True, "status": "REFACTOR_REQUIRED"}
            ),
            3,
        )
        self.assertEqual(
            decision.verification_exit_code(
                {"required": True, "status": "MISSING"}
            ),
            2,
        )
        self.assertEqual(
            decision.verification_exit_code(
                {"required": True, "status": "STALE"}
            ),
            1,
        )
        self.assertEqual(
            decision.verification_exit_code(
                {"required": True, "status": "PASS_WITH_SUGGESTIONS"}
            ),
            0,
        )

    def test_distinguishes_missing_and_corrupt_evidence_pointers(self) -> None:
        paths = ["src/service.ts"]
        missing = decision.EvidenceManifestInvalid(
            f"latest pointer is unavailable for {decision.GATE_ID}"
        )
        corrupt = decision.EvidenceManifestInvalid(
            "latest pointer digest is invalid"
        )

        with patch.object(decision, "structure_signal_keys", return_value=[]):
            missing_result = decision.collect_latest_decision(
                repo_root=REPO_ROOT,
                store=_FailingStore(missing),
                diff_range="HEAD",
                paths=paths,
            )
            corrupt_result = decision.collect_latest_decision(
                repo_root=REPO_ROOT,
                store=_FailingStore(corrupt),
                diff_range="HEAD",
                paths=paths,
            )

        self.assertEqual(missing_result["status"], "MISSING")
        self.assertEqual(corrupt_result["status"], "INVALID")

    def test_collects_only_a_current_source_bound_decision(self) -> None:
        paths = ["src/service.ts"]
        target = decision.review_target(REPO_ROOT, "HEAD", paths)
        record = decision.build_decision(
            {"findings": []},
            target=target,
            rubric_digest=decision.rubric_hash(REPO_ROOT),
        )

        with patch.object(decision, "structure_signal_keys", return_value=[]):
            result = decision.collect_latest_decision(
                repo_root=REPO_ROOT,
                store=_Store(record),
                diff_range="HEAD",
                paths=paths,
            )

        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["decision"], record)

    def test_marks_a_changed_rubric_as_stale(self) -> None:
        paths = ["src/service.ts"]
        target = decision.review_target(REPO_ROOT, "HEAD", paths)
        record = decision.build_decision(
            {"findings": []},
            target=target,
            rubric_digest=f"sha256:{'b' * 64}",
        )

        with patch.object(decision, "structure_signal_keys", return_value=[]):
            result = decision.collect_latest_decision(
                repo_root=REPO_ROOT,
                store=_Store(record),
                diff_range="HEAD",
                paths=paths,
            )

        self.assertEqual(result["status"], "STALE")
        self.assertIsNone(result["decision"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
