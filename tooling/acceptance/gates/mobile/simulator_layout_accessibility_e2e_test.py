from __future__ import annotations

import json
import unittest
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.mobile.simulator_layout_accessibility_e2e import (
    GATE_ID,
    audit_accessibility_tree,
    audit_keyboard_tree,
    validate_dom_audit,
)


ACCESSIBLE_TREE = """
<AppiumAUT>
  <XCUIElementTypeApplication x="0" y="0" width="393" height="852">
    <XCUIElementTypeButton label="English" x="307" y="71" width="70" height="34" visible="true" />
    <XCUIElementTypeTextField label="Station address" x="122" y="604" width="185" height="40" visible="true" />
    <XCUIElementTypeButton label="Add Station" x="318" y="606" width="36" height="36" visible="true" />
  </XCUIElementTypeApplication>
</AppiumAUT>
"""


class AccessibilityAuditTests(unittest.TestCase):
    def test_accepts_labeled_controls_inside_application_bounds(self) -> None:
        result = audit_accessibility_tree(ACCESSIBLE_TREE)

        self.assertEqual(result["interactiveCount"], 3)
        self.assertEqual(result["unlabeled"], [])
        self.assertEqual(result["outsideScreen"], [])

    def test_rejects_unlabeled_control(self) -> None:
        markup = ACCESSIBLE_TREE.replace('label="Add Station"', 'label=""')

        with self.assertRaisesRegex(GateError, "unlabeled controls"):
            audit_accessibility_tree(markup)

    def test_rejects_control_outside_application_bounds(self) -> None:
        markup = ACCESSIBLE_TREE.replace(
            'x="318" y="606" width="36" height="36"',
            'x="380" y="606" width="36" height="36"',
        )

        with self.assertRaisesRegex(GateError, "escape"):
            audit_accessibility_tree(markup)

    def test_keyboard_requires_unoccluded_text_field(self) -> None:
        markup = """
        <AppiumAUT>
          <XCUIElementTypeApplication x="0" y="0" width="393" height="852">
            <XCUIElementTypeTextField label="Station address" x="40" y="420" width="300" height="40" visible="true" />
            <XCUIElementTypeKeyboard x="0" y="517" width="393" height="335" visible="true" />
          </XCUIElementTypeApplication>
        </AppiumAUT>
        """

        result = audit_keyboard_tree(markup)

        self.assertEqual(result["textFieldBottom"], 460)
        self.assertEqual(result["keyboardTop"], 517)

    def test_keyboard_rejects_occluded_text_field(self) -> None:
        markup = """
        <AppiumAUT>
          <XCUIElementTypeApplication x="0" y="0" width="393" height="852">
            <XCUIElementTypeTextField label="Station address" x="40" y="500" width="300" height="40" visible="true" />
            <XCUIElementTypeKeyboard x="0" y="517" width="393" height="335" visible="true" />
          </XCUIElementTypeApplication>
        </AppiumAUT>
        """

        with self.assertRaisesRegex(GateError, "occludes"):
            audit_keyboard_tree(markup)


class DomAuditTests(unittest.TestCase):
    def test_accepts_empty_violation_lists(self) -> None:
        result = validate_dom_audit(
            {
                "lang": "en",
                "viewport": {"width": 393, "height": 852},
                "unlabeled": [],
                "clippedText": [],
                "outsideViewport": [],
            }
        )

        self.assertEqual(result["lang"], "en")

    def test_rejects_each_violation_class(self) -> None:
        for field in ("unlabeled", "clippedText", "outsideViewport"):
            with self.subTest(field=field):
                payload = {
                    "viewport": {"width": 393, "height": 852},
                    "unlabeled": [],
                    "clippedText": [],
                    "outsideViewport": [],
                }
                payload[field] = ["violation"]
                with self.assertRaisesRegex(GateError, field):
                    validate_dom_audit(payload)


class GateIdentityTests(unittest.TestCase):
    def test_gate_identity_is_stable(self) -> None:
        self.assertEqual(
            GATE_ID,
            "mobile-ios-simulator-layout-accessibility-e2e",
        )

    def test_acceptance_contract_trace_requires_gate(self) -> None:
        acceptance_root = Path(__file__).resolve().parents[2]
        feature = json.loads(
            (
                acceptance_root
                / "features/mobile-native-accessibility-performance.yaml"
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
            if item["id"] == "mobile-native-quality"
        )
        registry = json.loads(
            (acceptance_root / "registry.yaml").read_text(encoding="utf-8")
        )
        registry_rule = next(
            item
            for item in registry["rules"]
            if item["id"] == "mobile-ios-layout-runtime"
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
        self.assertEqual(
            registry_rule["features"],
            ["mobile-native-accessibility-performance"],
        )
        self.assertEqual(registry_rule["require"], [GATE_ID])
        self.assertIn(GATE_ID, catalog["gates"])
        self.assertEqual(
            catalog["gates"][GATE_ID]["environment"],
            "mobile-ios-layout-simulator",
        )
        self.assertEqual(
            catalog["gates"][GATE_ID]["provisioner"],
            "mobile-ios-layout-simulator",
        )
        self.assertIn(GATE_ID, plan["selected_gates"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
