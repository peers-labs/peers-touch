from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioContext,
    ScenarioDefinition,
)


EXPECTED_PROFILE = "four"
FIXTURE_CAPABILITY = "secure-content-mobile-matrix"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
PLATFORM_CLIENTS = {
    "ios": frozenset({"ios_alice", "ios_bob", "ios_eve"}),
    "android": frozenset(
        {"android_alice", "android_bob", "android_eve"}
    ),
    "cross-platform": frozenset(
        {"ios_alice", "ios_bob", "android_alice", "android_bob"}
    ),
}
RUNTIME_KINDS = {
    "ios": frozenset({"tauri-ios-simulator"}),
    "android": frozenset({"tauri-android-emulator"}),
    "cross-platform": frozenset(
        {"tauri-ios-simulator", "tauri-android-emulator"}
    ),
}
PLATFORM_OPERATIONS = {
    "publish-states": frozenset(
        {
            "AUDIENCE_REQUIRED",
            "CHECKING_PRIVATE_READINESS",
            "READY_PUBLIC",
            "READY_PRIVATE",
            "PRIVATE_UNSUPPORTED",
            "RECIPIENT_KEY_UNAVAILABLE",
            "AUDIENCE_TOO_LARGE",
            "PUBLISHING",
            "PUBLISHED",
            "PUBLISH_FAILED",
        }
    ),
    "read-states": frozenset(
        {
            "LOADING_AUTHORIZED_RESOURCE",
            "WAITING_FOR_PRIVATE_KEY",
            "RECOVERY_REQUIRED",
            "RECOVERY_KEY_UNAVAILABLE",
            "DECRYPTING",
            "CONTENT_READY",
            "AUTHENTICATION_REQUIRED",
            "NOT_FOUND_OR_NOT_AUTHORIZED",
            "INTEGRITY_FAILURE",
            "PRIVATE_UNSUPPORTED_ON_DEVICE",
            "DELETED_OR_REVOKED",
        }
    ),
    "comment-states": frozenset(
        {
            "COMMENT_EDITING",
            "COMMENT_ENCRYPTING",
            "COMMENT_SUBMITTING",
            "COMMENT_POSTED",
            "COMMENT_FAILED",
            "COMMENT_RATE_LIMITED",
            "COMMENT_PARENT_UNAVAILABLE",
        }
    ),
    "subtypes": frozenset(
        {
            "TEXT",
            "IMAGE",
            "VIDEO",
            "POLL",
            "REPOST",
            "MENTION",
            "REACTION",
            "LINK",
            "LOCATION",
        }
    ),
    "media-states": frozenset(
        {
            "MEDIA_PLACEHOLDER",
            "MEDIA_GRANT_PENDING",
            "MEDIA_DOWNLOADING",
            "MEDIA_DECRYPTING",
            "MEDIA_READY",
            "MEDIA_ACCESS_DENIED",
            "MEDIA_INTEGRITY_FAILURE",
            "MEDIA_OFFLINE_RETRYABLE",
        }
    ),
    "lifecycle-bounds": frozenset(
        {
            "RESTART",
            "RECOVERY",
            "CANCEL",
            "TIMEOUT",
            "ACCOUNT_SWITCH",
            "DELETE",
            "BLOCK",
            "STORAGE_FULL",
            "OVERLOAD",
            "OBJECT_ATTACH_REPLAY",
            "OBJECT_ATTACH_CONFLICT",
            "GC_CLEANUP_RETRY",
        }
    ),
}
CROSS_PLATFORM_DIRECTIONS = frozenset(
    {"ios-to-android", "android-to-ios"}
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RunnerError(message)


def _variant_for_clients(
    runtime: str,
    clients: tuple[str, ...],
    *,
    platform_clients: Mapping[str, frozenset[str]] = PLATFORM_CLIENTS,
) -> str:
    if runtime != "mobile":
        raise RunnerError("mobile-matrix requires the mobile runtime")
    selected = frozenset(clients)
    variant = next(
        (
            name
            for name, expected_clients in platform_clients.items()
            if selected == expected_clients
        ),
        None,
    )
    if variant is None:
        raise RunnerError(
            "mobile-matrix requires exactly one declared iOS, Android, "
            "or cross-platform client set"
        )
    return variant


def _result_variant(
    runtime: str,
    _profile: str | None,
    _profiles: tuple[str, ...],
    clients: tuple[str, ...],
) -> str:
    return _variant_for_clients(runtime, clients)


def _require_runtime_binding(
    context: ScenarioContext,
    *,
    platform_clients: Mapping[str, frozenset[str]],
    runtime_kinds: Mapping[str, frozenset[str]],
) -> str:
    if (
        context.profile != EXPECTED_PROFILE
        or context.profiles != (EXPECTED_PROFILE,)
    ):
        raise RunnerError("mobile-matrix requires exactly --profile four")
    variant = _variant_for_clients(
        context.runtime,
        context.clients,
        platform_clients=platform_clients,
    )
    manifest = context.require_runtime_manifest()
    observed_runtime_kinds: set[str] = set()
    for client_id in sorted(context.clients):
        client = manifest.client(client_id)
        role = str(client.get("actor_role") or "")
        expected_role = re.split(r"[-_]", client_id)[-1]
        runtime_kind = str(client.get("runtime_kind") or "")
        _require(
            role == expected_role,
            f"mobile-matrix client {client_id!r} has the wrong actor role",
        )
        _require(
            runtime_kind in runtime_kinds[variant],
            f"mobile-matrix client {client_id!r} has the wrong runtime kind",
        )
        _, station = manifest.service_for_client(client_id, "station")
        _require(
            station.get("profile_id") == EXPECTED_PROFILE,
            f"mobile-matrix client {client_id!r} is not bound to profile four",
        )
        observed_runtime_kinds.add(runtime_kind)
    _require(
        observed_runtime_kinds == runtime_kinds[variant],
        "mobile-matrix runtime-kind coverage is incomplete",
    )
    return variant


def _require_digests(value: Any, label: str) -> tuple[str, ...]:
    _require(isinstance(value, list) and bool(value), f"{label} is missing")
    digests = tuple(str(item) for item in value)
    _require(
        all(SHA256.fullmatch(item) is not None for item in digests),
        f"{label} contains an invalid digest",
    )
    _require(len(set(digests)) == len(digests), f"{label} contains duplicates")
    return digests


def _invoke(
    context: ScenarioContext,
    *,
    workstream: str,
    fixture_capability: str,
    variant: str,
    operation: str,
) -> Mapping[str, Any]:
    acknowledgement = context.invoke_fixture_action(
        fixture_capability,
        operation,
        {
            "workstream": workstream,
            "variant": variant,
            "clients": list(context.clients),
        },
    )
    outcome = acknowledgement.get("outcome")
    if not isinstance(outcome, Mapping):
        raise RunnerError(f"mobile-matrix {operation} outcome is invalid")
    _require(
        outcome.get("completed") is True,
        f"mobile-matrix {operation} did not complete",
    )
    _require(
        outcome.get("variant") == variant,
        f"mobile-matrix {operation} variant is invalid",
    )
    _require(
        outcome.get("partialPlaintextBytes") == 0,
        f"mobile-matrix {operation} exposed partial plaintext",
    )
    _require(
        outcome.get("publicFallbackUsed") is False,
        f"mobile-matrix {operation} used a PUBLIC fallback",
    )
    _require_digests(
        outcome.get("receiverObservationDigests"),
        f"mobile-matrix {operation} receiver observations",
    )
    return outcome


def execute_mobile_matrix(
    context: ScenarioContext,
    *,
    workstream: str,
    fixture_capability: str = FIXTURE_CAPABILITY,
    platform_clients: Mapping[str, frozenset[str]] = PLATFORM_CLIENTS,
    runtime_kinds: Mapping[str, frozenset[str]] = RUNTIME_KINDS,
) -> Mapping[str, Any]:
    variant = _require_runtime_binding(
        context,
        platform_clients=platform_clients,
        runtime_kinds=runtime_kinds,
    )
    observations: dict[str, Any] = {}
    if variant == "cross-platform":
        outcome = _invoke(
            context,
            workstream=workstream,
            fixture_capability=fixture_capability,
            variant=variant,
            operation="cross-platform-receivers",
        )
        _require(
            frozenset(outcome.get("directions", ()))
            == CROSS_PLATFORM_DIRECTIONS,
            "mobile-matrix cross-platform directions are incomplete",
        )
        _require(
            outcome.get("exactContentMatch") is True
            and outcome.get("portableCoreShared") is True,
            "mobile-matrix cross-platform receiver proof is incomplete",
        )
        observations["cross-platform-receivers"] = {
            "directions": sorted(CROSS_PLATFORM_DIRECTIONS),
            "receiverObservationDigests": list(
                _require_digests(
                    outcome.get("receiverObservationDigests"),
                    "mobile-matrix cross-platform receiver observations",
                )
            ),
        }
    else:
        for operation, expected_states in PLATFORM_OPERATIONS.items():
            outcome = _invoke(
                context,
                workstream=workstream,
                fixture_capability=fixture_capability,
                variant=variant,
                operation=operation,
            )
            _require(
                frozenset(outcome.get("observedStates", ()))
                == expected_states,
                f"mobile-matrix {variant}/{operation} state coverage is incomplete",
            )
            observations[operation] = {
                "observedStates": sorted(expected_states),
                "receiverObservationDigests": list(
                    _require_digests(
                        outcome.get("receiverObservationDigests"),
                        (
                            f"mobile-matrix {variant}/{operation} "
                            "receiver observations"
                        ),
                    )
                ),
            }
    return {
        "platformVariant": variant,
        "observations": observations,
        "claimBoundary": {
            "productJourney": context.journey_id,
            "formalAcceptance": "NOT_RUN",
        },
    }


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    return execute_mobile_matrix(context, workstream="W9")


SCENARIO = ScenarioDefinition(
    scenario_id="mobile-matrix",
    journey_id="sc-dj-mobile-matrix",
    work_item_id="secure-content-w9",
    runtimes=frozenset({"mobile"}),
    evidence_path=Path("W9/mobile/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W9"),
    result_task_id="W9",
    result_workstream_id="W9",
    result_variant=_result_variant,
)
