from __future__ import annotations

import base64
import hashlib
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
    "secure-content-browser-authenticated",
    "secure-content-browser-anonymous",
)
EXPECTED_BUDGET_SECONDS = 1200
PUBLIC_TEXT = "secure-content-w7-browser-public"
PRIVATE_TEXT = "secure-content-w7-browser-private"
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RunnerError(message)


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RunnerError(f"browser-private-boundary {field} is invalid")
    return value


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _private_handoff(context: ScenarioContext) -> Mapping[str, Any]:
    if context.artifact_dir is None:
        raise RunnerError("browser-private-boundary artifact root is unavailable")
    path = (
        context.artifact_dir.parent
        / "SC-AS01"
        / "browser-private-handoff.json"
    )
    if not path.is_file():
        context.block(
            (
                "browser-private-boundary requires the current checkpoint's "
                "desktop-pilot handoff artifact"
            ),
            kind="DRIVER_FAILED",
            owner="secure-content-w7",
            retryable=True,
        )
        raise AssertionError("unreachable")
    payload = context.consume_bound_artifact_json(
        path,
        kind="secure-content-browser-private-handoff",
        producer_scenario_id="desktop-pilot",
        producer_journey_id="sc-dj-desktop-pilot",
        producer_runtime="desktop",
    )
    post_id = payload.get("postId")
    if (
        not isinstance(post_id, str)
        or not post_id
        or payload.get("postIdSha256") != _sha256(post_id)
        or payload.get("publicTextSha256") != _sha256(PUBLIC_TEXT)
        or payload.get("publicMediaSha256") != hashlib.sha256(PNG_BYTES).hexdigest()
    ):
        raise RunnerError(
            "browser-private-boundary desktop handoff post identity is invalid"
        )
    return payload


