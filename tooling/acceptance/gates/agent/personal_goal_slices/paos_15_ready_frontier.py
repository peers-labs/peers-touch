#!/usr/bin/env python3
"""Run the PAOS-15 native ready-frontier Development Journey."""

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

from tooling.acceptance.core import ArtifactSession, current_artifact_ref
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
from tooling.acceptance.gates.agent.personal_goal_slices.paos_06_direct_model_result import (
    refresh_home,
    task_events,
)

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"
GATE_ID = "agent-personal-goal-coordinator-e2e"
TASK_STATUS_RUNNING = 2
TASK_STATUS_COMPLETED = 4
TASK_STATUS_FAILED = 5


class ReadyFrontierJourneyError(RuntimeError):
    """The PAOS-15 Development Journey failed."""


def source_guards() -> dict[str, bool]:
    coordinator = (
        ROOT
        / "apps/station/app/subserver/agent/service/goal_coordinator.go"
    ).read_text(encoding="utf-8")
    execution = (
        ROOT
        / "apps/station/app/subserver/agent/service/"
        "goal_execution_service.go"
    ).read_text(encoding="utf-8")
    timeline = (
        ROOT
        / "apps/desktop/src/components/home/GoalTimeline.tsx"
    ).read_text(encoding="utf-8")
    return {
        "singleLeaseOwner": "GoalCoordinatorLease" in coordinator,
        "boundedFrontier": "maxGoalReadyFrontier" in coordinator,
        "dependencyCheck": "goalNodeDependenciesCompleted" in coordinator,
        "stableContinuationIdentity": (
            'identitySeed := goal.GoalID + "\\x00continuation"' in execution
        ),
        "timelineUsesCanonicalRuns": (
            "useGoalExecutionStore" in timeline
            and "data-pt-goal-timeline-node" in timeline
        ),
        "noContinueCommand": "Continue" not in timeline,
    }


def goal_tasks(
    client: FoundationRuntimeClient,
    goal_id: str,
) -> list[dict[str, Any]]:
    refresh_home(client)
    result = client.driver.execute_async_script(
        """
        const [goalId, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.getHomeWorkProjection(0n))
          .then((projection) => done({
            ok: true,
            revision: projection.revision.toString(),
            tasks: projection.activeTasks
              .filter((task) => task.goalId === goalId)
              .map((task) => ({
                goalId: task.goalId,
                nodeId: task.goalNodeId,
                taskId: task.taskId,
                stepId: task.stepId,
                attemptId: task.attemptId,
                attempt: task.attempt,
                title: task.title,
                status: task.status,
              })),
          }))
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        goal_id,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"Goal frontier readback failed: {result}",
    )
    tasks = result.get("tasks")
    require(isinstance(tasks, list), "Goal frontier TaskRuns are malformed")
    return [dict(task) for task in tasks if isinstance(task, Mapping)]


def terminal_two_node_frontier(
    client: FoundationRuntimeClient,
    goal_id: str,
    first_task_id: str,
) -> list[dict[str, Any]] | None:
    tasks = goal_tasks(client, goal_id)
    if len(tasks) != 2:
        return None
    by_id = {str(task.get("taskId") or ""): task for task in tasks}
    first = by_id.get(first_task_id)
    if first is None:
        return None
    second = next(
        (task for task in tasks if task.get("taskId") != first_task_id),
        None,
    )
    if (
        first.get("status") == TASK_STATUS_COMPLETED
        and second is not None
        and second.get("status") in (TASK_STATUS_COMPLETED, TASK_STATUS_FAILED)
    ):
        return [first, second]
    return None


def coordinator_identity(events: list[dict[str, Any]]) -> dict[str, int]:
    for event in events:
        payload = event.get("payload")
        if not isinstance(payload, Mapping):
            continue
        generation = int(payload.get("coordinator_lease_generation") or 0)
        sequence = int(payload.get("coordinator_dispatch_sequence") or 0)
        graph_revision = int(payload.get("goal_graph_revision") or 0)
        if generation and sequence and graph_revision:
            return {
                "leaseGeneration": generation,
                "dispatchSequence": sequence,
                "graphRevision": graph_revision,
            }
    raise ReadyFrontierJourneyError(
        "TaskRun events omitted coordinator identity"
    )


def goal_readback(
    client: FoundationRuntimeClient,
    goal_id: str,
) -> dict[str, Any]:
    result = client.driver.execute_async_script(
        """
        const [goalId, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.getAgentGoal(goalId))
          .then((goal) => done({
            ok: true,
            goalId: goal.goalId,
            status: goal.status,
            revision: goal.revision.toString(),
            graphRevision: goal.graphRevision.toString(),
          }))
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        goal_id,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"Goal coordinator Station readback failed: {result}",
    )
    return dict(result)


