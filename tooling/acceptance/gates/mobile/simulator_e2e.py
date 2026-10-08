#!/usr/bin/env python3
"""Appium-backed dual-iOS simulator callback-routing Acceptance Gate."""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactSession,
    DriverError,
    GateError,
    ProvisioningError,
    REPO_ROOT,
    load_runtime_manifest,
)
from tooling.acceptance.core.bounded_http import (
    HttpResponseBodyTooLarge,
    HttpResponseDeadlineExceeded,
    HttpResponseDeadlineUnsupported,
    read_bounded_http_response,
)
from tooling.acceptance.core.redaction import redact_text, redact_value


GATE_ID = "mobile-simulator-access-e2e"
PROVEN_SCOPE = "simulator-callback-routing"
ENVIRONMENT_ID = "mobile-simulator"
EXPECTED_CLIENTS = {
    "sim-ios": "ios",
    "sim-ios-peer": "ios",
}
EXPECTED_DEVICE_ROLE_MARKERS = {
    "ios": "simulator",
    "android": "emulator",
}
EXPECTED_AUTOMATION_NAMES = {
    "ios": "XCUITest",
    "android": "UiAutomator2",
}
REQUIRED_HARNESS_ACTIONS = (
    "projection.read",
    "lifecycle.restart",
    "cleanup",
)
IOS_NATIVE_PREFLIGHT_TIMEOUT_SECONDS = 15.0
IOS_WEBVIEW_PREFLIGHT_TIMEOUT_SECONDS = 30.0
IOS_WEBVIEW_CONNECT_ATTEMPT_TIMEOUT_MS = 5000
MAX_APPIUM_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_APPIUM_ERROR_RESPONSE_BYTES = 1024 * 1024
MAX_MOBILE_PAGE_SOURCE_BYTES = 32 * 1024 * 1024
MAX_MOBILE_PAGE_SOURCE_RESPONSE_BYTES = 64 * 1024 * 1024
MAX_MOBILE_SCREENSHOT_BYTES = 64 * 1024 * 1024
MAX_MOBILE_SCREENSHOT_BASE64_BYTES = (
    4 * ((MAX_MOBILE_SCREENSHOT_BYTES + 2) // 3)
)
MAX_MOBILE_SCREENSHOT_RESPONSE_BYTES = (
    MAX_MOBILE_SCREENSHOT_BASE64_BYTES + 4096
)
W3C_ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"
PHYSICAL_PROVIDER_SCOPE = "physical provider OAuth/MS-AG03 remains UNPROVEN"
SECURE_STORAGE_ABSENCE_FIELDS = (
    "activeAttemptIndexAbsent",
    "attemptSecretRecordAbsent",
    "currentSessionIndexAbsent",
    "credentialRecordAbsent",
    "publicProjectionAbsent",
)

HARNESS_INVENTORY_SCRIPT = """
const root = window.__PEERS_MOBILE_ACCEPTANCE__;
return root ? Object.keys(root).sort() : null;
"""

DOCUMENT_SOURCE_SCRIPT = """
const done = arguments[arguments.length - 1];
done(document.documentElement
  ? document.documentElement.outerHTML
  : "");
"""

HARNESS_ACTION_SCRIPT = """
const action = arguments[0];
const input = arguments[1] || {};
const done = arguments[arguments.length - 1];
const root = window.__PEERS_MOBILE_ACCEPTANCE__;
if (!root || typeof root[action] !== 'function') {
  done({error: `acceptance.mobile.actionUnavailable:${action}`});
  return;
}
Promise.resolve(root[action](input))
  .then((value) => done({value}))
  .catch((error) => done({
    error: String(error && error.message || error),
  }));
"""

START_FINALIZE_EVIDENCE_SCRIPT = """
const key = "__PEERS_MOBILE_FINALIZE_RESULT__";
const root = window.__PEERS_MOBILE_ACCEPTANCE__;
if (!root
    || typeof root["projection.read"] !== "function"
    || typeof root.cleanup !== "function") {
  return {started: false, error: "acceptance.mobile.finalizeUnavailable"};
}
const source = document.documentElement
  ? document.documentElement.outerHTML
  : "";
window[key] = {state: "pending"};
Promise.resolve(root["projection.read"]({}))
  .then((projection) => Promise.resolve(root.cleanup({}))
    .then((cleanup) => {
      window[key] = {state: "done", value: {source, projection, cleanup}};
    }))
  .catch((error) => {
    window[key] = {
      state: "error",
      error: String(error && error.message || error),
    };
  });
return {started: true};
"""

READ_FINALIZE_EVIDENCE_SCRIPT = """
const key = "__PEERS_MOBILE_FINALIZE_RESULT__";
const result = window[key] || null;
if (result && result.state !== "pending") {
  delete window[key];
}
return result;
"""

class EvidenceWriter(Protocol):
    def write_json(
        self,
        relative_path: str,
        value: Mapping[str, Any],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> Any:
        ...

    def write_bytes(
        self,
        relative_path: str,
        value: bytes,
        *,
        media_type: str = "application/octet-stream",
        role: str | None = None,
    ) -> Any:
        ...


class AppiumHttpTransport(Protocol):
    def request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
        *,
        max_response_bytes: int = MAX_APPIUM_RESPONSE_BYTES,
    ) -> Any:
        ...


class UrllibAppiumTransport:
    """Simulator-only Appium HTTP transport."""

    def __init__(self, server_url: str, timeout_seconds: float = 60.0) -> None:
        if (
            not isinstance(timeout_seconds, (int, float))
            or isinstance(timeout_seconds, bool)
            or not math.isfinite(timeout_seconds)
            or timeout_seconds <= 0
        ):
            raise ValueError("Appium timeout must be a positive finite number")
        self.server_url = server_url.rstrip("/")
        self.timeout_seconds = float(timeout_seconds)

    def request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
        *,
        max_response_bytes: int = MAX_APPIUM_RESPONSE_BYTES,
    ) -> Any:
        if (
            not isinstance(max_response_bytes, int)
            or isinstance(max_response_bytes, bool)
            or max_response_bytes <= 0
        ):
            raise ValueError("Appium response byte limit must be positive")
        url = f"{self.server_url}/{path.lstrip('/')}"
        body = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            body = json.dumps(dict(payload)).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            url,
            data=body,
            headers=headers,
            method=method,
        )
        deadline = time.monotonic() + self.timeout_seconds
        try:
            with urllib.request.urlopen(
                request,
                timeout=max(deadline - time.monotonic(), 0.001),
            ) as response:
                raw = read_bounded_http_response(
                    response,
                    max_bytes=max_response_bytes,
                    deadline_monotonic=deadline,
                )
        except urllib.error.HTTPError as error:
            try:
                try:
                    response_body = read_bounded_http_response(
                        error,
                        max_bytes=MAX_APPIUM_ERROR_RESPONSE_BYTES,
                        deadline_monotonic=deadline,
                    ).decode("utf-8", errors="replace")
                    decoded_error = json.loads(response_body)
                    value = decoded_error.get("value", {})
                    message = (
                        value.get("message")
                        if isinstance(value, dict)
                        else response_body
                    )
                except (
                    HttpResponseBodyTooLarge,
                    HttpResponseDeadlineExceeded,
                    HttpResponseDeadlineUnsupported,
                    OSError,
                    json.JSONDecodeError,
                ):
                    message = error.reason
                raise DriverError(
                    f"Appium {method} {path} failed with HTTP "
                    f"{error.code}: {redact_text(str(message))}"
                ) from error
            finally:
                error.close()
        except HttpResponseBodyTooLarge as error:
            raise DriverError(
                f"Appium {method} {path} response exceeds its byte limit"
            ) from error
        except (
            HttpResponseDeadlineExceeded,
            HttpResponseDeadlineUnsupported,
            OSError,
            TimeoutError,
            urllib.error.URLError,
        ) as error:
            raise DriverError(
                f"Appium {method} {path} failed: {type(error).__name__}"
            ) from error
        try:
            decoded = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DriverError(
                f"Appium {method} {path} returned invalid JSON"
            ) from error
        if not isinstance(decoded, dict):
            raise DriverError(
                f"Appium {method} {path} returned a non-object response"
            )
        value = decoded.get("value")
        if isinstance(value, dict) and value.get("error"):
            error_name = str(value.get("error") or "unknown")
            raise DriverError(
                f"Appium {method} {path} failed with {error_name}"
            )
        return value


