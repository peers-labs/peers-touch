"""Immutable command matrix for Secure Content platform runtime owners."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

from tooling.acceptance.core._paths import ENVIRONMENTS_DIR
from tooling.acceptance.provisioners.mobile_simulator import (
    SimulatorClientSpec,
)


CONTRACT_PATH = (
    ENVIRONMENTS_DIR / "secure-content-development-runtime.yaml"
)
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
RUNTIMES = frozenset({"desktop", "browser", "mobile"})
MOBILE_MATRIX_OPERATIONS = frozenset(
    {
        "publish-states",
        "read-states",
        "comment-states",
        "subtypes",
        "media-states",
        "lifecycle-bounds",
        "cross-platform-receivers",
    }
)
SINGLE_PLATFORM_MOBILE_OPERATIONS = (
    MOBILE_MATRIX_OPERATIONS - {"cross-platform-receivers"}
)
CHAT_ATTACHMENT_OPERATIONS = frozenset(
    {
        "prepare-corpus",
        "direct-exact-bytes",
        "group-exact-bytes",
        "upload-resume-boundary-1",
        "upload-resume-boundary-2",
        "download-resume-boundary-1",
        "download-resume-boundary-2",
        "failure-duplicate-conflict",
        "failure-invalid-range",
        "failure-etag-mismatch",
        "failure-ciphertext-hash-mismatch",
        "failure-plaintext-hash-mismatch",
        "failure-aead-failure",
        "restart-client",
        "restart-station",
        "fresh-recovery",
        "removed-actor",
        "secrecy-scan",
        "cleanup-corpus",
    }
)
SCENARIO_OPERATIONS = MappingProxyType(
    {
        "mobile-matrix": MOBILE_MATRIX_OPERATIONS,
        "hardcut-mobile-regression": SINGLE_PLATFORM_MOBILE_OPERATIONS,
        "final-mobile": SINGLE_PLATFORM_MOBILE_OPERATIONS,
        "chat-attachment-atomic": CHAT_ATTACHMENT_OPERATIONS,
        "chat-attachment-mobile": CHAT_ATTACHMENT_OPERATIONS,
        "chat-revalidation": CHAT_ATTACHMENT_OPERATIONS,
        "chat-revalidation-mobile": CHAT_ATTACHMENT_OPERATIONS,
        "hardcut-chat-regression": CHAT_ATTACHMENT_OPERATIONS,
        "hardcut-chat-mobile-regression": CHAT_ATTACHMENT_OPERATIONS,
        "final-chat": CHAT_ATTACHMENT_OPERATIONS,
        "final-chat-mobile": CHAT_ATTACHMENT_OPERATIONS,
        "hardcut-regression": frozenset({"full-social", "outer-uow"}),
        "final-desktop": frozenset({"full-social", "outer-uow"}),
        "hardcut-browser-regression": frozenset({"browser-boundary"}),
        "final-browser": frozenset({"browser-boundary"}),
    }
)


class PlatformRuntimeContractError(ValueError):
    pass


@dataclass(frozen=True)
class PlatformRuntimeCommand:
    action: str
    work_item_id: str
    task_id: str
    journey_id: str
    scenario_id: str
    runtime: str
    profiles: tuple[str, ...]
    clients: tuple[str, ...]
    fixture_capability: str
    fixture_operations: frozenset[str]
    budget_seconds: int

    @property
    def profile(self) -> str | None:
        return self.profiles[0] if len(self.profiles) == 1 else None

    @property
    def mobile_clients(self) -> tuple[SimulatorClientSpec, ...]:
        if self.runtime != "mobile":
            return ()
        result: list[SimulatorClientSpec] = []
        for client_id in self.clients:
            platform = _mobile_platform(client_id)
            role = client_id.rsplit("-", 1)[-1]
            if "_" in client_id:
                role = client_id.rsplit("_", 1)[-1]
            result.append(
                SimulatorClientSpec(
                    id=client_id,
                    platform=platform,
                    role=role,
                    runtime=(
                        "tauri-ios-simulator"
                        if platform == "ios"
                        else "tauri-android-emulator"
                    ),
                    port_roles=(
                        ("wda-local", "mjpeg", "webview")
                        if platform == "ios"
                        else ("system", "mjpeg", "webview")
                    ),
                    storage_root=(
                        "<runtime-home>/secure-content/"
                        f"<run-id>/{client_id}"
                    ),
                )
            )
        return tuple(result)


@dataclass(frozen=True)
class PlatformRuntimeContract:
    controller_profile: str
    controller_slot: int
    commands: Mapping[str, PlatformRuntimeCommand]
    mobile_harness_actions: tuple[str, ...]
    cleanup_order: tuple[str, ...]

    def command(self, action: str) -> PlatformRuntimeCommand:
        try:
            return self.commands[action]
        except KeyError as error:
            raise PlatformRuntimeContractError(
                f"unsupported platform runtime owner action: {action}"
            ) from error


def load_platform_runtime_contract(
    path: Path = CONTRACT_PATH,
) -> PlatformRuntimeContract:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PlatformRuntimeContractError(
            f"cannot load platform runtime owner contract: {error}"
        ) from error
    if (
        not isinstance(payload, dict)
        or payload.get("id") != "secure-content-development-runtime"
        or payload.get("schema_version") != 1
        or payload.get("base_environment") != "mobile-simulator"
    ):
        raise PlatformRuntimeContractError(
            "platform runtime owner contract identity is invalid"
        )
    controller = _mapping(payload.get("controller_binding"), "controller")
    if controller != {"profile_id": "four", "slot": 5}:
        raise PlatformRuntimeContractError(
            "platform runtime owner controller binding is invalid"
        )
    raw_operations = _mapping(
        payload.get("fixture_operations"),
        "fixture_operations",
    )
    operations: dict[str, frozenset[str]] = {}
    for capability, raw_items in raw_operations.items():
        _identifier(capability, "fixture capability")
        items = _string_tuple(raw_items, f"{capability} operations")
        if len(items) != len(set(items)):
            raise PlatformRuntimeContractError(
                f"{capability} operations contain duplicates"
            )
        operations[capability] = frozenset(items)

    raw_commands = _mapping(payload.get("commands"), "commands")
    commands: dict[str, PlatformRuntimeCommand] = {}
    for action, raw_command in raw_commands.items():
        _identifier(action, "command action")
        command = _mapping(raw_command, f"command {action}")
        expected_fields = {
            "work_item_id",
            "task_id",
            "journey_id",
            "scenario_id",
            "runtime",
            "profiles",
            "clients",
            "fixture_capability",
            "budget_seconds",
        }
        if set(command) != expected_fields:
            raise PlatformRuntimeContractError(
                f"platform runtime command {action!r} has an invalid shape"
            )
        runtime = _identifier(command["runtime"], f"{action} runtime")
        if runtime not in RUNTIMES:
            raise PlatformRuntimeContractError(
                f"platform runtime command {action!r} has an invalid runtime"
            )
        profiles = _string_tuple(command["profiles"], f"{action} profiles")
        if (
            not profiles
            or set(profiles) - {"four", "fiveArm"}
            or len(profiles) != len(set(profiles))
        ):
            raise PlatformRuntimeContractError(
                f"platform runtime command {action!r} has invalid profiles"
            )
        clients = _string_tuple(command["clients"], f"{action} clients")
        if not clients or len(clients) != len(set(clients)):
            raise PlatformRuntimeContractError(
                f"platform runtime command {action!r} has invalid clients"
            )
        fixture_capability = _identifier(
            command["fixture_capability"],
            f"{action} fixture capability",
        )
        capability_operations = operations.get(fixture_capability)
        scenario_id = _identifier(
            command["scenario_id"],
            f"{action} scenario",
        )
        fixture_operations = SCENARIO_OPERATIONS.get(scenario_id)
        if (
            not capability_operations
            or not fixture_operations
            or not fixture_operations.issubset(capability_operations)
        ):
            raise PlatformRuntimeContractError(
                f"{action} has an incomplete fixture operation contract"
            )
        budget_seconds = command["budget_seconds"]
        if (
            not isinstance(budget_seconds, int)
            or isinstance(budget_seconds, bool)
            or budget_seconds <= 0
        ):
            raise PlatformRuntimeContractError(
                f"platform runtime command {action!r} has an invalid budget"
            )
        if runtime == "mobile":
            for client_id in clients:
                _mobile_platform(client_id)
        commands[action] = PlatformRuntimeCommand(
            action=action,
            work_item_id=_identifier(
                command["work_item_id"],
                f"{action} work item",
            ),
            task_id=_identifier(command["task_id"], f"{action} task"),
            journey_id=_identifier(
                command["journey_id"],
                f"{action} journey",
            ),
            scenario_id=scenario_id,
            runtime=runtime,
            profiles=profiles,
            clients=clients,
            fixture_capability=fixture_capability,
            fixture_operations=fixture_operations,
            budget_seconds=budget_seconds,
        )
    required_actions = {
        "run-w9-ios",
        "run-w9-android",
        "run-w9-cross-platform",
        "run-w2-desktop",
        "run-w2-ios",
        "run-w2-android",
        "run-w10-desktop",
        "run-w10-ios",
        "run-w10-android",
        "run-w11-desktop",
        "run-w11-browser",
        "run-w11-ios",
        "run-w11-android",
        "run-w11-chat-desktop",
        "run-w11-chat-ios",
        "run-w11-chat-android",
        "run-final-desktop",
        "run-final-browser",
        "run-final-ios",
        "run-final-android",
        "run-final-chat-desktop",
        "run-final-chat-ios",
        "run-final-chat-android",
    }
    if set(commands) != required_actions:
        raise PlatformRuntimeContractError(
            "platform runtime owner command closure is incomplete"
        )
    harness_actions = _string_tuple(
        payload.get("mobile_harness_actions"),
        "mobile_harness_actions",
    )
    required_harness_actions = {
        "build.identity",
        "station.add",
        "access.submit",
        "lifecycle.scope.read",
        "moments.private.publish",
        "moments.private.read",
        "moments.private.snapshot",
        "messaging.attachment.stage",
        "messaging.attachment.open",
        "messaging.send",
        "messaging.projection.read",
        "cleanup",
    }
    if not required_harness_actions.issubset(harness_actions):
        raise PlatformRuntimeContractError(
            "platform runtime owner production Harness closure is incomplete"
        )
    cleanup = _mapping(payload.get("cleanup"), "cleanup")
    cleanup_order = _string_tuple(cleanup.get("order"), "cleanup order")
    if (
        cleanup.get("deterministic") is not True
        or cleanup_order[:2] != ("appium-sessions", "appium-process")
    ):
        raise PlatformRuntimeContractError(
            "platform runtime owner cleanup contract is invalid"
        )
    return PlatformRuntimeContract(
        controller_profile=str(controller["profile_id"]),
        controller_slot=int(controller["slot"]),
        commands=MappingProxyType(commands),
        mobile_harness_actions=harness_actions,
        cleanup_order=cleanup_order,
    )


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise PlatformRuntimeContractError(f"{field} must be an object")
    return value


def _identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or IDENTIFIER.fullmatch(value) is None:
        raise PlatformRuntimeContractError(f"{field} is invalid")
    return value


def _string_tuple(value: Any, field: str) -> tuple[str, ...]:
    if (
        not isinstance(value, list)
        or not value
        or any(
            not isinstance(item, str)
            or not item
            or item != item.strip()
            for item in value
        )
    ):
        raise PlatformRuntimeContractError(
            f"{field} must be a non-empty string array"
        )
    return tuple(value)


def _mobile_platform(client_id: str) -> str:
    if client_id.startswith(("ios_", "secure-content-ios-", "secure-content-hardcut-ios-")):
        return "ios"
    if client_id.startswith(
        ("android_", "secure-content-android-", "secure-content-hardcut-android-")
    ):
        return "android"
    raise PlatformRuntimeContractError(
        f"mobile client {client_id!r} has no platform identity"
    )
