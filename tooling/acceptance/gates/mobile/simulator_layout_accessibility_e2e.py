#!/usr/bin/env python3
"""Stable iOS Simulator layout and accessibility evidence for Mobile W9-B."""

from __future__ import annotations

import os
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactSession,
    DriverError,
    GateError,
    ProvisioningError,
    REPO_ROOT,
    load_runtime_manifest,
)
from tooling.acceptance.core.redaction import redact_text
from tooling.acceptance.gates.mobile.simulator_e2e import (
    SimulatorAppiumSession,
    SimulatorBuildTarget,
    SimulatorDeviceTarget,
    SimulatorGateBlocked,
    UrllibAppiumTransport,
    _redacted_markup,
    _required_object,
    _required_ports,
    _required_text,
    _safe_contexts,
    _validate_source_identity,
)


GATE_ID = "mobile-ios-simulator-layout-accessibility-e2e"
ENVIRONMENT_ID = "mobile-ios-layout-simulator"
PROVEN_SCOPE = "ios-simulator-launch-layout-accessibility"
REQUIRED_HARNESS_ACTIONS = ("projection.read",)
EXPECTED_CLIENTS = {
    "sim-ios-current": "current",
}
INTERACTIVE_TYPES = {
    "XCUIElementTypeButton",
    "XCUIElementTypeLink",
    "XCUIElementTypeSecureTextField",
    "XCUIElementTypeSwitch",
    "XCUIElementTypeTextField",
}

DOM_AUDIT_SCRIPT = """
const visible = (element) => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(style.opacity) > 0
    && rect.width > 0
    && rect.height > 0;
};
const selector = 'button,input,select,textarea,a[href],[role="button"],[tabindex]';
const unlabeled = Array.from(document.querySelectorAll(selector))
  .filter(visible)
  .filter((element) => element.getAttribute('tabindex') !== '-1')
  .filter((element) => {
    const label = element.getAttribute('aria-label')
      || element.getAttribute('aria-labelledby')
      || element.getAttribute('title')
      || element.getAttribute('placeholder')
      || element.textContent;
    return !String(label || '').trim();
  })
  .map((element) => element.outerHTML.slice(0, 240));
const clippedText = Array.from(document.querySelectorAll('body *'))
  .filter(visible)
  .filter((element) => element.children.length === 0)
  .filter((element) => String(element.textContent || '').trim())
  .filter((element) => {
    const style = getComputedStyle(element);
    if (['auto', 'scroll'].includes(style.overflowX)
        || ['auto', 'scroll'].includes(style.overflowY)) return false;
    return element.scrollWidth > element.clientWidth + 1
      || element.scrollHeight > element.clientHeight + 1;
  })
  .map((element) => ({
    text: String(element.textContent || '').trim().slice(0, 160),
    className: String(element.className || '').slice(0, 160),
  }));
const outsideViewport = Array.from(document.querySelectorAll(selector))
  .filter(visible)
  .map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      label: String(
        element.getAttribute('aria-label')
        || element.getAttribute('placeholder')
        || element.textContent
        || '',
      ).trim().slice(0, 160),
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  })
  .filter((rect) => rect.left < -1
    || rect.top < -1
    || rect.right > window.innerWidth + 1
    || rect.bottom > window.innerHeight + 1);
return {
  lang: document.documentElement.lang || '',
  viewport: {width: window.innerWidth, height: window.innerHeight},
  unlabeled,
  clippedText,
  outsideViewport,
};
"""

SWITCH_LANGUAGE_SCRIPT = """
const done = arguments[arguments.length - 1];
const before = document.documentElement.lang || '';
const trigger = document.querySelector('.mobile-language-switcher');
if (!trigger) {
  done({error: 'language-trigger-missing'});
  return;
}
trigger.click();
setTimeout(() => {
  const items = Array.from(
    document.querySelectorAll('.ant-dropdown-menu-item'),
  ).filter((item) => item.getBoundingClientRect().width > 0);
  const target = items.find((item) => {
    const selected = item.getAttribute('aria-selected') === 'true'
      || item.classList.contains('ant-dropdown-menu-item-selected');
    return !selected;
  });
  if (!target) {
    done({error: 'alternate-language-missing', before});
    return;
  }
  target.click();
  setTimeout(() => {
    done({
      before,
      after: document.documentElement.lang || '',
    });
  }, 250);
}, 250);
"""


def _rect(node: ET.Element) -> tuple[int, int, int, int] | None:
    try:
        return tuple(
            int(float(node.attrib[name]))
            for name in ("x", "y", "width", "height")
        )
    except (KeyError, TypeError, ValueError):
        return None