class SimulatorGateBlocked(GateError):
    def __init__(self, reason: str, resource: str) -> None:
        super().__init__(reason)
        self.reason = reason
        self.resource = resource


@dataclass(frozen=True)
class SimulatorDeviceTarget:
    platform: str
    identifier: str
    role: str


@dataclass(frozen=True)
class SimulatorBuildTarget:
    platform: str
    artifact: Path
    application_id: str


@dataclass(frozen=True)
class SimulatorClientSpec:
    client_id: str
    platform: str
    automation_name: str
    device: SimulatorDeviceTarget
    build: SimulatorBuildTarget
    callback_scheme: str
    ports: dict[str, int]
    required_harness_actions: tuple[str, ...]
    chromedriver_executable: str = ""


def _positive_timeout(value: float) -> float:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value <= 0
    ):
        raise DriverError("Appium timeout must be a positive finite number")
    return float(value)


class SimulatorAppiumSession:
    """Appium transport adapter owned exclusively by the simulator Gate."""

    def __init__(
        self,
        transport: AppiumHttpTransport,
        *,
        client_id: str,
        platform: str,
        automation_name: str,
        device: SimulatorDeviceTarget,
        build: SimulatorBuildTarget,
        callback_scheme: str,
        ports: Mapping[str, int],
        chromedriver_executable: str = "",
    ) -> None:
        expected_automation = EXPECTED_AUTOMATION_NAMES.get(platform)
        if expected_automation is None:
            raise DriverError(
                f"unsupported Mobile simulator platform: {platform!r}"
            )
        if automation_name != expected_automation:
            raise DriverError(
                f"Mobile simulator {platform} requires Appium automation "
                f"{expected_automation!r}"
            )
        if not isinstance(device, SimulatorDeviceTarget) or not isinstance(
            build,
            SimulatorBuildTarget,
        ):
            raise DriverError(
                "simulator Appium source inputs must use typed targets"
            )
        if device.platform != platform or build.platform != platform:
            raise DriverError("simulator Appium source target platforms differ")
        role = device.role.lower()
        if (
            "physical" in role
            or EXPECTED_DEVICE_ROLE_MARKERS[platform] not in role
        ):
            raise DriverError(
                "simulator Appium device target must not claim a physical role"
            )
        if not device.identifier or not str(build.artifact):
            raise DriverError("simulator Appium source targets are incomplete")

        self.transport = transport
        self.client_id = client_id
        self.platform = platform
        self.automation_name = automation_name
        self.device = device
        self.build = build
        self.callback_scheme = callback_scheme
        self.ports = dict(ports)
        self.chromedriver_executable = chromedriver_executable
        self.session_id = ""
        self.current_context = "NATIVE_APP"

    def start(self) -> "SimulatorAppiumSession":
        capabilities: dict[str, Any] = {
            "platformName": "iOS" if self.platform == "ios" else "Android",
            "appium:automationName": self.automation_name,
            "appium:udid": self.device.identifier,
            "appium:app": str(self.build.artifact),
            "appium:autoWebview": False,
            "appium:newCommandTimeout": 180,
            "appium:noReset": True,
            "appium:fullReset": False,
        }
        if self.platform == "ios":
            capabilities.update(
                {
                    "appium:bundleId": self.build.application_id,
                    "appium:autoAcceptAlerts": True,
                    "appium:isHeadless": True,
                    "appium:shouldTerminateApp": False,
                    "appium:wdaLocalPort": self._required_port("wda-local"),
                    "appium:mjpegServerPort": self._required_port("mjpeg"),
                    "appium:webviewConnectTimeout": (
                        IOS_WEBVIEW_CONNECT_ATTEMPT_TIMEOUT_MS
                    ),
                    "appium:includeSafariInWebviews": True,
                }
            )
            wda_bundle_id = os.environ.get(
                "PT_MOBILE_IOS_WDA_BUNDLE_ID",
                "",
            ).strip()
            webview_bundle_id = os.environ.get(
                "PT_MOBILE_IOS_WEBVIEW_BUNDLE_ID",
                "",
            ).strip()
            if wda_bundle_id:
                capabilities["appium:updatedWDABundleId"] = wda_bundle_id
            if webview_bundle_id:
                capabilities["appium:additionalWebviewBundleIds"] = [
                    webview_bundle_id
                ]
        else:
            if not self.chromedriver_executable:
                raise DriverError(
                    "Android simulator Appium session requires an explicitly "
                    "verified ChromeDriver executable"
                )
            capabilities.update(
                {
                    "appium:appPackage": self.build.application_id,
                    "appium:systemPort": self._required_port("system"),
                    "appium:mjpegServerPort": self._required_port("mjpeg"),
                    "appium:chromedriverPort": self._required_port("webview"),
                    "appium:ensureWebviewsHavePages": True,
                    "appium:chromedriverExecutable": (
                        self.chromedriver_executable
                    ),
                }
            )

        value = self.transport.request(
            "POST",
            "/session",
            {
                "capabilities": {
                    "alwaysMatch": capabilities,
                    "firstMatch": [{}],
                }
            },
        )
        session_id = (
            str(value.get("sessionId") or "").strip()
            if isinstance(value, dict)
            else ""
        )
        if not session_id:
            raise DriverError("Appium session response is missing sessionId")
        self.session_id = session_id
        self.current_context = "NATIVE_APP"
        if self.platform == "ios":
            self._request("POST", self._path("/timeouts"), {"script": 45000})
        return self

    def reconnect_after_runtime_relaunch(
        self,
    ) -> "SimulatorAppiumSession":
        if self.platform != "ios":
            return self
        if not self.session_id:
            raise DriverError(
                "iOS Appium session must be active before reconnect"
            )
        self.stop()
        return self.start()

    def stop(self) -> None:
        if not self.session_id:
            return
        session_id = self.session_id
        self._request(
            "DELETE",
            f"/session/{urllib.parse.quote(session_id, safe='')}",
        )
        self.session_id = ""

    def wait_for_ready(self, timeout: float = 30.0) -> None:
        deadline = time.monotonic() + _positive_timeout(timeout)
        last_contexts: list[str] = []
        while time.monotonic() < deadline:
            last_contexts = self.contexts()
            if "NATIVE_APP" in last_contexts:
                return
            time.sleep(0.25)
        raise DriverError(
            f"Appium client {self.client_id!r} did not expose NATIVE_APP; "
            f"contexts={last_contexts!r}"
        )

    def is_alive(self) -> bool:
        if not self.session_id:
            return False
        try:
            self._request("GET", self._path("/timeouts"))
        except DriverError:
            return False
        return True

    def contexts(self) -> list[str]:
        value = self._request("GET", self._path("/contexts"))
        if not isinstance(value, list) or any(
            not isinstance(context, str) for context in value
        ):
            raise DriverError("Appium contexts response is invalid")
        return list(value)

    def switch_context(self, name: str) -> None:
        self._request(
            "POST",
            self._path("/context"),
            {"name": name},
        )
        self.current_context = name

    def switch_to_native(self) -> None:
        self.switch_context("NATIVE_APP")

    def switch_to_app_webview(self, timeout: float = 30.0) -> str:
        deadline = time.monotonic() + _positive_timeout(timeout)
        last_contexts: list[str] = []
        while time.monotonic() < deadline:
            last_contexts = self.contexts()
            webviews = [
                context
                for context in last_contexts
                if context.upper().startswith(("WEBVIEW", "CHROMIUM"))
            ]
            for context in webviews:
                try:
                    self.switch_context(context)
                    inventory = self.execute_script(HARNESS_INVENTORY_SCRIPT)
                except DriverError:
                    continue
                if isinstance(inventory, list):
                    return context
            time.sleep(0.25)
        raise DriverError(
            f"Appium client {self.client_id!r} did not expose the Mobile "
            f"Acceptance WebView; contexts={last_contexts!r}"
        )

    def require_harness(self, required_actions: list[str]) -> list[str]:
        inventory = self.execute_script(HARNESS_INVENTORY_SCRIPT)
        if not isinstance(inventory, list) or any(
            not isinstance(action, str) for action in inventory
        ):
            raise DriverError(
                "window.__PEERS_MOBILE_ACCEPTANCE__ is unavailable"
            )
        missing = sorted(set(required_actions) - set(inventory))
        if missing:
            raise DriverError(
                "Mobile Acceptance Harness actions are unavailable: "
                + ", ".join(missing)
            )
        return inventory

    def call_action(
        self,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        try:
            result = self.execute_async_script(
                HARNESS_ACTION_SCRIPT,
                action,
                dict(payload or {}),
            )
        except DriverError as error:
            raise DriverError(
                f"Mobile Acceptance action {action!r} transport failed: {error}"
            ) from error
        if not isinstance(result, dict):
            raise DriverError(
                f"Mobile Acceptance action {action!r} returned an invalid envelope"
            )
        if result.get("error"):
            raise DriverError(
                f"Mobile Acceptance action {action!r} failed: {result['error']}"
            )
        return result.get("value")

    def finalize_evidence_and_cleanup(
        self,
        timeout: float = 45.0,
    ) -> tuple[str, Any, Any]:
        started = self.execute_script(START_FINALIZE_EVIDENCE_SCRIPT)
        if started != {"started": True}:
            raise DriverError(
                "Mobile Acceptance finalization could not start"
            )
        deadline = time.monotonic() + _positive_timeout(timeout)
        while time.monotonic() < deadline:
            result = self.execute_script(READ_FINALIZE_EVIDENCE_SCRIPT)
            if result is None or (
                isinstance(result, dict) and result.get("state") == "pending"
            ):
                time.sleep(0.25)
                continue
            if not isinstance(result, dict):
                raise DriverError(
                    "Mobile Acceptance finalization returned an invalid envelope"
                )
            if result.get("state") == "error":
                raise DriverError(
                    "Mobile Acceptance finalization failed: "
                    f"{result.get('error')}"
                )
            value = result.get("value")
            if result.get("state") != "done" or not isinstance(value, dict):
                raise DriverError(
                    "Mobile Acceptance finalization returned an invalid value"
                )
            source = value.get("source")
            if not isinstance(source, str):
                raise DriverError(
                    "Mobile Acceptance finalization returned invalid WebView source"
                )
            if len(source.encode("utf-8")) > MAX_MOBILE_PAGE_SOURCE_BYTES:
                raise DriverError("Mobile WebView source exceeds its byte limit")
            return source, value.get("projection"), value.get("cleanup")
        raise DriverError("Mobile Acceptance finalization timed out")

    def execute_script(self, script: str, *args: Any) -> Any:
        return self._request(
            "POST",
            self._path("/execute/sync"),
            {"script": script, "args": list(args)},
        )

    def execute_async_script(self, script: str, *args: Any) -> Any:
        return self._request(
            "POST",
            self._path("/execute/async"),
            {"script": script, "args": list(args)},
        )

    def find_element(self, using: str, value: str) -> str:
        result = self._request(
            "POST",
            self._path("/element"),
            {"using": using, "value": value},
        )
        if not isinstance(result, dict):
            raise DriverError("Appium element response is invalid")
        element_ref = result.get(W3C_ELEMENT_KEY) or result.get("ELEMENT")
        if not isinstance(element_ref, str) or not element_ref:
            raise DriverError("Appium element response has no element reference")
        return element_ref

    def click_element(self, element_ref: str) -> None:
        if not element_ref:
            raise DriverError("Appium element reference is required")
        self._request(
            "POST",
            self._path(
                f"/element/{urllib.parse.quote(element_ref, safe='')}/click"
            ),
            {},
        )

    def refresh_webview(self) -> None:
        self._request("POST", self._path("/refresh"), {})

    def set_orientation(self, orientation: str) -> None:
        normalized = orientation.upper()
        if normalized not in {"PORTRAIT", "LANDSCAPE"}:
            raise DriverError("Appium orientation must be PORTRAIT or LANDSCAPE")
        self._request(
            "POST",
            self._path("/orientation"),
            {"orientation": normalized},
        )

    def deep_link_for_failure_case(self, url: str, failure_case: str) -> None:
        if failure_case not in {"invalid", "mismatch", "replay"}:
            raise DriverError(
                "Appium deep-link delivery is limited to deterministic "
                "invalid, mismatch, or replay tests"
            )
        if not url.startswith(f"{self.callback_scheme}://"):
            raise DriverError("OAuth callback does not match the declared scheme")
        application_key = "bundleId" if self.platform == "ios" else "package"
        self.execute_script(
            "mobile: deepLink",
            {
                "url": url,
                application_key: self.build.application_id,
            },
        )

    def screenshot_bytes(self) -> bytes:
        value = self._request(
            "GET",
            self._path("/screenshot"),
            max_response_bytes=MAX_MOBILE_SCREENSHOT_RESPONSE_BYTES,
        )
        if not isinstance(value, str):
            raise DriverError("Appium screenshot response is invalid")
        if len(value) > MAX_MOBILE_SCREENSHOT_BASE64_BYTES:
            raise DriverError(
                "Appium screenshot encoding exceeds its byte limit"
            )
        try:
            screenshot = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise DriverError("Appium screenshot is not valid base64") from error
        if len(screenshot) > MAX_MOBILE_SCREENSHOT_BYTES:
            raise DriverError("Appium screenshot exceeds its byte limit")
        return screenshot

    def get_page_source(self) -> str:
        value = self._request(
            "GET",
            self._path("/source"),
            max_response_bytes=MAX_MOBILE_PAGE_SOURCE_RESPONSE_BYTES,
        )
        if not isinstance(value, str):
            raise DriverError("Appium page source response is invalid")
        if len(value.encode("utf-8")) > MAX_MOBILE_PAGE_SOURCE_BYTES:
            raise DriverError("Appium page source exceeds its byte limit")
        return value

    def get_webview_source(self) -> str:
        value = self._request(
            "POST",
            self._path("/execute/async"),
            {"script": DOCUMENT_SOURCE_SCRIPT, "args": []},
            max_response_bytes=MAX_MOBILE_PAGE_SOURCE_RESPONSE_BYTES,
        )
        if not isinstance(value, str):
            raise DriverError("Mobile WebView source response is invalid")
        if len(value.encode("utf-8")) > MAX_MOBILE_PAGE_SOURCE_BYTES:
            raise DriverError("Mobile WebView source exceeds its byte limit")
        return value

    def get_current_url(self) -> str:
        value = self._request("GET", self._path("/url"))
        if not isinstance(value, str):
            raise DriverError("Appium current URL response is invalid")
        return value

    def _request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
        *,
        max_response_bytes: int | None = None,
    ) -> Any:
        if max_response_bytes is None:
            return self.transport.request(method, path, payload)
        return self.transport.request(
            method,
            path,
            payload,
            max_response_bytes=max_response_bytes,
        )

    def _required_port(self, role: str) -> int:
        value = self.ports.get(role)
        if not isinstance(value, int) or value <= 0:
            raise DriverError(
                f"Appium client {self.client_id!r} requires port role {role!r}"
            )
        return value

    def _path(self, suffix: str) -> str:
        if not self.session_id:
            raise DriverError("Appium session is not started")
        return (
            f"/session/{urllib.parse.quote(self.session_id, safe='')}"
            f"{suffix}"
        )


