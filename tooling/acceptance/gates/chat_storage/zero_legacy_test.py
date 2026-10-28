from __future__ import annotations

import json
import hashlib
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.gates.chat_storage.zero_legacy import (
    EXPECTED_DIMENSIONS,
    _report,
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
        report = _report("chat-storage-zero-legacy-e2e", result)
        self.assertEqual(
            report["artifactKind"],
            "acceptance-gate-evidence-report",
        )
        self.assertEqual(report["reportKind"], "chat-storage-zero-legacy")
        self.assertEqual(report["phase"], "CSG-06 Chat Storage Zero-Legacy Aggregate")
        self.assertEqual(report["bom"], ["CSG-G06"])
        self.assertEqual(report["spec"], ["chat-storage-governance"])
        self.assertEqual(report["gate"], "chat-storage-zero-legacy-e2e")

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
        report = _report("chat-storage-dead-contract-zero-e2e", result)
        self.assertEqual(report["phase"], "CSG-05 Chat Storage Legacy Hard Cut")
        self.assertEqual(report["bom"], ["CSG-G04"])
        self.assertEqual(report["spec"], ["chat-storage-conversation-clear"])
        self.assertEqual(report["gate"], "chat-storage-dead-contract-zero-e2e")

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

    def retirement_proof(self, relative_path: str, role: str = "schema-retirement") -> None:
        inventory = json.loads(self.inventory_path.read_text(encoding="utf-8"))
        inventory["retirementProofs"] = [{
            "file": relative_path,
            "sha256": hashlib.sha256((self.root / relative_path).read_bytes()).hexdigest(),
            "entryIds": ["LEGACY-A"],
            "role": role,
        }]
        self.inventory_path.write_text(json.dumps(inventory), encoding="utf-8")

    def test_reviewed_retirement_references_remain_in_report(self) -> None:
        self.inventory()
        path = "apps/station/schema.go"
        self.write(path, 'dropColumn("legacy_clear_field")\n')
        self.retirement_proof(path)

        result = scan_repository(self.root, self.inventory_path)

        self.assertTrue(result.passed)
        self.assertEqual(len(result.retirement_references), 1)
        report = _report("chat-storage-zero-legacy-e2e", result)
        self.assertEqual(report["retirementReferenceCount"], 1)
        self.assertEqual(report["retirementReferences"][0]["file"], path)
        self.assertEqual(report["dimensions"]["schema-backfill"]["retirementReferenceCount"], 1)

    def test_new_business_use_in_reviewed_file_fails_closed(self) -> None:
        self.inventory()
        path = "apps/station/schema.go"
        self.write(path, 'dropColumn("legacy_clear_field")\n')
        self.retirement_proof(path)
        self.write(path, 'dropColumn("legacy_clear_field")\nread("legacy_clear_field")\n')

        result = scan_repository(self.root, self.inventory_path)

        self.assertFalse(result.passed)
        self.assertFalse(result.retirement_references)
        self.assertEqual(len(result.violations), 3)
        self.assertEqual(result.violations[0].pattern, "retirement-proof-source")

    def test_removed_protection_and_missing_file_fail_closed(self) -> None:
        for missing in (False, True):
            with self.subTest(missing=missing):
                self.inventory()
                path = "apps/station/schema.go"
                self.write(path, 'dropColumn("legacy_clear_field")\n')
                self.retirement_proof(path)
                if missing:
                    (self.root / path).unlink()
                else:
                    self.write(path, "func noProtection() {}\n")
                result = scan_repository(self.root, self.inventory_path)
                self.assertFalse(result.passed)
                self.assertEqual(result.violations[0].pattern, "retirement-proof-source")

    def test_proof_never_covers_other_files_or_entries(self) -> None:
        self.inventory()
        path = "apps/station/schema.go"
        self.write(path, 'dropColumn("legacy_clear_field"); legacy_schema_reader()\n')
        self.retirement_proof(path)
        self.write("apps/mobile/src/runtime.ts", "legacy_clear_field()\n")

        result = scan_repository(self.root, self.inventory_path)

        self.assertFalse(result.passed)
        self.assertEqual(len(result.retirement_references), 1)
        self.assertEqual(len(result.violations), 2)
        self.assertEqual({item.entry_id for item in result.violations}, {"LEGACY-A", "LEGACY-B"})

    def test_owner_filter_does_not_inherit_other_task_proof_drift(self) -> None:
        self.inventory()
        path = "apps/station/schema.go"
        self.write(path, 'dropColumn("legacy_clear_field")\n')
        self.retirement_proof(path)
        self.write(path, "changed\n")

        result = scan_repository(self.root, self.inventory_path, owner_task="TASK-B")

        self.assertTrue(result.passed)

    def test_retirement_proof_contract_rejects_broad_or_invalid_exemptions(self) -> None:
        self.inventory()
        path = "apps/station/schema.go"
        self.write(path, 'dropColumn("legacy_clear_field")\n')
        self.retirement_proof(path)
        baseline = json.loads(self.inventory_path.read_text())
        for field, value in (
            ("file", "apps/*"), ("file", "../schema.go"),
            ("file", "/schema.go"), ("file", "outside/schema.go"),
            ("sha256", "*"), ("entryIds", ["UNKNOWN"]),
            ("entryIds", ["LEGACY-A", "LEGACY-A"]), ("role", "business-use"),
        ):
            with self.subTest(field=field, value=value):
                inventory = json.loads(json.dumps(baseline))
                inventory["retirementProofs"][0][field] = value
                self.inventory_path.write_text(json.dumps(inventory))
                if value == "apps/*":
                    self.assertFalse(scan_repository(self.root, self.inventory_path).passed)
                else:
                    with self.assertRaisesRegex(ValueError, "proof contract"):
                        scan_repository(self.root, self.inventory_path)


if __name__ == "__main__":
    unittest.main()
