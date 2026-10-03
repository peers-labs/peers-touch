from __future__ import annotations

import hashlib
import time
from contextlib import ExitStack
from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.attached_client import (
    AttachedProductClient,
)
from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioContext,
    ScenarioDefinition,
)


EXPECTED_PROFILE = "four"
EXPECTED_CLIENTS = (
    "secure-content-desktop-alice",
    "secure-content-desktop-bob",
    "secure-content-desktop-eve",
)
EXPECTED_BUDGET_SECONDS = 1200
OBJECT_CASES = (
    (
        "IMAGE",
        "w8-object-image.png",
        b"\x89PNG\r\n\x1a\nw8-object-image",
    ),
    (
        "VIDEO",
        "w8-object-video.mp4",
        b"\x00\x00\x00\x18ftypmp42w8-object-video",
    ),
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RunnerError(message)


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RunnerError(f"social-object {field} is invalid")
    return value


def _sha256(value: bytes | str) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


def _require_runtime_binding(context: ScenarioContext) -> None:
    if context.runtime_manifest is None:
        context.block(
            "social-object requires an immutable runtime manifest",
            kind="DRIVER_FAILED",
            owner="secure-content-w8-runtime",
            retryable=True,
        )
    if context.runtime != "desktop":
        raise RunnerError("social-object requires the desktop runtime")
    if (
        context.profile != EXPECTED_PROFILE
        or context.profiles != (EXPECTED_PROFILE,)
    ):
        raise RunnerError("social-object requires exactly --profile four")
    if context.clients != EXPECTED_CLIENTS:
        raise RunnerError(
            "social-object requires exactly --clients "
            + ",".join(EXPECTED_CLIENTS)
        )
    if context.budget_seconds != EXPECTED_BUDGET_SECONDS:
        raise RunnerError("social-object requires exactly --budget-seconds 1200")
    manifest = context.require_runtime_manifest()
    for client_id, actor_role in zip(
        EXPECTED_CLIENTS,
        ("alice", "bob", "eve"),
    ):
        client = manifest.client(client_id)
        if (
            client.get("actor_role") != actor_role
            or client.get("runtime_kind") != "native-tauri"
        ):
            raise RunnerError(
                f"social-object client {client_id!r} must bind "
                f"{actor_role!r} to a Native Tauri runtime"
            )


def _publish(
    client: AttachedProductClient,
    payload: Mapping[str, Any],
    *,
    label: str,
) -> str:
    for attempt in range(3):
        result = _mapping(
            client.call("publishTypedPrivateMoment", payload),
            f"{label} publish",
        )
        if result.get("state") != "UNKNOWN_COMMIT":
            break
        if attempt < 2:
            time.sleep(min(0.25, client.context.remaining_seconds()))
    else:
        raise RunnerError(f"social-object {label} remained UNKNOWN_COMMIT")
    post_id = result.get("transientPostId")
    _require(
        result.get("state") == "PUBLISHED"
        and isinstance(post_id, str)
        and bool(post_id),
        f"social-object {label} did not publish",
    )
    return post_id


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    _require_runtime_binding(context)
    with ExitStack() as stack:
        alice = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[0])
        )
        bob = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[1])
        )
        eve = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[2])
        )
        artifacts: list[tuple[str, Path, bytes]] = []
        for kind, name, body in OBJECT_CASES:
            path = context.write_artifact_bytes(name, body, durable=False)
            stack.callback(path.unlink, missing_ok=True)
            artifacts.append((kind, path, body))

        observations: dict[str, Mapping[str, Any]] = {}
        for kind, path, expected_bytes in artifacts:
            text = f"secure-content-w8-object-{kind.lower()}"
            post_id = _publish(
                alice,
                {
                    "draftId": f"w8-object-{kind.lower()}",
                    "revision": 1,
                    "text": text,
                    "audienceKind": "FRIENDS",
                    "momentKind": kind,
                    "files": [{
                        "intentId": f"w8-object-{kind.lower()}",
                        "filePath": str(path),
                    }],
                },
                label=kind,
            )
            placeholder = _mapping(
                bob.call(
                    "readPrivateMoment",
                    {"postId": post_id, "openMedia": False},
                ),
                f"{kind} placeholder",
            )
            placeholder_media = placeholder.get("media")
            _require(
                placeholder.get("state") == "CONTENT_READY"
                and isinstance(placeholder_media, list)
                and len(placeholder_media) == 1
                and isinstance(placeholder_media[0], Mapping)
                and placeholder_media[0].get("state") == "MEDIA_PLACEHOLDER",
                f"social-object {kind} did not expose a bounded placeholder",
            )
            ready = _mapping(
                bob.call(
                    "readPrivateMoment",
                    {"postId": post_id, "openMedia": True},
                ),
                f"{kind} ready",
            )
            ready_media = ready.get("media")
            _require(
                ready.get("state") == "CONTENT_READY"
                and isinstance(ready_media, list)
                and len(ready_media) == 1
                and isinstance(ready_media[0], Mapping)
                and ready_media[0].get("state") == "MEDIA_READY"
                and ready_media[0].get("plaintextSha256")
                == _sha256(expected_bytes)
                and ready_media[0].get("byteLength")
                == len(expected_bytes),
                f"social-object {kind} receiver bytes differ",
            )
            denied = _mapping(
                eve.call(
                    "readPrivateMoment",
                    {"postId": post_id, "openMedia": True},
                ),
                f"{kind} denied",
            )
            _require(
                denied.get("state") == "NOT_FOUND_OR_NOT_AUTHORIZED"
                and denied.get("media") == [],
                f"social-object {kind} exposed media to Eve",
            )
            observations[kind.lower()] = {
                "placeholder": "MEDIA_PLACEHOLDER",
                "ready": "MEDIA_READY",
                "plaintextSha256": _sha256(expected_bytes),
                "unauthorized": "NOT_FOUND_OR_NOT_AUTHORIZED",
            }

        for client in (alice, bob, eve):
            client.call("clearLocalState")

    return {
        "objects": observations,
        "publicFallbackObserved": False,
        "failureStateCoverage": {
            "runtime": (
                "MEDIA_PLACEHOLDER",
                "MEDIA_READY",
                "NOT_FOUND_OR_NOT_AUTHORIZED",
            ),
            "sourceOnly": (
                "MEDIA_GRANT_PENDING",
                "MEDIA_DOWNLOADING",
                "MEDIA_DECRYPTING",
                "MEDIA_INTEGRITY_FAILURE",
                "MEDIA_OFFLINE_RETRYABLE",
            ),
        },
    }


SCENARIO = ScenarioDefinition(
    scenario_id="social-object",
    journey_id="sc-dj-social-expansion",
    work_item_id="secure-content-w8",
    runtimes=frozenset({"desktop"}),
    evidence_path=Path("W8/object/result.json"),
    execute=_execute,
    result_prefix=Path("W8"),
    result_task_id="W8",
    result_workstream_id="W8",
    result_variant="object",
)