def _required_object(
    owner: Mapping[str, Any],
    name: str,
    resource: str,
) -> dict[str, Any]:
    value = owner.get(name)
    if not isinstance(value, dict):
        raise SimulatorGateBlocked(
            f"{resource} requires object {name}",
            f"mobile-simulator:{resource.replace(' ', '-')}",
        )
    return value


def _required_text(
    owner: Mapping[str, Any],
    name: str,
    resource: str,
) -> str:
    value = owner.get(name)
    if not isinstance(value, str) or not value.strip():
        raise SimulatorGateBlocked(
            f"{resource} requires {name}",
            f"mobile-simulator:{resource.replace(' ', '-')}",
        )
    return value.strip()


def _required_ports(
    owner: Mapping[str, Any],
    platform: str,
    resource: str,
) -> dict[str, int]:
    ports = _required_object(owner, "ports", resource)
    required_roles = (
        ("wda-local", "mjpeg")
        if platform == "ios"
        else ("system", "mjpeg", "webview")
    )
    for role in required_roles:
        value = ports.get(role)
        if not isinstance(value, int) or value <= 0:
            raise SimulatorGateBlocked(
                f"{resource} requires positive port {role}",
                f"mobile-simulator:port:{role}",
            )
    return {
        str(role): value
        for role, value in ports.items()
        if isinstance(value, int) and value > 0
    }


