#!/usr/bin/env python3
"""Run the PAOS-13 native Home and Chat TaskRun writer cutover Journey."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from selenium.webdriver.common.by import By

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

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"


class TaskRunWriterCutoverJourneyError(RuntimeError):
    """The PAOS-13 Development Journey failed."""


def legacy_inventory(client: FoundationRuntimeClient) -> dict[str, list[str]]:
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
        f"legacy task inventory failed: {result}",
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


def migrated_identity(client: FoundationRuntimeClient) -> dict[str, str] | None:
    result = client.driver.execute_async_script(
        """
        const done = arguments[0];
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.getHomeWorkProjection(0n))
          .then((projection) => {
            const task = projection.activeTasks.find(
              (candidate) => Boolean(candidate.legacySourceId)
                && Boolean(candidate.taskId),
            );
            done(task ? {
              ok: true,
              legacySourceId: task.legacySourceId,
              taskId: task.taskId,
              goalId: task.goalId,
            } : { ok: true, missing: true });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"migrated task identity readback failed: {result}",
    )
    if result.get("missing") is True:
        return None
    return {
        "legacySourceId": str(result.get("legacySourceId") or ""),
        "taskId": str(result.get("taskId") or ""),
        "goalId": str(result.get("goalId") or ""),
    }


def task_events(
    client: FoundationRuntimeClient,
    task_id: str,
) -> dict[str, Any] | None:
    result = client.driver.execute_async_script(
        """
        const [taskId, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.listAgentCollaborationEvents({
            task_id: taskId,
            after_event_seq: 0,
            page_size: 20,
          }))
          .then((response) => {
            const created = (response.events || []).find(
              (event) => event.taskId === taskId && event.type === 1,
            );
            done(created ? {
              ok: true,
              eventId: created.eventId,
              taskId: created.taskId,
              stepId: created.stepId,
              eventSeq: Number(created.eventSeq),
              payloadJson: created.payloadJson,
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
        f"TaskRun event readback failed for {task_id}: {result}",
    )
    if result.get("missing") is True:
        return None
    return dict(result)


def active_task_id(client: FoundationRuntimeClient) -> str:
    value = client.driver.execute_async_script(
        """
        const done = arguments[0];
        import('/src/store/tasks.ts')
          .then(({ useTaskStore }) => done({
            ok: true,
            taskId: useTaskStore.getState().activeTaskId,
          }))
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """
    )
    require(
        isinstance(value, Mapping) and value.get("ok") is True,
        f"active TaskRun identity readback failed: {value}",
    )
    return str(value.get("taskId") or "")


def submit_home_task(
    client: FoundationRuntimeClient,
    title: str,
) -> str:
    navigate_to_hash(client, "home")
    wait_until(
        lambda: visible_element(client, "[data-pt-home]"),
        "Home surface",
    )
    wait_until(
        lambda: (
            element
            if (
                (element := visible_element(
                    client,
                    '[data-testid="home-work-composer"]',
                )).get_attribute("disabled")
                is None
            )
            else None
        ),
        "ready Home composer",
    )
    task_mode = client.driver.find_element(
        By.CSS_SELECTOR,
        '.ant-segmented-item input[value="task"]',
    )
    client.driver.execute_script(
        "arguments[0].closest('label').click();",
        task_mode,
    )
    composer = visible_element(
        client,
        '[data-testid="home-work-composer"]',
    )
    composer.clear()
    composer.send_keys(title)
    visible_element(client, '[data-pt-home-submit="task"]').click()
    wait_until(
        lambda: "#/tasks" in str(client.driver.current_url),
        "Home Task navigation",
    )
    return wait_until(
        lambda: active_task_id(client),
        "Home canonical TaskRun selection",
    )


def promote_chat(
    client: FoundationRuntimeClient,
    title: str,
    topic_key: str,
) -> dict[str, Any]:
    result = client.driver.execute_async_script(
        """
        const [title, topicKey, done] = arguments;
        Promise.all([
          import('/src/services/desktop_api.ts'),
          import('/src/store/tasks.ts'),
        ])
          .then(async ([{ api }, { useTaskStore }]) => {
            const agents = await api.listAgents();
            const agent = agents.find((candidate) => Boolean(candidate.id));
            if (!agent) throw new Error('Station has no Agent for promotion');
            const task = await api.createAgentTaskRemote({
              title,
              description: 'Promoted from one Chat topic',
              agent_id: agent.id,
              priority: 'high',
              topic_key: topicKey,
            });
            useTaskStore.getState().setActiveTask(task.id);
            done({
              ok: true,
              taskId: task.id,
              agentId: task.agent_id,
              status: task.status,
              topicKey: task.topic_key,
              activeTaskId: useTaskStore.getState().activeTaskId,
            });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        title,
        topic_key,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"Chat promotion failed: {result}",
    )
    return dict(result)


def run_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    actor_ptid: str,
) -> dict[str, Any]:
    marker = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    legacy_before = legacy_inventory(client)
    migrated_before = migrated_identity(client)
    require(
        isinstance(migrated_before, Mapping),
        "no migrated legacy task is available for preservation proof",
    )

    home_task_id = submit_home_task(
        client,
        f"PAOS-13 Home TaskRun {marker}",
    )
    home_event = wait_until(
        lambda: task_events(client, home_task_id),
        "Home TaskRun Station event",
    )
    require(
        home_event.get("taskId") == home_task_id,
        "Home command did not return the canonical TaskRun identity",
    )

    topic_key = f"paos-13-chat-{marker}"
    promotion = promote_chat(
        client,
        f"PAOS-13 Chat promotion {marker}",
        topic_key,
    )
    promoted_task_id = str(promotion.get("taskId") or "")
    require(bool(promoted_task_id), "Chat promotion returned no TaskRun identity")
    require(
        promotion.get("activeTaskId") == promoted_task_id,
        "Chat promotion did not open the canonical TaskRun identity",
    )
    promoted_event = wait_until(
        lambda: task_events(client, promoted_task_id),
        "promoted Chat TaskRun Station event",
    )
    require(
        promoted_event.get("taskId") == promoted_task_id,
        "Chat promotion Station readback changed TaskRun identity",
    )

    legacy_after = legacy_inventory(client)
    require(
        legacy_after == legacy_before,
        "Home or Chat writer created legacy task state",
    )
    migrated_after = wait_until(
        lambda: migrated_identity(client),
        "existing migrated task after writer cutover",
    )
    require(
        migrated_after == migrated_before,
        "writer cutover changed existing migrated identity",
    )

    navigate_to_hash(client, "tasks")
    wait_until(
        lambda: "#/tasks" in str(client.driver.current_url),
        "Tasks surface",
    )
    screenshot = artifact_dir / "taskrun-writer-cutover.png"
    client.driver.save_screenshot(str(screenshot))
    return {
        "actorPtid": actor_ptid,
        "homeTaskId": home_task_id,
        "homeTaskEvent": home_event,
        "promotedTaskId": promoted_task_id,
        "promotedTaskEvent": promoted_event,
        "promotion": promotion,
        "legacyBefore": legacy_before,
        "legacyAfter": legacy_after,
        "migratedBefore": migrated_before,
        "migratedAfter": migrated_after,
        "screenshots": [str(screenshot)],
        "assertions": {
            "homeReturnsCanonicalTaskRun": True,
            "chatPromotionReturnsCanonicalTaskRun": True,
            "taskCreatedEventsReadable": True,
            "zeroLegacyTaskWrites": True,
            "existingMigratedWorkPreserved": True,
            "nativeTaskSelectionMatchesReturnedIdentity": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-13 requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-13 requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-13 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-13 requires a remote Station",
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
        / "paos-13-task-writer-cutover"
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
        raise TaskRunWriterCutoverJourneyError(
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
        f"PAOS-13 assertions failed: {capture['assertions']}",
    )
    print(json.dumps({
        "status": "PASS",
        "artifact": str(capture_path),
        "manifest": str(manifest_path),
        "manifestDigest": manifest_digest,
        "homeTaskId": capture["homeTaskId"],
        "promotedTaskId": capture["promotedTaskId"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
