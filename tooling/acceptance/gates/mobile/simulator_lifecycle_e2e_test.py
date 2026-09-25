from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.mobile.simulator_e2e import (
    SimulatorBuildTarget,
    SimulatorClientSpec,
    SimulatorDeviceTarget,
)
from tooling.acceptance.gates.mobile.simulator_lifecycle_e2e import (
    GATE_ID,
    REQUIRED_HARNESS_ACTIONS,
    SimulatorRuntimeLifecycleGate,
    validate_lifecycle_snapshot,
    validate_navigation_projection,
)


def lifecycle_snapshot(phase: str, generation: int) -> dict[str, Any]:
    status = "suspended" if phase == "SUSPENDED" else "ready"
    return {
        "phase": phase,
        "launchState": "station-selection",
        "generation": generation,
        "bootOrder": ["auth", "command"],
        "runtimes": [
            {"id": "auth", "status": status, "errorKey": None},
            {"id": "command", "status": status, "errorKey": None},
        ],
        "errorKey": None,
    }


class FakeRef:
    def __init__(self, path: str) -> None:
        self.path = path

    def to_dict(self) -> dict[str, str]:
        return {"path": self.path}


class FakeArtifacts:
    def __init__(self) -> None:
        self.writes: list[tuple[str, str | None]] = []

    def write_bytes(
        self,
        path: str,
        _value: bytes,
        *,
        media_type: str = "application/octet-stream",
        role: str | None = None,
    ) -> FakeRef:
        del media_type
        self.writes.append((path, role))
        return FakeRef(path)

    def write_json(
        self,
        path: str,
        _value: object,
        *,
        role: str | None = None,
    ) -> FakeRef:
        self.writes.append((path, role))
        return FakeRef(path)


