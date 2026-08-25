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
    FoundationRuntimePair,
)


class ScenarioRunnerError(RuntimeError):
    """Fatal error during Foundation scenario execution."""


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
    """Extract profile environment from the runtime manifest."""
    profile_env_path = manifest.get("profileEnvPath")
    if isinstance(profile_env_path, str) and profile_env_path:
        path = Path(profile_env_path).expanduser().resolve()
        if path.is_file():
            return load_env_file(path)
    return {}


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
) -> "Callable[[DirectRuntimeProbeInput], Mapping[str, Any]]":
    """Create a direct-runtime probe that executes via WebDriver harness.

    The probe calls the acceptance harness method on the given client to run
    the Foundation scenario for a specific cell/locale/sample and return the
    full capture dictionary expected by DirectRuntimeFoundationAdapter.
    """
    def probe(probe_input: DirectRuntimeProbeInput) -> Mapping[str, Any]:
        result = client.harness(
            "foundationDirectProbe",
            {
                "platform": probe_input.platform,
                "locale": probe_input.locale,
                "cell": probe_input.cell,
                "sampleId": probe_input.sample_id,
            },
            timeout=300,
        )
        if not isinstance(result, Mapping):
            raise ScenarioRunnerError(
                f"direct probe returned invalid result for "
                f"{probe_input.cell}/{probe_input.sample_id}"
            )
        return result

    return probe


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


def _authenticate_clients(
    runtime_pair: FoundationRuntimePair,
    profile_env: dict[str, str],
) -> None:
    """Login, navigate, and configure provider on both runtime clients.

    This step is required before any harness probe that reads agent state.
    The actor account is alice@p.t with CHAT_NATIVE_DEMO_PASSWORD from the
    profile environment. Provider configuration uses PT_AGENT_PROVIDER_API_KEY
    and PT_AGENT_DEFAULT_MODEL_ID.
    """
    account = "alice@p.t"
    password = profile_env.get("CHAT_NATIVE_DEMO_PASSWORD", "1")
    provider_api_key = profile_env.get("PT_AGENT_PROVIDER_API_KEY", "")
    model_id = profile_env.get("PT_AGENT_DEFAULT_MODEL_ID", "")

    for client in (runtime_pair.native, runtime_pair.browser):
        # Step 1: Login
        login_result = client.harness(
            "loginWithPassword",
            {"account": account, "password": password},
            timeout=60,
        )
        if not isinstance(login_result, Mapping) or not login_result.get("authenticated"):
            raise ScenarioRunnerError(
                f"{client.spec.runtime} login failed: {login_result}"
            )

        # Step 2: Navigate to agent surface
        nav_result = client.harness("navigateToAgent", {}, timeout=60)
        if not isinstance(nav_result, Mapping) or not nav_result.get("navigated"):
            raise ScenarioRunnerError(
                f"{client.spec.runtime} navigation failed: {nav_result}"
            )

        # Step 3: Configure provider (only if credentials available)
        if provider_api_key and model_id:
            provider_result = client.harness(
                "ensureProvider",
                {
                    "providerId": "acceptance-provider",
                    "apiKey": provider_api_key,
                    "modelId": model_id,
                },
                timeout=60,
            )
            if not isinstance(provider_result, Mapping) or not provider_result.get(
                "configured"
            ):
                raise ScenarioRunnerError(
                    f"{client.spec.runtime} provider configuration failed: "
                    f"{provider_result}"
                )

    # Step 4: Wait for capability sessions on both clients (Station async)
    # Capability session registration is asynchronous on Station; the
    # messaging engine + signing identity must be ready before the worker
    # can register a lease. Give each client an independent 90s window.
    import time as _time

    for client in (runtime_pair.native, runtime_pair.browser):
        client_deadline = _time.monotonic() + 90
        try:
            cap_result = client.harness(
                "getFoundationCapabilitySessions",
                {},
                timeout=80,
            )
        except Exception:
            # If capability session is not available yet, it's not fatal;
            # individual probes will retry with their own timeouts.
            cap_result = None
        if isinstance(cap_result, Mapping) and cap_result.get(
            "selectedStationSession"
        ):
            continue
        # Wait and retry once
        _time.sleep(min(10.0, max(0, client_deadline - _time.monotonic())))
        retry_timeout = max(10.0, client_deadline - _time.monotonic()) + 10
        try:
            cap_result = client.harness(
                "getFoundationCapabilitySessions",
                {},
                timeout=retry_timeout,
            )
        except Exception as error:
            raise ScenarioRunnerError(
                f"{client.spec.runtime} capability session not established "
                f"after extended wait: {error}"
            ) from error
        if not isinstance(cap_result, Mapping) or not cap_result.get(
            "selectedStationSession"
        ):
            raise ScenarioRunnerError(
                f"{client.spec.runtime} capability session not established"
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

        # 1. Desktop native adapter: real WebDriver probe through native client.
        desktop_native_adapter = DirectRuntimeFoundationAdapter(
            _make_direct_probe(runtime_pair.native)
        )

        # 2. Browser adapter: real WebDriver probe through browser client.
        browser_adapter = DirectRuntimeFoundationAdapter(
            _make_direct_probe(runtime_pair.browser)
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
