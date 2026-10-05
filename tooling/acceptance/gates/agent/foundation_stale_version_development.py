#!/usr/bin/env python3
"""Run the focused G-FE1 lifecycle stale-version Development Journey."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
PROFILE = "chat-native-disposable"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
os.environ.setdefault("PT_ACCEPTANCE_APPROVED_PROFILE", PROFILE)

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.evidence_store import (
    EvidenceStore,
    source_identity,
    workspace_id,
)
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.fixtures.chat_native_actors import reset_fixture
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationRuntimeClient,
    FoundationRuntimePair,
)
from tooling.acceptance.gates.agent.foundation_scenario_runner import (
    _authenticate_clients,
    _build_client_manifest,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_FOUNDATION_GATE,
    HomeStationProvisioner,
)

WORKSPACE_ID = workspace_id(ROOT)
WORK_ITEM_ID = "MCA-001"
JOURNEY_ID = "G-FE1-SC6-STALE-VERSION"
DEPLOYMENT_ENVIRONMENT = "chat-native-disposable-station"


class StaleVersionError(RuntimeError):
    """The stale-version Development Journey failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise StaleVersionError(message)


def require_mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise StaleVersionError(f"{label} must be an object")
    return value


def positive_int(value: object) -> int:
    if isinstance(value, bool):
        return 0
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return parsed if parsed > 0 else 0


def evaluate_stale_version(capture: Mapping[str, Any]) -> dict[str, bool]:
    facts = require_mapping(capture.get("facts"), "stale-version facts")
    typed_error = require_mapping(facts.get("typedError"), "typed error")
    details = require_mapping(typed_error.get("details"), "typed details")
    resolution = require_mapping(facts.get("resolution"), "resolution")
    winner = require_mapping(facts.get("winner"), "winner")
    stale = require_mapping(facts.get("staleMutation"), "stale mutation")
    receiver = require_mapping(facts.get("receiver"), "receiver")
    projection = require_mapping(facts.get("projection"), "projection")
    expected_revision = positive_int(winner.get("expectedRevision"))
    actual_revision = positive_int(winner.get("actualRevision"))
    assertions = {
        "typedStaleVersion": (
            typed_error.get("error_type") == "LIFECYCLE_STALE_VERSION"
            and typed_error.get("locale_key")
            == "agent.errors.lifecycleStaleVersion"
            and typed_error.get("retryable") is True
            and typed_error.get("terminal") is True
            and sorted(details)
            == ["actual_revision", "expected_revision", "resource_id"]
            and details.get("resource_id") == winner.get("resourceId")
            and positive_int(details.get("expected_revision"))
            == expected_revision
            and positive_int(details.get("actual_revision"))
            == actual_revision
            and actual_revision == expected_revision + 1
        ),
        "localizedReloadLatestVisible": (
            receiver.get("conflictVisible") is True
            and receiver.get("reloadVisible") is True
            and bool(str(receiver.get("expectedConflictText") or ""))
            and str(receiver.get("expectedConflictText"))
            in str(receiver.get("conflictText") or "")
            and receiver.get("reloadText")
            == receiver.get("expectedReloadText")
            and receiver.get("projectedErrorType")
            == "LIFECYCLE_STALE_VERSION"
            and positive_int(receiver.get("projectedExpectedRevision"))
            == expected_revision
            and positive_int(receiver.get("projectedActualRevision"))
            == actual_revision
            and resolution.get("type") == "reloadLatest"
            and resolution.get("resourceId") == winner.get("resourceId")
            and positive_int(resolution.get("expectedRevision"))
            == expected_revision
            and positive_int(resolution.get("actualRevision"))
            == actual_revision
        ),
        "reloadLatestExecuted": (
            receiver.get("reloadExecuted") is True
            and receiver.get("conflictCleared") is True
            and positive_int(receiver.get("reloadedRevision"))
            == actual_revision
        ),
        "winnerPreserved": (
            positive_int(winner.get("revisionBeforeStale"))
            == actual_revision
            == positive_int(winner.get("revisionAfterStale"))
            == positive_int(winner.get("revisionAfterReload"))
            and bool(str(winner.get("hashBeforeStale") or ""))
            and winner.get("hashBeforeStale")
            == winner.get("hashAfterStale")
            == winner.get("hashAfterReload")
        ),
        "zeroStaleMutation": (
            positive_int(stale.get("attemptedRevision"))
            == expected_revision
            and int(stale.get("mutationDelta") or 0) == 0
            and int(stale.get("messageDelta") or 0) == 0
        ),
        "projectionReloaded": (
            positive_int(projection.get("revisionBeforeStale"))
            == expected_revision
            and positive_int(projection.get("revisionAfterReload"))
            == actual_revision
            and int(projection.get("messageCountAfterReload") or 0) >= 0
        ),
    }
    failed = sorted(name for name, passed in assertions.items() if not passed)
    if failed:
        raise StaleVersionError(
            "stale-version facts failed assertions: " + ", ".join(failed)
        )
    return assertions


