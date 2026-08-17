#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def load_sampler_module():
    script = Path(__file__).with_name("desktop-performance-sampler-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_sampler_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def mirror_metadata() -> dict:
    return {
        "artifactKind": "desktop-performance-station-mirror",
        "phase": "P0a-6/P0c-5",
        "bom": ["BOM-CAP-05", "BOM-RUN-05"],
        "spec": ["SPEC-STA-03", "SPEC-MIRROR-01"],
        "gate": "Dev/CI mirror artifact must preserve Station query evidence without becoming the product telemetry sink",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "productSink": "Station",
        "mirrorRole": "Dev/CI evidence artifact",
    }


def complete_station_mirror() -> dict:
    return {
        **mirror_metadata(),
        "schemaVersion": 1,
        "source": "station-query",
        "stationUrl": "http://127.0.0.1:18080",
        "filters": {"runtime": "browser-gateway"},
        "summary": {"eventCount": 11, "rollupCount": 1, "maxP95DurationMs": 42},
        "rollups": [{"kind": "route.visible", "p50DurationMs": 30, "p95DurationMs": 42}],
        "events": [
            {"kind": "interaction.started", "interactionId": "i-1"},
            {"kind": "route.visible", "durationMs": 42, "interactionId": "i-1"},
            {
                "kind": "react.commit",
                "durationMs": 10,
                "interactionId": "i-1",
                "module": "ready-shell",
                "owner": "ready-shell",
                "source": "shell",
            },
            {
                "kind": "store.update",
                "durationMs": 3,
                "interactionId": "i-1",
                "module": "socialChat",
                "owner": "socialChat",
                "source": "store",
                "data": {
                    "changedKeys": ["selectedConversationId"],
                    "fanout": 3,
                    "listenerCount": 3,
                    "store": "socialChat",
                },
            },
            {
                "kind": "contextmenu.intent",
                "interactionId": "i-1",
                "module": "context-menu:chat:friend:abc",
                "owner": "context-menu:chat:friend:abc",
                "phase": "interaction",
                "source": "overlay",
                "data": {
                    "overlayTarget": "context-menu:chat:friend:abc",
                    "surface": "chat-conversation-context-menu",
                },
            },
            {
                "kind": "overlay.visible",
                "durationMs": 32,
                "interactionId": "i-1",
                "module": "context-menu:chat:friend:abc",
                "owner": "context-menu:chat:friend:abc",
                "phase": "interaction",
                "source": "overlay",
                "data": {
                    "open": True,
                    "overlayTarget": "context-menu:chat:friend:abc",
                    "surface": "chat-conversation-context-menu",
                },
            },
            {
                "kind": "invoke.started",
                "interactionId": "i-1",
                "module": "telemetry_frontend",
                "owner": "telemetry_frontend_upload",
                "phase": "interaction",
                "source": "invoke",
                "data": {"command": "telemetry_frontend_upload", "quiet": False},
            },
            {
                "kind": "invoke.completed",
                "durationMs": 18,
                "interactionId": "i-1",
                "module": "telemetry_frontend",
                "owner": "telemetry_frontend_upload",
                "phase": "interaction",
                "source": "invoke",
                "data": {"command": "telemetry_frontend_upload", "quiet": False, "status": "ok"},
            },
            {
                "kind": "longtask.detected",
                "durationMs": 40,
                "interactionId": "i-1",
                "module": "main-thread",
                "owner": "runtime",
                "source": "runtime",
                "data": {"thresholdMs": 50},
            },
            {
                "kind": "layout.shift",
                "durationMs": 0,
                "interactionId": "i-1",
                "module": "main-thread",
                "owner": "runtime",
                "source": "runtime",
                "data": {"thresholdMs": 1},
            },
            {
                "kind": "paint.timing",
                "durationMs": 12,
                "interactionId": "i-1",
                "module": "main-thread",
                "owner": "runtime",
                "source": "runtime",
            },
        ],
    }


class DesktopPerformanceSamplerGateTest(unittest.TestCase):
    def test_default_inputs_persist_typed_refs_without_artifact_root_paths(self) -> None:
        module = load_sampler_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "artifact-root"
            output_prefix = Path(tmp) / "sampler"

            def fake_latest_path(gate_id: str, role: str) -> Path:
                return root / gate_id / role.replace("/", "-")

            def fake_latest_artifact(
                gate_id: str,
                role: str,
            ) -> tuple[Path, dict]:
                return fake_latest_path(gate_id, role), {
                    "workspaceId": "workspace",
                    "gateId": gate_id,
                    "runId": "run",
                    "path": role,
                }

            def fake_build_report(*paths: Path) -> dict:
                return {
                    "status": "diagnostic incomplete",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "resolvedInputs": [str(path) for path in paths],
                }

            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-performance-sampler-gate.py",
                    "--output-prefix",
                    str(output_prefix),
                ]
                with mock.patch.object(
                    module,
                    "latest_artifact",
                    side_effect=fake_latest_artifact,
                ), mock.patch.object(
                    module,
                    "build_report",
                    side_effect=fake_build_report,
                ), mock.patch.object(
                    module,
                    "render_markdown",
                    return_value="sampler\n",
                ):
                    module.main()
            finally:
                sys.argv = old_argv

            persisted = output_prefix.with_suffix(".json").read_text(encoding="utf-8")

        self.assertNotIn(str(root), persisted)
        self.assertIn('"inputArtifactRefs"', persisted)
        self.assertIn('"workspaceId": "workspace"', persisted)

    def test_missing_station_mirror_is_partial_unproven(self) -> None:
        module = load_sampler_module()
        with tempfile.TemporaryDirectory() as tmp:
            report = module.build_report(Path(tmp) / "missing-station.json")

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["sourceArtifactKind"], "desktop-performance-sampler-gate")
        self.assertEqual(report["sourcePhase"], "P0b-2/P0b-3/P0b-4/P0b-5/P0b-6/P0b-7/P0c-5")
        self.assertIn("BOM-SMP-02", report["sourceBom"])
        self.assertIn("BOM-RUN-05", report["sourceBom"])
        self.assertIn("SPEC-SMP-REACT-01", report["sourceSpec"])
        self.assertIn("SPEC-MIRROR-01", report["sourceSpec"])
        self.assertEqual(report["sourceGate"], report["gate"])
        self.assertEqual(report["stationMirrorSource"]["status"], "missing")
        self.assertEqual(report["summary"]["stationMirrorStatus"], "missing")
        self.assertEqual(report["summary"]["stationMirrorProofStatus"], "UNPROVEN")
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["samplerFamilyCount"], 6)
        self.assertEqual(report["summary"]["provenSamplerCount"], 0)
        self.assertEqual(report["summary"]["unprovenSamplerCount"], 6)
        self.assertEqual(
            report["summary"]["unprovenSamplers"],
            [
                "interaction-correlation",
                "react-commit",
                "store-update",
                "overlay-latency",
                "invoke",
                "main-thread",
            ],
        )
        self.assertEqual(report["summary"]["blockedScopeCount"], 7)
        self.assertIn("station-mirror-source", report["summary"]["blockedScopes"])
        self.assertIn("sampler:react-commit", report["summary"]["blockedScopes"])
        self.assertEqual(report["failedStep"], "station-mirror-source")
        self.assertEqual(report["summary"]["failedStep"], "station-mirror-source")
        self.assertEqual(report["summary"]["primaryIssueCategory"], "station-mirror-source")
        self.assertEqual(report["summary"]["primaryIssueSourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertIn("missing Station mirror report", report["reason"])
        self.assertIn(
            "6 sampler families are not proven: interaction-correlation, react-commit, store-update, overlay-latency, invoke, main-thread",
            report["reason"],
        )
        self.assertEqual(report["blockedReasons"][0]["scope"], "station-mirror-source")
        self.assertEqual(report["blockedReasons"][0]["sourceArtifact"], str(Path(tmp) / "missing-station.json"))
        self.assertEqual(report["blockedReasons"][0]["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(report["blockedReasons"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["blockedReasons"][0]["sourceProofStatus"], "UNPROVEN")
        self.assertTrue(
            any(item["command"] == "make desktop" for item in report["blockedReasons"][0]["recommendedReviewCommands"])
        )
        react_reason = next(item for item in report["blockedReasons"] if item["scope"] == "sampler:react-commit")
        self.assertEqual(react_reason["sourceArtifact"], str(Path(tmp) / "missing-station.json"))
        self.assertEqual(react_reason["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(react_reason["completionStatus"], "PARTIAL")
        self.assertEqual(react_reason["sourceProofStatus"], "UNPROVEN")
        self.assertTrue(
            any("desktop-performance-sampler-gate.py" in item["command"] for item in react_reason["recommendedReviewCommands"])
        )
        for reason in report["blockedReasons"]:
            self.assertEqual(reason["completionStatus"], "PARTIAL")
            self.assertEqual(reason["proofStatus"], "UNPROVEN")
            self.assertFalse(reason["sampleEmissionAllowed"])
        self.assertEqual(report["issue_breakdown"][0]["category"], "station-mirror-source")
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifact"], str(Path(tmp) / "missing-station.json"))
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(report["issue_breakdown"][0]["sourcePhase"], "P0a-6/P0c-5")
        self.assertEqual(report["issue_breakdown"][0]["sourceBom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(report["issue_breakdown"][0]["sourceSpec"], ["SPEC-STA-03", "SPEC-MIRROR-01"])
        self.assertEqual(
            report["issue_breakdown"][0]["sourceGate"],
            "Station mirror artifact must preserve Station query evidence",
        )
        for issue in report["issue_breakdown"]:
            self.assertEqual(issue["completionStatus"], "PARTIAL")
            self.assertEqual(issue["proofStatus"], "UNPROVEN")
            self.assertFalse(issue["sampleEmissionAllowed"])
        self.assertIn("missing Station mirror report", report["issue_breakdown"][0]["evidenceDetails"][0])
        self.assertTrue(
            any(item["command"] == "make desktop" for item in report["issue_breakdown"][0]["recommended_review_commands"])
        )
        self.assertEqual(report["issueBreakdown"], report["issue_breakdown"])
        self.assertTrue(
            any(item["command"] == "make desktop" for item in report["recommended_review_commands"])
        )
        self.assertEqual(report["recommendedReviewCommands"], report["recommended_review_commands"])
        self.assertEqual({sampler["proofStatus"] for sampler in report["samplers"]}, {"UNPROVEN"})
        react_sampler = next(sampler for sampler in report["samplers"] if sampler["samplerId"] == "react-commit")
        self.assertEqual(react_sampler["sourceArtifact"], str(Path(tmp) / "missing-station.json"))
        self.assertEqual(react_sampler["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(react_sampler["sourcePhase"], "P0b-3/P0c-5")
        self.assertEqual(react_sampler["sourceBom"], ["BOM-SMP-02", "BOM-RUN-05", "BOM-CAP-05"])
        self.assertEqual(react_sampler["sourceSpec"], ["SPEC-SMP-REACT-01", "SPEC-MIRROR-01", "SPEC-STA-03"])
        self.assertEqual(
            react_sampler["sourceGate"],
            "React commit sampler evidence must be present in Station mirror before report proof is allowed",
        )
        self.assertEqual(react_sampler["sourceCompletionStatus"], "PARTIAL")
        self.assertEqual(react_sampler["sourceProofStatus"], "UNPROVEN")
        self.assertEqual(react_sampler["details"][0]["sourceArtifact"], react_sampler["sourceArtifact"])
        self.assertEqual(react_sampler["details"][0]["sourceArtifactKind"], react_sampler["sourceArtifactKind"])
        markdown = module.render_markdown(report)
        self.assertIn("- Source kind: `desktop-performance-sampler-gate`", markdown)
        self.assertIn("- Source phase: `P0b-2/P0b-3/P0b-4/P0b-5/P0b-6/P0b-7/P0c-5`", markdown)
        self.assertIn("- Source BOM: `BOM-CON-02,BOM-CAP-03", markdown)
        self.assertIn("- Source Spec: `SPEC-INT-01,SPEC-SMP-REACT-01", markdown)
        self.assertIn("| Sampler | Status | Proof | Events | Source Artifact | Source Kind | Source Proof | Phase | BOM | Spec | Gate | Evidence | Reason |", markdown)
        self.assertIn(
            "React commit sampler evidence must be present in Station mirror before report proof is allowed",
            markdown,
        )

    def test_template_station_mirror_keeps_sampler_gate_unproven_with_trace(self) -> None:
        module = load_sampler_module()
        with tempfile.TemporaryDirectory() as tmp:
            mirror = Path(tmp) / "desktop-performance-latest.json"
            reason = "Station mirror has not been queried; raw event evidence remains unproven"
            review_commands = [
                {
                    "purpose": "Start the Desktop development runtime through the project entrypoint.",
                    "command": "make desktop",
                },
                {
                    "purpose": "Run the live Gateway -> Station telemetry gate and write the Dev/CI mirror artifact.",
                    "command": "python3 tooling/scripts/desktop-telemetry-live-gate.py --mirror-prefix tooling/acceptance/reports/desktop-performance-latest",
                },
            ]
            evidence_details = [
                {
                    "step": "station-query-template",
                    "status": "diagnostic incomplete",
                    "reason": reason,
                    "stationUrl": "http://127.0.0.1:18080",
                    "filters": {},
                }
            ]
            mirror.write_text(
                json.dumps(
                    {
                        "artifactKind": "desktop-performance-station-mirror",
                        "source": "station-query-template",
                        "status": "diagnostic incomplete",
                        "reason": reason,
                        "phase": "P0a-6/P0c-5",
                        "bom": ["BOM-CAP-05", "BOM-RUN-05"],
                        "spec": ["SPEC-STA-03", "SPEC-MIRROR-01"],
                        "gate": "Dev/CI mirror artifact must preserve Station query evidence without becoming the product telemetry sink",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "productSink": "Station",
                        "mirrorRole": "Dev/CI evidence artifact",
                        "summary": {"eventCount": 0, "rollupCount": 0, "maxP95DurationMs": None},
                        "events": [],
                        "rollups": [],
                        "issue_breakdown": [
                            {
                                "category": "station-mirror-source",
                                "failedStep": "station-query-template",
                                "summary": reason,
                                "proofImpact": "P0a-6/P0c-5 remains PARTIAL/UNPROVEN until Station raw events and rollups are queried from the product sink.",
                                "sourceArtifact": str(mirror),
                                "sourceArtifactKind": "desktop-performance-station-mirror",
                                "sourcePhase": "P0a-6/P0c-5",
                                "sourceBom": ["BOM-CAP-05", "BOM-RUN-05"],
                                "sourceSpec": ["SPEC-STA-03", "SPEC-MIRROR-01"],
                                "sourceGate": "Dev/CI mirror artifact must preserve Station query evidence without becoming the product telemetry sink",
                                "details": evidence_details,
                                "evidenceDetails": evidence_details,
                                "recommended_review_commands": review_commands,
                                "recommendedReviewCommands": review_commands,
                            }
                        ],
                        "recommended_review_commands": review_commands,
                        "recommendedReviewCommands": review_commands,
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(mirror)

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["stationMirrorSource"]["phase"], "P0a-6/P0c-5")
        self.assertEqual(report["stationMirrorSource"]["proofStatus"], "UNPROVEN")
        self.assertIn("Station mirror has not been queried; raw event evidence remains unproven", report["reason"])
        self.assertIn("6 sampler families are not proven", report["reason"])
        self.assertEqual(report["stationMirrorSource"]["details"][0]["step"], "station-query-template")
        self.assertEqual(
            report["stationMirrorSource"]["details"][0]["reason"],
            "Station mirror has not been queried; raw event evidence remains unproven",
        )
        station_source = next(item for item in report["blockedReasons"] if item["scope"] == "station-mirror-source")
        self.assertEqual(station_source["sourceArtifact"], str(mirror))
        self.assertEqual(station_source["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(station_source["completionStatus"], "PARTIAL")
        self.assertEqual(station_source["sourceProofStatus"], "UNPROVEN")
        self.assertEqual(station_source["evidenceDetails"][0]["step"], "station-query-template")
        self.assertTrue(
            any("desktop-telemetry-live-gate.py --mirror-prefix" in item["command"] for item in station_source["recommendedReviewCommands"])
        )

    def test_dom_anchor_blocker_keeps_sampler_gate_unproven_before_station_mirror_sampling(self) -> None:
        module = load_sampler_module()
        with tempfile.TemporaryDirectory() as tmp:
            mirror = Path(tmp) / "desktop-performance-latest.json"
            mirror.write_text(
                json.dumps(
                    {
                        "artifactKind": "desktop-performance-station-mirror",
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "phase": "P0a-6/P0c-5",
                        "bom": ["BOM-CAP-05", "BOM-RUN-05"],
                        "spec": ["SPEC-STA-03", "SPEC-MIRROR-01"],
                        "gate": "Dev/CI mirror artifact must preserve Station query evidence without becoming the product telemetry sink",
                        "summary": {"eventCount": 0, "rollupCount": 0},
                        "events": [],
                        "rollups": [],
                    }
                ),
                encoding="utf-8",
            )
            dom_gate = Path(tmp) / "desktop-anchor-dom-evidence-gate-latest.json"
            dom_gate.write_text(
                json.dumps(
                    {
                        "artifactKind": "desktop-anchor-dom-evidence-gate",
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "summary": {
                            "blockedRuntimeCells": [
                                {
                                    "runtimeCell": "tauri-webview-dev",
                                    "blockedByStep": "tauri-webview-dev.dom_anchors",
                                    "blockedByGate": "Browser and Tauri/WebView DOM automation must prove every required anchor by selector and count",
                                    "proofStatus": "UNPROVEN",
                                    "provenCount": 0,
                                    "requiredCount": 9,
                                    "missingAnchors": ["primary-nav", "secondary-tab"],
                                    "blockedDownstreamSteps": [
                                        "p0b.sampler_collection",
                                        "p0b.station_sampler_mirror",
                                        "p0c.runtime_matrix_samples",
                                        "p0c.red_line_proof",
                                    ],
                                }
                            ],
                            "blockedBySteps": ["tauri-webview-dev.dom_anchors"],
                            "blockedDownstreamSteps": [
                                "p0b.sampler_collection",
                                "p0b.station_sampler_mirror",
                                "p0c.runtime_matrix_samples",
                                "p0c.red_line_proof",
                            ],
                        },
                    }
                ),
                encoding="utf-8",
            )

            report = module.build_report(mirror, dom_gate)

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["domAnchorGateStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["domAnchorGateProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["domAnchorBlockedBySteps"], ["tauri-webview-dev.dom_anchors"])
        self.assertIn("dom-anchor:tauri-webview-dev", report["summary"]["blockedScopes"])
        self.assertIn("DOM anchor blockers prevent sampler collection: tauri-webview-dev.dom_anchors", report["reason"])
        dom_reason = next(item for item in report["blockedReasons"] if item["scope"] == "dom-anchor:tauri-webview-dev")
        self.assertEqual(dom_reason["sourceArtifact"], str(dom_gate))
        self.assertEqual(dom_reason["sourceArtifactKind"], "desktop-anchor-dom-evidence-gate")
        self.assertEqual(dom_reason["sourcePhase"], "P0b-1")
        self.assertEqual(dom_reason["sourceBom"], ["BOM-SMP-01"])
        self.assertEqual(dom_reason["sourceSpec"], ["SPEC-ANCHOR-01"])
        self.assertEqual(dom_reason["blockedByStep"], "tauri-webview-dev.dom_anchors")
        self.assertEqual(dom_reason["blockedDownstreamSteps"][0], "p0b.sampler_collection")
        dom_issue = next(issue for issue in report["issue_breakdown"] if issue["category"] == "dom-anchor-blocker")
        self.assertEqual(dom_issue["failedStep"], "dom-anchor:tauri-webview-dev")
        self.assertEqual(dom_issue["sourceArtifact"], str(dom_gate))
        markdown = module.render_markdown(report)
        self.assertIn("DOM anchor blocked by steps: `tauri-webview-dev.dom_anchors`", markdown)
        self.assertIn("`dom-anchor:tauri-webview-dev`", markdown)

    def test_complete_station_mirror_proves_all_sampler_families(self) -> None:
        module = load_sampler_module()
        with tempfile.TemporaryDirectory() as tmp:
            mirror = Path(tmp) / "station.json"
            mirror.write_text(json.dumps(complete_station_mirror()), encoding="utf-8")
            report = module.build_report(mirror)

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["stationMirrorStatus"], "loaded")
        self.assertEqual(report["summary"]["stationMirrorProofStatus"], "PROVEN")
        self.assertTrue(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["samplerFamilyCount"], 6)
        self.assertEqual(report["summary"]["provenSamplerCount"], 6)
        self.assertEqual(report["summary"]["unprovenSamplerCount"], 0)
        self.assertEqual(report["summary"]["blockedScopeCount"], 0)
        self.assertEqual(report["summary"]["blockedScopes"], [])
        self.assertEqual(report["summary"]["unprovenSamplers"], [])
        self.assertEqual(report["reason"], "Sampler evidence is proven")
        self.assertEqual(report["blockedReasons"], [])
        self.assertNotIn("issue_breakdown", report)
        self.assertNotIn("recommended_review_commands", report)
        self.assertEqual({sampler["status"] for sampler in report["samplers"]}, {"loaded"})
        self.assertEqual({sampler["proofStatus"] for sampler in report["samplers"]}, {"PROVEN"})
        react_sampler = next(sampler for sampler in report["samplers"] if sampler["samplerId"] == "react-commit")
        self.assertEqual(react_sampler["sourceArtifact"], str(mirror))
        self.assertEqual(react_sampler["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(react_sampler["sourceCompletionStatus"], "DONE")
        self.assertEqual(react_sampler["sourceProofStatus"], "PROVEN")
        self.assertEqual(react_sampler["sourcePhase"], "P0b-3/P0c-5")
        self.assertEqual(
            react_sampler["sourceGate"],
            "React commit sampler evidence must be present in Station mirror before report proof is allowed",
        )
        sampler_ids = {sampler["samplerId"] for sampler in report["samplers"]}
        self.assertEqual(
            sampler_ids,
            {
                "interaction-correlation",
                "react-commit",
                "store-update",
                "overlay-latency",
                "invoke",
                "main-thread",
            },
        )

    def test_main_writes_outputs_and_returns_nonzero_when_unproven(self) -> None:
        module = load_sampler_module()
        with tempfile.TemporaryDirectory() as tmp:
            output_prefix = Path(tmp) / "sampler-gate"
            runtime_closure = Path(tmp) / "runtime-closure.json"
            runtime_closure.write_text(
                json.dumps(
                    {
                        "artifactKind": "desktop-telemetry-runtime-closure-gate",
                        "phase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                        "bom": ["BOM-RUN-03", "BOM-RUN-04", "BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"],
                        "spec": ["SPEC-GW-01", "SPEC-STA-01", "SPEC-STA-02", "SPEC-DB-01", "SPEC-DB-02", "SPEC-STA-03", "SPEC-MIRROR-01"],
                        "gate": "P0a Station runtime proof must use a managed Station+Postgres dependency closure before Gateway upload, route probe, query, rollup, mirror, or runtime sample emission can be trusted",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "sampleEmissionAllowed": False,
                        "managedRuntimeClosure": None,
                        "summary": {
                            "localRuntimeClosureProofStatus": "UNPROVEN",
                            "composeRuntimeClosureProofStatus": "UNPROVEN",
                            "dockerDaemonProofStatus": "UNPROVEN",
                            "failedCheckCount": 3,
                            "checkReasons": {
                                "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                "docker-daemon": "command exited 1",
                            },
                            "failedCheckReasons": {
                                "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                "docker-daemon": "command exited 1",
                            },
                            "localRuntimeClosure": {
                                "proofStatus": "UNPROVEN",
                                "sampleEmissionAllowed": False,
                                "failedChecks": ["local-dev-store-dsn"],
                            },
                            "composeRuntimeClosure": {
                                "proofStatus": "UNPROVEN",
                                "sampleEmissionAllowed": False,
                                "failedChecks": ["docker-daemon"],
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )
            local_buffer = Path(tmp) / "local-buffer.json"
            local_buffer.write_text(
                json.dumps(
                    {
                        "artifactKind": "desktop-local-telemetry-buffer-gate",
                        "phase": "P0b-2/P0b-3/P0b-4/P0b-5/P0b-6/P0b-7/P0c-5",
                        "bom": [
                            "BOM-CON-02",
                            "BOM-CAP-03",
                            "BOM-SMP-02",
                            "BOM-SMP-03",
                            "BOM-SMP-04",
                            "BOM-SMP-05",
                            "BOM-SMP-06",
                            "BOM-RUN-05",
                            "BOM-CAP-05",
                        ],
                        "spec": [
                            "SPEC-INT-01",
                            "SPEC-SMP-REACT-01",
                            "SPEC-SMP-STORE-01",
                            "SPEC-SMP-OVERLAY-01",
                            "SPEC-SMP-INVOKE-01",
                            "SPEC-SMP-MAIN-01",
                            "SPEC-MIRROR-01",
                            "SPEC-STA-03",
                        ],
                        "gate": "Local Desktop telemetry buffer diagnostics must prove sampler event families and interactionId presence without replacing Station mirror evidence",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "sampleEmissionAllowed": False,
                        "summary": {
                            "eventCount": 500,
                            "droppedCount": 42938,
                            "requiredObservationFields": [
                                "source",
                                "runtime",
                                "url",
                                "readyState",
                                "eventCount",
                                "maxEvents",
                                "droppedCount",
                                "byKind",
                                "withInteraction",
                                "droppedByKind",
                                "droppedWithInteraction",
                            ],
                            "presentObservationFields": [
                                "source",
                                "runtime",
                                "url",
                                "readyState",
                                "eventCount",
                                "droppedCount",
                                "byKind",
                                "withInteraction",
                            ],
                            "missingObservationFields": [
                                "maxEvents",
                                "droppedByKind",
                                "droppedWithInteraction",
                            ],
                            "observationTemplateJsonPath": "tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json",
                            "observationTemplateMarkdownPath": "tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.md",
                            "retentionWindowStatus": "diagnostic incomplete",
                            "retentionWindowProofStatus": "UNPROVEN",
                            "retentionWindowDroppedInteractionAttributionValid": True,
                            "retentionWindowReason": "local telemetry snapshot is only the retained tail window because events were dropped",
                        },
                        "retentionWindow": {
                            "droppedCount": 42938,
                            "droppedByKind": {},
                            "droppedWithInteraction": {},
                            "tailWindowOnly": True,
                            "reason": "local telemetry snapshot is only the retained tail window because events were dropped",
                        },
                        "droppedByKind": {},
                        "droppedWithInteraction": {},
                        "issue_breakdown": [
                            {
                                "category": "local-telemetry-buffer",
                                "failedStep": "local-buffer-drops",
                                "summary": "local telemetry buffer dropped events before diagnostics completed",
                                "details": [
                                    {
                                        "droppedCount": 42938,
                                        "droppedByKind": {},
                                        "droppedWithInteraction": {},
                                        "tailWindowOnly": True,
                                        "reason": "local telemetry snapshot is only the retained tail window because events were dropped",
                                    }
                                ],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-performance-sampler-gate.py",
                    "--station-mirror-report",
                    str(Path(tmp) / "missing-station.json"),
                    "--runtime-closure-report",
                    str(runtime_closure),
                      "--local-telemetry-buffer-report",
                      str(local_buffer),
                    "--anchor-dom-evidence-gate-report",
                    str(Path(tmp) / "missing-dom-gate.json"),
                    "--output-prefix",
                    str(output_prefix),
                ]
                exit_code = module.main()
            finally:
                sys.argv = old_argv

            written = json.loads(output_prefix.with_suffix(".json").read_text(encoding="utf-8"))
            markdown = output_prefix.with_suffix(".md").read_text(encoding="utf-8")

        self.assertEqual(exit_code, 1)
        self.assertEqual(written["status"], "diagnostic incomplete")
        self.assertIn("6 sampler families are not proven", written["reason"])
        self.assertIn("Runtime closure does not permit trusted sampler evidence", written["reason"])
        self.assertEqual(written["summary"]["samplerFamilyCount"], 6)
        self.assertEqual(written["summary"]["unprovenSamplerCount"], 6)
        self.assertEqual(written["summary"]["blockedScopeCount"], 9)
        self.assertIn("runtime-closure", written["summary"]["blockedScopes"])
        self.assertIn("local-telemetry-buffer", written["summary"]["blockedScopes"])
        self.assertEqual(written["summary"]["runtimeClosureProofStatus"], "UNPROVEN")
        self.assertFalse(written["summary"]["runtimeClosureSampleEmissionAllowed"])
        self.assertIn("docker-daemon", written["summary"]["runtimeClosureFailedCheckReasons"])
        self.assertIn("local-dev-store-dsn", written["summary"]["runtimeClosureCheckReasons"])
        self.assertEqual(
            written["summary"]["runtimeClosureLocalRuntimeClosure"]["failedChecks"],
            ["local-dev-store-dsn"],
        )
        self.assertEqual(
            written["summary"]["runtimeClosureComposeRuntimeClosure"]["failedChecks"],
            ["docker-daemon"],
        )
        self.assertEqual(written["summary"]["localTelemetryBufferStatus"], "diagnostic incomplete")
        self.assertEqual(written["summary"]["localTelemetryBufferProofStatus"], "UNPROVEN")
        self.assertFalse(written["summary"]["localTelemetryBufferSampleEmissionAllowed"])
        self.assertTrue(
            written["summary"]["localTelemetryBufferRetentionWindowDroppedInteractionAttributionValid"]
        )
        self.assertEqual(
            written["summary"]["localTelemetryBufferRetentionWindowReason"],
            "local telemetry snapshot is only the retained tail window because events were dropped",
        )
        self.assertEqual(
            written["summary"]["localTelemetryBufferMissingObservationFields"],
            ["maxEvents", "droppedByKind", "droppedWithInteraction"],
        )
        self.assertEqual(
            written["summary"]["localTelemetryBufferPresentObservationFields"],
            [
                "source",
                "runtime",
                "url",
                "readyState",
                "eventCount",
                "droppedCount",
                "byKind",
                "withInteraction",
            ],
        )
        self.assertEqual(
            written["summary"]["localTelemetryBufferObservationTemplateJsonPath"],
            "tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json",
        )
        self.assertEqual(written["summary"]["localTelemetryBufferDroppedByKind"], {})
        self.assertEqual(written["summary"]["localTelemetryBufferDroppedWithInteraction"], {})
        main_thread_sampler = next(sampler for sampler in written["samplers"] if sampler["samplerId"] == "main-thread")
        self.assertEqual(main_thread_sampler["sourceArtifact"], str(Path(tmp) / "missing-station.json"))
        self.assertEqual(main_thread_sampler["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(main_thread_sampler["sourcePhase"], "P0b-7/P0c-5")
        self.assertEqual(main_thread_sampler["sourceProofStatus"], "UNPROVEN")
        self.assertEqual(main_thread_sampler["details"][0]["sourceSpec"], main_thread_sampler["sourceSpec"])
        local_buffer_blocker = next(
            item for item in written["blockedReasons"] if item.get("scope") == "local-telemetry-buffer"
        )
        self.assertEqual(local_buffer_blocker["evidenceDetails"][0]["droppedCount"], 42938)
        self.assertTrue(local_buffer_blocker["evidenceDetails"][0]["tailWindowOnly"])
        self.assertEqual(
            local_buffer_blocker["missingObservationFields"],
            ["maxEvents", "droppedByKind", "droppedWithInteraction"],
        )
        self.assertEqual(
            local_buffer_blocker["observationTemplateJsonPath"],
            "tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json",
        )
        self.assertTrue(any(issue["category"] == "runtime-closure-unproven" for issue in written["issue_breakdown"]))
        self.assertTrue(any(issue["category"] == "local-telemetry-buffer-unproven" for issue in written["issue_breakdown"]))
        self.assertTrue(any(item["command"] == "make desktop" for item in written["recommended_review_commands"]))
        self.assertIn("Desktop Performance Sampler Gate", markdown)
        self.assertIn("PARTIAL", markdown)
        self.assertIn("Runtime closure proof: `UNPROVEN`", markdown)
        self.assertIn('"docker-daemon": "command exited 1"', markdown)
        self.assertIn("Runtime closure local closure proof: `UNPROVEN`", markdown)
        self.assertIn("Runtime closure compose closure proof: `UNPROVEN`", markdown)
        self.assertIn("Local telemetry buffer: `diagnostic incomplete`", markdown)
        self.assertIn("Local telemetry buffer retention reason: `local telemetry snapshot is only the retained tail window because events were dropped`", markdown)
        self.assertIn("Local telemetry buffer missing observation fields: `maxEvents,droppedByKind,droppedWithInteraction`", markdown)
        self.assertIn("Local telemetry buffer observation template JSON: `tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json`", markdown)
        self.assertIn("Local telemetry buffer dropped byKind: `{}`", markdown)
        self.assertIn("6 sampler families are not proven", markdown)
        self.assertIn("Unproven samplers", markdown)
        self.assertIn("sampler:main-thread", markdown)
        self.assertIn(
            "Main-thread longtask/layout/paint evidence must either be within budget or carry an explicit exception",
            markdown,
        )
        self.assertIn("## Blocked Reasons", markdown)
        self.assertIn(f"`{Path(tmp) / 'missing-station.json'}`", markdown)
        self.assertIn("`desktop-performance-station-mirror`", markdown)
        self.assertIn("`UNPROVEN`", markdown)

    def test_local_buffer_observations_template_is_fail_closed(self) -> None:
        module = load_sampler_module()

        template = module.build_local_telemetry_buffer_observations_template()

        self.assertEqual(template["artifactKind"], "desktop-local-telemetry-buffer-observations-template")
        self.assertEqual(template["completionStatus"], "PARTIAL")
        self.assertEqual(template["proofStatus"], "UNPROVEN")
        self.assertFalse(template["sampleEmissionAllowed"])
        self.assertEqual(template["summary"]["completionStatus"], "PARTIAL")
        self.assertEqual(template["summary"]["proofStatus"], "UNPROVEN")
        self.assertFalse(template["summary"]["sampleEmissionAllowed"])
        self.assertEqual(template["sourceArtifactKind"], "desktop-local-telemetry-buffer-gate")
        self.assertEqual(template["issue_breakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(template["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(template["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(template["issue_breakdown"][0]["sampleEmissionAllowed"])


if __name__ == "__main__":
    unittest.main()
