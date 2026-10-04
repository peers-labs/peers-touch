#!/usr/bin/env python3
"""Run the PAOS-06 native Direct Model result Development Journey."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

ROOT = Path(__file__).resolve().parents[5]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tooling.acceptance.core.evidence_store import source_identity, workspace_id
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.gates.agent.capability_binding_development import (
    resolve_machine_profile,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientSpec,
    FoundationRuntimeClient,
)
from tooling.acceptance.gates.agent.personal_goal_slices.paos_01_home_draft import (
    PROFILE,
    authenticate,
    inspect_runtime_identity,
    navigate_to_hash,
    persisted_sensitive_profile_keys,
    require,
    runtime_profile_values,
    visible_element,
    wait_until,
    write_evidence_manifest,
)
from tooling.acceptance.gates.agent.personal_goal_slices.paos_03_goal_start import (
    read_goal,
    run_journey as run_goal_start_journey,
)
from tooling.acceptance.gates.agent.personal_goal_slices.paos_05_first_taskrun import (
    legacy_task_ids,
)

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"
TASK_STATUS_RUNNING = 2
TASK_STATUS_COMPLETED = 4
TASK_STATUS_FAILED = 5
EVENT_STEP_STARTED = 3
EVENT_STEP_COMPLETED = 4
EVENT_STEP_FAILED = 5
EVENT_ARTIFACT_CREATED = 7
EVENT_GATE_RESULT = 13


class DirectModelResultJourneyError(RuntimeError):
    """The PAOS-06 Development Journey failed."""


def refresh_home(client: FoundationRuntimeClient) -> None:
    result = client.driver.execute_async_script(
        """
        const done = arguments[0];
        import('/src/runtimes/homeRuntime.ts')
          .then(({ refreshHomeProjection }) =>
            refreshHomeProjection('paos-06-terminal-readback')
          )
          .then(() => done({ ok: true }))
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"Home refresh failed: {result}",
    )


def goal_execution_readback(
    client: FoundationRuntimeClient,
    task_id: str,
) -> dict[str, Any] | None:
    result = client.driver.execute_async_script(
        """
        const [taskId, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.getHomeWorkProjection(0n))
          .then((projection) => {
            const task = projection.activeTasks.find(
              (candidate) => candidate.taskId === taskId,
            );
            if (!task) {
              done({ ok: true, missing: true });
              return;
            }
            const brief = projection.briefItems.find(
              (candidate) =>
                candidate.sourceRef === taskId
                && candidate.briefId.startsWith('goal-result:'),
            );
            done({
              ok: true,
              goalId: task.goalId,
              nodeId: task.goalNodeId,
              taskId: task.taskId,
              stepId: task.stepId,
              attemptId: task.attemptId,
              attempt: task.attempt,
              agentId: task.agentId,
              status: task.status,
              surface: task.surface,
              summary: brief?.summary || '',
              briefId: brief?.briefId || '',
              artifactId: brief?.briefId.startsWith('goal-result:task:')
                ? ''
                : (brief?.briefId || '').replace(/^goal-result:/, ''),
            });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        task_id,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"Goal Direct Model readback failed: {result}",
    )
    if result.get("missing") is True:
        return None
    return dict(result)


def task_events(
    client: FoundationRuntimeClient,
    task_id: str,
) -> list[dict[str, Any]]:
    result = client.driver.execute_async_script(
        """
        const [taskId, done] = arguments;
        const eventTypes = {
          TASK_EVENT_TYPE_TASK_STATUS_CHANGED: 2,
          TASK_EVENT_TYPE_STEP_STARTED: 3,
          TASK_EVENT_TYPE_STEP_COMPLETED: 4,
          TASK_EVENT_TYPE_STEP_FAILED: 5,
          TASK_EVENT_TYPE_ARTIFACT_CREATED: 7,
          TASK_EVENT_TYPE_GATE_RESULT: 13,
        };
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.listAgentCollaborationEvents({
            task_id: taskId,
            after_event_seq: 0,
            page_size: 100,
          }))
          .then((response) => done({
            ok: true,
            events: response.events.map((event) => {
              const rawType =
                event.type ?? event.eventType ?? event.event_type;
              return {
                eventId: event.eventId || event.event_id || '',
                eventSeq: String(event.eventSeq ?? event.event_seq ?? 0),
                type: typeof rawType === 'string'
                  ? (eventTypes[rawType] ?? -1)
                  : (rawType ?? -1),
                payload: JSON.parse(
                  event.payloadJson || event.payload_json || '{}',
                ),
              };
            }),
          }))
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        task_id,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"Goal TaskRun event readback failed: {result}",
    )
    events = result.get("events")
    require(isinstance(events, list), "Goal TaskRun events are malformed")
    return [dict(event) for event in events if isinstance(event, Mapping)]


def terminal_execution(
    client: FoundationRuntimeClient,
    task_id: str,
) -> dict[str, Any] | None:
    refresh_home(client)
    execution = goal_execution_readback(client, task_id)
    if execution and execution.get("status") in (
        TASK_STATUS_COMPLETED,
        TASK_STATUS_FAILED,
    ):
        return execution
    return None


