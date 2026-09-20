from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import warnings
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import urlparse

from selenium import webdriver
from selenium.webdriver.remote.webdriver import WebDriver

from tooling.acceptance.core.evidence_store import workspace_id
from tooling.acceptance.core.harness import call_async_harness, harness_ready
from tooling.acceptance.core.provisioning import (
    ProvisioningError,
    load_json_artifact,
    load_runtime_manifest,
    require_runtime_client_service,
)
from tooling.acceptance.core.redaction import (
    redact_text,
    redact_text_with_values,
)
from tooling.development.secure_content.run import (
    RUNTIME_ATTACHMENT_KIND,
    RunnerError,
    ScenarioContext,
    canonical_actor_ptids,
    validate_actor_manifest_reference,
    validated_harness_identity,
)


LOOPBACK_HOST = "127.0.0.1"
NETWORK_CAPTURE_TIMEOUT_SECONDS = 5.0
NETWORK_CAPTURE_QUIET_SECONDS = 0.2
NETWORK_CAPTURE_POLL_SECONDS = 0.02
PRIVATE_ROUTE_MARKERS = (
    "/moments/prepare-private",
    "/moments/submit-private",
    "/moments/objects/",
    "/moments/recoverable",
    "/private-content",
    "/content/prekeys",
    "/key-exchange/content-prekeys",
    "/grants/",
    "/recovery-envelopes",
)


@dataclass(frozen=True)
class NetworkObservation:
    observed_request_count: int
    observed_response_count: int
    request_method_count: int
    request_headers_count: int
    request_body_count: int
    response_headers_count: int
    response_body_count: int
    response_body_unavailable_count: int
    websocket_event_count: int
    private_route_count: int
    private_identity_count: int
    plaintext_body_count: int
    secret_representation_count: int
    request_url_digests: tuple[str, ...]
    capture_complete: bool
    capture_gaps: tuple[str, ...]


class _AttachedRemoteWebDriver(webdriver.Remote):
    def __init__(
        self,
        *,
        command_executor: str,
        session_id: str,
    ) -> None:
        self._attached_session_id = session_id
        super().__init__(
            command_executor=command_executor,
            options=webdriver.ChromeOptions(),
        )

    def start_session(self, capabilities: Mapping[str, Any]) -> None:
        del capabilities
        self.session_id = self._attached_session_id
        self.caps = {}

    def detach(self) -> None:
        try:
            close = getattr(self.command_executor, "close", None)
            if callable(close):
                close()
        finally:
            self.session_id = None

    def quit(self) -> None:
        self.detach()


