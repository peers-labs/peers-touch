from __future__ import annotations

import base64
import hashlib
import urllib.error
import urllib.request
from contextlib import ExitStack
from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.attached_client import (
    AttachedProductClient,
    reconcile_private_moment_publish,
)
from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioContext,
    ScenarioDefinition,
)


EXPECTED_PROFILES = ("four", "fiveArm")
EXPECTED_CLIENTS = (
    "secure-content-desktop-alice",
    "secure-content-desktop-bob",
    "secure-content-desktop-eve",
)
EXPECTED_BUDGET_SECONDS = 1200
REQUIRED_FIXTURE_CAPABILITIES = frozenset(
    {
        "account-switch",
        "station-switch",
        "publisher-device-revocation",
        "historical-recovery-epoch",
    }
)
PUBLIC_TEXT = "secure-content-w7-browser-public"
PRIVATE_TEXT = "secure-content-w7-friends-image"
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
DIAGNOSTIC_TOKEN_CHARS = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RunnerError(message)


def _diagnostic_token(value: Any) -> str:
    if not isinstance(value, str) or not value:
        return "<missing>"
    if len(value) > 64 or any(
        char not in DIAGNOSTIC_TOKEN_CHARS for char in value
    ):
        return "<redacted>"
    return value


def _require_projection_state(
    projection: Mapping[str, Any],
    expected: str,
    message: str,
) -> None:
    if projection.get("state") == expected:
        return
    raise RunnerError(
        f"{message} "
        f"(state={_diagnostic_token(projection.get('state'))}; "
        f"errorCode={_diagnostic_token(projection.get('errorCode'))})"
    )


def _sha256(value: bytes | str) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RunnerError(f"desktop-pilot {field} is invalid")
    return value


def _fixture_action(
    context: ScenarioContext,
    capability: str,
    operation: str,
) -> Mapping[str, Any]:
    acknowledgement = context.invoke_fixture_action(capability, operation)
    outcome = _mapping(
        acknowledgement.get("outcome"),
        f"{capability} fixture acknowledgement",
    )
    _require(
        outcome.get("completed") is True,
        f"desktop-pilot {capability} fixture action did not complete",
    )
    return outcome


def _station_url(context: ScenarioContext, client_id: str) -> str:
    manifest = context.require_runtime_manifest()
    _, station = manifest.service_for_client(client_id, "station")
    endpoint = station.get("endpoint")
    if not isinstance(endpoint, str) or not endpoint.startswith(("http://", "https://")):
        raise RunnerError("desktop-pilot Station endpoint is invalid")
    return endpoint.rstrip("/")


def _resume_artifact(context: ScenarioContext) -> Path:
    return context.artifact_path("desktop-pilot-resume.json")


def _load_resume_artifact(
    context: ScenarioContext,
) -> Mapping[str, Any] | None:
    path = _resume_artifact(context)
    if not path.is_file():
        return None
    payload = context.consume_owner_continuation(
        path,
        client_id=EXPECTED_CLIENTS[1],
        kind="secure-content-desktop-pilot-resume",
        producer_scenario_id="desktop-pilot",
        producer_journey_id="sc-dj-desktop-pilot",
        producer_runtime="desktop",
    )
    post_id = payload.get("postId") if isinstance(payload, dict) else None
    if (
        not isinstance(payload.get("bobRuntimeIdentitySha256"), str)
        or len(payload["bobRuntimeIdentitySha256"]) != 64
        or not isinstance(post_id, str)
        or not post_id
        or payload.get("postIdSha256") != _sha256(post_id)
        or payload.get("textSha256") != _sha256(PRIVATE_TEXT)
        or payload.get("mediaSha256") != _sha256(PNG_BYTES)
        or payload.get("publicTextSha256") != _sha256(PUBLIC_TEXT)
        or payload.get("publicMediaSha256") != _sha256(PNG_BYTES)
    ):
        raise RunnerError("desktop-pilot resume artifact identity is invalid")
    return payload


