#!/usr/bin/env python3
"""Foundation Gate Phase 1 scenario runner CLI.

Orchestrates FoundationRuntimePair and FoundationCandidateProducer to produce
the 419-tuple candidate manifest required by the Foundation Gate validator
(agent_v2_gate.py Phase 2).

Usage:
    PT_ACCEPTANCE_ARTIFACT_ROOT=/tmp/test \
    PT_ACCEPTANCE_RUNTIME_MANIFEST=/path/to/manifest.json \
    python3 tooling/acceptance/gates/agent/foundation_scenario_runner.py

Environment:
    PT_ACCEPTANCE_ARTIFACT_ROOT      Evidence store root (required).
    PT_ACCEPTANCE_RUNTIME_MANIFEST   Path to provisioned runtime manifest JSON.
    PT_AGENT_AS_F10_NEGATIVE_CONTROL Set to "1" to mark F10 as negative control.
    PT_FOUNDATION_STARTUP_TIMEOUT    Client startup timeout seconds (default 900).
    PT_FOUNDATION_DEBUG_TUPLE        Run one canonical group-one tuple first for
                                     diagnosis, using its JSON tuple key.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.request
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
    EvidenceStore,
    RunHandle,
    source_identity,
)
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.core.redaction import (
    is_sensitive_key,
    redact_text_with_values,
)
from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    GATE_ID,
    FoundationAdapters,
    FoundationCandidateProducer,
    load_foundation_tuples,
)
from tooling.acceptance.gates.agent.foundation_direct_adapter import (
    DirectRuntimeFoundationAdapter,
    DirectRuntimeProbeInput,
)
from tooling.acceptance.gates.agent.foundation_group_one_probe import (
    assert_group_one_capture,
    group_one_tuples,
)
from tooling.acceptance.gates.agent.foundation_station_restart import (
    restart_foundation_station,
)
from tooling.acceptance.gates.agent.foundation_d11_adapter import (
    D11FoundationAdapter,
)
from tooling.acceptance.gates.agent.foundation_mobile_contract_adapter import (
    MobileContractFoundationAdapter,
)
from tooling.acceptance.gates.agent.foundation_non_advertisement_adapter import (
    NonAdvertisementFoundationAdapter,
    NonAdvertisementProbeInput,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientSpec,
    FoundationRuntimeClient,
    FoundationRuntimePair,
)


class ScenarioRunnerError(RuntimeError):
    """Fatal error during Foundation scenario execution."""


# #region debug-point A-D:capability-session-enrollment
def _report_capability_session_enrollment_debug(
    hypothesis_id: str,
    message: str,
    data: Mapping[str, object],
) -> None:
    if os.environ.get("DEBUG_SESSION_ID") != "capability-session-enrollment":
        return
    url = os.environ.get(
        "DEBUG_SERVER_URL",
        "http://127.0.0.1:7789/event",
    )
    payload = json.dumps(
        {
            "sessionId": "capability-session-enrollment",
            "runId": os.environ.get("DEBUG_RUN_ID", "pre-fix"),
            "hypothesisId": hypothesis_id,
            "location": (
                "tooling/acceptance/gates/agent/"
                "foundation_scenario_runner.py:_authenticate_clients"
            ),
            "msg": f"[DEBUG] {message}",
            "data": dict(data),
            "ts": int(time.time() * 1000),
        }
    ).encode("utf-8")
    try:
        urllib.request.urlopen(
            urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            ),
            timeout=1,
        ).read()
    except Exception:
        pass


# #endregion


def _failure_summary(
    error: BaseException | None,
    profile_env: Mapping[str, str],
) -> list[dict[str, str]]:
    secret_values = tuple(
        value
        for key, value in profile_env.items()
        if value and is_sensitive_key(key)
    )
    summaries: list[dict[str, str]] = []
    current = error
    for _ in range(4):
        if current is None:
            break
        summaries.append(
            {
                "type": type(current).__name__,
                "message": redact_text_with_values(
                    str(current),
                    secret_values,
                )[:4096],
            }
        )
        current = current.__cause__
    return summaries


DIRECT_PROBE_TIMEOUT_SECONDS = {
    "AS-F04": 900,
    "AS-F07": 900,
    "BASE-APPROVAL_EXPIRED": 1200,
}
LEASE_EXPIRED_DISPATCH_WINDOW_MS = 90_000
LEASE_EXPIRED_MINIMUM_DISPATCH_LEAD_MS = 15_000
F12_PREPARE_TIMEOUT_SECONDS = 900

RESTORE_IDENTITY_STATES = frozenset(
    {
        "onboarding",
        "resuming",
        "ready",
    }
)
RESTORE_IDENTITY_PHASES = frozenset(
    {
        "booting",
        "checkingLaunchContext",
        "resolvingSession",
        "accessGateChainPending",
        "loggingOut",
        "accountGate",
        "pinGate",
        "pinRecoveryAuthenticating",
        "pinRecoveryPendingPin",
        "authenticatedPendingCompletion",
        "authenticated",
        "revoked",
    }
)
RESTORE_IDENTITY_REASONS = frozenset(
    {
        "cold_launch",
        "renderer_reload",
        "applet_launch",
        "cold_policy",
        "pin_required",
        "session_missing",
        "restore_failed",
        "revoked",
        "logout",
    }
)
RESTORE_ERROR_CODES = (
    "UNAUTHORIZED",
    "FORBIDDEN",
    "INVALID_ARGUMENT",
    "INTERNAL_ERROR",
)
RESTORE_ERROR_REASONS = (
    "session_missing",
    "pin_required",
    "actor_ptid_mismatch",
    "takeover_failed",
    "restore_failed",
    "session_revoked",
)


def _agent_provider_config(profile_env: Mapping[str, str]) -> dict[str, str]:
    config = {
        "providerId": profile_env.get("PT_AGENT_PROVIDER_ID", "").strip(),
        "apiKey": profile_env.get("PT_AGENT_PROVIDER_API_KEY", ""),
        "modelId": profile_env.get("PT_AGENT_DEFAULT_MODEL_ID", "").strip(),
        "baseUrl": profile_env.get("PT_AGENT_PROVIDER_BASE_URL", "").strip(),
    }
    missing_fields = [
        profile_name
        for profile_name, config_name in (
            ("PT_AGENT_PROVIDER_ID", "providerId"),
            ("PT_AGENT_PROVIDER_API_KEY", "apiKey"),
            ("PT_AGENT_DEFAULT_MODEL_ID", "modelId"),
            ("PT_AGENT_PROVIDER_BASE_URL", "baseUrl"),
        )
        if not config[config_name]
    ]
    if missing_fields:
        raise ScenarioRunnerError(
            "active profile is missing required Agent provider fields: "
            + ", ".join(missing_fields)
        )
    return config


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _load_runtime_manifest() -> dict[str, Any]:
    """Load the provisioned runtime manifest from the environment."""
    manifest_path_str = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
    if not manifest_path_str:
        raise ScenarioRunnerError(
            "PT_ACCEPTANCE_RUNTIME_MANIFEST is required: "
            "the Foundation scenario runner needs a provisioned environment"
        )
    manifest_path = Path(manifest_path_str).expanduser().resolve()
    if not manifest_path.is_file():
        raise ScenarioRunnerError(
            f"runtime manifest is missing: {manifest_path}"
        )
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ScenarioRunnerError(
            f"runtime manifest is unreadable: {error}"
        ) from error
    if not isinstance(manifest, dict):
        raise ScenarioRunnerError("runtime manifest must be a JSON object")
    return manifest


def _load_profile_env(manifest: dict[str, Any]) -> dict[str, str]:
    """Load the same active profile identity recorded by the provisioner."""
    profile = manifest.get("profile")
    expected_name = (
        str(profile.get("resolvedName") or "")
        if isinstance(profile, Mapping)
        else ""
    )
    active_profile = (
        REPO_ROOT
        / ".local"
        / "dev"
        / "active"
        / f"{REPO_ROOT.name}.env"
    )
    try:
        profile_path = active_profile.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise ScenarioRunnerError(
            f"active profile cannot be resolved: {active_profile}"
        ) from error

    values = load_env_file(profile_path)
    actual_name = values.get("PT_DEV_PROFILE", "")
    if not expected_name or actual_name != expected_name:
        raise ScenarioRunnerError(
            "active profile identity does not match the provisioned runtime"
        )
    return values


def _build_client_manifest(runtime_manifest: dict[str, Any]) -> dict[str, Any]:
    """Build the client manifest consumed by FoundationRuntimePair.from_manifest."""
    services = runtime_manifest.get("services")
    station = services.get("station") if isinstance(services, Mapping) else None
    if not isinstance(station, Mapping) or not station.get("endpoint"):
        raise ScenarioRunnerError(
            "runtime manifest must contain services.station.endpoint"
        )
    clients = runtime_manifest.get("clients")
    if not isinstance(clients, list):
        raise ScenarioRunnerError(
            "runtime manifest must contain a clients array"
        )
    return {
        "station": {"url": station["endpoint"]},
        "clients": clients,
    }


class FoundationExecutorUnavailableCoordinator:
    def __init__(self, runtime_pair: "FoundationRuntimePair") -> None:
        self._runtime_pair = runtime_pair

    @staticmethod
    def _scenario_key(probe_input: DirectRuntimeProbeInput) -> str:
        return "|".join(
            (
                probe_input.platform,
                probe_input.locale,
                probe_input.cell,
                probe_input.sample_id,
            )
        )

    def _receiver(self, platform: str) -> Any:
        if platform == "desktop_app":
            return self._runtime_pair.native
        if platform == "browser":
            return self._runtime_pair.browser
        raise ScenarioRunnerError(
            f"BASE-EXECUTOR_UNAVAILABLE has no receiver for {platform}"
        )

    def capture(
        self,
        probe_input: DirectRuntimeProbeInput,
    ) -> Mapping[str, Any]:
        receiver = self._receiver(probe_input.platform)
        executor = self._runtime_pair.native
        scenario_key = self._scenario_key(probe_input)
        locale = receiver.harness(
            "setFoundationLocale",
            {"locale": probe_input.locale},
            timeout=30,
        )
        if (
            not isinstance(locale, Mapping)
            or locale.get("locale") != probe_input.locale
        ):
            raise ScenarioRunnerError(
                "BASE-EXECUTOR_UNAVAILABLE locale did not converge"
            )
        target = executor.harness(
            "getFoundationClientExecutorTarget",
            timeout=60,
        )
        if not isinstance(target, Mapping):
            raise ScenarioRunnerError(
                "BASE-EXECUTOR_UNAVAILABLE target is invalid"
            )
        lifecycle_input = {
            "targetCapabilitySessionId": target.get("capabilitySessionId"),
            "targetDeviceId": target.get("targetDeviceId"),
            "targetCapabilityId": target.get("targetCapabilityId"),
        }
        executor_available = True
        primary_error: BaseException | None = None
        cleanup_errors: list[str] = []
        try:
            prepared = receiver.harness(
                "prepareFoundationExecutorUnavailable",
                {
                    "scenarioKey": scenario_key,
                    "platform": probe_input.platform,
                    "sampleId": probe_input.sample_id,
                    **lifecycle_input,
                },
                timeout=180,
            )
            if not isinstance(prepared, Mapping):
                raise ScenarioRunnerError(
                    "BASE-EXECUTOR_UNAVAILABLE preparation is invalid"
                )
            executor_stop = executor.harness(
                "setFoundationClientExecutorAvailable",
                {
                    "available": False,
                    **lifecycle_input,
                },
                timeout=60,
            )
            if not isinstance(executor_stop, Mapping):
                raise ScenarioRunnerError(
                    "BASE-EXECUTOR_UNAVAILABLE withdrawal is invalid"
                )
            executor_available = False
            rejected = receiver.harness(
                "rejectFoundationExecutorUnavailable",
                {
                    "scenarioKey": scenario_key,
                    "executorStop": dict(executor_stop),
                },
                timeout=180,
            )
            if not isinstance(rejected, Mapping):
                raise ScenarioRunnerError(
                    "BASE-EXECUTOR_UNAVAILABLE rejection is invalid"
                )
            executor_start = executor.harness(
                "setFoundationClientExecutorAvailable",
                {
                    "available": True,
                    **lifecycle_input,
                },
                timeout=60,
            )
            if not isinstance(executor_start, Mapping):
                raise ScenarioRunnerError(
                    "BASE-EXECUTOR_UNAVAILABLE restoration is invalid"
                )
            executor_available = True
            recovered = receiver.harness(
                "recoverFoundationExecutorUnavailable",
                {
                    "scenarioKey": scenario_key,
                    "rejectedScenario": dict(rejected),
                    "executorStart": dict(executor_start),
                },
                timeout=60,
            )
            if not isinstance(recovered, Mapping):
                raise ScenarioRunnerError(
                    "BASE-EXECUTOR_UNAVAILABLE recovery is invalid"
                )
            capture = receiver.harness(
                "foundationDirectProbe",
                {
                    "platform": probe_input.platform,
                    "locale": probe_input.locale,
                    "cell": probe_input.cell,
                    "sampleId": probe_input.sample_id,
                    "preparedScenario": dict(recovered),
                },
                timeout=300,
            )
            if not isinstance(capture, Mapping):
                raise ScenarioRunnerError(
                    "BASE-EXECUTOR_UNAVAILABLE direct capture is invalid"
                )
            assert_group_one_capture(probe_input, capture)
            return capture
        except BaseException as error:
            primary_error = error
            raise
        finally:
            if not executor_available:
                try:
                    executor.harness(
                        "setFoundationClientExecutorAvailable",
                        {
                            "available": True,
                            **lifecycle_input,
                        },
                        timeout=60,
                    )
                except BaseException as error:
                    cleanup_errors.append(f"executor restore: {error}")
            try:
                receiver.harness(
                    "abortFoundationExecutorUnavailable",
                    {"scenarioKey": scenario_key},
                    timeout=120,
                )
            except BaseException as error:
                cleanup_errors.append(f"scenario cleanup: {error}")
            if cleanup_errors:
                raise ScenarioRunnerError(
                    "BASE-EXECUTOR_UNAVAILABLE cleanup failed: "
                    f"primary={primary_error}; cleanup={cleanup_errors}"
                )


def _wait_for_lease_dispatch_window(source_expires_at_ms: int) -> None:
    now_ms = time.time_ns() // 1_000_000
    dispatch_delay_ms = (
        source_expires_at_ms
        - now_ms
        - LEASE_EXPIRED_DISPATCH_WINDOW_MS
    )
    if dispatch_delay_ms > 0:
        time.sleep(dispatch_delay_ms / 1000)
    dispatch_lead_ms = source_expires_at_ms - time.time_ns() // 1_000_000
    if dispatch_lead_ms < LEASE_EXPIRED_MINIMUM_DISPATCH_LEAD_MS:
        raise ScenarioRunnerError(
            "BASE-LEASE_EXPIRED dispatch window was missed"
        )


class FoundationLeaseExpiredCoordinator:
    def __init__(self, runtime_pair: "FoundationRuntimePair") -> None:
        self._runtime_pair = runtime_pair

    @staticmethod
    def _scenario_key(probe_input: DirectRuntimeProbeInput) -> str:
        return "|".join(
            (
                probe_input.platform,
                probe_input.locale,
                probe_input.cell,
                probe_input.sample_id,
            )
        )

    def _receiver(self, platform: str) -> Any:
        if platform == "desktop_app":
            return self._runtime_pair.native
        if platform == "browser":
            return self._runtime_pair.browser
        raise ScenarioRunnerError(
            f"BASE-LEASE_EXPIRED has no receiver for {platform}"
        )

    @staticmethod
    def _target_value(target: Mapping[str, Any], key: str) -> str:
        value = target.get(key)
        if not isinstance(value, str) or not value:
            raise ScenarioRunnerError(
                f"BASE-LEASE_EXPIRED target {key} is invalid"
            )
        return value

    def capture(
        self,
        probe_input: DirectRuntimeProbeInput,
    ) -> Mapping[str, Any]:
        receiver = self._receiver(probe_input.platform)
        executor = self._runtime_pair.native
        scenario_key = self._scenario_key(probe_input)
        locale = receiver.harness(
            "setFoundationLocale",
            {"locale": probe_input.locale},
            timeout=30,
        )
        if (
            not isinstance(locale, Mapping)
            or locale.get("locale") != probe_input.locale
        ):
            raise ScenarioRunnerError(
                "BASE-LEASE_EXPIRED locale did not converge"
            )
        target = executor.harness(
            "getFoundationClientExecutorTarget",
            timeout=60,
        )
        if not isinstance(target, Mapping):
            raise ScenarioRunnerError(
                "BASE-LEASE_EXPIRED target is invalid"
            )
        target_session_id = self._target_value(
            target,
            "capabilitySessionId",
        )
        lifecycle_input = {
            "targetCapabilitySessionId": target_session_id,
            "targetDeviceId": self._target_value(target, "targetDeviceId"),
            "targetCapabilityId": self._target_value(
                target,
                "targetCapabilityId",
            ),
        }
        capability_session_id_hash = hashlib.sha256(
            target_session_id.encode("utf-8")
        ).hexdigest()
        expiry_control_finished = False
        primary_error: BaseException | None = None
        cleanup_errors: list[str] = []
        try:
            pause = executor.harness(
                "runFoundationCapabilityNegativeControl",
                {
                    "control": "leasePause",
                    "capabilitySessionIdHash": capability_session_id_hash,
                },
                timeout=60,
            )
            if (
                not isinstance(pause, Mapping)
                or pause.get("control") != "leasePause"
                or pause.get("availability") != "available"
                or pause.get("capabilitySessionIdHash")
                != capability_session_id_hash
                or pause.get("workerPaused") is not True
                or type(pause.get("sourceExpiresAtMs")) is not int
            ):
                raise ScenarioRunnerError(
                    "BASE-LEASE_EXPIRED lease pause is invalid"
                )
            source_expires_at_ms = int(pause["sourceExpiresAtMs"])
            _wait_for_lease_dispatch_window(source_expires_at_ms)
            prepared = receiver.harness(
                "prepareFoundationLeaseExpired",
                {
                    "scenarioKey": scenario_key,
                    "platform": probe_input.platform,
                    "sampleId": probe_input.sample_id,
                    **lifecycle_input,
                },
                timeout=180,
            )
            if not isinstance(prepared, Mapping):
                raise ScenarioRunnerError(
                    "BASE-LEASE_EXPIRED preparation is invalid"
                )
            dispatched = receiver.harness(
                "dispatchFoundationLeaseExpired",
                {"scenarioKey": scenario_key},
                timeout=180,
            )
            if not isinstance(dispatched, Mapping):
                raise ScenarioRunnerError(
                    "BASE-LEASE_EXPIRED dispatch is invalid"
                )
            dispatch_baseline = dispatched.get("dispatchBaseline")
            if not isinstance(dispatch_baseline, Mapping):
                raise ScenarioRunnerError(
                    "BASE-LEASE_EXPIRED dispatch baseline is invalid"
                )
            lease_control = executor.harness(
                "runFoundationCapabilityNegativeControl",
                {
                    "control": "leaseExpired",
                    "capabilitySessionIdHash": capability_session_id_hash,
                },
                timeout=360,
            )
            expiry_control_finished = True
            if (
                not isinstance(lease_control, Mapping)
                or lease_control.get("control") != "leaseExpired"
                or lease_control.get("availability") != "available"
                or lease_control.get("capabilitySessionIdHash")
                != capability_session_id_hash
                or lease_control.get("workerPaused") is not False
            ):
                raise ScenarioRunnerError(
                    "BASE-LEASE_EXPIRED expiry control is invalid"
                )
            completed = receiver.harness(
                "completeFoundationLeaseExpired",
                {
                    "scenarioKey": scenario_key,
                    "leaseControl": dict(lease_control),
                    "dispatchBaseline": dict(dispatch_baseline),
                },
                timeout=180,
            )
            if not isinstance(completed, Mapping):
                raise ScenarioRunnerError(
                    "BASE-LEASE_EXPIRED completion is invalid"
                )
            capture = receiver.harness(
                "foundationDirectProbe",
                {
                    "platform": probe_input.platform,
                    "locale": probe_input.locale,
                    "cell": probe_input.cell,
                    "sampleId": probe_input.sample_id,
                    "scenarioKey": scenario_key,
                    "preparedScenario": dict(completed),
                },
                timeout=300,
            )
            if not isinstance(capture, Mapping):
                raise ScenarioRunnerError(
                    "BASE-LEASE_EXPIRED direct capture is invalid"
                )
            assert_group_one_capture(probe_input, capture)
            return capture
        except BaseException as error:
            primary_error = error
            raise
        finally:
            try:
                receiver.harness(
                    "abortFoundationLeaseExpired",
                    {"scenarioKey": scenario_key},
                    timeout=120,
                )
            except BaseException as error:
                cleanup_errors.append(f"scenario cleanup: {error}")
            if not expiry_control_finished:
                for available in (False, True):
                    try:
                        restored = executor.harness(
                            "setFoundationClientExecutorAvailable",
                            {
                                "available": available,
                                **lifecycle_input,
                            },
                            timeout=60,
                        )
                        if not isinstance(restored, Mapping):
                            raise ScenarioRunnerError(
                                "executor restore returned invalid evidence"
                            )
                    except BaseException as error:
                        action = "withdraw" if not available else "restore"
                        cleanup_errors.append(f"executor {action}: {error}")
            if cleanup_errors:
                raise ScenarioRunnerError(
                    "BASE-LEASE_EXPIRED cleanup failed: "
                    f"primary={primary_error}; cleanup={cleanup_errors}"
                )


class FoundationInvalidResourceReferenceCoordinator:
    def __init__(self, runtime_pair: "FoundationRuntimePair") -> None:
        self._runtime_pair = runtime_pair

    @staticmethod
    def _receiver(
        runtime_pair: "FoundationRuntimePair",
        platform: str,
    ) -> Any:
        if platform == "desktop_app":
            return runtime_pair.native
        if platform == "browser":
            return runtime_pair.browser
        raise ScenarioRunnerError(
            f"BASE-INVALID_RESOURCE_REF has no receiver for {platform}"
        )

    @staticmethod
    def _scenario_key(probe_input: DirectRuntimeProbeInput) -> str:
        return "|".join(
            (
                probe_input.platform,
                probe_input.locale,
                probe_input.cell,
                probe_input.sample_id,
            )
        )

    @staticmethod
    def _counter(value: Mapping[str, Any], key: str) -> int:
        candidate = value.get(key)
        if isinstance(candidate, bool) or not isinstance(candidate, int):
            raise ScenarioRunnerError(
                f"BASE-INVALID_RESOURCE_REF {key} is invalid"
            )
        if candidate < 0:
            raise ScenarioRunnerError(
                f"BASE-INVALID_RESOURCE_REF {key} is negative"
            )
        return candidate

    def capture(
        self,
        probe_input: DirectRuntimeProbeInput,
    ) -> Mapping[str, Any]:
        receiver = self._receiver(self._runtime_pair, probe_input.platform)
        executor = self._runtime_pair.native
        scenario_key = self._scenario_key(probe_input)
        scenario: Mapping[str, Any] | None = None
        result: Mapping[str, Any] | None = None
        primary_error: BaseException | None = None
        try:
            locale = receiver.harness(
                "setFoundationLocale",
                {"locale": probe_input.locale},
                timeout=30,
            )
            if (
                not isinstance(locale, Mapping)
                or locale.get("locale") != probe_input.locale
            ):
                raise ScenarioRunnerError(
                    "BASE-INVALID_RESOURCE_REF locale did not converge"
                )
            target = receiver.harness(
                "resolveFoundationInvalidResourceExecutorTarget",
                timeout=60,
            )
            if not isinstance(target, Mapping):
                raise ScenarioRunnerError(
                    "BASE-INVALID_RESOURCE_REF executor target is invalid"
                )
            target_input = {
                "targetCapabilitySessionId": target.get(
                    "capabilitySessionId"
                ),
                "targetDeviceId": target.get("targetDeviceId"),
                "targetCapabilityId": target.get("targetCapabilityId"),
            }
            before = executor.harness(
                "getFoundationClientExecutorCounters",
                target_input,
                timeout=60,
            )
            if not isinstance(before, Mapping):
                raise ScenarioRunnerError(
                    "BASE-INVALID_RESOURCE_REF executor counters are invalid"
                )
            candidate = receiver.harness(
                "runDevelopmentInvalidResourceReference",
                {
                    "sampleId": probe_input.sample_id,
                    "capabilitySessionId": target.get("capabilitySessionId"),
                    "deferConversationCleanup": True,
                    "externalExecutorEvidence": True,
                    "scenarioKey": scenario_key,
                },
                timeout=300,
            )
            if not isinstance(candidate, Mapping):
                raise ScenarioRunnerError(
                    "BASE-INVALID_RESOURCE_REF shared Journey result is invalid"
                )
            scenario = dict(candidate)
            after = executor.harness(
                "getFoundationClientExecutorCounters",
                target_input,
                timeout=60,
            )
            if not isinstance(after, Mapping):
                raise ScenarioRunnerError(
                    "BASE-INVALID_RESOURCE_REF executor readback is invalid"
                )
            for hash_key in (
                "capabilitySessionIdHash",
                "targetDeviceIdHash",
            ):
                if (
                    not isinstance(target.get(hash_key), str)
                    or len(str(target.get(hash_key))) != 64
                    or before.get(hash_key) != target.get(hash_key)
                    or after.get(hash_key) != target.get(hash_key)
                ):
                    raise ScenarioRunnerError(
                        "BASE-INVALID_RESOURCE_REF executor identity changed"
                    )
            if (
                target.get("targetCapabilityId") != "filesystem.read"
                or target.get("targetPlatform") != "desktop"
                or before.get("targetCapabilityId")
                != target.get("targetCapabilityId")
                or after.get("targetCapabilityId")
                != target.get("targetCapabilityId")
                or before.get("targetPlatform") != target.get("targetPlatform")
                or after.get("targetPlatform") != target.get("targetPlatform")
            ):
                raise ScenarioRunnerError(
                    "BASE-INVALID_RESOURCE_REF executor capability changed"
                )
            facts = scenario.get("facts")
            if not isinstance(facts, Mapping):
                raise ScenarioRunnerError(
                    "BASE-INVALID_RESOURCE_REF Journey facts are missing"
                )
            scenario["facts"] = {
                **dict(facts),
                "executor": {
                    "evidenceSource": "native-executor-coordinator",
                    "capabilitySessionIdHash": target.get(
                        "capabilitySessionIdHash"
                    ),
                    "targetDeviceIdHash": target.get("targetDeviceIdHash"),
                    "targetCapabilityId": target.get("targetCapabilityId"),
                    "targetPlatform": target.get("targetPlatform"),
                    "executionAttemptCountBefore": self._counter(
                        before,
                        "executionAttemptCount",
                    ),
                    "executionAttemptCountAfter": self._counter(
                        after,
                        "executionAttemptCount",
                    ),
                    "sideEffectCountBefore": self._counter(
                        before,
                        "sideEffectCount",
                    ),
                    "sideEffectCountAfter": self._counter(
                        after,
                        "sideEffectCount",
                    ),
                },
            }
            captured = receiver.harness(
                "foundationDirectProbe",
                {
                    "platform": probe_input.platform,
                    "locale": probe_input.locale,
                    "cell": probe_input.cell,
                    "sampleId": probe_input.sample_id,
                    "scenarioKey": scenario_key,
                    "preparedScenario": scenario,
                },
                timeout=300,
            )
            if not isinstance(captured, Mapping):
                raise ScenarioRunnerError(
                    "BASE-INVALID_RESOURCE_REF direct capture is invalid"
                )
            result = dict(captured)
            assert_group_one_capture(probe_input, result)
            return result
        except BaseException as error:
            primary_error = error
            raise
        finally:
            cleanup = result.get("cleanup") if result is not None else None
            cleanup_is_clean = (
                isinstance(cleanup, Mapping)
                and cleanup.get("status") == "clean"
            )
            if not cleanup_is_clean:
                try:
                    cleanup_request: dict[str, Any] = {
                        "scenarioKey": scenario_key,
                    }
                    if scenario is not None:
                        conversation_id = str(
                            scenario.get("conversationId") or ""
                        )
                        turn_id = str(scenario.get("turnId") or "")
                        if conversation_id:
                            cleanup_request["conversationId"] = conversation_id
                        if turn_id:
                            cleanup_request["turnId"] = turn_id
                    receiver.harness(
                        "abortFoundationInvalidResourceReference",
                        cleanup_request,
                        timeout=120,
                    )
                except BaseException as cleanup_error:
                    if primary_error is not None:
                        raise ScenarioRunnerError(
                            f"{primary_error}; "
                            f"CLEANUP_FAILED: {cleanup_error}"
                        ) from primary_error
                    raise


class FoundationPermissionDeniedCoordinator:
    def __init__(self, runtime_pair: "FoundationRuntimePair") -> None:
        self._runtime_pair = runtime_pair

    @staticmethod
    def _scenario_key(probe_input: DirectRuntimeProbeInput) -> str:
        return "|".join(
            (
                probe_input.platform,
                probe_input.locale,
                probe_input.cell,
                probe_input.sample_id,
            )
        )

    def _receiver(self, platform: str) -> Any:
        if platform == "desktop_app":
            return self._runtime_pair.native
        if platform == "browser":
            return self._runtime_pair.browser
        raise ScenarioRunnerError(
            f"BASE-PERMISSION_DENIED has no receiver for {platform}"
        )

    @staticmethod
    def _required_string(
        value: Mapping[str, Any],
        key: str,
    ) -> str:
        candidate = value.get(key)
        if not isinstance(candidate, str) or not candidate:
            raise ScenarioRunnerError(
                f"BASE-PERMISSION_DENIED {key} is invalid"
            )
        return candidate

    @staticmethod
    def _counter(value: Mapping[str, Any], key: str) -> int:
        candidate = value.get(key)
        if isinstance(candidate, bool) or not isinstance(candidate, int):
            raise ScenarioRunnerError(
                f"BASE-PERMISSION_DENIED {key} is invalid"
            )
        if candidate < 0:
            raise ScenarioRunnerError(
                f"BASE-PERMISSION_DENIED {key} is negative"
            )
        return candidate

    def capture(
        self,
        probe_input: DirectRuntimeProbeInput,
    ) -> Mapping[str, Any]:
        receiver = self._receiver(probe_input.platform)
        executor = self._runtime_pair.native
        scenario_key = self._scenario_key(probe_input)
        denied_session_hash = ""
        permission_restored = False
        scenario_cleaned = False
        scenario: dict[str, Any] | None = None
        result: Mapping[str, Any] | None = None
        primary_error: BaseException | None = None
        cleanup_errors: list[str] = []
        try:
            locale = receiver.harness(
                "setFoundationLocale",
                {"locale": probe_input.locale},
                timeout=30,
            )
            if (
                not isinstance(locale, Mapping)
                or locale.get("locale") != probe_input.locale
            ):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED locale did not converge"
                )
            source_target = executor.harness(
                "resolveFoundationInvalidResourceExecutorTarget",
                timeout=60,
            )
            if not isinstance(source_target, Mapping):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED source target is invalid"
                )
            capability_id = self._required_string(
                source_target,
                "targetCapabilityId",
            )
            if capability_id != "filesystem.read":
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED capability target changed"
                )
            permission_kind = "filesystem"
            source_session_id = self._required_string(
                source_target,
                "capabilitySessionId",
            )
            source_session_hash = hashlib.sha256(
                source_session_id.encode("utf-8")
            ).hexdigest()
            target_input = {
                "targetCapabilitySessionId": source_session_id,
                "targetDeviceId": self._required_string(
                    source_target,
                    "targetDeviceId",
                ),
                "targetCapabilityId": capability_id,
            }
            before = executor.harness(
                "getFoundationClientExecutorCounters",
                target_input,
                timeout=60,
            )
            if not isinstance(before, Mapping):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED baseline counters are invalid"
                )

            denied_control = executor.harness(
                "runFoundationCapabilityNegativeControl",
                {
                    "control": "permissionDenied",
                    "capabilitySessionIdHash": source_session_hash,
                    "capabilityId": capability_id,
                    "permissionKind": permission_kind,
                },
                timeout=60,
            )
            if not isinstance(denied_control, Mapping):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED denial control is invalid"
                )
            denied_transition = denied_control.get("leaseTransition")
            if (
                denied_control.get("control") != "permissionDenied"
                or denied_control.get("availability") != "available"
                or denied_control.get("capabilitySessionIdHash")
                != source_session_hash
                or not isinstance(denied_transition, Mapping)
            ):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED denial transition is invalid"
                )
            denied_session_hash = self._required_string(
                denied_transition,
                "currentCapabilitySessionIdHash",
            )
            denied_target = executor.harness(
                "resolveFoundationInvalidResourceExecutorTarget",
                timeout=60,
            )
            if not isinstance(denied_target, Mapping):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED denied target is invalid"
                )
            denied_session_id = self._required_string(
                denied_target,
                "capabilitySessionId",
            )
            if (
                hashlib.sha256(
                    denied_session_id.encode("utf-8")
                ).hexdigest()
                != denied_session_hash
                or denied_target.get("targetPermission")
                != "CAPABILITY_PERMISSION_STATE_DENIED"
                or denied_target.get("targetPermissionKind")
                != "CAPABILITY_PERMISSION_KIND_FILESYSTEM"
            ):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED denied lease readback is invalid"
                )

            candidate = receiver.harness(
                "runDevelopmentClientPermissionDenied",
                {
                    "sampleId": probe_input.sample_id,
                    "capabilitySessionId": denied_session_id,
                    "deferConversationCleanup": True,
                    "externalExecutorEvidence": True,
                    "scenarioKey": scenario_key,
                    "receiverPlatform": probe_input.platform,
                },
                timeout=300,
            )
            if not isinstance(candidate, Mapping):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED Journey result is invalid"
                )
            scenario = dict(candidate)
            after = executor.harness(
                "getFoundationClientExecutorCounters",
                {
                    "targetCapabilitySessionId": denied_session_id,
                    "targetDeviceId": self._required_string(
                        denied_target,
                        "targetDeviceId",
                    ),
                    "targetCapabilityId": capability_id,
                },
                timeout=60,
            )
            if not isinstance(after, Mapping):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED final counters are invalid"
                )

            restored_control = executor.harness(
                "runFoundationCapabilityNegativeControl",
                {
                    "control": "permissionGranted",
                    "capabilitySessionIdHash": denied_session_hash,
                    "capabilityId": capability_id,
                    "permissionKind": permission_kind,
                },
                timeout=60,
            )
            if not isinstance(restored_control, Mapping):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED restore control is invalid"
                )
            restored_transition = restored_control.get("leaseTransition")
            if (
                restored_control.get("control") != "permissionGranted"
                or restored_control.get("availability") != "available"
                or restored_control.get("capabilitySessionIdHash")
                != denied_session_hash
                or not isinstance(restored_transition, Mapping)
            ):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED restore transition is invalid"
                )
            restored_session_hash = self._required_string(
                restored_transition,
                "currentCapabilitySessionIdHash",
            )
            restored_target = executor.harness(
                "resolveFoundationInvalidResourceExecutorTarget",
                timeout=60,
            )
            if not isinstance(restored_target, Mapping):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED restored target is invalid"
                )
            restored_session_id = self._required_string(
                restored_target,
                "capabilitySessionId",
            )
            if (
                hashlib.sha256(
                    restored_session_id.encode("utf-8")
                ).hexdigest()
                != restored_session_hash
                or restored_target.get("targetPermission")
                != "CAPABILITY_PERMISSION_STATE_GRANTED"
                or restored_target.get("targetPermissionKind")
                != "CAPABILITY_PERMISSION_KIND_FILESYSTEM"
            ):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED restored lease readback is invalid"
                )
            permission_restored = True

            scenario_cleanup = receiver.harness(
                "abortFoundationClientPermissionDenied",
                {
                    "scenarioKey": scenario_key,
                    "conversationId": self._required_string(
                        scenario,
                        "conversationId",
                    ),
                    "turnId": self._required_string(
                        scenario,
                        "turnId",
                    ),
                },
                timeout=120,
            )
            if (
                not isinstance(scenario_cleanup, Mapping)
                or scenario_cleanup.get("conversationDeleted") is not True
                or scenario_cleanup.get("localProjectionCleared") is not True
            ):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED scenario cleanup is invalid"
                )
            scenario_cleaned = True

            facts = scenario.get("facts")
            if not isinstance(facts, Mapping):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED Journey facts are missing"
                )
            cleanup = facts.get("cleanup")
            if not isinstance(cleanup, Mapping):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED cleanup facts are missing"
                )
            scenario["facts"] = {
                **dict(facts),
                "executor": {
                    "evidenceSource": "native-executor-coordinator",
                    "capabilitySessionIdHash": denied_session_hash,
                    "targetDeviceIdHash": hashlib.sha256(
                        self._required_string(
                            denied_target,
                            "targetDeviceId",
                        ).encode("utf-8")
                    ).hexdigest(),
                    "targetCapabilityId": capability_id,
                    "targetPlatform": denied_target.get("targetPlatform"),
                    "before": {
                        "executionAttemptCount": self._counter(
                            before,
                            "executionAttemptCount",
                        ),
                        "sideEffectCount": self._counter(
                            before,
                            "sideEffectCount",
                        ),
                    },
                    "after": {
                        "executionAttemptCount": self._counter(
                            after,
                            "executionAttemptCount",
                        ),
                        "sideEffectCount": self._counter(
                            after,
                            "sideEffectCount",
                        ),
                    },
                },
                "lease": {
                    "denied": {
                        **dict(denied_transition),
                        "capabilitySessionIdHash": denied_session_hash,
                        "permission": denied_target.get(
                            "targetPermission"
                        ),
                        "permissionKind": denied_target.get(
                            "targetPermissionKind"
                        ),
                    },
                    "restored": {
                        **dict(restored_transition),
                        "capabilitySessionIdHash": restored_session_hash,
                        "permission": restored_target.get(
                            "targetPermission"
                        ),
                        "permissionKind": restored_target.get(
                            "targetPermissionKind"
                        ),
                    },
                },
                "cleanup": {
                    **dict(cleanup),
                    **dict(scenario_cleanup),
                    "permissionRestored": True,
                },
            }
            captured = receiver.harness(
                "foundationDirectProbe",
                {
                    "platform": probe_input.platform,
                    "locale": probe_input.locale,
                    "cell": probe_input.cell,
                    "sampleId": probe_input.sample_id,
                    "scenarioKey": scenario_key,
                    "preparedScenario": scenario,
                },
                timeout=300,
            )
            if not isinstance(captured, Mapping):
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED direct capture is invalid"
                )
            result = captured
            assert_group_one_capture(probe_input, captured)
            return captured
        except BaseException as error:
            primary_error = error
            raise
        finally:
            if denied_session_hash and not permission_restored:
                try:
                    executor.harness(
                        "runFoundationCapabilityNegativeControl",
                        {
                            "control": "permissionGranted",
                            "capabilitySessionIdHash": denied_session_hash,
                            "capabilityId": "filesystem.read",
                            "permissionKind": "filesystem",
                        },
                        timeout=60,
                    )
                except BaseException as error:
                    cleanup_errors.append(
                        f"permission restore: {error}"
                    )
            if not scenario_cleaned:
                try:
                    cleanup_request: dict[str, Any] = {
                        "scenarioKey": scenario_key,
                    }
                    if scenario is not None:
                        conversation_id = str(
                            scenario.get("conversationId") or ""
                        )
                        turn_id = str(scenario.get("turnId") or "")
                        if conversation_id:
                            cleanup_request["conversationId"] = conversation_id
                        if turn_id:
                            cleanup_request["turnId"] = turn_id
                    receiver.harness(
                        "abortFoundationClientPermissionDenied",
                        cleanup_request,
                        timeout=120,
                    )
                except BaseException as error:
                    cleanup_errors.append(f"scenario cleanup: {error}")
            if cleanup_errors:
                raise ScenarioRunnerError(
                    "BASE-PERMISSION_DENIED cleanup failed: "
                    f"primary={primary_error}; cleanup={cleanup_errors}"
                )


class FoundationForbiddenActorCoordinator:
    def __init__(
        self,
        runtime_pair: "FoundationRuntimePair",
        profile_env: Mapping[str, str],
    ) -> None:
        self._runtime_pair = runtime_pair
        self._password = profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", "1")

    @staticmethod
    def _scenario_key(probe_input: DirectRuntimeProbeInput) -> str:
        return "|".join(
            (
                probe_input.platform,
                probe_input.locale,
                probe_input.cell,
                probe_input.sample_id,
            )
        )

    def _receiver(self, platform: str) -> Any:
        if platform == "desktop_app":
            return self._runtime_pair.native
        if platform == "browser":
            return self._runtime_pair.browser
        raise ScenarioRunnerError(
            f"BASE-FORBIDDEN_ACTOR has no receiver for {platform}"
        )

    def _owner(self, platform: str) -> Any:
        if platform == "desktop_app":
            return self._runtime_pair.browser
        if platform == "browser":
            return self._runtime_pair.native
        raise ScenarioRunnerError(
            f"BASE-FORBIDDEN_ACTOR has no owner client for {platform}"
        )

    def _login(self, client: Any, account: str) -> None:
        login = client.harness(
            "loginWithPassword",
            {"account": account, "password": self._password},
            timeout=120,
        )
        if (
            not isinstance(login, Mapping)
            or login.get("authenticated") is not True
            or not str(login.get("actorId") or "")
        ):
            raise ScenarioRunnerError(
                f"BASE-FORBIDDEN_ACTOR {account} login is invalid"
            )
        navigation = client.harness("navigateToAgent", {}, timeout=60)
        if (
            not isinstance(navigation, Mapping)
            or navigation.get("navigated") is not True
        ):
            raise ScenarioRunnerError(
                f"BASE-FORBIDDEN_ACTOR {account} navigation is invalid"
            )

    def capture(
        self,
        probe_input: DirectRuntimeProbeInput,
    ) -> Mapping[str, Any]:
        receiver = self._receiver(probe_input.platform)
        owner = self._owner(probe_input.platform)
        scenario_key = self._scenario_key(probe_input)
        locale = receiver.harness(
            "setFoundationLocale",
            {"locale": probe_input.locale},
            timeout=30,
        )
        if (
            not isinstance(locale, Mapping)
            or locale.get("locale") != probe_input.locale
        ):
            raise ScenarioRunnerError(
                "BASE-FORBIDDEN_ACTOR locale did not converge"
            )

        owner_fixture: Mapping[str, Any] | None = None
        owner_is_bob = False
        receiver_is_alice = True
        owner_cleaned = False
        primary_error: BaseException | None = None
        cleanup_errors: list[str] = []
        try:
            self._login(owner, "bob@p.t")
            owner_is_bob = True
            owner_fixture = owner.harness(
                "prepareFoundationForbiddenActorOwner",
                {
                    "scenarioKey": scenario_key,
                    "sampleId": probe_input.sample_id,
                },
                timeout=120,
            )
            if (
                not isinstance(owner_fixture, Mapping)
                or owner_fixture.get("scenarioKey") != scenario_key
                or not str(owner_fixture.get("conversationId") or "")
                or not str(owner_fixture.get("agentId") or "")
            ):
                raise ScenarioRunnerError(
                    "BASE-FORBIDDEN_ACTOR owner fixture is invalid"
                )

            receiver_is_alice = False
            rejected = receiver.harness(
                "rejectFoundationForbiddenActor",
                {
                    "scenarioKey": scenario_key,
                    "platform": probe_input.platform,
                    "sampleId": probe_input.sample_id,
                    "ownerFixture": dict(owner_fixture),
                },
                timeout=180,
            )
            if (
                not isinstance(rejected, Mapping)
                or rejected.get("scenarioKey") != scenario_key
            ):
                raise ScenarioRunnerError(
                    "BASE-FORBIDDEN_ACTOR receiver rejection is invalid"
                )

            owner_readback = owner.harness(
                "readFoundationForbiddenActorOwner",
                {"scenarioKey": scenario_key},
                timeout=60,
            )
            if not isinstance(owner_readback, Mapping):
                raise ScenarioRunnerError(
                    "BASE-FORBIDDEN_ACTOR owner readback is invalid"
                )

            owner_cleanup = owner.harness(
                "cleanupFoundationForbiddenActorOwner",
                {"scenarioKey": scenario_key},
                timeout=120,
            )
            if (
                not isinstance(owner_cleanup, Mapping)
                or owner_cleanup.get("resourceDeleted") is not True
            ):
                raise ScenarioRunnerError(
                    "BASE-FORBIDDEN_ACTOR owner cleanup is invalid"
                )
            owner_cleaned = True

            self._login(owner, "alice@p.t")
            owner_is_bob = False
            self._login(receiver, "alice@p.t")
            receiver_is_alice = True

            recovered = receiver.harness(
                "completeFoundationForbiddenActorRecovery",
                {
                    "scenarioKey": scenario_key,
                    "rejectedScenario": dict(rejected),
                    "ownerReadback": dict(owner_readback),
                    "ownerCleanup": dict(owner_cleanup),
                },
                timeout=60,
            )
            if not isinstance(recovered, Mapping):
                raise ScenarioRunnerError(
                    "BASE-FORBIDDEN_ACTOR recovery is invalid"
                )
            capture = receiver.harness(
                "foundationDirectProbe",
                {
                    "platform": probe_input.platform,
                    "locale": probe_input.locale,
                    "cell": probe_input.cell,
                    "sampleId": probe_input.sample_id,
                    "preparedScenario": dict(recovered),
                },
                timeout=300,
            )
            if not isinstance(capture, Mapping):
                raise ScenarioRunnerError(
                    "BASE-FORBIDDEN_ACTOR direct capture is invalid"
                )
            assert_group_one_capture(probe_input, capture)
            return capture
        except BaseException as error:
            primary_error = error
            raise
        finally:
            if owner_fixture is not None and not owner_cleaned:
                try:
                    if not owner_is_bob:
                        self._login(owner, "bob@p.t")
                        owner_is_bob = True
                    owner.harness(
                        "cleanupFoundationForbiddenActorOwner",
                        {"scenarioKey": scenario_key},
                        timeout=120,
                    )
                    owner_cleaned = True
                except BaseException as error:
                    cleanup_errors.append(f"owner resource cleanup: {error}")
            if owner_is_bob:
                try:
                    self._login(owner, "alice@p.t")
                    owner_is_bob = False
                except BaseException as error:
                    cleanup_errors.append(f"owner identity restore: {error}")
            if not receiver_is_alice:
                try:
                    self._login(receiver, "alice@p.t")
                    receiver_is_alice = True
                except BaseException as error:
                    cleanup_errors.append(f"receiver identity restore: {error}")
            try:
                receiver.harness(
                    "abortFoundationForbiddenActor",
                    {"scenarioKey": scenario_key},
                    timeout=60,
                )
            except BaseException as error:
                cleanup_errors.append(f"receiver projection cleanup: {error}")
            if cleanup_errors:
                raise ScenarioRunnerError(
                    "BASE-FORBIDDEN_ACTOR cleanup failed: "
                    f"primary={primary_error}; cleanup={cleanup_errors}"
                )


def _make_direct_probe(
    client: Any,
    *,
    f06_coordinator: "FoundationF06Coordinator | None" = None,
    f12_coordinator: "FoundationF12Coordinator | None" = None,
    interrupted_coordinator:
        "FoundationInterruptedCoordinator | None" = None,
    executor_unavailable_coordinator:
        "FoundationExecutorUnavailableCoordinator | None" = None,
    lease_expired_coordinator:
        "FoundationLeaseExpiredCoordinator | None" = None,
    invalid_resource_reference_coordinator:
        "FoundationInvalidResourceReferenceCoordinator | None" = None,
    forbidden_actor_coordinator:
        "FoundationForbiddenActorCoordinator | None" = None,
) -> "Callable[[DirectRuntimeProbeInput], Mapping[str, Any]]":
    """Create a direct-runtime probe that executes via WebDriver harness.

    The probe calls the acceptance harness method on the given client to run
    the Foundation scenario for a specific cell/locale/sample and return the
    full capture dictionary expected by DirectRuntimeFoundationAdapter.
    """
    def probe(probe_input: DirectRuntimeProbeInput) -> Mapping[str, Any]:
        if probe_input.cell == "BASE-FORBIDDEN_ACTOR":
            if forbidden_actor_coordinator is None:
                raise ScenarioRunnerError(
                    "BASE-FORBIDDEN_ACTOR requires two-actor orchestration"
                )
            return forbidden_actor_coordinator.capture(probe_input)
        if probe_input.cell == "BASE-EXECUTOR_UNAVAILABLE":
            if executor_unavailable_coordinator is None:
                raise ScenarioRunnerError(
                    "BASE-EXECUTOR_UNAVAILABLE requires executor orchestration"
                )
            return executor_unavailable_coordinator.capture(probe_input)
        if probe_input.cell == "BASE-LEASE_EXPIRED":
            if lease_expired_coordinator is None:
                raise ScenarioRunnerError(
                    "BASE-LEASE_EXPIRED requires lease orchestration"
                )
            return lease_expired_coordinator.capture(probe_input)
        if probe_input.cell == "BASE-INVALID_RESOURCE_REF":
            if invalid_resource_reference_coordinator is None:
                raise ScenarioRunnerError(
                    "BASE-INVALID_RESOURCE_REF requires executor orchestration"
                )
            return invalid_resource_reference_coordinator.capture(probe_input)
        if probe_input.cell == "BASE-INTERRUPTED":
            if interrupted_coordinator is None:
                raise ScenarioRunnerError(
                    "BASE-INTERRUPTED requires Station restart orchestration"
                )
            return interrupted_coordinator.capture(probe_input)
        if probe_input.cell == "AS-F06":
            if f06_coordinator is None:
                raise ScenarioRunnerError(
                    "AS-F06 direct probe requires restart orchestration"
                )
            return f06_coordinator.capture(probe_input)
        if probe_input.cell == "AS-F12":
            if f12_coordinator is None:
                raise ScenarioRunnerError(
                    "AS-F12 direct probe requires restart orchestration"
                )
            return f12_coordinator.capture(probe_input)
        locale = client.harness(
            "setFoundationLocale",
            {"locale": probe_input.locale},
            timeout=30,
        )
        if (
            not isinstance(locale, Mapping)
            or locale.get("locale") != probe_input.locale
        ):
            raise ScenarioRunnerError(
                f"direct probe locale did not converge for "
                f"{probe_input.cell}/{probe_input.sample_id}"
            )
        method = {
            "BASE-LOOP_BUDGET_EXHAUSTED": "runDevelopmentLoopBudget",
            "BASE-MODEL_UNAVAILABLE": "runDevelopmentProviderModelUnavailable",
            "BASE-PROVIDER_TIMEOUT": "runDevelopmentProviderTimeout",
        }.get(probe_input.cell, "foundationDirectProbe")
        result = client.harness(
            "foundationDirectProbe",
            {
                "platform": probe_input.platform,
                "locale": probe_input.locale,
                "cell": probe_input.cell,
                "sampleId": probe_input.sample_id,
            },
            timeout=DIRECT_PROBE_TIMEOUT_SECONDS.get(probe_input.cell, 300),
        )
        if not isinstance(result, Mapping):
            raise ScenarioRunnerError(
                f"direct probe returned invalid result for "
                f"{probe_input.cell}/{probe_input.sample_id}"
            )
        assert_group_one_capture(probe_input, result)
        return result

    return probe


class FoundationF06Coordinator:
    """Prepare every AS-F06 tuple around one source-bound Station restart."""

    def __init__(
        self,
        runtime_pair: FoundationRuntimePair,
        runtime_manifest: Mapping[str, Any],
        profile_env: Mapping[str, str],
    ) -> None:
        self._runtime_pair = runtime_pair
        self._runtime_manifest = runtime_manifest
        self._profile_env = dict(profile_env)
        self._captures: dict[tuple[str, str, str, str], Mapping[str, Any]] = {}
        self._executed = False

    @staticmethod
    def _capture_key(
        probe_input: DirectRuntimeProbeInput,
    ) -> tuple[str, str, str, str]:
        return (
            probe_input.platform,
            probe_input.locale,
            probe_input.cell,
            probe_input.sample_id,
        )

    @staticmethod
    def _scenario_key(probe_input: DirectRuntimeProbeInput) -> str:
        return "|".join(
            (
                probe_input.platform,
                probe_input.locale,
                probe_input.cell,
                probe_input.sample_id,
            )
        )

    def _client(self, platform: str) -> Any:
        if platform == "desktop_app":
            return self._runtime_pair.native
        if platform == "browser":
            return self._runtime_pair.browser
        raise ScenarioRunnerError(
            f"AS-F06 has no direct client for platform {platform}"
        )

    def _set_locale(
        self,
        client: Any,
        probe_input: DirectRuntimeProbeInput,
    ) -> None:
        result = client.harness(
            "setFoundationLocale",
            {"locale": probe_input.locale},
            timeout=30,
        )
        if (
            not isinstance(result, Mapping)
            or result.get("locale") != probe_input.locale
        ):
            raise ScenarioRunnerError(
                f"AS-F06 locale did not converge for "
                f"{self._scenario_key(probe_input)}"
            )

    def _restore_capability_isolation(
        self,
        client: Any,
        probe_input: DirectRuntimeProbeInput,
        operation_deadline: float,
    ) -> None:
        remaining = operation_deadline - time.monotonic()
        if remaining <= 0:
            raise ScenarioRunnerError(
                "AS-F06 Station restart deadline expired "
                "during capability-isolation restoration"
            )
        scenario_key = self._scenario_key(probe_input)
        result = client.harness(
            "foundationF06RestoreCapabilityIsolation",
            {"scenarioKey": scenario_key},
            timeout=remaining,
        )
        if (
            not isinstance(result, Mapping)
            or result.get("scenarioKey") != scenario_key
        ):
            raise ScenarioRunnerError(
                f"AS-F06 capability-isolation restoration returned invalid "
                f"scope for {scenario_key}"
            )
        validation_error = _capability_isolation_restoration_error(
            probe_input.platform,
            result.get("toolIsolation"),
            allow_empty=True,
        )
        if validation_error:
            raise ScenarioRunnerError(
                f"AS-F06 capability-isolation restoration failed for "
                f"{scenario_key}: {validation_error}"
            )

    def _cleanup_prepared(
        self,
        prepared: list[
            tuple[DirectRuntimeProbeInput, Mapping[str, Any] | None]
        ],
    ) -> list[str]:
        errors: list[str] = []
        for probe_input, handoff in reversed(prepared):
            scenario_key = self._scenario_key(probe_input)
            conversation_id = (
                str(handoff.get("conversationId") or "")
                if handoff is not None
                else ""
            )
            turn_id = (
                str(handoff.get("turnId") or "")
                if handoff is not None
                else ""
            )
            try:
                result = self._client(probe_input.platform).harness(
                    "foundationF06Cleanup",
                    {
                        "scenarioKey": scenario_key,
                        "conversationId": conversation_id,
                        "turnId": turn_id,
                    },
                    timeout=60,
                )
                if (
                    not isinstance(result, Mapping)
                    or result.get("cleanupComplete") is not True
                ):
                    raise ScenarioRunnerError(
                        f"cleanup proof is invalid: {result!r}"
                    )
            except BaseException as error:
                errors.append(f"{scenario_key}: {error}")
        return errors

    def _restore_clients_for_cleanup(self) -> list[str]:
        errors: list[str] = []
        for platform, client in (
            ("desktop_app", self._runtime_pair.native),
            ("browser", self._runtime_pair.browser),
        ):
            try:
                client.restart()
            except BaseException as error:
                errors.append(f"{platform} cleanup restart: {error}")
        try:
            _authenticate_clients(
                self._runtime_pair,
                self._profile_env,
                require_existing_session=True,
                recovery_boundary="cleanup-restart",
            )
        except BaseException as error:
            errors.append(f"cleanup authentication: {error}")
        return errors

    def _execute(self) -> None:
        f06_inputs = tuple(
            DirectRuntimeProbeInput(
                platform=runtime_tuple.platform,
                locale=runtime_tuple.locale,
                cell=runtime_tuple.cell,
                sample_id=runtime_tuple.sample_id,
            )
            for runtime_tuple in group_one_tuples()
            if runtime_tuple.cell == "AS-F06"
        )
        if len(f06_inputs) != 4:
            raise ScenarioRunnerError(
                f"AS-F06 matrix changed: expected 4 tuples, got {len(f06_inputs)}"
            )

        prepared: list[
            tuple[DirectRuntimeProbeInput, Mapping[str, Any] | None]
        ] = []
        primary_error: BaseException | None = None
        try:
            for probe_input in f06_inputs:
                client = self._client(probe_input.platform)
                self._set_locale(client, probe_input)
                prepared_index = len(prepared)
                prepared.append((probe_input, None))
                try:
                    handoff = client.prepare_foundation_f06(
                        {
                            "scenarioKey": self._scenario_key(probe_input),
                            "platform": probe_input.platform,
                            "locale": probe_input.locale,
                            "sampleId": probe_input.sample_id,
                        },
                        timeout=300,
                    )
                    prepared[prepared_index] = (
                        probe_input,
                        handoff if isinstance(handoff, Mapping) else None,
                    )
                    if (
                        not isinstance(handoff, Mapping)
                        or not str(handoff.get("conversationId") or "")
                        or not str(handoff.get("turnId") or "")
                    ):
                        raise ScenarioRunnerError(
                            f"AS-F06 prepare returned invalid evidence for "
                            f"{self._scenario_key(probe_input)}"
                        )
                    finalized_handoff = client.harness(
                        "foundationF06FinalizePreparation",
                        {"scenarioKey": self._scenario_key(probe_input)},
                        timeout=60,
                    )
                    if (
                        not isinstance(finalized_handoff, Mapping)
                        or finalized_handoff.get("conversationId")
                        != handoff.get("conversationId")
                        or finalized_handoff.get("turnId")
                        != handoff.get("turnId")
                    ):
                        raise ScenarioRunnerError(
                            f"AS-F06 finalized handoff is invalid for "
                            f"{self._scenario_key(probe_input)}"
                        )
                except BaseException:
                    client.restore_station_transport()
                    raise
                self._execute_active(probe_input)
        except BaseException as error:
            primary_error = error

        cleanup_errors = self._cleanup_prepared(prepared)
        if primary_error is not None:
            cleanup_errors.extend(self._restore_clients_for_cleanup())
        if cleanup_errors:
            detail = "; ".join(cleanup_errors)
            if primary_error is not None:
                raise ScenarioRunnerError(
                    f"{primary_error}; CLEANUP_FAILED: {detail}"
                ) from primary_error
            raise ScenarioRunnerError(f"CLEANUP_FAILED: {detail}")
        if primary_error is not None:
            raise primary_error
        self._executed = True

    def _execute_active(
        self,
        probe_input: DirectRuntimeProbeInput,
    ) -> None:
        durable_reload_evidence: Mapping[str, Any] | None = None
        restart_handoff: Mapping[str, Any] | None = None
        transport_restored = False

        def observe_recovery_failures(outage_deadline: float) -> None:
            remaining = outage_deadline - time.monotonic()
            if remaining <= 0:
                raise ScenarioRunnerError(
                    "AS-F06 Station outage deadline expired "
                    "during recovery-failure callback"
                )
            client = self._client(probe_input.platform)
            result = client.harness(
                "foundationF06ObserveFailure",
                {"scenarioKey": self._scenario_key(probe_input)},
                timeout=remaining,
            )
            retry = result.get("retry") if isinstance(result, Mapping) else None
            if (
                not isinstance(result, Mapping)
                or result.get("activeFailureObserved") is not True
                or result.get("blocker")
                or not isinstance(retry, Mapping)
                or retry.get("observed") is not True
            ):
                raise ScenarioRunnerError(
                    f"AS-F06 recovery failure proof is invalid for "
                    f"{self._scenario_key(probe_input)}: {result!r}"
                )

        def exercise_durable_reloads(operation_deadline: float) -> None:
            nonlocal durable_reload_evidence, restart_handoff, transport_restored
            client = self._client(probe_input.platform)
            client.restore_station_transport()
            transport_restored = True
            _authenticate_clients(
                self._runtime_pair,
                self._profile_env,
                clients=(client,),
                require_existing_session=True,
                session_deadline=operation_deadline,
                recovery_boundary="station-restart",
            )
            self._restore_capability_isolation(
                client,
                probe_input,
                operation_deadline,
            )
            remaining = operation_deadline - time.monotonic()
            if remaining <= 0:
                raise ScenarioRunnerError(
                    "AS-F06 Station restart deadline expired "
                    "during durable-reload verification"
                )
            client = self._client(probe_input.platform)
            result = client.harness(
                "foundationF06DurableReload",
                {"scenarioKey": self._scenario_key(probe_input)},
                timeout=remaining,
            )
            durable_reload = (
                result.get("durableReload")
                if isinstance(result, Mapping)
                else None
            )
            source_delivery = (
                durable_reload.get("sourceDelivery")
                if isinstance(durable_reload, Mapping)
                else None
            )
            if (
                not isinstance(durable_reload, Mapping)
                or durable_reload.get("observed") is not True
                or durable_reload.get("source")
                != "station-snapshot-reconcile"
                or not isinstance(source_delivery, Mapping)
                or source_delivery.get("transport") != "station-sse"
                or source_delivery.get("eventType") != "snapshot"
                or not isinstance(source_delivery.get("sequence"), int)
                or isinstance(source_delivery.get("sequence"), bool)
                or source_delivery.get("sequence", 0) <= 0
                or not isinstance(source_delivery.get("rawPayloadHash"), str)
                or len(source_delivery.get("rawPayloadHash", "")) != 64
            ):
                raise ScenarioRunnerError(
                    f"AS-F06 durable reload source delivery is invalid for "
                    f"{self._scenario_key(probe_input)}: {result!r}"
                )
            if probe_input.platform == "desktop_app":
                remaining = operation_deadline - time.monotonic()
                if remaining <= 0:
                    raise ScenarioRunnerError(
                        "AS-F06 Station restart deadline expired "
                        "while exporting the native restart handoff"
                    )
                exported = client.harness(
                    "foundationF06ExportRestartHandoff",
                    {"scenarioKey": self._scenario_key(probe_input)},
                    timeout=remaining,
                )
                if (
                    not isinstance(exported, Mapping)
                    or exported.get("scenarioKey")
                    != self._scenario_key(probe_input)
                    or exported.get("platform") != probe_input.platform
                    or exported.get("locale") != probe_input.locale
                    or exported.get("sampleId") != probe_input.sample_id
                ):
                    raise ScenarioRunnerError(
                        "AS-F06 native restart handoff export is invalid for "
                        f"{self._scenario_key(probe_input)}"
                    )
                restart_handoff = dict(exported)
            durable_reload_evidence = dict(result)

        client = self._client(probe_input.platform)
        try:
            station_restart = restart_foundation_station(
                self._runtime_manifest,
                repo_root=REPO_ROOT,
                during_outage=observe_recovery_failures,
                after_restart=exercise_durable_reloads,
            )
        finally:
            if not transport_restored:
                client.restore_station_transport()
        client.restart()
        client_reloads = {probe_input.platform: True}
        _authenticate_clients(
            self._runtime_pair,
            self._profile_env,
            clients=(client,),
            require_existing_session=True,
            recovery_boundary="client-restart",
        )
        if probe_input.platform == "desktop_app":
            if restart_handoff is None:
                raise ScenarioRunnerError(
                    "AS-F06 native restart handoff is missing for "
                    f"{self._scenario_key(probe_input)}"
                )
            imported = client.harness(
                "foundationF06ImportRestartHandoff",
                {
                    "scenarioKey": self._scenario_key(probe_input),
                    "platform": probe_input.platform,
                    "handoff": restart_handoff,
                },
                timeout=60,
            )
            if (
                not isinstance(imported, Mapping)
                or imported.get("scenarioKey")
                != self._scenario_key(probe_input)
                or imported.get("platform") != probe_input.platform
            ):
                raise ScenarioRunnerError(
                    "AS-F06 native restart handoff import is invalid for "
                    f"{self._scenario_key(probe_input)}"
                )
        if durable_reload_evidence is None:
            raise ScenarioRunnerError(
                f"AS-F06 durable reload evidence is missing for "
                f"{self._scenario_key(probe_input)}"
            )
        orchestration = {
            **station_restart,
            "clientReloads": client_reloads,
        }

        self._set_locale(client, probe_input)
        result = client.harness(
            "foundationDirectProbe",
            {
                "platform": probe_input.platform,
                "locale": probe_input.locale,
                "cell": probe_input.cell,
                "sampleId": probe_input.sample_id,
                "scenarioKey": self._scenario_key(probe_input),
                "stationRestart": orchestration,
                "durableReloadEvidence": durable_reload_evidence,
            },
            timeout=300,
        )
        if not isinstance(result, Mapping):
            raise ScenarioRunnerError(
                f"AS-F06 completion returned invalid evidence for "
                f"{self._scenario_key(probe_input)}"
            )
        assert_group_one_capture(probe_input, result)
        self._captures[self._capture_key(probe_input)] = dict(result)

    def capture(
        self,
        probe_input: DirectRuntimeProbeInput,
    ) -> Mapping[str, Any]:
        if probe_input.cell != "AS-F06":
            raise ScenarioRunnerError(
                f"AS-F06 coordinator received {probe_input.cell}"
            )
        if not self._executed:
            self._execute()
        capture = self._captures.get(self._capture_key(probe_input))
        if capture is None:
            raise ScenarioRunnerError(
                f"AS-F06 tuple was not prepared: "
                f"{self._scenario_key(probe_input)}"
            )
        return capture


class FoundationInterruptedCoordinator:
    """Produce one independent interrupted Turn per direct-runtime tuple."""

    def __init__(
        self,
        runtime_pair: FoundationRuntimePair,
        runtime_manifest: Mapping[str, Any],
        profile_env: Mapping[str, str],
    ) -> None:
        self._runtime_pair = runtime_pair
        self._runtime_manifest = runtime_manifest
        self._profile_env = dict(profile_env)
        self._captures: dict[
            tuple[str, str, str, str],
            Mapping[str, Any],
        ] = {}

    @staticmethod
    def _capture_key(
        probe_input: DirectRuntimeProbeInput,
    ) -> tuple[str, str, str, str]:
        return (
            probe_input.platform,
            probe_input.locale,
            probe_input.cell,
            probe_input.sample_id,
        )

    @staticmethod
    def _scenario_key(probe_input: DirectRuntimeProbeInput) -> str:
        return "|".join(
            (
                probe_input.platform,
                probe_input.locale,
                probe_input.cell,
                probe_input.sample_id,
            )
        )

    def _client(self, platform: str) -> Any:
        if platform == "desktop_app":
            return self._runtime_pair.native
        if platform == "browser":
            return self._runtime_pair.browser
        raise ScenarioRunnerError(
            f"BASE-INTERRUPTED has no direct client for {platform}"
        )

    def _set_locale(
        self,
        client: Any,
        probe_input: DirectRuntimeProbeInput,
    ) -> None:
        result = client.harness(
            "setFoundationLocale",
            {"locale": probe_input.locale},
            timeout=30,
        )
        if (
            not isinstance(result, Mapping)
            or result.get("locale") != probe_input.locale
        ):
            raise ScenarioRunnerError(
                "BASE-INTERRUPTED locale did not converge for "
                f"{self._scenario_key(probe_input)}"
            )

    def _cleanup(
        self,
        client: Any,
        *,
        scenario_key: str,
        conversation_id: str,
        turn_id: str,
    ) -> None:
        result = client.harness(
            "foundationF06Cleanup",
            {
                "scenarioKey": scenario_key,
                "conversationId": conversation_id,
                "turnId": turn_id,
            },
            timeout=60,
        )
        if (
            not isinstance(result, Mapping)
            or result.get("cleanupComplete") is not True
        ):
            raise ScenarioRunnerError(
                "BASE-INTERRUPTED cleanup proof is invalid for "
                f"{scenario_key}: {result!r}"
            )

    def _execute_active(
        self,
        probe_input: DirectRuntimeProbeInput,
    ) -> Mapping[str, Any]:
        client = self._client(probe_input.platform)
        scenario_key = self._scenario_key(probe_input)
        handoff: Mapping[str, Any] | None = None
        result: Mapping[str, Any] | None = None
        transport_restored = False
        primary_error: BaseException | None = None
        try:
            def prepare_before_outage() -> None:
                nonlocal handoff
                self._set_locale(client, probe_input)
                prepared = client.prepare_foundation_f06(
                    {
                        "scenarioKey": scenario_key,
                        "platform": probe_input.platform,
                        "locale": probe_input.locale,
                        "sampleId": probe_input.sample_id,
                        "faultBoundary": "provider-started",
                    },
                    timeout=300,
                )
                if (
                    not isinstance(prepared, Mapping)
                    or not str(prepared.get("conversationId") or "")
                    or not str(prepared.get("turnId") or "")
                ):
                    raise ScenarioRunnerError(
                        "BASE-INTERRUPTED prepare returned invalid evidence for "
                        f"{scenario_key}: {prepared!r}"
                    )
                handoff = prepared

            def finalize_during_outage(_deadline: float) -> None:
                if handoff is None:
                    raise ScenarioRunnerError(
                        "BASE-INTERRUPTED restart did not prepare a handoff for "
                        f"{scenario_key}"
                    )
                finalized = client.harness(
                    "foundationF06FinalizePreparation",
                    {"scenarioKey": scenario_key},
                    timeout=60,
                )
                if (
                    not isinstance(finalized, Mapping)
                    or finalized.get("conversationId")
                    != handoff.get("conversationId")
                    or finalized.get("turnId") != handoff.get("turnId")
                ):
                    raise ScenarioRunnerError(
                        "BASE-INTERRUPTED finalized handoff is invalid for "
                        f"{scenario_key}"
                    )

            station_restart = restart_foundation_station(
                self._runtime_manifest,
                repo_root=REPO_ROOT,
                before_outage=prepare_before_outage,
                during_outage=finalize_during_outage,
                prearm_outage=True,
            )
            if handoff is None:
                raise ScenarioRunnerError(
                    "BASE-INTERRUPTED restart did not prepare a handoff for "
                    f"{scenario_key}"
                )
            client.restore_station_transport()
            transport_restored = True
            _authenticate_clients(
                self._runtime_pair,
                self._profile_env,
                clients=(client,),
                require_existing_session=True,
                recovery_boundary="base-interrupted-station-restart",
            )
            restored = client.harness(
                "foundationF06RestoreCapabilityIsolation",
                {"scenarioKey": scenario_key},
                timeout=60,
            )
            restoration_error = _capability_isolation_restoration_error(
                probe_input.platform,
                restored.get("toolIsolation")
                if isinstance(restored, Mapping)
                else None,
                allow_empty=True,
            )
            if restoration_error:
                raise ScenarioRunnerError(
                    "BASE-INTERRUPTED capability-isolation restoration "
                    f"failed for {scenario_key}: {restoration_error}"
                )
            self._set_locale(client, probe_input)
            candidate = client.harness(
                "foundationDirectProbe",
                {
                    "platform": probe_input.platform,
                    "locale": probe_input.locale,
                    "cell": probe_input.cell,
                    "sampleId": probe_input.sample_id,
                    "scenarioKey": scenario_key,
                    "stationRestart": station_restart,
                },
                timeout=300,
            )
            if not isinstance(candidate, Mapping):
                raise ScenarioRunnerError(
                    "BASE-INTERRUPTED direct probe returned invalid "
                    f"evidence for {scenario_key}"
                )
            result = dict(candidate)
            assert_group_one_capture(probe_input, result)
            return result
        except BaseException as error:
            primary_error = error
            raise
        finally:
            if not transport_restored:
                client.restore_station_transport()
            cleanup = (
                result.get("cleanup")
                if isinstance(result, Mapping)
                else None
            )
            cleanup_is_clean = (
                isinstance(cleanup, Mapping)
                and cleanup.get("status") == "clean"
            )
            if handoff is not None and not cleanup_is_clean:
                try:
                    _authenticate_clients(
                        self._runtime_pair,
                        self._profile_env,
                        clients=(client,),
                        require_existing_session=True,
                        recovery_boundary="base-interrupted-cleanup",
                    )
                    self._cleanup(
                        client,
                        scenario_key=scenario_key,
                        conversation_id=str(handoff["conversationId"]),
                        turn_id=str(handoff["turnId"]),
                    )
                except BaseException as cleanup_error:
                    if primary_error is not None:
                        raise ScenarioRunnerError(
                            f"{primary_error}; "
                            f"CLEANUP_FAILED: {cleanup_error}"
                        ) from primary_error
                    raise

    def capture(
        self,
        probe_input: DirectRuntimeProbeInput,
    ) -> Mapping[str, Any]:
        if probe_input.cell != "BASE-INTERRUPTED":
            raise ScenarioRunnerError(
                "BASE-INTERRUPTED coordinator received "
                f"{probe_input.cell}"
            )
        capture_key = self._capture_key(probe_input)
        capture = self._captures.get(capture_key)
        if capture is None:
            capture = dict(self._execute_active(probe_input))
            self._captures[capture_key] = capture
        return capture


class FoundationF12Coordinator:
    """Close every AS-F12 tuple around its own source-bound restart."""

    def __init__(
        self,
        runtime_pair: FoundationRuntimePair,
        runtime_manifest: Mapping[str, Any],
        profile_env: Mapping[str, str],
    ) -> None:
        self._runtime_pair = runtime_pair
        self._runtime_manifest = runtime_manifest
        self._profile_env = dict(profile_env)
        self._captures: dict[tuple[str, str, str, str], Mapping[str, Any]] = {}

    @staticmethod
    def _capture_key(
        probe_input: DirectRuntimeProbeInput,
    ) -> tuple[str, str, str, str]:
        return (
            probe_input.platform,
            probe_input.locale,
            probe_input.cell,
            probe_input.sample_id,
        )

    @staticmethod
    def _scenario_key(probe_input: DirectRuntimeProbeInput) -> str:
        return "|".join(
            (
                probe_input.platform,
                probe_input.locale,
                probe_input.cell,
                probe_input.sample_id,
            )
        )

    def _client(self, platform: str) -> Any:
        if platform == "desktop_app":
            return self._runtime_pair.native
        if platform == "browser":
            return self._runtime_pair.browser
        raise ScenarioRunnerError(
            f"AS-F12 has no direct client for platform {platform}"
        )

    def _set_locale(
        self,
        client: Any,
        probe_input: DirectRuntimeProbeInput,
    ) -> None:
        result = client.harness(
            "setFoundationLocale",
            {"locale": probe_input.locale},
            timeout=30,
        )
        if (
            not isinstance(result, Mapping)
            or result.get("locale") != probe_input.locale
        ):
            raise ScenarioRunnerError(
                f"AS-F12 locale did not converge for "
                f"{self._scenario_key(probe_input)}"
            )

    def _cleanup(
        self,
        client: Any,
        *,
        scenario_key: str,
        conversation_ids: tuple[str, str],
    ) -> None:
        result = client.harness(
            "foundationF12Cleanup",
            {
                "scenarioKey": scenario_key,
                "conversationIds": list(conversation_ids),
            },
            timeout=60,
        )
        if (
            not isinstance(result, Mapping)
            or result.get("cleanupComplete") is not True
            or result.get("handoffCleared") is not True
        ):
            raise ScenarioRunnerError(
                f"AS-F12 cleanup proof is invalid for "
                f"{scenario_key}: {result!r}"
            )

    def _execute_active(
        self,
        probe_input: DirectRuntimeProbeInput,
    ) -> Mapping[str, Any]:
        client = self._client(probe_input.platform)
        scenario_key = self._scenario_key(probe_input)
        prepared = False
        conversation_ids: tuple[str, str] = ("", "")
        result: Mapping[str, Any] | None = None
        primary_error: BaseException | None = None
        try:
            self._set_locale(client, probe_input)
            preparation = client.harness(
                "foundationF12Prepare",
                {
                    "scenarioKey": scenario_key,
                    "platform": probe_input.platform,
                    "locale": probe_input.locale,
                    "sampleId": probe_input.sample_id,
                },
                timeout=F12_PREPARE_TIMEOUT_SECONDS,
            )
            candidate_conversation_ids = (
                preparation.get("conversationIds")
                if isinstance(preparation, Mapping)
                else None
            )
            if (
                not isinstance(preparation, Mapping)
                or preparation.get("scenarioKey") != scenario_key
                or not isinstance(candidate_conversation_ids, list)
                or len(candidate_conversation_ids) != 2
                or any(
                    not isinstance(value, str) or not value
                    for value in candidate_conversation_ids
                )
                or len(set(candidate_conversation_ids)) != 2
                or preparation.get("primaryConversationId")
                != candidate_conversation_ids[0]
                or not isinstance(preparation.get("primaryTurnId"), str)
                or not preparation.get("primaryTurnId")
            ):
                raise ScenarioRunnerError(
                    f"AS-F12 prepare returned invalid evidence for "
                    f"{scenario_key}: {preparation!r}"
                )
            prepared = True
            conversation_ids = (
                candidate_conversation_ids[0],
                candidate_conversation_ids[1],
            )

            station_restart = restart_foundation_station(
                self._runtime_manifest,
                repo_root=REPO_ROOT,
            )
            client.restart()
            _authenticate_clients(
                self._runtime_pair,
                self._profile_env,
                clients=(client,),
                require_existing_session=True,
                recovery_boundary="as-f12-client-restart",
            )
            restart_evidence = {
                **station_restart,
                "clientReloads": {probe_input.platform: True},
                "owningPlatform": probe_input.platform,
                "existingSessionRestored": True,
            }
            candidate_result = client.harness(
                "foundationDirectProbe",
                {
                    "platform": probe_input.platform,
                    "locale": probe_input.locale,
                    "cell": "AS-F12",
                    "sampleId": probe_input.sample_id,
                    "scenarioKey": scenario_key,
                    "stationRestart": restart_evidence,
                },
                timeout=300,
            )
            if not isinstance(candidate_result, Mapping):
                raise ScenarioRunnerError(
                    f"AS-F12 direct probe returned invalid evidence for "
                    f"{scenario_key}"
                )
            result = dict(candidate_result)
            assert_group_one_capture(probe_input, result)
            return result
        except BaseException as error:
            primary_error = error
            raise
        finally:
            cleanup = result.get("cleanup") if isinstance(result, Mapping) else None
            cleanup_is_clean = (
                isinstance(cleanup, Mapping)
                and cleanup.get("status") == "clean"
            )
            if prepared and not cleanup_is_clean:
                try:
                    self._cleanup(
                        client,
                        scenario_key=scenario_key,
                        conversation_ids=conversation_ids,
                    )
                except BaseException as cleanup_error:
                    if primary_error is not None:
                        raise ScenarioRunnerError(
                            f"{primary_error}; CLEANUP_FAILED: {cleanup_error}"
                        ) from primary_error
                    raise

    def capture(
        self,
        probe_input: DirectRuntimeProbeInput,
    ) -> Mapping[str, Any]:
        if probe_input.cell != "AS-F12":
            raise ScenarioRunnerError(
                f"AS-F12 coordinator received {probe_input.cell}"
            )
        capture_key = self._capture_key(probe_input)
        capture = self._captures.get(capture_key)
        if capture is None:
            capture = dict(self._execute_active(probe_input))
            self._captures[capture_key] = capture
        return capture


def _make_non_advertisement_probe(
    runtime_pair: FoundationRuntimePair,
) -> "Callable[[NonAdvertisementProbeInput], Mapping[str, Any]]":
    """Create the non-advertisement probe via WebDriver harness.

    Desktop-rooted rows (include_local=True) probe through the native client;
    browser-rooted rows probe through the browser client.
    """
    def probe(probe_input: NonAdvertisementProbeInput) -> Mapping[str, Any]:
        client = (
            runtime_pair.native
            if probe_input.include_local
            else runtime_pair.browser
        )
        result = client.harness(
            "foundationNonAdvertisementProbe",
            {
                "platform": probe_input.platform,
                "locale": probe_input.locale,
                "runtimeKind": probe_input.runtime_kind,
                "runtimeId": probe_input.runtime_id,
                "includeLocal": probe_input.include_local,
            },
            timeout=120,
        )
        if not isinstance(result, Mapping):
            raise ScenarioRunnerError(
                f"non-advertisement probe returned invalid result "
                f"for runtime {probe_input.runtime_id}"
            )
        return result

    return probe


def _extract_station_profile(runtime_manifest: dict[str, Any]) -> str:
    """Determine the station profile name from the manifest."""
    profile = runtime_manifest.get("profile") or runtime_manifest.get(
        "resolvedProfile"
    )
    if isinstance(profile, str) and profile:
        return profile
    return "one"


def _extract_machine_id(runtime_manifest: dict[str, Any]) -> str:
    """Derive a machine identifier from the manifest."""
    machine = runtime_manifest.get("machineId") or runtime_manifest.get(
        "hostname"
    )
    if isinstance(machine, str) and machine:
        return machine
    import socket as _socket

    return _socket.gethostname()


def _warm_up_client(client: "FoundationRuntimeClient") -> bool:
    """Wait for Rust backend readiness before attempting login.

    After harness_ready confirms the web layer is mounted, the Rust/Tauri
    backend may still be initializing (SQLite migrations, plugin setup, IPC
    listener registration). A lightweight harness probe is used to confirm
    end-to-end IPC is functional. Retries up to 3 times with 10s intervals.
    """
    import time as _time

    max_attempts = 3
    probe_timeout = 15.0
    retry_interval = 10.0

    for attempt in range(1, max_attempts + 1):
        try:
            # getAcceptanceHarnessStatus is a no-op probe that exercises the
            # full JS → Rust IPC path without side effects.
            result = client.harness(
                "getAcceptanceHarnessStatus",
                {},
                timeout=probe_timeout,
            )
            if isinstance(result, Mapping) and result.get("ready"):
                return True
        except Exception:
            pass
        if attempt < max_attempts:
            _time.sleep(retry_interval)

    return False


def _restore_failure_diagnostic(
    *,
    recovery_boundary: str,
    poll_count: int,
    session_state: Mapping[str, Any] | None,
    last_error: BaseException | None,
) -> str:
    """Return bounded restore diagnostics without actor or credential values."""
    identity_state = (
        session_state.get("identityState")
        if isinstance(session_state, Mapping)
        else None
    )
    safe_identity_state = (
        identity_state
        if isinstance(identity_state, str)
        and identity_state in RESTORE_IDENTITY_STATES
        else "unknown"
    )
    identity_phase = (
        session_state.get("identityPhase")
        if isinstance(session_state, Mapping)
        else None
    )
    safe_identity_phase = (
        identity_phase
        if isinstance(identity_phase, str)
        and identity_phase in RESTORE_IDENTITY_PHASES
        else "unknown"
    )
    identity_reason = (
        session_state.get("identityReason")
        if isinstance(session_state, Mapping)
        else None
    )
    safe_identity_reason = (
        identity_reason
        if isinstance(identity_reason, str)
        and identity_reason in RESTORE_IDENTITY_REASONS
        else None
    )
    authenticated = (
        session_state.get("authenticated")
        if isinstance(session_state, Mapping)
        and isinstance(session_state.get("authenticated"), bool)
        else None
    )
    actor_present = (
        isinstance(session_state.get("actorId"), str)
        and bool(session_state.get("actorId"))
        if isinstance(session_state, Mapping)
        else False
    )

    error_texts: list[str] = []
    error = last_error
    for _ in range(4):
        if error is None:
            break
        error_texts.append(str(error).lower())
        error = error.__cause__
    combined_error = " ".join(error_texts)
    error_code = next(
        (code for code in RESTORE_ERROR_CODES if code.lower() in combined_error),
        None,
    )
    error_reason = next(
        (
            reason
            for reason in RESTORE_ERROR_REASONS
            if reason in combined_error
            or reason.replace("_", " ") in combined_error
        ),
        None,
    )

    return json.dumps(
        {
            "actorPresent": actor_present,
            "authenticated": authenticated,
            "errorCode": error_code,
            "errorReason": error_reason,
            "errorType": type(last_error).__name__ if last_error else None,
            "identityPhase": safe_identity_phase,
            "identityReason": safe_identity_reason,
            "identityState": safe_identity_state,
            "pollCount": poll_count,
            "recoveryBoundary": recovery_boundary,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def _authenticate_clients(
    runtime_pair: FoundationRuntimePair,
    profile_env: dict[str, str],
    *,
    clients: tuple[FoundationRuntimeClient, ...] | None = None,
    require_existing_session: bool = False,
    session_deadline: float | None = None,
    recovery_boundary: str = "session-recovery",
) -> None:
    """Prepare authenticated clients without masking recovery failures.

    Initial setup logs in with the profile fixture. Recovery paths set
    require_existing_session so Station/client restart must preserve the
    original session instead of silently replacing it. Both paths then
    navigate and bind the exact profile provider before capability checks.
    """
    account = "alice@p.t"
    password = profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", "1")
    provider_config = _agent_provider_config(profile_env)
    selected_clients = clients or (runtime_pair.native, runtime_pair.browser)

    for client in selected_clients:
        # Step 0: Warm-up — wait for Rust backend to finish initializing
        if not _warm_up_client(client):
            client.restart()
            if not _warm_up_client(client):
                raise ScenarioRunnerError(
                    f"{client.spec.runtime} client session remained unavailable "
                    "after bounded restart"
                )

        # Step 1: Initial setup drives the production Station selection commands
        # before login. Recovery paths preserve and prove the original binding.
        if require_existing_session:
            restore_deadline = min(
                session_deadline or time.monotonic() + 120,
                time.monotonic() + 120,
            )
            session_state: Mapping[str, Any] | None = None
            last_error: BaseException | None = None
            poll_count = 0
            while time.monotonic() < restore_deadline:
                poll_count += 1
                try:
                    candidate = client.harness(
                        "getRuntimeSnapshot",
                        {},
                        timeout=min(
                            30,
                            max(1, restore_deadline - time.monotonic()),
                        ),
                    )
                    last_error = None
                except Exception as error:
                    last_error = error
                    candidate = None
                if isinstance(candidate, Mapping):
                    session_state = candidate
                    if (
                        candidate.get("authenticated") is True
                        and candidate.get("identityState") == "ready"
                        and isinstance(candidate.get("actorId"), str)
                        and candidate.get("actorId")
                    ):
                        break
                remaining = restore_deadline - time.monotonic()
                if remaining <= 0:
                    break
                time.sleep(min(1.0, remaining))
            if (
                not isinstance(session_state, Mapping)
                or session_state.get("authenticated") is not True
                or session_state.get("identityState") != "ready"
                or not isinstance(session_state.get("actorId"), str)
                or not session_state.get("actorId")
            ):
                diagnostic = _restore_failure_diagnostic(
                    recovery_boundary=recovery_boundary,
                    poll_count=poll_count,
                    session_state=session_state,
                    last_error=last_error,
                )
                raise ScenarioRunnerError(
                    f"{client.spec.runtime} existing session was not restored: "
                    f"{diagnostic}"
                )
        else:
            source_station_url = (
                profile_env.get("PT_STATION_URL", "").strip().rstrip("/")
            )
            if not source_station_url:
                raise ScenarioRunnerError(
                    "active profile is missing PT_STATION_URL"
                )
            client.configure_station(timeout=60)
            login_result = client.harness(
                "loginWithPassword",
                {"account": account, "password": password},
                timeout=120,
            )
            if (
                not isinstance(login_result, Mapping)
                or not login_result.get("authenticated")
            ):
                raise ScenarioRunnerError(
                    f"{client.spec.runtime} login failed: {login_result}"
                )

        # Step 2: Navigate to agent surface
        nav_result = client.harness("navigateToAgent", {}, timeout=60)
        if not isinstance(nav_result, Mapping) or not nav_result.get("navigated"):
            raise ScenarioRunnerError(
                f"{client.spec.runtime} navigation failed: {nav_result}"
            )

        # Step 3: Configure the exact profile-bound provider and model.
        if not require_existing_session:
            provider_result = client.harness(
                "ensureProvider",
                provider_config,
                timeout=60,
            )
            if not isinstance(provider_result, Mapping) or not provider_result.get(
                "configured"
            ):
                raise ScenarioRunnerError(
                    f"{client.spec.runtime} provider configuration failed: "
                    f"{provider_result}"
                )

    # Step 4: Pre-probe health check — verify harness responds before
    # heavy capability probes. Surface diagnostics early if the agent
    # runtime failed to initialise.
    for client in selected_clients:
        try:
            health = client.harness("getAcceptanceHarnessStatus", {}, timeout=30)
        except Exception as error:
            log_path = getattr(client, 'log_path', None)
            raise ScenarioRunnerError(
                f"{client.spec.runtime} harness health check failed before "
                f"capability probes: {error}"
                f"{f' — client log: {log_path}' if log_path else ''}"
            ) from error
        if not isinstance(health, Mapping) or not health.get("ready"):
            log_path = getattr(client, 'log_path', None)
            raise ScenarioRunnerError(
                f"{client.spec.runtime} harness is not ready: {health}"
                f"{f' — client log: {log_path}' if log_path else ''}"
            )

    # Step 5: Open browser capability session explicitly (browser worker does
    # not auto-start; it requires an explicit openBrowserCapabilitySession call).
    if runtime_pair.browser in selected_clients:
        try:
            runtime_pair.browser.harness(
                "openBrowserCapabilitySession", {}, timeout=30
            )
        except Exception:
            pass  # May already be open or handled by the runtime; polling will verify.

    # Step 6: Wait for capability sessions on the selected clients (Station async)
    # Capability session registration is asynchronous on Station; the
    # messaging engine + signing identity must be ready before the worker
    # can register a lease. Give each client an independent 90s window.
    import time as _time

    for client in selected_clients:
        client_deadline = _time.monotonic() + 90
        established = False
        poll_count = 0
        _report_capability_session_enrollment_debug(
            "A-D",
            "capability-session-wait-started",
            {"runtime": client.spec.runtime},
        )
        while _time.monotonic() < client_deadline:
            poll_count += 1
            try:
                cap_result = client.harness(
                    "getFoundationCapabilitySessions",
                    {},
                    timeout=min(60, max(10, client_deadline - _time.monotonic())),
                )
            except Exception:
                cap_result = None
            local_result = (
                cap_result.get("local")
                if isinstance(cap_result, Mapping)
                else None
            )
            station_result = (
                cap_result.get("station")
                if isinstance(cap_result, Mapping)
                else None
            )
            local_sessions = (
                local_result.get("sessions")
                if isinstance(local_result, Mapping)
                else None
            )
            station_sessions = (
                station_result.get("sessions")
                if isinstance(station_result, Mapping)
                else None
            )
            _report_capability_session_enrollment_debug(
                "A-D",
                "capability-session-poll",
                {
                    "runtime": client.spec.runtime,
                    "pollCount": poll_count,
                    "localSessionCount": (
                        len(local_sessions)
                        if isinstance(local_sessions, list)
                        else None
                    ),
                    "stationSessionCount": (
                        len(station_sessions)
                        if isinstance(station_sessions, list)
                        else None
                    ),
                    "selectedSessionPresent": bool(
                        isinstance(cap_result, Mapping)
                        and cap_result.get("selectedStationSession")
                    ),
                },
            )
            if isinstance(cap_result, Mapping) and cap_result.get(
                "selectedStationSession"
            ):
                established = True
                break
            remaining = client_deadline - _time.monotonic()
            if remaining <= 0:
                break
            _time.sleep(min(15.0, remaining))
        if not established:
            # Collect diagnostic snapshot for debugging.
            diag = ""
            try:
                raw = client.harness(
                    "getAcceptanceHarnessStatus", {}, timeout=10
                )
                diag += f" harness={raw}"
            except Exception as diag_err:
                diag += f" harness_probe_failed={diag_err}"
            try:
                snap = client.harness(
                    "debugCapabilitySnapshot", {}, timeout=15
                )
                diag += f" snapshot={snap}"
            except Exception:
                diag += f" last_cap_result={cap_result}"
            log_path = getattr(client, "log_path", None)
            if log_path and Path(str(log_path)).is_file():
                try:
                    lines = Path(str(log_path)).read_text(
                        encoding="utf-8", errors="replace"
                    ).splitlines()
                    tail = "\n".join(lines[-200:])
                    diag += f"\n--- CLIENT LOG TAIL ({log_path}) ---\n{tail}"
                except Exception:
                    pass
            raise ScenarioRunnerError(
                f"{client.spec.runtime} capability session not established "
                f"after 90s polling.{diag}"
            )
        _report_capability_session_enrollment_debug(
            "A-D",
            "capability-session-wait-completed",
            {
                "runtime": client.spec.runtime,
                "pollCount": poll_count,
            },
        )


def _capability_isolation_restoration_error(
    runtime: str,
    restoration: Any,
    *,
    allow_empty: bool,
) -> str | None:
    if not isinstance(restoration, Mapping):
        return f"{runtime} capability isolation restoration is missing"

    def exact_int(name: str) -> int | None:
        value = restoration.get(name)
        return value if type(value) is int else None

    disabled = exact_int("disabledBindingCount")
    isolated_ready = exact_int("readyCapabilityCount")
    original_ready = exact_int("originalReadyCapabilityCount")
    restored_bindings = exact_int("restoredBindingCount")
    restored_ready = exact_int("restoredReadyCapabilityCount")
    original_hash = restoration.get("originalReadyCapabilityHash")
    restored_hash = restoration.get("restoredReadyCapabilityHash")
    valid = (
        disabled is not None
        and (disabled >= 0 if allow_empty else disabled > 0)
        and isolated_ready == 0
        and original_ready is not None
        and original_ready >= 0
        and (disabled > 0 or original_ready == 0)
        and restored_bindings == disabled
        and restored_ready == original_ready
        and isinstance(original_hash, str)
        and re.fullmatch(r"[0-9a-f]{64}", original_hash) is not None
        and restored_hash == original_hash
        and restoration.get("restorationVerified") is True
    )
    return (
        None
        if valid
        else f"{runtime} capability isolation restoration was not verified"
    )


def _restore_capability_isolation_for_cleanup(
    runtime_pair: FoundationRuntimePair,
    profile_env: Mapping[str, str],
) -> list[str]:
    def validate_result(runtime: str, result: Any) -> str | None:
        if not isinstance(result, Mapping):
            return f"{runtime} capability isolation restore returned invalid evidence"
        required = result.get("restorationRequired")
        restoration = result.get("restoration")
        fixture_required = result.get("fixtureRestorationRequired")
        fixture_verified = result.get("fixtureRestorationVerified")
        if not isinstance(required, bool):
            return (
                f"{runtime} capability isolation restore "
                "omitted restorationRequired"
            )
        if (
            not isinstance(fixture_required, bool)
            or fixture_verified is not True
        ):
            return (
                f"{runtime} capability fixture restoration "
                "was not verified"
            )
        if required is False:
            return (
                None
                if restoration is None
                else f"{runtime} capability isolation restore returned "
                "contradictory evidence"
            )
        return _capability_isolation_restoration_error(
            runtime,
            restoration,
            allow_empty=False,
        )

    errors: list[str] = []
    for client in (runtime_pair.browser, runtime_pair.native):
        if getattr(client, "driver", None) is None:
            storage_root = getattr(client.spec, "storage_root", None)
            if storage_root is None or not Path(storage_root).exists():
                continue
            try:
                client.restart()
                _authenticate_clients(
                    runtime_pair,
                    profile_env,
                    clients=(client,),
                )
            except BaseException as recovery_error:
                errors.append(
                    f"{client.spec.runtime} capability isolation restore: "
                    f"{type(recovery_error).__name__}"
                )
                continue
        try:
            result = client.harness(
                "restoreFoundationCapabilityIsolation",
                {},
                timeout=60,
            )
        except BaseException:
            try:
                client.restart()
                _authenticate_clients(
                    runtime_pair,
                    profile_env,
                    clients=(client,),
                )
                result = client.harness(
                    "restoreFoundationCapabilityIsolation",
                    {},
                    timeout=60,
                )
            except BaseException as recovery_error:
                errors.append(
                    f"{client.spec.runtime} capability isolation restore: "
                    f"{type(recovery_error).__name__}"
                )
                continue
        validation_error = validate_result(client.spec.runtime, result)
        if validation_error:
            errors.append(validation_error)
    return errors


def run_scenario(*, dry_run: bool = False) -> Path | None:
    """Execute Phase 1: produce the Foundation candidate manifest.

    Returns the candidate path, or None for configuration-only validation.
    """
    # --- Load provisioned environment ---
    runtime_manifest = _load_runtime_manifest()
    profile_env = _load_profile_env(runtime_manifest)
    client_manifest = _build_client_manifest(runtime_manifest)
    raw_startup_timeout = os.environ.get("PT_FOUNDATION_STARTUP_TIMEOUT", "900")
    try:
        startup_timeout = float(raw_startup_timeout)
    except ValueError as error:
        raise ScenarioRunnerError(
            "PT_FOUNDATION_STARTUP_TIMEOUT must be positive and finite"
        ) from error
    if not math.isfinite(startup_timeout) or startup_timeout <= 0:
        raise ScenarioRunnerError(
            "PT_FOUNDATION_STARTUP_TIMEOUT must be positive and finite"
        )
    station_profile = _extract_station_profile(runtime_manifest)
    machine = _extract_machine_id(runtime_manifest)

    if dry_run:
        # RuntimePair construction binds proxy sockets, even before start().
        clients = client_manifest["clients"]
        if (
            len(clients) != 2
            or any(not isinstance(client, Mapping) for client in clients)
            or {client.get("runtime") for client in clients}
            != {"native-tauri", "browser"}
        ):
            raise ScenarioRunnerError(
                "Foundation runtime manifest requires Native and Browser clients"
            )
        for client in clients:
            FoundationClientSpec.from_mapping(client)
        _agent_provider_config(profile_env)
        return None

    # --- Provision Evidence Store run ---
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    source = source_identity(REPO_ROOT)
    run = store.begin_run(GATE_ID, source=source)

    # --- Launch Desktop (native) + Browser ---
    runtime_pair = FoundationRuntimePair.from_manifest(
        client_manifest,
        profile_env=profile_env,
        startup_timeout=startup_timeout,
    )
    candidate_path: Path | None = None
    primary_error: BaseException | None = None
    try:
        runtime_pair.start()

        # --- Authenticate and configure both clients ---
        _authenticate_clients(runtime_pair, profile_env)

        # --- Build adapters ---
        f06_coordinator = FoundationF06Coordinator(
            runtime_pair,
            runtime_manifest,
            profile_env,
        )
        f12_coordinator = FoundationF12Coordinator(
            runtime_pair,
            runtime_manifest,
            profile_env,
        )
        executor_unavailable_coordinator = (
            FoundationExecutorUnavailableCoordinator(runtime_pair)
        )
        lease_expired_coordinator = FoundationLeaseExpiredCoordinator(
            runtime_pair
        )
        invalid_resource_reference_coordinator = (
            FoundationInvalidResourceReferenceCoordinator(runtime_pair)
        )
        interrupted_coordinator = FoundationInterruptedCoordinator(
            runtime_pair,
            runtime_manifest,
            profile_env,
        )
        forbidden_actor_coordinator = FoundationForbiddenActorCoordinator(
            runtime_pair,
            profile_env,
        )

        # 1. Desktop native adapter: real WebDriver probe through native client.
        desktop_native_adapter = DirectRuntimeFoundationAdapter(
            _make_direct_probe(
                runtime_pair.native,
                f06_coordinator=f06_coordinator,
                f12_coordinator=f12_coordinator,
                interrupted_coordinator=interrupted_coordinator,
                executor_unavailable_coordinator=(
                    executor_unavailable_coordinator
                ),
                lease_expired_coordinator=lease_expired_coordinator,
                invalid_resource_reference_coordinator=(
                    invalid_resource_reference_coordinator
                ),
                forbidden_actor_coordinator=forbidden_actor_coordinator,
            )
        )

        # 2. Browser adapter: real WebDriver probe through browser client.
        browser_adapter = DirectRuntimeFoundationAdapter(
            _make_direct_probe(
                runtime_pair.browser,
                f06_coordinator=f06_coordinator,
                f12_coordinator=f12_coordinator,
                interrupted_coordinator=interrupted_coordinator,
                executor_unavailable_coordinator=(
                    executor_unavailable_coordinator
                ),
                lease_expired_coordinator=lease_expired_coordinator,
                invalid_resource_reference_coordinator=(
                    invalid_resource_reference_coordinator
                ),
                forbidden_actor_coordinator=forbidden_actor_coordinator,
            )
        )

        # 3. Mobile contract adapter: runs contract test suite (no runtime).
        mobile_contract_adapter = MobileContractFoundationAdapter(
            repo_root=REPO_ROOT,
        )

        # 4. D11 adapter: runs entrypoint checker (no runtime).
        d11_adapter = D11FoundationAdapter(repo_root=REPO_ROOT)

        # 5. Non-advertisement adapter: proves invisible capabilities via
        #    real harness readback.
        non_advertisement_adapter = NonAdvertisementFoundationAdapter(
            _make_non_advertisement_probe(runtime_pair),
            station_profile=station_profile,
            machine=machine,
        )

        # --- Assemble the adapter bundle ---
        adapters = FoundationAdapters(
            desktop_native=desktop_native_adapter,
            browser=browser_adapter,
            mobile_contract=mobile_contract_adapter,
            d11=d11_adapter,
            non_advertisement=non_advertisement_adapter,
        )

        debug_tuple = os.environ.get("PT_FOUNDATION_DEBUG_TUPLE", "").strip()
        if debug_tuple:
            try:
                tuple_fields = json.loads(debug_tuple)
            except json.JSONDecodeError as error:
                raise ScenarioRunnerError(
                    "PT_FOUNDATION_DEBUG_TUPLE must be a JSON tuple key"
                ) from error
            if not isinstance(tuple_fields, list) or len(tuple_fields) != 8:
                raise ScenarioRunnerError(
                    "PT_FOUNDATION_DEBUG_TUPLE must be a JSON tuple key"
                )
            canonical_debug_tuple = json.dumps(
                tuple_fields,
                separators=(",", ":"),
            )
            matching = tuple(
                runtime_tuple
                for runtime_tuple in load_foundation_tuples()
                if runtime_tuple.key == canonical_debug_tuple
            )
            if len(matching) != 1:
                raise ScenarioRunnerError(
                    f"PT_FOUNDATION_DEBUG_TUPLE did not resolve exactly once: "
                    f"{debug_tuple}"
                )
            runtime_tuple = matching[0]
            adapter = (
                desktop_native_adapter
                if runtime_tuple.platform == "desktop_app"
                else browser_adapter
            )
            observation = (
                adapter.observe_desktop_native(runtime_tuple)
                if runtime_tuple.platform == "desktop_app"
                else adapter.observe_browser(runtime_tuple)
            )
            run.write_json(
                "runtime/debug-tuple-observation.json",
                {
                    "tuple": runtime_tuple.to_dict(),
                    "observed": observation.observed,
                    "passed": observation.passed,
                    "runtimeAttestation": (
                        observation.runtime_attestation.to_dict()
                    ),
                    "roleObservations": dict(observation.role_observations),
                },
            )
            raise ScenarioRunnerError(
                f"DEBUG_TUPLE_COMPLETE: {debug_tuple}"
            )

        # --- Produce candidate manifest ---
        producer = FoundationCandidateProducer(adapters)
        candidate_path = producer.produce(run)

    except BaseException as error:
        primary_error = error
    finally:
        # --- Cleanup: restore durable fixture mutations, then stop clients ---
        restoration_errors = _restore_capability_isolation_for_cleanup(
            runtime_pair,
            profile_env,
        )
        cleanup_result = runtime_pair.stop(
            remove_storage=not restoration_errors,
        )
        primary_failure = _failure_summary(primary_error, profile_env)
        if primary_failure:
            cleanup_result["primaryFailure"] = primary_failure
        if restoration_errors:
            cleanup_result["status"] = "failed"
            cleanup_result["capabilityIsolationFailures"] = restoration_errors
        run.write_json(
            "runtime/cleanup-result.json",
            cleanup_result,
        )
    if cleanup_result.get("status") != "clean":
        primary_summary = (
            f"{primary_failure[0]['type']}: "
            f"{primary_failure[0]['message']}"
            if primary_failure
            else "none"
        )
        cleanup_kind = (
            "capability isolation restoration"
            if restoration_errors
            else "runtime release"
        )
        raise ScenarioRunnerError(
            f"CLEANUP_FAILED: {cleanup_kind} failed; "
            f"primary={primary_summary}"
        ) from primary_error
    if primary_error is not None:
        raise primary_error
    if candidate_path is None:
        raise ScenarioRunnerError("Foundation candidate manifest was not produced")

    # --- Output manifest path to stdout ---
    return candidate_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Foundation Gate Phase 1 scenario runner. "
            "Produces the 419-tuple candidate manifest for the "
            "Foundation Gate validator."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate configuration without executing scenarios.",
    )
    args = parser.parse_args()

    try:
        candidate_path = run_scenario(dry_run=args.dry_run)
    except ScenarioRunnerError as error:
        print(f"FATAL: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(
            f"FATAL: unhandled error: {type(error).__name__}: {error}",
            file=sys.stderr,
        )
        return 1

    if args.dry_run:
        sys.stdout.write(
            "Foundation configuration valid; no scenarios executed; "
            "no candidate manifest produced.\n"
        )
        return 0

    # Output the candidate manifest path to stdout for downstream consumption.
    # The acceptance-run.py framework and agent_v2_gate.py validator read this
    # path via PT_AGENT_V2_CANDIDATE_MANIFEST.
    print(str(candidate_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
