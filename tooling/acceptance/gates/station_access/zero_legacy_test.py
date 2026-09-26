from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.gates.station_access.zero_legacy import (
    EXPECTED_DIMENSIONS,
    forbidden_values_by_entry,
    scan_repository,
)


class StationAccessZeroLegacyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.inventory_path = (
            self.root
            / "docs"
            / "architecture"
            / "station-access-lifecycle"
            / "legacy-inventory.json"
        )
        self.inventory_path.parent.mkdir(parents=True)

    def inventory(self) -> dict[str, object]:
        value: dict[str, object] = {
            "kind": "peers-touch-legacy-inventory",
            "projectId": "SAL-test",
            "status": "complete-for-plan-baseline",
            "updatedAt": "2026-09-26",
            "dimensions": list(EXPECTED_DIMENSIONS),
            "scanRoots": [
                "apps/desktop",
                "apps/mobile",
                "apps/station",
                "model",
                "tooling/acceptance",
                "docs/client",
                "package.json",
            ],
            "ownerTasks": {"SAL-L01": "SAL-01"},
            "matchContract": "test",
            "rule": "test",
            "entries": [
                {
                    "id": "SAL-L01",
                    "concern": "legacy",
                    "symbols": ["Legacy" + "Login"],
                    "routes": ["/old/" + "login"],
                    "seedPaths": [],
                    "target": "delete",
                }
            ],
        }
        self.inventory_path.write_text(
            json.dumps(value),
            encoding="utf-8",
        )
        return value

    def write(self, relative_path: str, content: str) -> None:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def tracked(self, *paths: str) -> mock.Mock:
        return mock.Mock(
            returncode=0,
            stdout=b"\0".join(path.encode("utf-8") for path in paths) + b"\0",
        )

    def test_clean_inventory_covers_all_nine_dimensions(self) -> None:
        self.inventory()
        paths = (
            "apps/desktop/src/services/access.ts",
            "apps/station/frame/touch/actor_handler.go",
            "model/domain/access_gate/access_gate.proto",
            "apps/desktop/src-tauri/src/domain/storage/schema.rs",
            "apps/mobile/src/auth.test.ts",
            "tooling/acceptance/gates/station_access/gate.py",
            "docs/client/mobile/base.md",
            "package.json",
        )
        for relative_path in paths:
            self.write(relative_path, "canonical\n")
        with mock.patch(
            "tooling.acceptance.gates.station_access.zero_legacy.subprocess.run",
            return_value=self.tracked(*paths),
        ):
            result = scan_repository(self.root, self.inventory_path)

        self.assertTrue(result.passed)
        self.assertEqual(set(result.dimensions), set(EXPECTED_DIMENSIONS))
        self.assertTrue(
            all(item.files_scanned > 0 for item in result.dimensions.values())
        )

    def test_every_matching_dimension_reports_a_legacy_reference(self) -> None:
        self.inventory()
        cases = {
            "apps/desktop/src/legacy.ts": "Legacy" + "Login",
            "apps/station/frame/touch/legacy_handler.go": "/old/" + "login",
            "model/domain/access_gate/legacy.proto": "Legacy" + "Login",
            "apps/desktop/src-tauri/src/domain/storage/schema.rs": (
                "Legacy" + "Login"
            ),
            "apps/mobile/src/legacy.test.ts": "Legacy" + "Login",
            "tooling/acceptance/gates/station_access/legacy.py": (
                "Legacy" + "Login"
            ),
            "docs/client/mobile/legacy.md": "Legacy" + "Login",
            "package.json": "Legacy" + "Login",
        }
        for relative_path, content in cases.items():
            self.write(relative_path, content)
        with mock.patch(
            "tooling.acceptance.gates.station_access.zero_legacy.subprocess.run",
            return_value=self.tracked(*cases),
        ):
            result = scan_repository(self.root, self.inventory_path)

        for dimension in EXPECTED_DIMENSIONS:
            with self.subTest(dimension=dimension):
                self.assertFalse(result.dimensions[dimension].passed)

    def test_inventory_is_the_only_implicit_matcher_source(self) -> None:
        self.inventory()
        with mock.patch(
            "tooling.acceptance.gates.station_access.zero_legacy.subprocess.run",
            return_value=self.tracked(
                "docs/architecture/station-access-lifecycle/legacy-inventory.json"
            ),
        ):
            result = scan_repository(self.root, self.inventory_path)

        self.assertTrue(result.passed)

    def test_forbidden_values_are_grouped_by_inventory_owner(self) -> None:
        self.inventory()

        values = forbidden_values_by_entry(self.inventory_path)

        self.assertEqual(
            values,
            {"SAL-L01": ("Legacy" + "Login", "/old/" + "login")},
        )

    def test_untracked_source_is_scanned(self) -> None:
        self.inventory()
        relative_path = "apps/desktop/src/untracked.ts"
        self.write(relative_path, "Legacy" + "Login")
        with mock.patch(
            "tooling.acceptance.gates.station_access.zero_legacy.subprocess.run",
        ) as run:
            run.return_value = self.tracked(relative_path)
            result = scan_repository(self.root, self.inventory_path)

        self.assertIn("--others", run.call_args.args[0])
        self.assertTrue(
            any(item.file == relative_path for item in result.violations)
        )


if __name__ == "__main__":
    unittest.main()
