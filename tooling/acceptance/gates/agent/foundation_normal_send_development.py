#!/usr/bin/env python3
"""Run the focused G-FE1 normal-send Development Journey."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import traceback
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.evidence_store import (
    EvidenceStore,
    source_identity,
    workspace_id,
)
from tooling.acceptance.core.harness import harness_ready
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


ROOT = Path(__file__).resolve().parents[4]
WORKSPACE_ID = workspace_id(ROOT)
WORK_ITEM_ID = "MCA-001"
JOURNEY_ID = "G-FE1-NORMAL-SEND"
PROFILE = "chat-native-disposable"
DEPLOYMENT_ENVIRONMENT = "chat-native-disposable-station"
COMPLETED_MESSAGE_STATUS = 3


class NormalSendError(RuntimeError):
    """The normal-send Development Journey failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise NormalSendError(message)


def wait_until(
    predicate: Callable[[], Any],
    description: str,
    *,
    timeout: float = 180,
    interval: float = 0.2,
) -> Any:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except NormalSendError:
            raise
        except Exception as error:  # noqa: BLE001 - retained for diagnostics.
            last_error = error
        time.sleep(min(interval, max(0.0, deadline - time.monotonic())))
    suffix = f"; last error: {last_error}" if last_error else ""
    raise NormalSendError(f"timed out waiting for {description}{suffix}")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


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


def assistant_projection(
    snapshot: Mapping[str, Any],
    *,
    conversation_id: str,
    turn_id: str,
    content: str,
) -> Mapping[str, Any] | None:
    assistant = snapshot.get("assistant")
    if (
        snapshot.get("currentSessionKey") != conversation_id
        or not isinstance(assistant, Mapping)
        or assistant.get("turnId") != turn_id
        or assistant.get("content") != content
        or assistant.get("loading") is True
        or assistant.get("error")
    ):
        return None
    return snapshot


def evaluate_normal_send(
    capture: Mapping[str, Any],
) -> dict[str, bool]:
    active = capture["active"]
    completed = capture["completed"]
    reloaded = capture["reloaded"]
    restarted = capture["restarted"]
    station = capture["station"]
    client_messages = capture["clientMessages"]
    turn_id = str(capture["turnId"])
    content = str(capture["content"])

    station_messages = station["messages"]
    terminal_messages = [
        message
        for message in station_messages
        if message.get("turnId") == turn_id
        and message.get("role") == "assistant"
        and message.get("status") == COMPLETED_MESSAGE_STATUS
    ]
    message_ids = [
        str(message.get("messageId") or "")
        for message in station_messages
        if message.get("messageId")
    ]
    visible_messages = client_messages["messages"]
    assertions = {
        "nonEmptySequencedStream": (
            active["operation"]["runState"] in {"streaming", "reconciling"}
            and int(active["operation"]["lastEventSeq"]) > 0
            and bool(str(active["assistant"]["content"]))
        ),
        "singleAuthoritativeTerminal": (
            completed["operation"]["runState"] == "completed"
            and len(terminal_messages) == 1
        ),
        "stationContentMatches": (
            terminal_messages[0]["content"] == content
            if len(terminal_messages) == 1
            else False
        ),
        "durableReloadMatches": (
            reloaded["assistant"]["content"] == content
            and reloaded["assistant"]["turnId"] == turn_id
        ),
        "clientRestartReplayMatches": (
            restarted["assistant"]["content"] == content
            and restarted["assistant"]["turnId"] == turn_id
        ),
        "noDuplicateMessages": len(message_ids) == len(set(message_ids)),
        "zeroToolSideEffects": all(
            message.get("hasToolCalls") is False
            for message in visible_messages
        ),
    }
    failed = sorted(name for name, passed in assertions.items() if not passed)
    if failed:
        raise NormalSendError(
            "normal-send facts failed assertions: " + ", ".join(failed)
        )
    return assertions


def runtime_snapshot(
    client: FoundationRuntimeClient,
) -> Mapping[str, Any]:
    snapshot = client.harness("getRuntimeSnapshot", {}, timeout=30)
    require(isinstance(snapshot, Mapping), "runtime snapshot is invalid")
    return snapshot


def wait_for_active_stream(
    client: FoundationRuntimeClient,
) -> Mapping[str, Any] | None:
    snapshot = runtime_snapshot(client)
    operation = snapshot.get("operation")
    assistant = snapshot.get("assistant")
    if not isinstance(operation, Mapping) or not isinstance(assistant, Mapping):
        return None
    run_state = operation.get("runState")
    if run_state in {"completed", "failed", "cancelled", "interrupted"}:
        raise NormalSendError(
            f"turn reached {run_state} before a non-empty stream was observed"
        )
    if (
        run_state not in {"streaming", "reconciling"}
        or int(operation.get("lastEventSeq") or 0) <= 0
        or not str(assistant.get("content") or "")
    ):
        return None
    return snapshot


def wait_for_completed_turn(
    client: FoundationRuntimeClient,
    conversation_id: str,
) -> Mapping[str, Any] | None:
    snapshot = runtime_snapshot(client)
    operation = snapshot.get("operation")
    assistant = snapshot.get("assistant")
    if not isinstance(operation, Mapping) or not isinstance(assistant, Mapping):
        return None
    if operation.get("runState") in {"failed", "cancelled", "interrupted"}:
        raise NormalSendError(
            f"turn reached unexpected terminal {operation.get('runState')}"
        )
    if (
        operation.get("conversationId") != conversation_id
        or operation.get("runState") != "completed"
        or assistant.get("loading") is True
        or assistant.get("error")
        or not str(assistant.get("content") or "")
    ):
        return None
    return snapshot


