from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "tooling/scripts/agent-v2-final-proof.sh"
STAGES = (
    "gate",
    "proof-envelope",
    "proof-set",
    "proof-set-validation",
    "d11",
    "locale",
    "hard-rules",
)


class AgentV2FinalProofShellTest(unittest.TestCase):
    def run_pipeline(
        self,
        root: Path,
        *,
        fail_at: str = "",
    ) -> subprocess.CompletedProcess[str]:
        environment = {
            **os.environ,
            "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root.parent / "artifacts"),
            "PT_AGENT_V2_HANDOFF_ROOT": str(root),
            "PT_AGENT_V2_COMMAND_MODE": "noop",
            "PT_AGENT_V2_FAIL_AT": fail_at,
        }
        return subprocess.run(
            [str(SCRIPT)],
            cwd=REPO_ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_success_removes_handoff_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            handoff = Path(directory) / "handoff"
            completed = self.run_pipeline(handoff)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertFalse(handoff.exists())

    def test_every_stage_failure_is_nonzero_and_cleans_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            for stage in STAGES:
                with self.subTest(stage=stage):
                    handoff = base / stage
                    completed = self.run_pipeline(
                        handoff,
                        fail_at=stage,
                    )
                    self.assertNotEqual(completed.returncode, 0)
                    self.assertIn(stage, completed.stderr)
                    self.assertFalse(handoff.exists())

    def test_missing_external_artifact_root_fails_before_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            handoff = Path(directory) / "handoff"
            environment = {
                **os.environ,
                "PT_ACCEPTANCE_ARTIFACT_ROOT": "",
                "PT_AGENT_V2_HANDOFF_ROOT": str(handoff),
                "PT_AGENT_V2_COMMAND_MODE": "noop",
            }
            completed = subprocess.run(
                [str(SCRIPT)],
                cwd=REPO_ROOT,
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("PT_ACCEPTANCE_ARTIFACT_ROOT", completed.stderr)
            self.assertFalse(handoff.exists())


if __name__ == "__main__":
    unittest.main()