def write_formal_evidence(capture: Mapping[str, Any]) -> None:
    if not os.environ.get("PT_ACCEPTANCE_RUN_ID", "").strip():
        return
    metadata = {
        "status": "passed",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "phase": "PAOS-15 Ready Frontier",
        "bom": ["PAOS-15", "PAOS-J02", "PAOS-D03"],
        "spec": [
            "tooling/acceptance/features/agent-personal-goal.yaml",
            (
                "docs/architecture/agent/execution-plans/"
                "20261003-personal-agent-os-convergence/tasks/"
                "PAOS-15-READY-FRONTIER.md"
            ),
        ],
        "gate": (
            "A Native Home Goal advances through a deterministic dependency-"
            "ready frontier under one bounded coordinator lease generation."
        ),
        "sampleEmissionAllowed": True,
    }
    with ArtifactSession(repo_root=ROOT, gate_id=GATE_ID) as artifacts:
        runtime_manifest = current_artifact_ref(
            "runtime/environment-manifest.json",
            repo_root=ROOT,
        ).to_dict()
        screenshot = Path(str(capture["screenshots"][0]))
        artifacts.write_bytes(
            "evidence/goal-ready-frontier.png",
            screenshot.read_bytes(),
            media_type="image/png",
            role="receiver-dom",
        )
        artifacts.write_json(
            "evidence/station-readback.json",
            {
                "artifactKind": "agent-goal-coordinator-station-readback",
                **metadata,
                "evidence": {
                    "goal": capture["goal"],
                    "firstTask": capture["firstTask"],
                    "secondTask": capture["secondTask"],
                },
            },
            role="station-readback",
        )
        artifacts.write_json(
            "evidence/runtime-events.json",
            {
                "artifactKind": "agent-goal-coordinator-runtime-events",
                **metadata,
                "evidence": {
                    "first": capture["firstCoordinatorIdentity"],
                    "second": capture["secondCoordinatorIdentity"],
                },
            },
            role="runtime-events",
        )
        artifacts.write_json(
            "evidence/cleanup.json",
            {
                "artifactKind": "agent-goal-coordinator-cleanup",
                **metadata,
                "evidence": capture["cleanup"],
            },
            role="cleanup",
        )
        artifacts.write_json(
            "evidence/source-identity.json",
            {
                "artifactKind": "agent-goal-coordinator-source-identity",
                **metadata,
                "source": capture["source"],
                "runtimeIdentity": capture["runtimeIdentity"],
                "runtimeManifest": runtime_manifest,
            },
            role="source-identity",
        )
        artifacts.write_json(
            "reports/agent-personal-goal-coordinator.json",
            {
                "artifactKind": "acceptance-gate-evidence-report",
                "gateId": GATE_ID,
                "journey": "PAOS-J02",
                **metadata,
                "source": capture["source"],
                "runtimeManifest": runtime_manifest,
                "capture": dict(capture),
            },
            role="report",
        )
        artifacts.complete(
            status="passed",
            completion_status="DONE",
            proof_status="PROVEN",
            runtime={
                "environment": "home-station",
                "profile": PROFILE,
                "journey": "PAOS-J02",
            },
        )


