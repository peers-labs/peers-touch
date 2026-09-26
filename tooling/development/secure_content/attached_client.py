from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import urlparse

from selenium import webdriver
from selenium.webdriver.remote.command import Command
from selenium.webdriver.remote.webdriver import WebDriver

from tooling.acceptance.core.harness import call_async_harness, harness_ready
from tooling.acceptance.core.redaction import (
    redact_text,
    redact_text_with_values,
)
from tooling.development.secure_content import runtime_manifest
from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioContext,
)


LOOPBACK_HOST = "127.0.0.1"
NETWORK_CAPTURE_TIMEOUT_SECONDS = 5.0
NETWORK_CAPTURE_POLL_SECONDS = 0.02
TERMINAL_MARKER_PATH_PREFIX = "/__pt_acceptance/network-terminal/"
TERMINAL_MARKER_FIELDS = frozenset(
    {
        "schemaVersion",
        "captureId",
        "actionId",
        "runtimeManifestDigest",
        "finalObserverSequence",
        "openStreamIdentityDigests",
        "captureIntervalDigest",
        "markerDigest",
    }
)
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


def reconcile_private_moment_publish(
    client: AttachedProductClient,
    method: str,
    *,
    label: str,
    max_attempts: int = 3,
    retry_delay_seconds: float = 0.25,
) -> Mapping[str, Any]:
    if max_attempts < 1:
        raise RunnerError(f"{label} retry budget is invalid")
    for attempt in range(1, max_attempts + 1):
        result = client.call(method)
        if not isinstance(result, Mapping):
            raise RunnerError(f"{label} result is invalid")
        if result.get("state") != "UNKNOWN_COMMIT":
            return result
        if attempt < max_attempts:
            time.sleep(
                min(
                    retry_delay_seconds,
                    client.context.remaining_seconds(),
                )
            )
    raise RunnerError(
        f"{label} remained UNKNOWN_COMMIT after {max_attempts} attempts"
    )


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

    def get_log(self, log_type: str) -> list[dict[str, Any]]:
        entries = self.execute(Command.GET_LOG, {"type": log_type}).get("value")
        if not isinstance(entries, list):
            raise ValueError("WebDriver getLog returned a non-list value")
        return entries

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
        self._network_capture: Mapping[str, Any] | None = None

    @property
    def actor(self) -> str:
        value = self.client.get("actor_role")
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
        attachment = self.client["automation_attachment_ref"]
        command_executor = str(attachment["endpoint"])
        session_id = str(attachment["session_id"])
        timeout = min(30.0, self.context.remaining_seconds())
        try:
            self._driver = _AttachedRemoteWebDriver(
                command_executor=command_executor,
                session_id=session_id,
            )
            if self._driver.session_id != session_id:
                raise RunnerError(
                    f"runtime client {self.client_id!r} attached the wrong "
                    "WebDriver session"
                )
            self._driver.set_script_timeout(timeout)
            self._driver.set_page_load_timeout(timeout)
            runtime_kind = self.client["runtime_kind"]
            if runtime_kind == "browser":
                current = urlparse(self._driver.current_url)
                if (
                    current.scheme not in {"http", "https"}
                    or current.hostname not in {LOOPBACK_HOST, "localhost"}
                ):
                    raise RunnerError(
                        f"runtime client {self.client_id!r} is not attached "
                        "to its declared Browser renderer"
                    )
            elif runtime_kind in {
                "native-tauri",
                "tauri-ios-simulator",
                "tauri-android-emulator",
            }:
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
        attachment = self.client.get("automation_attachment_ref")
        expected_webdriver_session_id = (
            attachment.get("session_id")
            if isinstance(attachment, Mapping)
            else None
        )
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
        try:
            runtime_manifest.validate_harness_snapshot(
                self.context.require_runtime_manifest(),
                self.client_id,
                value,
                automation_session_id=live_webdriver_session_id,
            )
        except runtime_manifest.RuntimeManifestError as error:
            raise RunnerError(str(error)) from error
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
                f"browser runtime does not expose performance network logs: {type(error).__name__}: {error}"
            ) from error
        self._network_capture_armed = True
        self._network_capture = None

    def begin_network_capture(self, action_id: str) -> Mapping[str, Any]:
        if not self._network_capture_armed:
            raise RunnerError(
                "browser network capture was not enabled before observer admission"
            )
        if (
            not isinstance(action_id, str)
            or not action_id
            or action_id != action_id.strip()
        ):
            raise RunnerError("browser network capture action ID is invalid")
        if self._network_capture is not None:
            raise RunnerError("browser network capture is already active")
        manifest = self.context.require_runtime_manifest()
        result = self._raw_call(
            "beginNetworkCapture",
            {
                "actionId": action_id,
                "runtimeManifestDigest": manifest.sha256,
            },
        )
        if (
            not isinstance(result, Mapping)
            or set(result) != {
                "schemaVersion",
                "captureId",
                "actionId",
                "initialObserverSequence",
                "runtimeManifestDigest",
            }
            or result.get("schemaVersion") != 1
            or not _is_sha256(result.get("captureId"))
            or result.get("actionId") != action_id
            or result.get("runtimeManifestDigest") != manifest.sha256
            or not isinstance(result.get("initialObserverSequence"), int)
            or isinstance(result.get("initialObserverSequence"), bool)
            or int(result["initialObserverSequence"]) < 0
        ):
            raise RunnerError(
                "browser runtime did not acknowledge the exact network capture"
            )
        self._network_capture = dict(result)
        return dict(result)

    def emit_terminal_marker(self, action_id: str) -> Mapping[str, Any]:
        capture = self._network_capture
        if not self._network_capture_armed or capture is None:
            raise RunnerError(
                "browser network capture was not admitted before the terminal marker"
            )
        if action_id != capture.get("actionId"):
            raise RunnerError("browser terminal marker action ID is invalid")
        self.snapshot()
        result = self._raw_call(
            "emitTerminalMarker",
            {
                "captureId": capture["captureId"],
                "actionId": action_id,
            },
        )
        marker = _validated_terminal_marker(
            result,
            capture=capture,
        )
        return marker

    def network_observation(
        self,
        *,
        private_plaintext: str,
        private_resource_id: str = "",
        require_response_body: bool = False,
        terminal_marker: Mapping[str, Any] | None = None,
    ) -> NetworkObservation:
        if self.context.runtime != "browser":
            raise RunnerError("network observation requires a browser runtime")
        if not self._network_capture_armed:
            raise RunnerError(
                "browser network capture was not enabled before observation"
            )
        if terminal_marker is None:
            raise RunnerError(
                "browser network capture is insufficient: "
                "stream-terminal-barrier-unavailable"
            )
        marker = _validated_terminal_marker(
            terminal_marker,
            capture=getattr(self, "_network_capture", None),
        )
        try:
            raw_entries = self._collect_network_entries(marker)
        except RunnerError:
            raise
        except Exception as error:
            raise RunnerError(
                f"browser runtime does not expose performance network logs: {type(error).__name__}: {error}"
            ) from error
        finally:
            self._network_capture_armed = False
            self._network_capture = None

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

    def _collect_network_entries(
        self,
        terminal_marker: Mapping[str, Any],
    ) -> list[Any]:
        timeout = min(
            NETWORK_CAPTURE_TIMEOUT_SECONDS,
            self.context.remaining_seconds(),
        )
        deadline = time.monotonic() + timeout
        pending_http_requests: set[str] = set()
        long_lived_request_ids: set[str] = set()
        collected: list[Any] = []
        terminal_marker_seen = False

        while True:
            batch = self.driver.get_log("performance")
            if not isinstance(batch, list):
                raise RunnerError(
                    "browser runtime returned invalid performance network logs"
                )
            for entry in batch:
                event = _network_event(entry)
                if not terminal_marker_seen and _is_terminal_marker(
                    entry,
                    terminal_marker,
                ):
                    terminal_marker_seen = True
                    if not pending_http_requests - long_lived_request_ids:
                        return collected
                    continue
                if event is None:
                    if not terminal_marker_seen:
                        collected.append(entry)
                    continue
                method, params = event
                request_id = params.get("requestId")
                if terminal_marker_seen:
                    if (
                        isinstance(request_id, str)
                        and request_id in pending_http_requests
                    ):
                        collected.append(entry)
                        if method in {
                            "Network.loadingFinished",
                            "Network.loadingFailed",
                        }:
                            pending_http_requests.discard(request_id)
                        elif method == "Network.eventSourceMessageReceived":
                            long_lived_request_ids.add(request_id)
                    if not pending_http_requests - long_lived_request_ids:
                        return collected
                    continue
                collected.append(entry)
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
                elif method == "Network.eventSourceMessageReceived":
                    request_id = params.get("requestId")
                    if isinstance(request_id, str) and request_id:
                        long_lived_request_ids.add(request_id)

            now = time.monotonic()
            if now >= deadline:
                pending = pending_http_requests - long_lived_request_ids
                if pending:
                    raise RunnerError(
                        "browser network capture timed out with "
                        f"{len(pending)} pending HTTP request(s)"
                    )
                raise RunnerError(
                    "browser network capture timed out before the "
                    "same-event-loop terminal marker"
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
    manifest_payload: Mapping[str, Any],
    output_path: Path,
    journey_id: str,
    sessions_by_client: Mapping[str, Any],
    automation_refs_by_client: Mapping[str, Mapping[str, Any]],
    repo_root: Path,
    namespace: str = "moments",
    timeout: float = 30.0,
) -> Path:
    target_path = _external_manifest_path(
        output_path,
        repo_root=repo_root,
        must_exist=False,
        label="runtime manifest",
    )
    if not journey_id or journey_id != journey_id.strip():
        raise RunnerError("runtime manifest journey ID is invalid")
    if namespace != "moments":
        raise RunnerError("runtime manifest namespace must be moments")
    if timeout <= 0:
        raise RunnerError("runtime manifest timeout must be positive")
    if "manifest_digest" in manifest_payload:
        raise RunnerError(
            "runtime owner must provide an unpublished manifest payload"
        )
    payload = json.loads(json.dumps(manifest_payload))
    if payload.get("journey_id") != journey_id:
        raise RunnerError("runtime manifest journey_id is invalid")
    clients = payload.get("clients")
    if not isinstance(clients, list) or any(
        not isinstance(client, dict) for client in clients
    ):
        raise RunnerError("runtime manifest clients are invalid")
    client_ids = tuple(str(client.get("id") or "") for client in clients)
    if (
        not client_ids
        or any(not client_id for client_id in client_ids)
        or len(set(client_ids)) != len(client_ids)
        or set(sessions_by_client) != set(client_ids)
        or set(automation_refs_by_client) != set(client_ids)
    ):
        raise RunnerError(
            "runtime sessions and attachment refs must exactly match manifest clients"
        )

    attached_clients: list[dict[str, Any]] = []
    session_ids: set[str] = set()
    for client in clients:
        client_id = str(client["id"])
        session = sessions_by_client[client_id]
        driver = _raw_webdriver(session)
        attachment = dict(automation_refs_by_client[client_id])
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
        if attachment.get("session_id") != session_id:
            raise RunnerError(
                f"runtime client {client_id!r} attachment does not bind "
                "the owner session"
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
            "tauri-ios-simulator": "mobile",
            "tauri-android-emulator": "mobile",
        }.get(client.get("runtime_kind"))
        if snapshot.get("platform") != expected_platform:
            raise RunnerError(
                f"runtime client {client_id!r} live platform does not match "
                "the source runtime manifest"
            )
        attached_client = dict(client)
        attached_client["automation_attachment_ref"] = attachment
        source = payload.get("source")
        services = payload.get("services")
        bindings = client.get("service_bindings")
        station_binding = (
            bindings.get("station")
            if isinstance(bindings, Mapping)
            else None
        )
        station = (
            services.get(station_binding.get("service_id"))
            if isinstance(services, Mapping)
            and isinstance(station_binding, Mapping)
            else None
        )
        if not isinstance(source, Mapping) or not isinstance(station, Mapping):
            raise RunnerError(
                f"runtime client {client_id!r} Station identity is invalid"
            )
        try:
            attached_client["harness_identity_digest"] = (
                runtime_manifest.harness_identity_digest(
                    snapshot,
                    client=attached_client,
                    source_commit=str(source.get("commit") or ""),
                    station=station,
                    automation_session_id=session_id,
                )
            )
        except runtime_manifest.RuntimeManifestError as error:
            raise RunnerError(str(error)) from error
        attached_clients.append(attached_client)
        session_ids.add(session_id)

    payload["clients"] = attached_clients
    finalized = runtime_manifest.with_manifest_digest(payload)
    source = finalized.get("source")
    services = finalized.get("services")
    if not isinstance(source, Mapping) or not isinstance(services, Mapping):
        raise RunnerError("runtime manifest source or services are invalid")
    identity = {
        "workspaceId": source.get("workspace_id"),
        "head": source.get("commit"),
        "worktreeSetDigest": source.get("worktree_set_digest"),
    }
    profiles = tuple(
        sorted(
            {
                str(service.get("profile_id"))
                for service in services.values()
                if isinstance(service, Mapping)
            }
        )
    )
    encoded = (
        json.dumps(finalized, separators=(",", ":"), sort_keys=True).encode(
            "utf-8"
        )
    )
    try:
        runtime_manifest.validate_runtime_manifest(
            finalized,
            path=target_path,
            raw_bytes=encoded,
            journey_id=journey_id,
            repo_root=repo_root,
            workspace_identity=identity,
            profile_selectors=profiles,
            client_selectors=client_ids,
            runtime=None,
        )
    except runtime_manifest.RuntimeManifestError as error:
        raise RunnerError(str(error)) from error
    _write_private_immutable_json(target_path, finalized)
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


