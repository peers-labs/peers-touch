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
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
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
from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    GATE_ID,
    FoundationAdapters,
    FoundationCandidateProducer,
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
    FoundationRuntimeClient,
    FoundationRuntimePair,
)


class ScenarioRunnerError(RuntimeError):
    """Fatal error during Foundation scenario execution."""


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
    station = runtime_manifest.get("station")
    if not isinstance(station, Mapping) or not station.get("url"):
        raise ScenarioRunnerError(
            "runtime manifest must contain station.url"
        )
    clients = runtime_manifest.get("clients")
    if not isinstance(clients, list):
        raise ScenarioRunnerError(
            "runtime manifest must contain a clients array"
        )
    return {
        "station": station,
        "clients": clients,
    }


def _make_direct_probe(
    client: Any,
    *,
    f06_coordinator: "FoundationF06Coordinator | None" = None,
) -> "Callable[[DirectRuntimeProbeInput], Mapping[str, Any]]":
    """Create a direct-runtime probe that executes via WebDriver harness.

    The probe calls the acceptance harness method on the given client to run
    the Foundation scenario for a specific cell/locale/sample and return the
    full capture dictionary expected by DirectRuntimeFoundationAdapter.
    """
    def probe(probe_input: DirectRuntimeProbeInput) -> Mapping[str, Any]:
        if probe_input.cell == "AS-F06":
            if f06_coordinator is None:
                raise ScenarioRunnerError(
                    "AS-F06 direct probe requires restart orchestration"
                )
            return f06_coordinator.capture(probe_input)
        result = client.harness(
            "foundationDirectProbe",
            {
                "platform": probe_input.platform,
                "locale": probe_input.locale,
                "cell": probe_input.cell,
                "sampleId": probe_input.sample_id,
            },
            timeout=900 if probe_input.cell == "AS-F04" else 300,
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

    def _cleanup_prepared(
        self,
        prepared: list[tuple[DirectRuntimeProbeInput, Mapping[str, Any]]],
    ) -> list[str]:
        errors: list[str] = []
        for probe_input, handoff in reversed(prepared):
            scenario_key = self._scenario_key(probe_input)
            try:
                result = self._client(probe_input.platform).harness(
                    "foundationF06Cleanup",
                    {
                        "scenarioKey": scenario_key,
                        "conversationId": str(
                            handoff.get("conversationId") or ""
                        ),
                        "turnId": str(handoff.get("turnId") or ""),
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
            _authenticate_clients(self._runtime_pair, self._profile_env)
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
            tuple[DirectRuntimeProbeInput, Mapping[str, Any]]
        ] = []
        primary_error: BaseException | None = None
        try:
            for probe_input in f06_inputs:
                client = self._client(probe_input.platform)
                self._set_locale(client, probe_input)
                handoff = client.harness(
                    "foundationF06Prepare",
                    {
                        "scenarioKey": self._scenario_key(probe_input),
                        "platform": probe_input.platform,
                        "locale": probe_input.locale,
                        "sampleId": probe_input.sample_id,
                    },
                    timeout=300,
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
                prepared.append((probe_input, handoff))
                self._execute_active(probe_input)
        except BaseException as error:
            primary_error = error

        cleanup_errors = (
            self._restore_clients_for_cleanup()
            if primary_error is not None
            else []
        )
        cleanup_errors.extend(self._cleanup_prepared(prepared))
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
            client = self._client(probe_input.platform)
            _authenticate_clients(
                self._runtime_pair,
                self._profile_env,
                clients=(client,),
                require_existing_session=True,
                session_deadline=operation_deadline,
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
            if (
                not isinstance(durable_reload, Mapping)
                or durable_reload.get("observed") is not True
            ):
                raise ScenarioRunnerError(
                    f"AS-F06 durable reload was not observed for "
                    f"{self._scenario_key(probe_input)}: {result!r}"
                )

        station_restart = restart_foundation_station(
            self._runtime_manifest,
            repo_root=REPO_ROOT,
            during_outage=observe_recovery_failures,
            after_restart=exercise_durable_reloads,
        )
        client = self._client(probe_input.platform)
        client.restart()
        client_reloads = {probe_input.platform: True}
        _authenticate_clients(
            self._runtime_pair,
            self._profile_env,
            clients=(client,),
            require_existing_session=True,
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


def _warm_up_client(client: "FoundationRuntimeClient") -> None:
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
                return
        except Exception:
            pass
        if attempt < max_attempts:
            _time.sleep(retry_interval)

    # Final warm-up failure is not terminal here. The caller's next login or
    # existing-session probe reports the operation-specific failure.


def _authenticate_clients(
    runtime_pair: FoundationRuntimePair,
    profile_env: dict[str, str],
    *,
    clients: tuple[FoundationRuntimeClient, ...] | None = None,
    require_existing_session: bool = False,
    session_deadline: float | None = None,
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
        _warm_up_client(client)

        # Step 1: Initial setup may log in. Recovery paths must instead prove
        # the original session survived Station or client restart.
        if require_existing_session:
            restore_deadline = min(
                session_deadline or time.monotonic() + 120,
                time.monotonic() + 120,
            )
            session_state: Mapping[str, Any] | None = None
            while time.monotonic() < restore_deadline:
                try:
                    candidate = client.harness(
                        "getRuntimeSnapshot",
                        {},
                        timeout=min(
                            30,
                            max(1, restore_deadline - time.monotonic()),
                        ),
                    )
                except Exception:
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
            else:
                session_state = None
            if (
                not isinstance(session_state, Mapping)
                or session_state.get("authenticated") is not True
                or session_state.get("identityState") != "ready"
                or not isinstance(session_state.get("actorId"), str)
                or not session_state.get("actorId")
            ):
                raise ScenarioRunnerError(
                    f"{client.spec.runtime} existing session was not restored"
                )
        else:
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
        while _time.monotonic() < client_deadline:
            try:
                cap_result = client.harness(
                    "getFoundationCapabilitySessions",
                    {},
                    timeout=min(60, max(10, client_deadline - _time.monotonic())),
                )
            except Exception:
                cap_result = None
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


def run_scenario(*, dry_run: bool = False) -> Path:
    """Execute Phase 1: produce the Foundation candidate manifest.

    Returns the absolute path to the candidate manifest JSON.
    """
    # --- Load provisioned environment ---
    runtime_manifest = _load_runtime_manifest()
    profile_env = _load_profile_env(runtime_manifest)
    client_manifest = _build_client_manifest(runtime_manifest)
    startup_timeout = float(
        os.environ.get("PT_FOUNDATION_STARTUP_TIMEOUT", "900")
    )
    station_profile = _extract_station_profile(runtime_manifest)
    machine = _extract_machine_id(runtime_manifest)

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

        # 1. Desktop native adapter: real WebDriver probe through native client.
        desktop_native_adapter = DirectRuntimeFoundationAdapter(
            _make_direct_probe(
                runtime_pair.native,
                f06_coordinator=f06_coordinator,
            )
        )

        # 2. Browser adapter: real WebDriver probe through browser client.
        browser_adapter = DirectRuntimeFoundationAdapter(
            _make_direct_probe(
                runtime_pair.browser,
                f06_coordinator=f06_coordinator,
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

        # --- Produce candidate manifest ---
        producer = FoundationCandidateProducer(adapters)
        candidate_path = producer.produce(run)

    finally:
        # --- Cleanup: stop clients and record result ---
        cleanup_result = runtime_pair.stop()
        run.write_json(
            "runtime/cleanup-result.json",
            cleanup_result,
        )

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

    # Output the candidate manifest path to stdout for downstream consumption.
    # The acceptance-run.py framework and agent_v2_gate.py validator read this
    # path via PT_AGENT_V2_CANDIDATE_MANIFEST.
    print(str(candidate_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
