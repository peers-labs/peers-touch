#!/usr/bin/env python3
"""Run the PAOS-07 native durable Goal event Development Journey."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
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
from tooling.acceptance.gates.agent.personal_goal_slices.paos_03_goal_start import (
    goal_surface,
)
from tooling.acceptance.gates.agent.personal_goal_slices.paos_04_goal_cancel import (
    reset_goal_surface,
)

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"


class DurableGoalEventJourneyError(RuntimeError):
    """The PAOS-07 Development Journey failed."""


def run_publish_failure_probe(artifact_dir: Path) -> dict[str, Any]:
    command = [
        "go",
        "test",
        "./app/subserver/agent/service",
        "-run",
        (
            "TestAgentRealtimeRelay"
            "(PublishRetryKeepsStableIDAndActorOrder"
            "|PublishFailurePreservesGoalReadback)"
        ),
        "-count=1",
    ]
    completed = subprocess.run(
        command,
        cwd=ROOT / "apps" / "station",
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    log_path = artifact_dir / "publish-failure-probe.log"
    log_path.write_text(
        completed.stdout + completed.stderr,
        encoding="utf-8",
    )
    require(
        completed.returncode == 0,
        f"Station publish-failure probe failed: {log_path}",
    )
    return {
        "command": command,
        "exitCode": completed.returncode,
        "log": str(log_path),
        "assertions": {
            "publisherFailureInjected": True,
            "pendingRetryPreservesEventIdentity": True,
            "committedGoalReadbackSurvivesPublishFailure": True,
        },
    }


def run_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    actor_ptid: str,
) -> dict[str, Any]:
    publish_failure_probe = run_publish_failure_probe(artifact_dir)
    navigate_to_hash(client, "home")
    wait_until(
        lambda: visible_element(client, "[data-pt-home]"),
        "Home surface",
    )
    reset_goal_surface(client)

    marker = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    title = f"PAOS-07 durable event Goal {marker}"
    outcome = "Committed Goal progress survives unavailable live delivery."
    replace_value(
        visible_element(client, "[data-pt-home-goal-title]"),
        title,
    )
    replace_value(
        visible_element(client, "[data-pt-home-goal-outcome]"),
        outcome,
    )

    set_realtime_stream(client, running=False)
    visible_element(client, "[data-pt-home-goal-create]").click()
    saved = wait_until(
        lambda: goal_surface(client, revision="1", status="DRAFT"),
        "Goal committed while realtime receiver is unavailable",
    )
    goal_id = str(saved.get_attribute("data-pt-home-goal-id") or "")
    require(bool(goal_id), "committed Goal has no identity")
    committed_screenshot = artifact_dir / "goal-committed-stream-stopped.png"
    client.driver.save_screenshot(str(committed_screenshot))

    station_during_outage = read_goal(client, goal_id)
    require(
        station_during_outage.get("ownerPtid") == actor_ptid
        and station_during_outage.get("revision") == "1"
        and station_during_outage.get("status") == 1,
        f"Station Goal readback during delivery outage is invalid: "
        f"{station_during_outage}",
    )

    navigate_to_hash(client, "agent")
    wait_until(
        lambda: "#/agent" in str(client.driver.current_url),
        "Agent surface while realtime receiver is unavailable",
    )
    navigate_to_hash(client, "home")
    reopened = wait_until(
        lambda: (
            element
            if (
                (
                    element := visible_element(
                        client,
                        "[data-pt-home-goal]",
                    )
                ).get_attribute("data-pt-home-goal-id")
                == goal_id
                and element.get_attribute(
                    "data-pt-home-goal-readback-revision"
                )
                == "1"
            )
            else None
        ),
        "Station-backed Goal after delivery outage",
    )
    reopened_screenshot = artifact_dir / "goal-reopened-stream-stopped.png"
    client.driver.save_screenshot(str(reopened_screenshot))
    set_realtime_stream(client, running=True)

    station_after_reconnect = read_goal(client, goal_id)
    require(
        station_after_reconnect == station_during_outage,
        "Goal readback changed after realtime reconnect",
    )
    return {
        "actorPtid": actor_ptid,
        "goalId": goal_id,
        "revision": "1",
        "status": "DRAFT",
        "deliveryFault": "canonical-realtime-receiver-disconnected",
        "publishFailureProbe": publish_failure_probe,
        "stationDuringOutage": station_during_outage,
        "stationAfterReconnect": station_after_reconnect,
        "screenshots": [
            str(committed_screenshot),
            str(reopened_screenshot),
        ],
        "assertions": {
            "realUiMutation": True,
            "publisherFailureInjected": publish_failure_probe[
                "assertions"
            ]["publisherFailureInjected"],
            "pendingRetryPreservesEventIdentity": publish_failure_probe[
                "assertions"
            ]["pendingRetryPreservesEventIdentity"],
            "receiverUnavailableDuringCommit": True,
            "stationReadbackDuringOutage": True,
            "homeRefreshUsesCommittedGoal": (
                reopened.get_attribute("data-pt-home-goal-id") == goal_id
                and reopened.get_attribute(
                    "data-pt-home-goal-readback-revision"
                )
                == "1"
            ),
            "reconnectPreservesRevision": (
                station_after_reconnect == station_during_outage
            ),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-07 requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-07 requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-07 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-07 requires a remote Station",
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
        / "paos-07-durable-goal-events"
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
        raise DurableGoalEventJourneyError(
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
        f"PAOS-07 assertions failed: {capture['assertions']}",
    )
    print(
        json.dumps(
            {
                "status": "PASS",
                "artifact": str(capture_path),
                "manifest": str(manifest_path),
                "manifestDigest": manifest_digest,
                "goalId": capture["goalId"],
                "revision": capture["revision"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
