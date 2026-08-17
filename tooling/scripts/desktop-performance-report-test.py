#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def load_report_module():
    script = Path(__file__).with_name("desktop-performance-report.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_report", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopPerformanceReportTest(unittest.TestCase):
    def test_default_inputs_persist_typed_refs_without_artifact_root_paths(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "artifact-root"
            output_prefix = Path(tmp) / "report"

            def fake_latest_path(gate_id: str, role: str) -> Path:
                return root / gate_id / role.replace("/", "-")

            def fake_latest_ref(gate_id: str, role: str) -> dict:
                return {"workspaceId": "workspace", "gateId": gate_id, "runId": "run", "path": role}

            def fake_build_report(args: argparse.Namespace) -> dict:
                return {
                    "status": "diagnostic incomplete",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "resolvedInputs": [
                        getattr(args, attribute)
                        for attribute in (
                            "station_mirror_report",
                            "matrix_report",
                            "preflight_report",
                            "anchor_inventory_report",
                            "anchor_dom_evidence_gate_report",
                            "anchor_source_gate_report",
                            "sampler_gate_report",
                        )
                    ],
                }

            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-performance-report.py",
                    "--output-prefix",
                    str(output_prefix),
                ]
                with mock.patch.object(module, "latest_path", side_effect=fake_latest_path), mock.patch.object(
                    module,
                    "latest_ref",
                    side_effect=fake_latest_ref,
                ), mock.patch.object(
                    module,
                    "build_report",
                    side_effect=fake_build_report,
                ), mock.patch.object(
                    module,
                    "render_markdown",
                    return_value="report\n",
                ):
                    module.main()
            finally:
                sys.argv = old_argv

            persisted = output_prefix.with_suffix(".json").read_text(encoding="utf-8")

        self.assertNotIn(str(root), persisted)
        self.assertIn('"inputArtifactRefs"', persisted)
        self.assertIn('"workspaceId": "workspace"', persisted)

    def test_report_recommended_commands_are_normalized_and_deduplicated(self) -> None:
        module = load_report_module()
        commands = module.report_recommended_review_commands(
            [
                {
                    "recommended_review_commands": [
                        {
                            "purpose": "Collect DOM observations.",
                            "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
                        },
                        {
                            "purpose": "Collect DOM observations again.",
                            "command": (
                                "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py "
                                "--observations tooling/acceptance/reports/desktop-anchor-dom-observations.json"
                            ),
                        },
                        {
                            "purpose": "Start Desktop.",
                            "command": "make desktop",
                        },
                        {
                            "purpose": "Start Desktop duplicate.",
                            "command": "make desktop",
                        },
                    ]
                }
            ]
        )

        command_texts = [item["command"] for item in commands]
        self.assertEqual(command_texts.count("make desktop"), 1)
        self.assertEqual(
            command_texts.count(
                "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py "
                "--observations <desktop-anchor-dom-observations.json> "
                "--output <desktop-anchor-dom-evidence.json>"
            ),
            1,
        )

    def mirror_metadata(self) -> dict:
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

    def proven_sampler_gate(self) -> dict:
        return {
            "schemaVersion": 1,
            "artifactKind": "desktop-performance-sampler-gate",
            "status": "pass",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
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
            "gate": "Station mirror sampler evidence must prove all P0b sampler families",
            "sampleEmissionAllowed": True,
            "samplers": [
                {"samplerId": "interaction-correlation", "status": "loaded", "proofStatus": "PROVEN"},
                {"samplerId": "react-commit", "status": "loaded", "proofStatus": "PROVEN"},
                {"samplerId": "store-update", "status": "loaded", "proofStatus": "PROVEN"},
                {"samplerId": "overlay-latency", "status": "loaded", "proofStatus": "PROVEN"},
                {"samplerId": "invoke", "status": "loaded", "proofStatus": "PROVEN"},
                {"samplerId": "main-thread", "status": "loaded", "proofStatus": "PROVEN"},
            ],
        }

    def proven_preflight(self) -> dict:
        return {
            "schemaVersion": 1,
            "artifactKind": "desktop-performance-preflight",
            "status": "pass",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "phase": "P0c-1/P0c-2",
            "bom": ["BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01"],
            "spec": ["SPEC-RUN-01", "SPEC-GATE-01"],
            "gate": "Make entrypoints, Desktop Gateway, Station health, and Gateway Station binding must pass before runtime samples are emitted",
            "sampleEmissionAllowed": True,
            "checks": [],
            "issue_breakdown": [],
            "recommended_review_commands": [],
        }

    def proven_anchor_source_gate(self) -> dict:
        return {
            "schemaVersion": 1,
            "artifactKind": "desktop-anchor-source-gate",
            "status": "pass",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "phase": "P0b-1",
            "bom": ["BOM-SMP-01"],
            "spec": ["SPEC-ANCHOR-01"],
            "gate": "Desktop source must expose required stable anchors before DOM automation evidence can be accepted",
            "requiredCount": 9,
            "presentCount": 9,
            "missing": [],
            "anchors": [],
        }

    def blocked_reason(self, report: dict, scope: str) -> dict:
        matches = [item for item in report["blockedReasons"] if item["scope"] == scope]
        self.assertEqual(len(matches), 1, f"expected one blocked reason for {scope}")
        return matches[0]

    def assert_blocked_reason_has_diagnostics(self, reason: dict, scope: str) -> None:
        self.assertEqual(reason["issue_breakdown"][0]["category"], scope)
        self.assertEqual(reason["issueBreakdown"][0]["category"], scope)
        self.assertEqual(reason["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(reason["recommendedReviewCommands"][0]["command"], "make desktop")
        self.assertTrue(
            any(
                item["command"] == "python3 tooling/scripts/desktop-performance-report.py"
                for item in reason["recommended_review_commands"]
            )
        )

    def test_report_issue_breakdown_preserves_source_trace_and_details(self) -> None:
        module = load_report_module()
        issues = module.report_issue_breakdown(
            [
                {
                    "scope": "desktop-performance-preflight",
                    "reason": "Desktop Gateway is not reachable",
                    "sourceArtifact": "tooling/acceptance/reports/desktop-performance-preflight.json",
                    "sourceArtifactKind": "desktop-performance-preflight",
                    "sourcePhase": "P0c-1/P0c-2",
                    "sourceBom": ["BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01"],
                    "sourceSpec": ["SPEC-RUN-01", "SPEC-GATE-01"],
                    "sourceGate": "Make entrypoints, Desktop Gateway, Station health, and Gateway Station binding must pass",
                    "recommended_review_commands": [
                        {
                            "purpose": "Review preflight diagnostics.",
                            "command": "python3 tooling/scripts/desktop-performance-preflight.py",
                        }
                    ],
                    "evidenceDetails": [
                        {
                            "step": "desktop-gateway",
                            "status": "fail",
                            "url": "http://127.0.0.1:3030",
                        }
                    ],
                    "issue_breakdown": [
                        {
                            "category": "desktop-gateway-preflight",
                            "failedStep": "desktop-gateway",
                            "summary": "connection refused",
                            "proofImpact": "P0c remains PARTIAL/UNPROVEN.",
                        }
                    ],
                },
                {
                    "scope": "station-mirror-source",
                    "reason": "Station mirror source metadata is incomplete",
                    "sourceArtifact": "tooling/acceptance/reports/desktop-performance-latest.json",
                    "sourceArtifactKind": "desktop-performance-station-mirror",
                    "sourcePhase": "P0a-6/P0c-5",
                    "sourceBom": ["BOM-CAP-05", "BOM-RUN-05"],
                    "sourceSpec": ["SPEC-STA-03", "SPEC-MIRROR-01"],
                    "sourceGate": "Station mirror must preserve product sink evidence",
                    "recommended_review_commands": [
                        {
                            "purpose": "Review Station mirror evidence.",
                            "command": "python3 tooling/scripts/desktop-performance-sampler-gate.py",
                        }
                    ],
                    "evidenceDetails": ["missing or invalid proofStatus"],
                },
            ]
        )

        self.assertEqual(issues[0]["category"], "desktop-gateway-preflight")
        self.assertEqual(issues[0]["status"], "diagnostic incomplete")
        self.assertEqual(issues[0]["completionStatus"], "PARTIAL")
        self.assertEqual(issues[0]["proofStatus"], "UNPROVEN")
        self.assertFalse(issues[0]["sampleEmissionAllowed"])
        self.assertEqual(issues[0]["sourceArtifactKind"], "desktop-performance-preflight")
        self.assertEqual(
            issues[0]["sourceArtifact"],
            "tooling/acceptance/reports/desktop-performance-preflight.json",
        )
        self.assertEqual(issues[0]["sourcePhase"], "P0c-1/P0c-2")
        self.assertEqual(issues[0]["sourceBom"], ["BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01"])
        self.assertEqual(issues[0]["sourceSpec"], ["SPEC-RUN-01", "SPEC-GATE-01"])
        self.assertEqual(
            issues[0]["sourceGate"],
            "Make entrypoints, Desktop Gateway, Station health, and Gateway Station binding must pass",
        )
        self.assertEqual(issues[0]["evidenceDetails"][0]["step"], "desktop-gateway")
        self.assertEqual(
            issues[0]["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-performance-preflight.py",
        )
        self.assertEqual(
            issues[0]["recommendedReviewCommands"][0]["command"],
            "python3 tooling/scripts/desktop-performance-preflight.py",
        )
        self.assertEqual(issues[1]["category"], "station-mirror-source")
        self.assertEqual(issues[1]["status"], "diagnostic incomplete")
        self.assertEqual(issues[1]["completionStatus"], "PARTIAL")
        self.assertEqual(issues[1]["proofStatus"], "UNPROVEN")
        self.assertFalse(issues[1]["sampleEmissionAllowed"])
        self.assertEqual(issues[1]["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(issues[1]["sourcePhase"], "P0a-6/P0c-5")
        self.assertEqual(issues[1]["sourceBom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(issues[1]["sourceSpec"], ["SPEC-STA-03", "SPEC-MIRROR-01"])
        self.assertEqual(issues[1]["evidenceDetails"], ["missing or invalid proofStatus"])
        self.assertEqual(
            issues[1]["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-performance-sampler-gate.py",
        )

    def test_report_issue_breakdown_prefers_nested_issue_source_trace(self) -> None:
        module = load_report_module()
        issues = module.report_issue_breakdown(
            [
                {
                    "scope": "matrix",
                    "reason": "browser-gateway cell is blocked",
                    "sourceArtifact": "tooling/acceptance/reports/desktop-telemetry-live-gate-browser-gateway.json",
                    "sourceArtifactKind": "desktop-telemetry-live-gate",
                    "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                    "sourceBom": ["BOM-RUN-03"],
                    "sourceSpec": ["SPEC-GW-01"],
                    "sourceGate": "Desktop Gateway upload must pass",
                    "issueBreakdown": [
                        {
                            "category": "dom-automation-evidence",
                            "failedStep": "browser-gateway",
                            "summary": "browser-gateway shell anchors are missing",
                            "proofImpact": "P0b-1 remains PARTIAL/UNPROVEN.",
                            "sourceArtifact": "tooling/acceptance/reports/desktop-anchor-dom-evidence.json",
                            "sourceArtifactKind": "desktop-anchor-dom-evidence",
                            "sourcePhase": "P0b-1",
                            "sourceBom": ["BOM-SMP-01"],
                            "sourceSpec": ["SPEC-ANCHOR-01"],
                            "sourceGate": "DOM anchors must be proven",
                            "environmentClassification": "target-station-route-missing-while-local-source-registers-routes",
                            "localSourceRouteEvidence": {
                                "sourceKind": "local-station-source-route-registration",
                                "proofStatus": "PROVEN",
                            },
                            "evidenceDetails": [
                                {
                                    "runtime": "browser-gateway",
                                    "runtimeContext": {"pageState": "login-form-after-submit"},
                                }
                            ],
                        }
                    ],
                }
            ]
        )

        self.assertEqual(issues[0]["category"], "dom-automation-evidence")
        self.assertEqual(
            issues[0]["sourceArtifact"],
            "tooling/acceptance/reports/desktop-anchor-dom-evidence.json",
        )
        self.assertEqual(issues[0]["sourceArtifactKind"], "desktop-anchor-dom-evidence")
        self.assertEqual(issues[0]["sourcePhase"], "P0b-1")
        self.assertEqual(issues[0]["sourceBom"], ["BOM-SMP-01"])
        self.assertEqual(issues[0]["sourceSpec"], ["SPEC-ANCHOR-01"])
        self.assertEqual(issues[0]["sourceGate"], "DOM anchors must be proven")
        self.assertEqual(
            issues[0]["environmentClassification"],
            "target-station-route-missing-while-local-source-registers-routes",
        )
        self.assertEqual(issues[0]["localSourceRouteEvidence"]["proofStatus"], "PROVEN")
        self.assertEqual(issues[0]["evidenceDetails"][0]["runtimeContext"]["pageState"], "login-form-after-submit")

    def assert_station_mirror_source_trace(
        self,
        reason: dict,
        station_path: Path,
        *,
        completion_status: str = "PARTIAL",
        proof_status: str = "UNPROVEN",
    ) -> None:
        self.assertEqual(reason["sourceArtifact"], str(station_path))
        self.assertEqual(reason["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(reason["completionStatus"], completion_status)
        self.assertEqual(reason["sourceProofStatus"], proof_status)

    def test_missing_matrix_report_blocked_reason_keeps_evidence_trace(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(Path(tmp) / "missing-station.json"),
                    matrix_report=str(Path(tmp) / "missing-matrix.json"),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        matrix_reasons = [item for item in report["blockedReasons"] if item["scope"] == "matrix"]
        self.assertEqual(report["artifactKind"], "desktop-performance-report")
        self.assertEqual(report["sourceArtifactKind"], "desktop-performance-report")
        self.assertEqual(report["sourcePhase"], "P0c-5")
        self.assertEqual(report["sourceBom"], ["BOM-RUN-05", "BOM-CAP-05"])
        self.assertEqual(report["sourceSpec"], ["SPEC-MIRROR-01", "SPEC-STA-03"])
        self.assertEqual(report["sourceGate"], report["gate"])
        self.assertEqual(report["phase"], "P0c-5")
        self.assertEqual(report["bom"], ["BOM-RUN-05", "BOM-CAP-05"])
        self.assertEqual(report["spec"], ["SPEC-MIRROR-01", "SPEC-STA-03"])
        self.assertTrue(report["gate"])
        self.assertEqual(len(matrix_reasons), 1)
        self.assertEqual(matrix_reasons[0]["status"], "diagnostic incomplete")
        self.assertEqual(matrix_reasons[0]["proofStatus"], "UNPROVEN")
        self.assertEqual(matrix_reasons[0]["evidenceStatus"], "missing")
        self.assertTrue(matrix_reasons[0]["evidencePath"].endswith("missing-matrix.json"))
        self.assertFalse(matrix_reasons[0]["sampleEmissionAllowed"])
        self.assertEqual(report["issue_breakdown"][0]["category"], "matrix")
        self.assertEqual(report["issueBreakdown"][0]["category"], "matrix")
        self.assertEqual(report["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(report["recommendedReviewCommands"][0]["command"], "make desktop")
        self.assertTrue(
            any(
                command["command"] == "python3 tooling/scripts/desktop-performance-report.py"
                for command in report["recommended_review_commands"]
            )
        )
        markdown = module.render_markdown(report)
        self.assertIn("- Source kind: `desktop-performance-report`", markdown)
        self.assertIn("- Source phase: `P0c-5`", markdown)
        self.assertIn("- Source BOM: `BOM-RUN-05,BOM-CAP-05`", markdown)
        self.assertIn("- Source Spec: `SPEC-MIRROR-01,SPEC-STA-03`", markdown)
        self.assertIn("evidenceStatus=`missing`", markdown)
        self.assertIn("missing-matrix.json", markdown)

    def test_sampler_gate_blocked_reason_keeps_source_trace(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            sampler_gate = Path(tmp) / "desktop-performance-sampler-gate-latest.json"
            sampler_gate.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "artifactKind": "desktop-performance-sampler-gate",
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "reason": "Station mirror source metadata is incomplete; 6 sampler families are not proven: interaction-correlation, react-commit, store-update, overlay-latency, invoke, main-thread",
                        "phase": "P0b-2/P0b-3/P0b-4/P0b-5/P0b-6/P0b-7/P0c-5",
                        "bom": [
                            "BOM-CON-02",
                            "BOM-CAP-03",
                            "BOM-SMP-02",
                            "BOM-SMP-03",
                            "BOM-SMP-04",
                            "BOM-SMP-05",
                            "BOM-SMP-06",
                        ],
                        "spec": [
                            "SPEC-INT-01",
                            "SPEC-SMP-REACT-01",
                            "SPEC-SMP-STORE-01",
                            "SPEC-SMP-OVERLAY-01",
                            "SPEC-SMP-INVOKE-01",
                            "SPEC-SMP-MAIN-01",
                        ],
                        "gate": "Station mirror sampler evidence must prove all P0b sampler families",
                        "sampleEmissionAllowed": False,
                        "summary": {
                            "stationMirrorStatus": "diagnostic incomplete",
                            "stationMirrorProofStatus": "UNPROVEN",
                            "stationMirrorReason": "Station mirror has not been queried; raw event evidence remains unproven",
                            "samplerFamilyCount": 6,
                            "provenSamplerCount": 0,
                            "unprovenSamplerCount": 6,
                            "provenSamplers": [],
                            "unprovenSamplers": [
                                "interaction-correlation",
                                "react-commit",
                                "store-update",
                                "overlay-latency",
                                "invoke",
                                "main-thread",
                            ],
                            "blockedScopeCount": 8,
                            "blockedScopes": [
                                "dom-anchor:tauri-webview-dev",
                                "station-mirror-source",
                                "sampler:interaction-correlation",
                                "sampler:react-commit",
                                "sampler:store-update",
                                "sampler:overlay-latency",
                                "sampler:invoke",
                                "sampler:main-thread",
                            ],
                            "domAnchorGateStatus": "diagnostic incomplete",
                            "domAnchorGateProofStatus": "UNPROVEN",
                            "domAnchorBlockedBySteps": ["tauri-webview-dev.dom_anchors"],
                            "domAnchorBlockedDownstreamSteps": [
                                "p0b.sampler_collection",
                                "p0b.station_sampler_mirror",
                                "p0c.runtime_matrix_samples",
                                "p0c.red_line_proof",
                            ],
                            "runtimeClosureProofStatus": "UNPROVEN",
                            "runtimeClosureSampleEmissionAllowed": False,
                            "runtimeClosureDockerDaemonProofStatus": "UNPROVEN",
                              "runtimeClosureCheckReasons": {
                                  "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                  "docker-daemon": "command exited 1",
                              },
                              "runtimeClosureFailedCheckReasons": {
                                  "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                  "docker-daemon": "command exited 1",
                              },
                              "runtimeClosureLocalRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                                  "failedChecks": ["local-dev-store-dsn"],
                              },
                              "runtimeClosureComposeRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                                  "failedChecks": ["docker-daemon"],
                              },
                              "localTelemetryBufferStatus": "diagnostic incomplete",
                              "localTelemetryBufferProofStatus": "UNPROVEN",
                              "localTelemetryBufferSampleEmissionAllowed": False,
                              "localTelemetryBufferRequiredObservationFields": [
                                  "source",
                                  "runtime",
                                  "eventCount",
                                  "maxEvents",
                                  "droppedByKind",
                                  "droppedWithInteraction",
                              ],
                              "localTelemetryBufferPresentObservationFields": [
                                  "source",
                                  "runtime",
                                  "eventCount",
                              ],
                              "localTelemetryBufferMissingObservationFields": [
                                  "maxEvents",
                                  "droppedByKind",
                                  "droppedWithInteraction",
                              ],
                              "localTelemetryBufferObservationTemplateJsonPath": "tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json",
                              "localTelemetryBufferObservationTemplateMarkdownPath": "tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.md",
                        },
                        "issue_breakdown": [
                            {
                                "category": "dom-anchor-blocker",
                                "failedStep": "dom-anchor:tauri-webview-dev",
                                "summary": "tauri-webview-dev DOM anchors are not proven",
                                "proofImpact": "P0b sampler gate remains PARTIAL/UNPROVEN until tauri-webview-dev.dom_anchors is proven.",
                            },
                            {
                                "category": "sampler-evidence",
                                "failedStep": "sampler:react-commit",
                                "summary": "no react.commit events in Station mirror",
                                "proofImpact": "P0b sampler gate remains PARTIAL/UNPROVEN.",
                            }
                        ],
                        "issueBreakdown": [
                            {
                                "category": "dom-anchor-blocker",
                                "failedStep": "dom-anchor:tauri-webview-dev",
                                "summary": "tauri-webview-dev DOM anchors are not proven",
                                "proofImpact": "P0b sampler gate remains PARTIAL/UNPROVEN until tauri-webview-dev.dom_anchors is proven.",
                            },
                            {
                                "category": "sampler-evidence",
                                "failedStep": "sampler:react-commit",
                                "summary": "no react.commit events in Station mirror",
                                "proofImpact": "P0b sampler gate remains PARTIAL/UNPROVEN.",
                            }
                        ],
                        "recommended_review_commands": [
                            {"purpose": "Start Desktop dev runtime.", "command": "make desktop"},
                            {
                                "purpose": "Re-run sampler gate.",
                                "command": "python3 tooling/scripts/desktop-performance-sampler-gate.py",
                            },
                        ],
                        "recommendedReviewCommands": [
                            {"purpose": "Start Desktop dev runtime.", "command": "make desktop"},
                            {
                                "purpose": "Re-run sampler gate.",
                                "command": "python3 tooling/scripts/desktop-performance-sampler-gate.py",
                            },
                        ],
                        "samplers": [
                            {
                                "samplerId": "interaction-correlation",
                                "status": "diagnostic incomplete",
                                "completionStatus": "PARTIAL",
                                "proofStatus": "UNPROVEN",
                                "phase": "P0b-2/P0c-5",
                                "bom": ["BOM-CON-02", "BOM-CAP-03"],
                                "spec": ["SPEC-INT-01"],
                                "gate": "Interaction-correlated sampler event families must carry interactionId",
                                "requiredEventKinds": ["react.commit", "store.update"],
                                "eventCount": 0,
                                "linkedEventCount": 0,
                                "unlinkedEventCount": 0,
                                "evidencePath": "tooling/acceptance/reports/desktop-performance-latest.json",
                                "evidenceStatus": "loaded",
                                "reason": "no interaction-correlated event families in Station mirror",
                                "summary": {},
                            },
                            {
                                "samplerId": "react-commit",
                                "status": "diagnostic incomplete",
                                "completionStatus": "PARTIAL",
                                "proofStatus": "UNPROVEN",
                                "phase": "P0b-3/P0c-5",
                                "bom": ["BOM-SMP-02"],
                                "spec": ["SPEC-SMP-REACT-01"],
                                "gate": "React commit sampler evidence must be present in Station mirror before report proof is allowed",
                                "requiredEventKinds": ["react.commit"],
                                "eventCount": 0,
                                "linkedEventCount": None,
                                "unlinkedEventCount": None,
                                "evidencePath": "tooling/acceptance/reports/desktop-performance-latest.json",
                                "evidenceStatus": "loaded",
                                "reason": "no react.commit events in Station mirror",
                                "summary": {"commitCount": 0, "maxDurationMs": None},
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(Path(tmp) / "missing-station.json"),
                    matrix_report=str(Path(tmp) / "missing-matrix.json"),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                    sampler_gate_report=str(sampler_gate),
                )
            )

        reason = self.blocked_reason(report, "sampler-gate")
        self.assertEqual(
            reason["reason"],
            "Station mirror source metadata is incomplete; 6 sampler families are not proven: interaction-correlation, react-commit, store-update, overlay-latency, invoke, main-thread",
        )
        self.assertEqual(report["samplerGate"]["reason"], reason["reason"])
        self.assertEqual(reason["status"], "diagnostic incomplete")
        self.assertEqual(reason["proofStatus"], "UNPROVEN")
        self.assertEqual(reason["sourcePhase"], "P0b-2/P0b-3/P0b-4/P0b-5/P0b-6/P0b-7/P0c-5")
        self.assertEqual(reason["completionStatus"], "PARTIAL")
        self.assertEqual(reason["sourceArtifact"], str(sampler_gate))
        self.assertEqual(reason["sourceArtifactKind"], "desktop-performance-sampler-gate")
        self.assertFalse(reason["sampleEmissionAllowed"])
        self.assertIn("sampler gate status is not pass", reason["evidenceDetails"])
        self.assertEqual(reason["issue_breakdown"][0]["category"], "dom-anchor-blocker")
        self.assertEqual(reason["issueBreakdown"][0]["category"], "dom-anchor-blocker")
        self.assertEqual(reason["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(reason["recommendedReviewCommands"][0]["command"], "make desktop")
        self.assertEqual(report["samplerGate"]["stationMirrorStatus"], "diagnostic incomplete")
        self.assertEqual(report["samplerGate"]["stationMirrorProofStatus"], "UNPROVEN")
        self.assertEqual(report["samplerGate"]["provenSamplerCount"], 0)
        self.assertEqual(report["samplerGate"]["unprovenSamplerCount"], 6)
        self.assertEqual(report["samplerGate"]["unprovenSamplers"][-1], "main-thread")
        self.assertEqual(report["samplerGate"]["blockedScopeCount"], 8)
        self.assertEqual(report["samplerGate"]["blockedScopes"][0], "dom-anchor:tauri-webview-dev")
        self.assertEqual(report["samplerGate"]["domAnchorGateStatus"], "diagnostic incomplete")
        self.assertEqual(report["samplerGate"]["domAnchorGateProofStatus"], "UNPROVEN")
        self.assertEqual(report["samplerGate"]["domAnchorBlockedBySteps"], ["tauri-webview-dev.dom_anchors"])
        self.assertEqual(report["samplerGate"]["domAnchorBlockedDownstreamSteps"][-1], "p0c.red_line_proof")
        self.assertEqual(report["samplerGate"]["runtimeClosureProofStatus"], "UNPROVEN")
        self.assertFalse(report["samplerGate"]["runtimeClosureSampleEmissionAllowed"])
        self.assertEqual(report["samplerGate"]["runtimeClosureDockerDaemonProofStatus"], "UNPROVEN")
        self.assertEqual(report["samplerGate"]["localTelemetryBufferStatus"], "diagnostic incomplete")
        self.assertEqual(report["samplerGate"]["localTelemetryBufferProofStatus"], "UNPROVEN")
        self.assertFalse(report["samplerGate"]["localTelemetryBufferSampleEmissionAllowed"])
        self.assertEqual(
            report["samplerGate"]["localTelemetryBufferMissingObservationFields"],
            ["maxEvents", "droppedByKind", "droppedWithInteraction"],
        )
        self.assertEqual(report["samplerGate"]["samplers"][0]["samplerId"], "interaction-correlation")
        self.assertEqual(report["samplerGate"]["samplers"][1]["requiredEventKinds"], ["react.commit"])
        self.assertEqual(report["summary"]["samplerStationMirrorStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["samplerStationMirrorProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["provenSamplerCount"], 0)
        self.assertEqual(report["summary"]["unprovenSamplerCount"], 6)
        self.assertEqual(report["summary"]["unprovenSamplers"][-1], "main-thread")
        self.assertEqual(report["summary"]["samplerBlockedScopeCount"], 8)
        self.assertEqual(report["summary"]["samplerBlockedScopes"][0], "dom-anchor:tauri-webview-dev")
        self.assertEqual(report["summary"]["samplerDomAnchorGateStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["samplerDomAnchorGateProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["samplerDomAnchorBlockedBySteps"], ["tauri-webview-dev.dom_anchors"])
        self.assertEqual(report["summary"]["samplerDomAnchorBlockedDownstreamSteps"][0], "p0b.sampler_collection")
        self.assertEqual(report["summary"]["samplerRuntimeClosureProofStatus"], "UNPROVEN")
        self.assertFalse(report["summary"]["samplerRuntimeClosureSampleEmissionAllowed"])
        self.assertEqual(report["summary"]["samplerRuntimeClosureDockerDaemonProofStatus"], "UNPROVEN")
        self.assertIn("docker-daemon", report["summary"]["samplerRuntimeClosureFailedCheckReasons"])
        self.assertIn("local-dev-store-dsn", report["summary"]["samplerRuntimeClosureCheckReasons"])
        self.assertEqual(
            report["summary"]["samplerRuntimeClosureLocalRuntimeClosure"]["failedChecks"],
            ["local-dev-store-dsn"],
        )
        self.assertEqual(
            report["summary"]["samplerRuntimeClosureComposeRuntimeClosure"]["failedChecks"],
            ["docker-daemon"],
        )
        self.assertEqual(report["summary"]["samplerLocalTelemetryBufferStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["samplerLocalTelemetryBufferProofStatus"], "UNPROVEN")
        self.assertFalse(report["summary"]["samplerLocalTelemetryBufferSampleEmissionAllowed"])
        self.assertEqual(
            report["summary"]["samplerLocalTelemetryBufferMissingObservationFields"],
            ["maxEvents", "droppedByKind", "droppedWithInteraction"],
        )
        self.assertEqual(
            report["summary"]["samplerLocalTelemetryBufferObservationTemplateJsonPath"],
            "tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json",
        )
        self.assertEqual(report["summary"]["samplerSummaries"][1]["samplerId"], "react-commit")
        markdown = module.render_markdown(report)
        self.assertIn("| `samplerGate` | `loaded` |", markdown)
        self.assertIn("## Sampler Gate", markdown)
        self.assertIn("6 sampler families are not proven", markdown)
        self.assertIn(f"sourceArtifact=`{sampler_gate}`", markdown)
        self.assertIn("issues=`dom-anchor-blocker,sampler-evidence`", markdown)
        self.assertIn("- Sampler DOM anchor gate: `diagnostic incomplete`", markdown)
        self.assertIn("- Sampler DOM anchor proof: `UNPROVEN`", markdown)
        self.assertIn("- Sampler runtime closure proof: `UNPROVEN`", markdown)
        self.assertIn("- Runtime closure proof: `UNPROVEN`", markdown)
        self.assertIn('"docker-daemon": "command exited 1"', markdown)
        self.assertIn("- Runtime closure local closure proof: `UNPROVEN`", markdown)
        self.assertIn("- Runtime closure compose closure proof: `UNPROVEN`", markdown)
        self.assertIn("- Sampler local telemetry buffer: `diagnostic incomplete`", markdown)
        self.assertIn("- Sampler local telemetry buffer missing observation fields: `maxEvents,droppedByKind,droppedWithInteraction`", markdown)
        self.assertIn("- Sampler local telemetry buffer observation template JSON: `tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json`", markdown)
        self.assertIn("- Local telemetry buffer: `diagnostic incomplete`", markdown)
        self.assertIn("- Local telemetry buffer proof: `UNPROVEN`", markdown)
        self.assertIn("- Local telemetry buffer sample emission allowed: `False`", markdown)
        self.assertIn("- Local telemetry buffer missing observation fields: `maxEvents,droppedByKind,droppedWithInteraction`", markdown)
        self.assertIn("- Local telemetry buffer observation template JSON: `tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json`", markdown)
        self.assertIn("- Sampler DOM anchor blocked by steps: `tauri-webview-dev.dom_anchors`", markdown)
        self.assertIn("- DOM anchor blocked downstream steps: `p0b.sampler_collection,p0b.station_sampler_mirror,p0c.runtime_matrix_samples,p0c.red_line_proof`", markdown)
        self.assertIn("- Blocked scopes: `dom-anchor:tauri-webview-dev,station-mirror-source", markdown)
        self.assertIn("reviewCommands=`make desktop,python3 tooling/scripts/desktop-performance-sampler-gate.py`", markdown)
        self.assertIn("- Unproven samplers: `6`", markdown)
        self.assertIn("- Unproven sampler ids: `interaction-correlation,react-commit,store-update,overlay-latency,invoke,main-thread`", markdown)
        self.assertIn("| `react-commit` | `diagnostic incomplete` | `UNPROVEN` | `P0b-3/P0c-5` | 0 | `react.commit` | no react.commit events in Station mirror |", markdown)
        self.assertIn("## Issue Breakdown", markdown)
        self.assertIn("`dom-anchor-blocker` failedStep=`dom-anchor:tauri-webview-dev`", markdown)
        self.assertIn("`sampler-evidence` failedStep=`sampler:react-commit`", markdown)
        self.assertIn("sourceKind=`desktop-performance-sampler-gate`", markdown)
        self.assertIn("sourcePhase=`P0b-2/P0b-3/P0b-4/P0b-5/P0b-6/P0b-7/P0c-5`", markdown)
        self.assertIn("sourceBom=`BOM-CON-02,BOM-CAP-03,BOM-SMP-02,BOM-SMP-03,BOM-SMP-04,BOM-SMP-05,BOM-SMP-06`", markdown)
        self.assertIn("sourceSpec=`SPEC-INT-01,SPEC-SMP-REACT-01,SPEC-SMP-STORE-01,SPEC-SMP-OVERLAY-01,SPEC-SMP-INVOKE-01,SPEC-SMP-MAIN-01`", markdown)

    def test_preflight_blocked_reason_keeps_source_trace(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            preflight = Path(tmp) / "desktop-performance-preflight.json"
            preflight.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "artifactKind": "desktop-performance-preflight",
                        "status": "baseline preflight failure",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "phase": "P0c-1/P0c-2",
                        "bom": ["BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01"],
                        "spec": ["SPEC-RUN-01", "SPEC-GATE-01"],
                        "gate": "Make entrypoints, Desktop Gateway, Station health, and Gateway Station binding must pass before runtime samples are emitted",
                        "sampleEmissionAllowed": False,
                        "gateway": "http://127.0.0.1:3030",
                        "station": "http://10.37.246.80:18080",
                        "checkCount": 6,
                        "passedCheckCount": 5,
                        "failedCheckCount": 1,
                        "entrypointCheckCount": 3,
                        "entrypointPassedCount": 3,
                        "entrypointFailedCount": 0,
                        "stationHealthStatus": "pass",
                        "desktopGatewayStatus": "fail",
                        "desktopGatewayActiveStation": None,
                        "runtimeClosureStatus": "pass",
                        "runtimeClosureProofStatus": "PROVEN",
                        "runtimeClosureSampleEmissionAllowed": True,
                        "runtimeClosureFailedStep": None,
                        "runtimeClosureBlockedStep": None,
                        "runtimeClosureBlockedByStep": None,
                        "runtimeClosureBlockedDownstreamSteps": [],
                          "runtimeClosureFailedCheckReasons": {"docker-daemon": "command exited 1"},
                          "runtimeClosureLocalRuntimeClosure": {
                              "proofStatus": "UNPROVEN",
                              "sampleEmissionAllowed": False,
                          },
                          "runtimeClosureComposeRuntimeClosure": {
                              "proofStatus": "UNPROVEN",
                              "sampleEmissionAllowed": False,
                          },
                        "failedChecks": ["desktop-gateway"],
                        "failedStep": "desktop-gateway",
                        "reason": "connection refused",
                        "issue_breakdown": [
                            {
                                "category": "desktop-gateway-preflight",
                                "failedStep": "desktop-gateway",
                                "summary": "connection refused",
                                "proofImpact": "P0c-1/P0c-2 remains PARTIAL/UNPROVEN and runtime sample emission stays disabled.",
                            }
                        ],
                        "recommended_review_commands": [
                            {"purpose": "Start Desktop.", "command": "make desktop"},
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(Path(tmp) / "missing-station.json"),
                    matrix_report=str(Path(tmp) / "missing-matrix.json"),
                    preflight_report=str(preflight),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        self.assertEqual(report["preflightState"]["status"], "diagnostic incomplete")
        self.assertEqual(report["preflightState"]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["preflightState"]["sampleEmissionAllowed"])
        reason = self.blocked_reason(report, "desktop-performance-preflight")
        self.assertEqual(reason["status"], "diagnostic incomplete")
        self.assertEqual(reason["proofStatus"], "UNPROVEN")
        self.assertEqual(reason["reason"], "connection refused")
        self.assertEqual(reason["sourcePhase"], "P0c-1/P0c-2")
        self.assertEqual(reason["sourceBom"], ["BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01"])
        self.assertEqual(reason["sourceSpec"], ["SPEC-RUN-01", "SPEC-GATE-01"])
        self.assertEqual(reason["sourceArtifact"], str(preflight))
        self.assertEqual(reason["sourceArtifactKind"], "desktop-performance-preflight")
        self.assertEqual(reason["failedStep"], "desktop-gateway")
        self.assertEqual(report["preflightState"]["gateway"], "http://127.0.0.1:3030")
        self.assertEqual(report["preflightState"]["station"], "http://10.37.246.80:18080")
        self.assertEqual(report["preflightState"]["checkCount"], 6)
        self.assertEqual(report["preflightState"]["passedCheckCount"], 5)
        self.assertEqual(report["preflightState"]["failedCheckCount"], 1)
        self.assertEqual(report["preflightState"]["stationHealthStatus"], "pass")
        self.assertEqual(report["preflightState"]["desktopGatewayStatus"], "fail")
        self.assertEqual(report["preflightState"]["runtimeClosureProofStatus"], "PROVEN")
        self.assertTrue(report["preflightState"]["runtimeClosureSampleEmissionAllowed"])
        self.assertEqual(report["preflightState"]["failedChecks"], ["desktop-gateway"])
        self.assertEqual(report["failedStep"], "matrix")
        self.assertEqual(report["summary"]["failedStep"], "matrix")
        self.assertIn("missing matrix report", report["reason"])
        self.assertIn("missing matrix report", report["summary"]["reason"])
        self.assertEqual(report["summary"]["primaryIssueCategory"], "matrix")
        self.assertEqual(reason["issue_breakdown"][0]["category"], "desktop-gateway-preflight")
        self.assertEqual(reason["recommended_review_commands"][0]["command"], "make desktop")
        markdown = module.render_markdown(report)
        self.assertIn("| `preflight` | `loaded` |", markdown)
        self.assertIn("## Runtime Preflight", markdown)
        self.assertIn(f"sourceArtifact=`{preflight}`", markdown)
        self.assertIn("sourceKind=`desktop-performance-preflight`", markdown)
        self.assertIn("- Gateway: `http://127.0.0.1:3030`", markdown)
        self.assertIn("- Failed check names: `desktop-gateway`", markdown)
        self.assertIn("issues=`desktop-gateway-preflight`", markdown)

    def test_anchor_source_gate_blocked_reason_keeps_source_trace(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            source_gate = Path(tmp) / "desktop-anchor-source-gate-latest.json"
            source_gate.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "artifactKind": "desktop-anchor-source-gate",
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "phase": "P0b-1",
                        "bom": ["BOM-SMP-01"],
                        "spec": ["SPEC-ANCHOR-01"],
                        "gate": "Desktop source must expose required stable anchors before DOM automation evidence can be accepted",
                        "requiredCount": 9,
                        "presentCount": 8,
                        "missing": [{"anchorId": "context-menu-id"}],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(Path(tmp) / "missing-station.json"),
                    matrix_report=str(Path(tmp) / "missing-matrix.json"),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                    anchor_source_gate_report=str(source_gate),
                )
            )

        reason = self.blocked_reason(report, "anchor-source-gate")
        self.assertEqual(reason["status"], "diagnostic incomplete")
        self.assertEqual(reason["proofStatus"], "UNPROVEN")
        self.assertEqual(reason["sourcePhase"], "P0b-1")
        self.assertEqual(reason["sourceBom"], ["BOM-SMP-01"])
        self.assertEqual(reason["sourceSpec"], ["SPEC-ANCHOR-01"])
        self.assertEqual(reason["sourceArtifact"], str(source_gate))
        self.assertEqual(reason["sourceArtifactKind"], "desktop-anchor-source-gate")
        self.assertEqual(reason["completionStatus"], "PARTIAL")
        self.assertEqual(reason["sourceProofStatus"], "UNPROVEN")
        self.assertFalse(reason["sampleEmissionAllowed"])
        self.assertIn("anchor source gate status is not pass", reason["evidenceDetails"])
        self.assertIn("source anchor present count does not match required count", reason["evidenceDetails"])
        self.assertEqual(reason["issue_breakdown"][0]["category"], "anchor-source-gate")
        self.assertEqual(reason["issueBreakdown"][0]["category"], "anchor-source-gate")
        self.assertEqual(
            reason["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-anchor-source-gate.py",
        )
        self.assertEqual(
            reason["recommendedReviewCommands"][0]["command"],
            "python3 tooling/scripts/desktop-anchor-source-gate.py",
        )
        markdown = module.render_markdown(report)
        self.assertIn("| `anchorSourceGate` | `loaded` |", markdown)
        self.assertIn("Source gate status: `diagnostic incomplete`", markdown)
        self.assertIn("sampleEmissionAllowed=`False`", markdown)
        self.assertIn("issues=`anchor-source-gate`", markdown)
        self.assertIn("reviewCommands=`python3 tooling/scripts/desktop-anchor-source-gate.py", markdown)

    def test_missing_anchor_source_gate_blocked_reason_has_fail_closed_envelope(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            missing_source_gate = Path(tmp) / "missing-anchor-source-gate.json"
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(Path(tmp) / "missing-station.json"),
                    matrix_report=str(Path(tmp) / "missing-matrix.json"),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                    anchor_source_gate_report=str(missing_source_gate),
                )
            )

        reason = self.blocked_reason(report, "anchor-source-gate")
        self.assertEqual(reason["status"], "missing")
        self.assertEqual(reason["proofStatus"], "UNPROVEN")
        self.assertEqual(reason["sourcePhase"], "P0b-1")
        self.assertEqual(reason["sourceBom"], ["BOM-SMP-01"])
        self.assertEqual(reason["sourceSpec"], ["SPEC-ANCHOR-01"])
        self.assertEqual(
            reason["sourceGate"],
            "Desktop source must expose required stable anchors before DOM automation evidence can be accepted",
        )
        self.assertEqual(reason["sourceArtifact"], str(missing_source_gate))
        self.assertEqual(reason["sourceArtifactKind"], "desktop-anchor-source-gate")
        self.assertEqual(reason["completionStatus"], "PARTIAL")
        self.assertEqual(reason["sourceProofStatus"], "UNPROVEN")
        self.assertFalse(reason["sampleEmissionAllowed"])
        self.assertEqual(reason["issue_breakdown"][0]["category"], "anchor-source-gate")
        self.assertEqual(
            reason["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-anchor-source-gate.py",
        )
        markdown = module.render_markdown(report)
        self.assertIn(f"evidence=`{missing_source_gate}`", markdown)
        self.assertIn("sourcePhase=`P0b-1`", markdown)
        self.assertIn("sampleEmissionAllowed=`False`", markdown)
        self.assertIn("issues=`anchor-source-gate`", markdown)

    def test_anchor_dom_evidence_blocked_reason_keeps_source_trace(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            anchor = Path(tmp) / "anchor.json"
            anchor.write_text(
                json.dumps(
                    {
                        "artifactKind": "desktop-anchor-inventory",
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "sourceAnchors": {
                            "status": "loaded",
                            "presentCount": 9,
                            "requiredCount": 9,
                        },
                        "domAutomation": {
                            "status": "diagnostic incomplete",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "path": "/tmp/dom-evidence.json",
                            "evidenceStatus": "loaded",
                            "sourcePhase": "P0b-1",
                            "sourceBom": ["BOM-SMP-01"],
                            "sourceSpec": ["SPEC-ANCHOR-01"],
                            "sourceGate": "Browser and Tauri/WebView DOM automation must prove every required anchor by selector and count",
                            "sourceArtifactKind": "desktop-anchor-dom-evidence",
                            "reason": "browser DOM anchors are not fully proven (0/9 anchors proven); tauri DOM anchors are not fully proven (0/9 anchors proven)",
                            "requiredCount": 9,
                            "provenCount": 9,
                            "browser": {
                                "status": "pass",
                                "proofStatus": "PROVEN",
                                "runtimeStatus": "pass",
                                "requiredCount": 9,
                                "provenCount": 9,
                                "missing": [],
                            },
                            "tauri": {
                                "status": "diagnostic incomplete",
                                "proofStatus": "UNPROVEN",
                                "runtimeStatus": "diagnostic incomplete",
                                "requiredCount": 9,
                                "provenCount": 0,
                                "missing": [
                                    {"anchorId": "primary-nav"},
                                    {"anchorId": "secondary-tab"},
                                ],
                            },
                            "details": ["missing positive DOM match count"],
                            "issue_breakdown": [
                                {
                                    "category": "dom-automation-evidence",
                                    "failedStep": "loaded",
                                    "summary": "Browser/Tauri DOM anchor evidence is not proven.",
                                    "proofImpact": "P0b-1 DOM automation remains PARTIAL/UNPROVEN.",
                                }
                            ],
                            "issueBreakdown": [
                                {
                                    "category": "dom-automation-evidence",
                                    "failedStep": "loaded",
                                    "summary": "Browser/Tauri DOM anchor evidence is not proven.",
                                    "proofImpact": "P0b-1 DOM automation remains PARTIAL/UNPROVEN.",
                                }
                            ],
                            "recommended_review_commands": [
                                {
                                    "purpose": "Collect browser/Tauri DOM anchor observations.",
                                    "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
                                }
                            ],
                            "recommendedReviewCommands": [
                                {
                                    "purpose": "Collect browser/Tauri DOM anchor observations.",
                                    "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
                                }
                            ],
                        },
                        "issue_breakdown": [
                            {
                                "category": "dom-automation-evidence",
                                "failedStep": "loaded",
                                "summary": "Browser/Tauri DOM anchor evidence is not proven.",
                                "proofImpact": "P0b-1 DOM automation remains PARTIAL/UNPROVEN.",
                            }
                        ],
                        "issueBreakdown": [
                            {
                                "category": "dom-automation-evidence",
                                "failedStep": "loaded",
                                "summary": "Browser/Tauri DOM anchor evidence is not proven.",
                                "proofImpact": "P0b-1 DOM automation remains PARTIAL/UNPROVEN.",
                            }
                        ],
                        "recommended_review_commands": [
                            {
                                "purpose": "Collect browser/Tauri DOM anchor observations.",
                                "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
                            }
                        ],
                        "recommendedReviewCommands": [
                            {
                                "purpose": "Collect browser/Tauri DOM anchor observations.",
                                "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            anchor_dom_gate = Path(tmp) / "desktop-anchor-dom-evidence-gate-latest.json"
            anchor_dom_gate.write_text(
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
                                    "blockedByPhase": "P0b-1",
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
                            "blockedStep": "p0b.sampler_collection",
                            "blockedPhase": "P0b-2/P0b-3/P0b-4/P0b-5/P0b-6/P0b-7/P0c-3/P0c-4",
                        },
                        "domAutomation": {
                            "status": "diagnostic incomplete",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "path": "/tmp/dom-evidence.json",
                            "evidenceStatus": "loaded",
                            "sourcePhase": "P0b-1",
                            "sourceBom": ["BOM-SMP-01"],
                            "sourceSpec": ["SPEC-ANCHOR-01"],
                            "sourceGate": "Browser and Tauri/WebView DOM automation must prove every required anchor by selector and count",
                            "sourceArtifactKind": "desktop-anchor-dom-evidence",
                            "reason": "browser DOM anchors are not fully proven (0/9 anchors proven); tauri DOM anchors are not fully proven (0/9 anchors proven)",
                            "requiredCount": 9,
                            "provenCount": 9,
                            "browser": {
                                "status": "pass",
                                "proofStatus": "PROVEN",
                                "runtimeStatus": "pass",
                                "requiredCount": 9,
                                "provenCount": 9,
                                "missing": [],
                            },
                            "tauri": {
                                "status": "diagnostic incomplete",
                                "proofStatus": "UNPROVEN",
                                "runtimeStatus": "diagnostic incomplete",
                                "requiredCount": 9,
                                "provenCount": 0,
                                "missing": [
                                    {"anchorId": "primary-nav"},
                                    {"anchorId": "secondary-tab"},
                                ],
                            },
                            "details": ["missing positive DOM match count"],
                            "issue_breakdown": [
                                {
                                    "category": "dom-automation-evidence",
                                    "failedStep": "loaded",
                                    "summary": "Browser/Tauri DOM anchor evidence is not proven.",
                                    "proofImpact": "P0b-1 DOM automation remains PARTIAL/UNPROVEN.",
                                }
                            ],
                            "issueBreakdown": [
                                {
                                    "category": "dom-automation-evidence",
                                    "failedStep": "loaded",
                                    "summary": "Browser/Tauri DOM anchor evidence is not proven.",
                                    "proofImpact": "P0b-1 DOM automation remains PARTIAL/UNPROVEN.",
                                }
                            ],
                            "recommended_review_commands": [
                                {
                                    "purpose": "Collect browser/Tauri DOM anchor observations.",
                                    "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
                                }
                            ],
                            "recommendedReviewCommands": [
                                {
                                    "purpose": "Collect browser/Tauri DOM anchor observations.",
                                    "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
                                }
                            ],
                        },
                        "issue_breakdown": [
                            {
                                "category": "dom-automation-evidence",
                                "failedStep": "loaded",
                                "summary": "Browser/Tauri DOM anchor evidence is not proven.",
                                "proofImpact": "P0b-1 DOM automation remains PARTIAL/UNPROVEN.",
                            }
                        ],
                        "issueBreakdown": [
                            {
                                "category": "dom-automation-evidence",
                                "failedStep": "loaded",
                                "summary": "Browser/Tauri DOM anchor evidence is not proven.",
                                "proofImpact": "P0b-1 DOM automation remains PARTIAL/UNPROVEN.",
                            }
                        ],
                        "recommended_review_commands": [
                            {
                                "purpose": "Collect browser/Tauri DOM anchor observations.",
                                "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
                            }
                        ],
                        "recommendedReviewCommands": [
                            {
                                "purpose": "Collect browser/Tauri DOM anchor observations.",
                                "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(Path(tmp) / "missing-station.json"),
                    matrix_report=str(Path(tmp) / "missing-matrix.json"),
                    anchor_inventory_report=str(anchor),
                    anchor_dom_evidence_gate_report=str(anchor_dom_gate),
                )
            )

        anchor_reason = self.blocked_reason(report, "anchor-inventory")
        self.assertEqual(
            anchor_reason["reason"],
            "browser DOM anchors are not fully proven (0/9 anchors proven); tauri DOM anchors are not fully proven (0/9 anchors proven)",
        )
        self.assertEqual(anchor_reason["sourcePhase"], "P0b-1")
        self.assertEqual(anchor_reason["sourceBom"], ["BOM-SMP-01"])
        self.assertEqual(anchor_reason["sourceSpec"], ["SPEC-ANCHOR-01"])
        self.assertEqual(anchor_reason["sourceArtifact"], "/tmp/dom-evidence.json")
        self.assertEqual(anchor_reason["sourceArtifactKind"], "desktop-anchor-dom-evidence")
        self.assertEqual(anchor_reason["completionStatus"], "PARTIAL")
        self.assertEqual(anchor_reason["sourceProofStatus"], "UNPROVEN")
        self.assertEqual(anchor_reason["evidenceDetails"], ["missing positive DOM match count"])
        self.assertEqual(anchor_reason["issue_breakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(anchor_reason["issueBreakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(
            anchor_reason["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
        )
        self.assertEqual(
            anchor_reason["recommendedReviewCommands"][0]["command"],
            "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
        )
        anchor_dom_reason = self.blocked_reason(report, "anchor-dom-evidence")
        self.assertEqual(
            anchor_dom_reason["reason"],
            "browser DOM anchors are not fully proven (0/9 anchors proven); tauri DOM anchors are not fully proven (0/9 anchors proven)",
        )
        self.assertEqual(anchor_dom_reason["sourcePhase"], "P0b-1")
        self.assertEqual(anchor_dom_reason["sourceBom"], ["BOM-SMP-01"])
        self.assertEqual(anchor_dom_reason["sourceSpec"], ["SPEC-ANCHOR-01"])
        self.assertEqual(anchor_dom_reason["sourceArtifact"], "/tmp/dom-evidence.json")
        self.assertEqual(anchor_dom_reason["sourceArtifactKind"], "desktop-anchor-dom-evidence")
        self.assertEqual(anchor_dom_reason["completionStatus"], "PARTIAL")
        self.assertEqual(anchor_dom_reason["sourceProofStatus"], "UNPROVEN")
        self.assertEqual(anchor_dom_reason["evidenceDetails"], ["missing positive DOM match count"])
        self.assertEqual(anchor_dom_reason["issue_breakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(anchor_dom_reason["issueBreakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(
            anchor_dom_reason["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
        )
        self.assertEqual(
            anchor_dom_reason["recommendedReviewCommands"][0]["command"],
            "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
        )
        self.assertEqual(report["anchorInventory"]["domAutomation"]["browser"]["provenCount"], 9)
        self.assertEqual(report["anchorInventory"]["domAutomation"]["tauri"]["provenCount"], 0)
        self.assertEqual(report["anchorInventory"]["domAutomation"]["tauri"]["missingAnchors"], ["primary-nav", "secondary-tab"])
        self.assertEqual(
            report["anchorInventory"]["domAutomation"]["sourceArtifact"],
            "/tmp/dom-evidence.json",
        )
        self.assertEqual(report["anchorDomEvidenceGate"]["domAutomation"]["browser"]["provenCount"], 9)
        self.assertEqual(report["anchorDomEvidenceGate"]["domAutomation"]["tauri"]["provenCount"], 0)
        self.assertEqual(report["anchorDomEvidenceGate"]["domAutomation"]["tauri"]["missingAnchors"], ["primary-nav", "secondary-tab"])
        self.assertEqual(
            report["anchorDomEvidenceGate"]["domAutomation"]["sourceArtifact"],
            "/tmp/dom-evidence.json",
        )
        self.assertEqual(report["summary"]["anchorInventoryStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["anchorInventoryProofStatus"], "UNPROVEN")
        self.assertFalse(report["anchorInventory"]["sampleEmissionAllowed"])
        self.assertFalse(report["summary"]["anchorInventorySampleEmissionAllowed"])
        self.assertEqual(report["summary"]["anchorInventorySourceAnchorsPresent"], 9)
        self.assertEqual(report["summary"]["anchorInventorySourceAnchorsRequired"], 9)
        self.assertEqual(report["summary"]["anchorInventoryDomAutomationStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["anchorInventoryDomAutomationProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["anchorInventoryBrowserAnchorsProven"], 9)
        self.assertEqual(report["summary"]["anchorInventoryBrowserAnchorsRequired"], 9)
        self.assertEqual(report["summary"]["anchorInventoryTauriAnchorsProven"], 0)
        self.assertEqual(report["summary"]["anchorInventoryTauriAnchorsRequired"], 9)
        self.assertEqual(report["summary"]["anchorInventoryTauriMissingAnchors"], ["primary-nav", "secondary-tab"])
        self.assertEqual(report["summary"]["anchorDomEvidenceStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["anchorDomEvidenceProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["anchorDomEvidenceGateStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["anchorDomEvidenceGateProofStatus"], "UNPROVEN")
        self.assertFalse(report["anchorDomEvidenceGate"]["sampleEmissionAllowed"])
        self.assertFalse(report["summary"]["anchorDomEvidenceGateSampleEmissionAllowed"])
        self.assertEqual(report["summary"]["anchorDomEvidenceRequiredAnchorCount"], 9)
        self.assertEqual(report["summary"]["anchorDomEvidenceProvenAnchorCount"], 9)
        self.assertEqual(report["summary"]["anchorDomEvidenceBrowserAnchorsProven"], 9)
        self.assertEqual(report["summary"]["anchorDomEvidenceBrowserAnchorsRequired"], 9)
        self.assertEqual(report["summary"]["anchorDomEvidenceTauriAnchorsProven"], 0)
        self.assertEqual(report["summary"]["anchorDomEvidenceTauriAnchorsRequired"], 9)
        self.assertEqual(report["summary"]["anchorDomEvidenceTauriMissingAnchors"], ["primary-nav", "secondary-tab"])
        self.assertEqual(report["summary"]["anchorDomEvidenceBlockedBySteps"], ["tauri-webview-dev.dom_anchors"])
        self.assertEqual(report["summary"]["anchorDomEvidenceBlockedStep"], "p0b.sampler_collection")
        self.assertEqual(
            report["summary"]["anchorDomEvidenceBlockedDownstreamSteps"],
            ["p0b.sampler_collection", "p0b.station_sampler_mirror", "p0c.runtime_matrix_samples", "p0c.red_line_proof"],
        )
        markdown = module.render_markdown(report)
        self.assertIn("- DOM source phase: `P0b-1`", markdown)
        self.assertIn("- DOM evidence source phase: `P0b-1`", markdown)
        self.assertIn("- Browser anchors: `9/9`", markdown)
        self.assertIn("- Tauri anchors: `0/9`", markdown)
        self.assertIn("- Tauri missing anchors: `primary-nav,secondary-tab`", markdown)
        self.assertIn("- DOM evidence browser anchors: `9/9`", markdown)
        self.assertIn("- DOM evidence Tauri anchors: `0/9`", markdown)
        self.assertIn("- DOM evidence Tauri missing anchors: `primary-nav,secondary-tab`", markdown)
        self.assertIn("- DOM evidence blocked by steps: `tauri-webview-dev.dom_anchors`", markdown)
        self.assertIn("- DOM evidence blocked downstream steps: `p0b.sampler_collection,p0b.station_sampler_mirror,p0c.runtime_matrix_samples,p0c.red_line_proof`", markdown)
        self.assertIn("sourceArtifact=`/tmp/dom-evidence.json`", markdown)
        self.assertIn("sourceBom=`BOM-SMP-01`", markdown)
        self.assertIn("details=`missing positive DOM match count`", markdown)
        self.assertIn("issues=`dom-automation-evidence`", markdown)
        self.assertIn("reviewCommands=`python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py`", markdown)

    def test_missing_station_mirror_keeps_report_unproven(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "failClosed": {
                            "sampleEmissionRequiresPreflightPass": True,
                            "blockedCellCount": 4,
                        },
                        "summary": {
                            "sampled": 0,
                            "appGatewayPreflightStatus": "diagnostic incomplete",
                            "appGatewayPreflightProofStatus": "UNPROVEN",
                            "appGatewayPreflightFailedStep": "desktop-gateway",
                            "appGatewayPreflightGateway": "http://127.0.0.1:3030",
                            "appGatewayPreflightStation": "http://10.37.246.80:18080",
                            "appGatewayPreflightCheckCount": 6,
                            "appGatewayPreflightPassedCheckCount": 5,
                            "appGatewayPreflightFailedCheckCount": 1,
                            "appGatewayPreflightStationHealthStatus": "pass",
                            "appGatewayPreflightDesktopGatewayStatus": "fail",
                            "appGatewayPreflightRuntimeClosureStatus": "pass",
                            "appGatewayPreflightRuntimeClosureProofStatus": "PROVEN",
                            "appGatewayPreflightRuntimeClosureSampleEmissionAllowed": True,
                            "appGatewayPreflightRuntimeClosureFailedStep": None,
                            "appGatewayPreflightRuntimeClosureBlockedStep": None,
                            "appGatewayPreflightRuntimeClosureBlockedByStep": None,
                            "appGatewayPreflightRuntimeClosureBlockedDownstreamSteps": [],
                              "appGatewayPreflightRuntimeClosureFailedCheckReasons": {
                                  "docker-daemon": "command exited 1"
                              },
                              "appGatewayPreflightRuntimeClosureLocalRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                              },
                              "appGatewayPreflightRuntimeClosureComposeRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                              },
                            "appGatewayPreflightFailedChecks": ["desktop-gateway"],
                            "browserGatewayLiveStatus": "fail",
                            "browserGatewayLiveProofStatus": "UNPROVEN",
                              "browserGatewayLiveSourceArtifactKind": "desktop-telemetry-live-gate",
                              "browserGatewayLiveSourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                              "browserGatewayLiveSourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
                              "browserGatewayLiveSourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
                              "browserGatewayLiveSourceGate": "Desktop Gateway upload must pass before live telemetry is proven",
                            "browserGatewayLiveFailedStep": "station.telemetry_routes",
                            "browserGatewayLivePassedStepCount": 4,
                            "browserGatewayLiveFailedStepCount": 1,
                            "browserGatewayLivePendingStepCount": 4,
                            "browserGatewayLivePassedSteps": [
                                "preflight.gateway_station",
                                "station.create_temp_account",
                                "gateway.auth_login",
                                "station.auth_login",
                            ],
                            "browserGatewayLivePendingSteps": [
                                "gateway.frontend_telemetry_upload",
                                "station.raw_query",
                                "station.rollup_query",
                                "dev_mirror",
                            ],
                            "browserGatewayLiveEnvironmentClassification": "target-station-handler-missing-while-local-source-registers-routes",
                            "browserGatewayLiveBlockedStep": "gateway.frontend_telemetry_upload",
                            "browserGatewayLiveBlockedPhase": "P0a-3",
                            "browserGatewayLiveBlockedByStep": "station.telemetry_routes",
                            "browserGatewayLiveBlockedByPhase": "P0a-4",
                            "browserGatewayLiveBlockedByGate": "Station frontend telemetry route availability",
                            "browserGatewayLiveBlockedDownstreamSteps": ["station.raw_query", "station.rollup_query", "dev_mirror"],
                              "browserGatewayLiveRuntimeClosureStatus": "diagnostic incomplete",
                              "browserGatewayLiveRuntimeClosureProofStatus": "UNPROVEN",
                              "browserGatewayLiveRuntimeClosureSampleEmissionAllowed": False,
                              "browserGatewayLiveRuntimeClosureDockerDaemonProofStatus": "UNPROVEN",
                              "browserGatewayLiveRuntimeClosureCheckReasons": {
                                  "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                  "docker-daemon": "command exited 1",
                              },
                              "browserGatewayLiveRuntimeClosureFailedCheckReasons": {
                                  "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                  "docker-daemon": "command exited 1",
                              },
                              "browserGatewayLiveRuntimeClosureLocalRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                                  "failedChecks": ["local-dev-store-dsn"],
                              },
                              "browserGatewayLiveRuntimeClosureComposeRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                                  "failedChecks": ["docker-daemon"],
                              },
                                "browserGatewayLiveRuntimeClosureBlockedDownstreamProofs": [
                                    {
                                        "step": "gateway.frontend_telemetry_upload",
                                        "status": "blocked",
                                        "completionStatus": "PARTIAL",
                                        "proofStatus": "UNPROVEN",
                                        "sampleEmissionAllowed": False,
                                        "blockedByStep": "runtime.closure",
                                        "sourceArtifact": "/tmp/runtime-closure.json",
                                        "sourceArtifactKind": "desktop-telemetry-runtime-closure-gate",
                                        "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                                        "sourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
                                        "sourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
                                        "sourceGate": "Managed Station+Postgres runtime closure is required",
                                    }
                                ],
                                "browserGatewayLiveRuntimeClosureBlockedDownstreamProofCount": 1,
                            "browserGatewayLiveTargetRuntimeVersionProofStatus": "PROVEN",
                            "browserGatewayLiveTargetRuntimeBuildCommit": "unknown",
                            "browserGatewayLiveTargetRuntimeBuildLabel": "dev",
                            "browserGatewayLiveTargetRuntimeBuildTime": "unknown",
                            "browserGatewayLiveTargetRuntimeIdentityProofStatus": "UNPROVEN",
                            "browserGatewayLiveTargetRuntimeIdentityMissingFields": ["buildCommit", "buildTime"],
                            "browserGatewayLiveTargetRuntimeRouteContractProofStatus": "UNPROVEN",
                            "browserGatewayLiveTargetRuntimeMatchedRouteContractCount": 0,
                            "browserGatewayLiveTargetRuntimeMissingRouteContractCount": 3,
                            "browserGatewayLiveTargetRuntimeMissingRouteContracts": [
                                {"name": "frontend-telemetry-ingest", "path": "/telemetry/frontend/events/batch", "method": "POST"},
                                {"name": "frontend-telemetry-query", "path": "/telemetry/frontend/events/query", "method": "POST"},
                                {"name": "frontend-telemetry-rollup-query", "path": "/telemetry/frontend/rollups/query", "method": "POST"},
                            ],
                        },
                        "redLinePolicy": {
                            "status": "diagnostic incomplete",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "policies": [
                                {
                                    "policyId": "primary-nav-click",
                                    "scope": "primary navigation click-frame",
                                    "status": "diagnostic incomplete",
                                    "proofStatus": "UNPROVEN",
                                    "reason": "no sampled matrix cell; red-line cannot be evaluated",
                                      "sampleBlockers": [
                                          {
                                              "scope": "station-runtime-closure",
                                              "status": "diagnostic incomplete",
                                              "proofStatus": "UNPROVEN",
                                              "sampleEmissionAllowed": False,
                                              "sourceArtifact": "/tmp/runtime-closure.json",
                                              "sourceArtifactKind": "desktop-telemetry-runtime-closure-gate",
                                              "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                                              "sourceBom": ["BOM-CON-03"],
                                              "sourceSpec": ["SPEC-STA-01"],
                                              "sourceGate": "Station-managed telemetry runtime closure must be proven before live samples are trusted",
                                              "failedCheckReasons": {"docker-daemon": "command exited 1"},
                                          },
                                          {
                                              "scope": "station-telemetry-routes",
                                              "status": "diagnostic incomplete",
                                              "proofStatus": "UNPROVEN",
                                              "sampleEmissionAllowed": False,
                                              "sourceArtifact": "/tmp/route-probe.json",
                                              "sourceArtifactKind": "desktop-telemetry-route-probe",
                                              "sourcePhase": "P0a-4/P0a-5/P0a-6/P0c-5",
                                              "sourceBom": ["BOM-CON-03", "BOM-CON-04"],
                                              "sourceSpec": ["SPEC-STA-01", "SPEC-STA-02"],
                                              "sourceGate": "Station frontend telemetry ingest/query/rollup routes must be available",
                                              "routeContractSummary": [
                                                  {
                                                      "name": "frontend-telemetry-ingest",
                                                      "path": "/telemetry/frontend/events/batch",
                                                      "method": "POST",
                                                      "status": "missing",
                                                  }
                                              ],
                                          },
                                          {
                                              "scope": "runtime-matrix-cells",
                                              "blockedCellCount": 4,
                                              "sourceArtifact": "matrix://runtime-cells",
                                              "sourceArtifactKind": "desktop-performance-matrix-gate",
                                              "sourcePhase": "P0c-3/P0c-4/P0c-5",
                                              "sourceBom": ["BOM-GATE-02", "BOM-GATE-03"],
                                              "sourceSpec": ["SPEC-GATE-02", "SPEC-GATE-03"],
                                              "sourceGate": "Runtime matrix, red-line policy evaluation, and source evidence diagnostics must all remain fail-closed",
                                          },
                                      ],
                                    "rawEvidence": {
                                        "path": "/tmp/raw-events.json",
                                        "status": "missing-source-metadata",
                                        "completionStatus": "PARTIAL",
                                        "proofStatus": "UNPROVEN",
                                        "sourcePhase": "P0a",
                                        "sourceBom": ["BOM-CAP-05"],
                                        "sourceSpec": ["SPEC-STA-03"],
                                        "sourceGate": "Dev/CI mirror artifact must preserve Station query evidence",
                                        "details": [
                                            "missing or invalid phase",
                                            "missing required raw event Spec binding",
                                            "missing Station product sink boundary",
                                        ],
                                    },
                                }
                            ],
                        },
                        "preflightState": {
                            "status": "diagnostic incomplete",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "sourceArtifactKind": "desktop-performance-preflight",
                            "sourcePhase": "P0c-1/P0c-2",
                            "sourceBom": ["BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01"],
                            "sourceSpec": ["SPEC-RUN-01", "SPEC-GATE-01"],
                            "sampleEmissionAllowed": False,
                        },
                          "browserGatewayPreflightState": {
                              "status": "pass",
                              "completionStatus": "DONE",
                              "proofStatus": "PROVEN",
                              "sourceArtifactKind": "desktop-performance-preflight",
                              "sourcePhase": "P0c-1/P0c-2",
                              "sourceBom": ["BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01"],
                              "sourceSpec": ["SPEC-RUN-01", "SPEC-GATE-01"],
                              "sampleEmissionAllowed": True,
                              "reason": "browser preflight passed",
                          },
                          "browserGatewayDomEvidenceState": {
                              "status": "diagnostic incomplete",
                              "completionStatus": "PARTIAL",
                              "proofStatus": "UNPROVEN",
                              "sourceArtifactKind": "desktop-anchor-dom-evidence",
                              "sourcePhase": "P0b-1",
                              "sourceBom": ["BOM-SMP-01"],
                              "sourceSpec": ["SPEC-ANCHOR-01"],
                              "sampleEmissionAllowed": False,
                              "reason": "browser-gateway DOM shell anchors are not proven",
                              "runtimeContext": {
                                  "pageState": "login-form-after-submit",
                                  "loginSubmitObserved": True,
                                  "loadingObservedDuringSubmit": True,
                              },
                          },
                        "cells": [
                            {
                                "cellId": "browser-gateway",
                                "status": "baseline preflight failure",
                                "proofStatus": "UNPROVEN",
                                "reason": "gateway refused",
                                "evidence": {
                                    "path": "/tmp/live-gate.json",
                                    "status": "missing",
                                    "sourceStatus": "baseline preflight failure",
                                    "completionStatus": "PARTIAL",
                                    "proofStatus": "UNPROVEN",
                                    "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                                    "sourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
                                    "sourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
                                    "sourceGate": "Desktop Gateway upload must pass before live telemetry is proven",
                                    "reason": "missing live gate report",
                                    "issueBreakdown": [
                                        {
                                            "category": "desktop-gateway-preflight",
                                            "failedStep": "preflight.gateway_station",
                                            "summary": "Desktop HTTP Gateway is not reachable.",
                                            "proofImpact": "P0a remains PARTIAL/UNPROVEN.",
                                        }
                                    ],
                                    "issue_breakdown": [
                                        {
                                            "category": "desktop-gateway-preflight",
                                            "failedStep": "preflight.gateway_station",
                                            "summary": "Desktop HTTP Gateway is not reachable.",
                                            "proofImpact": "P0a remains PARTIAL/UNPROVEN.",
                                        }
                                    ],
                                    "recommendedReviewCommands": [
                                        {"purpose": "Start Desktop dev runtime.", "command": "make desktop"},
                                        {
                                            "purpose": "Re-run live telemetry gate.",
                                            "command": "python3 tooling/scripts/desktop-telemetry-live-gate.py",
                                        },
                                    ],
                                    "recommended_review_commands": [
                                        {"purpose": "Start Desktop dev runtime.", "command": "make desktop"},
                                        {
                                            "purpose": "Re-run live telemetry gate.",
                                            "command": "python3 tooling/scripts/desktop-telemetry-live-gate.py",
                                        },
                                    ],
                                },
                            },
                            {
                                "cellId": "tauri-webview-packaged",
                                "status": "diagnostic incomplete",
                                "proofStatus": "UNPROVEN",
                                "sampleEmissionAllowed": False,
                                "reason": "runtime cell observation is incomplete",
                                "evidence": {
                                    "path": "/tmp/tauri-webview-packaged.json",
                                    "status": "loaded",
                                    "sourceStatus": "diagnostic incomplete",
                                    "completionStatus": "PARTIAL",
                                    "proofStatus": "UNPROVEN",
                                    "sourceArtifact": "/tmp/tauri-webview-packaged.json",
                                    "sourcePhase": "P0c-3",
                                    "sourceBom": ["BOM-GATE-02", "BOM-CAP-04"],
                                    "sourceSpec": ["SPEC-GATE-02", "SPEC-RUN-01"],
                                    "sourceGate": "Runtime cell evidence required before matrix samples are accepted",
                                    "failedStep": "tauri-webview-packaged",
                                    "validationDetails": [
                                        "missing runtime cell observation",
                                        "ready shell evidence is not proven",
                                        "telemetry sample evidence is not proven",
                                    ],
                                    "sourceCellId": "tauri-webview-packaged",
                                    "sourceEntrypoint": "pnpm --dir apps/desktop tauri build --features acceptance-webdriver",
                                    "sourceStartupMode": "packaged-tauri-webview",
                                    "summary": {
                                        "observationSourceStatus": "loaded",
                                        "observationSourcePath": "tooling/acceptance/reports/desktop-performance-cell-observations.json",
                                        "readyShellProofStatus": "UNPROVEN",
                                        "telemetryProofStatus": "UNPROVEN",
                                        "telemetryEventCount": 0,
                                        "telemetryInteractionIdCount": 0,
                                        "validationDetailCount": 3,
                                    },
                                },
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(Path(tmp) / "missing-station.json"),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["stationMirror"]["status"], "missing")
        station_reasons = [item for item in report["blockedReasons"] if item["scope"] == "station-mirror"]
        self.assertEqual(len(station_reasons), 1)
        self.assertEqual(station_reasons[0]["status"], "diagnostic incomplete")
        self.assertEqual(station_reasons[0]["proofStatus"], "UNPROVEN")
        self.assertEqual(station_reasons[0]["evidenceStatus"], "missing")
        self.assertTrue(station_reasons[0]["evidencePath"].endswith("missing-station.json"))
        self.assertEqual(report["anchorInventory"]["status"], "diagnostic incomplete")
        self.assertEqual(report["anchorInventory"]["domAutomation"]["status"], "missing")
        self.assertEqual(report["anchorInventory"]["evidenceStatus"], "missing")
        self.assertTrue(report["anchorInventory"]["evidencePath"].endswith("missing-anchor.json"))
        self.assertEqual(report["matrix"]["failClosed"]["blockedCellCount"], 4)
        self.assertEqual(report["matrix"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["matrix"]["preflightState"]["sourceArtifactKind"], "desktop-performance-preflight")
        self.assertEqual(report["matrix"]["preflightState"]["sourcePhase"], "P0c-1/P0c-2")
        self.assertEqual(report["matrix"]["browserGatewayPreflightState"]["status"], "pass")
        self.assertEqual(report["matrix"]["browserGatewayPreflightState"]["proofStatus"], "PROVEN")
        self.assertTrue(report["matrix"]["browserGatewayPreflightState"]["sampleEmissionAllowed"])
        self.assertEqual(report["matrix"]["browserGatewayDomEvidenceState"]["status"], "diagnostic incomplete")
        self.assertEqual(
            report["matrix"]["browserGatewayDomEvidenceState"]["sourceArtifactKind"],
            "desktop-anchor-dom-evidence",
        )
        self.assertEqual(report["matrix"]["browserGatewayDomEvidenceState"]["sourcePhase"], "P0b-1")
        self.assertFalse(report["matrix"]["browserGatewayDomEvidenceState"]["sampleEmissionAllowed"])
        self.assertEqual(
            report["matrix"]["browserGatewayDomEvidenceState"]["runtimeContext"]["pageState"],
            "login-form-after-submit",
        )
        self.assertEqual(report["blockedReasons"][0]["scope"], "matrix:browser-gateway")
        self.assertEqual(report["blockedReasons"][0]["reason"], "missing live gate report")
        self.assertEqual(report["blockedReasons"][0]["matrixReason"], "gateway refused")
        self.assertEqual(report["blockedReasons"][0]["evidencePath"], "/tmp/live-gate.json")
        self.assertEqual(report["blockedReasons"][0]["evidenceStatus"], "missing")
        self.assertEqual(report["blockedReasons"][0]["sourceStatus"], "baseline preflight failure")
        self.assertEqual(report["blockedReasons"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["blockedReasons"][0]["sourceProofStatus"], "UNPROVEN")
        self.assertEqual(report["blockedReasons"][0]["sourcePhase"], "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5")
        self.assertEqual(report["blockedReasons"][0]["sourceBom"], ["BOM-RUN-03", "BOM-RUN-04"])
        self.assertEqual(report["blockedReasons"][0]["sourceSpec"], ["SPEC-GW-01", "SPEC-STA-01"])
        self.assertEqual(
            report["blockedReasons"][0]["sourceGate"],
            "Desktop Gateway upload must pass before live telemetry is proven",
        )
        self.assertEqual(report["blockedReasons"][0]["issueBreakdown"][0]["category"], "desktop-gateway-preflight")
        self.assertEqual(report["blockedReasons"][0]["issue_breakdown"][0]["category"], "desktop-gateway-preflight")
        self.assertEqual(report["blockedReasons"][0]["recommendedReviewCommands"][0]["command"], "make desktop")
        self.assertEqual(report["blockedReasons"][0]["recommended_review_commands"][0]["command"], "make desktop")
        markdown = module.render_markdown(report)
        self.assertIn("## Browser Gateway DOM Evidence", markdown)
        self.assertIn("Source kind: `desktop-anchor-dom-evidence`", markdown)
        self.assertIn("Page state: `login-form-after-submit`", markdown)
        self.assertFalse(report["blockedReasons"][0]["sampleEmissionAllowed"])
        self.assertIn("sampleEmissionAllowed=`False`", module.render_markdown(report))
        self.assertIn("evidenceStatus=`missing`", module.render_markdown(report))
        self.assertIn("evidence=`/tmp/live-gate.json`", module.render_markdown(report))
        self.assertIn("sourcePhase=`P0a-3/P0a-4/P0a-5/P0a-6/P0c-5`", module.render_markdown(report))
        self.assertIn("sourceCompletion=`PARTIAL`", module.render_markdown(report))
        self.assertIn("sourceProof=`UNPROVEN`", module.render_markdown(report))
        self.assertIn("sourceBom=`BOM-RUN-03,BOM-RUN-04`", module.render_markdown(report))
        self.assertIn("sourceSpec=`SPEC-GW-01,SPEC-STA-01`", module.render_markdown(report))
        self.assertIn(
            "sourceGate=`Desktop Gateway upload must pass before live telemetry is proven`",
            module.render_markdown(report),
        )
        self.assertIn("issues=`desktop-gateway-preflight`", module.render_markdown(report))
        self.assertIn("reviewCommands=`make desktop,python3 tooling/scripts/desktop-telemetry-live-gate.py`", module.render_markdown(report))
        red_line_reasons = [item for item in report["blockedReasons"] if item["scope"] == "red-line:primary-nav-click"]
        self.assertEqual(len(red_line_reasons), 1)
        self.assertEqual(red_line_reasons[0]["evidencePath"], "/tmp/raw-events.json")
        self.assertEqual(red_line_reasons[0]["evidenceStatus"], "missing-source-metadata")
        self.assertEqual(red_line_reasons[0]["completionStatus"], "PARTIAL")
        self.assertEqual(red_line_reasons[0]["sourceProofStatus"], "UNPROVEN")
        self.assertFalse(red_line_reasons[0]["sampleEmissionAllowed"])
        self.assertEqual(red_line_reasons[0]["sourcePhase"], "P0a")
        self.assertEqual(red_line_reasons[0]["sourceBom"], ["BOM-CAP-05"])
        self.assertEqual(red_line_reasons[0]["sourceSpec"], ["SPEC-STA-03"])
        self.assertEqual(
            red_line_reasons[0]["sourceGate"],
            "Dev/CI mirror artifact must preserve Station query evidence",
        )
        self.assertEqual(red_line_reasons[0]["evidenceDetails"][0]["policyId"], "primary-nav-click")
        self.assertEqual(red_line_reasons[0]["evidenceDetails"][0]["evidencePath"], "/tmp/raw-events.json")
        self.assertEqual(red_line_reasons[0]["evidenceDetails"][0]["evidenceStatus"], "missing-source-metadata")
        self.assertEqual(
            red_line_reasons[0]["evidenceDetails"][0]["rawEvidenceDetails"],
            [
                "missing or invalid phase",
                "missing required raw event Spec binding",
                "missing Station product sink boundary",
            ],
        )
        self.assertEqual(red_line_reasons[0]["evidenceDetails"][0]["rawEvidence"]["path"], "/tmp/raw-events.json")
        self.assertEqual(
            red_line_reasons[0]["evidenceDetails"][0]["rawEvidence"]["status"],
            "missing-source-metadata",
        )
        self.assertEqual(
            [item["scope"] for item in red_line_reasons[0]["sampleBlockers"]],
            ["station-runtime-closure", "station-telemetry-routes", "runtime-matrix-cells"],
        )
        self.assertEqual(red_line_reasons[0]["sampleBlockers"][0]["sourceArtifactKind"], "desktop-telemetry-runtime-closure-gate")
        self.assertEqual(red_line_reasons[0]["sampleBlockers"][1]["sourceArtifactKind"], "desktop-telemetry-route-probe")
        self.assertEqual(red_line_reasons[0]["sampleBlockers"][2]["sourceArtifactKind"], "desktop-performance-matrix-gate")
        self.assertEqual(
            [item["scope"] for item in red_line_reasons[0]["evidenceDetails"][0]["sampleBlockers"]],
            ["station-runtime-closure", "station-telemetry-routes", "runtime-matrix-cells"],
        )
        self.assertEqual(
            red_line_reasons[0]["evidenceDetails"][0]["sampleBlockers"][0]["sourcePhase"],
            "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
        )
        self.assertEqual(red_line_reasons[0]["issue_breakdown"][0]["category"], "red-line:primary-nav-click")
        self.assertEqual(red_line_reasons[0]["issueBreakdown"][0]["category"], "red-line:primary-nav-click")
        self.assertEqual(
            [item["scope"] for item in red_line_reasons[0]["issueBreakdown"][0]["sampleBlockers"]],
            ["station-runtime-closure", "station-telemetry-routes", "runtime-matrix-cells"],
        )
        self.assertEqual(
            red_line_reasons[0]["issueBreakdown"][0]["sampleBlockers"][1]["sourcePhase"],
            "P0a-4/P0a-5/P0a-6/P0c-5",
        )
        self.assertEqual(red_line_reasons[0]["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(red_line_reasons[0]["recommendedReviewCommands"][0]["command"], "make desktop")
        self.assertEqual(report["summary"]["redLinePolicyCount"], 1)
        self.assertEqual(report["summary"]["redLinePolicyPassedCount"], 0)
        self.assertEqual(report["summary"]["redLinePolicyFailedCount"], 0)
        self.assertEqual(report["summary"]["redLinePolicyDiagnosticIncompleteCount"], 1)
        self.assertEqual(report["summary"]["redLinePolicySummaries"][0]["policyId"], "primary-nav-click")
        self.assertEqual(report["summary"]["redLinePolicySummaries"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["redLinePolicySummaries"][0]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["redLinePolicySummaries"][0]["rawEvidenceStatus"], "missing-source-metadata")
        self.assertEqual(report["summary"]["redLinePolicySummaries"][0]["rawEvidencePath"], "/tmp/raw-events.json")
        self.assertEqual(report["summary"]["redLinePolicySummaries"][0]["rawSourcePhase"], "P0a")
        self.assertEqual(report["summary"]["redLinePolicySummaries"][0]["rawSourceBom"], ["BOM-CAP-05"])
        self.assertEqual(report["summary"]["redLinePolicySummaries"][0]["rawSourceSpec"], ["SPEC-STA-03"])
        self.assertEqual(
            report["summary"]["redLinePolicySummaries"][0]["rawSourceGate"],
            "Dev/CI mirror artifact must preserve Station query evidence",
        )
        self.assertEqual(
            [item["scope"] for item in report["summary"]["redLinePolicySummaries"][0]["sampleBlockers"]],
            ["station-runtime-closure", "station-telemetry-routes", "runtime-matrix-cells"],
        )
        self.assertEqual(
            report["summary"]["redLinePolicySummaries"][0]["sampleBlockers"][2]["sourceArtifact"],
            "matrix://runtime-cells",
        )
        self.assertIn("- Policy count: `1`", markdown)
        self.assertIn("- Diagnostic incomplete policies: `1`", markdown)
        self.assertIn("- Policy ids: `primary-nav-click`", markdown)
        anchor_reasons = [item for item in report["blockedReasons"] if item["scope"] == "anchor-inventory"]
        self.assertEqual(len(anchor_reasons), 1)
        self.assertEqual(anchor_reasons[0]["proofStatus"], "UNPROVEN")
        self.assertEqual(anchor_reasons[0]["evidenceStatus"], "missing")
        self.assertTrue(anchor_reasons[0]["evidencePath"].endswith("missing-anchor.json"))
        anchor_dom_reasons = [item for item in report["blockedReasons"] if item["scope"] == "anchor-dom-evidence"]
        self.assertEqual(len(anchor_dom_reasons), 1)
        self.assertEqual(anchor_dom_reasons[0]["proofStatus"], "UNPROVEN")
        self.assertEqual(anchor_dom_reasons[0]["evidenceStatus"], "missing")
        self.assertEqual(
            anchor_dom_reasons[0]["evidencePath"],
            "evidence-store:latest:desktop-anchor-dom-evidence-gate:report",
        )
        expected_aggregation_scopes = {
            "react-commit-aggregation": "P0b-3/P0c-5",
            "store-update-aggregation": "P0b-4/P0c-5",
            "overlay-latency-aggregation": "P0b-5/P0c-5",
            "invoke-aggregation": "P0b-6/P0c-5",
            "main-thread-exceptions": "P0b-7/P0c-5",
        }
        for scope, phase in expected_aggregation_scopes.items():
            reason = self.blocked_reason(report, scope)
            self.assertEqual(reason["status"], "diagnostic incomplete")
            self.assertEqual(reason["proofStatus"], "UNPROVEN")
            self.assertEqual(reason["reason"], "missing Station mirror report")
            self.assertEqual(reason["evidenceStatus"], "missing")
            self.assertTrue(reason["evidencePath"].endswith("missing-station.json"))
            self.assertEqual(reason["sourcePhase"], phase)
            self.assertIn("BOM-RUN-05", reason["sourceBom"])
            self.assertIn("BOM-CAP-05", reason["sourceBom"])
            self.assertIn("SPEC-MIRROR-01", reason["sourceSpec"])
            self.assertIn("SPEC-STA-03", reason["sourceSpec"])
            self.assertTrue(reason["sourceGate"])
        markdown = module.render_markdown(report)
        self.assertIn("## Input Artifacts", markdown)
        self.assertIn("| `stationMirror` | `missing` | `", markdown)
        self.assertIn("`station-mirror`", markdown)
        self.assertIn("`red-line:primary-nav-click`", markdown)
        self.assertIn("station-runtime-closure,station-telemetry-routes,runtime-matrix-cells", markdown)
        self.assertIn("evidenceStatus=`missing-source-metadata`", markdown)
        self.assertIn("sourcePhase=`P0a`", markdown)
        self.assertIn("sourceBom=`BOM-CAP-05`", markdown)
        self.assertIn("sourceSpec=`SPEC-STA-03`", markdown)
        self.assertIn("rawEvidenceDetails", markdown)
        self.assertIn("missing required raw event Spec binding", markdown)
        self.assertIn("rawEvidence", markdown)
        self.assertIn("sampleBlockers", markdown)
        self.assertIn("issues=`red-line:primary-nav-click`", markdown)
        self.assertIn("reviewCommands=`make desktop,python3 tooling/scripts/desktop-telemetry-live-gate.py,python3 tooling/scripts/desktop-performance-sampler-gate.py,python3 tooling/scripts/desktop-performance-report.py,make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json`", markdown)
        self.assertIn("missing-station.json", markdown)
        self.assertIn("missing-station.json", markdown)
        self.assertIn("| `matrix` | `loaded` | `", markdown)
        self.assertIn("matrix.json", markdown)
        self.assertIn("missing-anchor.json", markdown)
        self.assertIn("anchorDomEvidenceGate", markdown)
        self.assertIn("## Matrix State", markdown)
        self.assertIn("- Proof: `UNPROVEN`", markdown)
        self.assertIn("| Policy | Scope | Status | Proof | Matched interactions | Window count | Raw evidence status | Raw evidence path | Raw source kind | Raw source phase | Raw source BOM | Raw source Spec | Raw source Gate | Sample blockers | Raw details | Reason |", markdown)
        self.assertIn("`missing-source-metadata` | `/tmp/raw-events.json`", markdown)
        self.assertIn("`P0a` | `BOM-CAP-05` | `SPEC-STA-03` | `Dev/CI mirror artifact must preserve Station query evidence`", markdown)
        self.assertIn("`missing or invalid phase,missing required raw event Spec binding,missing Station product sink boundary`", markdown)
        self.assertIn("evidenceStatus=`missing-source-metadata`", markdown)
        self.assertIn("missing-anchor.json", markdown)

    def test_sampled_cell_without_sample_emission_allowed_is_blocked(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "failClosed": {
                            "sampleEmissionRequiresPreflightPass": True,
                            "blockedCellCount": 1,
                        },
                        "summary": {
                            "sampled": 0,
                            "browserGatewayLiveStatus": "fail",
                            "browserGatewayLiveProofStatus": "UNPROVEN",
                              "browserGatewayLiveSourceArtifactKind": "desktop-telemetry-live-gate",
                              "browserGatewayLiveSourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                              "browserGatewayLiveSourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
                              "browserGatewayLiveSourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
                              "browserGatewayLiveSourceGate": "Desktop Gateway upload must pass before live telemetry is proven",
                            "browserGatewayLiveFailedStep": "station.telemetry_routes",
                            "browserGatewayLivePassedStepCount": 4,
                            "browserGatewayLiveFailedStepCount": 1,
                            "browserGatewayLivePendingStepCount": 4,
                            "browserGatewayLivePassedSteps": [
                                "preflight.gateway_station",
                                "station.create_temp_account",
                                "gateway.auth_login",
                                "station.auth_login",
                            ],
                            "browserGatewayLivePendingSteps": [
                                "gateway.frontend_telemetry_upload",
                                "station.raw_query",
                                "station.rollup_query",
                                "dev_mirror",
                            ],
                            "browserGatewayLiveEnvironmentClassification": "target-station-handler-missing-while-local-source-registers-routes",
                            "browserGatewayLiveBlockedStep": "gateway.frontend_telemetry_upload",
                            "browserGatewayLiveBlockedPhase": "P0a-3",
                            "browserGatewayLiveBlockedByStep": "station.telemetry_routes",
                            "browserGatewayLiveBlockedByPhase": "P0a-4",
                            "browserGatewayLiveBlockedByGate": "Station frontend telemetry route availability",
                            "browserGatewayLiveBlockedDownstreamSteps": ["station.raw_query", "station.rollup_query", "dev_mirror"],
                              "browserGatewayLiveRuntimeClosureStatus": "diagnostic incomplete",
                              "browserGatewayLiveRuntimeClosureProofStatus": "UNPROVEN",
                              "browserGatewayLiveRuntimeClosureSampleEmissionAllowed": False,
                              "browserGatewayLiveRuntimeClosureDockerDaemonProofStatus": "UNPROVEN",
                              "browserGatewayLiveRuntimeClosureCheckReasons": {
                                  "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                  "docker-daemon": "command exited 1",
                              },
                              "browserGatewayLiveRuntimeClosureFailedCheckReasons": {
                                  "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                  "docker-daemon": "command exited 1",
                              },
                              "browserGatewayLiveRuntimeClosureLocalRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                                  "failedChecks": ["local-dev-store-dsn"],
                              },
                              "browserGatewayLiveRuntimeClosureComposeRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                                  "failedChecks": ["docker-daemon"],
                              },
                              "browserGatewayLiveRuntimeClosureBlockedDownstreamProofs": [
                                  {
                                      "step": "gateway.frontend_telemetry_upload",
                                      "status": "blocked",
                                      "completionStatus": "PARTIAL",
                                      "proofStatus": "UNPROVEN",
                                      "sampleEmissionAllowed": False,
                                      "blockedByStep": "runtime.closure",
                                      "sourceArtifact": "/tmp/runtime-closure.json",
                                      "sourceArtifactKind": "desktop-telemetry-runtime-closure-gate",
                                      "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                                      "sourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
                                      "sourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
                                      "sourceGate": "Managed Station+Postgres runtime closure is required",
                                  }
                              ],
                              "browserGatewayLiveRuntimeClosureBlockedDownstreamProofCount": 1,
                            "browserGatewayLiveTargetRuntimeVersionProofStatus": "PROVEN",
                            "browserGatewayLiveTargetRuntimeBuildCommit": "unknown",
                            "browserGatewayLiveTargetRuntimeBuildLabel": "dev",
                            "browserGatewayLiveTargetRuntimeBuildTime": "unknown",
                            "browserGatewayLiveTargetRuntimeIdentityProofStatus": "UNPROVEN",
                            "browserGatewayLiveTargetRuntimeIdentityMissingFields": ["buildCommit", "buildTime"],
                            "browserGatewayLiveTargetRuntimeRouteContractProofStatus": "UNPROVEN",
                            "browserGatewayLiveTargetRuntimeMatchedRouteContractCount": 0,
                            "browserGatewayLiveTargetRuntimeMissingRouteContractCount": 3,
                            "browserGatewayLiveTargetRuntimeMissingRouteContracts": [
                                {"name": "frontend-telemetry-ingest", "path": "/telemetry/frontend/events/batch", "method": "POST"},
                                {"name": "frontend-telemetry-query", "path": "/telemetry/frontend/events/query", "method": "POST"},
                                {"name": "frontend-telemetry-rollup-query", "path": "/telemetry/frontend/rollups/query", "method": "POST"},
                            ],
                        },
                        "redLinePolicy": {
                            "status": "diagnostic incomplete",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "policies": [],
                        },
                        "stationTelemetryRouteProbeState": {
                            "path": "/tmp/route-probe.json",
                            "status": "pass",
                            "sourceStatus": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "sampleEmissionAllowed": True,
                        },
                        "cells": [
                            {
                                "cellId": "tauri-webview-dev",
                                "status": "sampled",
                                "proofStatus": "UNPROVEN",
                                "sampleEmissionAllowed": False,
                                "reason": "runtime cell evidence report did not allow sample emission",
                                "evidence": {
                                    "path": "/tmp/tauri-webview-dev.json",
                                    "status": "preflight-denied",
                                    "sourceStatus": "sampled",
                                    "completionStatus": "DONE",
                                    "proofStatus": "PROVEN",
                                "sourceArtifact": "/tmp/tauri-webview-dev.json",
                                    "sourcePhase": "P0c-3",
                                    "sourceBom": ["BOM-GATE-02", "BOM-CAP-04"],
                                    "sourceSpec": ["SPEC-GATE-02", "SPEC-RUN-01"],
                                    "sourceGate": "Tauri WebView runtime cell must pass preflight before samples are accepted",
                                    "details": ["missing required BOM binding", "missing gate"],
                                    "reason": "preflight sample emission denied",
                                    "issue_breakdown": [
                                        {
                                            "category": "runtime-cell-evidence",
                                            "failedStep": "tauri-webview-dev",
                                            "summary": "preflight sample emission denied",
                                            "proofImpact": "P0c-3 remains PARTIAL/UNPROVEN until this runtime cell emits proven evidence.",
                                        }
                                    ],
                                    "issueBreakdown": [
                                        {
                                            "category": "runtime-cell-evidence",
                                            "failedStep": "tauri-webview-dev",
                                            "summary": "preflight sample emission denied",
                                            "proofImpact": "P0c-3 remains PARTIAL/UNPROVEN until this runtime cell emits proven evidence.",
                                        }
                                    ],
                                    "recommended_review_commands": [
                                        {
                                            "purpose": "Start the runtime through the planned Make entrypoint.",
                                            "command": "make desktop",
                                        }
                                    ],
                                    "recommendedReviewCommands": [
                                        {
                                            "purpose": "Start the runtime through the planned Make entrypoint.",
                                            "command": "make desktop",
                                        }
                                    ],
                                },
                            },
                            {
                                "cellId": "tauri-webview-packaged",
                                "status": "diagnostic incomplete",
                                "proofStatus": "UNPROVEN",
                                "sampleEmissionAllowed": False,
                                "reason": "runtime cell observation is incomplete",
                                "evidence": {
                                    "path": "/tmp/tauri-webview-packaged.json",
                                    "status": "loaded",
                                    "sourceStatus": "diagnostic incomplete",
                                    "completionStatus": "PARTIAL",
                                    "proofStatus": "UNPROVEN",
                                    "sourceArtifact": "/tmp/tauri-webview-packaged.json",
                                    "sourcePhase": "P0c-3",
                                    "sourceBom": ["BOM-GATE-02", "BOM-CAP-04"],
                                    "sourceSpec": ["SPEC-GATE-02", "SPEC-RUN-01"],
                                    "sourceGate": "Runtime cell evidence required before matrix samples are accepted",
                                    "failedStep": "tauri-webview-packaged",
                                    "validationDetails": [
                                        "missing runtime cell observation",
                                        "ready shell evidence is not proven",
                                        "telemetry sample evidence is not proven",
                                    ],
                                    "sourceCellId": "tauri-webview-packaged",
                                    "sourceEntrypoint": "pnpm --dir apps/desktop tauri build --features acceptance-webdriver",
                                    "sourceStartupMode": "packaged-tauri-webview",
                                    "summary": {
                                        "observationSourceStatus": "loaded",
                                        "observationSourcePath": "tooling/acceptance/reports/desktop-performance-cell-observations.json",
                                        "readyShellProofStatus": "UNPROVEN",
                                        "telemetryProofStatus": "UNPROVEN",
                                        "telemetryEventCount": 0,
                                        "telemetryInteractionIdCount": 0,
                                        "validationDetailCount": 3,
                                    },
                                },
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(Path(tmp) / "missing-station.json"),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        matrix_reasons = [item for item in report["blockedReasons"] if item["scope"] == "matrix:tauri-webview-dev"]
        self.assertEqual(len(matrix_reasons), 1)
        self.assertEqual(matrix_reasons[0]["status"], "sampled")
        self.assertEqual(matrix_reasons[0]["reason"], "preflight sample emission denied")
        self.assertEqual(matrix_reasons[0]["evidencePath"], "/tmp/tauri-webview-dev.json")
        self.assertEqual(matrix_reasons[0]["evidenceStatus"], "preflight-denied")
        self.assertEqual(matrix_reasons[0]["sourceStatus"], "sampled")
        self.assertEqual(matrix_reasons[0]["completionStatus"], "DONE")
        self.assertEqual(matrix_reasons[0]["sourceProofStatus"], "PROVEN")
        self.assertEqual(matrix_reasons[0]["sourceArtifact"], "/tmp/tauri-webview-dev.json")
        self.assertEqual(matrix_reasons[0]["sourcePhase"], "P0c-3")
        self.assertEqual(matrix_reasons[0]["sourceBom"], ["BOM-GATE-02", "BOM-CAP-04"])
        self.assertEqual(matrix_reasons[0]["sourceSpec"], ["SPEC-GATE-02", "SPEC-RUN-01"])
        self.assertEqual(
            matrix_reasons[0]["sourceGate"],
            "Tauri WebView runtime cell must pass preflight before samples are accepted",
        )
        self.assertEqual(matrix_reasons[0]["evidenceDetails"], ["missing required BOM binding", "missing gate"])
        self.assertEqual(matrix_reasons[0]["issue_breakdown"][0]["category"], "runtime-cell-evidence")
        self.assertEqual(matrix_reasons[0]["issueBreakdown"][0]["category"], "runtime-cell-evidence")
        self.assertEqual(matrix_reasons[0]["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(matrix_reasons[0]["recommendedReviewCommands"][0]["command"], "make desktop")
        self.assertFalse(matrix_reasons[0]["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["matrixDiagnosticIncompleteCells"], 1)
        self.assertEqual(report["summary"]["matrixUnprovenRuntimeCells"], 2)
        self.assertEqual(report["summary"]["matrixRuntimeCellDetails"][0]["cellId"], "tauri-webview-dev")
        self.assertEqual(report["summary"]["matrixRuntimeCellDetails"][0]["failedStep"], None)
        self.assertEqual(report["summary"]["matrixRuntimeCellDetails"][0]["details"], ["missing required BOM binding", "missing gate"])
        self.assertEqual(report["summary"]["matrixRuntimeCellDetails"][1]["cellId"], "tauri-webview-packaged")
        self.assertEqual(report["summary"]["matrixRuntimeCellDetails"][1]["failedStep"], "tauri-webview-packaged")
        self.assertEqual(
            report["summary"]["matrixRuntimeCellDetails"][1]["details"],
            [
                "missing runtime cell observation",
                "ready shell evidence is not proven",
                "telemetry sample evidence is not proven",
            ],
        )
        self.assertEqual(report["summary"]["matrixRuntimeCellDetails"][1]["observationSourceStatus"], "loaded")
        self.assertEqual(
            report["summary"]["matrixRuntimeCellDetails"][1]["observationSourcePath"],
            "tooling/acceptance/reports/desktop-performance-cell-observations.json",
        )
        self.assertEqual(report["summary"]["matrixRuntimeCellDetails"][1]["readyShellProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["matrixRuntimeCellDetails"][1]["telemetryProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["matrixRuntimeCellDetails"][1]["telemetryEventCount"], 0)
        self.assertEqual(report["summary"]["matrixRuntimeCellDetails"][1]["telemetryInteractionIdCount"], 0)
        self.assertEqual(report["summary"]["matrixRuntimeCellDetails"][1]["validationDetailCount"], 3)
        markdown = module.render_markdown(report)
        self.assertIn("evidenceStatus=`preflight-denied`", markdown)
        self.assertIn("sourcePhase=`P0c-3`", markdown)
        self.assertIn("sourceCompletion=`DONE`", markdown)
        self.assertIn("sourceProof=`PROVEN`", markdown)
        self.assertIn("sourceBom=`BOM-GATE-02,BOM-CAP-04`", markdown)
        self.assertIn("sourceSpec=`SPEC-GATE-02,SPEC-RUN-01`", markdown)
        self.assertIn(
            "sourceGate=`Tauri WebView runtime cell must pass preflight before samples are accepted`",
            markdown,
        )
        self.assertIn("- Matrix diagnostic incomplete cells: `1`", markdown)
        self.assertIn("- Matrix unproven runtime cells: `2`", markdown)

    def test_station_route_probe_state_is_report_blocked_reason(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "failClosed": {
                            "sampleEmissionRequiresPreflightPass": True,
                            "routeProbeSampleEmissionAllowed": False,
                            "blockedCellCount": 0,
                        },
                        "summary": {
                            "sampled": 0,
                            "appGatewayPreflightStatus": "diagnostic incomplete",
                            "appGatewayPreflightProofStatus": "UNPROVEN",
                            "appGatewayPreflightFailedStep": "desktop-gateway",
                            "appGatewayPreflightGateway": "http://127.0.0.1:3030",
                            "appGatewayPreflightStation": "http://10.37.246.80:18080",
                            "appGatewayPreflightCheckCount": 6,
                            "appGatewayPreflightPassedCheckCount": 5,
                            "appGatewayPreflightFailedCheckCount": 1,
                            "appGatewayPreflightStationHealthStatus": "pass",
                            "appGatewayPreflightDesktopGatewayStatus": "fail",
                            "appGatewayPreflightRuntimeClosureStatus": "pass",
                            "appGatewayPreflightRuntimeClosureProofStatus": "PROVEN",
                            "appGatewayPreflightRuntimeClosureSampleEmissionAllowed": True,
                            "appGatewayPreflightRuntimeClosureFailedStep": None,
                            "appGatewayPreflightRuntimeClosureBlockedStep": None,
                            "appGatewayPreflightRuntimeClosureBlockedByStep": None,
                            "appGatewayPreflightRuntimeClosureBlockedDownstreamSteps": [],
                              "appGatewayPreflightRuntimeClosureFailedCheckReasons": {
                                  "docker-daemon": "command exited 1"
                              },
                              "appGatewayPreflightRuntimeClosureLocalRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                              },
                              "appGatewayPreflightRuntimeClosureComposeRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                              },
                            "appGatewayPreflightFailedChecks": ["desktop-gateway"],
                            "browserGatewayLiveStatus": "fail",
                            "browserGatewayLiveProofStatus": "UNPROVEN",
                              "browserGatewayLiveSourceArtifactKind": "desktop-telemetry-live-gate",
                              "browserGatewayLiveSourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                              "browserGatewayLiveSourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
                              "browserGatewayLiveSourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
                              "browserGatewayLiveSourceGate": "Desktop Gateway upload must pass before live telemetry is proven",
                            "browserGatewayLiveFailedStep": "station.telemetry_routes",
                            "browserGatewayLivePassedStepCount": 4,
                            "browserGatewayLiveFailedStepCount": 1,
                            "browserGatewayLivePendingStepCount": 4,
                            "browserGatewayLivePassedSteps": [
                                "preflight.gateway_station",
                                "station.create_temp_account",
                                "gateway.auth_login",
                                "station.auth_login",
                            ],
                            "browserGatewayLivePendingSteps": [
                                "gateway.frontend_telemetry_upload",
                                "station.raw_query",
                                "station.rollup_query",
                                "dev_mirror",
                            ],
                            "browserGatewayLiveEnvironmentClassification": "target-station-handler-missing-while-local-source-registers-routes",
                            "browserGatewayLiveBlockedStep": "gateway.frontend_telemetry_upload",
                            "browserGatewayLiveBlockedPhase": "P0a-3",
                            "browserGatewayLiveBlockedByStep": "station.telemetry_routes",
                            "browserGatewayLiveBlockedByPhase": "P0a-4",
                            "browserGatewayLiveBlockedByGate": "Station frontend telemetry route availability",
                            "browserGatewayLiveBlockedDownstreamSteps": ["station.raw_query", "station.rollup_query", "dev_mirror"],
                              "browserGatewayLiveRuntimeClosureStatus": "diagnostic incomplete",
                              "browserGatewayLiveRuntimeClosureProofStatus": "UNPROVEN",
                              "browserGatewayLiveRuntimeClosureSampleEmissionAllowed": False,
                              "browserGatewayLiveRuntimeClosureDockerDaemonProofStatus": "UNPROVEN",
                              "browserGatewayLiveRuntimeClosureCheckReasons": {
                                  "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                  "docker-daemon": "command exited 1",
                              },
                              "browserGatewayLiveRuntimeClosureFailedCheckReasons": {
                                  "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                  "docker-daemon": "command exited 1",
                              },
                              "browserGatewayLiveRuntimeClosureLocalRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                                  "failedChecks": ["local-dev-store-dsn"],
                              },
                              "browserGatewayLiveRuntimeClosureComposeRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                                  "failedChecks": ["docker-daemon"],
                              },
                              "browserGatewayLiveRuntimeClosureBlockedDownstreamProofs": [
                                  {
                                      "step": "gateway.frontend_telemetry_upload",
                                      "status": "blocked",
                                      "completionStatus": "PARTIAL",
                                      "proofStatus": "UNPROVEN",
                                      "sampleEmissionAllowed": False,
                                      "blockedByStep": "runtime.closure",
                                      "sourceArtifact": "/tmp/runtime-closure.json",
                                      "sourceArtifactKind": "desktop-telemetry-runtime-closure-gate",
                                      "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                                      "sourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
                                      "sourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
                                      "sourceGate": "Managed Station+Postgres runtime closure is required",
                                  }
                              ],
                              "browserGatewayLiveRuntimeClosureBlockedDownstreamProofCount": 1,
                            "browserGatewayLiveTargetRuntimeVersionProofStatus": "PROVEN",
                            "browserGatewayLiveTargetRuntimeBuildCommit": "unknown",
                            "browserGatewayLiveTargetRuntimeBuildLabel": "dev",
                            "browserGatewayLiveTargetRuntimeBuildTime": "unknown",
                            "browserGatewayLiveTargetRuntimeIdentityProofStatus": "UNPROVEN",
                            "browserGatewayLiveTargetRuntimeIdentityMissingFields": ["buildCommit", "buildTime"],
                            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceArtifact": "/tmp/route-probe.json",
                            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceKind": "desktop-telemetry-route-probe",
                            "browserGatewayLiveTargetRuntimeRouteEvidenceSourcePhase": "P0a-4/P0a-5/P0a-6/P0c-5",
                            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceBom": [
                                "BOM-CON-03",
                                "BOM-CON-04",
                                "BOM-CAP-05",
                                "BOM-RUN-05",
                            ],
                            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceSpec": [
                                "SPEC-STA-01",
                                "SPEC-STA-02",
                                "SPEC-DB-01",
                                "SPEC-DB-02",
                                "SPEC-STA-03",
                                "SPEC-MIRROR-01",
                            ],
                            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceGate": (
                                "Station frontend telemetry ingest/query/rollup routes must be available before "
                                "Gateway upload, Station query, and Dev mirror proof can pass"
                            ),
                            "browserGatewayLiveTargetRuntimeRouteEvidenceSourceReason": "station-telemetry-route-probe-fallback",
                            "browserGatewayLiveTargetRuntimeRouteContractProofStatus": "UNPROVEN",
                            "browserGatewayLiveTargetRuntimeMatchedRouteContractCount": 0,
                            "browserGatewayLiveTargetRuntimeMissingRouteContractCount": 3,
                            "browserGatewayLiveTargetRuntimeMissingRouteContracts": [
                                {"name": "frontend-telemetry-ingest", "path": "/telemetry/frontend/events/batch", "method": "POST"},
                                {"name": "frontend-telemetry-query", "path": "/telemetry/frontend/events/query", "method": "POST"},
                                {"name": "frontend-telemetry-rollup-query", "path": "/telemetry/frontend/rollups/query", "method": "POST"},
                            ],
                            "stationTelemetryRouteProofTrusted": False,
                            "stationTelemetryRouteRuntimeClosureProofStatus": "UNPROVEN",
                            "stationTelemetryRouteRuntimeClosureSampleEmissionAllowed": False,
                            "stationTelemetryRouteRuntimeClosureDockerDaemonProofStatus": "UNPROVEN",
                              "stationTelemetryRouteRuntimeClosureFailedCheckReasons": {
                                  "docker-daemon": "command exited 1"
                              },
                              "stationTelemetryRouteRuntimeClosureLocalRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                              },
                              "stationTelemetryRouteRuntimeClosureComposeRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                              },
                        },
                        "stationTelemetryRouteProbeState": {
                            "path": "/tmp/route-probe.json",
                            "status": "diagnostic incomplete",
                            "sourceStatus": "fail",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "sourceArtifact": "/tmp/route-probe.json",
                            "sourceArtifactKind": "desktop-telemetry-route-probe",
                            "sourcePhase": "P0a-4/P0a-5/P0a-6/P0c-5",
                            "sourceBom": ["BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"],
                            "sourceSpec": [
                                "SPEC-STA-01",
                                "SPEC-STA-02",
                                "SPEC-DB-01",
                                "SPEC-DB-02",
                                "SPEC-STA-03",
                                "SPEC-MIRROR-01",
                            ],
                            "sourceGate": "Station frontend telemetry route capability must pass",
                            "sampleEmissionAllowed": False,
                            "reason": "Station route missing",
                              "routeProofTrusted": False,
                              "runtimeClosureProofStatus": "UNPROVEN",
                              "runtimeClosureSampleEmissionAllowed": False,
                              "runtimeClosureDockerDaemonProofStatus": "UNPROVEN",
                                "runtimeClosureFailedCheckReasons": {"docker-daemon": "command exited 1"},
                                "runtimeClosureLocalRuntimeClosure": {
                                    "proofStatus": "UNPROVEN",
                                    "sampleEmissionAllowed": False,
                                },
                                "runtimeClosureComposeRuntimeClosure": {
                                    "proofStatus": "UNPROVEN",
                                    "sampleEmissionAllowed": False,
                                },
                              "environmentClassification": "target-station-handler-missing-while-local-source-registers-routes",
                              "localSourceRouteContractProofStatus": "PROVEN",
                              "localSourceRegisteredRouteContractCount": 3,
                              "localSourceMissingRouteContractCount": 0,
                              "localSourceDeploymentStatus": "diagnostic incomplete",
                              "localSourceDeploymentProofStatus": "UNPROVEN",
                              "localSourceDeploymentReason": "local source route registration is dirty or untracked and is not deployable from HEAD",
                              "localSourceHeadRouteContractStatus": "diagnostic incomplete",
                              "localSourceHeadRouteContractProofStatus": "UNPROVEN",
                              "localSourceHeadRegisteredRouteContractCount": 0,
                              "localSourceHeadMissingRouteContractCount": 3,
                              "localSourceDirtyRelevantPaths": ["apps/station/app/main.go"],
                              "localSourceUntrackedRelevantPaths": [
                                  "apps/station/app/subserver/frontend_telemetry/subserver.go"
                              ],
                              "targetRuntimeRouteContractProofStatus": "UNPROVEN",
                              "targetRuntimeMatchedRouteContractCount": 0,
                              "targetRuntimeMissingRouteContractCount": 3,
                              "targetRuntimeMissingRouteContracts": [
                                  {"name": "frontend-telemetry-ingest", "path": "/telemetry/frontend/events/batch", "method": "POST"},
                                  {"name": "frontend-telemetry-query", "path": "/telemetry/frontend/events/query", "method": "POST"},
                                  {"name": "frontend-telemetry-rollup-query", "path": "/telemetry/frontend/rollups/query", "method": "POST"},
                              ],
                                "targetRuntimeRouteContractSummary": [
                                    {
                                        "name": "frontend-telemetry-ingest",
                                        "path": "/telemetry/frontend/events/batch",
                                        "method": "POST",
                                        "status": "missing",
                                    },
                                    {
                                        "name": "frontend-telemetry-query",
                                        "path": "/telemetry/frontend/events/query",
                                        "method": "POST",
                                        "status": "missing",
                                    },
                                    {
                                        "name": "frontend-telemetry-rollup-query",
                                        "path": "/telemetry/frontend/rollups/query",
                                        "method": "POST",
                                        "status": "missing",
                                    },
                                ],
                              "localSourceRouteEvidence": {
                                  "sourceKind": "local-station-source-route-registration",
                                  "proofStatus": "PROVEN",
                                  "routeContractProofStatus": "PROVEN",
                                  "registeredRoutes": [
                                      "/telemetry/frontend/events/batch",
                                      "/telemetry/frontend/events/query",
                                      "/telemetry/frontend/rollups/query",
                                  ],
                              },
                              "localSourceDeploymentEvidence": {
                                  "sourceKind": "local-station-source-deployment-readiness",
                                  "status": "diagnostic incomplete",
                                  "proofStatus": "UNPROVEN",
                                  "reason": "local source route registration is dirty or untracked and is not deployable from HEAD",
                                  "headRouteContractStatus": "diagnostic incomplete",
                                  "headRouteContractProofStatus": "UNPROVEN",
                                  "headRegisteredRouteContracts": [],
                                  "headMissingRouteContracts": [{"name": "frontend-telemetry-ingest"}],
                                  "dirtyRelevantPaths": ["apps/station/app/main.go"],
                                  "untrackedRelevantPaths": [
                                      "apps/station/app/subserver/frontend_telemetry/subserver.go"
                                  ],
                              },
                            "targetRuntimeRouteEvidence": {
                                "sourceKind": "target-station-runtime-route-fingerprint",
                                "proofStatus": "PROVEN",
                                "versionStatus": "pass",
                                "versionProofStatus": "PROVEN",
                                "versionFingerprint": {
                                    "service": "peers-touch-station",
                                    "buildCommit": "unknown",
                                    "buildLabel": "dev",
                                    "buildTime": "unknown",
                                    "goVersion": "go1.24.6",
                                },
                                "identityStatus": "diagnostic incomplete",
                                "identityProofStatus": "UNPROVEN",
                                "identity": {
                                    "status": "diagnostic incomplete",
                                    "proofStatus": "UNPROVEN",
                                    "missingFields": ["buildCommit", "buildTime"],
                                },
                                "handlerTableProofStatus": "PROVEN",
                                "handlerCount": 379,
                                "routeContractProofStatus": "UNPROVEN",
                                "matchedRouteContracts": [],
                                "missingRouteContracts": [
                                    {"name": "frontend-telemetry-ingest", "path": "/telemetry/frontend/events/batch", "method": "POST"},
                                    {"name": "frontend-telemetry-query", "path": "/telemetry/frontend/events/query", "method": "POST"},
                                    {"name": "frontend-telemetry-rollup-query", "path": "/telemetry/frontend/rollups/query", "method": "POST"},
                                ],
                                "registeredTelemetryRoutes": [],
                                "missingTelemetryRoutes": [
                                    "/telemetry/frontend/events/batch",
                                    "/telemetry/frontend/events/query",
                                    "/telemetry/frontend/rollups/query",
                                ],
                            },
                            "details": ["status=404"],
                            "issue_breakdown": [
                                {
                                    "category": "station-telemetry-route-missing",
                                    "failedStep": "station.telemetry_routes",
                                    "summary": "Station route missing",
                                    "proofImpact": "P0a/P0c remains PARTIAL/UNPROVEN.",
                                    "environmentClassification": "target-station-handler-missing-while-local-source-registers-routes",
                                      "localSourceRouteEvidence": {
                                          "sourceKind": "local-station-source-route-registration",
                                          "proofStatus": "PROVEN",
                                          "registeredRoutes": [
                                              "/telemetry/frontend/events/batch",
                                              "/telemetry/frontend/events/query",
                                              "/telemetry/frontend/rollups/query",
                                          ],
                                      },
                                    "targetRuntimeRouteEvidence": {
                                        "sourceKind": "target-station-runtime-route-fingerprint",
                                          "proofStatus": "PROVEN",
                                          "handlerTableProofStatus": "PROVEN",
                                          "handlerCount": 379,
                                          "missingTelemetryRoutes": [
                                              "/telemetry/frontend/events/batch",
                                              "/telemetry/frontend/events/query",
                                              "/telemetry/frontend/rollups/query",
                                          ],
                                      },
                                }
                            ],
                            "issueBreakdown": [
                                {
                                    "category": "station-telemetry-route-missing",
                                    "failedStep": "station.telemetry_routes",
                                    "summary": "Station route missing",
                                    "proofImpact": "P0a/P0c remains PARTIAL/UNPROVEN.",
                                      "environmentClassification": "target-station-handler-missing-while-local-source-registers-routes",
                                      "localSourceRouteEvidence": {
                                          "sourceKind": "local-station-source-route-registration",
                                          "proofStatus": "PROVEN",
                                          "registeredRoutes": [
                                              "/telemetry/frontend/events/batch",
                                              "/telemetry/frontend/events/query",
                                              "/telemetry/frontend/rollups/query",
                                          ],
                                      },
                                      "targetRuntimeRouteEvidence": {
                                          "sourceKind": "target-station-runtime-route-fingerprint",
                                          "proofStatus": "PROVEN",
                                          "handlerTableProofStatus": "PROVEN",
                                          "handlerCount": 379,
                                          "missingTelemetryRoutes": [
                                              "/telemetry/frontend/events/batch",
                                              "/telemetry/frontend/events/query",
                                              "/telemetry/frontend/rollups/query",
                                          ],
                                      },
                                }
                            ],
                            "recommended_review_commands": [
                                {
                                    "purpose": "Run route probe.",
                                    "command": "python3 tooling/scripts/desktop-telemetry-route-probe.py",
                                }
                            ],
                            "recommendedReviewCommands": [
                                {
                                    "purpose": "Run route probe.",
                                    "command": "python3 tooling/scripts/desktop-telemetry-route-probe.py",
                                }
                            ],
                        },
                        "stationTelemetryDbSchemaState": {
                            "path": "/tmp/db-schema.json",
                            "status": "pass",
                            "sourceStatus": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "sourceArtifact": "/tmp/db-schema.json",
                            "sourceArtifactKind": "desktop-telemetry-db-schema-gate",
                            "sourcePhase": "P0a-5/P0c-5",
                            "sourceBom": ["BOM-CON-03", "BOM-CON-04"],
                            "sourceSpec": ["SPEC-DB-01", "SPEC-DB-02"],
                            "sourceGate": "Station telemetry DB schema evidence must prove runtime migration application",
                            "sampleEmissionAllowed": False,
                            "runtimeMigrationProofStatus": "PROVEN",
                            "migrationPolicy": "runtime-gorm-automigrate",
                            "versionedMigrationStatus": "absent",
                            "versionedMigrationProofStatus": "UNPROVEN",
                        },
                        "stationTelemetryLocalLoopState": {
                            "path": "/tmp/local-loop.json",
                            "status": "pass",
                            "sourceStatus": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "sourceArtifact": "/tmp/local-loop.json",
                            "sourceArtifactKind": "desktop-telemetry-local-loop-gate",
                            "sourcePhase": "P0a-1/P0a-2/P0a-3/P0a-4/P0a-5/P0a-6",
                            "sourceBom": [
                                "BOM-RUN-03",
                                "BOM-RUN-04",
                                "BOM-CON-03",
                                "BOM-CON-04",
                                "BOM-CAP-05",
                            ],
                            "sourceSpec": [
                                "SPEC-GW-01",
                                "SPEC-STA-01",
                                "SPEC-STA-02",
                                "SPEC-DB-01",
                                "SPEC-DB-02",
                                "SPEC-STA-03",
                                "SPEC-MIRROR-01",
                            ],
                            "sourceGate": "Local telemetry static tests must prove Desktop envelope/queue, Gateway upload validation, Station ingest/query/rollup implementation, and Station query contract coverage while leaving live upload/query/mirror proof to env gates",
                            "sampleEmissionAllowed": False,
                            "stationIngestQueryRollupStatus": "pass",
                            "desktopEnvelopeBoundedQueueStatus": "pass",
                            "tauriGatewayUploadValidationStatus": "pass",
                            "gatewayUploadSourceStatus": "pass",
                            "gatewayUploadSourceProofStatus": "PROVEN",
                            "gatewayUploadSourceFailedRequirementCount": 0,
                            "gatewayUploadSourceFailedRequirements": [],
                        },
                        "localTelemetryBufferState": {
                            "path": "/tmp/local-buffer.json",
                            "status": "diagnostic incomplete",
                            "sourceStatus": "diagnostic incomplete",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "sourceArtifact": "/tmp/local-buffer.json",
                            "sourceArtifactKind": "desktop-local-telemetry-buffer-gate",
                            "sourcePhase": "P0b-2/P0b-3/P0b-4/P0b-5/P0b-6/P0b-7/P0c-5",
                            "sourceBom": [
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
                            "sourceSpec": [
                                "SPEC-INT-01",
                                "SPEC-SMP-REACT-01",
                                "SPEC-SMP-STORE-01",
                                "SPEC-SMP-OVERLAY-01",
                                "SPEC-SMP-INVOKE-01",
                                "SPEC-SMP-MAIN-01",
                                "SPEC-MIRROR-01",
                                "SPEC-STA-03",
                            ],
                            "sourceGate": "Local Desktop telemetry buffer diagnostics must prove sampler event families and interactionId presence without replacing Station mirror evidence",
                            "sampleEmissionAllowed": False,
                            "eventCount": 500,
                            "maxEvents": 0,
                            "droppedCount": 42938,
                            "observationTemplateJsonPath": "tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json",
                            "observationTemplateMarkdownPath": "tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.md",
                            "observationSourceStatus": "pass",
                            "observationSourceProofStatus": "PROVEN",
                            "observationExpectedSource": "window.__PT_FRONTEND_TELEMETRY__",
                            "observationActualSource": "window.__PT_FRONTEND_TELEMETRY__",
                            "observationConsistencyStatus": "pass",
                            "observationConsistencyProofStatus": "PROVEN",
                            "observationByKindCountSum": 500,
                            "observationWithInteractionCountSum": 0,
                            "retentionWindowStatus": "diagnostic incomplete",
                            "retentionWindowProofStatus": "UNPROVEN",
                            "retentionWindowMaxEvents": 0,
                            "retentionWindowCapacityProven": False,
                            "retentionWindowDroppedByKindCountSum": 0,
                            "retentionWindowDroppedWithInteractionCountSum": 0,
                            "retentionWindowDroppedKindAttributionProven": False,
                            "retentionWindowDroppedInteractionAttributionValid": True,
                            "retentionWindowTotalObservedOrDroppedCount": 43438,
                            "retentionWindowDropRatio": 0.988489,
                            "retentionWindowRetainedRatio": 0.011511,
                            "retentionWindowTailWindowOnly": True,
                              "retentionWindowReason": "local telemetry snapshot is only the retained tail window because events were dropped",
                              "droppedByKind": {},
                              "droppedWithInteraction": {},
                            "interactionEventKindCount": 0,
                            "familyPassCount": 3,
                            "familyUnprovenCount": 3,
                            "provenFamilies": ["storeUpdate", "invoke", "mainThread"],
                            "unprovenFamilies": ["interaction", "reactCommit", "overlayLatency"],
                        },
                        "redLinePolicy": {
                            "status": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "policies": [],
                        },
                        "cells": [],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(Path(tmp) / "missing-station.json"),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        reasons = [item for item in report["blockedReasons"] if item["scope"] == "station-telemetry-route-probe"]
        self.assertEqual(len(reasons), 1)
        reason = reasons[0]
        self.assertEqual(reason["sourceArtifactKind"], "desktop-telemetry-route-probe")
        self.assertEqual(reason["sourcePhase"], "P0a-4/P0a-5/P0a-6/P0c-5")
        self.assertEqual(reason["sourceBom"], ["BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(reason["sourceSpec"][0], "SPEC-STA-01")
        self.assertEqual(reason["evidenceDetails"], ["status=404"])
        self.assertEqual(
            reason["environmentClassification"],
            "target-station-handler-missing-while-local-source-registers-routes",
        )
        self.assertEqual(reason["localSourceRouteEvidence"]["proofStatus"], "PROVEN")
        self.assertEqual(reason["localSourceDeploymentEvidence"]["proofStatus"], "UNPROVEN")
        self.assertEqual(reason["localSourceDeploymentEvidence"]["headRouteContractProofStatus"], "UNPROVEN")
        self.assertEqual(reason["targetRuntimeRouteEvidence"]["handlerTableProofStatus"], "PROVEN")
        self.assertEqual(reason["targetRuntimeRouteEvidence"]["handlerCount"], 379)
        self.assertEqual(reason["issueBreakdown"][0]["category"], "station-telemetry-route-missing")
        self.assertEqual(reason["recommendedReviewCommands"][0]["command"], "python3 tooling/scripts/desktop-telemetry-route-probe.py")
        route_issues = [
            issue
            for issue in report["issueBreakdown"]
            if issue.get("sourceArtifactKind") == "desktop-telemetry-route-probe"
        ]
        self.assertEqual(len(route_issues), 1)
        self.assertEqual(route_issues[0]["category"], "station-telemetry-route-missing")
        self.assertEqual(
            route_issues[0]["environmentClassification"],
            "target-station-handler-missing-while-local-source-registers-routes",
        )
        self.assertEqual(route_issues[0]["localSourceRouteEvidence"]["proofStatus"], "PROVEN")
        self.assertEqual(route_issues[0]["localSourceDeploymentEvidence"]["proofStatus"], "UNPROVEN")
        self.assertEqual(route_issues[0]["localSourceDeploymentEvidence"]["headRouteContractProofStatus"], "UNPROVEN")
        self.assertEqual(route_issues[0]["targetRuntimeRouteEvidence"]["handlerTableProofStatus"], "PROVEN")
        self.assertEqual(report["matrix"]["stationTelemetryRouteProbeState"]["sourceArtifactKind"], "desktop-telemetry-route-probe")
        self.assertEqual(report["summary"]["status"], "diagnostic incomplete")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["stationTelemetryRouteProbeStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["stationTelemetryRouteProbeSourceStatus"], "fail")
        self.assertEqual(report["summary"]["stationTelemetryRouteProbeProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRouteProbeCompletionStatus"], "PARTIAL")
        self.assertFalse(report["summary"]["stationTelemetryRouteProbeSampleEmissionAllowed"])
        self.assertFalse(report["summary"]["stationTelemetryRouteProofTrusted"])
        self.assertEqual(report["summary"]["stationTelemetryRouteRuntimeClosureProofStatus"], "UNPROVEN")
        self.assertFalse(report["summary"]["stationTelemetryRouteRuntimeClosureSampleEmissionAllowed"])
        self.assertEqual(report["summary"]["stationTelemetryRouteRuntimeClosureDockerDaemonProofStatus"], "UNPROVEN")
        self.assertEqual(
            report["summary"]["stationTelemetryRouteRuntimeClosureFailedCheckReasons"],
            {"docker-daemon": "command exited 1"},
        )
        self.assertEqual(report["summary"]["stationTelemetryRouteRuntimeClosureLocalRuntimeClosure"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRouteRuntimeClosureComposeRuntimeClosure"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["browserGatewayLiveBlockedStep"], "gateway.frontend_telemetry_upload")
        self.assertEqual(report["summary"]["browserGatewayLiveBlockedPhase"], "P0a-3")
        self.assertEqual(report["summary"]["browserGatewayLiveBlockedByStep"], "station.telemetry_routes")
        self.assertEqual(report["summary"]["browserGatewayLiveBlockedByPhase"], "P0a-4")
        self.assertEqual(report["summary"]["browserGatewayLiveBlockedDownstreamSteps"], ["station.raw_query", "station.rollup_query", "dev_mirror"])
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeVersionProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeBuildCommit"], "unknown")
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeBuildLabel"], "dev")
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeBuildTime"], "unknown")
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeIdentityProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeIdentityMissingFields"], ["buildCommit", "buildTime"])
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeRouteEvidenceSourceArtifact"], "/tmp/route-probe.json")
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeRouteEvidenceSourceKind"], "desktop-telemetry-route-probe")
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeRouteEvidenceSourcePhase"], "P0a-4/P0a-5/P0a-6/P0c-5")
        self.assertEqual(
            report["summary"]["browserGatewayLiveTargetRuntimeRouteEvidenceSourceBom"],
            ["BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"],
        )
        self.assertEqual(
            report["summary"]["browserGatewayLiveTargetRuntimeRouteEvidenceSourceSpec"],
            ["SPEC-STA-01", "SPEC-STA-02", "SPEC-DB-01", "SPEC-DB-02", "SPEC-STA-03", "SPEC-MIRROR-01"],
        )
        self.assertEqual(
            report["summary"]["browserGatewayLiveTargetRuntimeRouteEvidenceSourceGate"],
            "Station frontend telemetry ingest/query/rollup routes must be available before Gateway upload, Station query, and Dev mirror proof can pass",
        )
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeRouteEvidenceSourceReason"], "station-telemetry-route-probe-fallback")
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeRouteContractProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeMatchedRouteContractCount"], 0)
        self.assertEqual(report["summary"]["browserGatewayLiveTargetRuntimeMissingRouteContractCount"], 3)
        self.assertEqual(report["summary"]["stationTelemetryRouteRequiredRouteCount"], 3)
        self.assertEqual(
            report["summary"]["stationTelemetryRouteRequiredRoutes"],
            [
                "/telemetry/frontend/events/batch",
                "/telemetry/frontend/events/query",
                "/telemetry/frontend/rollups/query",
            ],
        )
        markdown = module.render_markdown(report)
        self.assertIn("Browser gateway live target route evidence source: `desktop-telemetry-route-probe`", markdown)
        self.assertIn("Browser gateway live target route evidence source artifact: `/tmp/route-probe.json`", markdown)
        self.assertIn("Browser gateway live target route evidence source phase: `P0a-4/P0a-5/P0a-6/P0c-5`", markdown)
        self.assertIn("Browser gateway live target route evidence source BOM: `BOM-CON-03,BOM-CON-04,BOM-CAP-05,BOM-RUN-05`", markdown)
        self.assertIn("Browser gateway live target route evidence source Spec: `SPEC-STA-01,SPEC-STA-02,SPEC-DB-01,SPEC-DB-02,SPEC-STA-03,SPEC-MIRROR-01`", markdown)
        self.assertIn("Browser gateway live target route evidence source reason: `station-telemetry-route-probe-fallback`", markdown)
        self.assertEqual(report["summary"]["stationTelemetryRouteProbedRouteCount"], 0)
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceStatus"], "pass")
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceRegisteredRouteCount"], 3)
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceMissingRouteCount"], 0)
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceRouteContractProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceRegisteredRouteContractCount"], 3)
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceMissingRouteContractCount"], 0)
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceDeploymentStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceDeploymentProofStatus"], "UNPROVEN")
        self.assertIn("not deployable from HEAD", report["summary"]["stationTelemetryRouteLocalSourceDeploymentReason"])
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceHeadRouteContractProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceHeadRegisteredRouteContractCount"], 0)
        self.assertEqual(report["summary"]["stationTelemetryRouteLocalSourceHeadMissingRouteContractCount"], 3)
        self.assertIn("apps/station/app/main.go", report["summary"]["stationTelemetryRouteLocalSourceDirtyRelevantPaths"])
        self.assertIn(
            "apps/station/app/subserver/frontend_telemetry/subserver.go",
            report["summary"]["stationTelemetryRouteLocalSourceUntrackedRelevantPaths"],
        )
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeStatus"], "pass")
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeVersionProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeBuildCommit"], "unknown")
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeBuildLabel"], "dev")
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeBuildTime"], "unknown")
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeIdentityProofStatus"], "UNPROVEN")
        self.assertEqual(
            report["summary"]["stationTelemetryRouteTargetRuntimeIdentityMissingFields"],
            ["buildCommit", "buildTime"],
        )
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeHandlerCount"], 379)
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeRouteContractProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeMatchedRouteContractCount"], 0)
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeMissingRouteContractCount"], 3)
        self.assertEqual(
            [item["status"] for item in report["summary"]["stationTelemetryRouteTargetRuntimeRouteContractSummary"]],
            ["missing", "missing", "missing"],
        )
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeRegisteredRouteCount"], 0)
        self.assertEqual(report["summary"]["stationTelemetryRouteTargetRuntimeMissingRouteCount"], 3)
        self.assertEqual(
            report["summary"]["stationTelemetryRouteTargetRuntimeMissingRoutes"],
            [
                "/telemetry/frontend/events/batch",
                "/telemetry/frontend/events/query",
                "/telemetry/frontend/rollups/query",
            ],
        )
        self.assertEqual(report["matrix"]["stationTelemetryDbSchemaState"]["sourceArtifactKind"], "desktop-telemetry-db-schema-gate")
        self.assertEqual(report["matrix"]["stationTelemetryDbSchemaState"]["sourcePhase"], "P0a-5/P0c-5")
        self.assertEqual(report["matrix"]["stationTelemetryDbSchemaState"]["sourceBom"], ["BOM-CON-03", "BOM-CON-04"])
        self.assertEqual(report["matrix"]["stationTelemetryDbSchemaState"]["sourceSpec"], ["SPEC-DB-01", "SPEC-DB-02"])
        self.assertEqual(report["summary"]["stationTelemetryDbSchemaStatus"], "pass")
        self.assertEqual(report["summary"]["stationTelemetryDbSchemaProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["stationTelemetryDbSchemaRuntimeMigrationProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["stationTelemetryDbSchemaMigrationPolicy"], "runtime-gorm-automigrate")
        self.assertEqual(report["summary"]["stationTelemetryDbSchemaVersionedMigrationStatus"], "absent")
        self.assertEqual(report["summary"]["stationTelemetryDbSchemaVersionedMigrationProofStatus"], "UNPROVEN")
        self.assertEqual(report["matrix"]["stationTelemetryLocalLoopState"]["sourceArtifactKind"], "desktop-telemetry-local-loop-gate")
        self.assertEqual(
            report["matrix"]["stationTelemetryLocalLoopState"]["sourcePhase"],
            "P0a-1/P0a-2/P0a-3/P0a-4/P0a-5/P0a-6",
        )
        self.assertEqual(report["summary"]["stationTelemetryLocalLoopStatus"], "pass")
        self.assertEqual(report["summary"]["stationTelemetryLocalLoopProofStatus"], "PROVEN")
        self.assertEqual(
            report["summary"]["stationTelemetryLocalLoopSourcePhase"],
            "P0a-1/P0a-2/P0a-3/P0a-4/P0a-5/P0a-6",
        )
        self.assertIn("SPEC-STA-03", report["summary"]["stationTelemetryLocalLoopSourceSpec"])
        self.assertIn("SPEC-MIRROR-01", report["summary"]["stationTelemetryLocalLoopSourceSpec"])
        self.assertEqual(report["summary"]["stationTelemetryLocalLoopStationStatus"], "pass")
        self.assertEqual(report["summary"]["stationTelemetryLocalLoopDesktopStatus"], "pass")
        self.assertEqual(report["summary"]["stationTelemetryLocalLoopTauriStatus"], "pass")
        self.assertEqual(report["summary"]["stationTelemetryLocalLoopGatewayUploadSourceStatus"], "pass")
        self.assertEqual(report["summary"]["stationTelemetryLocalLoopGatewayUploadSourceProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["stationTelemetryLocalLoopGatewayUploadSourceFailedRequirements"], [])
        self.assertEqual(report["matrix"]["localTelemetryBufferState"]["sourceArtifactKind"], "desktop-local-telemetry-buffer-gate")
        self.assertEqual(report["matrix"]["localTelemetryBufferState"]["sourcePhase"], "P0b-2/P0b-3/P0b-4/P0b-5/P0b-6/P0b-7/P0c-5")
        self.assertEqual(
            report["matrix"]["localTelemetryBufferState"]["summary"]["sourceArtifact"],
            "/tmp/local-buffer.json",
        )
        self.assertEqual(report["summary"]["localTelemetryBufferStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["localTelemetryBufferProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["localTelemetryBufferEventCount"], 500)
        self.assertEqual(report["summary"]["localTelemetryBufferDroppedCount"], 42938)
        self.assertEqual(
            report["summary"]["localTelemetryBufferObservationTemplateJsonPath"],
            "tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json",
        )
        self.assertEqual(
            report["summary"]["localTelemetryBufferObservationTemplateMarkdownPath"],
            "tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.md",
        )
        self.assertEqual(report["summary"]["localTelemetryBufferObservationSourceStatus"], "pass")
        self.assertEqual(report["summary"]["localTelemetryBufferObservationSourceProofStatus"], "PROVEN")
        self.assertEqual(
            report["summary"]["localTelemetryBufferObservationActualSource"],
            "window.__PT_FRONTEND_TELEMETRY__",
        )
        self.assertEqual(report["summary"]["localTelemetryBufferObservationConsistencyStatus"], "pass")
        self.assertEqual(report["summary"]["localTelemetryBufferObservationConsistencyProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["localTelemetryBufferObservationByKindCountSum"], 500)
        self.assertEqual(report["summary"]["localTelemetryBufferRetentionWindowStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["localTelemetryBufferRetentionWindowProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["localTelemetryBufferRetentionWindowMaxEvents"], 0)
        self.assertFalse(report["summary"]["localTelemetryBufferRetentionWindowCapacityProven"])
        self.assertEqual(report["summary"]["localTelemetryBufferRetentionWindowDroppedByKindCountSum"], 0)
        self.assertEqual(report["summary"]["localTelemetryBufferRetentionWindowDroppedWithInteractionCountSum"], 0)
        self.assertFalse(report["summary"]["localTelemetryBufferRetentionWindowDroppedKindAttributionProven"])
        self.assertTrue(
            report["summary"]["localTelemetryBufferRetentionWindowDroppedInteractionAttributionValid"]
        )
        self.assertEqual(report["summary"]["localTelemetryBufferRetentionWindowTotalObservedOrDroppedCount"], 43438)
        self.assertEqual(report["summary"]["localTelemetryBufferRetentionWindowDropRatio"], 0.988489)
        self.assertTrue(report["summary"]["localTelemetryBufferRetentionWindowTailWindowOnly"])
        self.assertEqual(
            report["summary"]["localTelemetryBufferRetentionWindowReason"],
            "local telemetry snapshot is only the retained tail window because events were dropped",
        )
        self.assertEqual(report["summary"]["localTelemetryBufferDroppedByKind"], {})
        self.assertEqual(report["summary"]["localTelemetryBufferDroppedWithInteraction"], {})
        self.assertEqual(report["summary"]["localTelemetryBufferInteractionEventKindCount"], 0)
        self.assertEqual(report["summary"]["localTelemetryBufferFamilyPassCount"], 3)
        self.assertEqual(report["summary"]["localTelemetryBufferFamilyUnprovenCount"], 3)
        self.assertEqual(report["summary"]["appGatewayPreflightStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["appGatewayPreflightProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["appGatewayPreflightFailedStep"], "desktop-gateway")
        self.assertEqual(report["summary"]["appGatewayPreflightGateway"], "http://127.0.0.1:3030")
        self.assertEqual(report["summary"]["appGatewayPreflightStation"], "http://10.37.246.80:18080")
        self.assertEqual(report["summary"]["appGatewayPreflightCheckCount"], 6)
        self.assertEqual(report["summary"]["appGatewayPreflightPassedCheckCount"], 5)
        self.assertEqual(report["summary"]["appGatewayPreflightFailedCheckCount"], 1)
        self.assertEqual(report["summary"]["appGatewayPreflightStationHealthStatus"], "pass")
        self.assertEqual(report["summary"]["appGatewayPreflightDesktopGatewayStatus"], "fail")
        self.assertEqual(report["summary"]["appGatewayPreflightRuntimeClosureProofStatus"], "PROVEN")
        self.assertTrue(report["summary"]["appGatewayPreflightRuntimeClosureSampleEmissionAllowed"])
        self.assertEqual(
            report["summary"]["appGatewayPreflightRuntimeClosureFailedCheckReasons"],
            {"docker-daemon": "command exited 1"},
        )
        self.assertEqual(report["summary"]["appGatewayPreflightRuntimeClosureLocalRuntimeClosure"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["appGatewayPreflightRuntimeClosureComposeRuntimeClosure"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["appGatewayPreflightFailedChecks"], ["desktop-gateway"])
        self.assertEqual(report["summary"]["browserGatewayLiveStatus"], "fail")
        self.assertEqual(report["summary"]["browserGatewayLiveProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["browserGatewayLiveSourceArtifactKind"], "desktop-telemetry-live-gate")
        self.assertEqual(report["summary"]["browserGatewayLiveSourcePhase"], "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5")
        self.assertEqual(report["summary"]["browserGatewayLiveRuntimeClosureProofStatus"], "UNPROVEN")
        self.assertFalse(report["summary"]["browserGatewayLiveRuntimeClosureSampleEmissionAllowed"])
        self.assertEqual(report["summary"]["browserGatewayLiveRuntimeClosureDockerDaemonProofStatus"], "UNPROVEN")
        self.assertIn("docker-daemon", report["summary"]["browserGatewayLiveRuntimeClosureFailedCheckReasons"])
        self.assertIn("local-dev-store-dsn", report["summary"]["browserGatewayLiveRuntimeClosureCheckReasons"])
        self.assertEqual(
            report["summary"]["browserGatewayLiveRuntimeClosureLocalRuntimeClosure"]["failedChecks"],
            ["local-dev-store-dsn"],
        )
        self.assertEqual(
            report["summary"]["browserGatewayLiveRuntimeClosureComposeRuntimeClosure"]["failedChecks"],
            ["docker-daemon"],
        )
        self.assertEqual(report["summary"]["browserGatewayLiveRuntimeClosureBlockedDownstreamProofCount"], 1)
        self.assertEqual(
            report["summary"]["browserGatewayLiveRuntimeClosureBlockedDownstreamProofs"][0]["step"],
            "gateway.frontend_telemetry_upload",
        )
        self.assertEqual(report["summary"]["browserGatewayLiveFailedStep"], "station.telemetry_routes")
        self.assertEqual(report["summary"]["browserGatewayLivePassedStepCount"], 4)
        self.assertEqual(report["summary"]["browserGatewayLiveFailedStepCount"], 1)
        self.assertEqual(report["summary"]["browserGatewayLivePendingStepCount"], 4)
        self.assertEqual(report["summary"]["browserGatewayLivePendingSteps"][-1], "dev_mirror")
        self.assertEqual(
            report["summary"]["browserGatewayLiveEnvironmentClassification"],
            "target-station-handler-missing-while-local-source-registers-routes",
        )
        self.assertEqual(
            report["summary"]["stationTelemetryRouteEnvironmentClassification"],
              "target-station-handler-missing-while-local-source-registers-routes",
        )
        self.assertIn("station-telemetry-route-probe", report["summary"]["blockedScopes"])
        self.assertGreater(report["summary"]["blockedReasonCount"], 0)
        self.assertGreater(report["summary"]["issueCount"], 0)
        markdown = module.render_markdown(report)
        self.assertIn("## Report Summary", markdown)
        self.assertIn("- Sample emission allowed: `False`", markdown)
        self.assertIn("Station local loop gateway upload source proof: `PROVEN`", markdown)
        self.assertIn("- Station route probe: `diagnostic incomplete`", markdown)
        self.assertIn("- Station route proof trusted: `False`", markdown)
        self.assertIn('"docker-daemon": "command exited 1"', markdown)
        self.assertIn("- Browser gateway live runtime closure local closure proof: `UNPROVEN`", markdown)
        self.assertIn("- Browser gateway live runtime closure compose closure proof: `UNPROVEN`", markdown)
        self.assertIn("- Station route runtime closure proof: `UNPROVEN`", markdown)
        self.assertIn("- Station route local source routes: `3/3`", markdown)
        self.assertIn("- Station route target runtime routes: `0/3`", markdown)
        self.assertIn(
            "- Station route target missing routes: `/telemetry/frontend/events/batch,/telemetry/frontend/events/query,/telemetry/frontend/rollups/query`",
            markdown,
        )
        self.assertIn("- Station route target handler count: `379`", markdown)
        self.assertIn("- Station route local source contract proof: `PROVEN`", markdown)
        self.assertIn("- Station route local deployable source proof: `UNPROVEN`", markdown)
        self.assertIn("- Station route local deployable HEAD contract proof: `UNPROVEN`", markdown)
        self.assertIn("- Station route target contract proof: `UNPROVEN`", markdown)
        self.assertIn("- Local telemetry buffer retention max events: `0`", markdown)
        self.assertIn("- Local telemetry buffer total observed or dropped: `43438`", markdown)
        self.assertIn("- Local telemetry buffer drop ratio: `0.988489`", markdown)
        self.assertIn("- Local telemetry buffer dropped byKind sum: `0`", markdown)
        self.assertIn("- Local telemetry buffer dropped withInteraction sum: `0`", markdown)
        self.assertIn("- Local telemetry buffer dropped interaction attribution valid: `True`", markdown)
        self.assertIn("- Station route target missing contracts: `POST /telemetry/frontend/events/batch", markdown)
        self.assertIn("- Station route target build commit: `unknown`", markdown)
        self.assertIn("- Station route target identity proof: `UNPROVEN`", markdown)
        self.assertIn("- Station route target identity missing fields: `buildCommit,buildTime`", markdown)
        self.assertIn("- Station local loop: `pass`", markdown)
        self.assertIn("- App gateway preflight: `diagnostic incomplete`", markdown)
        self.assertIn("- App gateway preflight failed step: `desktop-gateway`", markdown)
        self.assertIn("- Browser gateway live telemetry: `fail`", markdown)
        self.assertIn("- Browser gateway live source phase: `P0a-3/P0a-4/P0a-5/P0a-6/P0c-5`", markdown)
        self.assertIn("- Browser gateway live failed step: `station.telemetry_routes`", markdown)
        self.assertIn("- Browser gateway live blocked step: `gateway.frontend_telemetry_upload`", markdown)
        self.assertIn("- Browser gateway live blocked phase: `P0a-3`", markdown)
        self.assertIn("- Browser gateway live blocked by step: `station.telemetry_routes`", markdown)
        self.assertIn("- Browser gateway live blocked by phase: `P0a-4`", markdown)
        self.assertIn("- Browser gateway live blocked downstream steps: `station.raw_query,station.rollup_query,dev_mirror`", markdown)
        self.assertIn("- Browser gateway live runtime closure proof: `UNPROVEN`", markdown)
        self.assertIn("- Browser gateway live runtime closure sample emission allowed: `False`", markdown)
        self.assertIn("- Browser gateway live runtime closure Docker daemon proof: `UNPROVEN`", markdown)
        self.assertIn("- Browser gateway live runtime closure blocked downstream proof count: `1`", markdown)
        self.assertIn("- Browser gateway live target build commit: `unknown`", markdown)
        self.assertIn("- Browser gateway live target identity proof: `UNPROVEN`", markdown)
        self.assertIn("- Browser gateway live target identity missing fields: `buildCommit,buildTime`", markdown)
        self.assertIn("- Browser gateway live target route contract proof: `UNPROVEN`", markdown)
        self.assertIn("- Browser gateway live target route contracts: `0/3`", markdown)
        self.assertIn("## Desktop Telemetry Local Loop", markdown)
        self.assertIn("- Source kind: `desktop-telemetry-local-loop-gate`", markdown)
        self.assertIn("- Desktop envelope/queue: `pass`", markdown)
        self.assertIn("- Local telemetry buffer: `diagnostic incomplete`", markdown)
        self.assertIn(
            "- Local telemetry buffer observation template: `tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json`",
            markdown,
        )
        self.assertIn(
            "- Local telemetry buffer observation template Markdown: `tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.md`",
            markdown,
        )
        self.assertIn("## Desktop Local Telemetry Buffer", markdown)
        self.assertIn("- Source kind: `desktop-local-telemetry-buffer-gate`", markdown)
        self.assertIn("- Dropped count: `42938`", markdown)
        self.assertIn("- Local telemetry buffer tail only: `True`", markdown)
        self.assertIn(
            "- Local telemetry buffer retention reason: `local telemetry snapshot is only the retained tail window because events were dropped`",
            markdown,
        )
        self.assertIn("- Local telemetry buffer dropped byKind: `{}`", markdown)
        self.assertIn("- Local telemetry buffer dropped withInteraction: `{}`", markdown)
        self.assertIn("- Local telemetry buffer retention capacity proven: `False`", markdown)
        self.assertIn("- Local telemetry buffer dropped kind attribution proven: `False`", markdown)
        self.assertIn("- Local telemetry buffer dropped interaction attribution valid: `True`", markdown)
        self.assertIn(
            "Observation template JSON: `tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.json`",
            markdown,
        )
        self.assertIn(
            "Observation template Markdown: `tooling/acceptance/reports/desktop-local-telemetry-buffer-observations-template.md`",
            markdown,
        )
        self.assertIn("- Interaction event kinds: `0`", markdown)
        self.assertIn("- Unproven families: `interaction,reactCommit,overlayLatency`", markdown)
        self.assertIn("- Station DB schema: `pass`", markdown)
        self.assertIn("## Station Telemetry DB Schema", markdown)
        self.assertIn("- Migration policy: `runtime-gorm-automigrate`", markdown)
        self.assertIn("- Versioned migration status: `absent`", markdown)
        self.assertIn("station-telemetry-route-probe", markdown)
        self.assertIn("sourceKind=`desktop-telemetry-route-probe`", markdown)
        self.assertIn("envClass=`target-station-handler-missing-while-local-source-registers-routes`", markdown)
        self.assertIn("localSourceRouteEvidence", markdown)
        self.assertIn("localSourceDeploymentEvidence", markdown)
        self.assertIn("targetRuntimeRouteEvidence", markdown)
        self.assertIn("/telemetry/frontend/events/batch", markdown)

    def test_loaded_station_mirror_and_pass_matrix_without_commits_stays_unproven(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            station = Path(tmp) / "station.json"
            station.write_text(
                json.dumps(
                    {
                        "source": "station-query",
                        "summary": {"eventCount": 1, "rollupCount": 0},
                        "events": [{"kind": "route.visible", "durationMs": 42}],
                        "rollups": [],
                    }
                ),
                encoding="utf-8",
            )
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "summary": {
                            "sampled": 4,
                            "stationTelemetryRuntimeClosureStatus": "pass",
                            "stationTelemetryRuntimeClosureProofStatus": "PROVEN",
                        },
                        "stationTelemetryRuntimeClosureState": {
                            "status": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "sampleEmissionAllowed": True,
                            "managedRuntimeClosure": "compose-station-postgres",
                            "localRuntimeClosureProofStatus": "UNPROVEN",
                            "composeRuntimeClosureProofStatus": "PROVEN",
                            "dockerDaemonProofStatus": "PROVEN",
                            "failedCheckCount": 0,
                        },
                        "redLinePolicy": {
                            "status": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "policies": [],
                        },
                        "cells": [
                            {
                                "cellId": "browser-gateway",
                                "status": "sampled",
                                "proofStatus": "PROVEN",
                                  "sampleEmissionAllowed": True,
                                "reason": "sampled",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(station),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["reactCommitAggregation"]["status"], "diagnostic incomplete")
        self.assertEqual(report["reactCommitAggregation"]["reason"], "no react.commit events in Station mirror")
        reason = self.blocked_reason(report, "react-commit-aggregation")
        self.assertEqual(reason["status"], "diagnostic incomplete")
        self.assertEqual(reason["proofStatus"], "UNPROVEN")
        self.assertEqual(reason["reason"], "no react.commit events in Station mirror")
        self.assertEqual(reason["evidenceStatus"], "loaded")
        self.assertEqual(reason["sourcePhase"], "P0b-3/P0c-5")
        self.assertIn("BOM-SMP-02", reason["sourceBom"])
        self.assertIn("SPEC-SMP-REACT-01", reason["sourceSpec"])
        self.assert_station_mirror_source_trace(reason, station)
        self.assert_blocked_reason_has_diagnostics(reason, "react-commit-aggregation")

    def test_loaded_station_mirror_and_pass_matrix_produce_proven_report(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            station = Path(tmp) / "station.json"
            station.write_text(
                json.dumps(
                    {
                        **self.mirror_metadata(),
                        "source": "station-query",
                        "stationUrl": "http://127.0.0.1:18080",
                        "filters": {"runtime": "browser-gateway"},
                        "summary": {
                            "eventCount": 2,
                            "rollupCount": 1,
                            "maxP95DurationMs": 42,
                        },
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
                                "kind": "react.commit",
                                "durationMs": 14,
                                "interactionId": "i-1",
                                "module": "page:chat",
                                "owner": "chat",
                                "source": "page-host",
                            },
                            {
                                "kind": "store.update",
                                "durationMs": 3,
                                "interactionId": "i-1",
                                "module": "socialChat",
                                "owner": "socialChat",
                                "source": "store",
                                "data": {
                                    "changedKeys": ["selectedConversationId", "unreadCount"],
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
                                "kind": "overlay.hidden",
                                "interactionId": "i-1",
                                "module": "context-menu:chat:friend:abc",
                                "owner": "context-menu:chat:friend:abc",
                                "phase": "interaction",
                                "source": "overlay",
                                "data": {
                                    "open": False,
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
                                "data": {
                                    "command": "telemetry_frontend_upload",
                                    "quiet": False,
                                },
                            },
                            {
                                "kind": "invoke.completed",
                                "durationMs": 18,
                                "interactionId": "i-1",
                                "module": "telemetry_frontend",
                                "owner": "telemetry_frontend_upload",
                                "phase": "interaction",
                                "source": "invoke",
                                "data": {
                                    "command": "telemetry_frontend_upload",
                                    "quiet": False,
                                    "status": "ok",
                                },
                            },
                            {
                                "kind": "longtask.detected",
                                "durationMs": 72,
                                "interactionId": "i-1",
                                "module": "main-thread",
                                "owner": "unknown",
                                "source": "runtime",
                                "data": {
                                    "thresholdMs": 50,
                                    "exception": {
                                        "owner": "runtime-platform",
                                        "budgetMs": 80,
                                        "expiresAt": "2026-08-01T00:00:00Z",
                                        "reason": "synthetic report test exception",
                                    },
                                },
                            },
                        ],
                        "rollups": [
                            {
                                "module": "shell",
                                "runtime": "browser-gateway",
                                "kind": "route.visible",
                                "count": 2,
                                "p50DurationMs": 21,
                                "p95DurationMs": 42,
                                "maxDurationMs": 43,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "summary": {
                            "sampled": 4,
                            "stationTelemetryRuntimeClosureStatus": "pass",
                            "stationTelemetryRuntimeClosureProofStatus": "PROVEN",
                        },
                        "stationTelemetryRuntimeClosureState": {
                            "status": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "sampleEmissionAllowed": True,
                            "managedRuntimeClosure": "compose-station-postgres",
                            "localRuntimeClosureProofStatus": "UNPROVEN",
                            "composeRuntimeClosureProofStatus": "PROVEN",
                            "dockerDaemonProofStatus": "PROVEN",
                            "failedCheckCount": 0,
                        },
                        "redLinePolicy": {
                            "status": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "policies": [],
                        },
                        "cells": [
                            {
                                "cellId": "browser-gateway",
                                "status": "sampled",
                                "proofStatus": "PROVEN",
                                  "sampleEmissionAllowed": True,
                                "reason": "sampled",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            anchor = Path(tmp) / "anchor.json"
            anchor.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "sampleEmissionAllowed": True,
                        "sourceAnchors": {
                            "status": "loaded",
                            "presentCount": 9,
                            "requiredCount": 9,
                        },
                        "domAutomation": {
                            "status": "pass",
                            "proofStatus": "PROVEN",
                        },
                    }
                ),
                encoding="utf-8",
            )
            anchor_dom_gate = Path(tmp) / "desktop-anchor-dom-evidence-gate-latest.json"
            anchor_dom_gate.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "sampleEmissionAllowed": True,
                        "domAutomation": {
                            "status": "pass",
                            "proofStatus": "PROVEN",
                            "path": "/tmp/dom.json",
                            "evidenceStatus": "loaded",
                        },
                    }
                ),
                encoding="utf-8",
            )
            anchor_source_gate = Path(tmp) / "desktop-anchor-source-gate-latest.json"
            anchor_source_gate.write_text(json.dumps(self.proven_anchor_source_gate()), encoding="utf-8")
            sampler_gate = Path(tmp) / "desktop-performance-sampler-gate-latest.json"
            sampler_gate.write_text(json.dumps(self.proven_sampler_gate()), encoding="utf-8")
            preflight = Path(tmp) / "desktop-performance-preflight.json"
            preflight.write_text(json.dumps(self.proven_preflight()), encoding="utf-8")
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(station),
                    matrix_report=str(matrix),
                    preflight_report=str(preflight),
                    anchor_inventory_report=str(anchor),
                    anchor_source_gate_report=str(anchor_source_gate),
                    anchor_dom_evidence_gate_report=str(anchor_dom_gate),
                    sampler_gate_report=str(sampler_gate),
                )
            )

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["stationMirrorSource"]["status"], "loaded")
        self.assertEqual(report["stationMirrorSource"]["proofStatus"], "PROVEN")
        self.assertEqual(report["preflightState"]["status"], "pass")
        self.assertEqual(report["preflightState"]["proofStatus"], "PROVEN")
        self.assertEqual(report["anchorSourceGate"]["status"], "pass")
        self.assertEqual(report["anchorSourceGate"]["proofStatus"], "PROVEN")
        self.assertEqual(report["anchorInventory"]["status"], "pass")
        self.assertTrue(report["anchorInventory"]["sampleEmissionAllowed"])
        self.assertTrue(report["summary"]["anchorInventorySampleEmissionAllowed"])
        self.assertEqual(report["anchorDomEvidenceGate"]["status"], "pass")
        self.assertTrue(report["anchorDomEvidenceGate"]["sampleEmissionAllowed"])
        self.assertTrue(report["summary"]["anchorDomEvidenceGateSampleEmissionAllowed"])
        self.assertEqual(report["samplerGate"]["status"], "pass")
        self.assertEqual(report["samplerGate"]["proofStatus"], "PROVEN")
        self.assertEqual(report["anchorInventory"]["sourceAnchors"]["presentCount"], 9)
        self.assertEqual(report["stationMirror"]["maxP95DurationMs"], 42)
        self.assertEqual(report["rollups"][0]["p95DurationMs"], 42)
        self.assertEqual(report["reactCommitAggregation"]["commitCount"], 2)
        self.assertEqual(report["reactCommitAggregation"]["totalDurationMs"], 24)
        self.assertEqual(report["reactCommitAggregation"]["maxDurationMs"], 14)
        self.assertEqual(report["storeUpdateAggregation"]["status"], "loaded")
        self.assertEqual(report["storeUpdateAggregation"]["updateCount"], 1)
        self.assertEqual(report["storeUpdateAggregation"]["unknownAttributionCount"], 0)
        self.assertEqual(
            report["storeUpdateAggregation"]["stores"],
            [
                {
                    "changedKeys": ["selectedConversationId", "unreadCount"],
                    "fanout": 3,
                    "interactionId": "i-1",
                    "listenerCount": 3,
                    "maxDurationMs": 3.0,
                    "owner": "socialChat",
                    "store": "socialChat",
                    "totalDurationMs": 3.0,
                    "updateCount": 1,
                }
            ],
        )
        self.assertEqual(report["overlayLatencyAggregation"]["status"], "loaded")
        self.assertEqual(report["overlayLatencyAggregation"]["intentCount"], 1)
        self.assertEqual(report["overlayLatencyAggregation"]["visibleCount"], 1)
        self.assertEqual(report["overlayLatencyAggregation"]["hiddenCount"], 1)
        self.assertEqual(report["overlayLatencyAggregation"]["maxVisibleLatencyMs"], 32)
        self.assertEqual(
            report["overlayLatencyAggregation"]["overlays"],
            [
                {
                    "hiddenCount": 1,
                    "intentCount": 1,
                    "interactionId": "i-1",
                    "status": "paired",
                    "surface": "chat-conversation-context-menu",
                    "target": "context-menu:chat:friend:abc",
                    "visibleCount": 1,
                    "visibleLatencyMs": 32.0,
                }
            ],
        )
        self.assertEqual(report["invokeAggregation"]["status"], "loaded")
        self.assertEqual(report["invokeAggregation"]["eventCount"], 2)
        self.assertEqual(report["invokeAggregation"]["terminalCount"], 1)
        self.assertEqual(report["invokeAggregation"]["interactionInvokeCount"], 1)
        self.assertEqual(report["invokeAggregation"]["startupInvokeCount"], 0)
        self.assertEqual(report["invokeAggregation"]["backgroundInvokeCount"], 0)
        self.assertEqual(report["interactionCorrelation"]["status"], "loaded")
        self.assertEqual(report["interactionCorrelation"]["unlinkedEventCount"], 0)
        self.assertEqual(
            report["invokeAggregation"]["commands"],
            [
                {
                    "command": "telemetry_frontend_upload",
                    "completedCount": 1,
                    "failedCount": 0,
                    "interactionId": "i-1",
                    "maxDurationMs": 18.0,
                    "phase": "interaction",
                    "quiet": False,
                    "startedCount": 1,
                    "totalDurationMs": 18.0,
                }
            ],
        )
        self.assertEqual(report["mainThreadExceptions"]["status"], "loaded")
        self.assertEqual(report["mainThreadExceptions"]["eventCount"], 1)
        self.assertEqual(report["mainThreadExceptions"]["violationCount"], 0)
        self.assertEqual(report["mainThreadExceptions"]["exceptionCount"], 1)
        self.assertEqual(report["mainThreadExceptions"]["events"][0]["status"], "excepted")
        self.assertEqual(
            report["reactCommitAggregation"]["windows"],
            [
                {
                    "commitCount": 1,
                    "interactionId": "i-1",
                    "maxDurationMs": 14.0,
                    "module": "page:chat",
                    "owner": "chat",
                    "source": "page-host",
                    "totalDurationMs": 14.0,
                },
                {
                    "commitCount": 1,
                    "interactionId": "i-1",
                    "maxDurationMs": 10.0,
                    "module": "ready-shell",
                    "owner": "ready-shell",
                    "source": "shell",
                    "totalDurationMs": 10.0,
                },
            ],
        )
        self.assertEqual(report["summary"]["status"], "pass")
        self.assertEqual(report["summary"]["completionStatus"], "DONE")
        self.assertEqual(report["summary"]["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertTrue(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["blockedReasonCount"], 0)
        self.assertEqual(report["summary"]["issueCount"], 0)
        self.assertEqual(report["summary"]["unprovenScopeCount"], 0)
        self.assertEqual(report["summary"]["stationMirrorEventCount"], 2)
        self.assertEqual(report["summary"]["stationMirrorRollupCount"], 1)
        self.assertEqual(report["summary"]["matrixStatus"], "pass")
        self.assertEqual(report["summary"]["matrixSampledCells"], 4)
        self.assertEqual(report["summary"]["samplerGateStatus"], "pass")
        self.assertEqual(report["summary"]["redLineStatus"], "pass")
        markdown = module.render_markdown(report)
        self.assertIn("## Report Summary", markdown)
        self.assertIn("- Sample emission allowed: `True`", markdown)
        self.assertIn("- Issues: `0`", markdown)
        self.assertEqual(report["blockedReasons"], [])

    def test_loaded_station_mirror_requires_source_metadata(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            station = Path(tmp) / "station.json"
            station.write_text(
                json.dumps(
                    {
                        "source": "station-query",
                        "summary": {"eventCount": 2, "rollupCount": 0},
                        "events": [
                            {"kind": "interaction.started", "interactionId": "i-1"},
                            {
                                "kind": "react.commit",
                                "durationMs": 10,
                                "interactionId": "i-1",
                                "module": "ready-shell",
                                "owner": "ready-shell",
                                "source": "shell",
                            },
                        ],
                        "rollups": [],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(station),
                    matrix_report=str(Path(tmp) / "missing-matrix.json"),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["stationMirrorSource"]["status"], "diagnostic incomplete")
        self.assertEqual(report["stationMirrorSource"]["proofStatus"], "UNPROVEN")
        source_reasons = [item for item in report["blockedReasons"] if item["scope"] == "station-mirror-source"]
        self.assertEqual(len(source_reasons), 1)
        self.assertEqual(source_reasons[0]["status"], "diagnostic incomplete")
        self.assertEqual(source_reasons[0]["proofStatus"], "UNPROVEN")
        self.assertEqual(source_reasons[0]["sourceArtifact"], str(station))
        self.assertEqual(source_reasons[0]["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(source_reasons[0]["completionStatus"], "PARTIAL")
        self.assertEqual(source_reasons[0]["sourceProofStatus"], "UNPROVEN")
        self.assertFalse(source_reasons[0]["sampleEmissionAllowed"])
        self.assertIn("missing or invalid artifactKind", source_reasons[0]["evidenceDetails"])
        self.assertIn("missing or invalid phase", source_reasons[0]["evidenceDetails"])
        self.assertIn("missing required mirror BOM binding", source_reasons[0]["evidenceDetails"])
        self.assertIn("missing required mirror Spec binding", source_reasons[0]["evidenceDetails"])
        self.assertEqual(source_reasons[0]["issue_breakdown"][0]["category"], "station-mirror-source")
        self.assertEqual(source_reasons[0]["issueBreakdown"][0]["category"], "station-mirror-source")
        self.assertEqual(source_reasons[0]["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(source_reasons[0]["recommendedReviewCommands"][0]["command"], "make desktop")
        markdown = module.render_markdown(report)
        self.assertIn("- Source status: `diagnostic incomplete`", markdown)
        self.assertIn("`station-mirror-source`", markdown)
        self.assertIn("sourceKind=`desktop-performance-station-mirror`", markdown)
        self.assertIn("sourceCompletion=`PARTIAL`", markdown)
        self.assertIn("sourceProof=`UNPROVEN`", markdown)
        self.assertIn("details=`missing or invalid artifactKind,missing or invalid phase,missing required mirror BOM binding", markdown)
        self.assertIn("issues=`station-mirror-source`", markdown)

    def test_unlinked_interaction_event_blocks_report(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            station = Path(tmp) / "station.json"
            station.write_text(
                json.dumps(
                    {
                        "source": "station-query",
                        "summary": {"eventCount": 3, "rollupCount": 0},
                        "events": [
                            {"kind": "interaction.started", "interactionId": "i-1"},
                            {
                                "kind": "route.visible",
                                "durationMs": 42,
                                "module": "ready-shell",
                                "owner": "ready-shell",
                                "source": "shell",
                            },
                            {
                                "kind": "react.commit",
                                "durationMs": 10,
                                "interactionId": "i-1",
                                "module": "ready-shell",
                                "owner": "ready-shell",
                                "source": "shell",
                            },
                        ],
                        "rollups": [],
                    }
                ),
                encoding="utf-8",
            )
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "failClosed": {"sampleEmissionRequiresPreflightPass": True, "blockedCellCount": 0},
                        "summary": {"sampled": 1},
                        "redLinePolicy": {
                            "status": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "policies": [],
                        },
                        "cells": [],
                    }
                ),
                encoding="utf-8",
            )
            anchor = Path(tmp) / "anchor.json"
            anchor.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "proofStatus": "PROVEN",
                        "sourceAnchors": {"status": "pass", "presentCount": 9, "requiredCount": 9},
                        "domAutomation": {"status": "pass", "proofStatus": "PROVEN"},
                    }
                ),
                encoding="utf-8",
            )
            dom_gate = Path(tmp) / "desktop-anchor-dom-evidence-gate-latest.json"
            dom_gate.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "domAutomation": {"status": "pass", "proofStatus": "PROVEN"},
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(station),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(anchor),
                )
            )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["interactionCorrelation"]["status"], "diagnostic incomplete")
        self.assertEqual(report["interactionCorrelation"]["unlinkedEventCount"], 1)
        reasons = [item for item in report["blockedReasons"] if item["scope"] == "interaction-correlation"]
        self.assertEqual(len(reasons), 1)
        self.assertEqual(reasons[0]["reason"], "interaction-correlated events are missing interactionId")
        self.assertEqual(reasons[0]["sourcePhase"], "P0b-2/P0c-5")
        self.assertIn("BOM-CON-02", reasons[0]["sourceBom"])
        self.assertIn("SPEC-INT-01", reasons[0]["sourceSpec"])
        self.assert_station_mirror_source_trace(reasons[0], station)
        self.assert_blocked_reason_has_diagnostics(reasons[0], "interaction-correlation")
        markdown = module.render_markdown(report)
        self.assertIn("## Interaction Correlation", markdown)
        self.assertIn("- Unlinked events: `1`", markdown)
        self.assertIn("## Unlinked Interaction Events", markdown)
        self.assertIn("`route.visible`", markdown)

    def test_over_budget_main_thread_event_without_exception_blocks_report(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            station = Path(tmp) / "station.json"
            station.write_text(
                json.dumps(
                    {
                        "source": "station-query",
                        "summary": {"eventCount": 3, "rollupCount": 0},
                        "events": [
                            {
                                "kind": "react.commit",
                                "durationMs": 10,
                                "interactionId": "i-1",
                                "module": "ready-shell",
                                "owner": "ready-shell",
                                "source": "shell",
                            },
                            {
                                "kind": "longtask.detected",
                                "durationMs": 72,
                                "interactionId": "i-1",
                                "module": "main-thread",
                                "owner": "unknown",
                                "source": "runtime",
                                "data": {"thresholdMs": 50},
                            },
                        ],
                        "rollups": [],
                    }
                ),
                encoding="utf-8",
            )
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "summary": {"sampled": 4},
                        "redLinePolicy": {
                            "status": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "policies": [],
                        },
                        "cells": [
                            {
                                "cellId": "browser-gateway",
                                "status": "sampled",
                                "proofStatus": "PROVEN",
                                  "sampleEmissionAllowed": True,
                                "reason": "sampled",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(station),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["mainThreadExceptions"]["status"], "fail")
        self.assertEqual(report["mainThreadExceptions"]["violationCount"], 1)
        self.assertEqual(report["mainThreadExceptions"]["events"][0]["status"], "violation")
        reason = self.blocked_reason(report, "main-thread-exceptions")
        self.assertEqual(reason["status"], "fail")
        self.assertEqual(reason["proofStatus"], "UNPROVEN")
        self.assertEqual(reason["reason"], "main-thread events include unregistered over-budget entries")
        self.assertEqual(reason["evidenceStatus"], "loaded")
        self.assertEqual(reason["sourcePhase"], "P0b-7/P0c-5")
        self.assertIn("BOM-SMP-06", reason["sourceBom"])
        self.assertIn("SPEC-SMP-MAIN-01", reason["sourceSpec"])
        self.assert_station_mirror_source_trace(reason, station)
        self.assert_blocked_reason_has_diagnostics(reason, "main-thread-exceptions")

    def test_missing_main_thread_events_keeps_report_unproven(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            station = Path(tmp) / "station.json"
            station.write_text(
                json.dumps(
                    {
                        **self.mirror_metadata(),
                        "source": "station-query",
                        "summary": {"eventCount": 5, "rollupCount": 0},
                        "events": [
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
                                    "fanout": 1,
                                    "listenerCount": 1,
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
                                    "overlayTarget": "context-menu:chat:friend:abc",
                                    "surface": "chat-conversation-context-menu",
                                },
                            },
                            {
                                "kind": "invoke.completed",
                                "durationMs": 18,
                                "interactionId": "i-1",
                                "module": "telemetry_frontend",
                                "owner": "telemetry_frontend_upload",
                                "phase": "interaction",
                                "source": "invoke",
                                "data": {"command": "telemetry_frontend_upload", "quiet": False},
                            },
                        ],
                        "rollups": [],
                    }
                ),
                encoding="utf-8",
            )
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "summary": {"sampled": 4},
                        "redLinePolicy": {
                            "status": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "policies": [],
                        },
                        "cells": [],
                    }
                ),
                encoding="utf-8",
            )
            anchor = Path(tmp) / "anchor.json"
            anchor.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "sourceAnchors": {"status": "loaded", "presentCount": 9, "requiredCount": 9},
                        "domAutomation": {"status": "pass", "proofStatus": "PROVEN"},
                    }
                ),
                encoding="utf-8",
            )
            anchor_dom_gate = Path(tmp) / "desktop-anchor-dom-evidence-gate-latest.json"
            anchor_dom_gate.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "domAutomation": {"status": "pass", "proofStatus": "PROVEN"},
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(station),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(anchor),
                    anchor_dom_evidence_gate_report=str(anchor_dom_gate),
                )
            )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["mainThreadExceptions"]["status"], "diagnostic incomplete")
        self.assertEqual(
            report["mainThreadExceptions"]["reason"],
            "no main-thread longtask/layout/paint events in Station mirror",
        )
        reason = self.blocked_reason(report, "main-thread-exceptions")
        self.assertEqual(reason["status"], "diagnostic incomplete")
        self.assertEqual(reason["proofStatus"], "UNPROVEN")
        self.assertEqual(reason["evidenceStatus"], "loaded")
        self.assertEqual(reason["sourcePhase"], "P0b-7/P0c-5")
        self.assert_station_mirror_source_trace(
            reason,
            station,
            completion_status="DONE",
            proof_status="PROVEN",
        )

    def test_missing_store_update_keeps_report_unproven(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            station = Path(tmp) / "station.json"
            station.write_text(
                json.dumps(
                    {
                        "source": "station-query",
                        "summary": {"eventCount": 2, "rollupCount": 0},
                        "events": [
                            {
                                "kind": "react.commit",
                                "durationMs": 10,
                                "interactionId": "i-1",
                                "module": "ready-shell",
                                "owner": "ready-shell",
                                "source": "shell",
                            }
                        ],
                        "rollups": [],
                    }
                ),
                encoding="utf-8",
            )
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "summary": {"sampled": 4},
                        "redLinePolicy": {
                            "status": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "policies": [],
                        },
                        "cells": [
                            {
                                "cellId": "browser-gateway",
                                "status": "sampled",
                                "proofStatus": "PROVEN",
                                  "sampleEmissionAllowed": True,
                                "reason": "sampled",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(station),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["storeUpdateAggregation"]["status"], "diagnostic incomplete")
        self.assertEqual(report["storeUpdateAggregation"]["reason"], "no store.update events in Station mirror")
        reason = self.blocked_reason(report, "store-update-aggregation")
        self.assertEqual(reason["status"], "diagnostic incomplete")
        self.assertEqual(reason["proofStatus"], "UNPROVEN")
        self.assertEqual(reason["reason"], "no store.update events in Station mirror")
        self.assertEqual(reason["evidenceStatus"], "loaded")
        self.assertEqual(reason["sourcePhase"], "P0b-4/P0c-5")
        self.assertIn("BOM-SMP-03", reason["sourceBom"])
        self.assertIn("SPEC-SMP-STORE-01", reason["sourceSpec"])
        self.assert_station_mirror_source_trace(reason, station)
        self.assert_blocked_reason_has_diagnostics(reason, "store-update-aggregation")

    def test_missing_invoke_telemetry_keeps_report_unproven(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            station = Path(tmp) / "station.json"
            station.write_text(
                json.dumps(
                    {
                        "source": "station-query",
                        "summary": {"eventCount": 3, "rollupCount": 0},
                        "events": [
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
                                "owner": "unknown",
                                "source": "store",
                                "data": {
                                    "changedKeys": ["selectedConversationId"],
                                    "fanout": "unknown",
                                    "listenerCount": "unknown",
                                    "store": "socialChat",
                                },
                            },
                            {
                                "kind": "longtask.detected",
                                "durationMs": 12,
                                "interactionId": "i-1",
                                "module": "main-thread",
                                "owner": "main-thread",
                                "source": "runtime",
                                "data": {"thresholdMs": 50},
                            },
                        ],
                        "rollups": [],
                    }
                ),
                encoding="utf-8",
            )
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "summary": {"sampled": 4},
                        "redLinePolicy": {
                            "status": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "policies": [],
                        },
                        "cells": [
                            {
                                "cellId": "browser-gateway",
                                "status": "sampled",
                                "proofStatus": "PROVEN",
                                  "sampleEmissionAllowed": True,
                                "reason": "sampled",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(station),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["invokeAggregation"]["status"], "diagnostic incomplete")
        self.assertEqual(report["invokeAggregation"]["reason"], "no invoke telemetry events in Station mirror")
        reason = self.blocked_reason(report, "invoke-aggregation")
        self.assertEqual(reason["status"], "diagnostic incomplete")
        self.assertEqual(reason["proofStatus"], "UNPROVEN")
        self.assertEqual(reason["reason"], "no invoke telemetry events in Station mirror")
        self.assertEqual(reason["evidenceStatus"], "loaded")
        self.assertEqual(reason["sourcePhase"], "P0b-6/P0c-5")
        self.assertIn("BOM-SMP-05", reason["sourceBom"])
        self.assertIn("SPEC-SMP-INVOKE-01", reason["sourceSpec"])
        self.assert_station_mirror_source_trace(reason, station)
        self.assert_blocked_reason_has_diagnostics(reason, "invoke-aggregation")

    def test_overlay_intent_without_visible_blocks_report(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            station = Path(tmp) / "station.json"
            station.write_text(
                json.dumps(
                    {
                        "source": "station-query",
                        "summary": {"eventCount": 5, "rollupCount": 0},
                        "events": [
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
                                "owner": "unknown",
                                "source": "store",
                                "data": {
                                    "changedKeys": ["selectedConversationId"],
                                    "fanout": "unknown",
                                    "listenerCount": "unknown",
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
                                "kind": "invoke.completed",
                                "durationMs": 18,
                                "interactionId": "i-1",
                                "module": "telemetry_frontend",
                                "owner": "telemetry_frontend_upload",
                                "phase": "interaction",
                                "source": "invoke",
                                "data": {"command": "telemetry_frontend_upload", "quiet": False},
                            },
                            {
                                "kind": "longtask.detected",
                                "durationMs": 12,
                                "interactionId": "i-1",
                                "module": "main-thread",
                                "owner": "main-thread",
                                "source": "runtime",
                                "data": {"thresholdMs": 50},
                            },
                        ],
                        "rollups": [],
                    }
                ),
                encoding="utf-8",
            )
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "completionStatus": "DONE",
                        "summary": {"sampled": 4},
                        "redLinePolicy": {
                            "status": "pass",
                            "completionStatus": "DONE",
                            "proofStatus": "PROVEN",
                            "policies": [],
                        },
                        "cells": [
                            {
                                "cellId": "browser-gateway",
                                "status": "sampled",
                                "proofStatus": "PROVEN",
                                  "sampleEmissionAllowed": True,
                                "reason": "sampled",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(station),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["overlayLatencyAggregation"]["status"], "diagnostic incomplete")
        self.assertEqual(report["overlayLatencyAggregation"]["reason"], "overlay telemetry has no overlay.visible events")
        reason = self.blocked_reason(report, "overlay-latency-aggregation")
        self.assertEqual(reason["status"], "diagnostic incomplete")
        self.assertEqual(reason["proofStatus"], "UNPROVEN")
        self.assertEqual(reason["reason"], "overlay telemetry has no overlay.visible events")
        self.assertEqual(reason["evidenceStatus"], "loaded")
        self.assertEqual(reason["sourcePhase"], "P0b-5/P0c-5")
        self.assertIn("BOM-SMP-04", reason["sourceBom"])
        self.assertIn("SPEC-SMP-OVERLAY-01", reason["sourceSpec"])
        self.assert_station_mirror_source_trace(reason, station)
        self.assert_blocked_reason_has_diagnostics(reason, "overlay-latency-aggregation")

    def test_runtime_closure_state_is_promoted_from_matrix_to_report_summary(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            matrix = Path(tmp) / "matrix.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "summary": {
                            "sampled": 0,
                            "stationTelemetryRuntimeClosureStatus": "diagnostic incomplete",
                            "stationTelemetryRuntimeClosureProofStatus": "UNPROVEN",
                        },
                        "failClosed": {"blockedCellCount": 4},
                        "stationTelemetryRuntimeClosureState": {
                            "status": "diagnostic incomplete",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "sourceArtifactKind": "desktop-telemetry-runtime-closure-gate",
                            "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                            "sourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
                            "sourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
                            "sourceGate": "Managed Station+Postgres runtime closure is required",
                              "sourceArtifact": "/tmp/runtime-closure.json",
                            "sampleEmissionAllowed": False,
                            "managedRuntimeClosure": None,
                            "localRuntimeClosureProofStatus": "UNPROVEN",
                            "composeRuntimeClosureProofStatus": "UNPROVEN",
                            "dockerDaemonProofStatus": "UNPROVEN",
                            "failedCheckCount": 3,
                            "failedChecks": ["local-dev-station-entrypoint", "local-dev-store-dsn", "docker-daemon"],
                              "checkReasons": {
                                  "local-dev-station-entrypoint": "local station entrypoint starts without managed DB",
                                  "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                  "docker-daemon": "command exited 1",
                              },
                              "failedCheckReasons": {
                                  "local-dev-station-entrypoint": "local station entrypoint starts without managed DB",
                                  "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                  "docker-daemon": "command exited 1",
                              },
                            "localFailedChecks": ["local-dev-station-entrypoint", "local-dev-store-dsn"],
                            "composeFailedChecks": ["docker-daemon"],
                              "localRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                                  "failedChecks": ["local-dev-station-entrypoint", "local-dev-store-dsn"],
                                  "failedCheckReasons": {
                                      "local-dev-station-entrypoint": "local station entrypoint starts without managed DB",
                                      "local-dev-store-dsn": "store.local.yml points Station stores at host localhost:15432",
                                  },
                                  "checks": ["local-dev-station-entrypoint", "local-dev-store-dsn"],
                              },
                              "composeRuntimeClosure": {
                                  "proofStatus": "UNPROVEN",
                                  "sampleEmissionAllowed": False,
                                  "failedChecks": ["docker-daemon"],
                                  "failedCheckReasons": {"docker-daemon": "command exited 1"},
                                  "checks": [
                                      "compose-station-postgres-contract",
                                      "compose-env",
                                      "docker-client",
                                      "compose-config",
                                      "docker-daemon",
                                  ],
                              },
                            "failedStep": "runtime.closure",
                            "blockedStep": "gateway.frontend_telemetry_upload",
                            "blockedByStep": "runtime.closure",
                            "blockedDownstreamSteps": [
                                "preflight.gateway_station",
                                "gateway.auth_login",
                                "station.auth_login",
                                "station.telemetry_routes",
                                "gateway.frontend_telemetry_upload",
                                "station.raw_query",
                                "station.rollup_query",
                                "dev_mirror",
                            ],
                              "blockedDownstreamProofs": [
                                  {
                                      "step": "station.telemetry_routes",
                                      "status": "blocked",
                                      "completionStatus": "PARTIAL",
                                      "proofStatus": "UNPROVEN",
                                      "sampleEmissionAllowed": False,
                                      "blockedByStep": "runtime.closure",
                                      "blockedByPhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                                      "blockedByGate": "Managed Station+Postgres runtime closure is required",
                                      "reason": "managed Station+Postgres runtime closure is not proven",
                                      "failedCheckReasons": {"docker-daemon": "command exited 1"},
                                      "sourceArtifact": "/tmp/runtime-closure.json",
                                      "sourceArtifactKind": "desktop-telemetry-runtime-closure-gate",
                                      "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                                      "sourceBom": ["BOM-RUN-03", "BOM-RUN-04"],
                                      "sourceSpec": ["SPEC-GW-01", "SPEC-STA-01"],
                                      "sourceGate": "Managed Station+Postgres runtime closure is required",
                                  }
                              ],
                        },
                        "redLinePolicy": {
                            "status": "diagnostic incomplete",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "policies": [],
                        },
                        "cells": [],
                    }
                ),
                encoding="utf-8",
            )

            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(Path(tmp) / "missing-station.json"),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        self.assertEqual(report["matrix"]["stationTelemetryRuntimeClosureState"]["status"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["stationTelemetryRuntimeClosureStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["stationTelemetryRuntimeClosureProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRuntimeClosureLocalProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRuntimeClosureComposeProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRuntimeClosureDockerDaemonProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["stationTelemetryRuntimeClosureFailedStep"], "runtime.closure")
        self.assertEqual(report["summary"]["stationTelemetryRuntimeClosureBlockedStep"], "gateway.frontend_telemetry_upload")
        self.assertIn("dev_mirror", report["summary"]["stationTelemetryRuntimeClosureBlockedDownstreamSteps"])
        self.assertEqual(
            report["summary"]["stationTelemetryRuntimeClosureBlockedDownstreamProofs"][0]["step"],
            "station.telemetry_routes",
        )
        self.assertEqual(report["summary"]["stationTelemetryRuntimeClosureBlockedDownstreamProofCount"], 1)
        runtime_reasons = [item for item in report["blockedReasons"] if item["scope"] == "station-runtime-closure"]
        self.assertEqual(runtime_reasons[0]["blockedDownstreamProofs"][0]["blockedByStep"], "runtime.closure")
        self.assertIn("docker-daemon", report["summary"]["stationTelemetryRuntimeClosureComposeFailedChecks"])
        self.assertIn("docker-daemon", report["summary"]["stationTelemetryRuntimeClosureFailedCheckReasons"])
        self.assertIn("local-dev-store-dsn", report["summary"]["stationTelemetryRuntimeClosureCheckReasons"])
        self.assertEqual(
            report["summary"]["stationTelemetryRuntimeClosureLocalRuntimeClosure"]["failedChecks"],
            ["local-dev-station-entrypoint", "local-dev-store-dsn"],
        )
        self.assertEqual(
            report["summary"]["stationTelemetryRuntimeClosureComposeRuntimeClosure"]["failedChecks"],
            ["docker-daemon"],
        )
        self.assertIn("stationTelemetryRuntimeClosure", report["summary"]["unprovenScopes"])
        markdown = module.render_markdown(report)
        self.assertIn("Station runtime closure", markdown)
        self.assertIn("Station runtime closure Docker daemon proof", markdown)
        self.assertIn("Station runtime closure blocked step: `gateway.frontend_telemetry_upload`", markdown)
        self.assertIn("Station runtime closure blocked downstream proof count: `1`", markdown)
        self.assertIn("blockedDownstreamProofs", markdown)

    def test_runtime_closure_is_primary_blocker_when_route_probe_is_downstream_untrusted(self) -> None:
        module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            matrix = Path(tmp) / "matrix.json"
            runtime_closure_artifact = Path(tmp) / "runtime-closure.json"
            route_probe_artifact = Path(tmp) / "route-probe.json"
            matrix.write_text(
                json.dumps(
                    {
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "summary": {"sampled": 0},
                        "stationTelemetryRuntimeClosureState": {
                            "path": str(runtime_closure_artifact),
                            "sourceArtifact": str(runtime_closure_artifact),
                            "status": "diagnostic incomplete",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "sourceArtifactKind": "desktop-telemetry-runtime-closure-gate",
                            "sourcePhase": "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5",
                            "sourceBom": ["BOM-RUN-03", "BOM-RUN-04", "BOM-CON-03", "BOM-CON-04"],
                            "sourceSpec": ["SPEC-GW-01", "SPEC-STA-01", "SPEC-STA-02"],
                            "sourceGate": "Managed Station+Postgres runtime closure is required",
                            "sampleEmissionAllowed": False,
                            "reason": "managed Station+Postgres runtime closure is not proven",
                            "failedStep": "runtime.closure",
                            "blockedDownstreamSteps": ["station.telemetry_routes", "station.raw_query"],
                            "failedCheckReasons": {"docker-daemon": "command exited 1"},
                            "localRuntimeClosure": {"proofStatus": "UNPROVEN", "sampleEmissionAllowed": False},
                            "composeRuntimeClosure": {
                                "proofStatus": "UNPROVEN",
                                "sampleEmissionAllowed": False,
                                "failedCheckReasons": {"docker-daemon": "command exited 1"},
                            },
                        },
                        "stationTelemetryRouteProbeState": {
                            "path": str(route_probe_artifact),
                            "sourceArtifact": str(route_probe_artifact),
                            "status": "diagnostic incomplete",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "sourceArtifactKind": "desktop-telemetry-route-probe",
                            "sourcePhase": "P0a-4/P0a-5/P0a-6/P0c-5",
                            "sourceBom": ["BOM-CON-03", "BOM-CON-04", "BOM-CAP-05", "BOM-RUN-05"],
                            "sourceSpec": ["SPEC-STA-01", "SPEC-STA-02", "SPEC-DB-01", "SPEC-MIRROR-01"],
                            "sourceGate": "Station frontend telemetry route capability must pass",
                            "sampleEmissionAllowed": False,
                            "reason": "Station route missing",
                            "runtimeClosureProofStatus": "UNPROVEN",
                            "runtimeClosureSampleEmissionAllowed": False,
                            "runtimeClosureFailedCheckReasons": {"docker-daemon": "command exited 1"},
                            "issue_breakdown": [
                                {
                                    "category": "station-telemetry-route-missing",
                                    "failedStep": "station.telemetry_routes",
                                    "summary": "Station route missing",
                                    "proofImpact": "P0a/P0c remains PARTIAL/UNPROVEN.",
                                }
                            ],
                        },
                        "redLinePolicy": {
                            "status": "diagnostic incomplete",
                            "completionStatus": "PARTIAL",
                            "proofStatus": "UNPROVEN",
                            "policies": [],
                        },
                        "cells": [],
                    }
                ),
                encoding="utf-8",
            )

            report = module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(Path(tmp) / "missing-station.json"),
                    matrix_report=str(matrix),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                )
            )

        self.assertEqual(report["failedStep"], "runtime.closure")
        self.assertEqual(report["summary"]["failedStep"], "runtime.closure")
        self.assertEqual(report["summary"]["primaryIssueCategory"], "station-runtime-closure")
        self.assertEqual(
            report["summary"]["primaryIssueSourceArtifactKind"],
            "desktop-telemetry-runtime-closure-gate",
        )
        self.assertIn("docker-daemon", report["issue_breakdown"][0]["evidenceDetails"][0]["failedCheckReasons"])
        route_reasons = [
            reason for reason in report["blockedReasons"] if reason["scope"] == "station-telemetry-route-probe"
        ]
        self.assertEqual(len(route_reasons), 1)
        self.assertEqual(route_reasons[0]["runtimeClosureFailedCheckReasons"], {"docker-daemon": "command exited 1"})


if __name__ == "__main__":
    unittest.main()
