#!/usr/bin/env python3
"""Run the PAOS-05 native first canonical TaskRun Development Journey."""

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
    run_journey as run_goal_start_journey,
)

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"


class FirstTaskRunJourneyError(RuntimeError):
    """The PAOS-05 Development Journey failed."""


def legacy_task_ids(client: FoundationRuntimeClient) -> dict[str, list[str]]:
    result = client.driver.execute_async_script(
        """
        const done = arguments[0];
        import('/src/services/desktop_api.ts')
          .then(async ({ api }) => {
            const [agentTasks, collaboration] = await Promise.all([
              api.listAgentTasksRemote(),
              api.listAgentCollaborationTasks(),
            ]);
            done({
              ok: true,
              agentTaskIds: agentTasks.map((task) => task.id).sort(),
              collaborationTaskIds: (collaboration.tasks || [])
                .map((task) => task.taskId)
                .sort(),
            });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"legacy task readback failed: {result}",
    )
    return {
        "agentTaskIds": [
            str(value) for value in result.get("agentTaskIds", [])
        ],
        "collaborationTaskIds": [
            str(value)
            for value in result.get("collaborationTaskIds", [])
        ],
    }


def goal_execution_readback(
    client: FoundationRuntimeClient,
    goal_id: str,
) -> dict[str, Any] | None:
    result = client.driver.execute_async_script(
        """
        const [goalId, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.getHomeWorkProjection(0n))
          .then((projection) => {
            const task = projection.activeTasks.find(
              (candidate) => candidate.goalId === goalId,
            );
            done(task ? {
              ok: true,
              goalId: task.goalId,
              nodeId: task.goalNodeId,
              taskId: task.taskId,
              stepId: task.stepId,
              attemptId: task.attemptId,
              attempt: task.attempt,
              status: task.status,
              surface: task.surface,
              workspaceId: task.workspaceId,
            } : { ok: true, missing: true });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        goal_id,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"Goal execution readback failed: {result}",
    )
    if result.get("missing") is True:
        return None
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
    legacy_before = legacy_task_ids(client)
    start_capture = run_goal_start_journey(
        client,
        artifact_dir,
        actor_ptid,
    )
    goal_id = str(start_capture["goalId"])
    execution = wait_until(
        lambda: goal_execution_readback(client, goal_id),
        "canonical Goal TaskRun readback",
    )

    for field in ("goalId", "nodeId", "taskId", "stepId", "attemptId"):
        require(bool(execution.get(field)), f"Goal execution has no {field}")
    require(execution.get("goalId") == goal_id, "Goal identity changed")
    require(execution.get("attempt") == 1, "first attempt is not attempt 1")
    require(execution.get("status") in (1, 2), "TaskRun is not pending/running")

    task_id = str(execution["taskId"])
    visible_element(
        client,
        f'[data-pt-goal-run="{task_id}"]',
    ).click()
    selected = wait_until(
        lambda: visible_element(client, "[data-pt-goal-run-readback]"),
        "selected Goal TaskRun identity",
    )
    expected_attributes = {
        "data-pt-goal-id": execution["goalId"],
        "data-pt-goal-node-id": execution["nodeId"],
        "data-pt-goal-task-id": execution["taskId"],
        "data-pt-goal-step-id": execution["stepId"],
        "data-pt-goal-attempt-id": execution["attemptId"],
    }
    for attribute, expected in expected_attributes.items():
        require(
            selected.get_attribute(attribute) == expected,
            f"selected Goal execution {attribute} mismatch",
        )

    legacy_after = legacy_task_ids(client)
    require(
        legacy_after == legacy_before,
        "Goal start created AgentTask or CollaborationTask state",
    )
    screenshot = artifact_dir / "goal-first-taskrun-selected.png"
    client.driver.save_screenshot(str(screenshot))
    return {
        "actorPtid": actor_ptid,
        "goalId": goal_id,
        "execution": execution,
        "legacyBefore": legacy_before,
        "legacyAfter": legacy_after,
        "startCapture": start_capture,
        "screenshots": [str(screenshot)],
        "assertions": {
            "oneCanonicalTaskRunCreated": True,
            "goalNodeTaskStepAttemptLinked": True,
            "homeShowsPendingOrRunningTaskRun": True,
            "selectedRowReadsCanonicalStationIds": True,
            "zeroLegacyTaskWrites": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-05 requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-05 requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-05 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-05 requires a remote Station",
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
        / "paos-05-first-taskrun"
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
        raise FirstTaskRunJourneyError(
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
        f"PAOS-05 assertions failed: {capture['assertions']}",
    )
    print(json.dumps({
        "status": "PASS",
        "artifact": str(capture_path),
        "manifest": str(manifest_path),
        "manifestDigest": manifest_digest,
        "goalId": capture["goalId"],
        "taskId": capture["execution"]["taskId"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