def _invalid_token_status(station_url: str, post_id: str) -> int:
    request = urllib.request.Request(
        f"{station_url}/api/v1/social/moments/{post_id}",
        headers={
            "Accept": "application/x-protobuf",
            "Authorization": "Bearer invalid-secure-content-token",
            "X-Device-ID": "invalid-secure-content-device",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (OSError, TimeoutError) as error:
        raise RunnerError("desktop-pilot invalid-token probe failed") from error


def _require_runtime_binding(context: ScenarioContext) -> None:
    if context.runtime_manifest is None:
        context.block(
            "desktop-pilot requires an immutable external runtime manifest",
            kind="DRIVER_FAILED",
            owner="secure-content-w7-runtime",
            retryable=True,
        )
    if context.runtime != "desktop":
        raise RunnerError("desktop-pilot requires the desktop runtime")
    if context.profile is not None or set(context.profiles) != set(EXPECTED_PROFILES):
        raise RunnerError(
            "desktop-pilot requires exactly --profiles four,fiveArm"
        )
    if context.clients != EXPECTED_CLIENTS:
        raise RunnerError(
            "desktop-pilot requires exactly --clients "
            + ",".join(EXPECTED_CLIENTS)
        )
    if context.budget_seconds != EXPECTED_BUDGET_SECONDS:
        raise RunnerError(
            "desktop-pilot requires exactly --budget-seconds 1200"
        )
    manifest = context.require_runtime_manifest()
    expected_bindings = {
        EXPECTED_CLIENTS[0]: ("alice", "native-tauri"),
        EXPECTED_CLIENTS[1]: ("bob", "native-tauri"),
        EXPECTED_CLIENTS[2]: ("eve", "native-tauri"),
    }
    for client_id, (actor_role, runtime_kind) in expected_bindings.items():
        client = manifest.client(client_id)
        if (
            client.get("actor_role") != actor_role
            or client.get("runtime_kind") != runtime_kind
        ):
            raise RunnerError(
                f"desktop-pilot client {client_id!r} must bind actor role "
                f"{actor_role!r} and runtime kind {runtime_kind!r}"
            )


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    _require_runtime_binding(context)
    resume = _load_resume_artifact(context)
    if resume is not None:
        with AttachedProductClient(context, EXPECTED_CLIENTS[1]) as bob:
            snapshot = _mapping(bob.snapshot(), "restarted Bob snapshot")
            _require(
                snapshot.get("platform") == "native",
                "desktop-pilot restarted Bob is not a Native client",
            )
            restarted_identity = snapshot.get("nativeRuntimeIdentitySha256")
            _require(
                isinstance(restarted_identity, str)
                and len(restarted_identity) == 64
                and restarted_identity != resume["bobRuntimeIdentitySha256"],
                "desktop-pilot Bob Native process identity did not change",
            )
            bob_restarted = _mapping(
                bob.call(
                    "readPrivateMoment",
                    {
                        "postId": resume["postId"],
                        "openMedia": True,
                    },
                ),
                "Bob post-restart private read",
            )
            media = bob_restarted.get("media")
            _require(
                bob_restarted.get("state") == "CONTENT_READY"
                and bob_restarted.get("textSha256") == _sha256(PRIVATE_TEXT),
                "Bob private Moment did not survive Native client restart",
            )
            _require(
                isinstance(media, list)
                and len(media) == 1
                and isinstance(media[0], Mapping)
                and media[0].get("state") == "MEDIA_READY"
                and media[0].get("plaintextSha256") == _sha256(PNG_BYTES),
                "Bob private image did not survive Native client restart",
            )
            recovery = _fixture_action(
                context,
                "historical-recovery-epoch",
                "advance",
            )
            _require(
                isinstance(recovery.get("previousEpoch"), int)
                and recovery.get("currentEpoch")
                == int(recovery["previousEpoch"]) + 1,
                "historical recovery fixture did not advance exactly one epoch",
            )
            historical_read = _mapping(
                bob.call(
                    "recoverPrivateMoment",
                    {
                        "postId": resume["postId"],
                        "openMedia": True,
                    },
                ),
                "Bob historical-epoch private read",
            )
            _require(
                historical_read.get("state") == "CONTENT_READY"
                and historical_read.get("textSha256") == _sha256(PRIVATE_TEXT),
                "Bob could not reopen content from the prior recovery epoch",
            )
            bob.call("clearLocalState")

        station_switch = _fixture_action(
            context,
            "station-switch",
            "round-trip",
        )
        publisher_revoke = _fixture_action(
            context,
            "publisher-device-revocation",
            "revoke",
        )
        account_switch = _fixture_action(
            context,
            "account-switch",
            "round-trip",
        )
        _require(
            account_switch.get("sessionGenerationAdvanced") is True,
            "account-switch fixture did not advance the session generation",
        )

        context.write_bound_artifact_json(
            "browser-private-handoff.json",
            "secure-content-browser-private-handoff",
            {
                "postId": resume["postId"],
                "postIdSha256": resume["postIdSha256"],
                "publicTextSha256": resume["publicTextSha256"],
                "publicMediaSha256": resume["publicMediaSha256"],
                "textSha256": resume["textSha256"],
            },
        )
        return {
            "observations": {
                "alicePublished": True,
                "bobExactText": True,
                "bobExactMediaBytes": True,
                "bobNativeProcessRestartRead": True,
                "historicalRecoveryEpochRead": True,
                "accountSwitchRoundTrip": account_switch.get("completed"),
                "stationSwitchRoundTrip": station_switch.get("completed"),
                "publisherDeviceRevoked": publisher_revoke.get("completed"),
                "eveDenied": True,
                "invalidCredentialStatus": 401,
            },
            "contentDigests": {
                "textSha256": _sha256(PRIVATE_TEXT),
                "mediaSha256": _sha256(PNG_BYTES),
            },
            "claimBoundary": {
                "formalAcceptance": "NOT_RUN",
            },
        }

    fixture_path = context.write_artifact_bytes(
        "desktop-private-fixture.png",
        PNG_BYTES,
        durable=False,
    )

    draft_id = (
        "w7-desktop-"
        + context.require_runtime_manifest().sha256[:20]
    )
    with ExitStack() as stack:
        stack.callback(fixture_path.unlink, missing_ok=True)
        alice = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[0])
        )
        bob = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[1])
        )
        eve = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[2])
        )

        bob_runtime_identity = ""
        for client, actor in ((alice, "alice"), (bob, "bob"), (eve, "eve")):
            snapshot = _mapping(client.snapshot(), f"{actor} snapshot")
            _require(
                snapshot.get("platform") == "native",
                f"desktop-pilot {actor} is not a Native client",
            )
            runtime_identity = snapshot.get("nativeRuntimeIdentitySha256")
            _require(
                isinstance(runtime_identity, str)
                and len(runtime_identity) == 64,
                f"desktop-pilot {actor} Native process identity is missing",
            )
            if actor == "bob":
                bob_runtime_identity = runtime_identity

        public_publish = _mapping(
            alice.call(
                "publishPublicMoment",
                {
                    "text": PUBLIC_TEXT,
                    "filePath": str(fixture_path),
                },
            ),
            "Alice public control publish",
        )
        _require(
            public_publish.get("published") is True
            and public_publish.get("mediaCount") == 1
            and public_publish.get("textSha256") == _sha256(PUBLIC_TEXT),
            "Alice PUBLIC image control did not publish",
        )

        staged = _mapping(
            alice.call(
                "stageFriendsDraft",
                {
                    "draftId": draft_id,
                    "revision": 1,
                    "text": PRIVATE_TEXT,
                    "files": [{
                        "intentId": "w7-image-1",
                        "filePath": str(fixture_path),
                    }],
                },
            ),
            "Alice staged draft",
        )
        _require(staged.get("present") is True, "Alice draft was not retained")
        _require(
            staged.get("textSha256") == _sha256(PRIVATE_TEXT),
            "Alice staged draft text digest differs",
        )
        _require(staged.get("fileCount") == 1, "Alice image draft is incomplete")

        published = _mapping(
            reconcile_private_moment_publish(
                alice,
                "publishFriendsDraft",
                label="Alice private Moment publish",
            ),
            "Alice publish result",
        )
        _require(
            published.get("state") == "PUBLISHED",
            "Alice private Moment did not reach PUBLISHED",
        )
        post_id = published.get("transientPostId")
        _require(
            isinstance(post_id, str) and bool(post_id),
            "Alice publish did not return a transient post identity",
        )

        bob_read = _mapping(
            bob.call(
                "readPrivateMoment",
                {"postId": post_id, "openMedia": True},
            ),
            "Bob private read",
        )
        _require_projection_state(
            bob_read,
            "CONTENT_READY",
            "Bob private Moment did not reach CONTENT_READY",
        )
        _require(
            bob_read.get("textSha256") == _sha256(PRIVATE_TEXT),
            "Bob private Moment plaintext digest differs",
        )
        media = bob_read.get("media")
        _require(
            isinstance(media, list)
            and len(media) == 1
            and isinstance(media[0], Mapping)
            and media[0].get("state") == "MEDIA_READY"
            and media[0].get("plaintextSha256") == _sha256(PNG_BYTES),
            "Bob private image bytes differ",
        )

        eve_read = _mapping(
            eve.call("readPrivateMoment", {"postId": post_id}),
            "Eve private read",
        )
        _require(
            eve_read.get("state") == "NOT_FOUND_OR_NOT_AUTHORIZED",
            "Eve private Moment read did not fail closed",
        )

        invalid_status = _invalid_token_status(
            _station_url(context, EXPECTED_CLIENTS[0]),
            post_id,
        )
        _require(
            invalid_status == 401,
            "invalid private Moment credential did not return 401",
        )

        context.write_bound_artifact_json(
            "desktop-pilot-resume.json",
            "secure-content-desktop-pilot-resume",
            {
                "bobRuntimeIdentitySha256": bob_runtime_identity,
                "postId": post_id,
                "postIdSha256": _sha256(post_id),
                "textSha256": _sha256(PRIVATE_TEXT),
                "mediaSha256": _sha256(PNG_BYTES),
                "publicTextSha256": _sha256(PUBLIC_TEXT),
                "publicMediaSha256": _sha256(PNG_BYTES),
            },
        )

        alice.call("clearLocalState")
        bob.call("clearLocalState")
        eve.call("clearLocalState")

    context.request_restart(
        EXPECTED_CLIENTS[1],
        reason=(
            "desktop-pilot pre-restart phase passed; restart Bob with "
            "retained storage and a changed boot identity to verify "
            "post-restart private read"
        ),
    )
    raise AssertionError("unreachable after desktop-pilot restart request")


SCENARIO = ScenarioDefinition(
    scenario_id="desktop-pilot",
    journey_id="sc-dj-desktop-pilot",
    work_item_id="secure-content-w7",
    runtimes=frozenset({"desktop"}),
    evidence_path=Path("W7/SC-AS01/result.json"),
    execute=_execute,
    required_fixture_capabilities=REQUIRED_FIXTURE_CAPABILITIES,
    result_prefix=Path("W7"),
    result_task_id="W7",
    result_workstream_id="W7",
    result_variant="desktop",
)
