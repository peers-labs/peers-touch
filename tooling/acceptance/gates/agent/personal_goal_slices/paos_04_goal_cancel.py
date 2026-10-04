#!/usr/bin/env python3
"""Run the PAOS-04 native pre-execution Goal cancellation Journey."""

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
from tooling.acceptance.gates.agent.personal_goal_slices.paos_02_goal_contract import (
    read_goal,
    replace_value,
)
from tooling.acceptance.gates.agent.personal_goal_slices.paos_03_goal_start import (
    active_task_ids,
    admit_outside_projection,
    goal_surface,
)

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"


class GoalCancelJourneyError(RuntimeError):
    """The PAOS-04 Development Journey failed."""


def reset_goal_surface(client: FoundationRuntimeClient) -> None:
    result = client.driver.execute_async_script(
        """
        const done = arguments[0];
        Promise.all([
          import('/src/store/home.ts'),
          import('/src/store/goalDraft.ts'),
        ])
          .then(([home, draft]) => {
            home.useHomeStore.getState().reset();
            draft.useGoalDraftStore.getState().reset();
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
        f"reset Home Goal surface failed: {result}",
    )
    wait_until(
        lambda: visible_element(client, "[data-pt-home-goal-title]"),
        "empty Goal form",
    )


def create_goal(
    client: FoundationRuntimeClient,
    *,
    marker: str,
    suffix: str,
) -> tuple[str, str]:
    title = f"PAOS-04 {suffix} Goal {marker}"
    replace_value(
        visible_element(client, "[data-pt-home-goal-title]"),
        title,
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-outcome]"),
        f"Cancel the {suffix} Goal before execution.",
    )
    visible_element(client, "[data-pt-home-goal-create]").click()
    created = wait_until(
        lambda: goal_surface(client, revision="1", status="DRAFT"),
        f"{suffix} draft Goal",
    )
    goal_id = str(created.get_attribute("data-pt-home-goal-id") or "")
    require(bool(goal_id), f"{suffix} Goal has no identity")
    return goal_id, title


def review_goal(client: FoundationRuntimeClient) -> None:
    replace_value(
        visible_element(client, "[data-pt-home-goal-non-goals]"),
        "Do not start execution",
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
        "Station readback reaches CANCELLED",
    )
    visible_element(client, "[data-pt-home-goal-update]").click()
    wait_until(
        lambda: goal_surface(client, revision="2", status="DRAFT"),
        "saved Goal contract",
    )
    visible_element(client, "[data-pt-home-goal-review]").click()
    wait_until(
        lambda: goal_surface(client, revision="3", status="REVIEWING"),
        "reviewed Goal",
    )


def open_cancel_confirmation(
    client: FoundationRuntimeClient,
    *,
    title: str,
) -> Any:
    visible_element(client, "[data-pt-home-goal-cancel]").click()
    confirmation = wait_until(
        lambda: visible_element(
            client,
            "[data-pt-home-goal-cancel-confirm]",
        ),
        "Goal cancellation confirmation",
    )
    dialog = confirmation.find_element("xpath", "ancestor::*[@role='dialog']")
    require(
        title in str(dialog.text or ""),
        "Goal cancellation confirmation does not name the affected Goal",
    )
    return confirmation


def confirmation_is_closed(client: FoundationRuntimeClient) -> bool:
    confirmations = client.driver.find_elements(
        By.CSS_SELECTOR,
        "[data-pt-home-goal-cancel-confirm]",
    )
    return not any(element.is_displayed() for element in confirmations)


def verify_confirmation_focus_return(
    client: FoundationRuntimeClient,
    *,
    title: str,
) -> None:
    open_cancel_confirmation(client, title=title)
    visible_element(client, "[data-pt-home-goal-cancel-dismiss]").click()
    wait_until(
        lambda: confirmation_is_closed(client),
        "closed Goal cancellation confirmation",
    )
    wait_until(
        lambda: client.driver.execute_script(
            """
            return document.activeElement?.hasAttribute(
              'data-pt-home-goal-cancel'
            ) || false;
            """
        ),
        "Goal cancellation trigger focus restoration",
    )


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
            window.__paos04CancelTrace = trace;
            window.__paos04ReleaseReadback = () => {
              trace.released = true;
              releaseReadback?.();
            };
            window.__paos04RestoreApi = () => {
              api.cancelAgentGoal = originalCancel;
              api.getAgentGoal = originalGet;
              delete window.__paos04ReleaseReadback;
              delete window.__paos04RestoreApi;
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
        f"install cancellation readback barrier failed: {result}",
    )


def release_readback_barrier(client: FoundationRuntimeClient) -> None:
    client.driver.execute_script("window.__paos04ReleaseReadback?.();")


def restore_readback_barrier(client: FoundationRuntimeClient) -> None:
    client.driver.execute_script("window.__paos04RestoreApi?.();")


def cancel_goal(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    *,
    goal_id: str,
    title: str,
    prior_revision: str,
    prior_status: str,
    screenshot_name: str,
    prove_readback_barrier: bool = False,
) -> dict[str, Any]:
    if prove_readback_barrier:
        install_readback_barrier(client)
    confirmation = open_cancel_confirmation(client, title=title)
    confirmation.click()

    if prove_readback_barrier:
        wait_until(
            lambda: client.driver.execute_script(
                """
                return window.__paos04CancelTrace?.acknowledged
                  && window.__paos04CancelTrace?.readbackStarted;
                """
            ),
            "cancellation acknowledgement before readback",
        )
        pending = goal_surface(
            client,
            revision=prior_revision,
            status=prior_status,
        )
        require(
            pending is not None,
            "Home exposed CANCELLED before Station readback",
        )
        release_readback_barrier(client)

    cancelled = wait_until(
        lambda: goal_surface(
            client,
            revision=str(int(prior_revision) + 1),
            status="CANCELLED",
        ),
        "cancelled Goal readback",
    )
    wait_until(
        lambda: visible_element(client, "[data-pt-home-goal-cancelled]"),
        "cancelled Goal acknowledgement",
    )
    focused = client.driver.execute_script(
        """
        return document.activeElement?.hasAttribute(
          'data-pt-home-goal-cancelled'
        ) || false;
        """
    )
    require(focused is True, "cancelled Goal did not receive focus")
    screenshot = artifact_dir / screenshot_name
    client.driver.save_screenshot(str(screenshot))
    if prove_readback_barrier:
        trace = client.driver.execute_script(
            "return { ...window.__paos04CancelTrace };"
        )
        restore_readback_barrier(client)
        require(
            trace.get("acknowledgementRevision")
            == trace.get("readbackRevision"),
            f"cancel acknowledgement/readback revision mismatch: {trace}",
        )
    else:
        trace = {}

    station_goal = read_goal(client, goal_id)
    require(station_goal.get("status") == 12, "Goal is not CANCELLED on Station")
    require(
        station_goal.get("revision") == str(int(prior_revision) + 1),
        "cancelled Goal revision mismatch",
    )
    require(
        cancelled.get_attribute("data-pt-home-goal-id") == goal_id,
        "Home switched Goal identity after cancellation",
    )
    return {
        "goalId": goal_id,
        "revision": station_goal["revision"],
        "status": station_goal["status"],
        "readbackBarrier": trace,
        "screenshot": str(screenshot),
    }


def stale_cancel_and_retry(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    *,
    goal_id: str,
    title: str,
    marker: str,
) -> dict[str, Any]:
    concurrent = admit_outside_projection(
        client,
        goal_id=goal_id,
        expected_revision="3",
        marker=marker,
    )
    require(concurrent.get("revision") == "4", "Goal admission revision mismatch")
    require(concurrent.get("status") == 3, "Goal admission did not reach READY")

    confirmation = open_cancel_confirmation(client, title=title)
    confirmation.click()
    failure = wait_until(
        lambda: visible_element(client, "[data-pt-home-goal-cancel-error]"),
        "stale cancellation error",
    )
    require(failure.is_displayed(), "stale cancellation error is not visible")
    pending = goal_surface(client, revision="3", status="REVIEWING")
    require(pending is not None, "failed cancellation removed the prior Goal")
    require(
        visible_element(
            client,
            "[data-pt-home-goal-cancel-confirm]",
        ).get_attribute("disabled")
        is not None,
        "stale cancellation remained directly retryable without reload",
    )
    station_before_retry = read_goal(client, goal_id)
    require(
        station_before_retry.get("status") == 3
        and station_before_retry.get("revision") == "4",
        "failed cancellation mutated Station state",
    )
    failure_screenshot = artifact_dir / "goal-cancel-stale.png"
    client.driver.save_screenshot(str(failure_screenshot))

    visible_element(client, "[data-pt-home-goal-cancel-reload]").click()
    wait_until(
        lambda: goal_surface(client, revision="4", status="READY"),
        "latest admitted Goal",
    )
    cancelled = cancel_goal(
        client,
        artifact_dir,
        goal_id=goal_id,
        title=title,
        prior_revision="4",
        prior_status="READY",
        screenshot_name="goal-cancel-ready.png",
    )
    return {
        "failureScreenshot": str(failure_screenshot),
        "stationBeforeRetry": station_before_retry,
        "cancelled": cancelled,
    }


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

    draft_id, draft_title = create_goal(
        client,
        marker=marker,
        suffix="draft",
    )
    verify_confirmation_focus_return(client, title=draft_title)
    confirmation_screenshot = artifact_dir / "goal-cancel-confirmation.png"
    open_cancel_confirmation(client, title=draft_title)
    client.driver.save_screenshot(str(confirmation_screenshot))
    visible_element(client, "[data-pt-home-goal-cancel-dismiss]").click()
    wait_until(
        lambda: confirmation_is_closed(client),
        "closed Goal cancellation confirmation after capture",
    )
    draft_cancelled = cancel_goal(
        client,
        artifact_dir,
        goal_id=draft_id,
        title=draft_title,
        prior_revision="1",
        prior_status="DRAFT",
        screenshot_name="goal-cancel-draft.png",
        prove_readback_barrier=True,
    )

    reset_goal_surface(client)
    reviewing_id, reviewing_title = create_goal(
        client,
        marker=marker,
        suffix="reviewing",
    )
    review_goal(client)
    reviewing_cancelled = cancel_goal(
        client,
        artifact_dir,
        goal_id=reviewing_id,
        title=reviewing_title,
        prior_revision="3",
        prior_status="REVIEWING",
        screenshot_name="goal-cancel-reviewing.png",
    )

    reset_goal_surface(client)
    ready_id, ready_title = create_goal(
        client,
        marker=marker,
        suffix="ready",
    )
    review_goal(client)
    ready_retry = stale_cancel_and_retry(
        client,
        artifact_dir,
        goal_id=ready_id,
        title=ready_title,
        marker=marker,
    )

    final_task_ids = active_task_ids(client)
    require(
        final_task_ids == baseline_task_ids,
        "pre-execution Goal cancellation created active work",
    )
    for goal_id in (draft_id, reviewing_id, ready_id):
        goal = read_goal(client, goal_id)
        require(goal.get("ownerPtid") == actor_ptid, "Goal owner changed")
        require(goal.get("status") == 12, "Goal did not stay CANCELLED")

    return {
        "actorPtid": actor_ptid,
        "baselineTaskIds": baseline_task_ids,
        "finalTaskIds": final_task_ids,
        "draft": draft_cancelled,
        "reviewing": reviewing_cancelled,
        "readyRetry": ready_retry,
        "screenshots": [
            str(confirmation_screenshot),
            draft_cancelled["screenshot"],
            reviewing_cancelled["screenshot"],
            ready_retry["failureScreenshot"],
            ready_retry["cancelled"]["screenshot"],
        ],
        "assertions": {
            "confirmationNamesGoal": True,
            "confirmationDismissRestoresFocus": True,
            "cancelledStateReceivesFocus": True,
            "draftCancellationAuthoritative": True,
            "reviewingCancellationAuthoritative": True,
            "readyCancellationAuthoritative": True,
            "homeWaitsForStationReadback": True,
            "staleFailurePreservesPriorState": True,
            "staleFailureOffersRecovery": True,
            "zeroNewActiveWork": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-04 requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-04 requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-04 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-04 requires a remote Station",
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
        / "paos-04-goal-cancel"
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
        raise GoalCancelJourneyError(
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
        f"PAOS-04 assertions failed: {capture['assertions']}",
    )
    print(json.dumps({
        "status": "PASS",
        "artifact": str(capture_path),
        "manifest": str(manifest_path),
        "manifestDigest": manifest_digest,
        "draftGoalId": capture["draft"]["goalId"],
        "reviewingGoalId": capture["reviewing"]["goalId"],
        "readyGoalId": capture["readyRetry"]["cancelled"]["goalId"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