def _require_runtime_binding(context: ScenarioContext) -> None:
    if context.runtime_manifest is None:
        context.block(
            (
                "browser-private-boundary requires an immutable external "
                "runtime manifest"
            ),
            kind="DRIVER_FAILED",
            owner="secure-content-w7-runtime",
            retryable=True,
        )
    if context.runtime != "browser":
        raise RunnerError(
            "browser-private-boundary requires the browser runtime"
        )
    if (
        context.profile != EXPECTED_PROFILE
        or context.profiles != (EXPECTED_PROFILE,)
    ):
        raise RunnerError(
            "browser-private-boundary requires exactly --profile four"
        )
    if context.clients != EXPECTED_CLIENTS:
        raise RunnerError(
            "browser-private-boundary requires exactly --clients "
            + ",".join(EXPECTED_CLIENTS)
        )
    if context.budget_seconds != EXPECTED_BUDGET_SECONDS:
        raise RunnerError(
            "browser-private-boundary requires exactly --budget-seconds 1200"
        )
    manifest = context.require_runtime_manifest()
    expected_actors = {
        EXPECTED_CLIENTS[0]: "browser_actor",
        EXPECTED_CLIENTS[1]: "anonymous",
    }
    for client_id, actor in expected_actors.items():
        if manifest.client(client_id).get("actor") != actor:
            raise RunnerError(
                f"browser-private-boundary client {client_id!r} must bind "
                f"actor {actor!r}"
            )


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    _require_runtime_binding(context)
    handoff = _private_handoff(context)
    post_id = str(handoff["postId"])
    with ExitStack() as stack:
        authenticated = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[0])
        )
        anonymous = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[1])
        )

        authenticated_snapshot = _mapping(
            authenticated.snapshot(),
            "authenticated snapshot",
        )
        _require(
            authenticated_snapshot.get("platform") == "browser",
            "authenticated client is not a Browser runtime",
        )
        anonymous_snapshot = _mapping(
            anonymous.snapshot(),
            "anonymous snapshot",
        )
        _require(
            anonymous_snapshot.get("platform") == "browser",
            "anonymous client is not a Browser runtime",
        )

        anonymous.clear_network_log()
        public_read = _mapping(
            anonymous.call("findPublicMoment", {"text": PUBLIC_TEXT}),
            "anonymous public read",
        )
        _require(
            public_read.get("found") is True
            and public_read.get("textSha256") == _sha256(PUBLIC_TEXT),
            "anonymous Browser could not read the exact PUBLIC control",
        )
        public_media = public_read.get("media")
        _require(
            isinstance(public_media, list)
            and len(public_media) == 1
            and isinstance(public_media[0], Mapping)
            and public_media[0].get("plaintextSha256")
            == hashlib.sha256(PNG_BYTES).hexdigest(),
            "anonymous Browser could not read the exact PUBLIC image bytes",
        )
        public_read_network = anonymous.network_observation(
            private_plaintext=PRIVATE_TEXT,
            private_resource_id=post_id,
            require_response_body=True,
        )
        _require(
            public_read_network.secret_representation_count == 0
            and public_read_network.private_identity_count == 0,
            "anonymous PUBLIC control leaked private material",
        )

        authenticated.clear_network_log()
        authenticated_public_read = _mapping(
            authenticated.call("findPublicMoment", {"text": PUBLIC_TEXT}),
            "authenticated public read",
        )
        _require(
            authenticated_public_read.get("found") is True
            and authenticated_public_read.get("textSha256")
            == _sha256(PUBLIC_TEXT),
            "authenticated Browser could not read the PUBLIC control",
        )
        authenticated_public_network = authenticated.network_observation(
            private_plaintext=PRIVATE_TEXT,
            private_resource_id=post_id,
            require_response_body=True,
        )
        _require(
            authenticated_public_network.secret_representation_count == 0
            and authenticated_public_network.private_identity_count == 0,
            "authenticated PUBLIC control leaked private material",
        )

        authenticated.clear_network_log()
        authenticated.call(
            "stageFriendsDraft",
            {
                "draftId": (
                    "w7-browser-"
                    + context.require_runtime_manifest().sha256[:20]
                ),
                "revision": 1,
                "text": PRIVATE_TEXT,
            },
        )
        private_publish = _mapping(
            authenticated.call("publishFriendsDraft"),
            "private publish rejection",
        )
        private_read = _mapping(
            authenticated.call(
                "readPrivateMoment",
                {"postId": post_id},
            ),
            "private read rejection",
        )
        private_network = authenticated.network_observation(
            private_plaintext=PRIVATE_TEXT,
            private_resource_id=post_id,
        )

        _require(
            private_publish.get("state") == "PRIVATE_UNSUPPORTED"
            and private_publish.get("errorCode") == "PRIVATE_UNSUPPORTED",
            "Browser private publish did not fail with PRIVATE_UNSUPPORTED",
        )
        _require(
            private_read.get("state") == "PRIVATE_UNSUPPORTED_ON_DEVICE"
            and private_read.get("errorCode")
            == "PRIVATE_UNSUPPORTED_ON_DEVICE",
            "Browser private read did not fail with PRIVATE_UNSUPPORTED_ON_DEVICE",
        )
        _require(
            private_network.private_route_count == 0,
            "Browser sent a request to a private content route",
        )
        _require(
            private_network.private_identity_count == 0,
            "Browser sent the private Moment identity over the network",
        )
        _require(
            private_network.plaintext_body_count == 0,
            "Browser sent private plaintext in a request body",
        )
        _require(
            private_network.secret_representation_count == 0,
            "Browser exposed private plaintext or an encoded representation "
            "through captured network traffic",
        )

        authenticated.call("clearLocalState")
        anonymous.call("clearLocalState")

    return {
        "observations": {
            "publicFixturePublishedByNative": True,
            "anonymousPublicRead": True,
            "publicExactMediaBytes": True,
            "privatePublishState": private_publish["state"],
            "privateReadState": private_read["state"],
            "privateRouteRequestCount": private_network.private_route_count,
            "privateIdentityRequestCount": private_network.private_identity_count,
            "privatePlaintextRequestBodyCount": (
                private_network.plaintext_body_count
            ),
            "networkCaptureControlRequestCount": (
                authenticated_public_network.observed_request_count
                + public_read_network.observed_request_count
            ),
            "networkCaptureControlResponseCount": (
                authenticated_public_network.observed_response_count
                + public_read_network.observed_response_count
            ),
            "networkCaptureControlResponseBodyCount": (
                authenticated_public_network.response_body_count
                + public_read_network.response_body_count
            ),
            "privateRequestMethodCount": private_network.request_method_count,
            "privateRequestHeaderCount": private_network.request_headers_count,
            "privateRequestBodyCount": private_network.request_body_count,
            "privateResponseHeaderCount": private_network.response_headers_count,
            "privateResponseBodyCount": private_network.response_body_count,
            "privateWebSocketEventCount": private_network.websocket_event_count,
            "privateEncodedSecretRepresentationCount": (
                private_network.secret_representation_count
            ),
        },
        "contentDigests": {
            "publicTextSha256": _sha256(PUBLIC_TEXT),
            "privateTextSha256": _sha256(PRIVATE_TEXT),
            "privatePostIdSha256": handoff["postIdSha256"],
        },
        "claimBoundary": {
            "formalAcceptance": "NOT_RUN",
        },
    }


SCENARIO = ScenarioDefinition(
    scenario_id="browser-private-boundary",
    journey_id="sc-dj-browser-private-boundary",
    work_item_id="secure-content-w7",
    runtimes=frozenset({"browser"}),
    evidence_path=Path("W7/SC-AS10/result.json"),
    execute=_execute,
)