def _validate_source_identity(manifest: Mapping[str, Any]) -> dict[str, str]:
    source = _required_object(manifest, "source", "RuntimeManifest")
    commit = _required_text(source, "commit", "RuntimeManifest source")
    workspace_digest = _required_text(
        source,
        "workspaceDigest",
        "RuntimeManifest source",
    )
    if commit == "unknown" or workspace_digest == "unknown":
        raise SimulatorGateBlocked(
            "mobile-simulator requires source-bound commit and workspace digest",
            "mobile-simulator:source-identity",
        )
    identity = {
        "commit": commit,
        "workspaceDigest": workspace_digest,
    }
    canonical_hash = source.get("canonicalWorktreeHash")
    if isinstance(canonical_hash, str) and canonical_hash:
        identity["canonicalWorktreeHash"] = canonical_hash
    return identity


def _validate_runtime_identity(resources: Mapping[str, Any]) -> dict[str, Any]:
    appium = _required_object(
        resources,
        "appium",
        "mobile-simulator resources",
    )
    server_version = _required_text(
        appium,
        "serverVersion",
        "mobile-simulator Appium",
    )
    expected_server_version = _required_text(
        appium,
        "expectedServerVersion",
        "mobile-simulator Appium",
    )
    if server_version != expected_server_version:
        raise SimulatorGateBlocked(
            "mobile-simulator Appium server version is not verified",
            "mobile-simulator:appium-server-version",
        )

    drivers = _required_object(
        appium,
        "drivers",
        "mobile-simulator Appium",
    )
    required_platforms = set(EXPECTED_CLIENTS.values())
    driver_identity: dict[str, Any] = {}
    for platform in sorted(required_platforms):
        driver = _required_object(
            drivers,
            platform,
            f"mobile-simulator Appium driver {platform}",
        )
        version = _required_text(
            driver,
            "version",
            f"mobile-simulator Appium driver {platform}",
        )
        expected_version = _required_text(
            driver,
            "expectedVersion",
            f"mobile-simulator Appium driver {platform}",
        )
        if version != expected_version:
            raise SimulatorGateBlocked(
                f"mobile-simulator {platform} Appium driver is not verified",
                f"mobile-simulator:appium-driver-version:{platform}",
            )
        driver_identity[platform] = {
            "identity": _required_text(
                driver,
                "identity",
                f"mobile-simulator Appium driver {platform}",
            ),
            "automationName": _required_text(
                driver,
                "automationName",
                f"mobile-simulator Appium driver {platform}",
            ),
            "version": version,
        }

    applications = _required_object(
        resources,
        "applications",
        "mobile-simulator resources",
    )
    application_identity: dict[str, Any] = {}
    for platform in sorted(required_platforms):
        application = _required_object(
            applications,
            platform,
            f"mobile-simulator application {platform}",
        )
        sha256 = _required_text(
            application,
            "sha256",
            f"mobile-simulator application {platform}",
        )
        if re.fullmatch(r"[0-9a-f]{64}", sha256) is None:
            raise SimulatorGateBlocked(
                f"mobile-simulator {platform} application hash is invalid",
                f"mobile-simulator:application-sha256:{platform}",
            )
        application_identity[platform] = {
            "id": _required_text(
                application,
                "id",
                f"mobile-simulator application {platform}",
            ),
            "sha256": sha256,
        }

    return {
        "appium": {
            "serverVersion": server_version,
            "drivers": driver_identity,
        },
        "applications": application_identity,
        "chromedriver": {},
    }