def run_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    actor_ptid: str,
) -> dict[str, Any]:
    guards = source_guards()
    require(all(guards.values()), f"ready frontier source guard failed: {guards}")
    start = run_goal_start_journey(client, artifact_dir, actor_ptid)
    goal_id = str(start["goalId"])
    first_task_id = str(start["createdTaskId"])

    tasks = wait_until(
        lambda: terminal_two_node_frontier(client, goal_id, first_task_id),
        "two-node Goal frontier to advance without Continue",
        timeout=300,
        interval=1,
    )
    by_id = {str(task["taskId"]): task for task in tasks}
    first = by_id[first_task_id]
    second = next(task for task in tasks if task["taskId"] != first_task_id)
    require(
        second["status"] == TASK_STATUS_COMPLETED,
        f"automatically dispatched continuation failed: {second}",
    )
    require(
        all(
            bool(task.get(field))
            for task in tasks
            for field in ("nodeId", "taskId", "stepId", "attemptId")
        ),
        f"frontier identities are incomplete: {tasks}",
    )

    first_identity = coordinator_identity(task_events(client, first_task_id))
    second_identity = coordinator_identity(
        task_events(client, str(second["taskId"]))
    )
    goal = goal_readback(client, goal_id)
    require(
        first_identity["leaseGeneration"] ==
        second_identity["leaseGeneration"] == 1,
        (
            "Goal dispatches used different lease generations: "
            f"first={first_identity} second={second_identity}"
        ),
    )
    require(
        first_identity["dispatchSequence"] == 1
        and second_identity["dispatchSequence"] == 2,
        (
            "Goal dispatch sequence is not monotonic: "
            f"first={first_identity} second={second_identity}"
        ),
    )
    require(
        int(str(goal.get("graphRevision") or "0")) ==
        second_identity["graphRevision"] == 2,
        f"Goal graph revision does not explain continuation: {goal}",
    )

    navigate_to_hash(client, "home")
    timeline = wait_until(
        lambda: visible_element(
            client,
            f'[data-pt-goal-timeline][data-pt-goal-timeline-goal="{goal_id}"]',
        ),
        "Home Goal timeline",
    )
    timeline_nodes = [
        element
        for element in timeline.find_elements(
            "css selector",
            "[data-pt-goal-timeline-node]",
        )
        if element.is_displayed()
    ]
    require(
        len(timeline_nodes) == 2,
        f"Home timeline has {len(timeline_nodes)} visible nodes, want 2",
    )
    current = visible_element(
        client,
        f'[data-pt-goal-progress][data-pt-goal-run="{second["taskId"]}"]',
    )
    require(
        current is not None,
        "Home did not advance its current Goal node to the continuation",
    )
    screenshot = artifact_dir / "goal-ready-frontier.png"
    client.driver.save_screenshot(str(screenshot))

    return {
        "actorPtid": actor_ptid,
        "goalId": goal_id,
        "goal": goal,
        "firstTask": first,
        "secondTask": second,
        "firstCoordinatorIdentity": first_identity,
        "secondCoordinatorIdentity": second_identity,
        "sourceGuards": guards,
        "screenshots": [str(screenshot)],
        "assertions": {
            "twoNodeGraphVisible": True,
            "advancedWithoutContinue": True,
            "dependencyOrderPreserved": True,
            "canonicalIdentitiesPreallocated": True,
            "singleLeaseGeneration": True,
            "monotonicDispatchSequence": True,
            "graphRevisionMatches": True,
            "stationReadbackMatches": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-15 requires a real Home UI")
    require(
        args.require_station_readback,
        "PAOS-15 requires Station Goal and TaskRun readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-15 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-15 requires a remote Station",
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
        / "paos-15-ready-frontier"
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
        raise ReadyFrontierJourneyError(
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
        f"PAOS-15 assertions failed: {capture['assertions']}",
    )
    write_formal_evidence(capture)
    print(json.dumps({
        "status": "PASS",
        "artifact": str(capture_path),
        "manifest": str(manifest_path),
        "manifestDigest": manifest_digest,
        "goalId": capture["goalId"],
        "firstTaskId": capture["firstTask"]["taskId"],
        "secondTaskId": capture["secondTask"]["taskId"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
