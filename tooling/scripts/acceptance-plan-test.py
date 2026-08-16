#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("acceptance-plan.py")
SPEC = importlib.util.spec_from_file_location("acceptance_plan", SCRIPT)
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
                MODULE.changed_paths("HEAD"),
                ["new.py", "tracked.py"],
            )

    def test_explicit_range_excludes_worktree_untracked_files(self) -> None:
        response = subprocess.CompletedProcess(
            args=["git", "diff"],
            returncode=0,
            stdout="committed.py\n",
            stderr="",
        )
        with patch.object(MODULE.subprocess, "run", return_value=response) as run:
            self.assertEqual(
                MODULE.changed_paths("main...HEAD"),
                ["committed.py"],
            )
            run.assert_called_once()


if __name__ == "__main__":
    unittest.main(verbosity=2)
