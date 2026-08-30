from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol, TypeVar

from tooling.acceptance.core import ArtifactRef, DriverError, EvidenceError
from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.fixtures.mobile_resource_lease import (
    ResolvedPhysicalDeviceHandle,
)
from tooling.acceptance.gates.mobile.proof_contracts import (
    GATE_ID,
    ProofContractError,
    validate_contract_payload,
)


W3C_ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"

HARNESS_INVENTORY_SCRIPT = """
const root = window.__PEERS_MOBILE_ACCEPTANCE__;
return root ? Object.keys(root).sort() : null;
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

_T = TypeVar("_T")


class AppiumHttpTransport(Protocol):
    def request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        ...


class ArtifactReader(Protocol):
    def read_json(self, reference: ArtifactRef) -> dict[str, Any]:
        ...

    def resolve(self, reference: ArtifactRef) -> Path:
        ...


class PhysicalDeviceLeaseBroker(Protocol):
    def with_physical_device(
        self,
        lease: Mapping[str, Any],
        operation: Callable[[ResolvedPhysicalDeviceHandle], _T],
    ) -> _T:
        ...


class UrllibAppiumTransport:
    def __init__(self, server_url: str, timeout_seconds: float = 60.0) -> None:
        self.server_url = server_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
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
        try:
            with urllib.request.urlopen(
                request,
                timeout=self.timeout_seconds,
            ) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            try:
                response_body = error.read().decode("utf-8", errors="replace")
                decoded_error = json.loads(response_body)
                value = decoded_error.get("value", {})
                message = (
                    value.get("message")
                    if isinstance(value, dict)
                    else response_body
                )
            except (OSError, json.JSONDecodeError):
                message = error.reason
            raise DriverError(
                f"Appium {method} {path} failed with HTTP {error.code}: "
                f"{redact_text(str(message))}"
            ) from error
        except (OSError, TimeoutError, urllib.error.URLError) as error:
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


class AppiumSession:
    def __init__(
        self,
        transport: AppiumHttpTransport,
        *,
        client_id: str,
        platform: str,
        automation_name: str,
        artifact_reader: ArtifactReader,
        device_broker: PhysicalDeviceLeaseBroker,
        physical_device_lease: ArtifactRef,
        build_attestation: ArtifactRef,
        callback_scheme: str,
        ports: Mapping[str, int],
        chromedriver_executable: str = "",
    ) -> None:
        expected_automation = {
            "ios": "XCUITest",
            "android": "UiAutomator2",
        }.get(platform)
        if expected_automation is None:
            raise DriverError(
                f"unsupported Mobile native platform: {platform!r}"
            )
        if automation_name != expected_automation:
            raise DriverError(
                f"Mobile native {platform} requires Appium automation "
                f"{expected_automation!r}"
            )
        if not isinstance(physical_device_lease, ArtifactRef) or not isinstance(
            build_attestation,
            ArtifactRef,
        ):
            raise DriverError("Appium source inputs must be typed ArtifactRefs")
        self.transport = transport
        self.client_id = client_id
        self.platform = platform
        self.automation_name = automation_name
        self.artifact_reader = artifact_reader
        self.device_broker = device_broker
        self.physical_device_lease_ref = physical_device_lease
        self.build_attestation_ref = build_attestation
        self.callback_scheme = callback_scheme
        self.ports = dict(ports)
        self.chromedriver_executable = (
            chromedriver_executable
            or os.environ.get(
                "PT_MOBILE_ANDROID_CHROMEDRIVER_EXECUTABLE",
                "",
            ).strip()
        )
        self.session_id = ""
        self._device_lease: dict[str, Any] | None = None
        self._build_attestation: dict[str, Any] | None = None
        self._application_id = ""
        self._fresh_install_trace: dict[str, Any] | None = None
        self._installed_build_identity: dict[str, Any] | None = None

    @property
    def fresh_install_trace(self) -> dict[str, Any]:
        if self._fresh_install_trace is None:
            raise DriverError("Appium fresh-install trace is unavailable")
        return json.loads(json.dumps(self._fresh_install_trace))

    @property
    def installed_build_identity(self) -> dict[str, Any]:
        if self._installed_build_identity is None:
            raise DriverError("Appium installed build identity is unavailable")
        return json.loads(json.dumps(self._installed_build_identity))

    def start(self) -> "AppiumSession":
        device_lease, attestation, package = self._load_source_inputs()
        self._device_lease = device_lease
        self._build_attestation = attestation
        self._application_id = str(attestation["buildIdentity"]["applicationId"])

        capabilities = {
            "platformName": "iOS" if self.platform == "ios" else "Android",
            "appium:automationName": self.automation_name,
            "appium:autoWebview": False,
            "appium:newCommandTimeout": 180,
        }
        if self.platform == "ios":
            capabilities.update(
                {
                    "appium:wdaLocalPort": self._required_port("wda-local"),
                    "appium:mjpegServerPort": self._required_port("mjpeg"),
                    "appium:webviewConnectTimeout": 30000,
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
        elif self.platform == "android":
            if not self.chromedriver_executable:
                raise DriverError(
                    "Android Appium session requires an explicitly verified "
                    "ChromeDriver executable"
                )
            capabilities.update(
                {
                    "appium:systemPort": self._required_port("system"),
                    "appium:mjpegServerPort": self._required_port("mjpeg"),
                    "appium:chromedriverPort": self._required_port("webview"),
                    "appium:ensureWebviewsHavePages": True,
                    "appium:chromedriverExecutable": (
                        self.chromedriver_executable
                    ),
                }
            )
        else:
            raise DriverError(
                f"unsupported Mobile native platform: {self.platform!r}"
            )

        def create_session(handle: ResolvedPhysicalDeviceHandle) -> Any:
            return self.transport.request(
                "POST",
                "/session",
                {
                    "capabilities": {
                        "alwaysMatch": {
                            **capabilities,
                            "appium:udid": handle.identifier,
                        },
                        "firstMatch": [{}],
                    }
                },
            )

        value = self.device_broker.with_physical_device(
            device_lease,
            create_session,
        )
        session_id = (
            str(value.get("sessionId") or "").strip()
            if isinstance(value, dict)
            else ""
        )
        if not session_id:
            raise DriverError("Appium session response is missing sessionId")
        self.session_id = session_id
        try:
            if self.platform == "ios":
                self._request("POST", self._path("/timeouts"), {"script": 45000})
            self._fresh_install_trace = self._fresh_install(package)
        except BaseException:
            self.stop()
            raise
        return self

    def stop(self) -> None:
        if not self.session_id:
            return
        session_id = self.session_id
        self._request(
            "DELETE",
            f"/session/{urllib.parse.quote(session_id, safe='')}",
        )
        self.session_id = ""

    def verify_installed_build_identity(
        self,
        fresh_install_trace: ArtifactRef,
    ) -> dict[str, Any]:
        device_lease = self._require_device_lease()
        attestation = self._require_build_attestation()
        trace = self._load_json_artifact(
            fresh_install_trace,
            expected_path=(
                f"evidence/mobile/runtime/{self.client_id}/install.json"
            ),
            expected_kind="mobile-fresh-install-trace",
        )
        if trace != self._fresh_install_trace:
            raise DriverError(
                "persisted Appium fresh-install trace differs from the "
                "observed install"
            )
        if (
            trace["physicalDeviceLease"]
            != self.physical_device_lease_ref.to_dict()
            or trace["buildAttestation"] != self.build_attestation_ref.to_dict()
        ):
            raise DriverError("Appium fresh-install trace source refs differ")

        active_application_id = self._active_application_id()
        runtime = self.call_action("build.identity")
        identity = runtime.get("identity") if isinstance(runtime, dict) else None
        runtime_digest = (
            runtime.get("embeddedIdentitySha256")
            if isinstance(runtime, dict)
            else None
        )
        expected_identity = attestation["buildIdentity"]
        expected_digest = attestation["embeddedIdentitySha256"]
        if (
            identity != expected_identity
            or runtime_digest != expected_digest
            or active_application_id != expected_identity["applicationId"]
        ):
            raise DriverError(
                "installed app, Web, Rust, and attested build identities differ"
            )

        payload = {
            "artifactKind": "mobile-installed-build-identity",
            "runId": attestation["runId"],
            "gateId": GATE_ID,
            "clientId": self.client_id,
            "platform": self.platform,
            "buildAttestation": self.build_attestation_ref.to_dict(),
            "freshInstallTrace": fresh_install_trace.to_dict(),
            "buildId": expected_identity["buildId"],
            "activeApplicationId": active_application_id,
            "webEmbeddedIdentitySha256": runtime_digest,
            "rustEmbeddedIdentitySha256": runtime_digest,
            "attestedEmbeddedIdentitySha256": expected_digest,
            "allIdentitiesMatch": True,
            "observedAt": _utc_timestamp(),
        }
        try:
            self._installed_build_identity = validate_contract_payload(
                payload,
                expected_kind="mobile-installed-build-identity",
                expected_run_id=attestation["runId"],
                expected_workspace_id=self.build_attestation_ref.workspace_id,
            )
        except ProofContractError as error:
            raise DriverError(
                f"installed build identity is invalid: {error}"
            ) from error
        self.device_broker.with_physical_device(
            device_lease,
            lambda _: None,
        )
        return self.installed_build_identity

    def wait_for_ready(self, timeout: float = 30.0) -> None:
        deadline = time.monotonic() + timeout
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

    def switch_to_native(self) -> None:
        self.switch_context("NATIVE_APP")

    def switch_to_app_webview(self, timeout: float = 30.0) -> str:
        deadline = time.monotonic() + timeout
        last_contexts: list[str] = []
        while time.monotonic() < deadline:
            last_contexts = self.contexts()
            webviews = [
                context
                for context in last_contexts
                if context.upper().startswith(("WEBVIEW", "CHROMIUM"))
            ]
            for context in webviews:
                self.switch_context(context)
                inventory = self.execute_script(HARNESS_INVENTORY_SCRIPT)
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
        result = self.execute_async_script(
            HARNESS_ACTION_SCRIPT,
            action,
            dict(payload or {}),
        )
        if not isinstance(result, dict):
            raise DriverError(
                f"Mobile Acceptance action {action!r} returned an invalid envelope"
            )
        if result.get("error"):
            raise DriverError(
                f"Mobile Acceptance action {action!r} failed: {result['error']}"
            )
        return result.get("value")

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

    def refresh_webview(self) -> None:
        self._request(
            "POST",
            self._path("/refresh"),
            {},
        )

    def find_element(
        self,
        using: str,
        value: str,
    ) -> str:
        result = self._request(
            "POST",
            self._path("/element"),
            {"using": using, "value": value},
        )
        element_id = (
            str(result.get(W3C_ELEMENT_KEY) or "").strip()
            if isinstance(result, dict)
            else ""
        )
        if not element_id:
            raise DriverError("Appium element response is missing W3C element id")
        return element_id

    def click(self, element_id: str) -> None:
        self._request(
            "POST",
            self._path(
                f"/element/{urllib.parse.quote(element_id, safe='')}/click"
            ),
            {},
        )

    def element_attribute(self, element_id: str, name: str) -> str:
        value = self._request(
            "GET",
            self._path(
                "/element/"
                f"{urllib.parse.quote(element_id, safe='')}/attribute/"
                f"{urllib.parse.quote(name, safe='')}"
            ),
        )
        return str(value or "")

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
                application_key: self._required_application_id(),
            },
        )

    def save_screenshot(self, path: str | Path) -> None:
        Path(path).write_bytes(self.screenshot_bytes())

    def screenshot_bytes(self) -> bytes:
        value = self._request("GET", self._path("/screenshot"))
        if not isinstance(value, str):
            raise DriverError("Appium screenshot response is invalid")
        try:
            return base64.b64decode(value, validate=True)
        except ValueError as error:
            raise DriverError("Appium screenshot is not valid base64") from error

    def get_page_source(self) -> str:
        value = self._request("GET", self._path("/source"))
        if not isinstance(value, str):
            raise DriverError("Appium page source response is invalid")
        return value

    def get_current_url(self) -> str:
        value = self._request("GET", self._path("/url"))
        if not isinstance(value, str):
            raise DriverError("Appium current URL response is invalid")
        return value

    def _load_source_inputs(
        self,
    ) -> tuple[dict[str, Any], dict[str, Any], Path]:
        device = self._load_json_artifact(
            self.physical_device_lease_ref,
            expected_path=(
                f"runtime/mobile/leases/devices/{self.client_id}.json"
            ),
            expected_kind="physical-device-lease",
        )
        attestation = self._load_json_artifact(
            self.build_attestation_ref,
            expected_path=f"runtime/mobile/builds/{self.platform}.json",
            expected_kind="mobile-application-build-attestation",
        )
        if (
            device["clientId"] != self.client_id
            or device["platform"] != self.platform
            or attestation["buildIdentity"]["platform"] != self.platform
        ):
            raise DriverError("Appium source artifact dimensions differ")
        if (
            self.physical_device_lease_ref.workspace_id
            != self.build_attestation_ref.workspace_id
            or self.physical_device_lease_ref.gate_id
            != self.build_attestation_ref.gate_id
            or self.physical_device_lease_ref.run_id
            != self.build_attestation_ref.run_id
        ):
            raise DriverError("Appium source ArtifactRefs cross proof runs")
        package = self._package_reference(attestation)
        try:
            path = self.artifact_reader.resolve(package)
        except (EvidenceError, OSError, TypeError, ValueError) as error:
            raise DriverError(
                f"Appium attested package is unavailable: {type(error).__name__}"
            ) from error
        if not path.is_file() or path.is_symlink():
            raise DriverError("Appium attested package is not a regular file")
        return device, attestation, path

    def _load_json_artifact(
        self,
        reference: ArtifactRef,
        *,
        expected_path: str,
        expected_kind: str,
    ) -> dict[str, Any]:
        if (
            reference.artifact_kind != "acceptance-artifact-ref"
            or reference.gate_id != GATE_ID
            or reference.path != expected_path
            or reference.media_type != "application/json"
        ):
            raise DriverError(
                f"Appium {expected_kind} ArtifactRef identity is invalid"
            )
        try:
            payload = self.artifact_reader.read_json(reference)
            return validate_contract_payload(
                payload,
                expected_kind=expected_kind,
                expected_run_id=reference.run_id,
                expected_gate_id=reference.gate_id,
                expected_workspace_id=reference.workspace_id,
            )
        except (
            EvidenceError,
            OSError,
            ProofContractError,
            TypeError,
            ValueError,
        ) as error:
            raise DriverError(
                f"Appium {expected_kind} artifact failed validation: {error}"
            ) from error

    def _package_reference(
        self,
        attestation: Mapping[str, Any],
    ) -> ArtifactRef:
        package_kind = "ipa" if self.platform == "ios" else "apk"
        expected_path = f"runtime/mobile/builds/{self.platform}.{package_kind}"
        try:
            reference = ArtifactRef.from_dict(
                attestation["artifact"]["artifactRef"]
            )
        except (EvidenceError, KeyError, TypeError, ValueError) as error:
            raise DriverError("Appium package ArtifactRef is invalid") from error
        if (
            reference.workspace_id != self.build_attestation_ref.workspace_id
            or reference.gate_id != self.build_attestation_ref.gate_id
            or reference.run_id != self.build_attestation_ref.run_id
            or reference.path != expected_path
            or reference.media_type != "application/octet-stream"
            or f"sha256:{reference.sha256}"
            != attestation["artifact"]["sha256"]
        ):
            raise DriverError("Appium package ArtifactRef differs from attestation")
        return reference

    def _fresh_install(self, package: Path) -> dict[str, Any]:
        application_id = self._required_application_id()
        self._request(
            "POST",
            self._path("/appium/device/remove_app"),
            {"appId": application_id},
        )
        if self._is_application_installed(application_id):
            raise DriverError(
                "Appium uninstall readback found the prior application"
            )
        uninstall_at = _utc_timestamp()

        self._request(
            "POST",
            self._path("/appium/device/install_app"),
            {"appPath": str(package)},
        )
        if not self._is_application_installed(application_id):
            raise DriverError(
                "Appium install readback did not find the application"
            )
        install_at = _utc_timestamp()
        self._request(
            "POST",
            self._path("/appium/device/activate_app"),
            {"appId": application_id},
        )
        observed_at = _utc_timestamp()

        attestation = self._require_build_attestation()
        payload = {
            "artifactKind": "mobile-fresh-install-trace",
            "runId": attestation["runId"],
            "gateId": GATE_ID,
            "clientId": self.client_id,
            "platform": self.platform,
            "physicalDeviceLease": self.physical_device_lease_ref.to_dict(),
            "buildAttestation": self.build_attestation_ref.to_dict(),
            "applicationId": application_id,
            "artifactSha256": attestation["artifact"]["sha256"],
            "uninstall": {
                "stepIndex": 1,
                "requested": True,
                "priorInstallationAbsent": True,
                "completedAt": uninstall_at,
            },
            "install": {
                "stepIndex": 2,
                "completed": True,
                "applicationPresent": True,
                "completedAt": install_at,
            },
            "observedAt": observed_at,
        }
        try:
            return validate_contract_payload(
                payload,
                expected_kind="mobile-fresh-install-trace",
                expected_run_id=attestation["runId"],
                expected_workspace_id=self.build_attestation_ref.workspace_id,
            )
        except ProofContractError as error:
            raise DriverError(
                f"Appium fresh-install trace is invalid: {error}"
            ) from error

    def _is_application_installed(self, application_id: str) -> bool:
        value = self._request(
            "POST",
            self._path("/appium/device/app_installed"),
            {"bundleId": application_id},
        )
        if not isinstance(value, bool):
            raise DriverError("Appium application readback is invalid")
        return value

    def _active_application_id(self) -> str:
        if self.platform == "ios":
            value = self.execute_script("mobile: activeAppInfo")
            field = "bundleId"
        else:
            value = self.execute_script("mobile: getCurrentActivity")
            field = "appPackage"
        application_id = (
            str(value.get(field) or "").strip()
            if isinstance(value, dict)
            else ""
        )
        if not application_id:
            raise DriverError("Appium active application identity is unavailable")
        return application_id

    def _request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        lease = self._require_device_lease()
        return self.device_broker.with_physical_device(
            lease,
            lambda _: self.transport.request(method, path, payload),
        )

    def _require_device_lease(self) -> dict[str, Any]:
        if self._device_lease is None:
            raise DriverError("Appium physical-device lease is unavailable")
        return self._device_lease

    def _require_build_attestation(self) -> dict[str, Any]:
        if self._build_attestation is None:
            raise DriverError("Appium build attestation is unavailable")
        return self._build_attestation

    def _required_application_id(self) -> str:
        if not self._application_id:
            raise DriverError("Appium application identity is unavailable")
        return self._application_id

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


def _utc_timestamp() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )
