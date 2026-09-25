#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


def load_mirror_module():
    script = Path(__file__).with_name("desktop-telemetry-mirror.py")
    spec = importlib.util.spec_from_file_location("desktop_telemetry_mirror", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopTelemetryMirrorTest(unittest.TestCase):
    def test_reads_gateway_query_source_without_credentials(self) -> None:
        module = load_mirror_module()
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.json"
            source.write_text(
                json.dumps({
                    "filters": {"interactionId": "sample-1"},
                    "events": [{"id": "event-1"}],
                    "rollups": [{"module": "desktop"}],
                }),
                encoding="utf-8",
            )

            filters, events, rollups = module.read_source_input(source)

        self.assertEqual(filters, {"interactionId": "sample-1"})
        self.assertEqual(events, [{"id": "event-1"}])
        self.assertEqual(rollups, [{"module": "desktop"}])

    def test_build_report_carries_traceability_metadata(self) -> None:
        module = load_mirror_module()
        report = module.build_report(
            "http://station.local",
            {"interactionId": "sample-1"},
            [{"kind": "route.visible", "durationMs": 42}],
            [{"kind": "route.visible", "p95DurationMs": 42}],
        )

        self.assertEqual(report["schemaVersion"], 1)
        self.assertEqual(report["artifactKind"], "desktop-performance-station-mirror")
        self.assertEqual(report["phase"], "P0a-6/P0c-5")
        self.assertEqual(report["bom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(report["spec"], ["SPEC-STA-03", "SPEC-MIRROR-01"])
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["productSink"], "Station")
        self.assertEqual(report["mirrorRole"], "Dev/CI evidence artifact")
        self.assertEqual(report["summary"]["eventCount"], 1)
        self.assertEqual(report["summary"]["rollupCount"], 1)

    def test_markdown_renders_traceability_and_boundary(self) -> None:
        module = load_mirror_module()
        report = module.build_report("http://station.local", {}, [], [])
        markdown = module.render_markdown(report)

        self.assertIn("- Phase: `P0a-6/P0c-5`", markdown)
        self.assertIn("- Artifact kind: `desktop-performance-station-mirror`", markdown)
        self.assertIn("- BOM: `BOM-CAP-05,BOM-RUN-05`", markdown)
        self.assertIn("- Spec: `SPEC-STA-03,SPEC-MIRROR-01`", markdown)
        self.assertIn("- Product sink: `Station`", markdown)
        self.assertIn("- Mirror role: `Dev/CI evidence artifact`", markdown)
        self.assertIn("- Station remains the product telemetry sink.", markdown)


if __name__ == "__main__":
    unittest.main()