def select_completed_projection(
    client: FoundationRuntimeClient,
    *,
    conversation_id: str,
    turn_id: str,
    content: str,
) -> Mapping[str, Any]:
    selected = client.harness(
        "selectFoundationConversation",
        {"conversationId": conversation_id},
        timeout=60,
    )
    require(
        isinstance(selected, Mapping)
        and selected.get("conversationId") == conversation_id,
        "conversation selection did not converge",
    )
    return wait_until(
        lambda: assistant_projection(
            runtime_snapshot(client),
            conversation_id=conversation_id,
            turn_id=turn_id,
            content=content,
        ),
        "completed assistant projection",
    )


def cleanup_clients(
    runtime_pair: FoundationRuntimePair,
) -> dict[str, Any]:
    result = runtime_pair.stop(remove_storage=False)
    fallback: list[dict[str, Any]] = []
    if result.get("status") != "clean":
        for mode in ("web", "app"):
            completed = subprocess.run(
                [
                    "node",
                    "tooling/devctl/index.mjs",
                    "desktop",
                    "stop",
                    "--mode",
                    mode,
                ],
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
    attestation_root = Path("/tmp") / f"mca-normal-send-{artifact_run_id}"
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
    primary_error: BaseException | None = None
    cleanup: dict[str, Any] = {
        "status": "clean",
        "conversationDeleted": False,
        "clients": None,
        "fixtureResetAfter": False,
        "provisionerResourcesReleased": [],
        "failures": [],
    }

    try:
        manifest = provisioner.provision(AGENT_V2_FOUNDATION_GATE)
        runtime_pair = FoundationRuntimePair.from_manifest(
            _build_client_manifest(manifest.to_dict()),
            profile_env=profile_env,
            startup_timeout=900,
        )
        client = runtime_pair.native
        client.start()
        _authenticate_clients(runtime_pair, profile_env, clients=(client,))

        sent = client.harness(
            "sendMessage",
            {
                "content": (
                    "Normal send baseline. Count from 1 through 100, "
                    "one number per line, with no other text."
                )
            },
            timeout=30,
        )
        require(
            isinstance(sent, Mapping) and sent.get("sent") is True,
            "normal-send submission failed",
        )
        active = wait_until(
            lambda: wait_for_active_stream(client),
            "non-empty sequenced stream",
        )
        operation = active["operation"]
        conversation_id = str(operation["conversationId"])
        turn_id = str(operation["turnId"])
        completed = wait_until(
            lambda: wait_for_completed_turn(client, conversation_id),
            "single completed turn",
        )
        content = str(completed["assistant"]["content"])
        station = client.harness(
            "getConversationReadback",
            {"conversationId": conversation_id},
            timeout=60,
        )
        require(isinstance(station, Mapping), "Station readback is invalid")

        client.driver.refresh()
        require(
            harness_ready(client.driver, namespace="agent", timeout=60),
            "Agent Harness did not recover after page reload",
        )
        _authenticate_clients(
            runtime_pair,
            profile_env,
            clients=(client,),
            require_existing_session=True,
            recovery_boundary="normal-send-page-reload",
        )
        reloaded = select_completed_projection(
            client,
            conversation_id=conversation_id,
            turn_id=turn_id,
            content=content,
        )

        client.restart()
        _authenticate_clients(
            runtime_pair,
            profile_env,
            clients=(client,),
            require_existing_session=True,
            recovery_boundary="normal-send-client-restart",
        )
        restarted = select_completed_projection(
            client,
            conversation_id=conversation_id,
            turn_id=turn_id,
            content=content,
        )
        final_station = client.harness(
            "getConversationReadback",
            {"conversationId": conversation_id},
            timeout=60,
        )
        client_messages = client.harness("getMessages", {}, timeout=30)
        require(
            isinstance(final_station, Mapping)
            and isinstance(client_messages, Mapping),
            "post-restart readback is invalid",
        )
        capture = {
            "active": active,
            "completed": completed,
            "reloaded": reloaded,
            "restarted": restarted,
            "station": final_station,
            "clientMessages": client_messages,
            "conversationId": conversation_id,
            "turnId": turn_id,
            "content": content,
        }
        capture["assertions"] = evaluate_normal_send(capture)

        conversation = final_station.get("conversation")
        require(
            isinstance(conversation, Mapping)
            and isinstance(conversation.get("version"), int),
            "conversation cleanup version is unavailable",
        )
        client.harness(
            "archiveFoundationConversation",
            {
                "conversationId": conversation_id,
                "expectedVersion": conversation["version"],
                "permanent": True,
            },
            timeout=60,
        )
        cleanup["conversationDeleted"] = True
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

    assertions = capture.get("assertions")
    if (
        primary_error is None
        and isinstance(assertions, Mapping)
        and all(assertions.values())
        and cleanup["conversationDeleted"] is True
        and cleanup["fixtureResetAfter"] is True
        and cleanup["status"] == "clean"
    ):
        result_name = "PASS"
    else:
        result_name = "FAIL"
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
        "assertions": assertions or {},
        "receiver": (
            {
                "assistantContentLength": len(str(capture.get("content") or "")),
                "assistantContentHash": sha256_text(
                    str(capture.get("content") or "")
                ),
            }
            if capture
            else {}
        ),
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
