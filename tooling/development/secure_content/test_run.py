from __future__ import annotations

import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any

from tooling.development.secure_content import run


REPO_ROOT = Path(__file__).resolve().parents[3]
IDENTITY = {
    "workspaceId": "9eb2cb904c9ae460",
    "branch": "feat/federation",
    "head": "2d54851f95994d717928105aca6470c30adf3657",
}


def active_declaration(
    scenario: run.ScenarioDefinition,
    *,
    digest: str = "a" * 64,
) -> dict[str, Any]:
    return {
        "declarationId": f"{scenario.work_item_id}-{IDENTITY['workspaceId']}",
        "workItemId": scenario.work_item_id,
        "sessionId": scenario.work_item_id,
        "workspaceId": IDENTITY["workspaceId"],
        "branch": IDENTITY["branch"],
        "sourceHead": IDENTITY["head"],
        "journeyId": scenario.journey_id,
        "state": "ACTIVE",
        "declarationDigest": digest,
        "sourceClaims": [
            {
                "mode": "exclusive-write",
                "pathPrefix": "apps/station/frame/core/auth",
            }
        ],
    }


def control_plane_runner(
    scenario: run.ScenarioDefinition,
    declarations: list[dict[str, Any]] | None = None,
):
    selected = active_declaration(scenario)
    visible = declarations if declarations is not None else [selected]

    def execute(
        command: list[str],
        cwd: Path,
    ) -> subprocess.CompletedProcess[str]:
        if cwd != REPO_ROOT:
            raise AssertionError(f"unexpected cwd: {cwd}")
        if command == ["make", "dev-status"]:
            payload: Any = {
                "workspaceId": IDENTITY["workspaceId"],
                "declarations": visible,
            }
        elif command == [
            "make",
            "dev-check",
            f"WORK_ITEM={scenario.work_item_id}",
            f"SESSION={scenario.work_item_id}",
        ]:
            payload = selected
        elif command[:4] == [
            "git",
            "status",
            "--porcelain",
            "--untracked-files=all",
        ]:
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
        else:
            raise AssertionError(f"unexpected command: {command}")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps(payload),
            stderr="",
        )

    return execute


