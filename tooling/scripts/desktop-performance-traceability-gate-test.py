#!/usr/bin/env python3
"""Tests for Desktop performance traceability gate."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock


def load_module() -> Any:
    script = Path(__file__).with_name("desktop-performance-traceability-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_traceability_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DesktopPerformanceTraceabilityGateTest(unittest.TestCase):
    def test_default_inputs_persist_typed_refs_without_artifact_root_paths(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "artifact-root"
            output = Path(tmp) / "traceability.json"

            def fake_latest_path(gate_id: str, role: str) -> Path:
                return root / gate_id / role.replace("/", "-")

            def fake_latest_ref(gate_id: str, role: str) -> dict:
                return {"workspaceId": "workspace", "gateId": gate_id, "runId": "run", "path": role}

            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-performance-traceability-gate.py",
                    "--output",
                    str(output),
                ]
                with mock.patch.object(module, "latest_path", side_effect=fake_latest_path), mock.patch.object(
                    module,
                    "latest_ref",
                    side_effect=fake_latest_ref,
                ):
                    module.main()
            finally:
                sys.argv = old_argv

            persisted = output.read_text(encoding="utf-8")

        self.assertNotIn(str(root), persisted)
        self.assertIn('"inputArtifactRefs"', persisted)
        self.assertIn('"workspaceId": "workspace"', persisted)

    def write_artifact(self, path: Path, *, missing_source_gate: bool = False) -> None:
        issue = {
            "category": "station-telemetry-route-missing",
            "failedStep": "station.telemetry_routes",
            "summary": "Station route missing",
            "proofImpact": "P0a remains PARTIAL/UNPROVEN.",
            "sourceArtifact": "tooling/acceptance/reports/desktop-telemetry-route-probe.json",
            "sourceArtifactKind": "desktop-telemetry-route-probe",
            "sourcePhase": "P0a-4/P0a-5/P0a-6/P0c-5",
            "sourceBom": ["BOM-CON-03", "BOM-CAP-05"],
            "sourceSpec": ["SPEC-STA-01", "SPEC-MIRROR-01"],
            "sourceGate": "Station telemetry route probe must pass",
        }
        if missing_source_gate:
            issue.pop("sourceGate")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "artifactKind": "acceptance-run",
                    "status": "diagnostic incomplete",
                    "issueBreakdown": [issue],
                    "resultTraceabilityState": {
                        "artifactKind": "acceptance-run-result-traceability-state",
                        "status": "pass",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "missingTraceabilityCount": 0,
                        "missingTraceability": [],
                    },
                }
            ),
            encoding="utf-8",
        )

    def test_passes_when_all_aggregate_issues_have_source_binding(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            inputs = [Path(tmp) / "latest-run.json", Path(tmp) / "report.json", Path(tmp) / "matrix.json"]
            for path in inputs:
                self.write_artifact(path)
            report = module.build_report([str(path) for path in inputs])

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["artifactCount"], 3)
        self.assertEqual(report["summary"]["issueCount"], 3)
        self.assertEqual(report["summary"]["nestedTraceabilityCount"], 0)
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 0)
        self.assertEqual(report["summary"]["missingResultTraceabilityCount"], 0)
        self.assertNotIn("issueBreakdown", report)

    def test_fails_closed_when_issue_source_binding_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            good = Path(tmp) / "latest-run.json"
            bad = Path(tmp) / "report.json"
            self.write_artifact(good)
            self.write_artifact(bad, missing_source_gate=True)
            report = module.build_report([str(good), str(bad)])

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 1)
        self.assertEqual(report["summary"]["missingResultTraceabilityCount"], 0)
        self.assertEqual(report["details"][0]["missingFields"], ["sourceGate"])
        self.assertEqual(report["issueBreakdown"][0]["sourceArtifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(report["issueBreakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["issueBreakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issueBreakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issueBreakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["issueBreakdown"][0]["sourceBom"], module.BOM)
        self.assertEqual(report["issueBreakdown"][0]["sourceSpec"], module.SPEC)
        self.assertEqual(report["issueBreakdown"][0]["sourceGate"], module.GATE)

    def test_fails_closed_when_nested_route_evidence_source_traceability_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["summary"] = {
                "browserGatewayLiveTargetRuntimeRouteEvidenceSourceArtifact": "/tmp/route-probe.json",
                "browserGatewayLiveTargetRuntimeRouteEvidenceSourceKind": "desktop-telemetry-route-probe",
                "browserGatewayLiveTargetRuntimeRouteEvidenceSourceReason": "station-telemetry-route-probe-fallback",
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["nestedTraceabilityCount"], 1)
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 1)
        self.assertEqual(
            report["details"][0]["missingFields"],
            [
                "browserGatewayLiveTargetRuntimeRouteEvidenceSourcePhase",
                "browserGatewayLiveTargetRuntimeRouteEvidenceSourceBom",
                "browserGatewayLiveTargetRuntimeRouteEvidenceSourceSpec",
                "browserGatewayLiveTargetRuntimeRouteEvidenceSourceGate",
            ],
        )
        self.assertEqual(report["details"][0]["category"], "nested-route-evidence-source")
        self.assertEqual(report["issueBreakdown"][0]["sourceArtifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(report["issueBreakdown"][0]["sourceGate"], module.GATE)

    def test_passes_when_nested_route_evidence_source_has_source_binding(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["summary"] = {
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
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["nestedTraceabilityCount"], 0)
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 0)

    def test_fails_closed_when_route_trust_true_has_unproven_prerequisite(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["summary"] = {
                "stationTelemetryRouteProofTrusted": True,
                "stationTelemetryRouteTrustBlockedProofs": [],
                "stationTelemetryRouteRuntimeClosureProofStatus": "UNPROVEN",
                "stationTelemetryRouteLocalSourceDeploymentProofStatus": "PROVEN",
                "stationTelemetryRouteLocalSourceHeadRouteContractProofStatus": "PROVEN",
                "stationTelemetryRouteTargetRuntimeIdentityProofStatus": "PROVEN",
                "stationTelemetryRouteTargetRuntimeRouteContractProofStatus": "PROVEN",
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["routeTrustConsistencyCount"], 1)
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 1)
        self.assertEqual(report["details"][0]["category"], "route-trust-consistency")
        self.assertEqual(report["details"][0]["failedStep"], "$.summary.routeProofTrusted")
        self.assertEqual(
            report["details"][0]["reason"],
            "routeProofTrusted is true while one or more route trust prerequisites are not PROVEN",
        )

    def test_passes_when_route_trust_false_has_source_bound_blocker_proofs(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["summary"] = {
                "stationTelemetryRouteProofTrusted": False,
                "stationTelemetryRouteRuntimeClosureProofStatus": "UNPROVEN",
                "stationTelemetryRouteLocalSourceDeploymentProofStatus": "PROVEN",
                "stationTelemetryRouteLocalSourceHeadRouteContractProofStatus": "PROVEN",
                "stationTelemetryRouteTargetRuntimeIdentityProofStatus": "PROVEN",
                "stationTelemetryRouteTargetRuntimeRouteContractProofStatus": "PROVEN",
                "stationTelemetryRouteTrustBlockedProofs": [
                    {
                        "step": "runtime.closure",
                        "status": "blocked",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "sampleEmissionAllowed": False,
                        "blockedByStep": "runtime.closure",
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
                        "sourceGate": "Station frontend telemetry route proof trust prerequisites must be PROVEN",
                    }
                ],
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["routeTrustConsistencyCount"], 0)
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 0)

    def test_fails_closed_when_route_trust_false_is_missing_specific_prerequisite_blocker(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["summary"] = {
                "stationTelemetryRouteProofTrusted": False,
                "stationTelemetryRouteRuntimeClosureProofStatus": "UNPROVEN",
                "stationTelemetryRouteLocalSourceDeploymentProofStatus": "UNPROVEN",
                "stationTelemetryRouteLocalSourceHeadRouteContractProofStatus": "PROVEN",
                "stationTelemetryRouteTargetRuntimeIdentityProofStatus": "PROVEN",
                "stationTelemetryRouteTargetRuntimeRouteContractProofStatus": "PROVEN",
                "stationTelemetryRouteTrustBlockedProofs": [
                    {
                        "step": "runtime.closure",
                        "status": "blocked",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "sampleEmissionAllowed": False,
                        "blockedByStep": "runtime.closure",
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
                        "sourceGate": "Station frontend telemetry route proof trust prerequisites must be PROVEN",
                    }
                ],
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["routeTrustConsistencyCount"], 1)
        self.assertEqual(report["details"][0]["category"], "route-trust-consistency")
        self.assertEqual(report["details"][0]["missingBlockerSteps"], ["local-source.deployable-head"])
        self.assertEqual(
            report["details"][0]["reason"],
            "routeProofTrusted is false due to unproven prerequisites, but one or more prerequisite blocker proofs are missing",
        )

    def test_fails_closed_when_sample_blocker_traceability_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["summary"] = {
                "redLinePolicySummaries": [
                    {
                        "policyId": "primary-nav-click",
                        "sampleBlockers": [
                            {
                                "scope": "station-runtime-closure",
                                "status": "diagnostic incomplete",
                                "proofStatus": "UNPROVEN",
                                "sampleEmissionAllowed": False,
                            }
                        ],
                    }
                ]
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["nestedTraceabilityCount"], 1)
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 1)
        self.assertEqual(report["details"][0]["category"], "nested-sample-blocker")
        self.assertEqual(report["details"][0]["scope"], "station-runtime-closure")
        self.assertEqual(
            report["details"][0]["missingFields"],
            [
                "sourceArtifact",
                "sourceArtifactKind",
                "sourcePhase",
                "sourceBom",
                "sourceSpec",
                "sourceGate",
            ],
        )

    def test_passes_when_sample_blocker_has_source_binding(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["summary"] = {
                "redLinePolicySummaries": [
                    {
                        "policyId": "primary-nav-click",
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
                                "sourceGate": "Station-managed telemetry runtime closure must be proven",
                            }
                        ],
                    }
                ]
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["nestedTraceabilityCount"], 0)
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 0)

    def test_fails_closed_when_red_line_raw_source_traceability_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["summary"] = {
                "redLinePolicySummaries": [
                    {
                        "policyId": "primary-nav-click",
                        "rawEvidencePath": "/tmp/raw-events.json",
                        "rawEvidenceStatus": "source-unproven",
                        "rawSourceArtifactKind": "desktop-performance-station-mirror",
                    }
                ]
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["nestedTraceabilityCount"], 1)
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 1)
        self.assertEqual(report["details"][0]["category"], "nested-red-line-raw-source")
        self.assertEqual(report["details"][0]["policyId"], "primary-nav-click")
        self.assertEqual(
            report["details"][0]["missingFields"],
            [
                "rawSourcePhase",
                "rawSourceBom",
                "rawSourceSpec",
                "rawSourceGate",
            ],
        )

    def test_passes_when_red_line_raw_source_has_source_binding(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["summary"] = {
                "redLinePolicySummaries": [
                    {
                        "policyId": "primary-nav-click",
                        "rawEvidencePath": "/tmp/raw-events.json",
                        "rawEvidenceStatus": "source-unproven",
                        "rawSourceArtifactKind": "desktop-performance-station-mirror",
                        "rawSourcePhase": "P0a-6/P0c-5",
                        "rawSourceBom": ["BOM-CAP-05", "BOM-RUN-05"],
                        "rawSourceSpec": ["SPEC-STA-03", "SPEC-MIRROR-01"],
                        "rawSourceGate": "Dev/CI mirror artifact must preserve Station query evidence",
                    }
                ]
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["nestedTraceabilityCount"], 0)
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 0)

    def test_fails_closed_when_generic_nested_source_summary_is_missing_artifact(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["anchorInventory"] = {
                "domAutomation": {
                    "path": "/tmp/dom-evidence.json",
                    "sourceArtifactKind": "desktop-anchor-dom-evidence",
                    "sourcePhase": "P0b-1",
                    "sourceBom": ["BOM-SMP-01"],
                    "sourceSpec": ["SPEC-ANCHOR-01"],
                    "sourceGate": "Browser and Tauri/WebView DOM automation must prove anchors",
                }
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["nestedTraceabilityCount"], 1)
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 1)
        self.assertEqual(report["details"][0]["category"], "nested-source-summary")
        self.assertEqual(report["details"][0]["failedStep"], "$.anchorInventory.domAutomation")
        self.assertEqual(report["details"][0]["missingFields"], ["sourceArtifact"])

    def test_passes_when_generic_nested_source_summary_has_artifact(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["anchorInventory"] = {
                "domAutomation": {
                    "path": "/tmp/dom-evidence.json",
                    "sourceArtifact": "/tmp/dom-evidence.json",
                    "sourceArtifactKind": "desktop-anchor-dom-evidence",
                    "sourcePhase": "P0b-1",
                    "sourceBom": ["BOM-SMP-01"],
                    "sourceSpec": ["SPEC-ANCHOR-01"],
                    "sourceGate": "Browser and Tauri/WebView DOM automation must prove anchors",
                }
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["nestedTraceabilityCount"], 0)
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 0)

    def test_fails_closed_when_acceptance_run_result_traceability_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "latest-run.json"
            self.write_artifact(artifact)
            data = json.loads(artifact.read_text(encoding="utf-8"))
            data["resultTraceabilityState"] = {
                "artifactKind": "acceptance-run-result-traceability-state",
                "status": "diagnostic incomplete",
                "completionStatus": "PARTIAL",
                "proofStatus": "UNPROVEN",
                "missingTraceabilityCount": 1,
                "missingTraceability": [
                    {
                        "id": "acceptance-run-static-gate",
                        "missingFields": [
                            "sourceArtifact",
                            "sourceArtifactKind",
                            "sourcePhase",
                            "sourceBom",
                            "sourceSpec",
                            "sourceGate",
                        ],
                    }
                ],
            }
            artifact.write_text(json.dumps(data), encoding="utf-8")
            report = module.build_report([str(artifact)])

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["missingTraceabilityCount"], 0)
        self.assertEqual(report["summary"]["missingResultTraceabilityCount"], 1)
        self.assertEqual(report["details"][0]["failedStep"], "acceptance-run-result-traceability-state")
        self.assertEqual(report["details"][0]["id"], "acceptance-run-static-gate")
        self.assertEqual(report["issueBreakdown"][0]["sourceArtifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(report["issueBreakdown"][0]["sourceGate"], module.GATE)

    def test_fails_closed_when_input_artifact_is_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            report = module.build_report([str(Path(tmp) / "missing.json")])

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["artifactCount"], 1)
        self.assertEqual(report["artifactStates"][0]["proofStatus"], "UNPROVEN")
        self.assertEqual(
            report["reason"],
            "Phase 0 aggregate issue, nested evidence source, or result source traceability is incomplete",
        )


if __name__ == "__main__":
    unittest.main()
