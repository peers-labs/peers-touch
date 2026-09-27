from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tooling.scripts.plan.acceptance_admission import (
    AcceptanceAdmissionError,
    require_acceptance_admission,
)


class AcceptanceAdmissionTests(unittest.TestCase):
    def test_session_is_required_before_starting_the_node_owner(self) -> None:
        runner = Mock()

        with self.assertRaisesRegex(
            AcceptanceAdmissionError,
            "ACCEPTANCE_SESSION_REQUIRED",
        ):
            require_acceptance_admission(Path("/repo"), None, "acceptance", runner=runner)

        runner.assert_not_called()

    def test_successful_owner_result_is_returned(self) -> None:
        result = {
            "ok": True,
            "mode": "acceptance",
            "planId": "PLAN-1",
            "taskId": "TASK-1",
            "closureId": "closure-1",
            "sessionId": "session-1",
            "sessionState": "ACCEPTANCE_RUNNING",
        }
        runner = Mock(
            return_value=subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=json.dumps(result),
                stderr="",
            )
        )

        admitted = require_acceptance_admission(
            Path("/repo"),
            "/tmp/session.json",
            "acceptance",
            runner=runner,
        )

        self.assertEqual(admitted, result)
        self.assertIn("--session", runner.call_args.args[0])

    def test_typed_owner_failure_is_preserved(self) -> None:
        runner = Mock(
            return_value=subprocess.CompletedProcess(
                args=[],
                returncode=2,
                stdout="",
                stderr=json.dumps(
                    {
                        "ok": False,
                        "error": {
                            "code": "ACCEPTANCE_FUNCTIONAL_FRONTIER_REQUIRED",
                            "message": "functional frontier has not passed",
                        },
                    }
                ),
            )
        )

        with self.assertRaisesRegex(
            AcceptanceAdmissionError,
            "ACCEPTANCE_FUNCTIONAL_FRONTIER_REQUIRED",
        ):
            require_acceptance_admission(
                Path("/repo"),
                "/tmp/session.json",
                "acceptance",
                runner=runner,
            )


if __name__ == "__main__":
    unittest.main()
