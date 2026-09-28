from __future__ import annotations

import json
import unittest

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.provisioning import ProvisioningState
from tooling.acceptance.provisioners import (
    DesktopPrimaryNavigationBrowserProvisioner,
    get_provisioner,
)


ENVIRONMENT_ID = "desktop-primary-navigation-browser"
GATE_ID = "desktop-primary-navigation-e2e"


class DesktopPrimaryNavigationAcceptanceTests(unittest.TestCase):
    def test_environment_resolves_registered_provisioner(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / f"{ENVIRONMENT_ID}.yaml"
        )

        provisioner = get_provisioner(contract)

        self.assertIsInstance(
            provisioner,
            DesktopPrimaryNavigationBrowserProvisioner,
        )

    def test_provisioner_emits_clean_browser_runtime_identity(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / f"{ENVIRONMENT_ID}.yaml"
        )
        provisioner = DesktopPrimaryNavigationBrowserProvisioner(contract)
        provisioner._git_commit = lambda: "a" * 40
        provisioner._git_workspace_digest = lambda: "clean"

        manifest = provisioner.provision(GATE_ID)

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(manifest.profile_resolved, "desktop-browser-local")
        self.assertEqual(manifest.clients[0].runtime, "browser")
        self.assertEqual(manifest.clients[0].required_service_roles, ())

    def test_gate_declares_the_browser_provisioner(self) -> None:
        gates = json.loads(
            (ENVIRONMENTS_DIR.parent / "gates.yaml").read_text(encoding="utf-8")
        )["gates"]

        gate = gates[GATE_ID]
        self.assertEqual(gate["environment"], ENVIRONMENT_ID)
        self.assertEqual(gate["provisioner"], ENVIRONMENT_ID)

    def test_journey_covers_settings_controls_and_note_applet_launch(self) -> None:
        driver = (
            ENVIRONMENTS_DIR.parent
            / "gates"
            / "desktop"
            / "primary_navigation_e2e.mjs"
        ).read_text(encoding="utf-8")

        required_assertions = (
            "official_note_applet_launchable",
            "cron_jobs_controls_available_in_settings",
            "selected_only_stops_hidden_cron_polling",
            "command_palette_uses_one_global_overlay",
            "my_files_controls_available_in_settings",
            "channel_management_controls_available_in_settings",
        )
        for assertion in required_assertions:
            with self.subTest(assertion=assertion):
                self.assertIn(f"assertions.{assertion} = true", driver)


if __name__ == "__main__":
    unittest.main()
