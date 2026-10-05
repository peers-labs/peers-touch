#!/usr/bin/env python3
"""Run the PAOS-14 canonical TaskRun reader cutover Journey."""

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
from tooling.acceptance.gates.agent.personal_goal_slices.paos_12_collab_task_migration import (
    atelier_request,
    load_workspace,
)
from tooling.acceptance.gates.agent.personal_goal_slices.paos_13b_atelier_writer_cutover import (
    collaboration_task_inventory,
    configured_agent_id,
)

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"
APPLET_ID = "peers.atelier"


class TaskReaderCutoverJourneyError(RuntimeError):
    """The PAOS-14 Development Journey failed."""


def source_guards() -> dict[str, bool]:
    home = (
        ROOT
        / "apps/station/app/subserver/agent/service/home_projection_service.go"
    ).read_text(encoding="utf-8")
    atelier = (
        ROOT
        / "apps/station/app/subserver/agent/service/atelier_projection.go"
    ).read_text(encoding="utf-8")
    agent_tasks = (
        ROOT
        / "apps/station/app/subserver/agent/service/agent_task_service.go"
    ).read_text(encoding="utf-8")
    desktop_tasks = (
        ROOT / "apps/desktop/src/store/tasks.ts"
    ).read_text(encoding="utf-8")
    desktop_home = (
        ROOT / "apps/desktop/src/store/home.ts"
    ).read_text(encoding="utf-8")
    return {
        "homeHasNoLegacyTaskList": "ListTasks(ctx, ptid" not in home,
        "homeMigrationReadDoesNotRescanLegacy": (
            "MigrateAgentTasks(db)" not in agent_tasks
        ),
        "atelierHasNoLegacyTaskList": (
            "var taskRecords []persistence.CollaborationTask" not in atelier
            and "loadAtelierNodesByTask" not in atelier
        ),
        "desktopHasNoLegacyTaskList": "listAgentTasksRemote" not in desktop_tasks,
        "unknownStatusIsUnavailable": (
            "return \"unavailable\"" in atelier
            and "return 'unavailable'" in desktop_home
        ),
    }


def task_from_atelier(
    snapshot: Mapping[str, Any],
    *,
    task_id: str = "",
    title: str = "",
    migrated: bool = False,
) -> dict[str, Any] | None:
    workspace = snapshot.get("workspace")
    if not isinstance(workspace, Mapping):
        return None
    tasks = workspace.get("tasks")
    if not isinstance(tasks, list):
        return None
    for value in tasks:
        if not isinstance(value, Mapping):
            continue
        if task_id and str(value.get("id") or "") != task_id:
            continue
        if title and str(value.get("title") or "") != title:
            continue
        if migrated and str(value.get("migrationState") or "") != "migrated":
            continue
        return dict(value)
    return None