def audit_accessibility_tree(markup: str) -> dict[str, Any]:
    try:
        root = ET.fromstring(markup)
    except ET.ParseError as error:
        raise GateError("iOS accessibility tree is malformed") from error

    application = next(
        (
            node
            for node in root.iter()
            if node.tag == "XCUIElementTypeApplication"
        ),
        None,
    )
    application_rect = _rect(application) if application is not None else None
    if application_rect is None:
        raise GateError("iOS accessibility tree has no application bounds")
    _, _, screen_width, screen_height = application_rect

    unlabeled: list[str] = []
    outside_screen: list[str] = []
    interactive_count = 0
    for node in root.iter():
        if node.tag not in INTERACTIVE_TYPES:
            continue
        if node.attrib.get("visible", "true") == "false":
            continue
        interactive_count += 1
        label = (
            node.attrib.get("label")
            or node.attrib.get("name")
            or node.attrib.get("value")
            or ""
        ).strip()
        if not label:
            unlabeled.append(node.tag)
        bounds = _rect(node)
        if bounds is None:
            outside_screen.append(f"{node.tag}:missing-bounds")
            continue
        x, y, width, height = bounds
        if (
            x < 0
            or y < 0
            or x + width > screen_width
            or y + height > screen_height
        ):
            outside_screen.append(f"{node.tag}:{label[:80]}")

    if interactive_count == 0:
        raise GateError("iOS accessibility tree has no interactive elements")
    if unlabeled:
        raise GateError(
            "iOS accessibility tree contains unlabeled controls: "
            + ", ".join(unlabeled)
        )
    if outside_screen:
        raise GateError(
            "iOS accessibility controls escape the application bounds: "
            + ", ".join(outside_screen)
        )
    return {
        "interactiveCount": interactive_count,
        "unlabeled": unlabeled,
        "outsideScreen": outside_screen,
        "screen": {"width": screen_width, "height": screen_height},
    }


def audit_keyboard_tree(markup: str) -> dict[str, Any]:
    root = ET.fromstring(markup)
    keyboard = next(
        (node for node in root.iter() if node.tag == "XCUIElementTypeKeyboard"),
        None,
    )
    text_field = next(
        (
            node
            for node in root.iter()
            if node.tag in {
                "XCUIElementTypeTextField",
                "XCUIElementTypeSecureTextField",
            }
            and node.attrib.get("visible", "true") != "false"
        ),
        None,
    )
    keyboard_rect = _rect(keyboard) if keyboard is not None else None
    text_field_rect = _rect(text_field) if text_field is not None else None
    if keyboard_rect is None or text_field_rect is None:
        raise GateError("iOS keyboard audit requires keyboard and text field")
    _, keyboard_top, _, _ = keyboard_rect
    _, text_top, _, text_height = text_field_rect
    if text_top + text_height > keyboard_top:
        raise GateError("iOS keyboard occludes the Station address field")
    return {
        "keyboardTop": keyboard_top,
        "textFieldBottom": text_top + text_height,
    }


