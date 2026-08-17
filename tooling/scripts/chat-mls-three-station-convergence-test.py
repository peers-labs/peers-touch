from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import ArtifactRef, EvidenceStore


SCRIPT = (
    Path(__file__).resolve().parent
    / "chat-mls-three-station-convergence.py"
)
SPEC = importlib.util.spec_from_file_location("chat_mls_convergence", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ChatMlsConvergenceEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "artifacts"
        self.environment = {
            "PT_ACCEPTANCE_ARTIFACT_ROOT": str(self.root),
        }
        self.store = EvidenceStore(
            self.root,
            worktree=MODULE.REPO_ROOT,
        )
        topology = self.store.begin_run(
            MODULE.TOPOLOGY_GATE_ID,
            source={},
        )
        self.topology_ref = topology.write_json(
            "reports/topology.json",
            {
                "status": "pass",
                "federation_id": "federation-test",
                "nodes": {},
            },
            role=MODULE.TOPOLOGY_ROLE,
        )
        topology.finalize(result={"status": "pass"})
        topology.publish_latest()
        topology.close()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_success_publishes_final_report_with_topology_ref(self) -> None:
        def run_shell(
            env: dict[str, str],
        ) -> subprocess.CompletedProcess[str]:
            Path(env["PT_C6_REPORT_DRAFT_PATH"]).write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "status": "pass",
                        "access_tokens_present": False,
                    }
                ),
                encoding="utf-8",
            )
            return subprocess.CompletedProcess([], 0)

        with (
            patch.dict(os.environ, self.environment, clear=True),
            patch.object(
                MODULE,
                "run_convergence_shell",
                side_effect=run_shell,
            ),
        ):
            self.assertEqual(MODULE.execute(), 0)

        latest = self.store.latest(MODULE.GATE_ID)
        report_ref = latest["artifacts"]["report"]
        report = json.loads(
            self.store.resolve(
                ArtifactRef.from_dict(report_ref)
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(
            report["topology_artifact_ref"],
            self.topology_ref.to_dict(),
        )
        self.assertFalse(report["access_tokens_present"])

    def test_shell_failure_remains_unproven_but_durable(self) -> None:
        with (
            patch.dict(os.environ, self.environment, clear=True),
            patch.object(
                MODULE,
                "run_convergence_shell",
                return_value=subprocess.CompletedProcess([], 7),
            ),
        ):
            self.assertEqual(MODULE.execute(), 1)

        latest = self.store.latest(MODULE.GATE_ID)
        self.assertEqual(latest["result"]["proofStatus"], "UNPROVEN")
        report_ref = latest["artifacts"]["report"]
        report = json.loads(
            self.store.resolve(
                ArtifactRef.from_dict(report_ref)
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["proofStatus"], "UNPROVEN")


if __name__ == "__main__":
    unittest.main()