def home_task_readback(
    client: FoundationRuntimeClient,
    task_id: str,
) -> dict[str, Any] | None:
    result = client.driver.execute_async_script(
        """
        const [taskId, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.getHomeWorkProjection(0n))
          .then((projection) => {
            const names = {
              1: 'pending',
              2: 'running',
              3: 'needs_user',
              4: 'completed',
              5: 'failed',
              6: 'cancelled',
            };
            const task = projection.activeTasks.find(
              (candidate) => candidate.taskId === taskId,
            );
            done(task ? {
              ok: true,
              revision: projection.revision.toString(),
              taskId: task.taskId,
              goalId: task.goalId,
              goalNodeId: task.goalNodeId,
              stepId: task.stepId,
              attemptId: task.attemptId,
              attempt: task.attempt,
              legacySourceId: task.legacySourceId,
              status: names[task.status] || 'unavailable',
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
        f"Home TaskRun readback failed: {result}",
    )
    if result.get("missing") is True:
        return None
    return dict(result)


def task_store_readback(
    client: FoundationRuntimeClient,
    task_id: str,
) -> dict[str, Any]:
    result = client.driver.execute_async_script(
        """
        const [taskId, done] = arguments;
        import('/src/store/tasks.ts')
          .then(async ({ useTaskStore }) => {
            useTaskStore.setState({
              tasks: [{
                id: 'cached-stale-task',
                title: 'stale',
                description: '',
                agentId: 'stale',
                status: 'completed',
                priority: 'medium',
                progress: 100,
                subtasks: [],
                createdAt: 1,
                updatedAt: 1,
              }],
              sourcePtid: '',
              sourceRevision: 0n,
            });
            await useTaskStore.getState().loadTasks();
            const state = useTaskStore.getState();
            const task = state.tasks.find((candidate) => candidate.id === taskId);
            done({
              ok: true,
              found: Boolean(task),
              status: task?.status || '',
              sourceRevision: state.sourceRevision.toString(),
              staleCachePresent: state.tasks.some(
                (candidate) => candidate.id === 'cached-stale-task',
              ),
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
        f"Desktop task store readback failed: {result}",
    )
    return dict(result)


def run_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    actor_ptid: str,
) -> dict[str, Any]:
    guards = source_guards()
    require(all(guards.values()), f"canonical reader source guard failed: {guards}")

    marker = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    title = f"PAOS-14 TaskRun reader {marker}"
    agent_id = configured_agent_id(client)
    legacy_before = collaboration_task_inventory(client)
    create_request = {
        "agentIds": [agent_id],
        "clientIdempotencyKey": f"paos-14:{marker}",
        "goal": title,
        "intentPreset": "work",
        "project": "peers-touch",
        "run": {
            "agentIds": [agent_id],
            "flowId": "expert-hierarchy",
            "kind": "agents",
        },
    }
    created = atelier_request(client, "POST", "/v1/projects", create_request)
    new_task = task_from_atelier(created, title=title)
    require(new_task is not None, "Atelier create response omitted the new TaskRun")
    task_id = str(new_task.get("id") or "")
    home_new = wait_until(
        lambda: home_task_readback(client, task_id),
        "new TaskRun in Home projection",
    )
    require(
        new_task.get("executionStatus") == home_new.get("status"),
        f"new TaskRun status mismatch: Atelier={new_task} Home={home_new}",
    )
    require(
        str(new_task.get("stepId") or "") == str(home_new.get("stepId") or "")
        and str(new_task.get("attemptId") or "")
        == str(home_new.get("attemptId") or "")
        and int(new_task.get("attempt") or 0)
        == int(home_new.get("attempt") or 0),
        f"new TaskRun execution identity mismatch: Atelier={new_task} Home={home_new}",
    )

    workspace = load_workspace(client)
    migrated = task_from_atelier(workspace, migrated=True)
    require(migrated is not None, "Atelier has no migrated canonical TaskRun")
    migrated_task_id = str(migrated.get("taskRunId") or migrated.get("id") or "")
    home_migrated = wait_until(
        lambda: home_task_readback(client, migrated_task_id),
        "migrated TaskRun in Home projection",
    )
    require(
        migrated.get("executionStatus") == home_migrated.get("status"),
        f"migrated TaskRun status mismatch: Atelier={migrated} Home={home_migrated}",
    )
    require(
        str(migrated.get("stepId") or "") ==
        str(home_migrated.get("stepId") or "")
        and str(migrated.get("attemptId") or "")
        == str(home_migrated.get("attemptId") or "")
        and int(migrated.get("attempt") or 0)
        == int(home_migrated.get("attempt") or 0),
        f"migrated TaskRun execution identity mismatch: Atelier={migrated} Home={home_migrated}",
    )

    store_readback = task_store_readback(client, task_id)
    require(store_readback.get("found") is True, "Desktop task store omitted TaskRun")
    require(
        store_readback.get("status") == home_new.get("status"),
        f"Desktop task status mismatch: store={store_readback} Home={home_new}",
    )
    require(
        store_readback.get("staleCachePresent") is False,
        "cached task projection won over Station readback",
    )
    require(
        int(str(store_readback.get("sourceRevision") or "0")) > 0,
        "Desktop task store did not retain Station revision",
    )
    legacy_after = collaboration_task_inventory(client)
    require(
        legacy_after == legacy_before,
        "reader Journey mutated legacy CollaborationTask inventory",
    )

    navigate_to_hash(client, f"applet:{APPLET_ID}")
    wait_until(
        lambda: visible_element(
            client,
            f'[data-applet-runtime="{APPLET_ID}"]',
        ),
        "Atelier runtime shell",
        timeout=120,
    )
    atelier_screenshot = artifact_dir / "atelier-taskrun-reader.png"
    client.driver.save_screenshot(str(atelier_screenshot))

    navigate_to_hash(client, "home")
    wait_until(
        lambda: visible_element(client, "[data-pt-home]"),
        "Home surface",
        timeout=120,
    )
    home_row = wait_until(
        lambda: visible_element(
            client,
            f'[data-pt-goal-run="{task_id}"]',
        ),
        "Home TaskRun row",
        timeout=120,
    )
    require(
        home_row.get_attribute("data-pt-goal-run-status") ==
        str(home_new.get("status") or "").upper(),
        "Home visible TaskRun status differs from Station",
    )
    home_screenshot = artifact_dir / "home-taskrun-reader.png"
    client.driver.save_screenshot(str(home_screenshot))

    return {
        "actorPtid": actor_ptid,
        "agentId": agent_id,
        "taskId": task_id,
        "newTask": {
            "atelier": new_task,
            "home": home_new,
            "desktopStore": store_readback,
        },
        "migratedTask": {
            "atelier": migrated,
            "home": home_migrated,
        },
        "legacyBefore": legacy_before,
        "legacyAfter": legacy_after,
        "sourceGuards": guards,
        "screenshots": [str(atelier_screenshot), str(home_screenshot)],
        "assertions": {
            "homeReadsCanonicalTaskRuns": True,
            "atelierReadsCanonicalTaskRuns": True,
            "newTaskStatusMatches": True,
            "migratedTaskStatusMatches": True,
            "stepAndAttemptMatch": True,
            "stationRevisionReplacesCachedProjection": True,
            "legacyInventoryUnchanged": True,
            "nativeSurfacesVisible": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-14 requires native Home and Atelier surfaces")
    require(
        args.require_station_readback,
        "PAOS-14 requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-14 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-14 requires a remote Station",
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
        / "paos-14-task-reader-cutover"
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
        raise TaskReaderCutoverJourneyError(
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
        f"PAOS-14 assertions failed: {capture['assertions']}",
    )
    print(json.dumps({
        "status": "PASS",
        "artifact": str(capture_path),
        "manifest": str(manifest_path),
        "manifestDigest": manifest_digest,
        "taskId": capture["taskId"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
