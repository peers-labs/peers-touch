#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from typing import Any


def load_module() -> Any:
    script = Path(__file__).with_name("desktop-telemetry-local-loop-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_telemetry_local_loop_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopTelemetryLocalLoopGateTest(unittest.TestCase):
    def check_results(self, module: Any, returncodes: list[int]) -> list[dict[str, Any]]:
        self.assertEqual(len(module.CHECKS), len(returncodes))
        return [
            module.check_result_from_exit(spec, returncode, "ok" if returncode == 0 else "failed")
            for spec, returncode in zip(module.CHECKS, returncodes)
        ]

    def native_source(self, module: Any, status: str = "pass") -> dict[str, Any]:
        proven = status == "pass"
        return {
            "sourceKind": "desktop-native-frontend-telemetry-upload-source",
            "status": status,
            "completionStatus": "DONE" if proven else "PARTIAL",
            "proofStatus": "PROVEN" if proven else "UNPROVEN",
            "phase": "P0a-3",
            "bom": ["BOM-RUN-03"],
            "spec": ["SPEC-GW-01"],
            "gate": "Native Desktop upload command source must prove Tauri invoke registration, Station ingest path, and Desktop API wrapper",
            "requirements": [
                {
                    "id": "tauri-invoke-handler",
                    "path": str(module.TAURI_MAIN_PATH),
                    "status": status,
                    "proofStatus": "PROVEN" if proven else "UNPROVEN",
                    "missingTokens": [] if proven else ["frontend_telemetry::frontend_telemetry_upload"],
                    "readError": None,
                }
            ],
            "failedRequirementCount": 0 if proven else 1,
            "failedRequirements": [] if proven else ["tauri-invoke-handler"],
        }

    def test_report_is_proven_when_all_local_checks_pass(self) -> None:
        module = load_module()
        report = module.build_report(Path("out.json"), self.check_results(module, [0, 0, 0]), self.native_source(module))

        self.assertEqual(report["artifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["phase"], module.PHASE)
        self.assertEqual(report["bom"], module.BOM)
        self.assertEqual(report["spec"], module.SPEC)
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["checkCount"], 3)
        self.assertEqual(report["summary"]["passedCheckCount"], 3)
        self.assertEqual(report["summary"]["failedCheckCount"], 0)
        self.assertEqual(report["summary"]["stationIngestQueryRollupStatus"], "pass")
        self.assertEqual(report["summary"]["desktopEnvelopeBoundedQueueStatus"], "pass")
        self.assertEqual(report["summary"]["tauriCommandUploadValidationStatus"], "pass")
        station_check = next(check for check in report["checks"] if check["id"] == "station-ingest-query-rollup")
        self.assertEqual(station_check["phase"], "P0a-4/P0a-5/P0a-6")
        self.assertIn("SPEC-STA-03", station_check["spec"])
        self.assertIn("SPEC-MIRROR-01", station_check["spec"])
        self.assertIn("Station query contract coverage", report["gate"])
        upload_check = next(check for check in report["checks"] if check["id"] == "tauri-command-upload-validation")
        self.assertEqual(upload_check["phase"], "P0a-3")
        self.assertEqual(upload_check["bom"], ["BOM-RUN-03"])
        self.assertEqual(upload_check["spec"], ["SPEC-GW-01"])
        self.assertEqual(report["summary"]["nativeUploadSourceStatus"], "pass")
        self.assertEqual(report["summary"]["nativeUploadSourceProofStatus"], "PROVEN")
        self.assertEqual(report["summary"]["nativeUploadSourceFailedRequirementCount"], 0)
        self.assertEqual(report["nativeUploadSourceEvidence"]["proofStatus"], "PROVEN")
        self.assertEqual(report["issueBreakdown"], [])
        markdown = module.render_markdown(report)
        self.assertIn("Desktop Telemetry Local Loop Gate", markdown)
        self.assertIn("station-ingest-query-rollup", markdown)
        self.assertIn("Native Upload Source", markdown)
        self.assertIn("tauri-invoke-handler", markdown)

    def test_report_is_unproven_when_any_local_check_fails(self) -> None:
        module = load_module()
        report = module.build_report(Path("out.json"), self.check_results(module, [0, 1, 0]), self.native_source(module))

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["passedCheckCount"], 2)
        self.assertEqual(report["summary"]["failedCheckCount"], 1)
        issue = report["issueBreakdown"][0]
        self.assertEqual(issue["category"], "desktop-telemetry-local-loop-static-check")
        self.assertEqual(issue["failedStep"], "desktop-envelope-bounded-queue")
        self.assertEqual(issue["sourceArtifactKind"], module.ARTIFACT_KIND)
        self.assertEqual(issue["sourcePhase"], "P0a-1/P0a-2")
        self.assertEqual(issue["sourceBom"], ["BOM-RUN-03", "BOM-RUN-04"])
        self.assertEqual(issue["sourceSpec"], ["SPEC-GW-01"])
        self.assertIn("bounded queue", issue["sourceGate"])
        self.assertIn("PARTIAL/UNPROVEN", issue["proofImpact"])

    def test_station_loop_failure_preserves_p0a6_traceability(self) -> None:
        module = load_module()
        report = module.build_report(Path("out.json"), self.check_results(module, [1, 0, 0]), self.native_source(module))

        issue = report["issueBreakdown"][0]
        self.assertEqual(issue["category"], "desktop-telemetry-local-loop-static-check")
        self.assertEqual(issue["failedStep"], "station-ingest-query-rollup")
        self.assertEqual(issue["sourcePhase"], "P0a-4/P0a-5/P0a-6")
        self.assertEqual(issue["sourceBom"], ["BOM-CON-03", "BOM-CON-04", "BOM-CAP-05"])
        self.assertIn("SPEC-STA-03", issue["sourceSpec"])
        self.assertIn("SPEC-MIRROR-01", issue["sourceSpec"])
        self.assertIn("query contract", issue["sourceGate"])

    def test_report_is_unproven_when_native_upload_source_is_incomplete(self) -> None:
        module = load_module()
        report = module.build_report(
            Path("out.json"),
            self.check_results(module, [0, 0, 0]),
            self.native_source(module, "diagnostic incomplete"),
        )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["nativeUploadSourceStatus"], "diagnostic incomplete")
        self.assertEqual(report["summary"]["nativeUploadSourceProofStatus"], "UNPROVEN")
        self.assertEqual(report["summary"]["nativeUploadSourceFailedRequirementCount"], 1)
        self.assertEqual(report["summary"]["nativeUploadSourceFailedRequirements"], ["tauri-invoke-handler"])
        issue = report["issueBreakdown"][0]
        self.assertEqual(issue["category"], "desktop-native-upload-source")
        self.assertEqual(issue["failedStep"], "native.frontend_telemetry_upload.source")
        self.assertEqual(issue["sourceArtifactKind"], module.ARTIFACT_KIND)
        self.assertIn("P0a-3", issue["proofImpact"])

    def test_native_upload_source_evidence_scans_required_registration_points(self) -> None:
        module = load_module()
        with self.subTest("current workspace source"):
            evidence = module.native_upload_source_evidence(Path(".").resolve())
        self.assertEqual(evidence["status"], "pass")
        self.assertEqual(evidence["proofStatus"], "PROVEN")
        self.assertEqual(evidence["failedRequirementCount"], 0)
        self.assertEqual(
            {item["id"] for item in evidence["requirements"]},
            {
                "tauri-invoke-handler",
                "station-ingest-path",
                "desktop-api-wrapper",
            },
        )


if __name__ == "__main__":
    unittest.main()