def _validated_terminal_marker(
    value: object,
    *,
    capture: Mapping[str, Any] | None,
) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != TERMINAL_MARKER_FIELDS:
        raise RunnerError("browser terminal marker schema is invalid")
    if (
        value.get("schemaVersion") != 1
        or not _is_sha256(value.get("captureId"))
        or not isinstance(value.get("actionId"), str)
        or not value["actionId"]
        or value["actionId"] != value["actionId"].strip()
        or not _is_sha256(value.get("runtimeManifestDigest"))
        or not isinstance(value.get("finalObserverSequence"), int)
        or isinstance(value.get("finalObserverSequence"), bool)
        or int(value["finalObserverSequence"]) < 0
        or not _is_sha256(value.get("captureIntervalDigest"))
        or not _is_sha256(value.get("markerDigest"))
    ):
        raise RunnerError("browser terminal marker identity is invalid")
    open_streams = value.get("openStreamIdentityDigests")
    if (
        not isinstance(open_streams, list)
        or any(not _is_sha256(item) for item in open_streams)
        or open_streams != sorted(set(open_streams))
    ):
        raise RunnerError("browser terminal marker open-stream set is invalid")
    if capture is not None and (
        value["captureId"] != capture.get("captureId")
        or value["actionId"] != capture.get("actionId")
        or value["runtimeManifestDigest"]
        != capture.get("runtimeManifestDigest")
        or int(value["finalObserverSequence"])
        < int(capture.get("initialObserverSequence", -1))
    ):
        raise RunnerError("browser terminal marker capture identity is invalid")
    marker = dict(value)
    marker_digest = marker.pop("markerDigest")
    if not hmac.compare_digest(
        str(marker_digest),
        hashlib.sha256(
            json.dumps(
                marker,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest(),
    ):
        raise RunnerError("browser terminal marker digest is invalid")
    return dict(value)


def _is_terminal_marker(
    entry: object,
    expected_marker: Mapping[str, Any],
) -> bool:
    event = _network_event(entry)
    if event is None:
        return False
    method, params = event
    if method != "Network.requestWillBeSent":
        return False
    request = params.get("request")
    if not isinstance(request, Mapping) or request.get("method") != "GET":
        return False
    url = request.get("url")
    if not isinstance(url, str):
        return False
    parsed = urlparse(url)
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or parsed.hostname not in {LOOPBACK_HOST, "localhost"}
        or parsed.params
        or parsed.query
        or parsed.fragment
        or not parsed.path.startswith(TERMINAL_MARKER_PATH_PREFIX)
    ):
        return False
    encoded = parsed.path.removeprefix(TERMINAL_MARKER_PATH_PREFIX)
    if re.fullmatch(r"[A-Za-z0-9_-]+", encoded) is None:
        return False
    try:
        padding = "=" * (-len(encoded) % 4)
        decoded = base64.urlsafe_b64decode(encoded + padding)
        canonical = base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=")
        persisted = json.loads(decoded.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    expected = dict(expected_marker)
    expected.pop("markerDigest")
    return canonical == encoded and persisted == expected


def _is_sha256(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


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
