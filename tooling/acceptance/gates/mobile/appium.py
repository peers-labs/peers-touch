from __future__ import annotations

import math
import time
from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core import (
    ArtifactRef,
    DriverError,
    EphemeralGateClient,
    EvidenceError,
)
from tooling.acceptance.gates.mobile.proof_contracts import GATE_ID


APPIUM_CAPABILITY_ID = "mobile.native.appium-session"
DEFAULT_OPERATION_TIMEOUT_SECONDS = 60.0


class AppiumSession:
    """Child-side facade for the parent-owned physical Appium session."""

    def __init__(
        self,
        client: EphemeralGateClient,
        *,
        client_id: str,
        platform: str,
        physical_device_lease: ArtifactRef,
        build_attestation: ArtifactRef,
        callback_scheme: str,
    ) -> None:
        if platform not in {"ios", "android"}:
            raise DriverError(
                f"unsupported Mobile native platform: {platform!r}"
            )
        if not client_id or client_id.strip() != client_id:
            raise DriverError("Appium client identity is invalid")
        if not callback_scheme or callback_scheme.strip() != callback_scheme:
            raise DriverError("Appium callback scheme is invalid")
        if not isinstance(physical_device_lease, ArtifactRef) or not isinstance(
            build_attestation,
            ArtifactRef,
        ):
            raise DriverError("Appium source inputs must be typed ArtifactRefs")
        if (
            physical_device_lease.workspace_id != build_attestation.workspace_id
            or physical_device_lease.gate_id != build_attestation.gate_id
            or physical_device_lease.run_id != build_attestation.run_id
        ):
            raise DriverError("Appium source ArtifactRefs cross proof runs")
        if physical_device_lease.gate_id != GATE_ID:
            raise DriverError("Appium source ArtifactRefs target the wrong Gate")

        self.client = client
        self.client_id = client_id
        self.platform = platform
        self.physical_device_lease_ref = physical_device_lease
        self.build_attestation_ref = build_attestation
        self._session_ref = ""
        self._fresh_install_trace_ref: ArtifactRef | None = None
        self._installed_build_identity_ref: ArtifactRef | None = None

    @property
    def fresh_install_trace(self) -> ArtifactRef:
        if self._fresh_install_trace_ref is None:
            raise DriverError("Appium fresh-install trace is unavailable")
        return self._fresh_install_trace_ref

    @property
    def installed_build_identity(self) -> ArtifactRef:
        if self._installed_build_identity_ref is None:
            raise DriverError("Appium installed build identity is unavailable")
        return self._installed_build_identity_ref

    def start(self) -> "AppiumSession":
        if self._session_ref:
            raise DriverError("Appium session is already started")
        result = self._invoke(
            "start",
            {
                "physicalDeviceLease": self.physical_device_lease_ref.to_dict(),
                "buildAttestation": self.build_attestation_ref.to_dict(),
            },
            timeout_seconds=180.0,
            include_session=False,
        )
        session_ref = _required_text(result, "sessionRef", "Appium start")
        fresh_install_trace = self._artifact_ref(
            result,
            "freshInstallTrace",
            expected_path=(
                f"evidence/mobile/runtime/{self.client_id}/install.json"
            ),
        )
        self._session_ref = session_ref
        self._fresh_install_trace_ref = fresh_install_trace
        return self

    def stop(self) -> None:
        if not self._session_ref:
            return
        self._invoke("stop", {})
        self._session_ref = ""

    def verify_installed_build_identity(
        self,
        fresh_install_trace: ArtifactRef,
    ) -> ArtifactRef:
        if not isinstance(fresh_install_trace, ArtifactRef):
            raise DriverError(
                "Appium fresh-install evidence must be a typed ArtifactRef"
            )
        if fresh_install_trace != self.fresh_install_trace:
            raise DriverError(
                "Appium fresh-install ArtifactRef differs from start evidence"
            )
        result = self._invoke(
            "verify_build_identity",
            {"freshInstallTrace": fresh_install_trace.to_dict()},
        )
        identity = self._artifact_ref(
            result,
            "installedBuildIdentity",
            expected_path=(
                f"evidence/mobile/runtime/{self.client_id}/build-identity.json"
            ),
        )
        self._installed_build_identity_ref = identity
        return identity

    def wait_for_ready(self, timeout: float = 30.0) -> None:
        result = self._invoke(
            "wait_ready",
            {"timeoutSeconds": _positive_timeout(timeout)},
            timeout_seconds=timeout,
        )
        if result.get("ready") is not True:
            raise DriverError("Appium ready response is invalid")

    def is_alive(self) -> bool:
        if not self._session_ref:
            return False
        result = self._invoke("is_alive", {})
        alive = result.get("alive")
        if not isinstance(alive, bool):
            raise DriverError("Appium liveness response is invalid")
        return alive

    def contexts(self) -> list[str]:
        return self._contexts(DEFAULT_OPERATION_TIMEOUT_SECONDS)

    def _contexts(self, timeout_seconds: float) -> list[str]:
        result = self._invoke(
            "contexts",
            {},
            timeout_seconds=timeout_seconds,
        )
        contexts = result.get("contexts")
        if not isinstance(contexts, list) or any(
            not isinstance(context, str) for context in contexts
        ):
            raise DriverError("Appium contexts response is invalid")
        return list(contexts)

    def switch_context(self, name: str) -> None:
        self._switch_context(name, DEFAULT_OPERATION_TIMEOUT_SECONDS)

    def _switch_context(self, name: str, timeout_seconds: float) -> None:
        if not isinstance(name, str) or not name:
            raise DriverError("Appium context name is invalid")
        self._invoke(
            "switch_context",
            {"name": name},
            timeout_seconds=timeout_seconds,
        )

    def switch_to_native(self) -> None:
        self.switch_context("NATIVE_APP")

    def switch_to_app_webview(self, timeout: float = 30.0) -> str:
        deadline = time.monotonic() + _positive_timeout(timeout)
        last_contexts: list[str] = []
        while time.monotonic() < deadline:
            last_contexts = self._contexts(_remaining_timeout(deadline))
            webviews = [
                context
                for context in last_contexts
                if context.upper().startswith(("WEBVIEW", "CHROMIUM"))
            ]
            for context in webviews:
                self._switch_context(context, _remaining_timeout(deadline))
                try:
                    self._harness_inventory(_remaining_timeout(deadline))
                except DriverError:
                    continue
                else:
                    _remaining_timeout(deadline)
                    return context
            time.sleep(min(0.25, _remaining_timeout(deadline)))
        raise DriverError(
            f"Appium client {self.client_id!r} did not expose the Mobile "
            f"Acceptance WebView; contexts={last_contexts!r}"
        )

    def require_harness(self, required_actions: list[str]) -> list[str]:
        inventory = self.harness_inventory()
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
        result = self._invoke(
            "harness_action",
            {
                "action": action,
                "actionPayload": dict(payload or {}),
            },
        )
        return result.get("value")

    def harness_inventory(self) -> list[str]:
        return self._harness_inventory(DEFAULT_OPERATION_TIMEOUT_SECONDS)

    def _harness_inventory(self, timeout_seconds: float) -> list[str]:
        result = self._invoke(
            "harness_inventory",
            {},
            timeout_seconds=timeout_seconds,
        )
        actions = result.get("actions")
        if not isinstance(actions, list) or any(
            not isinstance(action, str) for action in actions
        ):
            raise DriverError(
                "window.__PEERS_MOBILE_ACCEPTANCE__ is unavailable"
            )
        return actions

    def call_negative_callback(
        self,
        *,
        replay_payload: Mapping[str, Any] | None,
        negative_payload: Mapping[str, Any],
    ) -> Any:
        payload: dict[str, object] = {
            "negativePayload": dict(negative_payload),
        }
        if replay_payload is not None:
            payload["replayPayload"] = dict(replay_payload)
        result = self._invoke(
            "harness_negative_callback",
            payload,
        )
        return result.get("value")

    def refresh_webview(self) -> None:
        self._invoke("refresh_webview", {})

    def find_element(self, using: str, value: str) -> str:
        result = self._invoke(
            "find_element",
            {"using": using, "value": value},
        )
        return _required_text(result, "elementRef", "Appium find element")

    def click(self, element_id: str) -> None:
        self._invoke("click", {"elementRef": element_id})

    def capture_native_accessibility(self) -> ArtifactRef:
        result = self._invoke(
            "capture_page_source",
            {"captureKind": "native-ax"},
        )
        return self._artifact_ref(
            result,
            "pageSource",
            expected_path=f"mobile/{self.client_id}/native-ax.xml",
            expected_media_type="application/xml",
        )

    def capture_web_dom(self, capture_id: str) -> ArtifactRef:
        normalized_capture_id = _capture_id(capture_id)
        result = self._invoke(
            "capture_page_source",
            {
                "captureKind": "web-dom",
                "captureId": normalized_capture_id,
            },
        )
        return self._artifact_ref(
            result,
            "pageSource",
            expected_path=(
                f"evidence/mobile/{normalized_capture_id}/"
                f"{self.client_id}/web-dom.html"
            ),
            expected_media_type="text/html",
        )

    def capture_screenshot(self, capture_id: str) -> ArtifactRef:
        normalized_capture_id = _capture_id(capture_id)
        result = self._invoke(
            "capture_screenshot",
            {"captureId": normalized_capture_id},
        )
        return self._artifact_ref(
            result,
            "screenshot",
            expected_path=(
                f"evidence/mobile/{normalized_capture_id}/"
                f"{self.client_id}/screenshot.png"
            ),
            expected_media_type="image/png",
        )

    def _invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        timeout_seconds: float = DEFAULT_OPERATION_TIMEOUT_SECONDS,
        include_session: bool = True,
    ) -> Mapping[str, object]:
        request: dict[str, object] = {
            "clientId": self.client_id,
            "platform": self.platform,
            **dict(payload),
        }
        if include_session:
            request["sessionRef"] = self._required_session_ref()
        return self.client.invoke(
            APPIUM_CAPABILITY_ID,
            operation,
            request,
            timeout_seconds=timeout_seconds,
        )

    def _artifact_ref(
        self,
        result: Mapping[str, object],
        field: str,
        *,
        expected_path: str,
        expected_media_type: str = "application/json",
    ) -> ArtifactRef:
        raw_reference = result.get(field)
        if not isinstance(raw_reference, Mapping):
            raise DriverError(f"Appium {field} response is not an ArtifactRef")
        try:
            reference = ArtifactRef.from_dict(raw_reference)
        except (EvidenceError, TypeError, ValueError) as error:
            raise DriverError(
                f"Appium {field} response is not an ArtifactRef"
            ) from error
        if (
            reference.workspace_id != self.build_attestation_ref.workspace_id
            or reference.gate_id != self.build_attestation_ref.gate_id
            or reference.run_id != self.build_attestation_ref.run_id
            or reference.path != expected_path
            or reference.media_type != expected_media_type
        ):
            raise DriverError(f"Appium {field} ArtifactRef identity is invalid")
        return reference

    def _required_session_ref(self) -> str:
        if not self._session_ref:
            raise DriverError("Appium session is not started")
        return self._session_ref


def _positive_timeout(value: float) -> float:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value <= 0
    ):
        raise DriverError("Appium timeout must be a positive finite number")
    return float(value)


def _remaining_timeout(deadline_monotonic: float) -> float:
    remaining = deadline_monotonic - time.monotonic()
    if remaining <= 0:
        raise DriverError("Appium operation exceeded its deadline")
    return remaining


def _capture_id(value: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 96
        or not value[0].isalnum()
        or any(
            character not in "abcdefghijklmnopqrstuvwxyz0123456789_-"
            for character in value
        )
    ):
        raise DriverError("Appium capture identity is invalid")
    return value


def _required_text(
    value: Mapping[str, object],
    field: str,
    context: str,
) -> str:
    result = value.get(field)
    if not isinstance(result, str) or not result:
        raise DriverError(f"{context} response is missing {field}")
    return result
