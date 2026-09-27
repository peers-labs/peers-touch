from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.gates.chat.lifecycle_tree_zero_reference import (
    EXPECTED_DIMENSIONS,
    scan_repository,
)


class LifecycleTreeZeroReferenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.inventory_path = self.root / "legacy-inventory.json"
        self.dimension_roots = {
            "tracked-source": ["src"],
            "tauri-registry": ["tauri"],
            "http-gateway-registry": ["gateway"],
            "compiled-proto-descriptor": ["proto"],
            "generated-manifest": ["generated"],
            "mixed-client-runtime-trace": ["trace"],
            "store-schema-table": ["store"],
            "test-fixture-script": ["tests"],
            "current-source-doc": ["docs/current.md"],
        }
        for roots in self.dimension_roots.values():
            for root in roots:
                path = self.root / root
                if path.suffix:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("canonical\n", encoding="utf-8")
                else:
                    path.mkdir(parents=True, exist_ok=True)
                    (path / "canonical.ts").write_text(
                        "const canonical = true;\n", encoding="utf-8"
                    )

    def inventory(self, **overrides: object) -> dict[str, object]:
        value: dict[str, object] = {
            "kind": "peers-touch-chat-legacy-inventory",
            "schemaVersion": 1,
            "baselineCommit": "test",
            "deletedPaths": [],
            "forbiddenImports": ["friend_chat_pb"],
            "forbiddenIdentifiers": ["local_chat_store"],
            "forbiddenRoutes": ["/group-chat/list"],
            "forbiddenCommands": ["group_chat_list_groups"],
            "forbiddenLegacyTables": ["chat_messages"],
            "dimensionRoots": self.dimension_roots,
            "negativeAssertionPaths": [],
            "compatibilityIdentifierRoots": ["src"],
            "forbiddenCompatibilityPathSegments": ["legacy"],
            "forbiddenCompatibilityIdentifierSuffixes": ["_old"],
            "requiredDimensions": list(EXPECTED_DIMENSIONS),
        }
        value.update(overrides)
        self.inventory_path.write_text(
            json.dumps(value), encoding="utf-8"
        )
        return value

    def write(self, relative_path: str, content: str) -> None:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def test_clean_inventory_covers_every_required_dimension(self) -> None:
        self.inventory()

        result = scan_repository(self.root, self.inventory_path)

        self.assertTrue(result.passed)
        self.assertEqual(set(result.dimensions), set(EXPECTED_DIMENSIONS))
        self.assertTrue(all(item.files_scanned > 0 for item in result.dimensions.values()))

    def test_declared_deleted_path_is_a_violation(self) -> None:
        self.write("src/removed.ts", "const value = true;\n")
        self.inventory(deletedPaths=["src/removed.ts"])

        result = scan_repository(self.root, self.inventory_path)

        violations = result.dimensions["tracked-source"].violations
        self.assertTrue(
            any(item.pattern_label == "declared deleted path exists" for item in violations)
        )

    def test_each_dimension_rejects_its_legacy_class(self) -> None:
        cases = {
            "src/legacy-route.ts": "/group-chat/list",
            "tauri/registry.rs": "group_chat_list_groups",
            "gateway/routes.go": 'const route = "/group-chat/list"',
            "proto/chat.proto": "friend_chat_pb",
            "generated/chat_pb.ts": "friend_chat_pb",
            "trace/mixed.py": "group_chat_list_groups",
            "store/schema.rs": "CREATE TABLE chat_messages",
            "tests/legacy_case.py": 'route = "/group-chat/list"',
            "docs/current.md": "Current route: /group-chat/list",
        }
        self.inventory()
        for relative_path, content in cases.items():
            self.write(relative_path, content)

        result = scan_repository(self.root, self.inventory_path)

        for dimension in EXPECTED_DIMENSIONS:
            with self.subTest(dimension=dimension):
                self.assertFalse(result.dimensions[dimension].passed)

    def test_required_dimension_contract_fails_closed(self) -> None:
        self.inventory(requiredDimensions=list(EXPECTED_DIMENSIONS[:-1]))

        result = scan_repository(self.root, self.inventory_path)

        self.assertFalse(result.passed)
        self.assertTrue(
            any(
                item.pattern_label == "required dimension contract mismatch"
                for item in result.dimensions["tracked-source"].violations
            )
        )

    def test_negative_assertion_path_is_explicitly_exempt(self) -> None:
        self.write("tests/negative.py", 'assert "/group-chat/list" not in source\n')
        self.inventory(negativeAssertionPaths=["tests/negative.py"])

        result = scan_repository(self.root, self.inventory_path)

        self.assertTrue(result.passed)

    def test_compatibility_path_and_identifier_are_rejected(self) -> None:
        self.write("src/legacy/adapter.ts", "const transport_old = true;\n")
        self.inventory()

        result = scan_repository(self.root, self.inventory_path)
        violations = result.dimensions["tracked-source"].violations

        self.assertTrue(
            any(
                item.pattern_label == "forbidden compatibility path segment"
                for item in violations
            )
        )
        self.assertTrue(
            any(
                item.pattern_label == "forbidden compatibility identifier suffix"
                for item in violations
            )
        )

    @mock.patch(
        "tooling.acceptance.gates.chat.lifecycle_tree_zero_reference.subprocess.run"
    )
    def test_untracked_source_is_scanned(self, run: mock.Mock) -> None:
        self.inventory()
        run.return_value = mock.Mock(
            returncode=0,
            stdout=b"src/untracked.ts\0",
        )
        self.write("src/untracked.ts", 'const route = "/group-chat/list";\n')

        result = scan_repository(self.root, self.inventory_path)

        self.assertIn("--others", run.call_args.args[0])
        self.assertIn("--exclude-standard", run.call_args.args[0])
        self.assertTrue(
            any(
                item.file == "src/untracked.ts"
                for item in result.dimensions["tracked-source"].violations
            )
        )


if __name__ == "__main__":
    unittest.main()
