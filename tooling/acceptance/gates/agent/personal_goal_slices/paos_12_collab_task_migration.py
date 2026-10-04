#!/usr/bin/env python3
"""Run the PAOS-12 native legacy CollaborationTask migration Journey."""

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
APPLET_ID = "peers.atelier"


class CollaborationTaskMigrationJourneyError(RuntimeError):
    """The PAOS-12 Development Journey failed."""


def atelier_request(
    client: FoundationRuntimeClient,
    method: str,
    path: str,
    body: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    result = client.driver.execute_async_script(
        """
        const [method, path, body, done] = arguments;
        Promise.all([
          import('/src/services/desktop_api.ts'),
          import('/src/applet/AppletManager.ts'),
        ])
          .then(async ([{ api }, { default: AppletManager }]) => {
            const manager = AppletManager.getInstance();
            if (!manager.getAppletInfo('peers.atelier')) {
              await manager.scanApplets();
            }
            const info = await manager.loadApplet('peers.atelier');
            const gatewayManifest = {
              id: info.id,
              permissions: info.permissions,
              services: info.services,
              skills: info.skills,
            };
            const sessionId = manager.getSessionId('peers.atelier');
            if (!sessionId) throw new Error('Atelier applet session is missing');
            const response = await api.appletInvoke({
              id: 'peers.atelier',
              sessionId,
              capability: 'network',
              action: 'request',
              params: {
                service: 'atelier',
                method,
                path,
                ...(body ? { body } : {}),
              },
              manifest: gatewayManifest,
            });
            done({ ok: true, response });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        method,
        path,
        dict(body) if body is not None else None,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"Atelier service request failed: {result}",
    )
    response = result.get("response")
    require(isinstance(response, Mapping), "Atelier service response is malformed")
    response_body = response.get("body")
    require(isinstance(response_body, Mapping), "Atelier response body is malformed")
    if isinstance(response_body.get("data"), Mapping):
        response_body = response_body["data"]
    return dict(response_body)


def load_workspace(client: FoundationRuntimeClient) -> dict[str, Any]:
    return atelier_request(client, "GET", "/v1/workspace")


def migrated_task(
    snapshot: Mapping[str, Any],
    legacy_task_id: str = "",
) -> dict[str, Any] | None:
    workspace = snapshot.get("workspace")
    if not isinstance(workspace, Mapping):
        return None
    tasks = workspace.get("tasks")
    projects = workspace.get("projects")
    if not isinstance(tasks, list) or not isinstance(projects, list):
        return None
    for raw_task in tasks:
        if not isinstance(raw_task, Mapping):
            continue
        if legacy_task_id and raw_task.get("legacySourceId") != legacy_task_id:
            continue
        if raw_task.get("migrationState") != "migrated":
            continue
        goal_id = raw_task.get("goalId")
        task_run_id = raw_task.get("taskRunId")
        source_id = raw_task.get("legacySourceId")
        project = next(
            (
                candidate
                for candidate in projects
                if isinstance(candidate, Mapping)
                and candidate.get("id") == goal_id
            ),
            None,
        )
        if not isinstance(project, Mapping):
            continue
        return {
            "legacySourceId": source_id,
            "goalId": goal_id,
            "taskRunId": task_run_id,
            "taskId": raw_task.get("id"),
            "projectId": raw_task.get("projectId"),
            "migrationState": raw_task.get("migrationState"),
            "projectMigrationState": project.get("migrationState"),
            "projectGoalId": project.get("goalId"),
            "projectTaskRunId": project.get("taskRunId"),
            "projectState": project.get("state"),
        }
    return None


def run_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    actor_ptid: str,
) -> dict[str, Any]:
    initial_snapshot = load_workspace(client)
    first = migrated_task(initial_snapshot)
    require(
        isinstance(first, Mapping),
        "no pre-migration CollaborationTask fixture is available",
    )
    legacy_task_id = str(first.get("legacySourceId") or "")
    goal_id = str(first.get("goalId") or "")
    task_run_id = str(first.get("taskRunId") or "")
    require(bool(legacy_task_id), "migrated CollaborationTask has no source id")
    require(bool(goal_id), "migrated CollaborationTask has no Goal id")
    require(bool(task_run_id), "migrated CollaborationTask has no TaskRun id")
    require(first.get("projectId") == goal_id, "task project_id is not goal_id")
    require(first.get("projectGoalId") == goal_id, "project identity is not goal_id")
    require(
        first.get("projectTaskRunId") == task_run_id,
        "project and task do not share TaskRun identity",
    )

    second = wait_until(
        lambda: migrated_task(load_workspace(client), legacy_task_id),
        "repeated CollaborationTask readback",
    )
    identity_fields = (
        "legacySourceId",
        "goalId",
        "taskRunId",
        "taskId",
        "projectId",
        "projectGoalId",
        "projectTaskRunId",
    )
    require(
        all(first.get(field) == second.get(field) for field in identity_fields),
        "repeated readback changed canonical identities",
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
    screenshot = artifact_dir / "collaboration-task-migrated-atelier.png"
    client.driver.save_screenshot(str(screenshot))
    return {
        "actorPtid": actor_ptid,
        "legacyTaskId": legacy_task_id,
        "goalId": goal_id,
        "taskRunId": task_run_id,
        "firstReadback": first,
        "secondReadback": second,
        "screenshots": [str(screenshot)],
        "assertions": {
            "canonicalGoalVisible": True,
            "projectIdEqualsGoalId": True,
            "taskRunLinkStable": True,
            "repeatReadbackStable": True,
            "legacySourcePreserved": True,
            "nativeAtelierSurfaceVisible": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-12 requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-12 requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-12 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-12 requires a remote Station",
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
        / "paos-12-collab-task-migration"
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
        raise CollaborationTaskMigrationJourneyError(
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
        f"PAOS-12 assertions failed: {capture['assertions']}",
    )
    print(json.dumps({
        "status": "PASS",
        "artifact": str(capture_path),
        "manifest": str(manifest_path),
        "manifestDigest": manifest_digest,
        "legacyTaskId": capture["legacyTaskId"],
        "goalId": capture["goalId"],
        "taskRunId": capture["taskRunId"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