def cleanup_clients(
    runtime_pair: FoundationRuntimePair,
    artifact_dir: Path,
) -> dict[str, Any]:
    result = runtime_pair.stop(remove_storage=False)
    for runtime, client in (
        ("native", runtime_pair.native),
        ("secondary", runtime_pair.secondary),
    ):
        if client.log_path.is_file():
            target = artifact_dir / runtime / client.log_path.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(client.log_path, target)
    return result


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
    attestation_root = Path("/tmp") / f"mca-stale-version-{artifact_run_id}"
    os.environ["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(attestation_root)
    store = EvidenceStore(attestation_root, worktree=ROOT)
    attestation_run = store.begin_run(
        AGENT_V2_FOUNDATION_GATE,
        source=source_identity(ROOT),
    )
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_FOUNDATION_GATE
    os.environ["PT_ACCEPTANCE_RUN_ID"] = attestation_run.run_id
    os.environ["PT_ACCEPTANCE_APPROVED_PROFILE"] = PROFILE
    os.environ["CHAT_ACCEPTANCE_RESET"] = "1"
    os.environ["CHAT_ACCEPTANCE_RESET_PROFILE"] = PROFILE

    active_profile = ROOT / ".local/dev/active/peers-ai-agent.env"
    profile_env = load_env_file(active_profile.resolve(strict=True))
    provisioner = HomeStationProvisioner(
        EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "home-station.yaml")
    )
    runtime_pair: FoundationRuntimePair | None = None
    manifest = None
    capture: dict[str, Any] = {}
    assertions: dict[str, bool] = {}
    primary_error: BaseException | None = None
    cleanup: dict[str, Any] = {
        "status": "clean",
        "clients": None,
        "fixtureResetAfter": False,
        "provisionerResourcesReleased": [],
        "failures": [],
    }

    try:
        manifest = provisioner.provision(AGENT_V2_FOUNDATION_GATE)
        require(
            manifest.blocked_reason is None,
            "runtime provisioning blocked: "
            f"{manifest.blocked_reason} ({manifest.blocked_resource})",
        )
        runtime_pair = FoundationRuntimePair.from_manifest(
            _build_client_manifest(manifest.to_dict()),
            profile_env=profile_env,
            startup_timeout=900,
        )
        client: FoundationRuntimeClient = runtime_pair.native
        client.start()
        _authenticate_clients(runtime_pair, profile_env, clients=(client,))
        raw_capture = client.harness(
            "runDevelopmentStaleVersion",
            {"sampleId": artifact_run_id},
            timeout=180,
        )
        capture = dict(require_mapping(raw_capture, "stale-version capture"))
        (artifact_dir / "capture.json").write_text(
            json.dumps(capture, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        assertions = evaluate_stale_version(capture)
        harness_assertions = require_mapping(
            capture.get("assertions"),
            "Harness assertions",
        )
        require(
            all(value is True for value in harness_assertions.values()),
            "Harness stale-version assertions did not all pass",
        )
        harness_cleanup = require_mapping(
            capture.get("cleanup"),
            "Harness cleanup",
        )
        require(
            harness_cleanup.get("status") == "clean",
            "Harness stale-version cleanup failed",
        )
    except BaseException as error:
        primary_error = error
    finally:
        if runtime_pair is not None:
            try:
                cleanup["clients"] = cleanup_clients(
                    runtime_pair,
                    artifact_dir,
                )
                if cleanup["clients"].get("status") != "clean":
                    cleanup["status"] = "failed"
                    cleanup["failures"].append("client runtime cleanup failed")
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    f"client runtime cleanup: {type(error).__name__}: {error}"
                )
            try:
                activated = subprocess.run(
                    ["make", "-e", "profile", f"PROFILE={PROFILE}"],
                    cwd=ROOT,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                require(
                    activated.returncode == 0,
                    "failed to restore the authorized cleanup profile",
                )
                reset_fixture(
                    DEPLOYMENT_ENVIRONMENT,
                    ("alice", "bob"),
                    reset_authorized=True,
                )
                cleanup["fixtureResetAfter"] = True
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    f"fixture cleanup: {type(error).__name__}: {error}"
                )
        try:
            cleanup["provisionerResourcesReleased"] = list(
                provisioner.cleanup()
            )
        except BaseException as error:
            cleanup["status"] = "failed"
            cleanup["failures"].append(
                f"provisioner cleanup: {type(error).__name__}: {error}"
            )

    result_name = (
        "PASS"
        if primary_error is None
        and assertions
        and all(assertions.values())
        and cleanup["fixtureResetAfter"] is True
        and cleanup["status"] == "clean"
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
            "stationDeploymentEnvironment": DEPLOYMENT_ENVIRONMENT,
            "stationBuildCommit": station.live_commit if station else "",
            "clientRuntime": "native-tauri",
        },
        "assertions": assertions,
        "failure": (
            []
            if primary_error is None
            else [{
                "type": type(primary_error).__name__,
                "message": str(primary_error)[:4096],
            }]
        ),
        "cleanup": cleanup,
        "durationMs": int((time.monotonic() - started) * 1000),
    }
    result_path = artifact_dir / "result.json"
    result_path.write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
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