def run_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    actor_ptid: str,
) -> dict[str, Any]:
    navigate_to_hash(client, "home")
    wait_until(
        lambda: visible_element(client, "[data-pt-home]"),
        "Home surface",
    )
    legacy_before = legacy_task_ids(client)
    start_capture = run_goal_start_journey(
        client,
        artifact_dir,
        actor_ptid,
    )
    goal_id = str(start_capture["goalId"])
    task_id = str(start_capture["createdTaskId"])

    running_observed = False
    try:
        running_row = wait_until(
            lambda: visible_element(
                client,
                (
                    f'[data-pt-goal-run="{task_id}"]'
                    '[data-pt-goal-run-status="RUNNING"]'
                ),
            ),
            "running Goal TaskRun",
            timeout=30,
        )
        running_observed = running_row.is_displayed()
        client.driver.save_screenshot(
            str(artifact_dir / "goal-direct-model-running.png")
        )
    except Exception:
        running_observed = False

    terminal = wait_until(
        lambda: terminal_execution(client, task_id),
        "terminal Goal Direct Model result",
        timeout=180,
        interval=1,
    )
    require(
        terminal.get("goalId") == goal_id,
        "terminal TaskRun changed Goal identity",
    )
    require(bool(terminal.get("summary")), "terminal result has no summary")
    require(bool(terminal.get("artifactId")), "terminal result has no artifact")

    result_row = wait_until(
        lambda: visible_element(
            client,
            f'[data-pt-goal-result="{task_id}"]',
        ),
        "Home Goal result summary",
    )
    expected_state = (
        "succeeded"
        if terminal["status"] == TASK_STATUS_COMPLETED
        else "failed"
    )
    require(
        result_row.get_attribute("data-pt-goal-result-status")
        == expected_state,
        "Home Goal result status differs from Station",
    )
    require(
        result_row.get_attribute("data-pt-goal-result-artifact-id")
        == terminal["artifactId"],
        "Home Goal result artifact differs from Station",
    )
    summary = visible_element(
        client,
        f'[data-pt-goal-result="{task_id}"] [data-pt-goal-result-summary]',
    )
    require(
        str(summary.text or "").strip() == str(terminal["summary"]).strip(),
        "Home Goal result summary differs from Station",
    )
    terminal_screenshot = artifact_dir / "goal-direct-model-terminal.png"
    client.driver.save_screenshot(str(terminal_screenshot))

    events = wait_until(
        lambda: task_events(client, task_id),
        "Goal TaskRun events",
    )
    event_types = [int(event["type"]) for event in events]
    event_sequences = [int(event["eventSeq"]) for event in events]
    require(
        event_sequences == sorted(event_sequences)
        and len(event_sequences) == len(set(event_sequences)),
        "Goal TaskRun event sequence is not ordered and unique",
    )
    require(EVENT_STEP_STARTED in event_types, "TaskRun has no started event")
    require(
        EVENT_ARTIFACT_CREATED in event_types,
        "TaskRun has no artifact event",
    )
    require(EVENT_GATE_RESULT in event_types, "TaskRun has no gate event")
    expected_terminal_event = (
        EVENT_STEP_COMPLETED
        if terminal["status"] == TASK_STATUS_COMPLETED
        else EVENT_STEP_FAILED
    )
    require(
        expected_terminal_event in event_types,
        "TaskRun has no matching terminal step event",
    )
    require(
        event_types.index(EVENT_STEP_STARTED)
        < event_types.index(EVENT_ARTIFACT_CREATED)
        < event_types.index(expected_terminal_event),
        "TaskRun execution events are out of order",
    )

    artifact_event = next(
        event
        for event in events
        if int(event["type"]) == EVENT_ARTIFACT_CREATED
    )
    artifact_payload = artifact_event["payload"]
    require(
        artifact_payload.get("artifact_id") == terminal["artifactId"],
        "artifact event identity differs from Home",
    )
    require(
        artifact_payload.get("task_id") == task_id
        and artifact_payload.get("goal_id") == goal_id
        and artifact_payload.get("step_id") == terminal["stepId"]
        and artifact_payload.get("attempt_id") == terminal["attemptId"],
        "artifact event canonical identities do not agree",
    )
    usage_tokens = int(artifact_payload.get("input_tokens") or 0) + int(
        artifact_payload.get("output_tokens") or 0
    )
    if terminal["status"] == TASK_STATUS_COMPLETED:
        require(usage_tokens > 0, "successful Direct Model result has no usage")

    station_goal = read_goal(client, goal_id)
    require(
        station_goal.get("status") == 4,
        "TaskRun executor changed the Goal terminal state",
    )
    legacy_after = legacy_task_ids(client)
    require(
        legacy_after == legacy_before,
        "Goal Direct Model created AgentTask or CollaborationTask state",
    )
    require(
        running_observed or EVENT_STEP_STARTED in event_types,
        "running TaskRun state was not observable",
    )

    return {
        "actorPtid": actor_ptid,
        "goalId": goal_id,
        "taskId": task_id,
        "terminal": terminal,
        "events": events,
        "usageTokens": usage_tokens,
        "legacyBefore": legacy_before,
        "legacyAfter": legacy_after,
        "startCapture": start_capture,
        "screenshots": [
            str(terminal_screenshot),
            *(
                [str(artifact_dir / "goal-direct-model-running.png")]
                if running_observed
                else []
            ),
        ],
        "assertions": {
            "taskRunAttemptExecuted": True,
            "runningStateObserved": running_observed
            or EVENT_STEP_STARTED in event_types,
            "terminalResultVisible": True,
            "resultSummaryMatchesStation": True,
            "artifactLinked": True,
            "usageLinkedOnSuccess": terminal["status"] == TASK_STATUS_FAILED
            or usage_tokens > 0,
            "orderedEvents": True,
            "goalRemainsRunning": True,
            "zeroLegacyTaskWrites": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-06 requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-06 requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-06 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-06 requires a remote Station",
    )
    require(
        bool(profile_env.get("PT_STATION_DEPLOY_ENV")),
        "Profile two has no Station deploy environment",
    )

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    artifact_dir = (
        Path.home()
        / ".peers-touch"
        / "dev"
        / "workspaces"
        / workspace_id(ROOT)
        / "workflow"
        / WORK_ITEM_ID
        / "artifacts"
        / run_id
        / "paos-06-direct-model-result"
    )
    artifact_dir.mkdir(parents=True, exist_ok=False)
    profile_values = load_env_file(profile_file)
    os.environ["PT_ACCEPTANCE_APPROVED_PROFILE"] = PROFILE
    client = FoundationRuntimeClient(
        FoundationClientSpec(
            runtime="native-tauri",
            worktree=ROOT,
            gateway_port=3330 + slot * 100,
            renderer_port=3510 + slot * 100,
            webdriver_port=4445 + slot * 10,
            storage_root=artifact_dir / "native-storage",
            profile=PROFILE,
        ),
        station_url=str(profile_values["PT_STATION_URL"]),
        profile_env=runtime_profile_values(profile_values),
        startup_timeout=900,
        launch_env={"PT_STATION_SKIP_DEPLOY": "true"},
    )

    capture: dict[str, Any] = {}
    failure: BaseException | None = None
    cleanup: dict[str, Any] = {"status": "not-started"}
    try:
        client.start()
        actor_ptid = authenticate(client, profile_values)
        capture = run_journey(client, artifact_dir, actor_ptid)
        capture["profile"] = profile_name
        capture["source"] = source_identity(ROOT)
        capture["runtimeIdentity"] = inspect_runtime_identity(
            client,
            profile_values,
        )
        capture["verificationClass"] = "FUNCTIONAL_CHECK"
        capture["proofScope"] = "development-native-journey"
        capture["credentialRef"] = (
            "fixture:apps/station/app/conf/actor.yml#preset_users"
        )
    except BaseException as error:
        failure = error
        if client.driver is not None:
            client.driver.save_screenshot(str(artifact_dir / "failure.png"))
    finally:
        cleanup = client.stop(remove_storage=True)
        try:
            client.runtime_profile.unlink(missing_ok=True)
        except OSError as error:
            cleanup["failures"].append(f"runtime profile cleanup: {error}")
        cleanup["runtimeProfileReleased"] = not client.runtime_profile.exists()
        if not cleanup["runtimeProfileReleased"]:
            cleanup["failures"].append("runtime profile remains")
        if cleanup["failures"]:
            cleanup["status"] = "failed"

    capture["cleanup"] = cleanup
    leaked_profile_keys = persisted_sensitive_profile_keys(
        artifact_dir,
        profile_values,
    )
    capture["secretScan"] = {
        "status": "passed" if not leaked_profile_keys else "failed",
        "persistedSensitiveProfileKeyPaths": leaked_profile_keys,
    }
    capture_path = artifact_dir / "capture.json"
    capture_path.write_text(
        json.dumps(capture, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    manifest_path, manifest_digest = write_evidence_manifest(
        artifact_dir,
        capture_path,
        client.log_path,
        generator_path=Path(__file__),
    )
    if failure is not None:
        raise DirectModelResultJourneyError(
            f"{failure}; capture={capture_path}; manifest={manifest_path}; "
            f"manifestDigest={manifest_digest}; cleanup={cleanup}"
        ) from failure
    require(cleanup.get("status") == "clean", f"cleanup failed: {cleanup}")
    require(
        capture["secretScan"]["status"] == "passed",
        f"sensitive profile keys persisted: {leaked_profile_keys}",
    )
    require(
        all(capture["assertions"].values()),
        f"PAOS-06 assertions failed: {capture['assertions']}",
    )
    print(
        json.dumps(
            {
                "status": "PASS",
                "artifact": str(capture_path),
                "manifest": str(manifest_path),
                "manifestDigest": manifest_digest,
                "goalId": capture["goalId"],
                "taskId": capture["taskId"],
                "terminalStatus": capture["terminal"]["status"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
