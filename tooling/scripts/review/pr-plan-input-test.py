from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "tooling/scripts/review/pr-plan-input.py"
DWF_PLAN = (
    "docs/architecture/development-workflow/execution-plans/"
    "20260918-immutable-workspace-plan-binding/plan.md"
)
AGENT_PLAN = (
    "docs/architecture/agent/execution-plans/"
    "20260917-modern-chat-agent-v2-alignment/plan.md"
)


class PullRequestPlanInputTests(unittest.TestCase):
    def run_parser(self, body: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temporary:
            event = Path(temporary) / "event.json"
            event.write_text(
                json.dumps({"pull_request": {"body": body}}),
                encoding="utf-8",
            )
            return subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    "--event",
                    str(event),
                    "--repo-root",
                    str(REPO_ROOT),
                ],
                check=False,
                capture_output=True,
                text=True,
            )

    def test_resolves_every_explicit_plan_in_order(self) -> None:
        completed = self.run_parser(
            "\n".join(
                [
                    "# Summary",
                    "",
                    "## Execution Plans / 执行计划",
                    f"- `{DWF_PLAN}`",
                    f"- `{AGENT_PLAN}`",
                    "",
                    "## Changes / 变更内容",
                ],
            ),
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.splitlines(), [DWF_PLAN, AGENT_PLAN])

    def test_accepts_explicit_standalone_marker_without_plan_output(self) -> None:
        completed = self.run_parser(
            "\n".join(
                [
                    "# Summary",
                    "",
                    "## Execution Plans / 执行计划",
                    "- None",
                    "",
                    "## Changes / 变更内容",
                ],
            ),
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout, "")

    def test_rejects_missing_duplicate_and_invalid_plan_inputs(self) -> None:
        cases = [
            "# Summary\n",
            f"{'## Execution Plans / 执行计划'}\n- `{DWF_PLAN}`\n- `{DWF_PLAN}`\n",
            "## Execution Plans / 执行计划\n- None\n- None\n",
            f"## Execution Plans / 执行计划\n- None\n- `{DWF_PLAN}`\n",
            "## Execution Plans / 执行计划\n- `../plan.md`\n",
            "## Execution Plans / 执行计划\n- `docs/missing/plan.md`\n",
            "## Execution Plans / 执行计划\nplain text\n",
        ]
        for body in cases:
            with self.subTest(body=body):
                completed = self.run_parser(body)
                self.assertEqual(completed.returncode, 2)
                self.assertIn("PR_EXECUTION_PLAN_INPUT_INVALID", completed.stderr)


if __name__ == "__main__":
    unittest.main()