class SecureContentRunnerTest(unittest.TestCase):
    def test_discovers_optional_auth_scenario_dynamically(self) -> None:
        scenarios = run.discover_scenarios()

        self.assertIn("optional-auth", scenarios)
        self.assertEqual(
            frozenset({"service"}),
            scenarios["optional-auth"].runtimes,
        )
        self.assertEqual(
            "sc-dj-optional-auth",
            scenarios["optional-auth"].journey_id,
        )

    def test_runtime_mismatch_fails_before_scenario_execution(self) -> None:
        called = False

        def execute(_: run.ScenarioContext) -> dict[str, object]:
            nonlocal called
            called = True
            return {}

        scenario = run.ScenarioDefinition(
            scenario_id="service-only",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )

        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(run.RunnerError):
                run.execute_scenario(
                    runtime="desktop",
                    scenario_id=scenario.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=Path(temp),
                    registry={scenario.scenario_id: scenario},
                )
        self.assertFalse(called)

    def test_writes_development_result_outside_repository(self) -> None:
        def execute(context: run.ScenarioContext) -> dict[str, object]:
            self.assertEqual("service", context.runtime)
            context.run_check("real-service", ["/usr/bin/true"], cwd=REPO_ROOT)
            return {"observations": ["real service check passed"]}

        scenario = run.ScenarioDefinition(
            scenario_id="test-service",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )

        with tempfile.TemporaryDirectory() as temp:
            output_root = Path(temp).resolve()
            result = run.execute_scenario(
                runtime="service",
                scenario_id=scenario.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=output_root,
                registry={scenario.scenario_id: scenario},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(scenario),
            )

            output = output_root / scenario.evidence_path
            self.assertTrue(output.is_file())
            self.assertFalse(output.is_relative_to(REPO_ROOT))
            persisted = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual("FUNCTIONAL_CHECK", persisted["verificationClass"])
            self.assertEqual("PASS", persisted["result"])
            self.assertRegex(persisted["runtimeBindingDigest"], r"^[0-9a-f]{64}$")
            self.assertNotEqual(
                persisted["declarationDigest"],
                persisted["runtimeBindingDigest"],
            )
            self.assertEqual(result, persisted)

    def test_rejects_result_root_inside_repository(self) -> None:
        scenario = run.ScenarioDefinition(
            scenario_id="test-service",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=lambda _: {},
        )

        with self.assertRaises(run.RunnerError):
            run.execute_scenario(
                runtime="service",
                scenario_id=scenario.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=REPO_ROOT / "development",
                registry={scenario.scenario_id: scenario},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(scenario),
            )

    def test_rejects_any_dirty_source_before_scenario_execution(self) -> None:
        called = False

        def execute(_: run.ScenarioContext) -> dict[str, object]:
            nonlocal called
            called = True
            return {}

        scenario = run.ScenarioDefinition(
            scenario_id="dirty-source",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )
        base_runner = control_plane_runner(scenario)

        def dirty_runner(
            command: list[str],
            cwd: Path,
        ) -> subprocess.CompletedProcess[str]:
            if command[:4] == [
                "git",
                "status",
                "--porcelain",
                "--untracked-files=all",
            ]:
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout=" M docs/README.md\n",
                    stderr="",
                )
            return base_runner(command, cwd)

        with tempfile.TemporaryDirectory() as temp, self.assertRaisesRegex(
            run.RunnerError,
            "checkpoint before FUNCTIONAL_CHECK",
        ):
            run.execute_scenario(
                runtime="service",
                scenario_id=scenario.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=Path(temp),
                registry={scenario.scenario_id: scenario},
                workspace_identity=IDENTITY,
                command_runner=dirty_runner,
            )
        self.assertFalse(called)

    def test_failure_evidence_does_not_persist_exception_secrets(self) -> None:
        secret = "secret-bearer-value"

        def execute(_: run.ScenarioContext) -> dict[str, object]:
            raise run.RunnerError(f"Authorization: Bearer {secret}")

        scenario = run.ScenarioDefinition(
            scenario_id="secret-failure",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )

        with tempfile.TemporaryDirectory() as temp:
            output_root = Path(temp)
            with self.assertRaises(run.ScenarioFailed):
                run.execute_scenario(
                    runtime="service",
                    scenario_id=scenario.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=output_root,
                    registry={scenario.scenario_id: scenario},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(scenario),
                )

            persisted = (
                output_root / scenario.evidence_path
            ).read_text(encoding="utf-8")
            self.assertNotIn(secret, persisted)
            self.assertIn("scenario execution failed", persisted)

    def test_requires_exactly_one_active_current_workspace_declaration(self) -> None:
        scenario = run.ScenarioDefinition(
            scenario_id="test-service",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=lambda _: {},
        )
        duplicate = active_declaration(scenario, digest="b" * 64)

        with tempfile.TemporaryDirectory() as temp, self.assertRaisesRegex(
            run.RunnerError,
            "exactly one active current-workspace declaration",
        ):
            run.execute_scenario(
                runtime="service",
                scenario_id=scenario.scenario_id,
                budget_seconds=10,
                repo_root=REPO_ROOT,
                result_root=Path(temp),
                registry={scenario.scenario_id: scenario},
                workspace_identity=IDENTITY,
                command_runner=control_plane_runner(
                    scenario,
                    [active_declaration(scenario), duplicate],
                ),
            )

    def test_budget_exhaustion_writes_failed_result(self) -> None:
        def execute(context: run.ScenarioContext) -> dict[str, object]:
            context.started_monotonic = time.monotonic() - context.budget_seconds
            return {}

        scenario = run.ScenarioDefinition(
            scenario_id="budget-test",
            journey_id="journey-1",
            work_item_id="work-1",
            runtimes=frozenset({"service"}),
            evidence_path=Path("W1/SC-AS01/result.json"),
            execute=execute,
        )

        with tempfile.TemporaryDirectory() as temp:
            output_root = Path(temp)
            with self.assertRaises(run.ScenarioFailed):
                run.execute_scenario(
                    runtime="service",
                    scenario_id=scenario.scenario_id,
                    budget_seconds=10,
                    repo_root=REPO_ROOT,
                    result_root=output_root,
                    registry={scenario.scenario_id: scenario},
                    workspace_identity=IDENTITY,
                    command_runner=control_plane_runner(scenario),
                )

            result = json.loads(
                (output_root / scenario.evidence_path).read_text(encoding="utf-8")
            )
            self.assertEqual("FAIL", result["result"])
            self.assertEqual("TIMEOUT", result["firstFailure"]["kind"])


if __name__ == "__main__":
    unittest.main()
