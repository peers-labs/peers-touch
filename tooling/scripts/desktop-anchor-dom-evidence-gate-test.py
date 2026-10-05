#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


def load_module(name: str, filename: str):
    script = Path(__file__).with_name(filename)
    spec = importlib.util.spec_from_file_location(name, script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopAnchorDomEvidenceGateTest(unittest.TestCase):
    def test_complete_native_runtime_evidence_passes(self) -> None:
        gate = load_module(
            "desktop_anchor_dom_evidence_gate",
            "desktop-anchor-dom-evidence-gate.py",
        )
        inventory = gate.load_inventory_module()
        anchors = {
            anchor.anchor_id: {
                "status": "pass",
                "selector": anchor.selector,
                "count": 1,
            }
            for anchor in inventory.REQUIRED_ANCHORS
        }
        evidence = {
            "artifactKind": inventory.DOM_EVIDENCE_ARTIFACT_KIND,
            "phase": inventory.DOM_EVIDENCE_PHASE,
            "bom": list(inventory.DOM_EVIDENCE_BOM),
            "spec": list(inventory.DOM_EVIDENCE_SPEC),
            "gate": inventory.DOM_EVIDENCE_GATE,
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "tauriDev": {"status": "pass", "anchors": anchors},
            "tauriPackaged": {"status": "pass", "anchors": anchors},
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "dom.json"
            path.write_text(json.dumps(evidence), encoding="utf-8")
            report = gate.build_report(path)

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertNotIn("browser", json.dumps(report).lower())


if __name__ == "__main__":
    unittest.main()
