#!/usr/bin/env python3
"""Run the PAOS-16 native active Goal cancellation Development Journey."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
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
from tooling.acceptance.gates.agent.personal_goal_slices.paos_02_goal_contract import (
    read_goal,
)
from tooling.acceptance.gates.agent.personal_goal_slices.paos_03_goal_start import (
    goal_surface,
    run_journey as run_goal_start_journey,
)
from tooling.acceptance.gates.agent.personal_goal_slices.paos_06_direct_model_result import (
    refresh_home,
    task_events,
)

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"
TASK_STATUS_CANCELLED = 6


class ActiveCancellationJourneyError(RuntimeError):
    """The PAOS-16 Development Journey failed."""


def source_guards() -> dict[str, bool]:
    cancellation = (
        ROOT
        / "apps/station/app/subserver/agent/service/"
        "goal_cancellation_service.go"
    ).read_text(encoding="utf-8")
    executor = (
        ROOT
        / "apps/station/app/subserver/agent/service/"
        "goal_direct_model_executor.go"
    ).read_text(encoding="utf-8")
    control = (
        ROOT
        / "apps/desktop/src/components/home/"
        "GoalActiveCancelControl.tsx"
    ).read_text(encoding="utf-8")
    return {
        "durableMutationBeforeSignal": (
            "runGoalMutationTx(" in cancellation
            and "s.canceller.Cancel(" in cancellation
            and cancellation.index("runGoalMutationTx(")
            < cancellation.index("s.canceller.Cancel(")
        ),
        "leaseGenerationFenced": (
            "fenceGoalCoordinatorCancellationTx" in cancellation
        ),
        "runtimeAttemptCancelled": (
            '"state":      "cancelled"' in cancellation
        ),
        "lateResultFence": "goalCancellationPersisted" in executor,
        "activeExecutionSignal": (
            "registerActiveExecution" in executor
            and "func (e *GoalDirectModelExecutor) Cancel(" in executor
        ),
        "pendingVisibleBeforeReadback": (
            "data-pt-home-goal-active-cancellation-state" in control
            and "'CANCELLING'" in control
        ),
    }


def install_readback_barrier(client: FoundationRuntimeClient) -> None:
    result = client.driver.execute_async_script(
        """
        const done = arguments[0];
        import('/src/services/desktop_api.ts')
          .then(({ api }) => {
            const originalCancel = api.cancelAgentGoal;
            const originalGet = api.getAgentGoal;
            const trace = {
              acknowledged: false,
              readbackStarted: false,
              released: false,
              acknowledgementRevision: '',
              readbackRevision: '',
            };
            let releaseReadback;
            api.cancelAgentGoal = async (input) => {
              const goal = await originalCancel(input);
              trace.acknowledged = true;
              trace.acknowledgementRevision = goal.revision.toString();
              return goal;
            };
            api.getAgentGoal = async (goalId) => {
              if (trace.acknowledged && !trace.released) {
                trace.readbackStarted = true;
                await new Promise((resolve) => {
                  releaseReadback = resolve;
                });
              }
              const goal = await originalGet(goalId);
              trace.readbackRevision = goal.revision.toString();
              return goal;
            };
            window.__paos16CancelTrace = trace;
            window.__paos16ReleaseReadback = () => {
              trace.released = true;
              releaseReadback?.();
            };
            window.__paos16RestoreApi = () => {
              api.cancelAgentGoal = originalCancel;
              api.getAgentGoal = originalGet;
              delete window.__paos16ReleaseReadback;
              delete window.__paos16RestoreApi;
            };
            done({ ok: true });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"install active cancellation readback barrier failed: {result}",
    )


def goal_task_readback(
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
            done(task ? {
              ok: true,
              task: {
                goalId: task.goalId,
                nodeId: task.goalNodeId,
                taskId: task.taskId,
                stepId: task.stepId,
                attemptId: task.attemptId,
                status: task.status,
              },
            } : { ok: true, missing: true });
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
        f"active Goal TaskRun readback failed: {result}",
    )
    task = result.get("task")
    return dict(task) if isinstance(task, Mapping) else None


def cancelled_task(
    client: FoundationRuntimeClient,
    task_id: str,
) -> dict[str, Any] | None:
    task = goal_task_readback(client, task_id)
    if task and task.get("status") == TASK_STATUS_CANCELLED:
        return task
    return None


def active_cancel_button(
    client: FoundationRuntimeClient,
) -> Any | None:
    try:
        return visible_element(
            client,
            "[data-pt-home-goal-active-cancel]",
        )
    except Exception:
        return None


def run_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    actor_ptid: str,
) -> dict[str, Any]:
    guards = source_guards()
    require(
        all(guards.values()),
        f"active cancellation source guard failed: {guards}",
    )
    start = run_goal_start_journey(client, artifact_dir, actor_ptid)
    goal_id = str(start["goalId"])
    task_id = str(start["createdTaskId"])
    title = str(
        visible_element(client, "[data-pt-home-goal]").text or goal_id
    ).splitlines()[0]

    button = wait_until(
        lambda: active_cancel_button(client),
        "active Goal cancellation control",
        timeout=30,
        interval=0.1,
    )
    events_before = task_events(client, task_id)
    event_ids_before = [
        str(event.get("eventId") or "")
        for event in events_before
        if event.get("eventId")
    ]
    install_readback_barrier(client)
    button.click()
    confirmation = wait_until(
        lambda: visible_element(
            client,
            "[data-pt-home-goal-active-cancel-confirm]",
        ),
        "active Goal cancellation confirmation",
    )
    require(
        goal_id in str(
            confirmation.get_attribute(
                "data-pt-home-goal-active-cancel-confirm"
            )
            or ""
        ),
        "active cancellation confirmation lost Goal identity",
    )
    confirmation.click()

    wait_until(
        lambda: client.driver.execute_script(
            """
            return Boolean(
              window.__paos16CancelTrace?.acknowledged
              && window.__paos16CancelTrace?.readbackStarted
            );
            """
        ),
        "active cancellation acknowledgement before readback",
    )
    cancelling = visible_element(
        client,
        (
            "[data-pt-home-goal-active-cancellation-state="
            '"CANCELLING"]'
        ),
    )
    require(cancelling.is_displayed(), "CANCELLING is not visible")
    require(
        goal_surface(client, revision="5", status="RUNNING") is not None,
        "Home exposed CANCELLED before Station readback",
    )
    pending_screenshot = artifact_dir / "goal-active-cancelling.png"
    client.driver.save_screenshot(str(pending_screenshot))

    client.driver.execute_script("window.__paos16ReleaseReadback?.();")
    wait_until(
        lambda: goal_surface(client, revision="6", status="CANCELLED"),
        "cancelled active Goal readback",
    )
    wait_until(
        lambda: visible_element(client, "[data-pt-home-goal-cancelled]"),
        "cancelled active Goal acknowledgement",
    )
    client.driver.execute_script("window.__paos16RestoreApi?.();")
    cancelled_screenshot = artifact_dir / "goal-active-cancelled.png"
    client.driver.save_screenshot(str(cancelled_screenshot))

    station_goal = read_goal(client, goal_id)
    task = wait_until(
        lambda: cancelled_task(client, task_id),
        "cancelled Goal TaskRun readback",
    )
    require(station_goal.get("status") == 12, "Goal is not CANCELLED")
    require(station_goal.get("revision") == "6", "Goal revision is not 6")
    require(
        task.get("goalId") == goal_id,
        f"cancelled TaskRun changed Goal identity: {task}",
    )

    time.sleep(3)
    refresh_home(client)
    stable_goal = read_goal(client, goal_id)
    stable_task = goal_task_readback(client, task_id)
    events_after = task_events(client, task_id)
    event_ids_after = [
        str(event.get("eventId") or "")
        for event in events_after
        if event.get("eventId")
    ]
    require(
        stable_goal.get("status") == 12
        and stable_goal.get("revision") == "6",
        f"late executor result reopened Goal: {stable_goal}",
    )
    require(
        stable_task is not None
        and stable_task.get("status") == TASK_STATUS_CANCELLED,
        f"late executor result reopened TaskRun: {stable_task}",
    )
    require(
        all(event_id in event_ids_after for event_id in event_ids_before),
        "cancellation hid previously committed TaskRun evidence",
    )
    trace = client.driver.execute_script(
        "return { ...window.__paos16CancelTrace };"
    )
    require(
        trace.get("acknowledgementRevision")
        == trace.get("readbackRevision") == "6",
        f"cancellation acknowledgement/readback mismatch: {trace}",
    )

    return {
        "actorPtid": actor_ptid,
        "goalId": goal_id,
        "taskId": task_id,
        "goal": stable_goal,
        "task": stable_task,
        "readbackBarrier": trace,
        "taskEventIdsBeforeCancellation": event_ids_before,
        "taskEventIdsAfterRefresh": event_ids_after,
        "sourceGuards": guards,
        "screenshots": [
            str(pending_screenshot),
            str(cancelled_screenshot),
        ],
        "assertions": {
            "activeCancelVisible": True,
            "cancellingVisibleBeforeReadback": True,
            "stationGoalCancelled": True,
            "taskRunCancelled": True,
            "lateResultDidNotResurrect": True,
            "committedEvidencePreserved": True,
            "refreshPreservedCancellation": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-16 requires a real Home UI action")
    require(
        args.require_station_readback,
        "PAOS-16 requires Station Goal and TaskRun readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-16 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-16 requires a remote Station",
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
        / "paos-16-active-cancellation"
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
        navigate_to_hash(client, "home")
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
        if client.driver is not None:
            try:
                client.driver.execute_script(
                    "window.__paos16ReleaseReadback?.();"
                    "window.__paos16RestoreApi?.();"
                )
            except Exception:
                pass
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
        raise ActiveCancellationJourneyError(
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
        f"PAOS-16 assertions failed: {capture['assertions']}",
    )
    print(json.dumps({
        "status": "PASS",
        "artifact": str(capture_path),
        "manifest": str(manifest_path),
        "manifestDigest": manifest_digest,
        "goalId": capture["goalId"],
        "taskId": capture["taskId"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
