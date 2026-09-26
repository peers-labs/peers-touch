from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.gates.chat_storage.zero_legacy import (
    EXPECTED_DIMENSIONS,
    scan_repository,
)


class ChatStorageZeroLegacyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.inventory_path = self.root / "inventory.json"

    def write(self, relative_path: str, content: str) -> None:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def inventory(self) -> None:
        self.inventory_path.write_text(
            json.dumps(
                {
                    "dimensions": list(EXPECTED_DIMENSIONS),
                    "scanRoots": ["apps", "docs", "tooling"],
                    "ownerTasks": {
                        "LEGACY-A": "TASK-A",
                        "LEGACY-B": "TASK-B",
                    },
                    "entries": [
                        {
                            "id": "LEGACY-A",
                            "symbols": ["legacy_clear_field"],
                            "routes": [],
                        },
                        {
                            "id": "LEGACY-B",
                            "symbols": ["legacy_schema_reader"],
                            "routes": ["/legacy/storage"],
                        },
                    ],
                }
            ),
            encoding="utf-8",
        )

    def test_clean_inventory_passes(self) -> None:
        self.inventory()
        self.write("apps/mobile/src/runtime.ts", "const current = true;\n")

        result = scan_repository(self.root, self.inventory_path)

        self.assertTrue(result.passed)
        self.assertEqual(set(result.dimensions), set(EXPECTED_DIMENSIONS))

    def test_owner_task_filter_scans_only_its_entries(self) -> None:
        self.inventory()
        self.write(
            "apps/mobile/src/runtime.ts",
            "const legacy_clear_field = true;\n"
            "const legacy_schema_reader = true;\n",
        )

        result = scan_repository(
            self.root,
            self.inventory_path,
            owner_task="TASK-A",
        )

        self.assertFalse(result.passed)
        self.assertEqual(
            {violation.entry_id for violation in result.violations},
            {"LEGACY-A"},
        )

    def test_untracked_test_and_docs_references_are_classified(self) -> None:
        self.inventory()
        self.write(
            "tooling/acceptance/gates/check_test.py",
            "value = 'legacy_schema_reader'\n",
        )
        self.write("docs/current.md", "Route: /legacy/storage\n")

        result = scan_repository(self.root, self.inventory_path)

        self.assertEqual(len(result.violations), 2)
        self.assertEqual(
            {violation.dimension for violation in result.violations},
            {"test-fixture-mock", "docs-locales-prototype"},
        )

    def test_inventory_contract_fails_closed(self) -> None:
        self.inventory_path.write_text(
            json.dumps(
                {
                    "dimensions": list(EXPECTED_DIMENSIONS[:-1]),
                    "scanRoots": ["apps"],
                    "ownerTasks": {},
                    "entries": [],
                }
            ),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(ValueError, "dimensions changed"):
            scan_repository(self.root, self.inventory_path)


if __name__ == "__main__":
    unittest.main()