class AttachedProductClient:
    def __init__(
        self,
        context: ScenarioContext,
        client_id: str,
        *,
        namespace: str = "moments",
    ) -> None:
        manifest = context.require_runtime_manifest()
        self.context = context
        self.client_id = client_id
        self.client = manifest.client(client_id)
        self.namespace = namespace
        self._driver: _AttachedRemoteWebDriver | None = None
        self._network_capture_armed = False

    @property
    def actor(self) -> str:
        value = self.client.get("actor")
        if not isinstance(value, str) or not value:
            raise RunnerError(
                f"runtime manifest client {self.client_id!r} actor is missing"
            )
        return value

    @property
    def driver(self) -> WebDriver:
        if self._driver is None:
            raise RunnerError(f"runtime client {self.client_id!r} is not attached")
        return self._driver

    def connect(self) -> "AttachedProductClient":
        if self._driver is not None:
            return self
        port = int(self.client["webdriver_port"])
        session_id = str(self.client["webdriver_session_id"])
        timeout = min(30.0, self.context.remaining_seconds())
        try:
            self._driver = _AttachedRemoteWebDriver(
                command_executor=f"http://{LOOPBACK_HOST}:{port}",
                session_id=session_id,
            )
            if self._driver.session_id != session_id:
                raise RunnerError(
                    f"runtime client {self.client_id!r} attached the wrong "
                    "WebDriver session"
                )
            self._driver.set_script_timeout(timeout)
            self._driver.set_page_load_timeout(timeout)
            if self.context.runtime == "browser":
                current = urlparse(self._driver.current_url)
                if (
                    current.scheme not in {"http", "https"}
                    or current.hostname not in {LOOPBACK_HOST, "localhost"}
                    or current.port != int(self.client["renderer_port"])
                ):
                    raise RunnerError(
                        f"runtime client {self.client_id!r} is not attached "
                        "to its declared Browser renderer"
                    )
            elif self.context.runtime == "desktop":
                state = self._driver.execute_script(
                    """
                    return {
                      hasRoot: Boolean(document.querySelector('#root')),
                      hasTauri: typeof window.__TAURI_INTERNALS__ === 'object'
                               || typeof window.__TAURI__ === 'object',
                    };
                    """
                )
                if (
                    not isinstance(state, dict)
                    or state.get("hasRoot") is not True
                    or state.get("hasTauri") is not True
                ):
                    raise RunnerError(
                        f"runtime client {self.client_id!r} is not a ready "
                        "Native Tauri renderer"
                    )
            else:
                raise RunnerError(
                    f"runtime {self.context.runtime!r} cannot attach a product client"
                )
            if not harness_ready(self.driver, self.namespace, timeout=timeout):
                raise RunnerError(
                    f"runtime client {self.client_id!r} did not expose "
                    f"{self.namespace!r} acceptance harness"
                )
            if self._driver.session_id != session_id:
                raise RunnerError(
                    f"runtime client {self.client_id!r} WebDriver session changed "
                    "during attachment"
                )
            self.snapshot()
        except Exception:
            self.close()
            raise
        if self._driver is None:
            raise RunnerError(
                f"runtime client {self.client_id!r} did not attach"
            )
        return self

    def close(self) -> None:
        if self._driver is not None:
            try:
                self._driver.detach()
            except Exception as error:
                warnings.warn(
                    redact_text(f"failed to detach WebDriver transport: {error}"),
                    RuntimeWarning,
                )
            self._driver = None

    def call(
        self,
        method: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        if method == "snapshot":
            return self._raw_call(method, payload)
        self.snapshot()
        try:
            return self._raw_call(method, payload)
        finally:
            self.snapshot()

    def _raw_call(
        self,
        method: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        return call_async_harness(
            self.driver,
            method,
            dict(payload or {}),
            namespace=self.namespace,
            script_timeout=min(45.0, self.context.remaining_seconds()),
        )

    def snapshot(self) -> Mapping[str, Any]:
        value = self._raw_call("snapshot")
        if not isinstance(value, Mapping):
            raise RunnerError(
                f"runtime client {self.client_id!r} returned an invalid snapshot"
            )
        expected_webdriver_session_id = self.client.get("webdriver_session_id")
        live_webdriver_session_id = getattr(self.driver, "session_id", None)
        if (
            not isinstance(expected_webdriver_session_id, str)
            or not isinstance(live_webdriver_session_id, str)
            or not hmac.compare_digest(
                live_webdriver_session_id,
                expected_webdriver_session_id,
            )
        ):
            raise RunnerError(
                f"runtime client {self.client_id!r} WebDriver session does not "
                "match the runtime manifest"
            )
        expected = self.context.require_runtime_manifest().client_harness_binding(
            self.client_id
        )
        expected_platform = {
            "desktop": "native",
            "browser": "browser",
        }.get(self.context.runtime)
        if value.get("platform") != expected_platform:
            raise RunnerError(
                f"runtime client {self.client_id!r} live platform does not "
                "match the runtime manifest"
            )
        for field_name, expected_digest in expected.items():
            observed = value.get(field_name)
            if (
                not isinstance(observed, str)
                or not hmac.compare_digest(observed, expected_digest)
            ):
                raise RunnerError(
                    f"runtime client {self.client_id!r} live {field_name} "
                    "does not match the runtime manifest"
                )
        for field_name in (
            "actorPtidSha256",
            "nativeRuntimeIdentitySha256",
        ):
            if field_name not in expected and value.get(field_name) is not None:
                raise RunnerError(
                    f"runtime client {self.client_id!r} live {field_name} "
                    "contradicts the runtime manifest"
                )
        return value

    def reload_renderer(self) -> None:
        self.snapshot()
        self.driver.refresh()
        timeout = min(30.0, self.context.remaining_seconds())
        if not harness_ready(self.driver, self.namespace, timeout=timeout):
            raise RunnerError(
                f"runtime client {self.client_id!r} did not restore "
                f"{self.namespace!r} harness after renderer reload"
            )
        self.snapshot()

    def clear_network_log(self) -> None:
        if self.context.runtime != "browser":
            raise RunnerError("network log capture requires a browser runtime")
        try:
            enabled = self.driver.execute_cdp_cmd("Network.enable", {})
            if not isinstance(enabled, dict):
                raise RunnerError(
                    "browser runtime did not acknowledge Network.enable"
                )
            self.driver.get_log("performance")
        except Exception as error:
            if isinstance(error, RunnerError):
                raise
            raise RunnerError(
                "browser runtime does not expose performance network logs"
            ) from error
        self._network_capture_armed = True

    def network_observation(
        self,
        *,
        private_plaintext: str,
        private_resource_id: str = "",
        require_response_body: bool = False,
    ) -> NetworkObservation:
        if self.context.runtime != "browser":
            raise RunnerError("network observation requires a browser runtime")
        if not self._network_capture_armed:
            raise RunnerError(
                "browser network capture was not enabled before observation"
            )
        if hasattr(self, "client"):
            self.snapshot()
        try:
            raw_entries = self._collect_network_entries()
        except RunnerError:
            raise
        except Exception as error:
            raise RunnerError(
                "browser runtime does not expose performance network logs"
            ) from error
        finally:
            self._network_capture_armed = False

        request_urls: list[str] = []
        observed_response_count = 0
        request_method_count = 0
        request_headers_count = 0
        request_body_count = 0
        response_headers_count = 0
        response_body_count = 0
        response_body_unavailable_count = 0
        websocket_event_count = 0
        private_route_count = 0
        private_identity_count = 0
        plaintext_body_count = 0
        secret_representation_count = 0
        capture_gaps: set[str] = set()
        response_request_ids: list[str] = []

        def inspect(value: Any, *, request_body: bool = False) -> None:
            nonlocal private_identity_count
            nonlocal plaintext_body_count
            nonlocal secret_representation_count
            text = _network_text(value)
            if not text:
                return
            if private_resource_id and _contains_secret_representation(
                text,
                (private_resource_id,),
            ):
                private_identity_count += 1
            if private_plaintext and _contains_secret_representation(
                text,
                (private_plaintext,),
            ):
                secret_representation_count += 1
                if request_body:
                    plaintext_body_count += 1

        for entry in raw_entries:
            if not isinstance(entry, dict):
                capture_gaps.add("malformed-performance-entry")
                continue
            raw_message = entry.get("message")
            if not isinstance(raw_message, str):
                capture_gaps.add("missing-performance-message")
                continue
            try:
                envelope = json.loads(raw_message)
            except json.JSONDecodeError:
                capture_gaps.add("malformed-performance-message")
                continue
            message = envelope.get("message")
            if not isinstance(message, dict):
                capture_gaps.add("malformed-devtools-message")
                continue
            method = message.get("method")
            if not isinstance(method, str) or not method.startswith("Network."):
                continue
            params = message.get("params")
            if not isinstance(params, dict):
                capture_gaps.add(f"{method}-missing-params")
                continue

            if method == "Network.requestWillBeSent":
                request = params.get("request")
                if not isinstance(request, dict):
                    capture_gaps.add("request-missing")
                    continue
                url = request.get("url")
                request_method = request.get("method")
                headers = request.get("headers")
                if not isinstance(url, str) or not url:
                    capture_gaps.add("request-url-missing")
                    continue
                request_urls.append(url)
                inspect(url)
                parsed = urlparse(url)
                if any(marker in parsed.path.lower() for marker in PRIVATE_ROUTE_MARKERS):
                    private_route_count += 1
                if isinstance(request_method, str) and request_method:
                    request_method_count += 1
                    inspect(request_method)
                else:
                    capture_gaps.add("request-method-missing")
                if isinstance(headers, Mapping):
                    request_headers_count += 1
                    inspect(headers)
                else:
                    capture_gaps.add("request-headers-missing")
                body = request.get("postData")
                if isinstance(body, str):
                    request_body_count += 1
                    inspect(body, request_body=True)
                elif request.get("hasPostData") is True:
                    request_id = params.get("requestId")
                    if not isinstance(request_id, str) or not request_id:
                        capture_gaps.add("request-post-data-id-missing")
                    else:
                        try:
                            post_data = self.driver.execute_cdp_cmd(
                                "Network.getRequestPostData",
                                {"requestId": request_id},
                            )
                        except Exception:
                            capture_gaps.add("request-post-data-unavailable")
                        else:
                            post_body = (
                                post_data.get("postData")
                                if isinstance(post_data, Mapping)
                                else None
                            )
                            if isinstance(post_body, str):
                                request_body_count += 1
                                inspect(post_body, request_body=True)
                            else:
                                capture_gaps.add("request-post-data-invalid")
                continue

            if method == "Network.requestWillBeSentExtraInfo":
                headers = params.get("headers")
                if isinstance(headers, Mapping):
                    request_headers_count += 1
                    inspect(headers)
                else:
                    capture_gaps.add("request-extra-headers-missing")
                continue

            if method == "Network.responseReceived":
                response = params.get("response")
                request_id = params.get("requestId")
                if not isinstance(response, dict):
                    capture_gaps.add("response-missing")
                    continue
                observed_response_count += 1
                inspect(response.get("url"))
                headers = response.get("headers")
                if isinstance(headers, Mapping):
                    response_headers_count += 1
                    inspect(headers)
                else:
                    capture_gaps.add("response-headers-missing")
                if isinstance(request_id, str) and request_id:
                    response_request_ids.append(request_id)
                else:
                    capture_gaps.add("response-request-id-missing")
                continue

            if method == "Network.responseReceivedExtraInfo":
                headers = params.get("headers")
                if isinstance(headers, Mapping):
                    response_headers_count += 1
                    inspect(headers)
                else:
                    capture_gaps.add("response-extra-headers-missing")
                continue

            if method == "Network.webSocketCreated":
                websocket_event_count += 1
                url = params.get("url")
                inspect(url)
                if isinstance(url, str):
                    parsed = urlparse(url)
                    if any(
                        marker in parsed.path.lower()
                        for marker in PRIVATE_ROUTE_MARKERS
                    ):
                        private_route_count += 1
                else:
                    capture_gaps.add("websocket-url-missing")
                continue

            if method in {
                "Network.webSocketWillSendHandshakeRequest",
                "Network.webSocketHandshakeResponseReceived",
            }:
                websocket_event_count += 1
                handshake_key = (
                    "request"
                    if method.endswith("WillSendHandshakeRequest")
                    else "response"
                )
                handshake = params.get(handshake_key)
                if not isinstance(handshake, Mapping):
                    capture_gaps.add("websocket-handshake-missing")
                    continue
                headers = handshake.get("headers")
                if isinstance(headers, Mapping):
                    inspect(headers)
                else:
                    capture_gaps.add("websocket-handshake-headers-missing")
                continue

            if method in {
                "Network.webSocketFrameSent",
                "Network.webSocketFrameReceived",
            }:
                websocket_event_count += 1
                response = params.get("response")
                if not isinstance(response, Mapping):
                    capture_gaps.add("websocket-frame-missing")
                    continue
                inspect(response.get("payloadData"))
                continue

            if method == "Network.eventSourceMessageReceived":
                payload = params.get("data")
                if not isinstance(payload, str):
                    capture_gaps.add("event-source-payload-missing")
                    continue
                websocket_event_count += 1
                inspect(payload)

        for request_id in dict.fromkeys(response_request_ids):
            try:
                response_body = self.driver.execute_cdp_cmd(
                    "Network.getResponseBody",
                    {"requestId": request_id},
                )
            except Exception:
                response_body_unavailable_count += 1
                capture_gaps.add("response-body-unavailable")
                continue
            if not isinstance(response_body, dict) or not isinstance(
                response_body.get("body"),
                str,
            ):
                response_body_unavailable_count += 1
                capture_gaps.add("response-body-invalid")
                continue
            body = response_body["body"]
            response_body_count += 1
            inspect(body)
            if response_body.get("base64Encoded") is True:
                try:
                    decoded = base64.b64decode(body, validate=True)
                except (ValueError, TypeError):
                    capture_gaps.add("response-body-base64-invalid")
                else:
                    inspect(decoded)

        if request_urls and request_method_count != len(request_urls):
            capture_gaps.add("request-method-coverage-incomplete")
        if request_urls and request_headers_count < len(request_urls):
            capture_gaps.add("request-header-coverage-incomplete")
        if (
            observed_response_count > 0
            and response_headers_count < observed_response_count
        ):
            capture_gaps.add("response-header-coverage-incomplete")
        # CDP performance logs do not expose a deterministic barrier proving
        # that an already-open WebSocket or EventSource cannot emit later.
        capture_gaps.add("stream-terminal-barrier-unavailable")
        if require_response_body:
            if not request_urls:
                capture_gaps.add("request-control-missing")
            if observed_response_count == 0:
                capture_gaps.add("response-control-missing")
            if response_body_count == 0:
                capture_gaps.add("response-body-control-missing")
        elif not request_urls and websocket_event_count == 0:
            capture_gaps.add("network-capture-unproven")

        capture_complete = not capture_gaps
        observation = NetworkObservation(
            observed_request_count=len(request_urls),
            observed_response_count=observed_response_count,
            request_method_count=request_method_count,
            request_headers_count=request_headers_count,
            request_body_count=request_body_count,
            response_headers_count=response_headers_count,
            response_body_count=response_body_count,
            response_body_unavailable_count=response_body_unavailable_count,
            websocket_event_count=websocket_event_count,
            private_route_count=private_route_count,
            private_identity_count=private_identity_count,
            plaintext_body_count=plaintext_body_count,
            secret_representation_count=secret_representation_count,
            request_url_digests=tuple(
                hashlib.sha256(url.encode("utf-8")).hexdigest()
                for url in request_urls
            ),
            capture_complete=capture_complete,
            capture_gaps=tuple(sorted(capture_gaps)),
        )
        if not observation.capture_complete:
            raise RunnerError(
                "browser network capture is insufficient: "
                + ", ".join(observation.capture_gaps)
            )
        return observation

    def _collect_network_entries(self) -> list[Any]:
        timeout = min(
            NETWORK_CAPTURE_TIMEOUT_SECONDS,
            self.context.remaining_seconds(),
        )
        deadline = time.monotonic() + timeout
        quiet_since: float | None = None
        pending_http_requests: set[str] = set()
        collected: list[Any] = []

        while True:
            batch = self.driver.get_log("performance")
            if not isinstance(batch, list):
                raise RunnerError(
                    "browser runtime returned invalid performance network logs"
                )
            now = time.monotonic()
            network_activity = False
            for entry in batch:
                collected.append(entry)
                event = _network_event(entry)
                if event is None:
                    continue
                method, params = event
                network_activity = True
                if method == "Network.requestWillBeSent":
                    request = params.get("request")
                    url = request.get("url") if isinstance(request, Mapping) else None
                    if (
                        isinstance(url, str)
                        and urlparse(url).scheme.lower() in {"http", "https"}
                    ):
                        request_id = params.get("requestId")
                        if not isinstance(request_id, str) or not request_id:
                            raise RunnerError(
                                "browser network capture observed an HTTP request "
                                "without a request identity"
                            )
                        pending_http_requests.add(request_id)
                elif method in {
                    "Network.loadingFinished",
                    "Network.loadingFailed",
                }:
                    request_id = params.get("requestId")
                    if isinstance(request_id, str) and request_id:
                        pending_http_requests.discard(request_id)

            if network_activity:
                quiet_since = None
            if not pending_http_requests:
                if quiet_since is None:
                    quiet_since = now
                elif now - quiet_since >= NETWORK_CAPTURE_QUIET_SECONDS:
                    return collected

            if now >= deadline:
                if pending_http_requests:
                    raise RunnerError(
                        "browser network capture timed out with "
                        f"{len(pending_http_requests)} pending HTTP request(s)"
                    )
                raise RunnerError(
                    "browser network capture timed out before the bounded "
                    "quiet interval"
                )
            time.sleep(
                min(
                    NETWORK_CAPTURE_POLL_SECONDS,
                    max(0.0, deadline - now),
                )
            )

    def __enter__(self) -> "AttachedProductClient":
        return self.connect()

    def __exit__(self, *_: object) -> None:
        self.close()


def write_attached_runtime_manifest(
    *,
    source_manifest_path: Path,
    output_path: Path,
    journey_id: str,
    sessions_by_client: Mapping[str, Any],
    actor_manifest_path: Path,
    repo_root: Path,
    namespace: str = "moments",
    timeout: float = 30.0,
) -> Path:
    source_path = _external_manifest_path(
        source_manifest_path,
        repo_root=repo_root,
        must_exist=True,
        label="source runtime manifest",
    )
    target_path = _external_manifest_path(
        output_path,
        repo_root=repo_root,
        must_exist=False,
        label="attached runtime manifest",
    )
    if source_path == target_path:
        raise RunnerError("attached runtime manifest must use a new path")
    actor_path = _external_manifest_path(
        actor_manifest_path,
        repo_root=repo_root,
        must_exist=True,
        label="actor manifest",
    )
    if not journey_id or journey_id != journey_id.strip():
        raise RunnerError("attached runtime manifest journey ID is invalid")
    if namespace != "moments":
        raise RunnerError("attached runtime manifest namespace must be moments")
    if timeout <= 0:
        raise RunnerError("attached runtime manifest timeout must be positive")

    try:
        source_bytes = source_path.read_bytes()
    except OSError as error:
        raise RunnerError(f"cannot read source runtime manifest: {error}") from error
    try:
        source_payload = load_runtime_manifest(source_path, journey_id)
    except Exception as error:
        raise RunnerError(f"source runtime manifest is invalid: {error}") from error
    if source_payload.get("developmentAttachment") is not None:
        raise RunnerError("source runtime manifest is already post-launch attached")
    try:
        actor_bytes = actor_path.read_bytes()
        actor_payload = load_json_artifact(actor_path, "acceptance-actor-manifest")
    except Exception as error:
        raise RunnerError(f"actor manifest is invalid: {error}") from error
    actor_ref = source_payload.get("actorManifest")
    actor_sha256 = hashlib.sha256(actor_bytes).hexdigest()
    validate_actor_manifest_reference(
        actor_ref,
        source_manifest_path=source_path,
        actor_manifest_path=actor_path,
        workspace_id=workspace_id(repo_root),
        gate_id=journey_id,
        run_id=str(source_payload.get("runId") or ""),
        sha256=actor_sha256,
    )
    if (
        actor_payload.get("runId") != source_payload.get("runId")
        or actor_payload.get("environmentId") != source_payload.get("environmentId")
    ):
        raise RunnerError("actor manifest does not match the source runtime manifest")
    actor_ptids_by_role = canonical_actor_ptids(actor_payload)

    clients = source_payload.get("clients")
    if not isinstance(clients, list) or any(
        not isinstance(client, dict) for client in clients
    ):
        raise RunnerError("source runtime manifest clients are invalid")
    client_ids = tuple(str(client.get("id") or "") for client in clients)
    if (
        not client_ids
        or any(not client_id for client_id in client_ids)
        or len(set(client_ids)) != len(client_ids)
        or set(sessions_by_client) != set(client_ids)
    ):
        raise RunnerError(
            "attached runtime sessions must exactly match manifest clients"
        )

    attached_clients: list[dict[str, Any]] = []
    session_ids: set[str] = set()
    for client in clients:
        client_id = str(client["id"])
        session = sessions_by_client[client_id]
        driver = _raw_webdriver(session)
        session_id = getattr(driver, "session_id", None)
        if (
            not isinstance(session_id, str)
            or not session_id.strip()
            or session_id != session_id.strip()
            or session_id in session_ids
        ):
            raise RunnerError(
                f"runtime owner supplied an invalid or duplicate WebDriver "
                f"session for {client_id!r}"
            )
        if not harness_ready(driver, namespace, timeout=timeout):
            raise RunnerError(
                f"runtime client {client_id!r} did not expose "
                f"{namespace!r} acceptance harness"
            )
        snapshot = call_async_harness(
            driver,
            "snapshot",
            {},
            namespace=namespace,
            script_timeout=timeout,
        )
        if not isinstance(snapshot, Mapping):
            raise RunnerError(
                f"runtime client {client_id!r} returned an invalid harness snapshot"
            )
        if getattr(driver, "session_id", None) != session_id:
            raise RunnerError(
                f"runtime client {client_id!r} WebDriver session changed "
                "during attachment capture"
            )
        expected_platform = {
            "native-tauri": "native",
            "browser": "browser",
        }.get(client.get("runtime"))
        if snapshot.get("platform") != expected_platform:
            raise RunnerError(
                f"runtime client {client_id!r} live platform does not match "
                "the source runtime manifest"
            )
        try:
            _, station = require_runtime_client_service(
                source_payload,
                client_id,
                "station",
            )
        except ProvisioningError as error:
            raise RunnerError(
                f"runtime client {client_id!r} Station binding is invalid: "
                f"{error}"
            ) from error
        harness_identity = validated_harness_identity(
            client_id,
            client,
            snapshot,
            actor_ptids_by_role=actor_ptids_by_role,
            source_commit=source_payload.get("source", {}).get("commit"),
            station=station,
        )
        attached_client = dict(client)
        attached_client["webdriver_session_id"] = session_id
        attached_client["harness_identity"] = harness_identity
        attached_clients.append(attached_client)
        session_ids.add(session_id)

    try:
        if source_path.read_bytes() != source_bytes:
            raise RunnerError(
                "source runtime manifest changed during attachment capture"
            )
        if actor_path.read_bytes() != actor_bytes:
            raise RunnerError("actor manifest changed during attachment capture")
    except OSError as error:
        raise RunnerError(
            "source or actor manifest became unreadable during attachment capture"
        ) from error

    source_digest = hashlib.sha256(source_bytes).hexdigest()
    attached_payload = json.loads(json.dumps(source_payload))
    attached_payload["clients"] = attached_clients
    attached_payload["developmentAttachment"] = {
        "kind": RUNTIME_ATTACHMENT_KIND,
        "sourceManifestRunId": source_payload["runId"],
        "sourceManifestPath": str(source_path),
        "sourceManifestSha256": source_digest,
        "actorManifestPath": str(actor_path),
        "actorManifestSha256": actor_sha256,
        "capturedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "namespace": namespace,
    }
    _write_private_immutable_json(target_path, attached_payload)
    return target_path


def _raw_webdriver(session: Any) -> Any:
    driver = getattr(session, "driver", session)
    if driver is session and not hasattr(driver, "execute_async_script"):
        raise RunnerError("runtime owner supplied an invalid WebDriver session")
    return driver


def _external_manifest_path(
    path: Path,
    *,
    repo_root: Path,
    must_exist: bool,
    label: str,
) -> Path:
    if not path.is_absolute() or path.is_symlink():
        raise RunnerError(f"{label} path must be absolute and non-symlinked")
    try:
        resolved = path.resolve(strict=must_exist)
        repository = repo_root.resolve(strict=True)
    except OSError as error:
        raise RunnerError(f"{label} path cannot be resolved: {error}") from error
    if resolved == repository or repository in resolved.parents:
        raise RunnerError(f"{label} must be outside the repository")
    if must_exist and not resolved.is_file():
        raise RunnerError(f"{label} path must name a file")
    if not must_exist and resolved.exists():
        raise RunnerError(f"{label} already exists")
    return resolved


def _write_private_immutable_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (
        json.dumps(dict(payload), indent=2, sort_keys=True).encode("utf-8") + b"\n"
    )
    descriptor: int | None = None
    created = False
    try:
        descriptor = os.open(
            path,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            0o600,
        )
        created = True
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as error:
        if descriptor is not None:
            os.close(descriptor)
        if created:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                pass
        raise RunnerError(f"write attached runtime manifest: {error}") from error


def _network_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, separators=(",", ":"), sort_keys=True)
    except (TypeError, ValueError):
        return str(value)


def _network_event(
    entry: object,
) -> tuple[str, Mapping[str, Any]] | None:
    if not isinstance(entry, Mapping):
        return None
    raw_message = entry.get("message")
    if not isinstance(raw_message, str):
        return None
    try:
        envelope = json.loads(raw_message)
    except json.JSONDecodeError:
        return None
    message = envelope.get("message")
    if not isinstance(message, Mapping):
        return None
    method = message.get("method")
    params = message.get("params")
    if (
        not isinstance(method, str)
        or not method.startswith("Network.")
        or not isinstance(params, Mapping)
    ):
        return None
    return method, params


def _contains_secret_representation(
    text: str,
    secret_values: Sequence[str],
) -> bool:
    values = tuple(value for value in secret_values if len(value) >= 4)
    if not values:
        return False
    if any(value in text for value in values):
        return True
    return redact_text_with_values(text, values) != redact_text(text)
