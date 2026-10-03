#!/usr/bin/env python3
"""Run the PAOS-01 native Home Goal draft Development Journey."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"
PROFILE = "two"


class HomeGoalDraftError(RuntimeError):
    """The PAOS-01 Development Journey failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise HomeGoalDraftError(message)


def wait_until(
    predicate: Callable[[], Any],
    description: str,
    *,
    timeout: float = 120,
    interval: float = 0.2,
) -> Any:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as error:  # noqa: BLE001 - retained for diagnostics.
            last_error = error
        time.sleep(min(interval, max(0.0, deadline - time.monotonic())))
    suffix = f"; last error: {last_error}" if last_error else ""
    raise HomeGoalDraftError(f"timed out waiting for {description}{suffix}")


def visible_element(client: FoundationRuntimeClient, selector: str) -> Any:
    element = client.driver.find_element(By.CSS_SELECTOR, selector)
    return element if element.is_displayed() else None


def navigate_to_hash(client: FoundationRuntimeClient, route: str) -> None:
    client.driver.execute_script(
        """
        window.history.pushState(null, '', arguments[0]);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        """,
        f"#/{route}",
    )


def authenticate(
    client: FoundationRuntimeClient,
    profile_env: Mapping[str, str],
) -> str:
    client.configure_station(timeout=60)
    login = client.harness(
        "loginWithPassword",
        {
            "account": profile_env.get("CHAT_NATIVE_DEMO_ACCOUNT", "alice@p.t"),
            "password": profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", "1"),
        },
        timeout=120,
    )
    require(
        isinstance(login, Mapping)
        and login.get("authenticated") is True
        and bool(login.get("actorId")),
        f"Native Desktop login failed: {login}",
    )
    return str(login["actorId"])


def run_journey(
    client: FoundationRuntimeClient,
    artifact_dir: Path,
) -> dict[str, Any]:
    navigate_to_hash(client, "home")
    wait_until(
        lambda: visible_element(client, "[data-pt-home]"),
        "Home surface",
    )

    marker = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    title = f"PAOS-01 durable Goal {marker}"
    outcome = "The same Station Goal is visible after leaving and reopening Home."
    title_input = visible_element(client, "[data-pt-home-goal-title]")
    outcome_input = visible_element(client, "[data-pt-home-goal-outcome]")
    title_input.send_keys(title)
    outcome_input.send_keys(outcome)
    visible_element(client, "[data-pt-home-goal-create]").click()

    saved = wait_until(
        lambda: visible_element(
            client,
            '[data-pt-home-goal][data-pt-home-goal-status="DRAFT"]',
        ),
        "saved Goal draft",
    )
    goal_id = str(saved.get_attribute("data-pt-home-goal-id") or "")
    revision = str(saved.get_attribute("data-pt-home-goal-revision") or "")
    require(bool(goal_id), "saved Goal has no Station identity")
    require(revision == "1", f"saved Goal revision is {revision}, want 1")
    created_screenshot = artifact_dir / "goal-created.png"
    client.driver.save_screenshot(str(created_screenshot))

    navigate_to_hash(client, "agent")
    wait_until(
        lambda: "#/agent" in str(client.driver.current_url),
        "Agent surface after leaving Home",
    )
    navigate_to_hash(client, "home")
    reopened = wait_until(
        lambda: (
            element
            if (
                (element := visible_element(client, "[data-pt-home-goal]"))
                .get_attribute("data-pt-home-goal-id")
                == goal_id
                and element.get_attribute(
                    "data-pt-home-goal-readback-revision"
                )
                == revision
            )
            else None
        ),
        "Station-backed Goal reopen",
    )
    reopened_screenshot = artifact_dir / "goal-reopened.png"
    client.driver.save_screenshot(str(reopened_screenshot))

    return {
        "goalId": goal_id,
        "revision": revision,
        "status": reopened.get_attribute("data-pt-home-goal-status"),
        "title": title,
        "outcome": outcome,
        "readbackRevision": reopened.get_attribute(
            "data-pt-home-goal-readback-revision"
        ),
        "screenshots": [
            str(created_screenshot),
            str(reopened_screenshot),
        ],
        "assertions": {
            "realUiCreate": True,
            "stableGoalIdentity": True,
            "draftVisible": (
                reopened.get_attribute("data-pt-home-goal-status") == "DRAFT"
            ),
            "stationReadbackMatches": (
                reopened.get_attribute("data-pt-home-goal-readback-revision")
                == revision
            ),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("development",), required=True)
    parser.add_argument("--require-ui", action="store_true")
    parser.add_argument("--require-station-readback", action="store_true")
    args = parser.parse_args()
    require(args.require_ui, "PAOS-01 requires a real UI action")
    require(
        args.require_station_readback,
        "PAOS-01 requires Station readback",
    )

    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "PAOS-01 requires Profile two")
    require(
        profile_env.get("PT_STATION_MODE") == "remote",
        "PAOS-01 requires a remote Station",
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
        / "paos-01-home-draft"
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
        profile_env=profile_values,
        startup_timeout=900,
        launch_env={"PT_STATION_SKIP_DEPLOY": "true"},
    )

    capture: dict[str, Any] = {}
    failure: BaseException | None = None
    cleanup: dict[str, Any] = {"status": "not-started"}
    try:
        client.start()
        actor_ptid = authenticate(client, profile_values)
        capture = run_journey(client, artifact_dir)
        capture["actorPtid"] = actor_ptid
        capture["profile"] = profile_name
        capture["source"] = source_identity(ROOT)
    except BaseException as error:
        failure = error
        if client.driver is not None:
            client.driver.save_screenshot(str(artifact_dir / "failure.png"))
    finally:
        cleanup = client.stop(remove_storage=True)

    capture["cleanup"] = cleanup
    capture_path = artifact_dir / "capture.json"
    capture_path.write_text(
        json.dumps(capture, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    if failure is not None:
        raise HomeGoalDraftError(
            f"{failure}; capture={capture_path}; cleanup={cleanup}"
        ) from failure
    require(cleanup.get("status") == "clean", f"cleanup failed: {cleanup}")
    require(
        all(capture["assertions"].values()),
        f"PAOS-01 assertions failed: {capture['assertions']}",
    )
    print(json.dumps({
        "status": "PASS",
        "artifact": str(capture_path),
        "goalId": capture["goalId"],
        "revision": capture["revision"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
