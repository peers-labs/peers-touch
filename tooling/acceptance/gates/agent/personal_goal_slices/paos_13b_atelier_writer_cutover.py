#!/usr/bin/env python3
"""Run the PAOS-13B native Atelier TaskRun writer cutover Journey."""

from __future__ import annotations

import argparse
import hashlib
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
from tooling.acceptance.gates.agent.personal_goal_slices.paos_12_collab_task_migration import (
    atelier_request,
    load_workspace,
)
from tooling.acceptance.gates.agent.personal_goal_slices.paos_13_task_writer_cutover import (
    legacy_inventory,
    task_events,
)

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"
APPLET_ID = "peers.atelier"


class AtelierTaskRunWriterCutoverJourneyError(RuntimeError):
    """The PAOS-13B Development Journey failed."""


def configured_agent_id(client: FoundationRuntimeClient) -> str:
    result = client.driver.execute_async_script(
        """
        const done = arguments[0];
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.listAgents())
          .then((agents) => {
            const agent = agents.find((candidate) => Boolean(candidate.id));
            done(agent
              ? { ok: true, agentId: agent.id }
              : { ok: false, message: 'Station has no configured Agent' });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"configured Agent lookup failed: {result}",
    )
    agent_id = str(result.get("agentId") or "")
    require(bool(agent_id), "configured Agent lookup returned no identity")
    return agent_id


def canonical_atelier_task(
    snapshot: Mapping[str, Any],
    title: str,
) -> dict[str, Any] | None:
    workspace = snapshot.get("workspace")
    if not isinstance(workspace, Mapping):
        return None
    tasks = workspace.get("tasks")
    projects = workspace.get("projects")
    if not isinstance(tasks, list) or not isinstance(projects, list):
        return None
    for raw_task in tasks:
        if not isinstance(raw_task, Mapping) or raw_task.get("title") != title:
            continue
        task = dict(raw_task)
        task_id = str(task.get("id") or "")
        goal_id = str(task.get("goalId") or "")
        task_run_id = str(task.get("taskRunId") or "")
        project = next(
            (
                dict(candidate)
                for candidate in projects
                if isinstance(candidate, Mapping)
                and candidate.get("id") == goal_id
            ),
            None,
        )
        if (
            task_id
            and goal_id
            and task_run_id == task_id
            and isinstance(project, Mapping)
        ):
            return {
                "selectedTaskId": str(snapshot.get("selectedTaskId") or ""),
                "taskId": task_id,
                "taskRunId": task_run_id,
                "goalId": goal_id,
                "projectId": str(task.get("projectId") or ""),
                "legacySourceId": str(task.get("legacySourceId") or ""),
                "migrationState": str(task.get("migrationState") or ""),
                "projectGoalId": str(project.get("goalId") or ""),
                "projectTaskRunId": str(project.get("taskRunId") or ""),
            }
    return None


def home_task_readback(
    client: FoundationRuntimeClient,
    task_id: str,
) -> dict[str, str] | None:
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
              taskId: task.taskId,
              goalId: task.goalId,
              goalNodeId: task.goalNodeId,
              stepId: task.stepId,
              attemptId: task.attemptId,
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
        f"canonical TaskRun readback failed: {result}",
    )
    if result.get("missing") is True:
        return None
    return {
        "taskId": str(result.get("taskId") or ""),
        "goalId": str(result.get("goalId") or ""),
        "goalNodeId": str(result.get("goalNodeId") or ""),
        "stepId": str(result.get("stepId") or ""),
        "attemptId": str(result.get("attemptId") or ""),
    }


def open_atelier_and_read_task(
    client: FoundationRuntimeClient,
    title: str,
    create_request: Mapping[str, Any],
) -> dict[str, Any]:
    navigate_to_hash(client, f"applet:{APPLET_ID}")
    wait_until(
        lambda: visible_element(
            client,
            f'[data-applet-runtime="{APPLET_ID}"]',
        ),
        "Atelier runtime shell",
        timeout=120,
    )
    created = atelier_request(
        client,
        "POST",
        "/v1/projects",
        create_request,
    )
    projected = canonical_atelier_task(created, title)
    require(
        isinstance(projected, Mapping),
        "Atelier create response has no canonical Goal-backed TaskRun",
    )
    readback = wait_until(
        lambda: canonical_atelier_task(load_workspace(client), title),
        "Atelier canonical Goal-backed TaskRun",
        timeout=180,
    )
    require(
        readback.get("taskId") == projected.get("taskId")
        and readback.get("goalId") == projected.get("goalId"),
        "Atelier workspace readback changed canonical identity",
    )
    return dict(projected)


def run_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    actor_ptid: str,
) -> dict[str, Any]:
    marker = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    title = f"PAOS-13B Atelier TaskRun {marker}"
    agent_id = configured_agent_id(client)
    legacy_before = legacy_inventory(client)
    client_idempotency_key = f"paos-13b:{marker}"
    create_request = {
        "agentIds": [agent_id],
        "clientIdempotencyKey": client_idempotency_key,
        "goal": title,
        "intentPreset": "work",
        "project": "peers-touch",
        "run": {
            "agentIds": [agent_id],
            "flowId": "expert-hierarchy",
            "kind": "agents",
        },
    }

    first = open_atelier_and_read_task(client, title, create_request)
    task_id = str(first.get("taskId") or "")
    goal_id = str(first.get("goalId") or "")
    require(first.get("selectedTaskId") == task_id, "Atelier did not select the returned TaskRun")
    require(first.get("projectId") == goal_id, "Atelier project identity is not the Goal ID")
    require(first.get("projectGoalId") == goal_id, "project projection lost Goal identity")
    require(first.get("projectTaskRunId") == task_id, "project projection lost TaskRun identity")
    require(not first.get("legacySourceId"), "new Atelier work exposes a legacy source identity")
    require(not first.get("migrationState"), "new Atelier work is incorrectly marked as migrated")

    station_task = wait_until(
        lambda: home_task_readback(client, task_id),
        "Station TaskRun and Goal readback",
    )
    require(station_task.get("taskId") == task_id, "Station changed TaskRun identity")
    require(station_task.get("goalId") == goal_id, "Station changed Goal identity")
    require(bool(station_task.get("goalNodeId")), "Station readback has no GoalNode identity")
    require(bool(station_task.get("stepId")), "Station readback has no ExecutionStep identity")
    require(bool(station_task.get("attemptId")), "Station readback has no attempt identity")
    created_event = wait_until(
        lambda: task_events(client, task_id),
        "Atelier TaskRun creation event",
    )
    legacy_after_create = legacy_inventory(client)
    require(
        legacy_after_create == legacy_before,
        "Atelier create wrote a legacy CollaborationTask row",
    )
    first_screenshot = artifact_dir / "atelier-taskrun-created.png"
    client.driver.save_screenshot(str(first_screenshot))

    client.restart()
    replayed = open_atelier_and_read_task(client, title, create_request)
    legacy_after_replay = legacy_inventory(client)
    require(replayed.get("taskId") == task_id, "Atelier replay created a second TaskRun")
    require(replayed.get("goalId") == goal_id, "Atelier replay created a second Goal")
    require(
        legacy_after_replay == legacy_before,
        "Atelier replay wrote a legacy CollaborationTask row",
    )
    replay_screenshot = artifact_dir / "atelier-taskrun-replayed.png"
    client.driver.save_screenshot(str(replay_screenshot))

    return {
        "actorPtid": actor_ptid,
        "agentId": agent_id,
        "clientIdempotencyKeyHash": hashlib.sha256(
            client_idempotency_key.encode("utf-8")
        ).hexdigest(),
        "title": title,
        "taskId": task_id,
        "goalId": goal_id,
        "firstProjection": first,
        "replayedProjection": replayed,
        "stationReadback": station_task,
        "taskCreatedEvent": created_event,
        "legacyBefore": legacy_before,
        "legacyAfterCreate": legacy_after_create,
        "legacyAfterReplay": legacy_after_replay,
        "screenshots": [
            str(first_screenshot),
            str(replay_screenshot),
        ],
        "assertions": {
            "officialAtelierCreateReachedStation": True,
            "selectedIdentityIsCanonicalTaskRun": True,
            "taskRunHasCanonicalGoal": True,
            "taskRunHasGoalNodeStepAndAttempt": True,
            "stableReplayIdentity": True,
            "zeroLegacyCollaborationTaskWrites": True,
            "nativeAtelierSurfaceVisible": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-13B requires the native Atelier surface")
    require(
        args.require_station_readback,
        "PAOS-13B requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-13B requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-13B requires a remote Station",
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
        / "paos-13b-atelier-writer-cutover"
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
        raise AtelierTaskRunWriterCutoverJourneyError(
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
        f"PAOS-13B assertions failed: {capture['assertions']}",
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
