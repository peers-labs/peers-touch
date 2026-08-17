#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


def load_template_module():
    script = Path(__file__).with_name("desktop-telemetry-mirror-template.py")
    spec = importlib.util.spec_from_file_location("desktop_telemetry_mirror_template", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_matrix_module():
    script = Path(__file__).with_name("desktop-performance-matrix-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_matrix_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_report_module():
    script = Path(__file__).with_name("desktop-performance-report.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_report", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopTelemetryMirrorTemplateTest(unittest.TestCase):
    def test_template_carries_fail_closed_trace_metadata(self) -> None:
        module = load_template_module()
        report = module.build_template("http://station.local", {"interactionId": "sample-1"})

        self.assertEqual(report["source"], "station-query-template")
        self.assertEqual(report["artifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["phase"], "P0a-6/P0c-5")
        self.assertEqual(report["bom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(report["spec"], ["SPEC-STA-03", "SPEC-MIRROR-01"])
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["productSink"], "Station")
        self.assertEqual(report["mirrorRole"], "Dev/CI evidence artifact")
        self.assertEqual(report["summary"]["eventCount"], 0)
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["failedStep"], "station-query-template")
        self.assertEqual(report["summary"]["failedStep"], "station-query-template")
        self.assertEqual(report["summary"]["primaryIssueCategory"], "station-mirror-source")
        self.assertEqual(report["summary"]["primaryIssueSourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(report["issue_breakdown"][0]["category"], "station-mirror-source")
        self.assertEqual(report["issue_breakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issue_breakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["issueBreakdown"][0]["category"], "station-mirror-source")
        self.assertEqual(
            report["issue_breakdown"][0]["sourceArtifact"],
            "evidence-store:current:report",
        )
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(report["issue_breakdown"][0]["sourcePhase"], "P0a-6/P0c-5")
        self.assertEqual(report["issue_breakdown"][0]["sourceBom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(report["issue_breakdown"][0]["sourceSpec"], ["SPEC-STA-03", "SPEC-MIRROR-01"])
        self.assertEqual(report["issue_breakdown"][0]["sourceGate"], report["gate"])
        self.assertEqual(report["issue_breakdown"][0]["evidenceDetails"][0]["step"], "station-query-template")
        self.assertEqual(
            report["issue_breakdown"][0]["recommendedReviewCommands"],
            report["recommendedReviewCommands"],
        )
        self.assertEqual(report["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(report["recommendedReviewCommands"][0]["command"], "make desktop")
        markdown = module.render_markdown(report)
        self.assertIn("- Sample emission allowed: `False`", markdown)
        commands = [command["command"] for command in report["recommendedReviewCommands"]]
        self.assertIn(
            "python3 tooling/scripts/desktop-telemetry-live-gate.py",
            commands,
        )
        self.assertFalse(
            any(
                command.startswith("python3 tooling/scripts/desktop-telemetry-mirror.py --station-url")
                for command in commands
            )
        )

    def test_write_template_replaces_explicit_output_without_mutable_latest_semantics(self) -> None:
        module = load_template_module()
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / "desktop-performance-latest"
            json_path = prefix.with_suffix(".json")
            md_path = prefix.with_suffix(".md")
            json_path.write_text('{"source":"station-query","proofStatus":"PROVEN"}\n', encoding="utf-8")
            md_path.write_text("existing\n", encoding="utf-8")

            _, _, written = module.write_template(prefix, module.build_template("http://station.local"))
            replaced = json.loads(json_path.read_text(encoding="utf-8"))

        self.assertTrue(written)
        self.assertEqual(replaced["source"], "station-query-template")
        self.assertEqual(replaced["proofStatus"], "UNPROVEN")

    def test_write_template_refreshes_existing_legacy_template(self) -> None:
        module = load_template_module()
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / "desktop-performance-latest"
            json_path = prefix.with_suffix(".json")
            md_path = prefix.with_suffix(".md")
            json_path.write_text(
                '{"source":"station-query-template","proofStatus":"UNPROVEN"}\n',
                encoding="utf-8",
            )
            md_path.write_text("legacy template\n", encoding="utf-8")

            _, _, written = module.write_template(prefix, module.build_template("http://station.local"))
            refreshed = json.loads(json_path.read_text(encoding="utf-8"))

        self.assertTrue(written)
        self.assertEqual(refreshed["source"], "station-query-template")
        self.assertFalse(refreshed["sampleEmissionAllowed"])
        self.assertEqual(refreshed["issue_breakdown"][0]["category"], "station-mirror-source")
        self.assertEqual(refreshed["issue_breakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(refreshed["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(refreshed["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(refreshed["issue_breakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(refreshed["issue_breakdown"][0]["sourceArtifact"], str(json_path))
        self.assertEqual(refreshed["issue_breakdown"][0]["sourceArtifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(refreshed["issue_breakdown"][0]["sourcePhase"], "P0a-6/P0c-5")
        self.assertEqual(refreshed["issue_breakdown"][0]["sourceBom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(refreshed["issue_breakdown"][0]["sourceSpec"], ["SPEC-STA-03", "SPEC-MIRROR-01"])
        self.assertEqual(refreshed["issue_breakdown"][0]["sourceGate"], refreshed["gate"])
        self.assertEqual(refreshed["recommended_review_commands"][0]["command"], "make desktop")

    def test_write_template_refreshes_existing_template_with_legacy_review_command(self) -> None:
        module = load_template_module()
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / "desktop-performance-latest"
            json_path = prefix.with_suffix(".json")
            md_path = prefix.with_suffix(".md")
            json_path.write_text(
                json.dumps(
                    {
                        "source": "station-query-template",
                        "proofStatus": "UNPROVEN",
                        "issue_breakdown": [{"category": "station-mirror-source"}],
                        "recommended_review_commands": [
                            {"command": "make desktop"},
                            {
                                "command": "python3 tooling/scripts/desktop-telemetry-mirror.py --station-url http://127.0.0.1:18080"
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )
            md_path.write_text("legacy template\n", encoding="utf-8")

            _, _, written = module.write_template(prefix, module.build_template("http://station.local"))
            refreshed = json.loads(json_path.read_text(encoding="utf-8"))
            commands = [command["command"] for command in refreshed["recommended_review_commands"]]

        self.assertTrue(written)
        self.assertIn(
            "python3 tooling/scripts/desktop-telemetry-live-gate.py",
            commands,
        )
        self.assertFalse(
            any(
                command.startswith("python3 tooling/scripts/desktop-telemetry-mirror.py --station-url")
                for command in commands
            )
        )

    def test_write_template_refreshes_existing_template_without_sample_emission_block(self) -> None:
        module = load_template_module()
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / "desktop-performance-latest"
            json_path = prefix.with_suffix(".json")
            md_path = prefix.with_suffix(".md")
            json_path.write_text(
                json.dumps(
                    {
                        "source": "station-query-template",
                        "proofStatus": "UNPROVEN",
                        "issue_breakdown": [{"category": "station-mirror-source"}],
                        "recommended_review_commands": [
                            {"command": "make desktop"},
                            {
                                "command": "python3 tooling/scripts/desktop-telemetry-live-gate.py --mirror-prefix tooling/acceptance/reports/desktop-performance-latest"
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )
            md_path.write_text("template missing sample emission block\n", encoding="utf-8")

            _, _, written = module.write_template(prefix, module.build_template("http://station.local"))
            refreshed = json.loads(json_path.read_text(encoding="utf-8"))

        self.assertTrue(written)
        self.assertFalse(refreshed["sampleEmissionAllowed"])
        self.assertFalse(refreshed["summary"]["sampleEmissionAllowed"])
        self.assertEqual(refreshed["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(refreshed["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(refreshed["issue_breakdown"][0]["sampleEmissionAllowed"])

    def test_write_template_refreshes_existing_template_without_issue_fail_closed_state(self) -> None:
        module = load_template_module()
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / "desktop-performance-latest"
            json_path = prefix.with_suffix(".json")
            md_path = prefix.with_suffix(".md")
            json_path.write_text(
                json.dumps(
                    {
                        "source": "station-query-template",
                        "sampleEmissionAllowed": False,
                        "summary": {"sampleEmissionAllowed": False},
                        "proofStatus": "UNPROVEN",
                        "issue_breakdown": [
                            {
                                "category": "station-mirror-source",
                                "sampleEmissionAllowed": False,
                            }
                        ],
                        "recommended_review_commands": [
                            {"command": "make desktop"},
                            {
                                "command": "python3 tooling/scripts/desktop-telemetry-live-gate.py --mirror-prefix tooling/acceptance/reports/desktop-performance-latest"
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )
            md_path.write_text("template missing issue fail-closed state\n", encoding="utf-8")

            _, _, written = module.write_template(prefix, module.build_template("http://station.local"))
            refreshed = json.loads(json_path.read_text(encoding="utf-8"))

        self.assertTrue(written)
        self.assertEqual(refreshed["issue_breakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(refreshed["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(refreshed["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(refreshed["issue_breakdown"][0]["sampleEmissionAllowed"])

    def test_matrix_and_report_consume_template_as_unproven(self) -> None:
        template = load_template_module()
        matrix = load_matrix_module()
        report_module = load_report_module()
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / "desktop-performance-latest"
            mirror_report = template.build_template("http://station.local")
            template.write_template(prefix, mirror_report, force=True)
            events_report = prefix.with_suffix(".json")
            matrix_report = matrix.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(Path(tmp) / "missing-live-gate.json"),
                    events_report=str(events_report),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )
            matrix_path = Path(tmp) / "matrix.json"
            matrix_path.write_text(json.dumps(matrix_report), encoding="utf-8")
            performance_report = report_module.build_report(
                argparse.Namespace(
                    station_mirror_report=str(events_report),
                    matrix_report=str(matrix_path),
                    anchor_inventory_report=str(Path(tmp) / "missing-anchor.json"),
                    anchor_dom_evidence_gate_report=str(Path(tmp) / "missing-dom-gate.json"),
                    output_prefix=str(Path(tmp) / "report"),
                )
            )

        raw_evidence = matrix_report["redLinePolicy"]["rawEvidence"]
        self.assertEqual(raw_evidence["status"], "source-proof-unproven")
        self.assertEqual(raw_evidence["sourcePhase"], "P0a-6/P0c-5")
        self.assertEqual(raw_evidence["sourceBom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertIn("source completionStatus is 'PARTIAL'; expected 'DONE'", raw_evidence["details"])
        self.assertIn("source proofStatus is 'UNPROVEN'; expected 'PROVEN'", raw_evidence["details"])

        station_source = performance_report["stationMirrorSource"]
        self.assertEqual(station_source["status"], "diagnostic incomplete")
        self.assertEqual(station_source["phase"], "P0a-6/P0c-5")
        self.assertEqual(station_source["bom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(station_source["proofStatus"], "UNPROVEN")
        self.assertEqual(
            station_source["reason"],
            "Station mirror has not been queried; raw event evidence remains unproven",
        )
        self.assertEqual(station_source["details"][0]["step"], "station-query-template")
        self.assertEqual(station_source["issue_breakdown"][0]["failedStep"], "station-query-template")
        self.assertTrue(
            any(
                command["command"] == "python3 tooling/scripts/desktop-telemetry-live-gate.py"
                for command in station_source["recommendedReviewCommands"]
            )
        )

    def test_main_writes_template_when_missing(self) -> None:
        module = load_template_module()
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / "desktop-performance-latest"
            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-telemetry-mirror-template.py",
                    "--station-url",
                    "http://station.local",
                    "--output-prefix",
                    str(prefix),
                ]
                exit_code = module.main()
            finally:
                sys.argv = old_argv

            written = json.loads(prefix.with_suffix(".json").read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 1)
        self.assertEqual(written["source"], "station-query-template")
        self.assertEqual(written["artifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(written["proofStatus"], "UNPROVEN")
        self.assertFalse(written["sampleEmissionAllowed"])
        self.assertFalse(written["summary"]["sampleEmissionAllowed"])
        self.assertEqual(written["failedStep"], "station-query-template")
        self.assertEqual(written["issue_breakdown"][0]["category"], "station-mirror-source")
        self.assertFalse(written["issue_breakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(
            written["issue_breakdown"][0]["sourceArtifact"],
            str(prefix.resolve().with_suffix(".json")),
        )


if __name__ == "__main__":
    unittest.main()
