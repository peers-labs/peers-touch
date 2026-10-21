from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
CATALOG_PATH = ROOT / "tooling" / "acceptance" / "gates.yaml"
REGISTRY_PATH = (
    ROOT
    / "docs"
    / "architecture"
    / "engineering"
    / "architecture-governance"
    / "architecture-modules.json"
)
AGGREGATE_GATE = "unified-client-architecture-aggregate"
HOST_GATES = {
    "unified-client-android-host-e2e": "android_host_e2e",
    "unified-client-ios-host-e2e": "ios_host_e2e",
}


class UnifiedClientBaselineContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = json.loads(
            CATALOG_PATH.read_text(encoding="utf-8")
        )["gates"]
        self.registry = json.loads(
            REGISTRY_PATH.read_text(encoding="utf-8")
        )

    def test_all_plan_gate_identities_are_registered(self) -> None:
        expected = {*HOST_GATES, AGGREGATE_GATE}

        self.assertTrue(expected <= set(self.catalog))
        for gate_id, module in HOST_GATES.items():
            definition = self.catalog[gate_id]
            with self.subTest(gate_id=gate_id):
                self.assertEqual(definition["environment"], "mobile-native")
                self.assertEqual(definition["tier"], "env-evidence")
                self.assertEqual(definition["provisioner"], "mobile-native")
                self.assertEqual(
                    definition["argv"],
                    ["python3", "-m", f"tooling.acceptance.gates.mobile.{module}",
                     "--reuse-suite-runtime"],
                )
                platform = "android" if module == "android_host_e2e" else "ios"
                self.assertEqual(
                    definition["requiredRuntimeCells"], [f"mobile-{platform}-native"],
                )
                self.assertEqual(
                    definition["ephemeralCapabilities"], ["mobile.native.appium-session"],
                )

    def test_aggregate_is_local_and_never_selects_a_provisioner(self) -> None:
        definition = self.catalog[AGGREGATE_GATE]

        self.assertEqual(
            definition["command"],
            "python3 -m "
            "tooling.acceptance.gates.unified_client."
            "architecture_aggregate",
        )
        self.assertEqual(definition["environment"], "local")
        self.assertEqual(definition["tier"], "ci-cheap")
        self.assertNotIn("provisioner", definition)
        self.assertNotIn("requiredRuntimeCells", definition)

    def test_shared_dependencies_have_one_classified_capability(self) -> None:
        capabilities = {
            capability["id"]: capability
            for module in self.registry["modules"]
            for capability in module["capabilities"]
        }
        expected_layers = {
            "client.chat.headless": "shared-ts-core",
            "client.media-security.headless": "shared-ts-core",
            "client.storage.headless": "shared-ts-core",
            "client.messaging.portable-core": "portable-rust-core",
            "client.secure-content.portable-core": "portable-rust-core",
            "client.station-trust.portable-core": "portable-rust-core",
            "relay.transport.circuit": "portable-rust-core",
        }

        for capability_id, expected_layer in expected_layers.items():
            with self.subTest(capability_id=capability_id):
                self.assertEqual(
                    capabilities[capability_id]["reuseLayer"],
                    expected_layer,
                )


if __name__ == "__main__":
    unittest.main()