class FakeSession:
    client_id = "sim-ios-peer"

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.action_payloads: list[tuple[str, dict[str, Any]]] = []
        self.navigation = {
            "primaryRouteId": "tab:chat",
            "detailKeys": [],
            "overlayRouteId": None,
        }
        self.snapshots = iter(
            (
                lifecycle_snapshot("ACTIVE", 3),
                {"snapshot": lifecycle_snapshot("SUSPENDED", 3)},
                {"snapshot": lifecycle_snapshot("ACTIVE", 4)},
                {"requested": True, "scope": "webview"},
                lifecycle_snapshot("ACTIVE", 5),
            )
        )

    def start(self) -> None:
        self.calls.append("start")

    def stop(self) -> None:
        self.calls.append("stop")

    def wait_for_ready(self, *, timeout: float | None = None) -> None:
        del timeout
        self.calls.append("wait")

    def switch_to_app_webview(
        self,
        *,
        timeout: float | None = None,
    ) -> str:
        del timeout
        self.calls.append("webview")
        return "WEBVIEW_com.peers.touch.mobile"

    def switch_to_native(self) -> None:
        self.calls.append("native")

    def require_harness(self, actions: list[str]) -> list[str]:
        self.calls.append("harness:" + ",".join(actions))
        return actions

    def call_action(
        self,
        action: str,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        self.calls.append(f"action:{action}")
        self.action_payloads.append((action, dict(payload or {})))
        if action == "navigation.snapshot":
            return dict(self.navigation)
        if action == "navigation.apply":
            return self._apply_navigation(payload or {})
        return next(self.snapshots)

    def _apply_navigation(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind = payload["kind"]
        if kind == "primary":
            self.navigation = {
                "primaryRouteId": payload["routeId"],
                "detailKeys": [],
                "overlayRouteId": None,
            }
        elif kind == "overlay.open":
            self.navigation["overlayRouteId"] = payload["route"]["routeId"]
        elif kind == "overlay.close":
            self.navigation["overlayRouteId"] = None
        elif kind == "detail.push":
            route = payload["route"]
            route_id = route["routeId"]
            suffix_field = {
                "detail:contact-profile": "actorPtid",
                "detail:moment": "postId",
                "detail:setting": "settingId",
            }[route_id]
            key = f"{route_id}:{route[suffix_field]}"
            current = [
                item
                for item in self.navigation["detailKeys"]
                if item != key
            ]
            self.navigation["detailKeys"] = [*current, key]
            self.navigation["overlayRouteId"] = None
        elif kind == "detail.pop":
            self.navigation["detailKeys"] = self.navigation["detailKeys"][:-1]
        elif kind == "reset":
            self.navigation = {
                "primaryRouteId": "tab:chat",
                "detailKeys": [],
                "overlayRouteId": None,
            }
        return {
            "primaryRouteId": self.navigation["primaryRouteId"],
            "detailKeys": list(self.navigation["detailKeys"]),
            "overlayRouteId": self.navigation["overlayRouteId"],
        }

    def get_page_source(self) -> str:
        return "<AppiumAUT />"

    def screenshot_bytes(self) -> bytes:
        return b"png"

    def contexts(self) -> list[str]:
        return ["NATIVE_APP", "WEBVIEW_com.peers.touch.mobile"]

    def is_alive(self) -> bool:
        return True

    def execute_script(self, script: str) -> dict[str, str]:
        self.calls.append(f"script:{script}")
        return {"bundleId": "com.peers.touch.mobile"}

    def get_current_url(self) -> str:
        return "peers-touch://mobile"

    def get_webview_source(self) -> str:
        return "<main>ready</main>"


class LifecycleSnapshotTests(unittest.TestCase):
    def test_accepts_ordered_runtime_snapshot(self) -> None:
        snapshot = validate_lifecycle_snapshot(
            lifecycle_snapshot("ACTIVE", 4),
            expected_phase="ACTIVE",
            minimum_generation=4,
            expected_boot_order=["auth", "command"],
        )

        self.assertEqual(snapshot["generation"], 4)

    def test_rejects_stale_generation_and_runtime_error(self) -> None:
        with self.assertRaisesRegex(GateError, "invalid or stale"):
            validate_lifecycle_snapshot(
                lifecycle_snapshot("ACTIVE", 3),
                expected_phase="ACTIVE",
                minimum_generation=4,
            )

        invalid = lifecycle_snapshot("ACTIVE", 4)
        invalid["runtimes"][0]["errorKey"] = "mobile.lifecycle.failed"
        with self.assertRaisesRegex(GateError, "is not ready"):
            validate_lifecycle_snapshot(
                invalid,
                expected_phase="ACTIVE",
            )

    def test_rejects_launch_state_drift_across_runtime_transition(self) -> None:
        snapshot = lifecycle_snapshot("ACTIVE", 4)
        snapshot["launchState"] = "access-gate-chain"

        with self.assertRaisesRegex(GateError, "launch state changed"):
            validate_lifecycle_snapshot(
                snapshot,
                expected_phase="ACTIVE",
                expected_launch_state="station-selection",
            )

class NavigationProjectionTests(unittest.TestCase):
    def test_accepts_exact_descriptor_navigation_state(self) -> None:
        projection = validate_navigation_projection(
            {
                "primaryRouteId": "tab:contacts",
                "detailKeys": ["detail:contact-profile:ptid:alice"],
                "overlayRouteId": None,
            },
            primary_route_id="tab:contacts",
            detail_keys=["detail:contact-profile:ptid:alice"],
            overlay_route_id=None,
        )

        self.assertEqual(projection["primaryRouteId"], "tab:contacts")

    def test_rejects_navigation_shape_or_state_drift(self) -> None:
        with self.assertRaisesRegex(GateError, "invalid shape"):
            validate_navigation_projection(
                {
                    "primaryRouteId": "tab:chat",
                    "detailKeys": [],
                },
                primary_route_id="tab:chat",
                detail_keys=[],
                overlay_route_id=None,
            )

        with self.assertRaisesRegex(GateError, "overlay"):
            validate_navigation_projection(
                {
                    "primaryRouteId": "tab:contacts",
                    "detailKeys": [],
                    "overlayRouteId": "overlay:add-friend",
                },
                primary_route_id="tab:contacts",
                detail_keys=[],
                overlay_route_id=None,
            )


class SimulatorRuntimeLifecycleGateTests(unittest.TestCase):
    def test_run_journeys_uses_shared_manifest_validators(self) -> None:
        gate = SimulatorRuntimeLifecycleGate()
        artifacts = FakeArtifacts()
        manifest = {
            "runId": "runtime-manifest-run",
            "credentialRefs": [],
            "mobileSimulator": {
                "appium": {"serverUrl": "http://127.0.0.1:4723"},
            },
        }

        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_lifecycle_e2e."
                "_validate_source_identity",
                return_value={
                    "commit": "source-commit",
                    "workspaceDigest": "dirty:source-digest",
                },
            ),
            patch(
                "tooling.acceptance.gates.mobile.simulator_lifecycle_e2e."
                "_validate_runtime_identity",
                return_value={"appium": "verified"},
            ),
            patch.object(gate, "_client_specs", return_value=()),
        ):
            result = gate._run_journeys(artifacts, manifest)

        self.assertEqual(result["status"], "PASS")
        self.assertIn(
            (
                "mobile-simulator-lifecycle/source-identity.json",
                "mobile-simulator-lifecycle-source-identity",
            ),
            artifacts.writes,
        )

    def test_exercises_suspend_resume_and_restart_with_monotonic_generation(
        self,
    ) -> None:
        gate = SimulatorRuntimeLifecycleGate()
        session = FakeSession()
        artifacts = FakeArtifacts()
        spec = SimulatorClientSpec(
            client_id="sim-ios-peer",
            platform="ios",
            automation_name="XCUITest",
            device=SimulatorDeviceTarget(
                platform="ios",
                identifier="ios-peer-simulator-udid",
                role="peer-ios-simulator",
            ),
            build=SimulatorBuildTarget(
                platform="ios",
                artifact=Path("/tmp/mobile.app"),
                application_id="com.peers.touch.mobile",
            ),
            callback_scheme="peers-touch",
            ports={"wda-local": 8102, "mjpeg": 9201, "webview": 9512},
            required_harness_actions=REQUIRED_HARNESS_ACTIONS,
            chromedriver_executable="",
        )

        result = gate._exercise_lifecycle(  # type: ignore[arg-type]
            artifacts,
            session,
            spec,
        )

        self.assertEqual(result["initial"]["generation"], 3)
        self.assertEqual(result["resumed"]["generation"], 4)
        self.assertEqual(result["restarted"]["generation"], 5)
        self.assertEqual(
            [
                payload
                for action, payload in session.action_payloads
                if action == "lifecycle.waitReady"
            ],
            [{}],
        )
        self.assertEqual(
            result["navigation"]["reset"],
            {
                "primaryRouteId": "tab:chat",
                "detailKeys": [],
                "overlayRouteId": None,
            },
        )
        self.assertEqual(
            [
                call
                for call in session.calls
                if call.startswith("action:")
            ],
            [
                "action:lifecycle.waitReady",
                "action:navigation.snapshot",
                "action:navigation.apply",
                "action:navigation.apply",
                "action:navigation.apply",
                "action:navigation.apply",
                "action:navigation.apply",
                "action:navigation.apply",
                "action:navigation.apply",
                "action:navigation.apply",
                "action:navigation.apply",
                "action:navigation.apply",
                "action:navigation.apply",
                "action:lifecycle.suspend",
                "action:lifecycle.resume",
                "action:lifecycle.restart",
                "action:lifecycle.snapshot",
            ],
        )

    def test_cleanup_stops_sessions_without_authenticated_purge(self) -> None:
        gate = SimulatorRuntimeLifecycleGate()
        session = FakeSession()
        artifacts = FakeArtifacts()
        gate.sessions.append(session)  # type: ignore[arg-type]

        gate._cleanup_sessions(artifacts)

        self.assertEqual(session.calls, ["stop"])
        self.assertEqual(
            artifacts.writes[-1],
            (
                "mobile-simulator-lifecycle/cleanup.json",
                "mobile-simulator-lifecycle-cleanup",
            ),
        )

    def test_acceptance_contract_trace_requires_the_supplemental_gate(
        self,
    ) -> None:
        acceptance_root = Path(__file__).resolve().parents[2]
        feature = json.loads(
            (
                acceptance_root / "features/mobile-session-lifecycle.yaml"
            ).read_text(encoding="utf-8")
        )
        capabilities = json.loads(
            (acceptance_root / "capabilities/mobile.yaml").read_text(
                encoding="utf-8"
            )
        )
        capability = next(
            item
            for item in capabilities["capabilities"]
            if item["id"] == "mobile-runtime-lifecycle"
        )
        registry = json.loads(
            (acceptance_root / "registry.yaml").read_text(encoding="utf-8")
        )
        registry_rule = next(
            item
            for item in registry["rules"]
            if item["id"] == "mobile-runtime-lifecycle"
        )
        catalog = json.loads(
            (acceptance_root / "gates.yaml").read_text(encoding="utf-8")
        )
        plan = json.loads(
            (acceptance_root / "plans/mobile-shell.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertIn(GATE_ID, feature["required_gates"])
        self.assertIn(GATE_ID, capability["required_gates"])
        self.assertIn(GATE_ID, capability["evidence"]["proven_by"])
        self.assertIn(GATE_ID, registry_rule["require"])
        self.assertEqual(
            catalog["gates"][GATE_ID]["environment"],
            "mobile-simulator",
        )
        self.assertEqual(
            catalog["gates"][GATE_ID]["provisioner"],
            "mobile-simulator",
        )
        self.assertIn(GATE_ID, plan["selected_gates"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
