#!/usr/bin/env python3
"""Run the focused G-FE1 provider-timeout Development Journey."""

from __future__ import annotations

import json
import os
import re
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
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationRuntimeClient,
    FoundationRuntimePair,
)
from tooling.acceptance.gates.agent.foundation_scenario_runner import (
    _authenticate_clients,
    _build_client_manifest,
)
from tooling.acceptance.fixtures.chat_native_actors import reset_fixture
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_FOUNDATION_GATE,
    HomeStationProvisioner,
)


WORKSPACE_ID = workspace_id(ROOT)
WORK_ITEM_ID = "MCA-001"
JOURNEY_ID = "G-FE1-SC4-PROVIDER-TIMEOUT"
DEPLOYMENT_ENVIRONMENT = "chat-native-disposable-station"
PROVIDER_DEADLINE_MS = 120_000


class ProviderTimeoutError(RuntimeError):
    """The provider-timeout Development Journey failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProviderTimeoutError(message)


def require_mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ProviderTimeoutError(f"{label} must be an object")
    return value


def require_list(value: object, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ProviderTimeoutError(f"{label} must be an array")
    return value


def rfc3339_millis(value: object, label: str) -> int:
    require(isinstance(value, str) and bool(value), f"{label} is missing")
    match = re.fullmatch(
        r"(?P<date>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"
        r"(?:\.(?P<fraction>\d{1,9}))?Z",
        value,
    )
    require(match is not None, f"{label} must be a UTC RFC3339 timestamp")
    fraction = match.group("fraction")
    normalized_fraction = (
        f".{fraction[:6].ljust(6, '0')}" if fraction is not None else ""
    )
    try:
        parsed = datetime.fromisoformat(
            f"{match.group('date')}{normalized_fraction}+00:00"
        )
    except ValueError as error:
        raise ProviderTimeoutError(
            f"{label} must be a valid UTC RFC3339 timestamp"
        ) from error
    return int(parsed.timestamp() * 1000)


def timeout_reason(value: object) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return value == 7
    return isinstance(value, str) and value.strip().lower() in {
        "7",
        "timeout",
        "failover_reason_timeout",
    }


def evaluate_provider_timeout(capture: Mapping[str, Any]) -> dict[str, bool]:
    facts = require_mapping(capture.get("facts"), "provider-timeout facts")
    typed_error = require_mapping(facts.get("typedError"), "typed error")
    details = require_mapping(typed_error.get("details"), "typed error details")
    resolution = require_mapping(facts.get("resolution"), "resolution")
    requested_budget = require_mapping(
        facts.get("requestedBudget"),
        "requested budget",
    )
    provider_calls = require_list(facts.get("providerCalls"), "provider calls")
    classified_errors = require_list(
        facts.get("classifiedErrors"),
        "classified errors",
    )
    provider_call = (
        require_mapping(provider_calls[0], "provider call")
        if len(provider_calls) == 1
        else {}
    )
    classified_error = (
        require_mapping(classified_errors[0], "classified error")
        if len(classified_errors) == 1
        else {}
    )
    deadline_ms = rfc3339_millis(details.get("deadline"), "deadline")
    submitted_at_ms = rfc3339_millis(
        facts.get("submittedAt"),
        "submittedAt",
    )
    terminal_observed_at_ms = rfc3339_millis(
        facts.get("terminalObservedAt"),
        "terminalObservedAt",
    )
    provider_id = str(facts.get("providerId") or "")
    model_id = str(facts.get("modelId") or "")
    latency_ms = int(
        provider_call.get("latencyMs")
        or provider_call.get("latency_ms")
        or 0
    )
    trace_count_before = int(facts.get("traceCountBefore") or 0)
    trace_count_after = int(facts.get("traceCountAfter") or 0)
    queue_count_before = int(facts.get("queueCountBefore") or 0)
    queue_count_after = int(facts.get("queueCountAfter") or 0)
    assertions = {
        "typedProviderTimeout": (
            typed_error.get("error_type") == "PROVIDER_TIMEOUT"
            and typed_error.get("locale_key") == "agent.errors.providerTimeout"
            and typed_error.get("retryable") is True
            and typed_error.get("terminal") is True
            and sorted(details) == ["deadline", "model_id", "provider_id"]
            and details.get("provider_id") == provider_id
            and details.get("model_id") == model_id
        ),
        "localizedRetryVisible": (
            facts.get("recoveryVisible") is True
            and bool(str(facts.get("recoveryLabel") or ""))
            and resolution.get("type") == "retry"
            and resolution.get("providerId") == provider_id
            and resolution.get("modelId") == model_id
            and resolution.get("deadline") == details.get("deadline")
        ),
        "deadlineProjected": (
            facts.get("projectedDeadline") == details.get("deadline")
        ),
        "oneTerminalProviderAttempt": (
            trace_count_after == trace_count_before + 1
            and len(provider_calls) == 1
            and provider_call.get("provider") == provider_id
            and provider_call.get("model") == model_id
        ),
        "upstreamTimeoutCancelled": (
            len(classified_errors) == 1
            and timeout_reason(classified_error.get("reason"))
            and latency_ms >= PROVIDER_DEADLINE_MS - 5_000
        ),
        "providerDeadlinePrecedesTurnBudget": (
            int(requested_budget.get("wallTimeMs") or 0)
            > PROVIDER_DEADLINE_MS
            and deadline_ms
            >= submitted_at_ms + PROVIDER_DEADLINE_MS - 5_000
            and deadline_ms <= terminal_observed_at_ms + 5_000
        ),
        "zeroSuccessfulCompletion": (
            int(facts.get("completedAssistantMessageCount") or 0) == 0
        ),
        "queueUnchanged": queue_count_after == queue_count_before,
    }
    failed = sorted(
        name for name, passed in assertions.items() if not passed
    )
    if failed:
        raise ProviderTimeoutError(
            "provider-timeout facts failed assertions: " + ", ".join(failed)
        )
    return assertions


def cleanup_clients(
    runtime_pair: FoundationRuntimePair,
    artifact_dir: Path,
) -> dict[str, Any]:
    result = runtime_pair.stop(remove_storage=False)
    for runtime, client in (
        ("native", runtime_pair.native),
        ("browser", runtime_pair.browser),
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
    attestation_root = Path("/tmp") / (
        f"mca-provider-timeout-{artifact_run_id}"
    )
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
            "runDevelopmentProviderTimeout",
            {"sampleId": artifact_run_id},
            timeout=210,
        )
        capture = dict(
            require_mapping(raw_capture, "provider-timeout capture")
        )
        (artifact_dir / "capture.json").write_text(
            json.dumps(capture, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        assertions = evaluate_provider_timeout(capture)
        harness_assertions = require_mapping(
            capture.get("assertions"),
            "Harness assertions",
        )
        require(
            all(value is True for value in harness_assertions.values()),
            "Harness provider-timeout assertions did not all pass",
        )
        harness_cleanup = require_mapping(
            capture.get("cleanup"),
            "Harness cleanup",
        )
        require(
            harness_cleanup.get("status") == "clean",
            "Harness provider-timeout cleanup failed",
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
                    ["make", "profile", f"PROFILE={PROFILE}"],
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
