#!/usr/bin/env python3
"""Required Mobile platform proof on isolated iOS Simulator clients."""

from __future__ import annotations

import time
import xml.etree.ElementTree as ET
from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactSession,
    GateError,
    REPO_ROOT,
)
from tooling.acceptance.gates.mobile.simulator_e2e import (
    SimulatorCallbackRoutingGate,
    _redacted_markup,
    _required_object,
    _required_text,
    _validate_runtime_identity,
    _validate_source_identity,
)


GATE_ID = "mobile-simulator-platform-e2e"
PERMISSION_KINDS = ("camera", "microphone", "storage", "notifications")
PERMISSION_STATUSES = {
    "not_determined",
    "granted",
    "denied",
    "restricted",
    "unsupported",
}


class SimulatorPlatformGate(SimulatorCallbackRoutingGate):
    gate_id = GATE_ID

    def _run_journeys(
        self,
        artifacts: ArtifactSession,
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

        client_results: dict[str, Any] = {}
        for spec in self._client_specs(resources):
            session = self._create_session(server_url, spec)
            self.sessions.append(session)
            session.start()
            self._record(spec.client_id, "session-created")
            if spec.platform == "ios":
                self._preflight_ios(artifacts, session, spec)
            else:
                session.wait_for_ready()
                session.switch_to_app_webview()
                session.require_harness(list(spec.required_harness_actions))
            client_results[spec.client_id] = self._exercise_platform_client(
                artifacts,
                session,
                spec.client_id,
                spec.platform,
            )

        return {
            **self._result_base("PASS"),
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "source": source_identity,
            "runtime": runtime_identity,
            "clients": client_results,
        }

    def _exercise_platform_client(
        self,
        artifacts: ArtifactSession,
        session: Any,
        client_id: str,
        platform: str,
    ) -> dict[str, Any]:
        started = time.monotonic()
        inventory = session.call_action("platform.permission.checkAll")
        if not isinstance(inventory, list):
            raise GateError("platform permission inventory is invalid")
        by_kind = {
            item.get("kind"): dict(item)
            for item in inventory
            if isinstance(item, Mapping)
        }
        if set(by_kind) != set(PERMISSION_KINDS):
            raise GateError("platform permission inventory is incomplete")
        for kind, item in by_kind.items():
            if (
                item.get("status") not in PERMISSION_STATUSES
                or not isinstance(item.get("canRequest"), bool)
            ):
                raise GateError(
                    f"platform permission {kind!r} has an invalid projection"
                )
            observed = session.call_action(
                "platform.permission.check",
                {"kind": kind},
            )
            if (
                not isinstance(observed, Mapping)
                or observed.get("kind") != kind
                or observed.get("status") != item.get("status")
                or observed.get("canRequest") != item.get("canRequest")
            ):
                raise GateError(
                    f"platform permission {kind!r} disagrees with inventory"
                )

        network = _validate_network(
            session.call_action("platform.network.read"),
            client_id,
        )
        lifecycle = session.call_action("lifecycle.snapshot")
        if (
            not isinstance(lifecycle, Mapping)
            or lifecycle.get("phase") != "ACTIVE"
            or not isinstance(lifecycle.get("generation"), int)
        ):
            raise GateError("platform lifecycle projection is invalid")

        session.switch_to_native()
        native_markup = session.get_page_source()
        accessibility_audit = _audit_accessibility_markup(
            native_markup,
            client_id,
        )
        screenshot = artifacts.write_bytes(
            f"mobile-simulator-platform/{client_id}/screenshot.png",
            session.screenshot_bytes(),
            media_type="image/png",
            role=f"mobile-simulator-platform-screenshot/{client_id}",
        )
        native_tree = artifacts.write_bytes(
            f"mobile-simulator-platform/{client_id}/native-accessibility.xml",
            _redacted_markup(native_markup),
            media_type="application/xml",
            role=f"mobile-simulator-platform-accessibility/{client_id}",
        )
        session.switch_to_app_webview()
        dom = artifacts.write_bytes(
            f"mobile-simulator-platform/{client_id}/web-dom.html",
            _redacted_markup(session.get_page_source()),
            media_type="text/html",
            role=f"mobile-simulator-platform-dom/{client_id}",
        )
        self._record(client_id, "platform-proof-captured")
        return {
            "platform": platform,
            "permissions": by_kind,
            "network": network,
            "lifecycle": dict(lifecycle),
            "accessibilityAudit": accessibility_audit,
            "diagnosticElapsedMs": round((time.monotonic() - started) * 1000),
            "screenshot": screenshot.to_dict(),
            "accessibility": native_tree.to_dict(),
            "dom": dom.to_dict(),
        }

    def _result_base(self, status: str) -> dict[str, Any]:
        result = super()._result_base(status)
        result.update(
            {
                "gateId": self.gate_id,
                "gate": self.gate_id,
                "runtimeCell": self.gate_id,
                "phase": "W7 Simulator Platform",
                "bom": ["W7-C", "W7-D"],
                "spec": ["MS-AG07", "MS-AG08", "MS-AG11"],
                "observedScope": (
                    [
                        "isolated iOS Simulator permission projections",
                        "native network and lifecycle projections",
                        "native accessibility trees, screenshots, and WebView DOM",
                    ]
                    if status == "PASS"
                    else []
                ),
                "unprovenScope": [
                    "optional physical-device hardware behavior",
                    "optional Android runtime behavior",
                    "optional VoiceOver and TalkBack traversal",
                    "optional pinned-hardware performance",
                ],
                "physicalDeviceClaimed": False,
            }
        )
        return result


def _validate_network(value: Any, client_id: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise GateError(f"{client_id} platform network readback is invalid")
    connected = value.get("connected")
    network_type = value.get("networkType")
    updated_at_ms = value.get("updatedAtMs")
    if (
        not isinstance(connected, bool)
        or network_type not in {"none", "wifi", "cellular", "ethernet", "unknown"}
        or isinstance(updated_at_ms, bool)
        or not isinstance(updated_at_ms, int)
        or updated_at_ms <= 0
        or (connected and network_type == "none")
        or (not connected and network_type != "none")
    ):
        raise GateError(f"{client_id} platform network readback is invalid")
    return dict(value)


def _audit_accessibility_markup(
    markup: str,
    client_id: str,
) -> dict[str, int]:
    try:
        root = ET.fromstring(markup)
    except (ET.ParseError, TypeError) as error:
        raise GateError(
            f"{client_id} native accessibility tree is malformed"
        ) from error
    nodes = list(root.iter())
    readable = sum(
        1
        for node in nodes
        if any(
            str(node.attrib.get(attribute, "")).strip()
            for attribute in (
                "label",
                "name",
                "value",
                "text",
                "content-desc",
                "resource-id",
            )
        )
    )
    if len(nodes) < 2 or readable == 0:
        raise GateError(
            f"{client_id} native accessibility tree has no readable semantics"
        )
    return {"nodeCount": len(nodes), "readableNodeCount": readable}


def main() -> int:
    gate: AcceptanceGate = SimulatorPlatformGate()
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
