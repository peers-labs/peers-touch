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
FIXTURE_CAPABILITY = "chat-attachment-desktop"


def _native_clients(context: ScenarioContext) -> tuple[str, ...]:
    manifest = context.require_runtime_manifest()
    selected = context.clients or tuple(sorted(manifest.clients))
    native_clients = tuple(
        client_id
        for client_id in selected
        if manifest.client(client_id).get("runtime_kind") == "native-tauri"
    )
    roles = {
        str(manifest.client(client_id).get("actor_role") or "")
        for client_id in native_clients
    }
    if len(native_clients) < 2 or not {"alice", "bob"}.issubset(roles):
        raise RunnerError(
            "chat-attachment-atomic requires attached Native Desktop "
            "Alice and Bob clients"
        )
    return native_clients


def execute_chat_attachment(
    context: ScenarioContext,
    *,
    workstream: str,
    fixture_capability: str = FIXTURE_CAPABILITY,
) -> Mapping[str, Any]:
    if context.runtime != "desktop":
        raise RunnerError("chat-attachment-atomic requires the desktop runtime")
    if context.profile is not None or set(context.profiles) != EXPECTED_PROFILES:
        raise RunnerError(
            "chat-attachment-atomic requires exactly --profiles four,fiveArm"
        )
    clients = _native_clients(context)

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
                f"chat-attachment-atomic {operation} outcome is invalid"
            )
        return outcome

    result = dict(
        ChatAttachmentCorpusDriver(
            platform="desktop",
            invoke_fixture=invoke,
        ).run()
    )
    result["clients"] = list(clients)
    result["profilesCovered"] = sorted(EXPECTED_PROFILES)
    return result


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    return execute_chat_attachment(context, workstream="W2")


SCENARIO = ScenarioDefinition(
    scenario_id="chat-attachment-atomic",
    journey_id="sc-dj-chat-attachment-atomic",
    work_item_id="secure-content-w2",
    runtimes=frozenset({"desktop"}),
    evidence_path=Path("W2/desktop/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W2"),
    result_task_id="W2",
    result_workstream_id="W2",
    result_variant="desktop",
)
