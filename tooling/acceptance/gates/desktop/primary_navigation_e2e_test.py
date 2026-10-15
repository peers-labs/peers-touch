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
REPO_ROOT = ENVIRONMENTS_DIR.parents[2]


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

    def test_journey_supports_non_intrusive_and_native_input_evidence(
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
            "NativeInputMode.SEMANTIC_NON_INTRUSIVE",
            "session.semantic_click",
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

    def test_applet_open_selector_marks_the_interactive_button(self) -> None:
        source = (
            REPO_ROOT
            / "apps"
            / "desktop"
            / "src"
            / "pages"
            / "AppletsPage.tsx"
        ).read_text(encoding="utf-8")
        tile_start = source.index("function AppletIconTile")
        button_start = source.index("<button", tile_start)
        button_end = source.index(">", button_start)

        self.assertIn(
            "data-applet-open={info.manifest.id}",
            source[button_start:button_end],
        )
        self.assertEqual(
            source.count("data-applet-open={info.manifest.id}"),
            1,
        )

    def test_primary_navigation_selectors_mark_interactive_commands(
        self,
    ) -> None:
        source = (
            REPO_ROOT
            / "apps"
            / "desktop"
            / "src"
            / "components"
            / "AppSideNav.tsx"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "return cloneElement(children, { "
            "'data-pt-primary-nav': pageId });",
            source,
        )
        self.assertNotIn("<span data-pt-primary-nav", source)
        for anchor in (
            '<PrimaryNavAnchor pageId="search">',
            '<PrimaryNavAnchor pageId="chat">',
            "<PrimaryNavAnchor key={m.id} pageId={m.id}>",
            '<PrimaryNavAnchor pageId="settings">',
        ):
            with self.subTest(anchor=anchor):
                anchor_start = source.index(anchor)
                anchor_end = source.index(
                    "</PrimaryNavAnchor>",
                    anchor_start,
                )
                self.assertIn(
                    "<ActionIcon",
                    source[anchor_start:anchor_end],
                )


if __name__ == "__main__":
    unittest.main()