def validate_dom_audit(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise GateError("Mobile DOM audit result must be an object")
    for field in ("unlabeled", "clippedText", "outsideViewport"):
        entries = value.get(field)
        if not isinstance(entries, list):
            raise GateError(f"Mobile DOM audit requires list {field}")
        if entries:
            raise GateError(f"Mobile DOM audit found {field}: {entries[:5]!r}")
    viewport = value.get("viewport")
    if not isinstance(viewport, dict):
        raise GateError("Mobile DOM audit requires viewport dimensions")
    return dict(value)


class SimulatorLayoutAccessibilityGate(AcceptanceGate):
    gate_id = GATE_ID

    def __init__(self) -> None:
        super().__init__()
        self.sessions: list[SimulatorAppiumSession] = []
        self.lifecycle: list[dict[str, Any]] = []

    def run(self) -> dict[str, Any]:
        raise GateError(
            "SimulatorLayoutAccessibilityGate uses its evidence-aware execute entrypoint"
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
                result = self._run_audit(artifacts, manifest)
                status = "PASS"
                completion_status = "DONE"
                proof_status = "PROVEN"
                exit_code = 0
            except SimulatorGateBlocked as error:
                status = "BLOCKED"
                completion_status = "BLOCKED"
                result = self._result("BLOCKED")
                result.update(
                    {
                        "blockedReason": redact_text(error.reason),
                        "blockedResource": error.resource,
                    }
                )
                exit_code = 2
            except (DriverError, GateError, ProvisioningError) as error:
                result = self._result("FAIL")
                result["reason"] = redact_text(str(error))
            finally:
                cleanup_error = self._cleanup_sessions()
                if cleanup_error:
                    status = "FAIL"
                    completion_status = "PARTIAL"
                    proof_status = "UNPROVEN"
                    exit_code = 1
                    result = locals().get("result", self._result("FAIL"))
                    result["cleanupReason"] = cleanup_error

            result.update(
                {
                    "status": status,
                    "completionStatus": completion_status,
                    "proofStatus": proof_status,
                    "lifecycle": list(self.lifecycle),
                }
            )
            artifacts.write_json(
                "mobile-ios-layout/result.json",
                result,
                role="mobile-ios-layout-result",
            )
            artifacts.complete(
                status=status,
                completion_status=completion_status,
                proof_status=proof_status,
                runtime={
                    "environment": ENVIRONMENT_ID,
                    "runtimeCell": "ios-simulator-current-device",
                    "viewportRoles": sorted(EXPECTED_CLIENTS.values()),
                    "physicalDeviceClaimed": False,
                },
            )

        stream = sys.stdout if exit_code == 0 else sys.stderr
        stream.write(f"{status}: {self.gate_id}\n")
        return exit_code

    def _load_manifest(self) -> dict[str, Any]:
        manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
        if not manifest_path:
            raise SimulatorGateBlocked(
                "PT_ACCEPTANCE_RUNTIME_MANIFEST is required",
                "mobile-simulator:manifest",
            )
        manifest = load_runtime_manifest(Path(manifest_path), self.gate_id)
        if manifest.get("environmentId") != ENVIRONMENT_ID:
            raise SimulatorGateBlocked(
                f"RuntimeManifest environment must be {ENVIRONMENT_ID}",
                f"{ENVIRONMENT_ID}:environment",
            )
        return manifest

    def _run_audit(
        self,
        artifacts: ArtifactSession,
        manifest: Mapping[str, Any],
    ) -> dict[str, Any]:
        source = _validate_source_identity(manifest)
        resources = _required_object(manifest, "mobileSimulator", "RuntimeManifest")
        specs = self._ios_specs(resources)
        appium = _required_object(
            resources,
            "appium",
            f"{ENVIRONMENT_ID} resources",
        )
        server_url = _required_text(
            appium,
            "serverUrl",
            f"{ENVIRONMENT_ID} Appium",
        )
        cells: dict[str, Any] = {}
        for spec in specs:
            session = SimulatorAppiumSession(
                UrllibAppiumTransport(server_url),
                client_id=spec["clientId"],
                platform="ios",
                automation_name=spec["automationName"],
                device=spec["device"],
                build=spec["build"],
                callback_scheme=spec["callbackScheme"],
                ports=spec["ports"],
            )
            self.sessions.append(session)
            cells[spec["viewportRole"]] = self._run_cell(
                artifacts,
                session,
                spec,
            )

        artifacts.write_json(
            "mobile-ios-layout/source-identity.json",
            {
                "artifactKind": "mobile-ios-layout-source-identity",
                "gateId": self.gate_id,
                "environmentId": ENVIRONMENT_ID,
                "source": source,
                "runtimeManifestRunId": manifest.get("runId"),
            },
            role="mobile-ios-layout-source-identity",
        )
        return {
            **self._result("PASS"),
            "scope": PROVEN_SCOPE,
            "cells": cells,
            "doesNotProve": [
                "authenticated Shell surfaces",
                "Android",
                "physical display behavior",
                "VoiceOver or TalkBack",
                "physical-device performance",
            ],
        }

    def _run_cell(
        self,
        artifacts: ArtifactSession,
        session: SimulatorAppiumSession,
        spec: Mapping[str, Any],
    ) -> dict[str, Any]:
        cell = _required_text(spec, "viewportRole", "iOS layout cell")
        started_at = time.monotonic()
        session.start()
        self._record(f"{cell}:session-created")
        session.wait_for_ready()
        self._record(f"{cell}:native-ready")
        portrait = self._capture(
            artifacts,
            session,
            cell,
            "portrait-en",
        )
        cold_start_millis = round((time.monotonic() - started_at) * 1000)

        session.switch_to_native()
        field_ref = session.find_element(
            "class name",
            "XCUIElementTypeTextField",
        )
        session.click_element(field_ref)
        time.sleep(0.5)
        keyboard = self._capture_keyboard(artifacts, session, cell)
        session.switch_to_app_webview()
        session.execute_script(
            """
const active = document.activeElement;
if (active instanceof HTMLElement) active.blur();
return true;
"""
        )
        time.sleep(0.25)
        self._record(f"{cell}:keyboard-audited")

        switched = session.execute_async_script(SWITCH_LANGUAGE_SCRIPT)
        if (
            not isinstance(switched, dict)
            or switched.get("error")
            or not switched.get("before")
            or switched.get("before") == switched.get("after")
        ):
            raise GateError(f"Mobile language switch failed in {cell} cell")
        self._record(f"{cell}:locale-switched")
        localized = self._capture(
            artifacts,
            session,
            cell,
            "portrait-alternate-locale",
        )

        session.switch_to_native()
        session.set_orientation("LANDSCAPE")
        time.sleep(0.75)
        self._record(f"{cell}:landscape")
        landscape = self._capture(
            artifacts,
            session,
            cell,
            "landscape-alternate-locale",
        )
        session.switch_to_native()
        session.set_orientation("PORTRAIT")
        return {
            "clientId": spec["clientId"],
            "deviceName": spec["deviceName"],
            "viewportRole": cell,
            "coldStartMillis": cold_start_millis,
            "captures": {
                "portraitEnglish": portrait,
                "portraitAlternateLocale": localized,
                "landscapeAlternateLocale": landscape,
                "keyboard": keyboard,
            },
        }

    def _ios_specs(
        self,
        resources: Mapping[str, Any],
    ) -> tuple[dict[str, Any], ...]:
        appium = _required_object(
            resources,
            "appium",
            f"{ENVIRONMENT_ID} resources",
        )
        drivers = _required_object(
            appium,
            "drivers",
            f"{ENVIRONMENT_ID} Appium",
        )
        driver = _required_object(
            drivers,
            "ios",
            f"{ENVIRONMENT_ID} iOS driver",
        )
        applications = _required_object(
            resources,
            "applications",
            f"{ENVIRONMENT_ID} resources",
        )
        application = _required_object(
            applications,
            "ios",
            f"{ENVIRONMENT_ID} iOS application",
        )
        clients = _required_object(
            resources,
            "clients",
            f"{ENVIRONMENT_ID} resources",
        )
        if set(clients) != set(EXPECTED_CLIENTS):
            raise SimulatorGateBlocked(
                "iOS layout runtime requires the current iPhone client",
                f"{ENVIRONMENT_ID}:clients",
            )
        harness = _required_object(
            resources,
            "harness",
            f"{ENVIRONMENT_ID} resources",
        )
        actions = harness.get("requiredActions")
        if not isinstance(actions, list):
            raise SimulatorGateBlocked(
                "mobile-simulator Harness actions are unavailable",
                f"{ENVIRONMENT_ID}:harness-actions",
            )
        missing = sorted(set(REQUIRED_HARNESS_ACTIONS) - set(actions))
        if missing:
            raise SimulatorGateBlocked(
                "mobile-simulator Harness is missing actions: "
                + ", ".join(missing),
                f"{ENVIRONMENT_ID}:harness-actions",
            )
        build = SimulatorBuildTarget(
            platform="ios",
            artifact=Path(
                _required_text(
                    application,
                    "artifact",
                    f"{ENVIRONMENT_ID} iOS application",
                )
            ),
            application_id=_required_text(
                application,
                "id",
                f"{ENVIRONMENT_ID} iOS application",
            ),
        )
        specs: list[dict[str, Any]] = []
        for client_id, viewport_role in EXPECTED_CLIENTS.items():
            client = _required_object(
                clients,
                client_id,
                f"{ENVIRONMENT_ID} client {client_id}",
            )
            actual_role = _required_text(
                client,
                "viewportRole",
                f"{ENVIRONMENT_ID} client {client_id}",
            )
            if actual_role != viewport_role:
                raise SimulatorGateBlocked(
                    f"client {client_id} must use viewport role {viewport_role}",
                    f"{ENVIRONMENT_ID}:client:{client_id}",
                )
            specs.append(
                {
                    "clientId": client_id,
                    "viewportRole": viewport_role,
                    "deviceName": _required_text(
                        client,
                        "deviceName",
                        f"{ENVIRONMENT_ID} client {client_id}",
                    ),
                    "automationName": _required_text(
                        driver,
                        "automationName",
                        f"{ENVIRONMENT_ID} iOS driver",
                    ),
                    "device": SimulatorDeviceTarget(
                        platform="ios",
                        identifier=_required_text(
                            client,
                            "device",
                            f"{ENVIRONMENT_ID} client {client_id}",
                        ),
                        role=_required_text(
                            client,
                            "deviceRole",
                            f"{ENVIRONMENT_ID} client {client_id}",
                        ),
                    ),
                    "build": build,
                    "callbackScheme": _required_text(
                        application,
                        "callbackScheme",
                        f"{ENVIRONMENT_ID} iOS application",
                    ),
                    "ports": _required_ports(
                        client,
                        "ios",
                        f"{ENVIRONMENT_ID} client {client_id}",
                    ),
                }
            )
        return tuple(specs)

    def _capture(
        self,
        artifacts: ArtifactSession,
        session: SimulatorAppiumSession,
        cell: str,
        state: str,
    ) -> dict[str, Any]:
        session.switch_to_native()
        ax_markup = session.get_page_source()
        ax_audit = audit_accessibility_tree(ax_markup)
        screenshot_ref = artifacts.write_bytes(
            f"mobile-ios-layout/{cell}/{state}/screenshot.png",
            session.screenshot_bytes(),
            role=f"mobile-ios-layout-screenshot/{cell}/{state}",
        )
        ax_ref = artifacts.write_bytes(
            f"mobile-ios-layout/{cell}/{state}/accessibility.xml",
            _redacted_markup(ax_markup),
            role=f"mobile-ios-layout-accessibility/{cell}/{state}",
        )

        webview = session.switch_to_app_webview()
        inventory = session.require_harness(list(REQUIRED_HARNESS_ACTIONS))
        dom_audit = validate_dom_audit(
            session.execute_script(DOM_AUDIT_SCRIPT)
        )
        dom_ref = artifacts.write_bytes(
            f"mobile-ios-layout/{cell}/{state}/dom.html",
            _redacted_markup(session.get_page_source()),
            role=f"mobile-ios-layout-dom/{cell}/{state}",
        )
        self._record(f"{cell}:capture:{state}")
        return {
            "state": state,
            "webview": redact_text(webview),
            "contexts": _safe_contexts(session.contexts()),
            "harnessActions": inventory,
            "accessibilityAudit": ax_audit,
            "domAudit": dom_audit,
            "screenshot": screenshot_ref.to_dict(),
            "accessibility": ax_ref.to_dict(),
            "dom": dom_ref.to_dict(),
        }

    def _capture_keyboard(
        self,
        artifacts: ArtifactSession,
        session: SimulatorAppiumSession,
        cell: str,
    ) -> dict[str, Any]:
        session.switch_to_native()
        markup = session.get_page_source()
        audit = audit_keyboard_tree(markup)
        screenshot_ref = artifacts.write_bytes(
            f"mobile-ios-layout/{cell}/keyboard/screenshot.png",
            session.screenshot_bytes(),
            role=f"mobile-ios-layout-keyboard-screenshot/{cell}",
        )
        ax_ref = artifacts.write_bytes(
            f"mobile-ios-layout/{cell}/keyboard/accessibility.xml",
            _redacted_markup(markup),
            role=f"mobile-ios-layout-keyboard-accessibility/{cell}",
        )
        return {
            "audit": audit,
            "screenshot": screenshot_ref.to_dict(),
            "accessibility": ax_ref.to_dict(),
        }

    def _cleanup_sessions(self) -> str:
        failures: list[str] = []
        for session in reversed(self.sessions):
            try:
                session.stop()
                self._record(f"{session.client_id}:session-stopped")
            except DriverError as error:
                failures.append(redact_text(str(error)))
                self._record(f"{session.client_id}:session-stop-failed")
        self.sessions.clear()
        return "; ".join(failures)

    def _record(self, event: str) -> None:
        self.lifecycle.append(
            {
                "event": event,
                "monotonicMillis": round(time.monotonic() * 1000),
            }
        )

    @staticmethod
    def _result(status: str) -> dict[str, Any]:
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": GATE_ID,
            "gate": GATE_ID,
            "environment": ENVIRONMENT_ID,
            "runtimeCell": "ios-simulator-current-device",
            "status": status,
            "phase": "W9-B Layout/A11y",
            "bom": ["W9-B"],
            "spec": ["MS-AG08", "MS-AG11"],
            "observedScope": [PROVEN_SCOPE],
            "unprovenScope": [
                "authenticated Shell surfaces",
                "Android",
                "older iPhone generations and alternate viewport sizes",
                "physical display behavior",
                "VoiceOver or TalkBack",
                "physical-device performance",
            ],
            "sampleEmissionAllowed": status == "PASS",
        }


def main() -> int:
    return SimulatorLayoutAccessibilityGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
