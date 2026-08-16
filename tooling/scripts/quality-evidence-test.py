#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
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
    def test_evidence_gaps_block_review_readiness(self) -> None:
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


class RouteRangeTests(unittest.TestCase):
    def test_explicit_range_excludes_untracked_cross_scope_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
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
                [
                    str(ROUTE_SCRIPT),
                    "--range",
                    f"{base}...HEAD",
                ],
                cwd=root,
                check=True,
                text=True,
                capture_output=True,
            )
            knowledge_completed = subprocess.run(
                [
                    str(KNOWLEDGE_SCRIPT),
                    "--range",
                    f"{base}...HEAD",
                ],
                cwd=root,
                check=False,
                text=True,
                capture_output=True,
            )
            hard_rules_completed = subprocess.run(
                [
                    str(HARD_RULES_SCRIPT),
                    "--range",
                    f"{base}...HEAD",
                ],
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
