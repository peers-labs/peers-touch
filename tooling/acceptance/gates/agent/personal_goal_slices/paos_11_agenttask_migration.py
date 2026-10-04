#!/usr/bin/env python3
"""Run the PAOS-11 native legacy AgentTask migration Development Journey."""

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

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"
MIGRATION_STATE_MIGRATED = 1


class AgentTaskMigrationJourneyError(RuntimeError):
    """The PAOS-11 Development Journey failed."""


def create_legacy_task(client: FoundationRuntimeClient, title: str) -> dict[str, Any]:
    result = client.driver.execute_async_script(
        """
        const [title, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(async ({ api }) => {
            const agents = await api.listAgents();
            const agent = agents.find((candidate) => Boolean(candidate.id));
            if (!agent) {
              throw new Error('Station has no Agent for migration fixture');
            }
            const task = await api.createAgentTaskRemote({
              title,
              description: 'PAOS-11 migration fixture',
              agent_id: agent.id,
              priority: 'medium',
            });
            done({ ok: true, task });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        title,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"legacy AgentTask creation failed: {result}",
    )
    task = result.get("task")
    require(isinstance(task, Mapping), "legacy AgentTask response is malformed")
    return dict(task)


def migrated_readback(
    client: FoundationRuntimeClient,
    legacy_task_id: str,
) -> dict[str, Any] | None:
    result = client.driver.execute_async_script(
        """
        const [legacyTaskId, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.getHomeWorkProjection(0n))
          .then((projection) => {
            const task = projection.activeTasks.find(
              (candidate) => candidate.legacySourceId === legacyTaskId,
            );
            done(task ? {
              ok: true,
              legacySourceId: task.legacySourceId,
              migrationState: task.migrationState,
              migrationBlockReason: task.migrationBlockReason,
              goalId: task.goalId,
              nodeId: task.goalNodeId,
              taskId: task.taskId,
              stepId: task.stepId,
              attemptId: task.attemptId,
              attempt: task.attempt,
              status: task.status,
            } : { ok: true, missing: true });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        legacy_task_id,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"migrated AgentTask readback failed: {result}",
    )
    if result.get("missing") is True:
        return None
    return dict(result)


def refresh_and_select(
    client: FoundationRuntimeClient,
    task_id: str,
) -> None:
    result = client.driver.execute_async_script(
        """
        const [taskId, done] = arguments;
        Promise.all([
          import('/src/runtimes/homeRuntime.ts'),
          import('/src/store/goalExecution.ts'),
        ])
          .then(async ([{ refreshHomeProjection }, { useGoalExecutionStore }]) => {
            await refreshHomeProjection('paos-11-migration-readback');
            useGoalExecutionStore.getState().selectTask(taskId);
            done({ ok: true });
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
        f"Home migration refresh failed: {result}",
    )


def legacy_source_exists(
    client: FoundationRuntimeClient,
    legacy_task_id: str,
) -> bool:
    result = client.driver.execute_async_script(
        """
        const [legacyTaskId, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.listAgentTasksRemote())
          .then((tasks) => done({
            ok: true,
            exists: tasks.some((task) => task.id === legacyTaskId),
          }))
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        legacy_task_id,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"legacy AgentTask source readback failed: {result}",
    )
    return result.get("exists") is True


def run_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    actor_ptid: str,
) -> dict[str, Any]:
    navigate_to_hash(client, "home")
    wait_until(lambda: visible_element(client, "[data-pt-home]"), "Home surface")
    title = "PAOS-11 legacy task " + datetime.now(timezone.utc).strftime(
        "%H%M%S%f"
    )
    legacy = create_legacy_task(client, title)
    legacy_task_id = str(legacy["id"])

    first = wait_until(
        lambda: migrated_readback(client, legacy_task_id),
        "migrated AgentTask readback",
    )
    require(
        first.get("migrationState") == MIGRATION_STATE_MIGRATED,
        f"AgentTask migration is not migrated: {first}",
    )
    for field in ("goalId", "nodeId", "taskId", "stepId", "attemptId"):
        require(bool(first.get(field)), f"migrated AgentTask has no {field}")

    refresh_and_select(client, str(first["taskId"]))
    badge = wait_until(
        lambda: visible_element(
            client,
            '[data-pt-migrated-work="migrated"]'
            f'[data-pt-migration-source-id="{legacy_task_id}"]',
        ),
        "Home migrated work badge",
    )
    require(badge.is_displayed(), "migrated work badge is not visible")

    second = wait_until(
        lambda: migrated_readback(client, legacy_task_id),
        "repeated migrated AgentTask readback",
    )
    identity_fields = ("goalId", "nodeId", "taskId", "stepId", "attemptId")
    require(
        all(first[field] == second[field] for field in identity_fields),
        "repeated migration changed canonical identities",
    )
    require(
        legacy_source_exists(client, legacy_task_id),
        "migration removed the legacy AgentTask source row",
    )

    screenshot = artifact_dir / "agenttask-migrated-home.png"
    client.driver.save_screenshot(str(screenshot))
    return {
        "actorPtid": actor_ptid,
        "legacyTaskId": legacy_task_id,
        "firstReadback": first,
        "secondReadback": second,
        "screenshots": [str(screenshot)],
        "assertions": {
            "canonicalIdentityVisible": True,
            "migrationBadgeVisible": True,
            "repeatReadbackStable": True,
            "legacySourcePreserved": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-11 requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-11 requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-11 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-11 requires a remote Station",
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
        / "paos-11-agenttask-migration"
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
        raise AgentTaskMigrationJourneyError(
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
        f"PAOS-11 assertions failed: {capture['assertions']}",
    )
    print(json.dumps({
        "status": "PASS",
        "artifact": str(capture_path),
        "manifest": str(manifest_path),
        "manifestDigest": manifest_digest,
        "legacyTaskId": capture["legacyTaskId"],
        "taskId": capture["firstReadback"]["taskId"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
