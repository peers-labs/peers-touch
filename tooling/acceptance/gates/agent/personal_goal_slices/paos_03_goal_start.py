#!/usr/bin/env python3
"""Run the PAOS-03 native Goal admission and start Development Journey."""

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
    set_realtime_stream,
    visible_element,
    wait_until,
    write_evidence_manifest,
)
from tooling.acceptance.gates.agent.personal_goal_slices.paos_02_goal_contract import (
    read_goal,
    replace_value,
)

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"


class GoalStartJourneyError(RuntimeError):
    """The PAOS-03 Development Journey failed."""


def goal_surface(
    client: FoundationRuntimeClient,
    *,
    revision: str,
    status: str,
) -> Any:
    element = visible_element(client, "[data-pt-home-goal]")
    if (
        element.get_attribute("data-pt-home-goal-revision") == revision
        and element.get_attribute("data-pt-home-goal-status") == status
    ):
        return element
    return None


def active_task_ids(client: FoundationRuntimeClient) -> list[str]:
    result = client.driver.execute_async_script(
        """
        const done = arguments[0];
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.getHomeWorkProjection(0n))
          .then((projection) => done({
            ok: true,
            taskIds: projection.activeTasks.map((task) => task.taskId).sort(),
          }))
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"Home active Task readback failed: {result}",
    )
    task_ids = result.get("taskIds")
    require(isinstance(task_ids, list), "Home active Task readback is malformed")
    return [str(task_id) for task_id in task_ids]


def goal_initial_task_id(
    client: FoundationRuntimeClient,
    goal_id: str,
    title: str,
) -> str:
    result = client.driver.execute_async_script(
        """
        const [goalId, title, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.getHomeWorkProjection(0n))
          .then((projection) => {
            const task = projection.activeTasks.find(
              (candidate) =>
                candidate.goalId === goalId
                && candidate.title === title,
            );
            done({
              ok: true,
              taskId: task?.taskId || '',
            });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        goal_id,
        title,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"Home initial TaskRun readback failed: {result}",
    )
    task_id = str(result.get("taskId") or "")
    require(bool(task_id), "Goal start did not create its initial TaskRun")
    return task_id


def set_realtime_bridge(
    client: FoundationRuntimeClient,
    *,
    installed: bool,
) -> None:
    result = client.driver.execute_async_script(
        """
        const [installed, done] = arguments;
        import('/src/services/eventStream.ts')
          .then(async ({
            installEventStreamBridge,
            teardownEventStreamBridge,
          }) => {
            if (installed) {
              await installEventStreamBridge();
            } else {
              teardownEventStreamBridge();
            }
            done({ ok: true, installed });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        installed,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"set realtime bridge state failed: {result}",
    )


def reject_incomplete_review(
    client: FoundationRuntimeClient,
) -> dict[str, Any]:
    result = client.driver.execute_async_script(
        """
        const done = arguments[0];
        import('/src/runtimes/homeRuntime.ts')
          .then(({ reviewHomeGoalContract }) => reviewHomeGoalContract())
          .then((goal) => done({
            ok: true,
            goalId: goal.goalId,
            revision: goal.revision.toString(),
            status: goal.status,
          }))
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            errorType: error?.typedError?.error_type || '',
            reasonCode: error?.typedError?.details?.reason_code || '',
          }));
        """
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is False,
        f"incomplete Goal review unexpectedly succeeded: {result}",
    )
    require(
        result.get("errorType") == "GOAL_ADMISSION_REJECTED",
        f"incomplete Goal review error type mismatch: {result}",
    )
    require(
        result.get("reasonCode") == "max_tokens_missing",
        f"incomplete Goal review reason mismatch: {result}",
    )
    return dict(result)


def admit_outside_projection(
    client: FoundationRuntimeClient,
    *,
    goal_id: str,
    expected_revision: str,
    marker: str,
) -> dict[str, Any]:
    result = client.driver.execute_async_script(
        """
        const [goalId, expectedRevision, marker, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.admitAgentGoal({
            goalId,
            expectedRevision: BigInt(expectedRevision),
            idempotencyKey: `paos-03-concurrent-admit-${marker}`,
          }))
          .then((goal) => done({
            ok: true,
            goalId: goal.goalId,
            revision: goal.revision.toString(),
            status: goal.status,
          }))
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            code: error?.code || '',
            details: error?.details || {},
          }));
        """,
        goal_id,
        expected_revision,
        marker,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"concurrent Goal admission failed: {result}",
    )
    return dict(result)


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
    baseline_task_ids = active_task_ids(client)

    marker = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    title = f"PAOS-03 admitted Goal {marker}"
    outcome = "Admit and start the exact reviewed Station Goal."
    replace_value(
        visible_element(client, "[data-pt-home-goal-title]"),
        title,
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-outcome]"),
        outcome,
    )
    visible_element(client, "[data-pt-home-goal-create]").click()
    created = wait_until(
        lambda: goal_surface(client, revision="1", status="DRAFT"),
        "created Goal",
    )
    goal_id = str(created.get_attribute("data-pt-home-goal-id") or "")
    require(bool(goal_id), "created Goal has no identity")

    rejected_review = reject_incomplete_review(client)
    rejection = wait_until(
        lambda: visible_element(
            client,
            '[data-pt-home-goal-admission-error="max_tokens_missing"]',
        ),
        "Station-authored admission rejection",
    )
    require(
        rejection.is_displayed(),
        "Station-authored admission rejection is not visible",
    )
    admission_rejected_screenshot = (
        artifact_dir / "goal-start-admission-rejected.png"
    )
    client.driver.save_screenshot(str(admission_rejected_screenshot))

    replace_value(
        visible_element(client, "[data-pt-home-goal-outcome-readback]"),
        outcome,
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-non-goals]"),
        "Do not create TaskRun before admission",
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-constraints]"),
        "Preserve Station lifecycle ownership",
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-max-tokens]"),
        "120000",
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-max-cost]"),
        "12.5",
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-wall-time]"),
        "60",
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-max-parallel]"),
        "2",
    )
    visible_element(client, "[data-pt-home-goal-criterion-add]").click()
    replace_value(
        visible_element(
            client,
            "[data-pt-home-goal-criterion-description]",
        ),
        "Station readback reaches RUNNING",
    )
    visible_element(client, "[data-pt-home-goal-update]").click()
    wait_until(
        lambda: goal_surface(client, revision="2", status="DRAFT"),
        "saved Goal contract",
    )
    visible_element(client, "[data-pt-home-goal-review]").click()
    reviewed = wait_until(
        lambda: goal_surface(client, revision="3", status="REVIEWING"),
        "reviewed Goal",
    )
    review_panel = visible_element(
        client,
        "[data-pt-home-goal-review-panel]",
    )
    for assumption in (
        "outcome",
        "non-goals",
        "constraints",
        "budget",
        "acceptance",
    ):
        require(
            review_panel.find_element(
                "css selector",
                f'[data-pt-home-goal-assumption="{assumption}"]',
            ).is_displayed(),
            f"review assumption is not visible: {assumption}",
        )
    require(
        active_task_ids(client) == baseline_task_ids,
        "Goal review created hidden active work",
    )
    reviewed_screenshot = artifact_dir / "goal-start-reviewed.png"
    client.driver.save_screenshot(str(reviewed_screenshot))

    set_realtime_bridge(client, installed=False)
    set_realtime_stream(client, running=False)
    try:
        concurrent = admit_outside_projection(
            client,
            goal_id=goal_id,
            expected_revision="3",
            marker=marker,
        )
        require(concurrent.get("revision") == "4", "Goal admission revision mismatch")
        require(concurrent.get("status") == 3, "Goal admission did not reach READY")
        require(
            active_task_ids(client) == baseline_task_ids,
            "Goal admission created hidden active work",
        )

        visible_element(client, "[data-pt-home-goal-start]").click()
        conflict = wait_until(
            lambda: visible_element(client, "[data-pt-home-goal-conflict]"),
            "stale Goal admission rejection",
        )
        require(
            conflict.is_displayed(),
            "stale Goal admission rejection is not visible",
        )
        conflict_screenshot = artifact_dir / "goal-start-stale-conflict.png"
        client.driver.save_screenshot(str(conflict_screenshot))

        visible_element(
            client,
            "[data-pt-home-goal-conflict-reload]",
        ).click()
        wait_until(
            lambda: goal_surface(client, revision="4", status="READY"),
            "admitted Goal readback",
        )
    finally:
        set_realtime_bridge(client, installed=True)
        set_realtime_stream(client, running=True)

    wait_until(
        lambda: visible_element(
            client,
            '[data-pt-home-connection-state="fresh"]',
        ),
        "fresh Home connection after conflict readback",
    )
    visible_element(client, "[data-pt-home-goal-start]").click()
    running = wait_until(
        lambda: goal_surface(client, revision="5", status="RUNNING"),
        "running Goal",
    )
    require(
        visible_element(client, "[data-pt-home-goal-running]"),
        "running Goal acknowledgement is not visible",
    )
    running_screenshot = artifact_dir / "goal-start-running.png"
    client.driver.save_screenshot(str(running_screenshot))

    station_goal = read_goal(client, goal_id)
    require(station_goal.get("ownerPtid") == actor_ptid, "Goal owner changed")
    require(station_goal.get("outcome") == outcome, "Goal outcome changed")
    require(station_goal.get("revision") == "5", "Goal revision mismatch")
    require(station_goal.get("status") == 4, "Goal did not reach RUNNING")
    final_task_ids = active_task_ids(client)
    new_task_ids = sorted(set(final_task_ids) - set(baseline_task_ids))
    require(
        len(new_task_ids) >= 1,
        f"Goal start did not create its initial TaskRun: {new_task_ids}",
    )
    initial_task_id = goal_initial_task_id(client, goal_id, title)
    require(
        initial_task_id in new_task_ids,
        f"Goal initial TaskRun is outside the new Goal work: {new_task_ids}",
    )
    require(
        running.get_attribute("data-pt-home-goal-revision") == "5",
        "Home does not expose the running Station revision",
    )

    return {
        "goalId": goal_id,
        "revision": station_goal["revision"],
        "ownerPtid": station_goal["ownerPtid"],
        "admissionRejection": rejected_review,
        "baselineTaskIds": baseline_task_ids,
        "finalTaskIds": final_task_ids,
        "createdTaskId": initial_task_id,
        "screenshots": [
            str(admission_rejected_screenshot),
            str(reviewed_screenshot),
            str(conflict_screenshot),
            str(running_screenshot),
        ],
        "assertions": {
            "materialAssumptionsVisible": True,
            "stationAdmissionRejectedVisibly": True,
            "staleAdmissionConflictVisibly": True,
            "admissionReachedReady": True,
            "startReachedRunning": True,
            "stationReadbackMatches": True,
            "zeroExecutableWorkBeforeStart": True,
            "firstTaskRunCreatedAtStart": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-03 requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-03 requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-03 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-03 requires a remote Station",
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
        / "paos-03-goal-start"
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
        capture["actorPtid"] = actor_ptid
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
        raise GoalStartJourneyError(
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
        f"PAOS-03 assertions failed: {capture['assertions']}",
    )
    print(json.dumps({
        "status": "PASS",
        "artifact": str(capture_path),
        "manifest": str(manifest_path),
        "manifestDigest": manifest_digest,
        "goalId": capture["goalId"],
        "revision": capture["revision"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
