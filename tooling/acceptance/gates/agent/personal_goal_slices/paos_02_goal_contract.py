#!/usr/bin/env python3
"""Run the PAOS-02 native Goal contract Development Journey."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

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
from tooling.acceptance.fixtures.chat_native_actors import (
    ACTOR_ACCOUNTS,
    fixture_password,
)

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"


class GoalContractJourneyError(RuntimeError):
    """The PAOS-02 Development Journey failed."""


def replace_value(element: Any, value: str) -> None:
    element.send_keys(Keys.COMMAND, "a")
    element.send_keys(Keys.BACKSPACE)
    element.send_keys(value)


def goal_element(
    client: FoundationRuntimeClient,
    *,
    revision: str,
    status: str,
) -> Any:
    element = visible_element(client, "[data-pt-home-goal-contract]")
    if (
        element.get_attribute("data-pt-home-goal-revision") == revision
        and element.get_attribute("data-pt-home-goal-status") == status
    ):
        return element
    return None


def update_goal_outside_projection(
    client: FoundationRuntimeClient,
    *,
    goal_id: str,
    expected_revision: str,
    outcome: str,
    marker: str,
) -> dict[str, Any]:
    result = client.driver.execute_async_script(
        """
        const [
          goalId,
          expectedRevision,
          outcome,
          marker,
          done,
        ] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.updateAgentGoal({
            goalId,
            outcome,
            nonGoals: ['No production deployment'],
            constraints: ['Preserve Station ownership'],
            budget: {
              maxTokens: 120000n,
              maxCost: 12.5,
              wallTimeMs: 3600000n,
              maxParallelTasks: 2,
            },
            acceptanceCriteria: [{
              criterionId: `criterion-${marker}`,
              description: 'Station readback matches the reviewed contract',
              evaluator: 'deterministic',
              required: true,
            }],
            expectedRevision: BigInt(expectedRevision),
            idempotencyKey: `paos-02-concurrent-${marker}`,
          }))
          .then((goal) => done({
            ok: true,
            goalId: goal.goalId,
            revision: goal.revision.toString(),
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
        outcome,
        marker,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"concurrent Station Goal update failed: {result}",
    )
    return dict(result)


def read_goal(
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
            ownerPtid: goal.ownerPtid,
            outcome: goal.outcome,
            nonGoals: [...goal.nonGoals],
            constraints: [...goal.constraints],
            maxTokens: goal.budget?.maxTokens?.toString() || '0',
            maxCost: goal.budget?.maxCost ?? null,
            wallTimeMs: goal.budget?.wallTimeMs?.toString() || '0',
            maxParallelTasks: goal.budget?.maxParallelTasks || 0,
            acceptanceCriteria: goal.acceptanceCriteria.map((criterion) => ({
              criterionId: criterion.criterionId,
              description: criterion.description,
              evaluator: criterion.evaluator,
              required: criterion.required,
            })),
            status: goal.status,
            revision: goal.revision.toString(),
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
        f"Station Goal readback failed: {result}",
    )
    return dict(result)


def create_foreign_goal(
    artifact_dir: Path,
    profile_values: Mapping[str, str],
    client_profile_values: Mapping[str, str],
    slot: int,
) -> tuple[dict[str, str], dict[str, Any]]:
    client = FoundationRuntimeClient(
        FoundationClientSpec(
            runtime="native-tauri",
            worktree=ROOT,
            gateway_port=3331 + slot * 100,
            renderer_port=3511 + slot * 100,
            webdriver_port=4446 + slot * 10,
            storage_root=artifact_dir / "foreign" / "native-storage",
            profile=PROFILE,
        ),
        station_url=str(profile_values["PT_STATION_URL"]),
        profile_env=client_profile_values,
        startup_timeout=900,
        launch_env={"PT_STATION_SKIP_DEPLOY": "true"},
    )
    cleanup: dict[str, Any] = {"status": "not-started"}
    goal: dict[str, str] = {}
    try:
        client.start()
        client.configure_station(timeout=60)
        login = client.harness(
            "loginWithPassword",
            {
                "account": ACTOR_ACCOUNTS["bob"],
                "password": fixture_password(),
            },
            timeout=120,
        )
        require(
            isinstance(login, Mapping)
            and login.get("authenticated") is True
            and bool(login.get("actorId")),
            f"foreign actor login failed: {login}",
        )
        navigate_to_hash(client, "home")
        wait_until(
            lambda: visible_element(client, "[data-pt-home]"),
            "foreign actor Home surface",
        )
        marker = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        replace_value(
            visible_element(client, "[data-pt-home-goal-title]"),
            f"PAOS-02 foreign Goal {marker}",
        )
        replace_value(
            visible_element(client, "[data-pt-home-goal-outcome]"),
            "Remain private to the owning actor.",
        )
        visible_element(client, "[data-pt-home-goal-create]").click()
        saved = wait_until(
            lambda: visible_element(
                client,
                '[data-pt-home-goal][data-pt-home-goal-status="DRAFT"]',
            ),
            "foreign actor Goal",
        )
        goal = {
            "goalId": str(saved.get_attribute("data-pt-home-goal-id") or ""),
            "ownerPtid": str(
                saved.get_attribute("data-pt-home-goal-owner") or ""
            ),
            "title": f"PAOS-02 foreign Goal {marker}",
            "outcome": "Remain private to the owning actor.",
        }
    finally:
        cleanup = client.stop(remove_storage=True)
        try:
            client.runtime_profile.unlink(missing_ok=True)
        except OSError as error:
            cleanup["failures"].append(f"foreign runtime profile cleanup: {error}")
        cleanup["runtimeProfileReleased"] = not client.runtime_profile.exists()
        if not cleanup["runtimeProfileReleased"]:
            cleanup["failures"].append("foreign runtime profile remains")
        if cleanup["failures"]:
            cleanup["status"] = "failed"
    require(cleanup.get("status") == "clean", f"foreign cleanup failed: {cleanup}")
    require(bool(goal.get("goalId")), "foreign Goal has no Station identity")
    return goal, cleanup


def show_foreign_goal(
    client: FoundationRuntimeClient,
    goal: Mapping[str, str],
) -> None:
    result = client.driver.execute_async_script(
        """
        const [goal, done] = arguments;
        Promise.all([
          import('/src/store/home.ts'),
          import('/src/store/goalDraft.ts'),
        ])
          .then(([home, draft]) => {
            const projection = {
              goalId: goal.goalId,
              ownerPtid: goal.ownerPtid,
              title: goal.title,
              outcome: goal.outcome,
              nonGoals: [],
              constraints: [],
              acceptanceCriteria: [],
              status: 1,
              revision: 1n,
              graphRevision: 0n,
              acceptanceRevision: 0n,
            };
            home.useHomeStore.setState({
              savedGoal: projection,
              goalReadbackRevision: 1n,
              goalReadbackError: null,
            });
            draft.useGoalDraftStore.getState().hydrate(projection);
            done({ ok: true });
          })
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        dict(goal),
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"foreign Goal projection setup failed: {result}",
    )


def run_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    actor_ptid: str,
    foreign_goal: Mapping[str, str],
) -> dict[str, Any]:
    navigate_to_hash(client, "home")
    wait_until(
        lambda: visible_element(client, "[data-pt-home]"),
        "Home surface",
    )

    marker = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    title = f"PAOS-02 Goal contract {marker}"
    initial_outcome = "Create a reviewable Goal contract."
    replace_value(
        visible_element(client, "[data-pt-home-goal-title]"),
        title,
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-outcome]"),
        initial_outcome,
    )
    visible_element(client, "[data-pt-home-goal-create]").click()
    created = wait_until(
        lambda: goal_element(client, revision="1", status="DRAFT"),
        "created Goal contract",
    )
    goal_id = str(created.get_attribute("data-pt-home-goal-id") or "")
    require(bool(goal_id), "created Goal contract has no identity")

    reviewed_outcome = "Deliver the exact Station-backed contract."
    replace_value(
        visible_element(client, "[data-pt-home-goal-outcome-readback]"),
        reviewed_outcome,
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-non-goals]"),
        "No production deployment",
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-constraints]"),
        "Preserve Station ownership",
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
        "Station readback matches the reviewed contract",
    )
    visible_element(client, "[data-pt-home-goal-update]").click()
    wait_until(
        lambda: goal_element(client, revision="2", status="DRAFT"),
        "saved Goal contract revision",
    )

    concurrent_outcome = "Concurrent Station outcome"
    concurrent = update_goal_outside_projection(
        client,
        goal_id=goal_id,
        expected_revision="2",
        outcome=concurrent_outcome,
        marker=marker,
    )
    require(
        concurrent.get("revision") == "3",
        f"concurrent revision = {concurrent.get('revision')}, want 3",
    )

    final_outcome = "Local edits survive stale revision recovery."
    replace_value(
        visible_element(client, "[data-pt-home-goal-outcome-readback]"),
        final_outcome,
    )
    visible_element(client, "[data-pt-home-goal-update]").click()
    wait_until(
        lambda: visible_element(client, "[data-pt-home-goal-conflict]"),
        "Goal revision conflict",
    )
    require(
        str(
            visible_element(
                client,
                "[data-pt-home-goal-outcome-readback]",
            ).get_attribute("value")
            or ""
        )
        == final_outcome,
        "Goal conflict replaced local edits",
    )
    conflict_screenshot = artifact_dir / "goal-contract-conflict.png"
    client.driver.save_screenshot(str(conflict_screenshot))

    visible_element(client, "[data-pt-home-goal-conflict-reload]").click()
    wait_until(
        lambda: goal_element(client, revision="3", status="DRAFT"),
        "latest Goal revision",
    )
    require(
        str(
            visible_element(
                client,
                "[data-pt-home-goal-outcome-readback]",
            ).get_attribute("value")
            or ""
        )
        == final_outcome,
        "Goal reload did not preserve local edits",
    )

    visible_element(client, "[data-pt-home-goal-update]").click()
    wait_until(
        lambda: goal_element(client, revision="4", status="DRAFT"),
        "rebased Goal contract",
    )
    visible_element(client, "[data-pt-home-goal-review]").click()
    reviewed = wait_until(
        lambda: goal_element(client, revision="5", status="REVIEWING"),
        "reviewed Goal contract",
    )
    require(
        reviewed.get_attribute("data-pt-home-goal-review-revision") == "5",
        "review mode does not expose the exact Station revision",
    )
    reviewed_screenshot = artifact_dir / "goal-contract-reviewed.png"
    client.driver.save_screenshot(str(reviewed_screenshot))

    station_goal = read_goal(client, goal_id)
    require(station_goal.get("ownerPtid") == actor_ptid, "Goal owner changed")
    require(station_goal.get("outcome") == final_outcome, "Goal outcome mismatch")
    require(station_goal.get("revision") == "5", "Goal revision mismatch")
    require(
        station_goal.get("nonGoals") == ["No production deployment"],
        "Goal non-goals mismatch",
    )
    require(
        station_goal.get("constraints") == ["Preserve Station ownership"],
        "Goal constraints mismatch",
    )
    require(station_goal.get("maxTokens") == "120000", "Goal token budget mismatch")
    require(
        station_goal.get("wallTimeMs") == "3600000",
        "Goal wall-time budget mismatch",
    )
    require(
        station_goal.get("maxParallelTasks") == 2,
        "Goal parallel-task budget mismatch",
    )
    require(
        len(station_goal.get("acceptanceCriteria") or []) == 1,
        "Goal acceptance criteria mismatch",
    )

    show_foreign_goal(client, foreign_goal)
    wait_until(
        lambda: (
            element
            if (
                (element := visible_element(
                    client,
                    "[data-pt-home-goal-contract]",
                )).get_attribute("data-pt-home-goal-id")
                == foreign_goal["goalId"]
            )
            else None
        ),
        "foreign Goal local projection",
    )
    visible_element(client, "[data-pt-home-goal-review]").click()
    wait_until(
        lambda: visible_element(client, "[data-pt-home-goal-forbidden]"),
        "non-retryable forbidden Goal state",
    )
    review_button = visible_element(client, "[data-pt-home-goal-review]")
    require(
        review_button.get_attribute("disabled") is not None,
        "forbidden Goal mutation remained retryable",
    )
    unauthorized_screenshot = artifact_dir / "goal-contract-forbidden.png"
    client.driver.save_screenshot(str(unauthorized_screenshot))

    return {
        "goalId": goal_id,
        "revision": station_goal["revision"],
        "ownerPtid": station_goal["ownerPtid"],
        "outcome": station_goal["outcome"],
        "screenshots": [
            str(conflict_screenshot),
            str(reviewed_screenshot),
            str(unauthorized_screenshot),
        ],
        "assertions": {
            "contractFieldsPersisted": True,
            "staleConflictVisible": True,
            "reloadPreservedLocalEdits": True,
            "reviewRevisionExact": True,
            "stationReadbackMatches": True,
            "unauthorizedMutationVisible": True,
            "unauthorizedMutationNonRetryable": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-02 requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-02 requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-02 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-02 requires a remote Station",
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
        / "paos-02-goal-contract"
    )
    artifact_dir.mkdir(parents=True, exist_ok=False)
    profile_values = load_env_file(profile_file)
    client_profile_values = runtime_profile_values(profile_values)
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
        profile_env=client_profile_values,
        startup_timeout=900,
        launch_env={"PT_STATION_SKIP_DEPLOY": "true"},
    )

    capture: dict[str, Any] = {}
    failure: BaseException | None = None
    cleanup: dict[str, Any] = {"status": "not-started"}
    foreign_cleanup: dict[str, Any] = {"status": "not-started"}
    try:
        foreign_goal, foreign_cleanup = create_foreign_goal(
            artifact_dir,
            profile_values,
            client_profile_values,
            slot,
        )
        client.start()
        actor_ptid = authenticate(client, profile_values)
        capture = run_journey(
            client,
            artifact_dir,
            actor_ptid,
            foreign_goal,
        )
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
    capture["foreignCleanup"] = foreign_cleanup
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
    )
    if failure is not None:
        raise GoalContractJourneyError(
            f"{failure}; capture={capture_path}; manifest={manifest_path}; "
            f"manifestDigest={manifest_digest}; cleanup={cleanup}"
        ) from failure
    require(cleanup.get("status") == "clean", f"cleanup failed: {cleanup}")
    require(
        foreign_cleanup.get("status") == "clean",
        f"foreign client cleanup failed: {foreign_cleanup}",
    )
    require(
        capture["secretScan"]["status"] == "passed",
        f"sensitive profile keys persisted: {leaked_profile_keys}",
    )
    require(
        all(capture["assertions"].values()),
        f"PAOS-02 assertions failed: {capture['assertions']}",
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
