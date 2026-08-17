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


def load_gate_module():
    script = Path(__file__).with_name("desktop-performance-matrix-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_matrix_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopPerformanceMatrixGateTest(unittest.TestCase):
    def test_default_inputs_persist_typed_refs_without_artifact_root_paths(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "artifact-root"
            output_prefix = Path(tmp) / "matrix"

            def fake_latest_path(gate_id: str, role: str) -> Path:
                if role.startswith("cell-"):
                    return root / gate_id / "reports" / "desktop-performance-cells" / f"{role.removeprefix('cell-')}.json"
                return root / gate_id / role.replace("/", "-")

            def fake_latest_ref(gate_id: str, role: str) -> dict:
                return {"workspaceId": "workspace", "gateId": gate_id, "runId": "run", "path": role}

            def fake_build_matrix(args: argparse.Namespace) -> dict:
                return {
                    "status": "diagnostic incomplete",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "resolvedInputs": [
                        args.live_gate_report,
                        args.preflight_report,
                        args.cohort_report,
                        args.events_report,
                        str(Path(args.cell_evidence_dir) / "tauri-webview-dev.json"),
                        str(Path(args.cell_evidence_dir) / "tauri-webview-packaged.json"),
                    ],
                }

            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-performance-matrix-gate.py",
                    "--output-prefix",
                    str(output_prefix),
                ]
                with mock.patch.object(module, "latest_path", side_effect=fake_latest_path), mock.patch.object(
                    module,
                    "latest_ref",
                    side_effect=fake_latest_ref,
                ), mock.patch.object(
                    module,
                    "build_matrix",
                    side_effect=fake_build_matrix,
                ), mock.patch.object(
                    module,
                    "render_markdown",
                    return_value="matrix\n",
                ):
                    module.main()
            finally:
                sys.argv = old_argv

            persisted = output_prefix.with_suffix(".json").read_text(encoding="utf-8")

        self.assertNotIn(str(root), persisted)
        self.assertIn('"inputArtifactRefs"', persisted)
        self.assertIn('"workspaceId": "workspace"', persisted)

    LIVE_GATE_PHASE = "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5"
    LIVE_GATE_BOM = [
        "BOM-RUN-03",
        "BOM-RUN-04",
        "BOM-CON-03",
        "BOM-CON-04",
        "BOM-CAP-05",
        "BOM-RUN-05",
    ]
    LIVE_GATE_SPEC = [
        "SPEC-GW-01",
        "SPEC-STA-01",
        "SPEC-STA-02",
        "SPEC-DB-01",
        "SPEC-DB-02",
        "SPEC-STA-03",
        "SPEC-MIRROR-01",
    ]
    LIVE_GATE_TEXT = "Desktop Gateway upload, Station ingest, raw/rollup query, and Dev mirror must all pass"
    RAW_EVENTS_PHASE = "P0a-6/P0c-5"
    RAW_EVENTS_BOM = ["BOM-CAP-05", "BOM-RUN-05"]
    RAW_EVENTS_SPEC = ["SPEC-STA-03", "SPEC-MIRROR-01"]
    RAW_EVENTS_GATE = "Dev/CI mirror artifact must preserve Station query evidence without becoming the product telemetry sink"
    RAW_EVENTS_ARTIFACT_KIND = "desktop-performance-station-mirror"
    PREFLIGHT_PHASE = "P0c-1/P0c-2"
    PREFLIGHT_BOM = ["BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01"]
    PREFLIGHT_SPEC = ["SPEC-RUN-01", "SPEC-GATE-01"]
    PREFLIGHT_GATE = "Make entrypoints, Desktop Gateway, Station health, and Gateway Station binding must pass before runtime samples are emitted"

    def live_gate_metadata(self, status: str, *, sample_emission_allowed: bool) -> dict[str, object]:
        return {
            "artifactKind": "desktop-telemetry-live-gate",
            "status": status,
            "completionStatus": "DONE" if status == "pass" else "PARTIAL",
            "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
            "sampleEmissionAllowed": sample_emission_allowed,
            "phase": self.LIVE_GATE_PHASE,
            "bom": self.LIVE_GATE_BOM,
            "spec": self.LIVE_GATE_SPEC,
            "gate": self.LIVE_GATE_TEXT,
        }

    def write_sampled_live_gate(self, tmp: str) -> Path:
        live_gate = Path(tmp) / "live-gate.json"
        live_gate.write_text(
            json.dumps(
                {
                    **self.live_gate_metadata("pass", sample_emission_allowed=True),
                    "interactionId": "sample-1",
                }
            ),
            encoding="utf-8",
        )
        return live_gate

    def write_preflight(self, tmp: str, status: str, *, sample_emission_allowed: bool) -> Path:
        preflight = Path(tmp) / "desktop-performance-preflight.json"
        preflight.write_text(
            json.dumps(
                {
                    "artifactKind": "desktop-performance-preflight",
                    "status": status,
                    "completionStatus": "DONE" if status == "pass" else "PARTIAL",
                    "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
                    "sampleEmissionAllowed": sample_emission_allowed,
                    "phase": self.PREFLIGHT_PHASE,
                    "bom": self.PREFLIGHT_BOM,
                    "spec": self.PREFLIGHT_SPEC,
                    "gate": self.PREFLIGHT_GATE,
                    "failedStep": "desktop-gateway" if status != "pass" else None,
                    "reason": "connection refused" if status != "pass" else "preflight passed",
                    "issue_breakdown": []
                    if status == "pass"
                    else [
                        {
                            "category": "desktop-gateway-preflight",
                            "failedStep": "desktop-gateway",
                            "summary": "connection refused",
                            "proofImpact": "P0c-1/P0c-2 remains PARTIAL/UNPROVEN.",
                        }
                    ],
                    "recommended_review_commands": [
                        {"purpose": "Start Desktop dev runtime.", "command": "make desktop"},
                    ],
                }
            ),
            encoding="utf-8",
        )
        return preflight

    def write_events(self, tmp: str, events: list[dict[str, object]]) -> Path:
        events_report = Path(tmp) / "events.json"
        events_report.write_text(
            json.dumps(
                {
                    "artifactKind": self.RAW_EVENTS_ARTIFACT_KIND,
                    "phase": self.RAW_EVENTS_PHASE,
                    "bom": self.RAW_EVENTS_BOM,
                    "spec": self.RAW_EVENTS_SPEC,
                    "gate": self.RAW_EVENTS_GATE,
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                    "productSink": "Station",
                    "mirrorRole": "Dev/CI evidence artifact",
                    "events": events,
                }
            ),
            encoding="utf-8",
        )
        self.write_proven_cohort(tmp)
        return events_report

    def write_proven_cohort(self, tmp: str) -> Path:
        cohort_report = Path(tmp) / "desktop-performance-cohort-gate.json"
        cohort_report.write_text(
            json.dumps(
                {
                    "artifactKind": "desktop-performance-cohort-gate",
                    "status": "pass",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                    "sampleEmissionAllowed": True,
                    "phase": "P0c-3",
                    "planTask": "P0c3-R2",
                    "gate": "All runtime cells share one proven cohort",
                }
            ),
            encoding="utf-8",
        )
        return cohort_report

    def write_cell_evidence(
        self,
        tmp: str,
        cell_id: str,
        report: dict[str, object],
    ) -> Path:
        evidence_dir = Path(tmp) / "cells"
        evidence_dir.mkdir()
        (evidence_dir / f"{cell_id}.json").write_text(json.dumps(report), encoding="utf-8")
        return evidence_dir

    def baseline_events(self) -> list[dict[str, object]]:
        return [
            {"kind": "interaction.started", "durationMs": 0, "interactionId": "sample-1"},
            {"kind": "route.requested", "durationMs": 0, "interactionId": "sample-1"},
            {"kind": "route.visible", "durationMs": 40, "interactionId": "sample-1"},
            {"kind": "surface.render", "durationMs": 25, "interactionId": "sample-1"},
            {"kind": "react.commit", "durationMs": 16, "interactionId": "sample-1"},
            {"kind": "contextmenu.intent", "durationMs": 0, "interactionId": "sample-1"},
            {"kind": "overlay.visible", "durationMs": 18, "interactionId": "sample-1"},
            {"kind": "invoke.started", "durationMs": 0, "interactionId": "sample-1"},
            {"kind": "invoke.completed", "durationMs": 20, "interactionId": "sample-1"},
            {"kind": "longtask.detected", "durationMs": 45, "interactionId": "sample-1"},
            {"kind": "layout.shift", "durationMs": 0.05, "interactionId": "sample-1"},
            {"kind": "paint.timing", "durationMs": 300, "interactionId": "sample-1"},
        ]

    def test_preflight_failure_blocks_sample_emission(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = Path(tmp) / "live-gate.json"
            live_gate.write_text(
                json.dumps(
                    {
                        **self.live_gate_metadata(
                            "baseline preflight failure",
                            sample_emission_allowed=False,
                        ),
                        "error": "gateway refused",
                        "failedStep": "preflight.gateway_station",
                        "reason": "preflight.gateway_station failed: gateway refused",
                        "details": [
                            {
                                "step": "preflight.gateway_station",
                                "status": "fail",
                                "error": "gateway refused",
                            }
                        ],
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
                        "steps": [
                            {
                                "name": "preflight.gateway_station",
                                "status": "fail",
                                "detail": {"error": "gateway refused"},
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(Path(tmp) / "events.json"),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        browser = next(cell for cell in report["cells"] if cell["cellId"] == "browser-gateway")
        self.assertEqual(browser["status"], "baseline preflight failure")
        self.assertFalse(browser["sampleEmissionAllowed"])
        self.assertEqual(browser["evidence"]["status"], "loaded")
        self.assertEqual(browser["evidence"]["sourceStatus"], "baseline preflight failure")
        self.assertEqual(browser["evidence"]["completionStatus"], "PARTIAL")
        self.assertEqual(browser["evidence"]["proofStatus"], "UNPROVEN")
        self.assertEqual(browser["evidence"]["sourcePhase"], self.LIVE_GATE_PHASE)
        self.assertEqual(browser["evidence"]["sourceBom"], self.LIVE_GATE_BOM)
        self.assertEqual(browser["evidence"]["sourceSpec"], self.LIVE_GATE_SPEC)
        self.assertEqual(browser["evidence"]["sourceGate"], self.LIVE_GATE_TEXT)
        self.assertEqual(browser["evidence"]["failedStep"], "preflight.gateway_station")
        self.assertIn("failedStep=preflight.gateway_station", browser["evidence"]["details"])
        self.assertIn("preflight.gateway_station failed: gateway refused", browser["evidence"]["details"])
        self.assertIn("preflight.gateway_station: gateway refused", browser["evidence"]["details"])
        self.assertEqual(browser["evidence"]["issueBreakdown"][0]["category"], "desktop-gateway-preflight")
        self.assertEqual(browser["evidence"]["issue_breakdown"][0]["category"], "desktop-gateway-preflight")
        self.assertEqual(browser["evidence"]["recommendedReviewCommands"][0]["command"], "make desktop")
        self.assertEqual(browser["evidence"]["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(report["summary"]["baselinePreflightFailure"], 1)
        self.assertEqual(report["summary"]["diagnosticIncomplete"], 2)
        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(browser["proofStatus"], "UNPROVEN")
        self.assertEqual(report["redLinePolicy"]["status"], "diagnostic incomplete")
        markdown = module.render_markdown(report)
        self.assertIn(f"`{self.LIVE_GATE_PHASE}`", markdown)
        self.assertIn("`BOM-RUN-03,BOM-RUN-04,BOM-CON-03,BOM-CON-04,BOM-CAP-05,BOM-RUN-05`", markdown)
        self.assertIn(
            "`SPEC-GW-01,SPEC-STA-01,SPEC-STA-02,SPEC-DB-01,SPEC-DB-02,SPEC-STA-03,SPEC-MIRROR-01`",
            markdown,
        )
        self.assertIn(f"`{self.LIVE_GATE_TEXT}`", markdown)
        self.assertIn("failedStep=preflight.gateway_station", markdown)
        self.assertIn("preflight.gateway_station failed: gateway refused", markdown)
        self.assertIn("issue=desktop-gateway-preflight", markdown)
        self.assertIn("review=make desktop", markdown)
        self.assertIn("review=python3 tooling/scripts/desktop-telemetry-live-gate.py", markdown)

    def test_standalone_preflight_failure_is_top_level_matrix_input(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = self.write_sampled_live_gate(tmp)
            preflight = self.write_preflight(tmp, "baseline preflight failure", sample_emission_allowed=False)
            events_report = self.write_events(tmp, self.baseline_events())
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    preflight_report=str(preflight),
                    events_report=str(events_report),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        self.assertEqual(report["preflightState"]["status"], "diagnostic incomplete")
        self.assertEqual(report["preflightState"]["sourceStatus"], "baseline preflight failure")
        self.assertEqual(report["preflightState"]["completionStatus"], "PARTIAL")
        self.assertEqual(report["preflightState"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["preflightState"]["sourceArtifactKind"], "desktop-performance-preflight")
        self.assertEqual(report["preflightState"]["sourcePhase"], self.PREFLIGHT_PHASE)
        self.assertEqual(report["preflightState"]["sourceBom"], self.PREFLIGHT_BOM)
        self.assertEqual(report["preflightState"]["sourceSpec"], self.PREFLIGHT_SPEC)
        self.assertEqual(report["preflightState"]["sourceGate"], self.PREFLIGHT_GATE)
        self.assertFalse(report["preflightState"]["sampleEmissionAllowed"])
        self.assertFalse(report["failClosed"]["preflightSampleEmissionAllowed"])
        self.assertEqual(report["issue_breakdown"][0]["category"], "desktop-gateway-preflight")
        self.assertEqual(report["issueBreakdown"][0]["category"], "desktop-gateway-preflight")
        markdown = module.render_markdown(report)
        self.assertIn("## Runtime Preflight", markdown)
        self.assertIn(f"Source artifact: `{preflight}`", markdown)
        self.assertIn("Source kind: `desktop-performance-preflight`", markdown)
        self.assertIn(f"Source phase: `{self.PREFLIGHT_PHASE}`", markdown)
        self.assertIn("Sample emission allowed: `False`", markdown)

    def test_pass_live_gate_requires_source_metadata(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = Path(tmp) / "live-gate.json"
            live_gate.write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "sampleEmissionAllowed": True,
                        "interactionId": "sample-1",
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(Path(tmp) / "events.json"),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        browser = next(cell for cell in report["cells"] if cell["cellId"] == "browser-gateway")
        self.assertEqual(browser["status"], "blocked")
        self.assertFalse(browser["sampleEmissionAllowed"])
        self.assertEqual(browser["evidence"]["status"], "missing-source-metadata")
        self.assertEqual(browser["evidence"]["sourceStatus"], "pass")
        self.assertIn("missing or invalid artifactKind", browser["evidence"]["details"])
        self.assertIn("missing or invalid completionStatus", browser["evidence"]["details"])
        self.assertIn("missing required P0a BOM binding", browser["evidence"]["details"])
        self.assertIn("missing required P0a Spec binding", browser["evidence"]["details"])
        markdown = module.render_markdown(report)
        self.assertIn("`missing-source-metadata`", markdown)
        self.assertIn("missing required P0a BOM binding", markdown)

    def test_preflight_failure_requires_diagnostic_shape(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = Path(tmp) / "live-gate.json"
            live_gate.write_text(
                json.dumps(
                    {
                        **self.live_gate_metadata(
                            "baseline preflight failure",
                            sample_emission_allowed=False,
                        ),
                        "error": "gateway refused",
                        "failedStep": "preflight.gateway_station",
                        "reason": "preflight.gateway_station failed: gateway refused",
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(Path(tmp) / "events.json"),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        browser = next(cell for cell in report["cells"] if cell["cellId"] == "browser-gateway")
        self.assertEqual(browser["status"], "blocked")
        self.assertFalse(browser["sampleEmissionAllowed"])
        self.assertEqual(browser["evidence"]["status"], "missing-source-metadata")
        self.assertIn("missing issue_breakdown", browser["evidence"]["details"])
        self.assertIn("missing recommended_review_commands", browser["evidence"]["details"])
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")

    def test_pass_live_gate_requires_exact_phase(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = Path(tmp) / "live-gate.json"
            live_gate.write_text(
                json.dumps(
                    {
                        **self.live_gate_metadata("pass", sample_emission_allowed=True),
                        "phase": "P0a",
                        "interactionId": "sample-1",
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(Path(tmp) / "events.json"),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        browser = next(cell for cell in report["cells"] if cell["cellId"] == "browser-gateway")
        self.assertEqual(browser["status"], "blocked")
        self.assertFalse(browser["sampleEmissionAllowed"])
        self.assertEqual(browser["evidence"]["status"], "missing-source-metadata")
        self.assertIn("missing or invalid phase", browser["evidence"]["details"])

    def test_missing_live_gate_report_is_fail_closed(self) -> None:
        module = load_gate_module()
        report = module.build_matrix(
            argparse.Namespace(
                live_gate_report="/tmp/does-not-exist-live-gate.json",
                events_report="/tmp/does-not-exist-events.json",
                cell_evidence_dir="/tmp/does-not-exist-cell-evidence",
            )
        )

        browser = next(cell for cell in report["cells"] if cell["cellId"] == "browser-gateway")
        tauri = next(cell for cell in report["cells"] if cell["cellId"] == "tauri-webview-dev")
        self.assertEqual(report["artifactKind"], "desktop-performance-matrix-gate")
        self.assertEqual(report["phase"], "P0c-3/P0c-4/P0c-5")
        self.assertIn("BOM-GATE-02", report["bom"])
        self.assertIn("BOM-GATE-03", report["bom"])
        self.assertIn("SPEC-GATE-02", report["spec"])
        self.assertIn("SPEC-GATE-03", report["spec"])
        self.assertTrue(report["gate"])
        self.assertEqual(browser["status"], "baseline preflight failure")
        self.assertFalse(browser["sampleEmissionAllowed"])
        self.assertEqual(browser["evidence"]["status"], "missing")
        self.assertEqual(browser["evidence"]["sourceStatus"], "missing")
        self.assertEqual(browser["evidence"]["completionStatus"], "PARTIAL")
        self.assertEqual(browser["evidence"]["proofStatus"], "UNPROVEN")
        self.assertEqual(tauri["status"], "diagnostic incomplete")
        self.assertFalse(tauri["sampleEmissionAllowed"])
        self.assertEqual(tauri["evidence"]["status"], "missing")
        issue_categories = [issue["category"] for issue in report["issue_breakdown"]]
        self.assertIn("desktop-performance-preflight", issue_categories)
        self.assertIn("matrix-cell", issue_categories)
        self.assertEqual(report["issueBreakdown"], report["issue_breakdown"])
        self.assertEqual(report["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(report["recommendedReviewCommands"][0]["command"], "make desktop")
        self.assertTrue(
            any(
                command["command"] == "python3 tooling/scripts/desktop-performance-matrix-gate.py"
                for command in report["recommended_review_commands"]
            )
        )
        self.assertEqual(tauri["evidence"]["issue_breakdown"][0]["category"], "runtime-cell-evidence")
        self.assertEqual(tauri["evidence"]["issueBreakdown"][0]["category"], "runtime-cell-evidence")
        self.assertEqual(tauri["evidence"]["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(tauri["evidence"]["recommendedReviewCommands"][0]["command"], "make desktop")
        self.assertIn("BOM-GATE-02", browser["bom"])
        self.assertIn("SPEC-GATE-02", browser["spec"])
        policy = next(policy for policy in report["redLinePolicy"]["policies"] if policy["policyId"] == "primary-nav-click")
        self.assertEqual(policy["rawEvidence"]["status"], "missing")
        self.assertEqual(policy["rawEvidence"]["path"], "/tmp/does-not-exist-events.json")
        markdown = module.render_markdown(report)
        self.assertIn("`missing` | `/tmp/does-not-exist-live-gate.json`", markdown)
        self.assertIn("`missing` | `/tmp/does-not-exist-cell-evidence/tauri-webview-dev.json`", markdown)
        self.assertIn("| Policy | Scope | Status | Proof | Matched interactions | Window count | Raw evidence status | Raw evidence path | Raw source artifact | Raw source kind | Raw source completion | Raw source proof | Raw source phase | Raw source BOM | Raw source Spec | Raw source Gate | Raw details | Reason |", markdown)
        self.assertIn("`missing` | `/tmp/does-not-exist-events.json`", markdown)
        self.assertIn("- Proof: `UNPROVEN`", markdown)
        self.assertIn(
            "| Cell | Runtime | Entrypoint | Status | Proof | Sample emission | Evidence status | Evidence path | Source artifact | Source kind | Source completion | Source proof | Source phase | Source BOM | Source Spec | Source Gate | Details | Reason |",
            markdown,
        )

    def test_failed_cohort_gate_blocks_every_runtime_cell(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = self.write_sampled_live_gate(tmp)
            events_report = self.write_events(tmp, self.baseline_events())
            cohort_report = Path(tmp) / "desktop-performance-cohort-gate.json"
            cohort_report.write_text(
                json.dumps(
                    {
                        "artifactKind": "desktop-performance-cohort-gate",
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "sampleEmissionAllowed": False,
                        "phase": "P0c-3",
                        "planTask": "P0c3-R2",
                        "gate": "All runtime cells share one proven cohort",
                        "failedStep": "cohort.tauri-webview-dev.actualActorId",
                        "reason": "actual actor mismatch",
                        "issue_breakdown": [
                            {
                                "category": "cohort-actual-actor",
                                "failedStep": "cohort.tauri-webview-dev.actualActorId",
                                "summary": "actual actor mismatch",
                                "proofImpact": "Every runtime cell stays blocked.",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(events_report),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                    cohort_report=str(cohort_report),
                )
            )

        self.assertFalse(report["failClosed"]["cohortSampleEmissionAllowed"])
        self.assertEqual(report["failClosed"]["blockedCellCount"], 3)
        self.assertTrue(all(not cell["sampleEmissionAllowed"] for cell in report["cells"]))
        self.assertEqual(report["redLinePolicy"]["status"], "diagnostic incomplete")
        self.assertTrue(
            any(
                item["category"] == "cohort-actual-actor"
                for item in report["issue_breakdown"]
            )
        )

    def test_sampled_cell_with_missing_required_events_fails_red_line(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = Path(tmp) / "live-gate.json"
            live_gate.write_text(
                json.dumps(
                    {
                        **self.live_gate_metadata("pass", sample_emission_allowed=True),
                        "interactionId": "sample-1",
                    }
                ),
                encoding="utf-8",
            )
            events_report = self.write_events(
                tmp,
                [
                    {
                        "kind": "boot.phase",
                        "durationMs": 1,
                        "interactionId": "sample-1",
                    }
                ],
            )
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(events_report),
                    cohort_report=str(Path(tmp) / "desktop-performance-cohort-gate.json"),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        self.assertEqual(report["redLinePolicy"]["status"], "fail")
        browser = next(cell for cell in report["cells"] if cell["cellId"] == "browser-gateway")
        self.assertEqual(browser["evidence"]["completionStatus"], "DONE")
        self.assertEqual(browser["evidence"]["proofStatus"], "PROVEN")
        self.assertEqual(browser["evidence"]["sourceArtifact"], str(live_gate))
        self.assertEqual(browser["evidence"]["sourceArtifactKind"], "desktop-telemetry-live-gate")
        self.assertEqual(browser["evidence"]["sourcePhase"], self.LIVE_GATE_PHASE)
        self.assertEqual(browser["evidence"]["sourceBom"], self.LIVE_GATE_BOM)
        self.assertEqual(browser["evidence"]["sourceSpec"], self.LIVE_GATE_SPEC)
        self.assertEqual(browser["evidence"]["sourceGate"], self.LIVE_GATE_TEXT)
        primary = next(policy for policy in report["redLinePolicy"]["policies"] if policy["policyId"] == "primary-nav-click")
        self.assertEqual(primary["status"], "fail")
        self.assertIn("interaction.started", primary["missingEventKinds"])
        self.assertEqual(primary["rawEvidence"]["status"], "loaded")
        self.assertEqual(primary["rawEvidence"]["path"], str(events_report))
        self.assertEqual(primary["rawEvidence"]["sourceArtifact"], str(events_report))
        self.assertEqual(primary["rawEvidence"]["sourceArtifactKind"], self.RAW_EVENTS_ARTIFACT_KIND)
        self.assertEqual(report["status"], "fail")

    def test_sampled_cell_requires_raw_event_source_metadata(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = self.write_sampled_live_gate(tmp)
            events_report = Path(tmp) / "events.json"
            events_report.write_text(json.dumps({"events": self.baseline_events()}), encoding="utf-8")
            self.write_proven_cohort(tmp)
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(events_report),
                    cohort_report=str(Path(tmp) / "desktop-performance-cohort-gate.json"),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        self.assertEqual(report["redLinePolicy"]["status"], "diagnostic incomplete")
        self.assertEqual(report["redLinePolicy"]["proofStatus"], "UNPROVEN")
        primary = next(policy for policy in report["redLinePolicy"]["policies"] if policy["policyId"] == "primary-nav-click")
        self.assertEqual(primary["status"], "diagnostic incomplete")
        self.assertEqual(primary["reason"], "raw event evidence is not loaded/proven")
        self.assertEqual(primary["rawEvidence"]["status"], "missing-source-metadata")
        self.assertEqual(primary["rawEvidence"]["path"], str(events_report))
        self.assertIn("missing or invalid phase", primary["rawEvidence"]["details"])
        self.assertIn("missing required raw event BOM binding", primary["rawEvidence"]["details"])
        self.assertIn("missing Station product sink boundary", primary["rawEvidence"]["details"])
        self.assertEqual(report["status"], "diagnostic incomplete")
        markdown = module.render_markdown(report)
        self.assertIn("`missing-source-metadata`", markdown)
        self.assertIn("missing or invalid phase", markdown)
        self.assertIn("missing required raw event BOM binding", markdown)
        self.assertIn("missing Station product sink boundary", markdown)
        self.assertIn("raw event evidence is not loaded/proven", markdown)

    def test_sampled_cell_distinguishes_unproven_raw_event_source(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = self.write_sampled_live_gate(tmp)
            events_report = Path(tmp) / "events.json"
            events_report.write_text(
                json.dumps(
                    {
                        "artifactKind": self.RAW_EVENTS_ARTIFACT_KIND,
                        "phase": self.RAW_EVENTS_PHASE,
                        "bom": self.RAW_EVENTS_BOM,
                        "spec": self.RAW_EVENTS_SPEC,
                        "gate": self.RAW_EVENTS_GATE,
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "productSink": "Station",
                        "mirrorRole": "Dev/CI evidence artifact",
                        "events": self.baseline_events(),
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(events_report),
                    cohort_report=str(Path(tmp) / "desktop-performance-cohort-gate.json"),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        primary = next(policy for policy in report["redLinePolicy"]["policies"] if policy["policyId"] == "primary-nav-click")
        self.assertEqual(primary["status"], "diagnostic incomplete")
        self.assertEqual(primary["rawEvidence"]["status"], "source-proof-unproven")
        self.assertEqual(primary["rawEvidence"]["sourceArtifactKind"], self.RAW_EVENTS_ARTIFACT_KIND)
        self.assertIn("source completionStatus is 'PARTIAL'; expected 'DONE'", primary["rawEvidence"]["details"])
        self.assertIn("source proofStatus is 'UNPROVEN'; expected 'PROVEN'", primary["rawEvidence"]["details"])
        self.assertEqual(report["status"], "diagnostic incomplete")

    def test_sampled_cell_requires_paint_timing_evidence(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = self.write_sampled_live_gate(tmp)
            events = [event for event in self.baseline_events() if event["kind"] != "paint.timing"]
            events_report = self.write_events(tmp, events)
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(events_report),
                    cohort_report=str(Path(tmp) / "desktop-performance-cohort-gate.json"),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        policy = next(policy for policy in report["redLinePolicy"]["policies"] if policy["policyId"] == "paint-timing-evidence")
        self.assertEqual(policy["status"], "fail")
        self.assertIn("paint.timing", policy["missingEventKinds"])
        self.assertEqual(report["status"], "fail")

    def test_required_events_must_share_interaction_window(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = self.write_sampled_live_gate(tmp)
            events = [
                {"kind": "interaction.started", "durationMs": 0, "interactionId": "sample-1"},
                {"kind": "route.requested", "durationMs": 0, "interactionId": "sample-1"},
                {"kind": "route.visible", "durationMs": 40, "interactionId": "sample-2"},
                {"kind": "react.commit", "durationMs": 16, "interactionId": "sample-3"},
                {"kind": "paint.timing", "durationMs": 300, "interactionId": "sample-1"},
            ]
            events_report = self.write_events(tmp, events)
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(events_report),
                    cohort_report=str(Path(tmp) / "desktop-performance-cohort-gate.json"),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        policy = next(policy for policy in report["redLinePolicy"]["policies"] if policy["policyId"] == "primary-nav-click")
        self.assertEqual(policy["status"], "fail")
        self.assertEqual(policy["reason"], "no single interactionId window contains required event kinds")
        self.assertEqual(policy["interactionWindowCount"], 3)
        self.assertEqual(report["status"], "fail")
        markdown = module.render_markdown(report)
        self.assertIn("`primary-nav-click` | primary navigation click-frame | `fail` | `UNPROVEN` | `n/a` | 3 |", markdown)
        self.assertIn(f"| `primary-nav-click` | primary navigation click-frame | `fail` | `UNPROVEN` | `n/a` | 3 | `loaded` | `{events_report}` | `{events_report}` | `desktop-performance-station-mirror` | `DONE` | `PROVEN` |", markdown)

    def test_sampled_cell_fails_over_budget_layout_shift(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = self.write_sampled_live_gate(tmp)
            events = [
                {**event, "durationMs": 0.2}
                if event["kind"] == "layout.shift"
                else event
                for event in self.baseline_events()
            ]
            events_report = self.write_events(tmp, events)
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(events_report),
                    cohort_report=str(Path(tmp) / "desktop-performance-cohort-gate.json"),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        policy = next(policy for policy in report["redLinePolicy"]["policies"] if policy["policyId"] == "layout-shift")
        self.assertEqual(policy["status"], "fail")
        self.assertEqual(policy["maxObservedDurationMs"], 0.2)
        self.assertEqual(report["status"], "fail")

    def test_runtime_cell_evidence_requires_sample_emission_allowed(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = self.write_sampled_live_gate(tmp)
            events_report = self.write_events(tmp, self.baseline_events())
            evidence_dir = self.write_cell_evidence(
                tmp,
                "tauri-webview-dev",
                {
                    "status": "sampled",
                    "artifactKind": "desktop-performance-runtime-cell",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                    "phase": "P0c-3",
                    "bom": ["BOM-GATE-02", "BOM-CAP-04"],
                    "spec": ["SPEC-GATE-02", "SPEC-RUN-01"],
                    "gate": "Tauri WebView runtime cell must pass preflight before samples are accepted",
                    "cellId": "tauri-webview-dev",
                    "runtime": "tauri-webview-dev",
                    "entrypoint": "make desktop",
                    "startupMode": "dev-tauri-webview",
                    "interactionId": "tauri-sample-1",
                    "sampleEmissionAllowed": False,
                },
            )
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(events_report),
                    cohort_report=str(Path(tmp) / "desktop-performance-cohort-gate.json"),
                    cell_evidence_dir=str(evidence_dir),
                )
            )

        tauri = next(cell for cell in report["cells"] if cell["cellId"] == "tauri-webview-dev")
        self.assertEqual(tauri["status"], "sampled")
        self.assertFalse(tauri["sampleEmissionAllowed"])
        self.assertEqual(tauri["evidence"]["status"], "loaded")
        self.assertEqual(tauri["evidence"]["sourceStatus"], "sampled")
        self.assertEqual(tauri["evidence"]["completionStatus"], "DONE")
        self.assertEqual(tauri["evidence"]["proofStatus"], "PROVEN")
        self.assertEqual(tauri["evidence"]["sourceArtifact"], str(evidence_dir / "tauri-webview-dev.json"))
        self.assertEqual(tauri["evidence"]["sourceArtifactKind"], "desktop-performance-runtime-cell")
        self.assertEqual(tauri["evidence"]["sourcePhase"], "P0c-3")
        self.assertEqual(tauri["evidence"]["sourceCellId"], "tauri-webview-dev")
        self.assertEqual(tauri["evidence"]["sourceEntrypoint"], "make desktop")
        self.assertEqual(tauri["evidence"]["sourceStartupMode"], "dev-tauri-webview")
        self.assertEqual(tauri["evidence"]["sourceBom"], ["BOM-GATE-02", "BOM-CAP-04"])
        self.assertEqual(tauri["evidence"]["sourceSpec"], ["SPEC-GATE-02", "SPEC-RUN-01"])
        self.assertEqual(
            tauri["evidence"]["sourceGate"],
            "Tauri WebView runtime cell must pass preflight before samples are accepted",
        )
        self.assertEqual(tauri["evidence"]["issue_breakdown"][0]["category"], "runtime-cell-evidence")
        self.assertEqual(tauri["evidence"]["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(report["summary"]["sampled"], 1)
        self.assertEqual(report["failClosed"]["blockedCellCount"], 2)
        self.assertEqual(report["status"], "diagnostic incomplete")
        markdown = module.render_markdown(report)
        self.assertIn("`loaded` |", markdown)
        self.assertIn("tauri-webview-dev.json", markdown)

    def test_runtime_cell_evidence_requires_source_metadata(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = self.write_sampled_live_gate(tmp)
            events_report = self.write_events(tmp, self.baseline_events())
            evidence_dir = self.write_cell_evidence(
                tmp,
                "tauri-webview-dev",
                {
                    "status": "sampled",
                    "runtime": "tauri-webview-dev",
                    "interactionId": "tauri-sample-1",
                    "sampleEmissionAllowed": True,
                },
            )
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(events_report),
                    cell_evidence_dir=str(evidence_dir),
                )
            )

        tauri = next(cell for cell in report["cells"] if cell["cellId"] == "tauri-webview-dev")
        self.assertEqual(tauri["status"], "blocked")
        self.assertFalse(tauri["sampleEmissionAllowed"])
        self.assertEqual(tauri["evidence"]["status"], "missing-source-metadata")
        self.assertEqual(tauri["evidence"]["sourceStatus"], "sampled")
        self.assertIn("missing or invalid completionStatus", tauri["evidence"]["details"])
        self.assertIn("missing required BOM binding", tauri["evidence"]["details"])
        self.assertIn("missing required Spec binding", tauri["evidence"]["details"])
        self.assertEqual(report["summary"]["blocked"], 1)
        self.assertEqual(report["status"], "diagnostic incomplete")
        markdown = module.render_markdown(report)
        self.assertIn("`missing-source-metadata`", markdown)
        self.assertIn("missing or invalid artifactKind", markdown)
        self.assertIn("missing or invalid cellId", markdown)
        self.assertIn("missing or invalid entrypoint", markdown)
        self.assertIn("missing or invalid startupMode", markdown)

    def test_runtime_cell_evidence_requires_exact_phase(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = self.write_sampled_live_gate(tmp)
            events_report = self.write_events(tmp, self.baseline_events())
            evidence_dir = self.write_cell_evidence(
                tmp,
                "tauri-webview-dev",
                {
                    "status": "sampled",
                    "artifactKind": "desktop-performance-runtime-cell",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                    "phase": "P0c",
                    "bom": ["BOM-GATE-02", "BOM-CAP-04"],
                    "spec": ["SPEC-GATE-02", "SPEC-RUN-01"],
                    "gate": "Tauri WebView runtime cell must pass preflight before samples are accepted",
                    "cellId": "tauri-webview-dev",
                    "runtime": "tauri-webview-dev",
                    "entrypoint": "make desktop",
                    "startupMode": "dev-tauri-webview",
                    "interactionId": "tauri-sample-1",
                    "sampleEmissionAllowed": True,
                },
            )
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(events_report),
                    cell_evidence_dir=str(evidence_dir),
                )
            )

        tauri = next(cell for cell in report["cells"] if cell["cellId"] == "tauri-webview-dev")
        self.assertEqual(tauri["status"], "blocked")
        self.assertFalse(tauri["sampleEmissionAllowed"])
        self.assertEqual(tauri["evidence"]["status"], "missing-source-metadata")
        self.assertEqual(tauri["evidence"]["sourceStatus"], "sampled")
        self.assertIn("missing or invalid phase", tauri["evidence"]["details"])

    def test_runtime_cell_evidence_blocks_runtime_mismatch(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            live_gate = self.write_sampled_live_gate(tmp)
            events_report = self.write_events(tmp, self.baseline_events())
            evidence_dir = self.write_cell_evidence(
                tmp,
                "tauri-webview-dev",
                {
                    "status": "sampled",
                    "runtime": "browser-gateway",
                    "sampleEmissionAllowed": True,
                },
            )
            report = module.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(live_gate),
                    events_report=str(events_report),
                    cell_evidence_dir=str(evidence_dir),
                )
            )

        tauri = next(cell for cell in report["cells"] if cell["cellId"] == "tauri-webview-dev")
        self.assertEqual(tauri["status"], "blocked")
        self.assertFalse(tauri["sampleEmissionAllowed"])
        self.assertEqual(tauri["evidence"]["reason"], "runtime cell evidence report runtime mismatch")
        self.assertEqual(tauri["evidence"]["status"], "runtime-mismatch")
        self.assertEqual(tauri["evidence"]["issue_breakdown"][0]["category"], "runtime-cell-evidence")
        self.assertEqual(tauri["evidence"]["recommended_review_commands"][0]["command"], "make desktop")


if __name__ == "__main__":
    unittest.main()
