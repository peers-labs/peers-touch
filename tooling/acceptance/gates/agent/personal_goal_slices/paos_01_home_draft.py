#!/usr/bin/env python3
"""Run the PAOS-01 native Home Goal draft Development Journey."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
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

from tooling.acceptance.core.attestation import (
    commits_match,
    read_service_version,
    source_proto_digest,
)
from tooling.acceptance.core.evidence_store import source_identity, workspace_id
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.gates.agent.capability_binding_development import (
    resolve_machine_profile,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientSpec,
    FoundationRuntimeClient,
    port_open,
)
from tooling.acceptance.fixtures.chat_native_actors import (
    ACTOR_ACCOUNTS,
    fixture_password,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
)

WORK_ITEM_ID = "personal-agent-os-convergence-20261003"
PROFILE = "two"
SENSITIVE_PROFILE_KEY_MARKERS = (
    "CREDENTIAL",
    "PASSWORD",
    "PRIVATE_KEY",
    "SECRET",
    "TOKEN",
)


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


def runtime_profile_values(
    profile_values: Mapping[str, str],
) -> dict[str, str]:
    return {
        key: value
        for key, value in profile_values.items()
        if not any(
            marker in key.upper()
            for marker in SENSITIVE_PROFILE_KEY_MARKERS
        )
    }


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inspect_runtime_identity(
    client: FoundationRuntimeClient,
    profile_values: Mapping[str, str],
) -> dict[str, Any]:
    source = source_identity(ROOT)
    station_url = str(profile_values.get("PT_STATION_URL") or "").rstrip("/")
    deployment_environment = str(
        profile_values.get("PT_STATION_DEPLOY_ENV") or ""
    ).strip()
    require(bool(station_url), "Profile two has no Station URL")
    require(
        bool(deployment_environment),
        "Profile two has no Station deployment environment",
    )

    version = read_service_version(station_url)
    live_commit = str(version.get("build_commit") or "")
    deployed_commit, workspace_digest, protocol_digest = (
        resolve_remote_source_identity(deployment_environment)
    )
    local_protocol_digest = source_proto_digest(ROOT)
    require(
        commits_match(live_commit, source["commit"]),
        "Station live build does not match the Journey source",
    )
    require(
        commits_match(deployed_commit, source["commit"]),
        "Station deployment source does not match the Journey source",
    )
    require(
        workspace_digest == "clean",
        "Station deployment source is dirty",
    )
    require(
        protocol_digest == local_protocol_digest,
        "Station and Desktop protocol digests differ",
    )

    native_binary = (
        client.spec.cargo_target_dir
        / "debug"
        / "peers-touch-desktop"
    )
    require(native_binary.is_file(), "Native Desktop binary is missing")
    tauri_bridge_available = client.driver.execute_script(
        """
        return typeof window.__TAURI_INTERNALS__ === 'object'
          || typeof window.__TAURI__ === 'object';
        """
    )
    require(
        tauri_bridge_available is True,
        "Native Tauri bridge is unavailable",
    )
    listener_ports = {
        "gateway": port_open(client.spec.gateway_port),
        "renderer": port_open(client.spec.renderer_port),
        "webdriver": port_open(client.spec.webdriver_port),
    }
    require(all(listener_ports.values()), "Native Desktop listeners are unavailable")
    webdriver_session_id = str(client.driver.session_id or "")
    require(bool(webdriver_session_id), "Native WebDriver session is unavailable")

    capabilities = dict(client.driver.capabilities or {})
    return {
        "runtimeBinding": (
            f"profile://{PROFILE}/{deployment_environment}@{deployed_commit}"
        ),
        "profile": PROFILE,
        "station": {
            "url": station_url,
            "deploymentEnvironment": deployment_environment,
            "liveCommit": live_commit,
            "deployedCommit": deployed_commit,
            "workspaceDigest": workspace_digest,
            "protocolDigest": protocol_digest,
            "buildTime": str(version.get("build_time") or ""),
            "runtimeIdentity": str(
                version.get("peer_id")
                or version.get("station_peer_id")
                or version.get("service_id")
                or ""
            ),
        },
        "client": {
            "runtime": client.spec.runtime,
            "binary": native_binary.relative_to(ROOT).as_posix(),
            "binaryBytes": native_binary.stat().st_size,
            "binarySha256": sha256_file(native_binary),
            "windowUrl": str(client.driver.current_url),
            "tauriBridgeAvailable": tauri_bridge_available,
            "listenerPorts": listener_ports,
            "webdriverSessionId": webdriver_session_id,
            "gatewayPort": client.spec.gateway_port,
            "rendererPort": client.spec.renderer_port,
            "webdriverPort": client.spec.webdriver_port,
            "webdriverBrowserName": str(
                capabilities.get("browserName") or ""
            ),
            "webdriverPlatformName": str(
                capabilities.get("platformName") or ""
            ),
        },
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
    }


def persisted_sensitive_profile_keys(
    artifact_dir: Path,
    profile_values: Mapping[str, str],
) -> list[str]:
    sensitive_keys = [
        key
        for key in profile_values
        if any(
            marker in key.upper()
            for marker in SENSITIVE_PROFILE_KEY_MARKERS
        )
    ]
    leaks: list[str] = []
    for path in sorted(artifact_dir.rglob("*")):
        if not path.is_file() or path.stat().st_size > 10 * 1024 * 1024:
            continue
        data = path.read_bytes()
        if any(key.encode("utf-8") in data for key in sensitive_keys):
            leaks.append(path.relative_to(artifact_dir).as_posix())
    return leaks


def write_evidence_manifest(
    artifact_dir: Path,
    capture_path: Path,
    native_log_path: Path,
    *,
    generator_path: Path | None = None,
) -> tuple[Path, str]:
    evidence_paths = {
        capture_path,
        native_log_path,
        *sorted(artifact_dir.glob("*.png")),
        *sorted(artifact_dir.rglob("*.log")),
    }
    entries = [
        {
            "path": path.relative_to(artifact_dir).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in sorted(evidence_paths)
        if path.is_file()
    ]
    generator_path = (
        Path(__file__).resolve()
        if generator_path is None
        else generator_path.resolve()
    )
    manifest = {
        "algorithm": "sha256",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "generator": {
            "path": generator_path.relative_to(ROOT).as_posix(),
            "sha256": sha256_file(generator_path),
        },
        "files": entries,
    }
    manifest_path = artifact_dir / "evidence-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    manifest_digest = sha256_file(manifest_path)
    return manifest_path, manifest_digest


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
    account = str(
        profile_env.get("CHAT_NATIVE_DEMO_ACCOUNT")
        or ACTOR_ACCOUNTS["alice"]
    ).strip()
    password = fixture_password().strip()
    require(bool(account), "Profile two has no native demo account")
    require(bool(password), "Native actor fixture has no credential")
    client.configure_station(timeout=60)
    login = client.harness(
        "loginWithPassword",
        {
            "account": account,
            "password": password,
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
    actor_ptid: str,
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

    client._station_proxy.cut()  # noqa: SLF001 - provisioned fault transport.
    try:
        visible_element(client, "[data-pt-home-goal-create]").click()
        wait_until(
            lambda: visible_element(
                client,
                "[data-pt-home-goal-create-error]",
            ),
            "Goal create error",
        )
        preserved_title = str(
            visible_element(
                client,
                "[data-pt-home-goal-title]",
            ).get_attribute("value")
            or ""
        )
        preserved_outcome = str(
            visible_element(
                client,
                "[data-pt-home-goal-outcome]",
            ).get_attribute("value")
            or ""
        )
        saved_after_failure = [
            element
            for element in client.driver.find_elements(
                By.CSS_SELECTOR,
                '[data-pt-home-goal][data-pt-home-goal-status="DRAFT"]',
            )
            if element.is_displayed()
        ]
        require(
            preserved_title == title,
            "Goal title changed after create failure",
        )
        require(
            preserved_outcome == outcome,
            "Goal outcome changed after create failure",
        )
        require(
            not saved_after_failure,
            "failed Goal create exposed a saved Goal",
        )
        error_screenshot = artifact_dir / "goal-create-error.png"
        client.driver.save_screenshot(str(error_screenshot))
    finally:
        client.restore_station_transport()

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
    saved_owner = str(
        saved.get_attribute("data-pt-home-goal-owner") or ""
    )
    saved_title = str(
        visible_element(
            client,
            "[data-pt-home-goal-title-readback]",
        ).text
        or ""
    )
    saved_outcome = str(
        visible_element(
            client,
            "[data-pt-home-goal-outcome-readback]",
        ).text
        or ""
    )
    require(bool(goal_id), "saved Goal has no Station identity")
    require(revision == "1", f"saved Goal revision is {revision}, want 1")
    require(saved_owner == actor_ptid, "saved Goal owner does not match actor")
    require(saved_title == title, "saved Goal title differs from submitted title")
    require(
        saved_outcome == outcome,
        "saved Goal outcome differs from submitted outcome",
    )
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
    reopened_owner = str(
        reopened.get_attribute("data-pt-home-goal-owner") or ""
    )
    reopened_title = str(
        visible_element(
            client,
            "[data-pt-home-goal-title-readback]",
        ).text
        or ""
    )
    reopened_outcome = str(
        visible_element(
            client,
            "[data-pt-home-goal-outcome-readback]",
        ).text
        or ""
    )
    require(
        reopened_owner == actor_ptid,
        "reopened Goal owner does not match actor",
    )
    require(reopened_title == title, "reopened Goal title changed")
    require(reopened_outcome == outcome, "reopened Goal outcome changed")

    return {
        "goalId": goal_id,
        "revision": revision,
        "status": reopened.get_attribute("data-pt-home-goal-status"),
        "title": title,
        "outcome": outcome,
        "readbackRevision": reopened.get_attribute(
            "data-pt-home-goal-readback-revision"
        ),
        "ownerPtid": reopened_owner,
        "screenshots": [
            str(error_screenshot),
            str(created_screenshot),
            str(reopened_screenshot),
        ],
        "assertions": {
            "createFailureVisible": True,
            "createFailurePreservesInput": (
                preserved_title == title and preserved_outcome == outcome
            ),
            "createFailureCreatesNoLocalPlaceholder": not saved_after_failure,
            "realUiCreate": True,
            "stableGoalIdentity": True,
            "draftVisible": (
                reopened.get_attribute("data-pt-home-goal-status") == "DRAFT"
            ),
            "stationReadbackMatches": (
                reopened.get_attribute("data-pt-home-goal-readback-revision")
                == revision
                and reopened_owner == actor_ptid
                and reopened_title == title
                and reopened_outcome == outcome
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
    try:
        client.start()
        actor_ptid = authenticate(client, profile_values)
        capture = run_journey(client, artifact_dir, actor_ptid)
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
        cleanup["runtimeProfileReleased"] = (
            not client.runtime_profile.exists()
        )
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
    )
    if failure is not None:
        raise HomeGoalDraftError(
            f"{failure}; capture={capture_path}; manifest={manifest_path}; "
            f"manifestDigest={manifest_digest}; cleanup={cleanup}"
        ) from failure
    require(cleanup.get("status") == "clean", f"cleanup failed: {cleanup}")
    require(
        capture["secretScan"]["status"] == "passed",
        f"sensitive profile keys persisted: {leaked_profile_keys}",
    )
    manifested_paths = {
        entry["path"]
        for entry in json.loads(
            manifest_path.read_text(encoding="utf-8"),
        )["files"]
    }
    require(
        "capture.json" in manifested_paths
        and client.log_path.name in manifested_paths
        and {
            Path(path).name for path in capture["screenshots"]
        }.issubset(manifested_paths),
        f"evidence manifest is incomplete: {sorted(manifested_paths)}",
    )
    require(
        all(capture["assertions"].values()),
        f"PAOS-01 assertions failed: {capture['assertions']}",
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
