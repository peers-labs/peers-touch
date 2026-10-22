from __future__ import annotations

import json
import os
import stat
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import ENVIRONMENTS_DIR
from tooling.acceptance.gates.desktop.linux_install_e2e import (
    DESKTOP_FILE_NAME,
    GATE_ID,
    inspect_installation,
    install_paths,
)


REPO_ROOT = Path(__file__).resolve().parents[4]


class LinuxDesktopInstallGateTests(unittest.TestCase):
    def test_installation_inspection_binds_source_and_xdg_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            paths = install_paths(Path(temporary))
            for name in (
                "appimage",
                "receipt",
                "launcher",
                "desktop_entry",
                "icon",
            ):
                paths[name].parent.mkdir(parents=True, exist_ok=True)
            source_commit = "a" * 40
            paths["appimage"].write_bytes(b"appimage")
            paths["receipt"].write_text(
                json.dumps({"sourceCommit": source_commit}),
                encoding="utf-8",
            )
            paths["launcher"].write_text(
                f"exec '{paths['appimage']}' \"$@\"\n",
                encoding="utf-8",
            )
            paths["desktop_entry"].write_text(
                "\n".join(
                    (
                        "[Desktop Entry]",
                        f'Exec="{paths["launcher"]}" %U',
                        "MimeType=x-scheme-handler/peers-touch-dev;",
                        f"X-Peers-Touch-Source-Commit={source_commit}",
                    )
                ),
                encoding="utf-8",
            )
            paths["icon"].write_bytes(b"icon")
            os.chmod(paths["appimage"], 0o755)
            os.chmod(paths["launcher"], 0o755)

            inspected = inspect_installation(paths, source_commit)

            self.assertTrue(inspected["sourceCommitMatches"])
            self.assertTrue(inspected["appimageExecutable"])
            self.assertTrue(inspected["launcherExecutable"])
            self.assertTrue(inspected["launcherTargetsAppImage"])
            self.assertTrue(inspected["desktopEntrySourceMatches"])
            self.assertTrue(inspected["desktopEntryRegistersDeepLink"])
            self.assertTrue(inspected["desktopEntryUsesLauncher"])
            self.assertGreater(inspected["appimageBytes"], 0)
            self.assertTrue(
                stat.S_IMODE(paths["appimage"].stat().st_mode)
                & stat.S_IXUSR
            )

    def test_catalog_and_domain_connect_the_linux_install_gate(self) -> None:
        gates = json.loads(
            (ENVIRONMENTS_DIR.parent / "gates.yaml").read_text(
                encoding="utf-8"
            )
        )["gates"]
        gate = gates[GATE_ID]
        self.assertEqual(gate["environment"], "local")
        self.assertEqual(gate["tier"], "env-evidence")
        self.assertEqual(
            gate["argv"],
            [
                "python3",
                "-m",
                "tooling.acceptance.gates.desktop.linux_install_e2e",
            ],
        )
        self.assertEqual(gate["initial_proof_status"], "UNPROVEN")

        domain = json.loads(
            (ENVIRONMENTS_DIR.parent / "domains" / "desktop-shell.yaml")
            .read_text(encoding="utf-8")
        )
        self.assertIn("desktop-linux-install-lifecycle", domain["capabilities"])

        capabilities = json.loads(
            (
                ENVIRONMENTS_DIR.parent
                / "capabilities"
                / "desktop-shell.yaml"
            ).read_text(encoding="utf-8")
        )["capabilities"]
        capability = next(
            item
            for item in capabilities
            if item["id"] == "desktop-linux-install-lifecycle"
        )
        self.assertEqual(
            capability["required_gates"],
            [GATE_ID],
        )
        self.assertEqual(
            capability["features"],
            ["desktop-linux-install"],
        )

    def test_desktop_file_name_matches_devctl_contract(self) -> None:
        self.assertEqual(
            DESKTOP_FILE_NAME,
            "com.peers.touch.desktop.dev.desktop",
        )


if __name__ == "__main__":
    unittest.main()
