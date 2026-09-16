#!/usr/bin/env python3
"""Run the focused V2-J02 capability-binding Development Journey."""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import traceback
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.evidence_store import (
    EvidenceStore,
    source_identity,
    workspace_id,
)
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationRuntimeClient,
    FoundationRuntimePair,
)
from tooling.acceptance.gates.agent.foundation_scenario_runner import (
    _build_client_manifest,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_BINDING_GATE,
    HomeStationProvisioner,
)


WORKSPACE_ID = workspace_id(ROOT)
WORK_ITEM_ID = "MCA-V2-ALIGNMENT-J02"
JOURNEY_ID = "V2-J02"
PROFILE = "two"
J01_IDENTITY_SEED = (
    Path.home()
    / ".peers-touch"
    / "dev"
    / "workspaces"
    / WORKSPACE_ID
    / "runtime"
    / PROFILE
    / "data"
    / "v2-j01-native-bfdc1ae5f-run4"
)


class CapabilityBindingDevelopmentError(RuntimeError):
    """The V2-J02 Development Journey failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CapabilityBindingDevelopmentError(message)


def resolve_machine_profile() -> tuple[str, Path, int, dict[str, str]]:
    completed = subprocess.run(
        [
            "node",
            "tooling/scripts/local-dev/machine-dev.mjs",
            "resolve",
        ],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    require(
        completed.returncode == 0,
        "machine control plane did not resolve the active profile",
    )
    try:
        resolved = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise CapabilityBindingDevelopmentError(
            "machine control plane returned invalid JSON"
        ) from error
    binding = resolved.get("binding")
    profile = resolved.get("profile")
    ports = resolved.get("ports")
    require(
        resolved.get("authority") == "machine-control-plane"
        and isinstance(binding, Mapping)
        and isinstance(profile, Mapping)
        and isinstance(ports, Mapping),
        "machine control plane resolution is incomplete",
    )
    require(
        binding.get("workspaceId") == WORKSPACE_ID
        and binding.get("canonicalRoot") == str(ROOT)
        and binding.get("head") == source_identity(ROOT)["commit"],
        "machine control plane worktree identity mismatch",
    )
    require(
        profile.get("sourceState") == "tracked-clean",
        "machine control plane profile source is not tracked-clean",
    )
    profile_name = str(binding.get("profile") or "")
    profile_file = Path(str(profile.get("profileFile") or "")).resolve()
    slot = int(binding.get("slot"))
    values = load_env_file(profile_file)
    values.update(
        {
            "PT_DEV_PROFILE": profile_name,
            "PT_DEV_SLOT": str(slot),
            "PT_DESKTOP_APP_GATEWAY_PORT": str(
                ports["desktopAppGateway"]
            ),
            "PT_DESKTOP_APP_WEB_PORT": str(ports["desktopAppWeb"]),
            "PT_DESKTOP_WEB_GATEWAY_PORT": str(
                ports["desktopWebGateway"]
            ),
            "PT_DESKTOP_WEB_WEB_PORT": str(ports["desktopWebWeb"]),
        }
    )
    return profile_name, profile_file, slot, values


def seed_native_client_state(
    *,
    seed_root: Path,
    target_storage_root: Path,
    target_root: Path,
    station_url: str,
) -> None:
    result_path = seed_root / "journey-result.json"
    identity_root = seed_root / "actor-identity"
    storage_root = seed_root / "storage"
    try:
        result = json.loads(result_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CapabilityBindingDevelopmentError(
            "accepted J01 identity seed evidence is unavailable"
        ) from error
    require(
        result.get("status") == "FUNCTIONAL_PASS"
        and result.get("journey") == "V2-J01"
        and str(result.get("stationUrl") or "").rstrip("/")
        == station_url.rstrip("/"),
        "accepted J01 identity seed does not match Profile two",
    )
    require(
        identity_root.is_dir()
        and storage_root.is_dir()
        and len(tuple(identity_root.rglob("*.key"))) == 1,
        "accepted J01 Native state seed is incomplete",
    )
    require(
        not identity_root.is_symlink()
        and not storage_root.is_symlink()
        and not any(path.is_symlink() for path in identity_root.rglob("*")),
        "accepted J01 Native state seed contains a symlink",
    )
    require(
        not any(path.is_symlink() for path in storage_root.rglob("*")),
        "accepted J01 Native storage seed contains a symlink",
    )
    require(
        not target_root.exists() and not target_storage_root.exists(),
        "J02 temporary Native state root already exists",
    )
    target_root.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copytree(identity_root, target_root, symlinks=False)
    target_storage_root.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copytree(storage_root, target_storage_root, symlinks=False)


def port_released(port: int) -> bool:
    for family, address in (
        (socket.AF_INET, "127.0.0.1"),
        (socket.AF_INET6, "::1"),
    ):
        try:
            with socket.socket(family) as probe:
                if probe.connect_ex((address, port)) == 0:
                    return False
        except OSError:
            continue
    return True


def assertion_values(payload: Mapping[str, Any], name: str) -> list[bool]:
    assertions = payload.get("assertions")
    require(isinstance(assertions, Mapping), f"{name} assertions are missing")
    require(bool(assertions), f"{name} assertions are empty")
    values = list(assertions.values())
    require(
        all(isinstance(value, bool) for value in values),
        f"{name} assertions must be booleans",
    )
    return [bool(value) for value in values]


def evaluate_capability_binding(
    capture: Mapping[str, Any],
) -> dict[str, bool]:
    inventory = capture.get("inventory")
    incompatible = capture.get("incompatible")
    require(isinstance(inventory, Mapping), "inventory capture is missing")
    require(
        isinstance(incompatible, Mapping),
        "incompatible capability capture is missing",
    )
    inventory_cleanup = inventory.get("cleanup")
    incompatible_cleanup = incompatible.get("cleanup")
    assertions = {
        "inventoryBindingAndFailureStates":
            all(assertion_values(inventory, "inventory")),
        "inventoryCleanup":
            isinstance(inventory_cleanup, Mapping)
            and inventory_cleanup.get("status") == "clean",
        "incompatibleCapability":
            all(assertion_values(incompatible, "incompatible")),
        "incompatibleCleanup":
            isinstance(incompatible_cleanup, Mapping)
            and incompatible_cleanup.get("status") == "clean",
        "nativeReceiverObserved":
            isinstance(incompatible.get("receiver-dom"), Mapping)
            and incompatible["receiver-dom"].get("visible") is True,
        "stationReadbackObserved":
            isinstance(incompatible.get("station-readback"), Mapping)
            and incompatible["station-readback"].get("entityKind")
            == "agent-capability-readiness",
    }
    failed = sorted(name for name, passed in assertions.items() if not passed)
    if failed:
        raise CapabilityBindingDevelopmentError(
            "V2-J02 facts failed assertions: " + ", ".join(failed)
        )
    return assertions


def authenticate_native_client(
    client: FoundationRuntimeClient,
    profile_env: Mapping[str, str],
) -> None:
    client.configure_station(timeout=60)
    login = client.harness(
        "loginWithPassword",
        {
            "account": "alice@p.t",
            "password": profile_env["CHAT_NATIVE_DEMO_PASSWORD"],
        },
        timeout=120,
    )
    require(
        isinstance(login, Mapping)
        and login.get("authenticated") is True
        and bool(login.get("actorId")),
        "Native actor login failed",
    )
    navigation = client.harness("navigateToAgent", {}, timeout=60)
    require(
        isinstance(navigation, Mapping)
        and navigation.get("navigated") is True,
        "Native Agent navigation failed",
    )
    health = client.harness(
        "getAcceptanceHarnessStatus",
        {},
        timeout=30,
    )
    require(
        isinstance(health, Mapping) and health.get("ready") is True,
        "Native Agent Harness is unavailable",
    )


def cleanup_clients(runtime_pair: FoundationRuntimePair) -> dict[str, Any]:
    result = runtime_pair.stop(remove_storage=False)
    fallback: list[dict[str, Any]] = []
    if result.get("status") != "clean":
        for mode in ("web", "app"):
            completed = subprocess.run(
                ["node", "tooling/devctl/index.mjs", "desktop", "stop", "--mode", mode],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
                timeout=60,
            )
            fallback.append({"mode": mode, "returnCode": completed.returncode})
    ports = {
        "nativeGateway": port_released(runtime_pair.native.spec.gateway_port),
        "nativeRenderer": port_released(runtime_pair.native.spec.renderer_port),
        "nativeWebDriver": port_released(runtime_pair.native.spec.webdriver_port),
        "browserGateway": port_released(runtime_pair.browser.spec.gateway_port),
        "browserRenderer": port_released(runtime_pair.browser.spec.renderer_port),
        "browserWebDriver": port_released(runtime_pair.browser.spec.webdriver_port),
    }
    return {
        "initial": result,
        "fallback": fallback,
        "portsReleased": ports,
        "status": (
            "clean"
            if all(ports.values())
            and all(item["returnCode"] == 0 for item in fallback)
            else "failed"
        ),
    }


def main() -> int:
    started = time.monotonic()
    artifact_run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    artifact_dir = (
        Path.home()
        / ".peers-touch"
        / "dev"
        / "workspaces"
        / WORKSPACE_ID
        / "workflow"
        / WORK_ITEM_ID
        / "artifacts"
        / artifact_run_id
    )
    artifact_dir.mkdir(parents=True, exist_ok=False)
    attestation_root = Path("/tmp") / f"mca-capability-binding-{artifact_run_id}"
    os.environ["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(attestation_root)
    store = EvidenceStore(attestation_root, worktree=ROOT)
    attestation_run = store.begin_run(
        AGENT_V2_BINDING_GATE,
        source=source_identity(ROOT),
    )
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_BINDING_GATE
    os.environ["PT_ACCEPTANCE_RUN_ID"] = attestation_run.run_id
    os.environ["PT_ACCEPTANCE_APPROVED_PROFILE"] = PROFILE

    activation = subprocess.run(
        ["make", "profile", f"PROFILE={PROFILE}"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    require(activation.returncode == 0, "failed to activate Profile two")
    provisioner = HomeStationProvisioner(
        EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "home-station.yaml")
    )
    (
        profile_name,
        profile_file,
        slot,
        profile_env,
    ) = resolve_machine_profile()
    require(profile_name == PROFILE, "active profile is not Profile two")
    provisioner._resolve_active_profile = lambda: (
        profile_name,
        profile_file,
        slot,
        dict(profile_env),
    )
    os.environ.update(profile_env)
    os.environ["PT_DEV_PROFILE"] = PROFILE
    deployment_environment = profile_env.get("PT_STATION_DEPLOY_ENV", "")
    require(
        bool(deployment_environment),
        "Profile two has no Station deployment environment",
    )
    runtime_pair: FoundationRuntimePair | None = None
    manifest = None
    capture: dict[str, Any] = {}
    primary_error: BaseException | None = None
    cleanup: dict[str, Any] = {
        "status": "clean",
        "clients": None,
        "provisionerResourcesReleased": [],
        "failures": [],
    }

    try:
        manifest = provisioner.provision(AGENT_V2_BINDING_GATE)
        require(
            manifest.state.value == "FIXTURE_READY",
            (
                f"J02 provisioning did not become ready: "
                f"{manifest.blocked_reason or manifest.state.value}"
            ),
        )
        runtime_pair = FoundationRuntimePair.from_manifest(
            _build_client_manifest(manifest.to_dict()),
            profile_env=profile_env,
            startup_timeout=900,
        )
        client = runtime_pair.native
        seed_native_client_state(
            seed_root=J01_IDENTITY_SEED,
            target_storage_root=client.spec.storage_root,
            target_root=client.actor_identity_root,
            station_url=profile_env["PT_STATION_URL"],
        )
        client.start()
        authenticate_native_client(client, profile_env)
        sample_id = f"mca-j02-{artifact_run_id}"
        inventory = client.harness(
            "runCapabilityBindingDevelopment",
            {"sampleId": sample_id},
            timeout=480,
        )
        incompatible = client.harness(
            "foundationDirectProbe",
            {
                "platform": "desktop_app",
                "locale": "en",
                "cell": "BASE-INCOMPATIBLE_CAPABILITY",
                "sampleId": sample_id,
            },
            timeout=480,
        )
        require(
            isinstance(inventory, Mapping)
            and isinstance(incompatible, Mapping),
            "V2-J02 Harness returned invalid evidence",
        )
        capture = {
            "inventory": dict(inventory),
            "incompatible": dict(incompatible),
        }
        capture["assertions"] = evaluate_capability_binding(capture)
    except BaseException as error:
        primary_error = error
    finally:
        if runtime_pair is not None:
            try:
                cleanup["clients"] = cleanup_clients(runtime_pair)
                if cleanup["clients"].get("status") != "clean":
                    cleanup["status"] = "failed"
                    cleanup["failures"].append("client runtime cleanup failed")
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    f"client runtime cleanup: {type(error).__name__}: {error}"
                )
            for runtime, client in (
                ("native", runtime_pair.native),
                ("browser", runtime_pair.browser),
            ):
                if client.log_path.is_file():
                    target = artifact_dir / runtime / client.log_path.name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(client.log_path, target)
        try:
            cleanup["provisionerResourcesReleased"] = list(
                provisioner.cleanup()
            )
        except BaseException as error:
            cleanup["status"] = "failed"
            cleanup["failures"].append(
                f"provisioner cleanup: {type(error).__name__}: {error}"
            )

    assertions = capture.get("assertions")
    result_name = (
        "PASS"
        if (
            primary_error is None
            and isinstance(assertions, Mapping)
            and all(assertions.values())
            and cleanup["status"] == "clean"
        )
        else "FAIL"
    )
    station = manifest.services.get("station") if manifest is not None else None
    result = {
        "artifactKind": "development-functional-result",
        "schemaVersion": 1,
        "artifactRunId": artifact_run_id,
        "workItemId": WORK_ITEM_ID,
        "journeyId": JOURNEY_ID,
        "verificationClass": "FUNCTIONAL_CHECK",
        "result": result_name,
        "source": source_identity(ROOT),
        "runtimeIdentity": {
            "profile": PROFILE,
            "stationDeploymentEnvironment": deployment_environment,
            "stationBuildCommit": station.live_commit if station else "",
            "clientRuntime": "native-tauri",
        },
        "assertions": assertions or {},
        "capture": capture,
        "failure": (
            []
            if primary_error is None
            else [
                {
                    "type": type(primary_error).__name__,
                    "message": str(primary_error)[:4096],
                }
            ]
        ),
        "cleanup": cleanup,
        "durationMs": int((time.monotonic() - started) * 1000),
    }
    result_path = artifact_dir / "result.json"
    result_path.write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    attestation_run.close()
    shutil.rmtree(attestation_root, ignore_errors=True)
    sys.stdout.write(f"{result_path}\n")
    if primary_error is not None:
        traceback.print_exception(
            type(primary_error),
            primary_error,
            primary_error.__traceback__,
        )
    return 0 if result_name == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
