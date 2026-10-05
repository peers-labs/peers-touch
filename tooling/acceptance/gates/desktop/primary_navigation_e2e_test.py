from __future__ import annotations

import json
import unittest

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.provisioners import (
    DesktopPrimaryNavigationNativeProvisioner,
    get_provisioner,
)


ENVIRONMENT_ID = "desktop-primary-navigation-native"
GATE_ID = "desktop-primary-navigation-e2e"


class DesktopPrimaryNavigationAcceptanceTests(unittest.TestCase):
    def test_environment_resolves_registered_native_provisioner(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / f"{ENVIRONMENT_ID}.yaml"
        )

        provisioner = get_provisioner(contract)

        self.assertIsInstance(
            provisioner,
            DesktopPrimaryNavigationNativeProvisioner,
        )
        self.assertEqual(
            [(client.id, client.runtime) for client in contract.clients],
            [("alice", "native-tauri")],
        )
        self.assertEqual(
            contract.clients[0].required_service_roles,
            ("station",),
        )

    def test_gate_declares_native_runtime_cell(self) -> None:
        gates = json.loads(
            (ENVIRONMENTS_DIR.parent / "gates.yaml").read_text(
                encoding="utf-8"
            )
        )["gates"]

        gate = gates[GATE_ID]
        self.assertEqual(gate["environment"], ENVIRONMENT_ID)
        self.assertEqual(gate["provisioner"], ENVIRONMENT_ID)
        self.assertEqual(
            gate["requiredRuntimeCells"],
            ["desktop-macos-native"],
        )
        self.assertEqual(gate["tier"], "env-evidence")

    def test_journey_uses_native_process_input_and_screenshot_evidence(
        self,
    ) -> None:
        source = (
            ENVIRONMENTS_DIR.parent
            / "gates"
            / "desktop"
            / "primary_navigation_e2e.py"
        ).read_text(encoding="utf-8")

        for contract in (
            "resolve_native_desktop_runtime",
            "create_bound_session",
            "adapter.post_mouse",
            "native_adapter.capture_screenshot",
            "desktop-primary-navigation-native-screenshot",
            "official_note_applet_launchable",
            "selected_only_stops_hidden_cron_polling",
            "command_palette_uses_one_global_overlay",
            "my_files_controls_available_in_settings",
            "channel_management_controls_available_in_settings",
        ):
            with self.subTest(contract=contract):
                self.assertIn(contract, source)
        self.assertNotIn("chromium", source.lower())
        self.assertNotIn("playwright", source.lower())


if __name__ == "__main__":
    unittest.main()
