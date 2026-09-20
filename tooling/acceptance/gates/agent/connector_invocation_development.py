#!/usr/bin/env python3
"""Run the focused V2-J05 Connector invocation Development Journey."""

from __future__ import annotations

import argparse
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
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.evidence_store import (
    EvidenceStore,
    source_identity,
    workspace_id,
)
from tooling.acceptance.gates.agent.capability_binding_development import (
    J02_ACTOR_ACCOUNT,
    J02_IDENTITY_FIXTURE,
    authenticate_native_client,
    copy_native_runtime_logs,
    identity_fixture_evidence,
    persist_native_actor_identity,
    resolve_machine_profile,
    seed_native_actor_identity,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientSpec,
    FoundationRuntimeClient,
)
from tooling.acceptance.gates.agent.governed_tool_development import (
    OpenAIProviderFixture,
    RemoteProviderBridge,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_CONNECTOR_GATE,
    HomeStationProvisioner,
)


WORKSPACE_ID = workspace_id(ROOT)
WORK_ITEM_ID = "MCA-V2-ALIGNMENT-J05"
JOURNEY_ID = "V2-J05"
PROFILE = "two"
CONNECTOR_ID = "github"
CONNECTOR_TOOL_PREFIX = "connector_resource_"


class ConnectorInvocationDevelopmentError(RuntimeError):
    """The V2-J05 Development Journey failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ConnectorInvocationDevelopmentError(message)


def require_mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ConnectorInvocationDevelopmentError(f"{label} must be an object")
    return value


def evaluate_connector_invocation(
    journey: Mapping[str, Any],
    provider_requests: list[dict[str, Any]],
    *,
    credential_field_leaked: bool,
) -> dict[str, bool]:
    harness_assertions = require_mapping(
        journey.get("assertions"),
        "Connector Harness assertions",
    )
    receiver = require_mapping(
        journey.get("receiver-dom"),
        "Connector receiver DOM",
    )
    station = require_mapping(
        journey.get("station-readback"),
        "Connector Station readback",
    )
    manifest = require_mapping(
        journey.get("oauth-resource-manifest"),
        "Connector OAuth resource manifest",
    )
    provider_revoke = require_mapping(
        journey.get("provider-revoke"),
        "Connector provider revoke",
    )
    side_effect = require_mapping(
        journey.get("side-effect-count"),
        "Connector side-effect count",
    )
    replay = require_mapping(journey.get("replay"), "Connector replay")
    cleanup = require_mapping(journey.get("cleanup"), "Connector cleanup")
    first = provider_requests[0] if len(provider_requests) > 0 else {}
    continuation = provider_requests[1] if len(provider_requests) > 1 else {}
    selected_tool = str(first.get("selectedToolName") or "")
    assertions = {
        "harnessAssertionsPass": (
            bool(harness_assertions)
            and all(value is True for value in harness_assertions.values())
        ),
        "deterministicConnectorProviderSequence": (
            len(provider_requests) == 2
            and first.get("stream") is True
            and first.get("authorizationPresent") is True
            and first.get("hasToolResult") is False
            and selected_tool.startswith(CONNECTOR_TOOL_PREFIX)
            and selected_tool in first.get("toolNames", [])
            and continuation.get("stream") is True
            and continuation.get("authorizationPresent") is True
            and continuation.get("hasToolResult") is True
            and continuation.get("hasExpectedToolResult") is True
            and continuation.get("selectedToolName") == selected_tool
        ),
        "nativeReceiverObserved": (
            receiver.get("visible") is True
            and receiver.get("status") == "success"
            and receiver.get("connectorVisible") is True
        ),
        "stationLineageObserved": (
            station.get("entityKind") == "connector-tool-call-lineage"
            and station.get("sourceHash") == station.get("replayHash")
        ),
        "oauthResourceManifestObserved": (
            int(manifest.get("connectionRevision") or 0) > 0
            and manifest.get("resourceId") == "connection.status"
            and bool(manifest.get("resourceVersion"))
            and len(str(manifest.get("scopesHash") or "")) == 64
        ),
        "providerRevokeObserved": (
            provider_revoke.get("providerId") == CONNECTOR_ID
            and provider_revoke.get("status") == "unconfirmed"
            and provider_revoke.get("errorCode")
            == "CONNECTOR_PROVIDER_REVOKE_UNCONFIRMED"
            and len(str(provider_revoke.get("idempotencyKeyHash") or "")) == 64
        ),
        "oneConnectorSideEffect": (
            side_effect.get("count") == 1
            and side_effect.get("maximum") == 1
        ),
        "stationReplayEqual": (
            replay.get("equal") is True
            and replay.get("sourceHash") == replay.get("replayHash")
        ),
        "credentialFieldsProtected": credential_field_leaked is False,
        "productCleanupComplete": cleanup.get("status") == "clean",
    }
    failed = sorted(name for name, passed in assertions.items() if not passed)
    if failed:
        raise ConnectorInvocationDevelopmentError(
            "V2-J05 facts failed assertions: " + ", ".join(failed)
        )
    return assertions


def _client_from_manifest(
    manifest: Mapping[str, Any],
    profile_env: Mapping[str, str],
) -> FoundationRuntimeClient:
    services = manifest.get("services")
    station = services.get("station") if isinstance(services, Mapping) else None
    clients = manifest.get("clients")
    require(
        isinstance(station, Mapping) and bool(station.get("endpoint")),
        "J05 runtime manifest has no Station endpoint",
    )
    require(
        isinstance(clients, list) and len(clients) == 1,
        "J05 runtime manifest must contain exactly one Native client",
    )
    client = require_mapping(clients[0], "J05 Native client")
    require(
        client.get("runtime") == "native-tauri",
        "J05 runtime manifest client must be native-tauri",
    )
    return FoundationRuntimeClient(
        FoundationClientSpec.from_mapping(client),
        station_url=str(station["endpoint"]),
        profile_env=profile_env,
        startup_timeout=900,
    )


def _cleanup_client(client: FoundationRuntimeClient) -> dict[str, Any]:
    result = client.stop(remove_storage=False)
    shutil.rmtree(client.actor_identity_root, ignore_errors=True)
    result["actorIdentityReleased"] = not client.actor_identity_root.exists()
    if not result["actorIdentityReleased"]:
        result["status"] = "failed"
        result.setdefault("failures", []).append(
            "actor identity root remained present"
        )
    return result


def _contains_credential_field(value: object) -> bool:
    forbidden = {
        "access_token",
        "refresh_token",
        "client_secret",
        "authorization",
        "bearer",
    }
    if isinstance(value, Mapping):
        return any(
            str(key).lower() in forbidden
            or _contains_credential_field(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(_contains_credential_field(item) for item in value)
    return False


def main() -> int:
    argparse.ArgumentParser(
        description="Run the V2-J05 Connector invocation Development Journey.",
    ).parse_args()
    started_at = time.monotonic()
    activation = subprocess.run(
        ["make", "profile", f"PROFILE={PROFILE}"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    require(activation.returncode == 0, "failed to activate Profile two")
    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "active profile is not Profile two")
    deployment_environment = profile_env.get("PT_STATION_DEPLOY_ENV", "")
    require(
        bool(deployment_environment),
        "Profile two has no Station deployment environment",
    )
    os.environ.update(profile_env)
    os.environ["PT_DEV_PROFILE"] = PROFILE
    artifact_run_id = datetime.now(timezone.utc).strftime(
        "%Y%m%dT%H%M%S%fZ"
    )
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
    attestation_root = Path("/tmp") / f"mca-connector-{artifact_run_id}"
    os.environ["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(attestation_root)
    store = EvidenceStore(attestation_root, worktree=ROOT)
    attestation_run = store.begin_run(
        AGENT_V2_CONNECTOR_GATE,
        source=source_identity(ROOT),
    )
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_CONNECTOR_GATE
    os.environ["PT_ACCEPTANCE_RUN_ID"] = attestation_run.run_id
    os.environ["PT_ACCEPTANCE_APPROVED_PROFILE"] = PROFILE

    provisioner = HomeStationProvisioner(
        EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "home-station.yaml")
    )
    provisioner._resolve_active_profile = lambda: (
        profile_name,
        profile_file,
        slot,
        dict(profile_env),
    )
    provider_fixture = OpenAIProviderFixture(
        tool_name="",
        tool_name_prefix=CONNECTOR_TOOL_PREFIX,
        tool_arguments={"params": {"sample": "mca-v2-j05"}},
        expected_tool_result=CONNECTOR_ID,
        terminal_content="Connector invocation completed.",
        thread_name="mca-j05-provider-fixture",
    )
    provider_bridge = RemoteProviderBridge(
        deployment_environment,
        artifact_prefix="mca-j05-provider",
    )
    runtime_client: FoundationRuntimeClient | None = None
    manifest = None
    journey: dict[str, Any] = {}
    assertions: dict[str, bool] = {}
    primary_error: BaseException | None = None
    credential_field_leaked = False
    cleanup: dict[str, Any] = {
        "status": "clean",
        "client": None,
        "providerBridge": None,
        "providerFixtureStopped": False,
        "provisionerResourcesReleased": [],
        "failures": [],
    }

    try:
        manifest = provisioner.provision(AGENT_V2_CONNECTOR_GATE)
        require(
            manifest.state.value == "FIXTURE_READY",
            (
                "J05 provisioning did not become ready: "
                f"{manifest.blocked_reason or manifest.state.value}"
            ),
        )
        provider_fixture.start()
        provider_base_url = provider_bridge.start(
            provider_fixture.port,
            artifact_run_id,
        )
        runtime_client = _client_from_manifest(
            manifest.to_dict(),
            profile_env,
        )
        seeded_identity = seed_native_actor_identity(
            fixture_root=J02_IDENTITY_FIXTURE,
            target_root=runtime_client.actor_identity_root,
            station_url=profile_env["PT_STATION_URL"],
        )
        runtime_client.start()
        login = authenticate_native_client(runtime_client, profile_env)
        journey_value = runtime_client.harness(
            "runConnectorInvocationDevelopment",
            {
                "sampleId": f"mca-j05-{artifact_run_id}",
                "providerBaseUrl": provider_base_url,
                "connectorId": CONNECTOR_ID,
            },
            timeout=1200,
        )
        require(
            isinstance(journey_value, Mapping),
            "V2-J05 Harness returned invalid evidence",
        )
        journey = dict(journey_value)
        provider_requests = provider_fixture.snapshot()
        credential_field_leaked = _contains_credential_field(journey)
        assertions = evaluate_connector_invocation(
            journey,
            provider_requests,
            credential_field_leaked=credential_field_leaked,
        )
        identity_metadata = persist_native_actor_identity(
            source_root=runtime_client.actor_identity_root,
            fixture_root=J02_IDENTITY_FIXTURE,
            station_url=profile_env["PT_STATION_URL"],
            actor_id=str(login["actorId"]),
            station_accepted=True,
        )
        journey = {
            "identityFixture": identity_fixture_evidence(
                identity_metadata,
                reused=seeded_identity is not None,
            ),
            **journey,
        }
    except BaseException as error:
        primary_error = error
    finally:
        if runtime_client is not None:
            try:
                cleanup["nativeRuntimeLogs"] = copy_native_runtime_logs(
                    runtime_client,
                    artifact_dir,
                )
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    "Native runtime log capture: "
                    f"{type(error).__name__}: {error}"
                )
            try:
                cleanup["client"] = _cleanup_client(runtime_client)
                if cleanup["client"].get("status") != "clean":
                    cleanup["status"] = "failed"
                    cleanup["failures"].append("client runtime cleanup failed")
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    f"client runtime cleanup: {type(error).__name__}: {error}"
                )
        try:
            cleanup["providerBridge"] = provider_bridge.stop()
            if cleanup["providerBridge"].get("status") != "clean":
                cleanup["status"] = "failed"
                cleanup["failures"].append("provider bridge cleanup failed")
        except BaseException as error:
            cleanup["status"] = "failed"
            cleanup["failures"].append(
                f"provider bridge cleanup: {type(error).__name__}: {error}"
            )
        try:
            provider_fixture.stop()
            cleanup["providerFixtureStopped"] = True
        except BaseException as error:
            cleanup["status"] = "failed"
            cleanup["failures"].append(
                f"provider fixture cleanup: {type(error).__name__}: {error}"
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
            "stationDeploymentEnvironment": deployment_environment,
            "stationBuildCommit": station.live_commit if station else "",
            "clientRuntime": "native-tauri",
            "actorAccount": J02_ACTOR_ACCOUNT,
        },
        "assertions": assertions,
        "capture": {
            "journey": journey,
            "providerRequests": provider_fixture.snapshot(),
        },
        "secretScan": {
            "status": "failed" if credential_field_leaked else "passed",
            "credentialFieldPersisted": credential_field_leaked,
        },
        "failure": (
            []
            if primary_error is None
            else [{
                "type": type(primary_error).__name__,
                "message": str(primary_error)[:4096],
            }]
        ),
        "cleanup": cleanup,
        "durationMs": int((time.monotonic() - started_at) * 1000),
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
