from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.drivers.chat_attachment import (
    ChatAttachmentCorpusDriver,
)
from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioContext,
    ScenarioDefinition,
)


EXPECTED_PROFILES = frozenset({"four", "fiveArm"})
PLATFORM_CLIENTS = {
    "ios": frozenset({"ios_alice", "ios_bob"}),
    "android": frozenset({"android_alice", "android_bob"}),
}
PLATFORM_RUNTIME_KINDS = {
    "ios": "tauri-ios-simulator",
    "android": "tauri-android-emulator",
}
FIXTURE_CAPABILITY = "chat-attachment-mobile"


def _platform_for_clients(
    runtime: str,
    clients: tuple[str, ...],
    *,
    platform_clients: Mapping[str, frozenset[str]] = PLATFORM_CLIENTS,
) -> str:
    if runtime != "mobile":
        raise RunnerError("chat-attachment-mobile requires the mobile runtime")
    selected = frozenset(clients)
    platform = next(
        (
            name
            for name, client_ids in platform_clients.items()
            if selected == client_ids
        ),
        None,
    )
    if platform is None:
        raise RunnerError(
            "chat-attachment-mobile requires exactly one iOS or Android "
            "Alice/Bob client pair"
        )
    return platform


def _result_variant(
    runtime: str,
    _profile: str | None,
    _profiles: tuple[str, ...],
    clients: tuple[str, ...],
) -> str:
    return _platform_for_clients(runtime, clients)


def _mobile_platform(
    context: ScenarioContext,
    *,
    platform_clients: Mapping[str, frozenset[str]] = PLATFORM_CLIENTS,
    runtime_kinds: Mapping[str, str] = PLATFORM_RUNTIME_KINDS,
) -> str:
    if context.profile is not None or set(context.profiles) != EXPECTED_PROFILES:
        raise RunnerError(
            "chat-attachment-mobile requires exactly --profiles four,fiveArm"
        )
    platform = _platform_for_clients(
        context.runtime,
        context.clients,
        platform_clients=platform_clients,
    )
    manifest = context.require_runtime_manifest()
    expected_runtime_kind = runtime_kinds[platform]
    for client_id in sorted(context.clients):
        expected_role = "alice" if client_id.endswith("_alice") else "bob"
        client = manifest.client(client_id)
        if (
            client.get("runtime_kind") != expected_runtime_kind
            or client.get("actor_role") != expected_role
        ):
            raise RunnerError(
                f"chat-attachment-mobile client {client_id!r} does not bind "
                f"{expected_role!r} to {expected_runtime_kind!r}"
            )
    return platform


def execute_chat_attachment_mobile(
    context: ScenarioContext,
    *,
    workstream: str,
    fixture_capability: str = FIXTURE_CAPABILITY,
    platform_clients: Mapping[str, frozenset[str]] = PLATFORM_CLIENTS,
    runtime_kinds: Mapping[str, str] = PLATFORM_RUNTIME_KINDS,
) -> Mapping[str, Any]:
    platform = _mobile_platform(
        context,
        platform_clients=platform_clients,
        runtime_kinds=runtime_kinds,
    )
    clients = tuple(sorted(context.clients))

    def invoke(operation: str, payload: Mapping[str, object]) -> Mapping[str, Any]:
        acknowledgement = context.invoke_fixture_action(
            fixture_capability,
            operation,
            {
                "workstream": workstream,
                "clients": list(clients),
                **dict(payload),
            },
        )
        outcome = acknowledgement.get("outcome")
        if not isinstance(outcome, Mapping):
            raise RunnerError(
                f"chat-attachment-mobile {operation} outcome is invalid"
            )
        return outcome

    result = dict(
        ChatAttachmentCorpusDriver(
            platform=platform,
            invoke_fixture=invoke,
        ).run()
    )
    result["clients"] = list(clients)
    result["profilesCovered"] = sorted(EXPECTED_PROFILES)
    return result


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    return execute_chat_attachment_mobile(context, workstream="W2")


SCENARIO = ScenarioDefinition(
    scenario_id="chat-attachment-mobile",
    journey_id="sc-dj-chat-attachment-mobile",
    work_item_id="secure-content-w2b-mobile",
    runtimes=frozenset({"mobile"}),
    evidence_path=Path("W2/mobile/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W2"),
    result_task_id="W2",
    result_workstream_id="W2",
    result_variant=_result_variant,
)
