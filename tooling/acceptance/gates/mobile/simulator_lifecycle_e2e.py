#!/usr/bin/env python3
"""Simulator proof for the Mobile runtime graph lifecycle."""

from __future__ import annotations

import sys
from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactSession,
    GateError,
    REPO_ROOT,
)
from tooling.acceptance.core.redaction import redact_value
from tooling.acceptance.gates.mobile.simulator_e2e import (
    EvidenceWriter,
    SimulatorAppiumSession,
    SimulatorCallbackRoutingGate,
    SimulatorClientSpec,
    _redacted_markup,
    _required_object,
    _required_text,
    _safe_contexts,
    _validate_runtime_identity,
    _validate_source_identity,
)


GATE_ID = "mobile-simulator-runtime-lifecycle-e2e"
ENVIRONMENT_ID = "mobile-simulator"
REQUIRED_HARNESS_ACTIONS = (
    "lifecycle.snapshot",
    "lifecycle.suspend",
    "lifecycle.resume",
    "lifecycle.restart",
)
PROVEN_SCOPE = (
    "simulator runtime-graph start, suspend, resume, restart, generation, "
    "visible-app survival, and cleanup"
)
UNPROVEN_SCOPE = (
    "Station session revalidation",
    "Station or actor switch",
    "session revocation",
    "physical OS background and foreground delivery",
    "physical Keychain or Keystore deletion failure",
    "W5 event-ingress reconciliation",
)
VALID_LAUNCH_STATES = {
    "app-boot",
    "station-selection",
    "station-handshake",
    "access-gate-chain",
    "runtime-critical",
    "shell",
    "station-change",
    "logout",
    "background",
    "resume",
}


def validate_lifecycle_snapshot(
    value: Any,
    *,
    expected_phase: str,
    minimum_generation: int = 0,
    expected_boot_order: list[str] | None = None,
    expected_launch_state: str | None = None,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "phase",
        "launchState",
        "generation",
        "bootOrder",
        "runtimes",
        "errorKey",
    }:
        raise GateError("Mobile lifecycle snapshot has an invalid shape")
    if redact_value(value) != value:
        raise GateError("Mobile lifecycle snapshot contains sensitive data")
    if value["phase"] != expected_phase:
        raise GateError(
            "Mobile lifecycle phase mismatch: "
            f"expected {expected_phase}, got {value['phase']!r}"
        )
    if value["launchState"] not in VALID_LAUNCH_STATES:
        raise GateError("Mobile lifecycle launch state is invalid")
    if (
        expected_launch_state is not None
        and value["launchState"] != expected_launch_state
    ):
        raise GateError("Mobile lifecycle launch state changed across a transition")
    generation = value["generation"]
    if (
        not isinstance(generation, int)
        or isinstance(generation, bool)
        or generation < minimum_generation
    ):
        raise GateError("Mobile lifecycle generation is invalid or stale")
    boot_order = value["bootOrder"]
    runtimes = value["runtimes"]
    if (
        not isinstance(boot_order, list)
        or not boot_order
        or any(not isinstance(runtime_id, str) or not runtime_id for runtime_id in boot_order)
        or not isinstance(runtimes, list)
    ):
        raise GateError("Mobile lifecycle runtime graph is incomplete")
    if expected_boot_order is not None and boot_order != expected_boot_order:
        raise GateError("Mobile lifecycle boot order changed across a transition")

    runtime_ids: list[str] = []
    for runtime in runtimes:
        if not isinstance(runtime, dict) or set(runtime) != {
            "id",
            "status",
            "errorKey",
        }:
            raise GateError("Mobile lifecycle runtime snapshot is invalid")
        runtime_id = runtime["id"]
        if not isinstance(runtime_id, str) or not runtime_id:
            raise GateError("Mobile lifecycle runtime identity is invalid")
        expected_status = "suspended" if expected_phase == "SUSPENDED" else "ready"
        if runtime["status"] != expected_status or runtime["errorKey"] is not None:
            raise GateError(
                f"Mobile lifecycle runtime {runtime_id!r} is not {expected_status}"
            )
        runtime_ids.append(runtime_id)
    if runtime_ids != boot_order or len(set(runtime_ids)) != len(runtime_ids):
        raise GateError("Mobile lifecycle runtime order is inconsistent")
    if value["errorKey"] is not None:
        raise GateError("Mobile lifecycle snapshot contains a transition error")
    return dict(value)


