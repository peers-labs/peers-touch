#!/usr/bin/env python3
"""Validate the PAOS-13B Atelier/Canvas TaskRun writer cutover."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def require(content: str, needle: str, message: str) -> None:
    if needle not in content:
        raise AssertionError(message)


def forbid(content: str, needle: str, message: str) -> None:
    if needle in content:
        raise AssertionError(message)


def go_function(content: str, signature: str) -> str:
    start = content.find(signature)
    if start < 0:
        raise AssertionError(f"missing Go function: {signature}")
    params_start = start + len(signature) - 1
    paren_depth = 0
    params_end = -1
    for index in range(params_start, len(content)):
        char = content[index]
        if char == "(":
            paren_depth += 1
        elif char == ")":
            paren_depth -= 1
            if paren_depth == 0:
                params_end = index
                break
    if params_end < 0:
        raise AssertionError(f"unterminated Go function parameters: {signature}")
    body_start = content.find("{", params_end)
    if body_start < 0:
        raise AssertionError(f"missing Go function body: {signature}")
    depth = 0
    for index in range(body_start, len(content)):
        char = content[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return content[start : index + 1]
    raise AssertionError(f"unterminated Go function: {signature}")


def main() -> int:
    writer = read(
        "apps/station/app/subserver/agent/service/"
        "task_run_command_service.go"
    )
    orchestration = read(
        "apps/station/app/subserver/agent/service/orchestration_service.go"
    )
    atelier = read(
        "apps/station/app/subserver/agent/service/atelier_projection.go"
    )
    orchestration_tests = read(
        "apps/station/app/subserver/agent/service/"
        "orchestration_service_test.go"
    )
    atelier_tests = read(
        "apps/station/app/subserver/agent/service/"
        "atelier_projection_test.go"
    )
    controller = read(
        "apps/applets/atelier/frontend/src/application/"
        "useAtelierController.ts"
    )
    client = read(
        "apps/applets/atelier/frontend/src/infrastructure/capability/"
        "atelierClient.ts"
    )
    frontend_test = read(
        "apps/applets/atelier/frontend/src/application/"
        "taskRunCutover.test.ts"
    )
    contract = read(
        "apps/applets/atelier/contracts/"
        "atelier-projection.contract.json"
    )

    create_goal_backed = go_function(
        writer,
        "func (s *TaskRunCommandService) CreateGoalBacked(",
    )
    for canonical_row in (
        "persistence.AgentGoal{",
        "persistence.AgentGoalNode{",
        "persistence.TaskRun{",
        "persistence.ExecutionStep{",
        "taskProviderPlanRecordFromProto(",
        "appendGoalEventTx(",
        "writer.appendTx(",
    ):
        require(
            create_goal_backed,
            canonical_row,
            f"Goal-backed writer is missing {canonical_row}",
        )
    forbid(
        create_goal_backed,
        "persistence.CollaborationTask{",
        "Goal-backed writer still creates CollaborationTask rows",
    )
    forbid(
        create_goal_backed,
        "persistence.CollaborationTaskNode{",
        "Goal-backed writer still creates CollaborationTaskNode rows",
    )

    create_collaboration = go_function(
        orchestration,
        "func (s *OrchestrationService) createCollaborationTaskAfterCanvasReadiness(",
    )
    require(
        create_collaboration,
        "writer.CreateGoalBacked(",
        "Canvas adapter does not use the canonical Goal-backed TaskRun writer",
    )
    forbid(
        create_collaboration,
        "tx.Create(",
        "Canvas adapter still writes execution rows directly",
    )
    forbid(
        create_collaboration,
        "startTaskExecution(",
        "Canvas adapter still starts the legacy collaboration runtime",
    )

    create_project = go_function(
        atelier,
        "func (s *AtelierProjectionService) CreateProjectFromGoal(",
    )
    require(
        create_project,
        "createCollaborationTaskAfterCanvasReadiness(",
        "Atelier create does not use the canonical TaskRun writer",
    )
    require(
        create_project,
        '"client_idempotency_key": atelierProjectTaskRunCommandKey(req)',
        "Atelier create does not attach a deterministic command key",
    )
    forbid(
        create_project,
        "Create(&persistence.CollaborationTask",
        "Atelier create still writes CollaborationTask rows",
    )

    rerun = go_function(
        atelier,
        "func (s *OrchestrationService) createConfirmedFeedbackRerun(",
    )
    require(
        rerun,
        "createCollaborationTaskAfterCanvasReadiness(",
        "Atelier rerun does not use the canonical TaskRun writer",
    )
    forbid(
        rerun,
        "cloneAtelierFeedbackRerunTaskTx(",
        "Atelier rerun still calls the legacy clone writer",
    )
    forbid(
        atelier,
        "func cloneAtelierFeedbackRerunTaskTx(",
        "Legacy Atelier rerun writer remains in production source",
    )

    for needle, message in (
        (
            "loadAtelierCanonicalTaskRunAdapters(",
            "Atelier workspace does not load canonical TaskRuns",
        ),
        (
            "meta[\"writer\"] == taskRunCommandWriterVersion",
            "Atelier projection does not expose canonical TaskRun identity",
        ),
    ):
        require(atelier, needle, message)

    for source, needle, message in (
        (
            controller,
            "clientIdempotencyKey: submitKey",
            "Atelier UI does not forward the stable submit key",
        ),
        (
            controller,
            "clientIdempotencyKey: certificationCreateKey",
            "Atelier certification path does not forward a stable command key",
        ),
        (
            client,
            "payload.clientIdempotencyKey = input.clientIdempotencyKey.trim()",
            "Atelier client does not send the command key",
        ),
        (
            contract,
            '"clientIdempotencyKey"',
            "Atelier contract does not declare the command key",
        ),
        (
            orchestration_tests,
            "TestOrchestrationAtelierTaskRunWriterSkipsLegacyExecutionRows",
            "Canvas adapter writer regression coverage is missing",
        ),
        (
            atelier_tests,
            "TestAtelierCreateProjectWritesGoalBackedTaskRunWithoutCollaborationTask",
            "Atelier writer regression coverage is missing",
        ),
        (
            frontend_test,
            "keeps a stable command key and opens the returned canonical TaskRun",
            "Atelier frontend cutover regression coverage is missing",
        ),
    ):
        require(source, needle, message)

    print(
        "PASS Atelier and Canvas work commands use the Station-owned "
        "Goal-backed TaskRun writer, expose canonical identity, and do not "
        "create legacy CollaborationTask execution rows."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise SystemExit(1)
