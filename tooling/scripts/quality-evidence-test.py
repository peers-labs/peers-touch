#!/usr/bin/env python3

from __future__ import annotations

import errno
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("quality-evidence.py")
ROUTE_SCRIPT = SCRIPT.parent / "review" / "route-change.sh"
KNOWLEDGE_SCRIPT = SCRIPT.parent / "review" / "knowledge-match.sh"
HARD_RULES_SCRIPT = SCRIPT.parent / "review" / "hard-rules.sh"
REVIEW_RUN_SCRIPT = SCRIPT.parent / "review" / "run.sh"
SPEC = importlib.util.spec_from_file_location("quality_evidence", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"failed to load {SCRIPT}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def script_command(path: Path, *args: str) -> list[str]:
    prefix: list[str] = []
    if os.name == "nt":
        bash = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
        prefix.append(bash)
    return [*prefix, str(path), *args]


@contextmanager
def temporary_git_directory() -> Iterator[Path]:
    root = Path(tempfile.mkdtemp())
    try:
        yield root
    finally:
        def remove_readonly(function, path, _error):
            os.chmod(path, stat.S_IWRITE)
            function(path)

        for attempt in range(20):
            try:
                try:
                    shutil.rmtree(root, onexc=remove_readonly)
                except TypeError:
                    shutil.rmtree(root, onerror=remove_readonly)
                break
            except OSError as error:
                if error.errno != errno.ENOTEMPTY or attempt == 19:
                    raise
                time.sleep(0.05)


class ChangedPathsTests(unittest.TestCase):
    def test_head_includes_untracked_files(self) -> None:
        responses = [
            subprocess.CompletedProcess(
                args=["git", "diff"],
                returncode=0,
                stdout="tracked.py\n",
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=["git", "ls-files"],
                returncode=0,
                stdout="new.py\n",
                stderr="",
            ),
        ]
        with patch.object(MODULE.subprocess, "run", side_effect=responses):
            self.assertEqual(
                MODULE.collect_changed_paths(Path("/repo"), "HEAD"),
                ["new.py", "tracked.py"],
            )

    def test_explicit_range_excludes_untracked_files(self) -> None:
        response = subprocess.CompletedProcess(
            args=["git", "diff"],
            returncode=0,
            stdout="committed.py\n",
            stderr="",
        )
        with patch.object(
            MODULE.subprocess,
            "run",
            return_value=response,
        ) as run:
            self.assertEqual(
                MODULE.collect_changed_paths(
                    Path("/repo"),
                    "main...HEAD",
                ),
                ["committed.py"],
            )
            run.assert_called_once()


class ReadinessTests(unittest.TestCase):
    def test_classifies_argv_gate_with_readable_invocation(self) -> None:
        buckets = MODULE.classify_gates(
            [
                {
                    "id": "argv-gate",
                    "tier": "env-evidence",
                    "environment": "native",
                    "argv": [
                        "python3",
                        "-m",
                        "example.gate",
                        "--label",
                        "two words",
                    ],
                }
            ]
        )

        self.assertEqual(
            buckets["environment_evidence_gates"][0]["command"],
            "python3 -m example.gate --label 'two words'",
        )

    def test_classification_rejects_ambiguous_invocation(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "must contain exactly one valid command or argv",
        ):
            MODULE.classify_gates(
                [
                    {
                        "id": "ambiguous-gate",
                        "command": "python3 -m example.gate",
                        "argv": ["python3", "-m", "example.gate"],
                    }
                ]
            )

    def test_reverse_validation_scope_is_informational(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            capabilities = root / "capabilities"
            capabilities.mkdir()
            (capabilities / "test.yaml").write_text(
                json.dumps(
                    {
                        "capabilities": [
                            {
                                "id": "core",
                                "direction": "acceptance_core_self_validation",
                                "features": ["acceptance-framework"],
                                "evidence": {"unproven_scope": []},
                            },
                            {
                                "id": "reverse",
                                "direction": "product_domain_validates_acceptance",
                                "features": ["acceptance-framework"],
                                "evidence": {
                                    "unproven_scope": [
                                        "business domain injection is incomplete"
                                    ]
                                },
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )

            evidence = MODULE.selected_capability_evidence(
                root,
                ["acceptance-framework"],
            )

        self.assertEqual(evidence["blocking_unproven_scope"], [])
        self.assertEqual(
            evidence["informational_unproven_scope"],
            ["business domain injection is incomplete"],
        )
        self.assertEqual(
            {item["id"]: item["direction"] for item in evidence["selected_capabilities"]},
            {
                "core": "acceptance_core_self_validation",
                "reverse": "product_domain_validates_acceptance",
            },
        )

    def test_unproven_scope_is_handed_to_review(self) -> None:
        evidence = {
            "route": {"ok": True},
            "knowledge": {"ok": True},
            "acceptance": {
                "plan_ok": True,
                "blocking_unproven_scope": ["framework self-proof missing"],
                "informational_unproven_scope": [
                    "business domain injection is incomplete"
                ],
                "latest_run": {"results": []},
                "gate_buckets": {
                    "environment_evidence_gates": [],
                    "nightly_or_release_gates": [],
                },
            },
            "head_commit": "current",
        }

        gaps = MODULE.evidence_gaps(evidence)

        self.assertEqual(gaps["blocking"], [])
        self.assertEqual(len(gaps["review"]), 1)
        self.assertEqual(gaps["review"][0]["impact"], "framework self-proof missing")
        self.assertEqual(gaps["deferred"], [])

    def test_ci_mode_defers_environment_gates_and_unproven_scope(self) -> None:
        evidence = {
            "route": {"ok": True},
            "knowledge": {"ok": True},
            "acceptance": {
                "plan_ok": True,
                "blocking_unproven_scope": ["native scope unproven"],
                "informational_unproven_scope": [],
                "latest_run": {"results": []},
                "gate_buckets": {
                    "environment_evidence_gates": [
                        {
                            "id": "chat-native-e2e",
                            "tier": "env-evidence",
                            "environment": "home-station",
                            "provisioner": "home-station",
                            "command": "python3 runner.py",
                        }
                    ],
                    "nightly_or_release_gates": [],
                },
            },
            "head_commit": "current",
        }

        gaps = MODULE.evidence_gaps(evidence, ci_mode=True)

        self.assertEqual(gaps["blocking"], [])
        self.assertEqual(len(gaps["review"]), 1)
        self.assertEqual(len(gaps["deferred"]), 1)
        review_kinds = {g["kind"] for g in gaps["review"]}
        deferred_kinds = {g["kind"] for g in gaps["deferred"]}
        self.assertIn("unproven-product-scope:1", review_kinds)
        self.assertIn("environment-gate:chat-native-e2e", deferred_kinds)

    def test_local_mode_hands_environment_gates_to_review(self) -> None:
        evidence = {
            "route": {"ok": True},
            "knowledge": {"ok": True},
            "acceptance": {
                "plan_ok": True,
                "blocking_unproven_scope": [],
                "informational_unproven_scope": [],
                "latest_run": {"results": []},
                "gate_buckets": {
                    "environment_evidence_gates": [
                        {
                            "id": "chat-native-e2e",
                            "tier": "env-evidence",
                            "environment": "home-station",
                            "provisioner": "home-station",
                            "command": "python3 runner.py",
                        }
                    ],
                    "nightly_or_release_gates": [],
                },
            },
            "head_commit": "current",
        }

        gaps = MODULE.evidence_gaps(evidence, ci_mode=False)

        self.assertEqual(gaps["blocking"], [])
        self.assertEqual(len(gaps["review"]), 1)
        self.assertEqual(gaps["review"][0]["kind"], "environment-gate:chat-native-e2e")

    def test_only_pipeline_failures_block_review_readiness(self) -> None:
        healthy = {"ok": True}
        self.assertFalse(
            MODULE.is_ready_for_github_review(
                healthy,
                healthy,
                healthy,
                [{"kind": "environment-gate"}],
            )
        )
        self.assertTrue(
            MODULE.is_ready_for_github_review(
                healthy,
                healthy,
                healthy,
                [],
            )
        )

    def test_current_provisioned_gate_result_closes_environment_gap(self) -> None:
        gate = {
            "id": "native",
            "tier": "env-evidence",
            "provisioner": "home-station",
        }
        result = {
            "id": "native",
            "status": "passed",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "timedOut": False,
            "traceability": {"status": "complete"},
            "sourceArtifact": {"path": "reports/native.json"},
            "sourceArtifactKind": "acceptance-gate-evidence-report",
            "evidenceGateId": "native",
            "manifest": {
                "state": "FIXTURE_READY",
                "source": {
                    "commit": "current-head",
                    "workspaceDigest": "clean",
                },
            },
        }
        self.assertTrue(
            MODULE.gate_result_is_proven(
                gate,
                result,
                "current-head",
            )
        )

    def test_stale_or_failed_environment_result_remains_unproven(self) -> None:
        gate = {
            "id": "native",
            "tier": "env-evidence",
            "provisioner": "home-station",
        }
        result = {
            "id": "native",
            "status": "passed",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "timedOut": False,
            "traceability": {"status": "complete"},
            "sourceArtifact": {"path": "reports/native.json"},
            "sourceArtifactKind": "acceptance-gate-evidence-report",
            "evidenceGateId": "native",
            "manifest": {
                "state": "FIXTURE_READY",
                "source": {
                    "commit": "old-head",
                    "workspaceDigest": "clean",
                },
            },
        }
        self.assertFalse(
            MODULE.gate_result_is_proven(
                gate,
                result,
                "current-head",
            )
        )

    def test_noncanonical_environment_evidence_kind_is_unproven(self) -> None:
        gate = {"id": "native", "tier": "env-evidence"}
        result = {
            "id": "native",
            "status": "passed",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "timedOut": False,
            "traceability": {"status": "complete"},
            "sourceArtifact": {"path": "reports/native.json"},
            "sourceArtifactKind": "forged-kind",
            "evidenceGateId": "native",
            "manifest": {
                "state": "FIXTURE_READY",
                "source": {
                    "commit": "current-head",
                    "workspaceDigest": "clean",
                },
            },
        }

        self.assertFalse(
            MODULE.gate_result_is_proven(
                gate,
                result,
                "current-head",
            )
        )

    def test_environment_evidence_with_not_required_traceability_is_unproven(
        self,
    ) -> None:
        gate = {
            "id": "native",
            "tier": "env-evidence",
            "provisioner": "home-station",
        }
        result = {
            "id": "native",
            "status": "passed",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "timedOut": False,
            "traceability": {"status": "not-required"},
            "sourceArtifact": {"path": "reports/native.json"},
            "sourceArtifactKind": "acceptance-gate-evidence-report",
            "evidenceGateId": "native",
            "manifest": {
                "state": "FIXTURE_READY",
                "source": {
                    "commit": "current-head",
                    "workspaceDigest": "clean",
                },
            },
        }

        self.assertFalse(
            MODULE.gate_result_is_proven(
                gate,
                result,
                "current-head",
            )
        )
        result["status"] = "failed"
        result["manifest"]["source"]["commit"] = "current-head"
        self.assertFalse(
            MODULE.gate_result_is_proven(
                gate,
                result,
                "current-head",
            )
        )


class RouteRangeTests(unittest.TestCase):
    def test_explicit_range_excludes_untracked_cross_scope_paths(self) -> None:
        with temporary_git_directory() as root:
            subprocess.run(
                ["git", "init"],
                cwd=root,
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["git", "config", "user.email", "acceptance@test.invalid"],
                cwd=root,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Acceptance Test"],
                cwd=root,
                check=True,
            )
            (root / "README.md").write_text("base\n", encoding="utf-8")
            knowledge = (
                root
                / "docs"
                / "knowledge"
                / "invariants"
                / "station.md"
            )
            knowledge.parent.mkdir(parents=True)
            knowledge.write_text(
                "\n".join(
                    (
                        "---",
                        "kind: invariant",
                        "title: Station",
                        "status: active",
                        "owns:",
                        "  - apps/station/",
                        "detected: 2026-08-17",
                        "---",
                        "",
                        "## How to verify",
                        "",
                        "Review Station paths.",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            subprocess.run(["git", "add", "."], cwd=root, check=True)
            subprocess.run(
                ["git", "commit", "-m", "base"],
                cwd=root,
                check=True,
                capture_output=True,
            )
            base = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=root,
                check=True,
                text=True,
                capture_output=True,
            ).stdout.strip()
            docs = root / "docs"
            (docs / "change.md").write_text("change\n", encoding="utf-8")
            subprocess.run(["git", "add", "docs/change.md"], cwd=root, check=True)
            subprocess.run(
                ["git", "commit", "-m", "docs"],
                cwd=root,
                check=True,
                capture_output=True,
            )
            untracked = root / "apps" / "station"
            untracked.mkdir(parents=True)
            (untracked / "ecosystem.pb.go").write_text(
                "package station\n\nfunc debug() { fmt.Println(\"untracked\") }\n",
                encoding="utf-8",
            )

            completed = subprocess.run(
                script_command(
                    ROUTE_SCRIPT,
                    "--range",
                    f"{base}...HEAD",
                ),
                cwd=root,
                check=True,
                text=True,
                capture_output=True,
            )
            knowledge_completed = subprocess.run(
                script_command(
                    KNOWLEDGE_SCRIPT,
                    "--range",
                    f"{base}...HEAD",
                ),
                cwd=root,
                check=False,
                text=True,
                capture_output=True,
            )
            hard_rules_completed = subprocess.run(
                script_command(
                    HARD_RULES_SCRIPT,
                    "--range",
                    f"{base}...HEAD",
                ),
                cwd=root,
                check=True,
                text=True,
                capture_output=True,
            )

        self.assertIn("[docs]", completed.stdout)
        self.assertNotIn("[station]", completed.stdout)
        self.assertIn(knowledge_completed.returncode, (0, 1))
        self.assertNotIn("ecosystem.pb.go", knowledge_completed.stdout)
        self.assertIn("hard-rules: pass", hard_rules_completed.stdout)

    def test_review_run_only_merges_untracked_for_head(self) -> None:
        source = REVIEW_RUN_SCRIPT.read_text(encoding="utf-8")
        self.assertIn('if [[ "$diff_range" == "HEAD" ]]', source)

    def test_review_scripts_only_fallback_to_worktree_for_head(self) -> None:
        for script in (
            ROUTE_SCRIPT,
            KNOWLEDGE_SCRIPT,
            HARD_RULES_SCRIPT,
        ):
            with self.subTest(script=script.name):
                source = script.read_text(encoding="utf-8")
                self.assertIn(
                    '&& "$diff_range" == "HEAD"',
                    source,
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
