#!/usr/bin/env python3
"""Run the PAOS native Home live-progress and resync Development Journey."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

ROOT = Path(__file__).resolve().parents[4]
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
    persisted_sensitive_profile_keys,
    require,
    runtime_profile_values,
    set_realtime_stream,
    visible_element,
    wait_until,
    write_evidence_manifest,
)
from tooling.acceptance.gates.agent.personal_goal_slices.paos_06_direct_model_result import (
    read_goal,
    run_journey as run_direct_model_journey,
)
WORK_ITEM_ID = "personal-agent-os-convergence-20261003"


class PersonalGoalHomeJourneyError(RuntimeError):
    """The PAOS Home realtime Development Journey failed."""


def home_projection_readback(
    client: FoundationRuntimeClient,
    task_id: str,
) -> dict[str, Any]:
    result = client.driver.execute_async_script(
        """
        const [taskId, done] = arguments;
        import('/src/services/desktop_api.ts')
          .then(({ api }) => api.getHomeWorkProjection(0n))
          .then((projection) => done({
            ok: true,
            revision: projection.revision.toString(),
            task: projection.activeTasks.find((item) => item.taskId === taskId),
          }))
          .catch((error) => done({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        """,
        task_id,
    )
    require(
        isinstance(result, Mapping) and result.get("ok") is True,
        f"Home projection readback failed: {result}",
    )
    return dict(result)


def connection_state(
    client: FoundationRuntimeClient,
    expected: str,
) -> Any:
    return visible_element(
        client,
        f'[data-pt-home-connection-state="{expected}"]',
    )


def run_home_realtime_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
    actor_ptid: str,
    *,
    include_resync: bool,
) -> dict[str, Any]:
    direct = run_direct_model_journey(client, artifact_dir, actor_ptid)
    task_id = str(direct["taskId"])
    goal_id = str(direct["goalId"])
    progress = wait_until(
        lambda: visible_element(
            client,
            f'[data-pt-goal-progress][data-pt-goal-run="{task_id}"]',
        ),
        "live Goal progress panel",
    )
    event_id = str(progress.get_attribute("data-pt-goal-event-id") or "")
    event_sequence = int(
        progress.get_attribute("data-pt-goal-event-sequence") or "0"
    )
    projection_revision = str(
        progress.get_attribute("data-pt-goal-projection-revision") or ""
    )
    readback = home_projection_readback(client, task_id)
    require(bool(event_id), "Home live progress has no canonical domain event")
    require(event_sequence > 0, "Home live progress has no positive event sequence")
    require(
        projection_revision == str(readback["revision"]),
        "Home visible revision differs from authoritative Station projection",
    )
    live_screenshot = artifact_dir / "home-live-progress.png"
    client.driver.save_screenshot(str(live_screenshot))

    resync: dict[str, Any] | None = None
    if include_resync:
        set_realtime_stream(client, running=False)
        wait_until(
            lambda: connection_state(client, "reconnecting"),
            "Home reconnecting state",
        )
        disconnected_screenshot = artifact_dir / "home-reconnecting.png"
        client.driver.save_screenshot(str(disconnected_screenshot))

        client._station_proxy.cut()  # noqa: SLF001 - provisioned fault transport.
        try:
            client.driver.execute_async_script(
                """
                const done = arguments[0];
                import('/src/runtimes/homeRuntime.ts')
                  .then(({ refreshHomeProjection }) =>
                    refreshHomeProjection('paos-09-disconnected-readback')
                  )
                  .then(() => done({ ok: true }))
                  .catch((error) => done({
                    ok: false,
                    message: error instanceof Error ? error.message : String(error),
                  }));
                """
            )
            wait_until(
                lambda: connection_state(client, "stale"),
                "Home stale state after failed readback",
            )
            retry = visible_element(
                client,
                "[data-pt-home-connection-retry]",
            )
            require(retry.is_enabled(), "Home stale state has no retry action")
            require(
                visible_element(
                    client,
                    f'[data-pt-goal-progress][data-pt-goal-run="{task_id}"]',
                )
                is not None,
                "Home discarded accepted progress while disconnected",
            )
            stale_screenshot = artifact_dir / "home-stale.png"
            client.driver.save_screenshot(str(stale_screenshot))
        finally:
            client.restore_station_transport()

        retry.click()
        wait_until(
            lambda: connection_state(client, "fresh"),
            "Home fresh state after retry",
        )
        set_realtime_stream(client, running=True)
        recovered_readback = home_projection_readback(client, task_id)
        require(
            recovered_readback["revision"] == readback["revision"],
            "Home reconnect changed authoritative projection revision",
        )
        recovered_screenshot = artifact_dir / "home-resynced.png"
        client.driver.save_screenshot(str(recovered_screenshot))
        resync = {
            "stationReadback": recovered_readback,
            "screenshots": [
                str(disconnected_screenshot),
                str(stale_screenshot),
                str(recovered_screenshot),
            ],
            "assertions": {
                "reconnectingVisible": True,
                "staleContentPreserved": True,
                "retryVisible": True,
                "freshAfterRetry": True,
                "stationRevisionConverged": True,
            },
        }

    return {
        "actorPtid": actor_ptid,
        "goalId": goal_id,
        "taskId": task_id,
        "domainEventId": event_id,
        "domainSequence": event_sequence,
        "visibleProjectionRevision": projection_revision,
        "stationReadback": readback,
        "directModel": direct,
        "resync": resync,
        "screenshots": [
            str(live_screenshot),
            *(resync["screenshots"] if resync else []),
        ],
        "assertions": {
            "liveProgressVisible": True,
            "canonicalEventIdentityVisible": True,
            "stationRevisionMatches": True,
            "resyncVerified": not include_resync
            or all(resync["assertions"].values()),
        },
    }


def run(
    *,
    artifact_name: str,
    include_resync: bool,
    generator_path: Path,
) -> int:
    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS realtime Home Journey requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS realtime Home Journey requires a remote Station",
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
        / artifact_name
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
        capture = run_home_realtime_journey(
            client,
            artifact_dir,
            actor_ptid,
            include_resync=include_resync,
        )
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
        generator_path=generator_path,
    )
    if failure is not None:
        raise PersonalGoalHomeJourneyError(
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
        f"PAOS Home realtime assertions failed: {capture['assertions']}",
    )
    print(
        json.dumps(
            {
                "status": "PASS",
                "artifact": str(capture_path),
                "manifest": str(manifest_path),
                "manifestDigest": manifest_digest,
                "goalId": capture["goalId"],
                "taskId": capture["taskId"],
                "resyncVerified": include_resync,
            },
            sort_keys=True,
        )
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.parse_args()
    return run(
        artifact_name="paos-home-realtime",
        include_resync=True,
        generator_path=Path(__file__),
    )


if __name__ == "__main__":
    raise SystemExit(main())