class SimulatorRuntimeLifecycleGate(
    SimulatorCallbackRoutingGate,
    AcceptanceGate,
):
    gate_id = GATE_ID

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
            "mobile-simulator lifecycle resources",
        )
        server_url = _required_text(
            appium,
            "serverUrl",
            "mobile-simulator lifecycle Appium",
        )
        client_results: dict[str, Any] = {}
        for spec in self._client_specs(resources):
            session = self._create_session(server_url, spec)
            self.sessions.append(session)
            client_results[spec.client_id] = self._exercise_lifecycle(
                artifacts,
                session,
                spec,
            )

        artifacts.write_json(
            "mobile-simulator-lifecycle/source-identity.json",
            {
                "artifactKind": "mobile-simulator-lifecycle-source-identity",
                "environmentId": ENVIRONMENT_ID,
                "gateId": self.gate_id,
                "runtimeManifestRunId": manifest.get("runId"),
                "source": source_identity,
                "runtime": runtime_identity,
            },
            role="mobile-simulator-lifecycle-source-identity",
        )
        return {
            **self._result_base("PASS"),
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "source": source_identity,
            "runtime": runtime_identity,
            "clients": client_results,
        }

    def _exercise_lifecycle(
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
            session.switch_to_app_webview()

        session.require_harness(list(REQUIRED_HARNESS_ACTIONS))
        initial = validate_lifecycle_snapshot(
            session.call_action("lifecycle.snapshot"),
            expected_phase="ACTIVE",
        )
        suspended = self._transition_snapshot(
            session,
            "lifecycle.suspend",
            "SUSPENDED",
            initial,
        )
        resumed = self._transition_snapshot(
            session,
            "lifecycle.resume",
            "ACTIVE",
            suspended,
            require_generation_advance=True,
        )
        restart = session.call_action("lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError(
                f"client {spec.client_id} returned an invalid lifecycle.restart result"
            )
        restarted = validate_lifecycle_snapshot(
            session.call_action("lifecycle.snapshot"),
            expected_phase="ACTIVE",
            minimum_generation=resumed["generation"] + 1,
            expected_boot_order=initial["bootOrder"],
            expected_launch_state=initial["launchState"],
        )
        self._record(
            spec.client_id,
            "runtime-graph-restarted",
            {"generation": restarted["generation"]},
        )

        session.switch_to_native()
        native_ax = artifacts.write_bytes(
            (
                "mobile-simulator-lifecycle/"
                f"{spec.client_id}/final/native-ax.xml"
            ),
            _redacted_markup(session.get_page_source()),
            media_type="application/xml",
            role=f"mobile-simulator-lifecycle-native-ax/{spec.client_id}",
        )
        screenshot = artifacts.write_bytes(
            (
                "mobile-simulator-lifecycle/"
                f"{spec.client_id}/final/screenshot.png"
            ),
            session.screenshot_bytes(),
            media_type="image/png",
            role=f"mobile-simulator-lifecycle-screenshot/{spec.client_id}",
        )
        webview = session.switch_to_app_webview()
        web_dom = artifacts.write_bytes(
            (
                "mobile-simulator-lifecycle/"
                f"{spec.client_id}/final/web-dom.html"
            ),
            _redacted_markup(session.get_page_source()),
            media_type="text/html",
            role=f"mobile-simulator-lifecycle-dom/{spec.client_id}",
        )
        return {
            "platform": spec.platform,
            "deviceRole": spec.device.role,
            "physicalDeviceClaimed": False,
            "contexts": _safe_contexts(session.contexts()),
            "webview": webview,
            "initial": initial,
            "suspended": suspended,
            "resumed": resumed,
            "restarted": restarted,
            "nativeAccessibility": native_ax.to_dict(),
            "screenshot": screenshot.to_dict(),
            "webDom": web_dom.to_dict(),
        }

    def _transition_snapshot(
        self,
        session: SimulatorAppiumSession,
        action: str,
        expected_phase: str,
        previous: Mapping[str, Any],
        *,
        require_generation_advance: bool = False,
    ) -> dict[str, Any]:
        result = session.call_action(action)
        if not isinstance(result, Mapping):
            raise GateError(f"Mobile lifecycle action {action!r} returned invalid data")
        minimum_generation = int(previous["generation"])
        if require_generation_advance:
            minimum_generation += 1
        snapshot = validate_lifecycle_snapshot(
            result.get("snapshot"),
            expected_phase=expected_phase,
            minimum_generation=minimum_generation,
            expected_boot_order=list(previous["bootOrder"]),
            expected_launch_state=str(previous["launchState"]),
        )
        self._record(
            session.client_id,
            action,
            {"generation": snapshot["generation"]},
        )
        return snapshot

    def _cleanup_sessions(self, artifacts: EvidenceWriter) -> None:
        for session in reversed(self.sessions):
            client_id = session.client_id
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
                    }
                )
        self.sessions.clear()
        artifacts.write_json(
            "mobile-simulator-lifecycle/cleanup.json",
            {
                "artifactKind": "mobile-simulator-lifecycle-cleanup",
                "resources": list(self.cleanup),
            },
            role="mobile-simulator-lifecycle-cleanup",
        )

    def _result_base(self, status: str) -> dict[str, Any]:
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": self.gate_id,
            "gate": self.gate_id,
            "environment": ENVIRONMENT_ID,
            "runtimeCell": "ios-simulator-and-android-emulator",
            "status": status,
            "phase": "W9-C Lifecycle",
            "bom": ["W3", "W9-C"],
            "spec": ["MS-AG02", "MS-AG05"],
            "observedScope": [PROVEN_SCOPE] if status == "PASS" else [],
            "unprovenScope": list(UNPROVEN_SCOPE),
            "physicalDeviceClaimed": False,
            "stationMocksUsed": False,
            "sampleEmissionAllowed": status == "PASS",
        }


def main() -> int:
    return SimulatorRuntimeLifecycleGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
