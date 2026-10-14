from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.core import ENVIRONMENTS_DIR
from tooling.acceptance.gates.desktop.shell_tray_e2e import (
    ASSET_PATH,
    CAPABILITY_ID,
    GATE_ID,
    inspect_rgba_png,
    main,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
SOURCE_PATH = Path(__file__).with_name("shell_tray_e2e.py")


class DesktopShellTrayGateTests(unittest.TestCase):
    def test_asset_is_the_accepted_retina_template_png(self) -> None:
        inspection = inspect_rgba_png(ASSET_PATH)

        self.assertEqual(
            (inspection["width"], inspection["height"]),
            (88, 36),
        )
        self.assertTrue(inspection["transparent"])
        self.assertTrue(inspection["opaque"])
        self.assertTrue(inspection["antialiased"])

    def test_gate_is_attach_only_and_uses_parent_capability(self) -> None:
        source = SOURCE_PATH.read_text(encoding="utf-8")

        self.assertIn("EphemeralGateClient.from_environment()", source)
        self.assertIn("with client:", source)
        self.assertIn("DesktopShellTrayGate(client).execute()", source)
        self.assertIn(CAPABILITY_ID, source)
        for forbidden in (
            "import AppKit",
            "import Quartz",
            "subprocess.",
            "Popen(",
            "tauri build",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)

    def test_main_closes_ephemeral_client_after_gate_execution(self) -> None:
        events: list[str] = []
        client = mock.MagicMock()
        client.__enter__.side_effect = lambda: events.append("enter")
        client.__exit__.side_effect = lambda *_: events.append("exit")
        gate = mock.Mock()
        gate.execute.side_effect = lambda: events.append("execute") or 0

        with (
            mock.patch(
                "tooling.acceptance.gates.desktop.shell_tray_e2e."
                "EphemeralGateClient.from_environment",
                return_value=client,
            ),
            mock.patch(
                "tooling.acceptance.gates.desktop.shell_tray_e2e."
                "DesktopShellTrayGate",
                return_value=gate,
            ) as gate_type,
        ):
            self.assertEqual(main(), 0)

        gate_type.assert_called_once_with(client)
        self.assertEqual(events, ["enter", "execute", "exit"])

    def test_catalog_declares_native_cell_and_ephemeral_capability(self) -> None:
        gates = json.loads(
            (ENVIRONMENTS_DIR.parent / "gates.yaml").read_text(
                encoding="utf-8"
            )
        )["gates"]
        gate = gates[GATE_ID]

        self.assertEqual(gate["environment"], "desktop-shell-native")
        self.assertEqual(gate["provisioner"], "desktop-shell-native")
        self.assertEqual(
            gate["requiredRuntimeCells"],
            ["desktop-macos-native"],
        )
        self.assertEqual(gate["ephemeralCapabilities"], [CAPABILITY_ID])
        self.assertEqual(
            gate["argv"],
            [
                "python3",
                "-m",
                "tooling.acceptance.gates.desktop.shell_tray_e2e",
            ],
        )

    def test_environment_declares_no_station_or_credentials(self) -> None:
        contract = json.loads(
            (
                ENVIRONMENTS_DIR / "desktop-shell-native.yaml"
            ).read_text(encoding="utf-8")
        )

        self.assertEqual(contract["services"], {})
        self.assertEqual(contract["fixtures"], [])
        self.assertEqual(contract["credentials"], [])
        self.assertEqual(
            contract["clients"][0]["required_service_roles"],
            [],
        )


if __name__ == "__main__":
    unittest.main()
