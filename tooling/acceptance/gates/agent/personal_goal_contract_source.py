#!/usr/bin/env python3
"""Validate the PAOS Goal contract and admission source boundary."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[4]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def require(content: str, needle: str, message: str) -> None:
    if needle not in content:
        raise AssertionError(message)


def forbid(content: str, needle: str, message: str) -> None:
    if needle in content:
        raise AssertionError(message)


def main() -> int:
    proto = read("model/domain/agent/goal.proto")
    orchestration_proto = read("model/domain/agent/orchestration.proto")
    home_proto = read("model/domain/agent/home.proto")
    goal_service = read(
        "apps/station/app/subserver/agent/service/goal_service.go"
    )
    admission = read(
        "apps/station/app/subserver/agent/service/goal_admission_service.go"
    )
    admission_tests = read(
        "apps/station/app/subserver/agent/service/"
        "goal_admission_service_test.go"
    )
    goal_execution = read(
        "apps/station/app/subserver/agent/service/"
        "goal_execution_service.go"
    )
    goal_execution_tests = read(
        "apps/station/app/subserver/agent/service/"
        "goal_execution_service_test.go"
    )
    handler = read(
        "apps/station/app/subserver/agent/handler/goal_handler.go"
    )
    routes = read("apps/station/app/subserver/agent/agent.go")
    rust_bridge = read("apps/desktop/src-tauri/src/application/home.rs")
    tauri_commands = read(
        "apps/desktop/src-tauri/src/interface/tauri_commands/home.rs"
    )
    desktop_api = read("apps/desktop/src/services/desktop_api.ts")
    runtime = read("apps/desktop/src/runtimes/homeRuntime.ts")
    review_panel = read(
        "apps/desktop/src/components/home/GoalReviewPanel.tsx"
    )
    run_summary = read(
        "apps/desktop/src/components/home/GoalRunSummary.tsx"
    )
    execution_store = read("apps/desktop/src/store/goalExecution.ts")

    for message in (
        "message AdmitAgentGoalRequest",
        "message AdmitAgentGoalResponse",
        "message StartAgentGoalRequest",
        "message StartAgentGoalResponse",
    ):
        require(proto, message, f"Goal command contract is missing: {message}")

    require(
        goal_service,
        "validateReviewedGoalAdmission(record)",
        "Goal review does not validate admission completeness",
    )
    require(
        admission,
        "AGENT_GOAL_STATUS_REVIEWING",
        "Goal admission does not require REVIEWING",
    )
    require(
        admission,
        "AGENT_GOAL_STATUS_READY",
        "Goal admission does not commit READY",
    )
    require(
        admission,
        "AGENT_GOAL_STATUS_RUNNING",
        "Goal start does not commit RUNNING",
    )
    require(
        admission,
        "runGoalMutationTx(",
        "Goal admission does not use revisioned idempotent mutation",
    )
    require(
        admission,
        "AllocateFirstTx(ctx, tx, record)",
        "Goal start does not atomically allocate its first TaskRun",
    )
    for field in (
        "message AgentGoalNode",
        "string goal_id = 15",
        "string goal_node_id = 16",
        "string root_step_id = 17",
        "string attempt_id = 20",
    ):
        require(
            orchestration_proto,
            field,
            f"canonical Goal execution contract is missing: {field}",
        )
    for field in (
        "string goal_id = 8",
        "string goal_node_id = 9",
        "string step_id = 10",
        "string attempt_id = 11",
    ):
        require(
            home_proto,
            field,
            f"Home Goal execution projection is missing: {field}",
        )
    for source, needle, message in (
        (
            goal_execution,
            "stableGoalExecutionID",
            "Goal execution does not preallocate stable identities",
        ),
        (
            goal_execution,
            "persistence.AgentGoalNode",
            "Goal execution does not persist AgentGoalNode",
        ),
        (
            goal_execution,
            "persistence.TaskRun",
            "Goal execution does not persist TaskRun",
        ),
        (
            goal_execution,
            "persistence.ExecutionStep",
            "Goal execution does not persist ExecutionStep",
        ),
        (
            execution_store,
            "normalizeGoalExecutions",
            "Desktop Goal execution projection store is missing",
        ),
    ):
        require(source, needle, message)

    for source, needle, message in (
        (handler, "HandleAdmit", "Station Goal admit handler is missing"),
        (handler, "HandleStart", "Station Goal start handler is missing"),
        (routes, '"/agent/goal/admit"', "Station Goal admit route is missing"),
        (routes, '"/agent/goal/start"', "Station Goal start route is missing"),
        (
            rust_bridge,
            '"/sub-agent/agent/goal/admit"',
            "Desktop Rust Goal admit bridge is missing",
        ),
        (
            rust_bridge,
            '"/sub-agent/agent/goal/start"',
            "Desktop Rust Goal start bridge is missing",
        ),
        (
            tauri_commands,
            "agent_home_goal_admit",
            "Tauri Goal admit command is missing",
        ),
        (
            tauri_commands,
            "agent_home_goal_start",
            "Tauri Goal start command is missing",
        ),
        (
            desktop_api,
            "admitAgentGoal",
            "Desktop Goal admit API is missing",
        ),
        (
            desktop_api,
            "startAgentGoal",
            "Desktop Goal start API is missing",
        ),
    ):
        require(source, needle, message)

    admit_index = runtime.find("await api.admitAgentGoal")
    start_index = runtime.find("await api.startAgentGoal")
    if admit_index < 0 or start_index <= admit_index:
        raise AssertionError(
            "Home runtime must admit the reviewed revision before starting it"
        )

    for selector in (
        "data-pt-home-goal-assumption",
        "data-pt-home-goal-admission-error",
        "data-pt-home-goal-start",
        "data-pt-home-goal-running",
    ):
        require(
            review_panel,
            selector,
            f"Goal review surface is missing {selector}",
        )
    for selector in (
        "data-pt-goal-run",
        "data-pt-goal-run-readback",
        "data-pt-goal-id",
        "data-pt-goal-node-id",
        "data-pt-goal-task-id",
        "data-pt-goal-step-id",
        "data-pt-goal-attempt-id",
    ):
        require(
            run_summary,
            selector,
            f"Goal TaskRun surface is missing {selector}",
        )

    for test_name in (
        "TestGoalAdmissionAndStartCreateOneCanonicalTaskRun",
        "TestGoalAdmissionRejectsIncompleteReviewWithoutMutation",
        "TestGoalReviewRejectsIncompleteContractWhileItIsEditable",
        "TestGoalStartRejectsNonReadyStaleAndForeignActor",
    ):
        require(
            admission_tests,
            test_name,
            f"Goal admission coverage is missing {test_name}",
        )
    require(
        goal_execution_tests,
        "TestGoalTaskRunAllocationFailureLeavesGoalReady",
        "Goal TaskRun rollback coverage is missing",
    )

    print(
        "PASS Personal Goal contract source: reviewed Goal admission is "
        "typed, revisioned, idempotent, visible, and atomically allocates "
        "one canonical Goal TaskRun at start."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise SystemExit(1)