def _validate_fail_closed_projection(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise GateError("Mobile simulator projection must be an object")
    if redact_value(value) != value:
        raise GateError(
            "Mobile simulator projection contains secret-bearing data"
        )

    access = value.get("access")
    oauth = value.get("oauth")
    if not isinstance(access, dict) or not isinstance(oauth, dict):
        raise GateError(
            "Mobile simulator projection requires access and oauth objects"
        )
    if access.get("session") is not None or oauth.get("session") is not None:
        raise GateError("Mobile simulator callback activated a session")
    if oauth.get("candidatePtid") is not None:
        raise GateError("Mobile simulator callback activated a credential candidate")

    decisions = (access.get("decision"), oauth.get("accessDecision"))
    for decision in decisions:
        if not isinstance(decision, dict):
            continue
        state = str(decision.get("state") or "").lower()
        if state.endswith("granted") or decision.get("accessGrantId"):
            raise GateError("Mobile simulator callback granted access")

    if str(oauth.get("phase") or "").lower() == "active_session":
        raise GateError("Mobile simulator callback reached active_session")
    return dict(value)


def _validate_cleanup_result(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise GateError("Mobile simulator cleanup result must be an object")
    oauth_purge = value.get("oauthPurge")
    if not isinstance(oauth_purge, dict):
        raise GateError("Mobile simulator cleanup omitted OAuth purge proof")
    if oauth_purge.get("stationRevocation") not in {
        "not_required",
        "confirmed",
        "unconfirmed",
    }:
        raise GateError(
            "Mobile simulator cleanup returned invalid Station revocation proof"
        )
    secure_storage = oauth_purge.get("secureStorage")
    if not isinstance(secure_storage, dict) or any(
        secure_storage.get(field) is not True
        for field in SECURE_STORAGE_ABSENCE_FIELDS
    ):
        raise GateError(
            "Mobile simulator cleanup did not prove secure-storage absence"
        )
    if (
        value.get("webSessionProjectionCleared") is not True
        or value.get("stationRegistryCleared") is not True
    ):
        raise GateError(
            "Mobile simulator cleanup did not clear public session projections"
        )
    return dict(value)


def _redacted_markup(value: str) -> bytes:
    without_sensitive_attributes = re.sub(
        r"""\s(?:api[_-]?key|authorization|credential|password|passwd|"""
        r"""private[_-]?key|secret|session[_-]?token|token)=("[^"]*"|'[^']*')""",
        "",
        value,
        flags=re.IGNORECASE,
    )
    return redact_text(without_sensitive_attributes).encode("utf-8")


def _safe_contexts(contexts: list[str]) -> list[str]:
    return [redact_text(context)[:256] for context in contexts]


def _safe_bundle_identity(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DriverError("iOS active application identity is invalid")
    identity: dict[str, Any] = {}
    for key in ("bundleId", "name", "pid", "processId"):
        item = value.get(key)
        if isinstance(item, str) and item:
            identity[key] = redact_text(item)[:256]
        elif isinstance(item, int) and not isinstance(item, bool):
            identity[key] = item
    return identity


def _safe_runtime_identity(url: str, webview: str) -> dict[str, Any]:
    parsed = urllib.parse.urlsplit(url)
    if not parsed.scheme or url == "about:blank":
        raise DriverError("iOS WebView runtime identity is unavailable")
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port is not None else ""
    return {
        "context": redact_text(webview)[:256],
        "origin": redact_text(f"{parsed.scheme}://{host}{port}")[:512],
        "scheme": parsed.scheme,
    }


def _invalid_callback_url(callback_scheme: str, stage: str) -> str:
    query = urllib.parse.urlencode(
        {
            "error": "invalid_request",
            "error_description": f"simulator-{stage}-invalid-callback",
        }
    )
    return f"{callback_scheme}://oauth/callback?{query}"


class SimulatorCallbackRoutingGate(AcceptanceGate):
    gate_id = GATE_ID

    def __init__(
        self,
        *,
        transport_factory: Callable[[str], AppiumHttpTransport] | None = None,
        session_factory: (
            Callable[[str, SimulatorClientSpec], SimulatorAppiumSession] | None
        ) = None,
    ) -> None:
        super().__init__()
        self.transport_factory = transport_factory or UrllibAppiumTransport
        self.session_factory = session_factory
        self.sessions: list[SimulatorAppiumSession] = []
        self.lifecycle: list[dict[str, Any]] = []
        self.cleanup: list[dict[str, Any]] = []
        self.cleaned_clients: set[str] = set()
        self.preflights: dict[str, dict[str, Any]] = {}

    def run(self) -> dict[str, Any]:
        raise GateError(
            "SimulatorCallbackRoutingGate uses its evidence-aware execute entrypoint"
        )

    def execute(self) -> int:
        with ArtifactSession(repo_root=REPO_ROOT, gate_id=self.gate_id) as artifacts:
            status = "FAIL"
            completion_status = "PARTIAL"
            proof_status = "UNPROVEN"
            exit_code = 1
            result: dict[str, Any]
            try:
                manifest = self._load_manifest()
                result = self._run_journeys(artifacts, manifest)
                status = "PASS"
                completion_status = "DONE"
                proof_status = "PROVEN"
                exit_code = 0
            except SimulatorGateBlocked as error:
                status = "BLOCKED"
                completion_status = "BLOCKED"
                result = self._result_base("BLOCKED")
                result.update(
                    {
                        "completionStatus": completion_status,
                        "proofStatus": proof_status,
                        "blockedReason": redact_text(error.reason),
                        "blockedResource": error.resource,
                    }
                )
                exit_code = 2
            except (DriverError, GateError, ProvisioningError) as error:
                result = self._result_base("FAIL")
                result.update(
                    {
                        "completionStatus": completion_status,
                        "proofStatus": proof_status,
                        "reason": redact_text(str(error)),
                        "errorType": type(error).__name__,
                    }
                )
            except Exception as error:
                result = self._result_base("FAIL")
                result.update(
                    {
                        "completionStatus": completion_status,
                        "proofStatus": proof_status,
                        "reason": (
                            "unexpected simulator Gate failure: "
                            f"{type(error).__name__}"
                        ),
                        "errorType": type(error).__name__,
                    }
                )
            finally:
                self._cleanup_sessions(artifacts)

            result["preflight"] = {
                client_id: dict(preflight)
                for client_id, preflight in self.preflights.items()
            }
            if any(item["status"] == "failed" for item in self.cleanup):
                journey_succeeded = exit_code == 0
                status = "FAIL"
                completion_status = "PARTIAL"
                proof_status = "UNPROVEN"
                exit_code = 1
                result.update(
                    {
                        "status": status,
                        "completionStatus": completion_status,
                        "proofStatus": proof_status,
                        "cleanupReason": (
                            "one or more simulator cleanup actions failed"
                        ),
                    }
                )
                if journey_succeeded:
                    result["reason"] = result["cleanupReason"]

            result["cleanup"] = list(self.cleanup)
            artifacts.write_json(
                "mobile-simulator/lifecycle.json",
                {
                    "artifactKind": "mobile-simulator-lifecycle",
                    "events": self.lifecycle,
                },
                role="mobile-simulator-lifecycle",
            )
            artifacts.write_json(
                "mobile-simulator/result.json",
                result,
                role="mobile-simulator-result",
            )
            artifacts.complete(
                status=status,
                completion_status=completion_status,
                proof_status=proof_status,
                runtime={
                    "environment": ENVIRONMENT_ID,
                    "runtimeCell": self.gate_id,
                    "clients": sorted(
                        {
                            event["clientId"]
                            for event in self.lifecycle
                            if event.get("clientId")
                        }
                    ),
                    "physicalDeviceClaimed": False,
                },
            )

        if exit_code == 0:
            sys.stdout.write(f"PASS: {self.gate_id}\n")
        else:
            reason = result.get("blockedReason") or result.get("reason")
            sys.stderr.write(
                f"{result['status']}: {self.gate_id}: {reason}\n"
            )
        return exit_code

    def _load_manifest(self) -> dict[str, Any]:
        manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
        if not manifest_path:
            raise SimulatorGateBlocked(
                "PT_ACCEPTANCE_RUNTIME_MANIFEST is required",
                "mobile-simulator:manifest",
            )
        try:
            manifest = load_runtime_manifest(
                Path(manifest_path),
                self.gate_id,
            )
        except ProvisioningError as error:
            raise SimulatorGateBlocked(
                str(error),
                "mobile-simulator:manifest",
            ) from error
        if manifest.get("environmentId") != ENVIRONMENT_ID:
            raise SimulatorGateBlocked(
                "RuntimeManifest environment must be mobile-simulator",
                "mobile-simulator:environment",
            )
        return manifest

    def _run_journeys(
        self,
        artifacts: EvidenceWriter,
        manifest: Mapping[str, Any],
    ) -> dict[str, Any]:
        source_identity = _validate_source_identity(manifest)
        resources = _required_object(
            manifest,
            "mobileSimulator",
            "RuntimeManifest",
        )
        self._reject_credentials(manifest, resources)
        runtime_identity = _validate_runtime_identity(resources)
        appium = _required_object(
            resources,
            "appium",
            "mobile-simulator resources",
        )
        server_url = _required_text(
            appium,
            "serverUrl",
            "mobile-simulator Appium",
        )
        clients = self._client_specs(resources)

        artifacts.write_json(
            "mobile-simulator/source-identity.json",
            {
                "artifactKind": "mobile-simulator-source-identity",
                "environmentId": ENVIRONMENT_ID,
                "gateId": self.gate_id,
                "runtimeManifestRunId": manifest.get("runId"),
                "source": source_identity,
                "runtime": runtime_identity,
            },
            role="mobile-simulator-source-identity",
        )

        client_results: dict[str, Any] = {}
        for spec in clients:
            session = self._create_session(server_url, spec)
            self.sessions.append(session)
            client_results[spec.client_id] = self._exercise_client(
                artifacts,
                session,
                spec,
            )

        return {
            **self._result_base("PASS"),
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "clients": client_results,
        }

    def _client_specs(
        self,
        resources: Mapping[str, Any],
    ) -> tuple[SimulatorClientSpec, ...]:
        appium = _required_object(
            resources,
            "appium",
            "mobile-simulator resources",
        )
        drivers = _required_object(
            appium,
            "drivers",
            "mobile-simulator Appium",
        )
        applications = _required_object(
            resources,
            "applications",
            "mobile-simulator resources",
        )
        clients = _required_object(
            resources,
            "clients",
            "mobile-simulator resources",
        )
        harness = _required_object(
            resources,
            "harness",
            "mobile-simulator resources",
        )
        actions = harness.get("requiredActions")
        if not isinstance(actions, list) or any(
            not isinstance(action, str) or not action.strip()
            for action in actions
        ):
            raise SimulatorGateBlocked(
                "mobile-simulator Harness requires typed action names",
                "mobile-simulator:harness-actions",
            )
        missing_actions = sorted(set(REQUIRED_HARNESS_ACTIONS) - set(actions))
        if missing_actions:
            raise SimulatorGateBlocked(
                "mobile-simulator Harness is missing actions: "
                + ", ".join(missing_actions),
                "mobile-simulator:harness-actions",
            )
        if set(clients) != set(EXPECTED_CLIENTS):
            raise SimulatorGateBlocked(
                "mobile-simulator requires exactly sim-ios and sim-ios-peer",
                "mobile-simulator:clients",
            )

        specs: list[SimulatorClientSpec] = []
        for client_id, expected_platform in EXPECTED_CLIENTS.items():
            client = _required_object(
                clients,
                client_id,
                f"mobile-simulator client {client_id}",
            )
            platform = _required_text(
                client,
                "platform",
                f"mobile-simulator client {client_id}",
            )
            if platform != expected_platform:
                raise SimulatorGateBlocked(
                    f"client {client_id} must use platform {expected_platform}",
                    f"mobile-simulator:client-platform:{client_id}",
                )
            device_role = _required_text(
                client,
                "deviceRole",
                f"mobile-simulator client {client_id}",
            )
            role = device_role.lower()
            if (
                "physical" in role
                or EXPECTED_DEVICE_ROLE_MARKERS[platform] not in role
            ):
                raise SimulatorGateBlocked(
                    f"client {client_id} must not claim a physical-device role",
                    f"mobile-simulator:device-role:{client_id}",
                )

            application = _required_object(
                applications,
                platform,
                f"mobile-simulator application {platform}",
            )
            driver = _required_object(
                drivers,
                platform,
                f"mobile-simulator Appium driver {platform}",
            )
            automation_name = _required_text(
                driver,
                "automationName",
                f"mobile-simulator Appium driver {platform}",
            )
            if automation_name != EXPECTED_AUTOMATION_NAMES[platform]:
                raise SimulatorGateBlocked(
                    f"client {client_id} requires "
                    f"{EXPECTED_AUTOMATION_NAMES[platform]}",
                    f"mobile-simulator:appium-driver:{client_id}",
                )
            specs.append(
                SimulatorClientSpec(
                    client_id=client_id,
                    platform=platform,
                    automation_name=automation_name,
                    device=SimulatorDeviceTarget(
                        platform=platform,
                        identifier=_required_text(
                            client,
                            "device",
                            f"mobile-simulator client {client_id}",
                        ),
                        role=device_role,
                    ),
                    build=SimulatorBuildTarget(
                        platform=platform,
                        artifact=Path(
                            _required_text(
                                application,
                                "artifact",
                                f"mobile-simulator application {platform}",
                            )
                        ),
                        application_id=_required_text(
                            application,
                            "id",
                            f"mobile-simulator application {platform}",
                        ),
                    ),
                    callback_scheme=_required_text(
                        application,
                        "callbackScheme",
                        f"mobile-simulator application {platform}",
                    ),
                    ports=_required_ports(
                        client,
                        platform,
                        f"mobile-simulator client {client_id}",
                    ),
                    required_harness_actions=tuple(
                        sorted(set(actions))
                    ),
                    chromedriver_executable=(
                        _required_text(
                            _required_object(
                                client,
                                "appiumCapabilities",
                                (
                                    "mobile-simulator client "
                                    f"{client_id}"
                                ),
                            ),
                            "appium:chromedriverExecutable",
                            f"mobile-simulator client {client_id}",
                        )
                        if platform == "android"
                        else ""
                    ),
                )
            )
        return tuple(specs)

    def _reject_credentials(
        self,
        manifest: Mapping[str, Any],
        resources: Mapping[str, Any],
    ) -> None:
        for owner, field in (
            (manifest, "credentialRefs"),
            (resources, "credentialRefs"),
        ):
            value = owner.get(field)
            if value not in (None, [], {}, ()):
                raise SimulatorGateBlocked(
                    "mobile-simulator must not receive provider credentials",
                    "mobile-simulator:provider-credentials",
                )

    def _create_session(
        self,
        server_url: str,
        spec: SimulatorClientSpec,
    ) -> SimulatorAppiumSession:
        if self.session_factory is not None:
            return self.session_factory(server_url, spec)
        return SimulatorAppiumSession(
            self.transport_factory(server_url),
            client_id=spec.client_id,
            platform=spec.platform,
            automation_name=spec.automation_name,
            device=spec.device,
            build=spec.build,
            callback_scheme=spec.callback_scheme,
            ports=spec.ports,
            chromedriver_executable=spec.chromedriver_executable,
        )

    def _exercise_client(
        self,
        artifacts: EvidenceWriter,
        session: SimulatorAppiumSession,
        spec: SimulatorClientSpec,
    ) -> dict[str, Any]:
        session.start()
        self._record(spec.client_id, "session-created")
        if spec.platform == "ios":
            self._preflight_ios(artifacts, session, spec)
        else:
            session.wait_for_ready()

        self._observe_fail_closed_state(
            artifacts,
            session,
            spec,
            "initial",
        )

        session.switch_to_native()
        session.deep_link_for_failure_case(
            _invalid_callback_url(spec.callback_scheme, "warm"),
            "invalid",
        )
        self._record(spec.client_id, "warm-invalid-deep-link")
        session.wait_for_ready()
        self._observe_fail_closed_state(
            artifacts,
            session,
            spec,
            "warm-invalid",
        )

        session.switch_to_native()
        self._terminate_application(session, spec)
        self._record(spec.client_id, "app-terminated")
        session.deep_link_for_failure_case(
            _invalid_callback_url(spec.callback_scheme, "cold"),
            "invalid",
        )
        self._record(spec.client_id, "cold-invalid-deep-link")
        session.wait_for_ready()
        if spec.platform == "ios":
            self._capture_native_ax(
                artifacts,
                session,
                spec,
                "cold-invalid",
            )
            session.reconnect_after_runtime_relaunch()
            self._record(
                spec.client_id,
                "appium-session-reconnected",
                {"reason": "cold-application-relaunch"},
            )
            session.wait_for_ready()
        self._observe_fail_closed_state(
            artifacts,
            session,
            spec,
            "cold-invalid",
            capture_native_ax=spec.platform != "ios",
        )

        restart = session.call_action("lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError(
                f"client {spec.client_id} returned an invalid lifecycle.restart result"
            )
        self._record(spec.client_id, "lifecycle.restart")
        final_projection = self._observe_fail_closed_state(
            artifacts,
            session,
            spec,
            "restart-reconnected",
            reuse_current_webview=True,
        )
        return {
            "platform": spec.platform,
            "deviceRole": spec.device.role,
            "physicalRoleClaimed": False,
            "stages": [
                "initial",
                "warm-invalid",
                "cold-invalid",
                "restart-reconnected",
            ],
            "finalPhase": final_projection["oauth"].get("phase"),
        }

    def _preflight_ios(
        self,
        artifacts: EvidenceWriter,
        session: SimulatorAppiumSession,
        spec: SimulatorClientSpec,
    ) -> None:
        evidence_path = (
            f"mobile-simulator/{spec.client_id}/preflight"
        )
        preflight: dict[str, Any] = {
            "artifactKind": "mobile-ios-webview-harness-preflight",
            "clientId": spec.client_id,
            "platform": spec.platform,
            "status": "FAIL",
            "firstFailedStep": "native-app-ready",
            "contexts": [],
            "sessionStatus": {"active": False},
            "bundleIdentity": {},
            "runtimeIdentity": {},
            "requiredHarnessActions": list(spec.required_harness_actions),
            "availableHarnessActions": [],
            "browserFallbackUsed": False,
        }
        try:
            session.wait_for_ready(
                timeout=IOS_NATIVE_PREFLIGHT_TIMEOUT_SECONDS
            )
            session.switch_to_native()
            contexts = session.contexts()
            preflight["contexts"] = _safe_contexts(contexts)
            if "NATIVE_APP" not in contexts:
                raise DriverError(
                    "iOS preflight requires NATIVE_APP before WebView"
                )

            preflight["firstFailedStep"] = "session-status"
            session_active = session.is_alive()
            preflight["sessionStatus"] = {"active": session_active}
            if not session_active:
                raise DriverError("iOS Appium session is not active")

            preflight["firstFailedStep"] = "bundle-identity"
            active_application = session.execute_script(
                "mobile: activeAppInfo"
            )
            bundle_identity = _safe_bundle_identity(active_application)
            preflight["bundleIdentity"] = bundle_identity
            if bundle_identity.get("bundleId") != spec.build.application_id:
                raise DriverError(
                    "iOS active bundle does not match the provisioned application"
                )

            preflight["firstFailedStep"] = "native-ax"
            native_ax = _redacted_markup(session.get_page_source())
            artifacts.write_bytes(
                f"{evidence_path}/native-ax.xml",
                native_ax,
                media_type="application/xml",
                role=f"{spec.client_id}-preflight-native-ax",
            )

            preflight["firstFailedStep"] = "target-webview"
            webview = session.switch_to_app_webview(
                timeout=IOS_WEBVIEW_PREFLIGHT_TIMEOUT_SECONDS
            )
            if not webview.upper().startswith("WEBVIEW"):
                raise DriverError(
                    "iOS preflight selected a non-application WebView context"
                )

            preflight["firstFailedStep"] = "runtime-identity"
            preflight["runtimeIdentity"] = _safe_runtime_identity(
                session.get_current_url(),
                webview,
            )

            preflight["firstFailedStep"] = "required-harness-actions"
            inventory = session.require_harness(
                list(spec.required_harness_actions)
            )
            preflight["availableHarnessActions"] = sorted(set(inventory))

            preflight["firstFailedStep"] = "webview-source"
            artifacts.write_bytes(
                f"{evidence_path}/webview-source.html",
                _redacted_markup(session.get_webview_source()),
                media_type="text/html",
                role=f"{spec.client_id}-preflight-webview-source",
            )
            preflight["status"] = "PASS"
            preflight["firstFailedStep"] = None
            self._record(
                spec.client_id,
                "ios-webview-harness-preflight",
                {
                    "status": "passed",
                    "webview": webview,
                    "harnessActionCount": len(inventory),
                },
            )
        except (DriverError, GateError) as error:
            self._capture_ios_preflight_failure(
                artifacts,
                session,
                spec,
                evidence_path,
                preflight,
                error,
            )
            raise
        finally:
            self.preflights[spec.client_id] = dict(preflight)
            artifacts.write_json(
                f"{evidence_path}/status.json",
                preflight,
                role=f"{spec.client_id}-preflight-status",
            )

    def _capture_ios_preflight_failure(
        self,
        artifacts: EvidenceWriter,
        session: SimulatorAppiumSession,
        spec: SimulatorClientSpec,
        evidence_path: str,
        preflight: dict[str, Any],
        error: Exception,
    ) -> None:
        preflight["status"] = "FAIL"
        preflight["errorType"] = type(error).__name__
        try:
            preflight["contexts"] = _safe_contexts(session.contexts())
        except Exception as diagnostic_error:
            preflight["contextsStatus"] = {
                "available": False,
                "errorType": type(diagnostic_error).__name__,
            }
        try:
            preflight["sessionStatus"] = {"active": session.is_alive()}
        except Exception as diagnostic_error:
            preflight["sessionStatus"] = {
                "active": False,
                "errorType": type(diagnostic_error).__name__,
            }
        if not preflight["bundleIdentity"]:
            try:
                preflight["bundleIdentity"] = _safe_bundle_identity(
                    session.execute_script("mobile: activeAppInfo")
                )
            except Exception as diagnostic_error:
                preflight["bundleIdentityStatus"] = {
                    "available": False,
                    "errorType": type(diagnostic_error).__name__,
                }
        try:
            artifacts.write_bytes(
                f"{evidence_path}/source.txt",
                _redacted_markup(session.get_page_source()),
                media_type="text/plain",
                role=f"{spec.client_id}-preflight-source",
            )
            preflight["sourceCaptured"] = True
        except Exception as diagnostic_error:
            preflight["sourceCaptured"] = False
            preflight["sourceErrorType"] = type(diagnostic_error).__name__
        try:
            session.switch_to_native()
            artifacts.write_bytes(
                f"{evidence_path}/native-ax.xml",
                _redacted_markup(session.get_page_source()),
                media_type="application/xml",
                role=f"{spec.client_id}-preflight-native-ax",
            )
            preflight["axCaptured"] = True
        except Exception as diagnostic_error:
            preflight["axCaptured"] = False
            preflight["axErrorType"] = type(diagnostic_error).__name__
        self._record(
            spec.client_id,
            "ios-webview-harness-preflight",
            {
                "status": "failed",
                "firstFailedStep": preflight["firstFailedStep"],
                "errorType": type(error).__name__,
            },
        )

    def _observe_fail_closed_state(
        self,
        artifacts: EvidenceWriter,
        session: SimulatorAppiumSession,
        spec: SimulatorClientSpec,
        stage: str,
        *,
        capture_native_ax: bool = True,
        reuse_current_webview: bool = False,
    ) -> dict[str, Any]:
        if stage != "restart-reconnected" and capture_native_ax:
            self._capture_native_ax(
                artifacts,
                session,
                spec,
                stage,
            )

        if reuse_current_webview:
            webview = session.current_context
            if not webview.upper().startswith(("WEBVIEW", "CHROMIUM")):
                raise DriverError(
                    f"client {spec.client_id} is not attached to its WebView"
                )
        else:
            webview = session.switch_to_app_webview()
        inventory = session.require_harness(list(REQUIRED_HARNESS_ACTIONS))
        screenshot = session.screenshot_bytes()
        if stage == "restart-reconnected":
            source_value, projection_value, cleanup_value = (
                session.finalize_evidence_and_cleanup()
            )
            webview_source = _redacted_markup(source_value)
            projection = _validate_fail_closed_projection(projection_value)
            _validate_cleanup_result(cleanup_value)
            self.cleaned_clients.add(spec.client_id)
        else:
            webview_source = _redacted_markup(session.get_webview_source())
            projection = _validate_fail_closed_projection(
                session.call_action("projection.read")
            )
        artifacts.write_json(
            f"mobile-simulator/{spec.client_id}/{stage}/projection.json",
            projection,
            role=f"{spec.client_id}-{stage}-projection",
        )
        artifacts.write_bytes(
            f"mobile-simulator/{spec.client_id}/{stage}/web-dom.html",
            webview_source,
            media_type="text/html",
            role=f"{spec.client_id}-{stage}-web-dom",
        )
        artifacts.write_bytes(
            f"mobile-simulator/{spec.client_id}/{stage}/screenshot.png",
            screenshot,
            media_type="image/png",
            role=f"{spec.client_id}-{stage}-screenshot",
        )
        self._record(
            spec.client_id,
            f"projection.{stage}",
            {
                "webview": webview,
                "harnessActionCount": len(inventory),
                "sessionActive": False,
            },
        )
        return projection

    def _capture_native_ax(
        self,
        artifacts: EvidenceWriter,
        session: SimulatorAppiumSession,
        spec: SimulatorClientSpec,
        stage: str,
    ) -> None:
        session.switch_to_native()
        artifacts.write_bytes(
            f"mobile-simulator/{spec.client_id}/{stage}/native-ax.xml",
            _redacted_markup(session.get_page_source()),
            media_type="application/xml",
            role=f"{spec.client_id}-{stage}-native-ax",
        )

    def _terminate_application(
        self,
        session: SimulatorAppiumSession,
        spec: SimulatorClientSpec,
    ) -> None:
        application_key = (
            "bundleId" if spec.platform == "ios" else "appId"
        )
        session.execute_script(
            "mobile: terminateApp",
            {application_key: spec.build.application_id},
        )

    def _cleanup_sessions(self, artifacts: EvidenceWriter) -> None:
        for session in reversed(self.sessions):
            client_id = session.client_id
            if getattr(session, "session_id", ""):
                if client_id in self.cleaned_clients:
                    self.cleanup.append(
                        {
                            "clientId": client_id,
                            "resource": "product-harness",
                            "status": "passed",
                        }
                    )
                else:
                    try:
                        session.switch_to_app_webview(timeout=5)
                        session.require_harness(["cleanup"])
                        _validate_cleanup_result(session.call_action("cleanup"))
                        self.cleanup.append(
                            {
                                "clientId": client_id,
                                "resource": "product-harness",
                                "status": "passed",
                            }
                        )
                    except Exception as error:
                        self.cleanup.append(
                            {
                                "clientId": client_id,
                                "resource": "product-harness",
                                "status": "failed",
                                "errorType": type(error).__name__,
                                "reason": redact_text(str(error)),
                            }
                        )
            try:
                session.stop()
                self.cleanup.append(
                    {
                        "clientId": client_id,
                        "resource": "appium-session",
                        "status": "passed",
                    }
                )
            except Exception as error:
                self.cleanup.append(
                    {
                        "clientId": client_id,
                        "resource": "appium-session",
                        "status": "failed",
                        "errorType": type(error).__name__,
                            "reason": redact_text(str(error)),
                    }
                )
        self.sessions.clear()
        self.cleaned_clients.clear()
        artifacts.write_json(
            "mobile-simulator/cleanup.json",
            {
                "artifactKind": "mobile-simulator-cleanup",
                "resources": self.cleanup,
            },
            role="mobile-simulator-cleanup",
        )

    def _record(
        self,
        client_id: str,
        event: str,
        detail: Mapping[str, Any] | None = None,
    ) -> None:
        self.lifecycle.append(
            {
                "clientId": client_id,
                "event": event,
                "atUnixMs": int(time.time() * 1000),
                "detail": dict(detail or {}),
            }
        )

    def _result_base(self, status: str) -> dict[str, Any]:
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": self.gate_id,
            "gate": self.gate_id,
            "environment": ENVIRONMENT_ID,
            "runtimeCell": GATE_ID,
            "status": status,
            "phase": "W2-E1 Simulator evidence",
            "bom": ["W2-E1"],
            "spec": ["MS-D14"],
            "observedScope": [PROVEN_SCOPE] if status == "PASS" else [],
            "unprovenScope": [PHYSICAL_PROVIDER_SCOPE],
            "physicalDeviceClaimed": False,
            "successfulCallbackInjected": False,
            "stationMocksUsed": False,
            "sampleEmissionAllowed": status == "PASS",
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.parse_args()
    return SimulatorCallbackRoutingGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
