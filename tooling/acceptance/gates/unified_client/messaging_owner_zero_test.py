from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.unified_client import messaging_owner_zero


ROOT = Path(__file__).resolve().parents[4]


class MessagingOwnerZeroTest(unittest.TestCase):
    def test_current_source_has_one_messaging_semantic_owner(self) -> None:
        result = messaging_owner_zero.validate_owner_zero(ROOT)

        self.assertEqual(result["forbiddenApplicationSymbols"], 0)
        self.assertEqual(result["parallelApplicationConsumers"], 0)
        self.assertEqual(result["portableCoreOsOwners"], 0)
        self.assertEqual(
            result["canonicalDeclarations"],
            len(messaging_owner_zero.CANONICAL_DECLARATIONS),
        )

    def test_deleted_desktop_owner_file_fails_closed(self) -> None:
        with self.source_copy() as root:
            legacy = (
                root
                / "apps"
                / "desktop"
                / "src-tauri"
                / "src"
                / "messaging"
                / "send.rs"
            )
            legacy.write_text("pub struct SendPreparer;\n", encoding="utf-8")

            with self.assertRaisesRegex(GateError, "deleted Desktop"):
                messaging_owner_zero.validate_owner_zero(root)

    def test_legacy_mobile_symbol_fails_closed(self) -> None:
        with self.source_copy() as root:
            lifecycle = (
                root
                / "apps"
                / "mobile"
                / "src-tauri"
                / "src"
                / "messaging"
                / "lifecycle.rs"
            )
            lifecycle.write_text(
                lifecycle.read_text(encoding="utf-8")
                + "\nstruct MobileOutboxStore;\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "legacy Messaging owner"):
                messaging_owner_zero.validate_owner_zero(root)

    def test_portable_core_os_import_fails_closed(self) -> None:
        with self.source_copy() as root:
            lifecycle = (
                root
                / "packages"
                / "messaging-core"
                / "src"
                / "engine"
                / "lifecycle.rs"
            )
            lifecycle.write_text(
                lifecycle.read_text(encoding="utf-8") + "\nuse std::fs;\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "native filesystem ownership"):
                messaging_owner_zero.validate_owner_zero(root)

    def test_parallel_mobile_conversation_consumer_fails_closed(self) -> None:
        with self.source_copy() as root:
            engine = (
                root
                / "apps"
                / "mobile"
                / "src-tauri"
                / "src"
                / "messaging"
                / "engine.rs"
            )
            engine.write_text(
                engine.read_text(encoding="utf-8")
                + "\nfn consume_conversation_mutation_event() {}\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "parallel Core consumer"):
                messaging_owner_zero.validate_owner_zero(root)

    def test_duplicate_core_declaration_fails_closed(self) -> None:
        with self.source_copy() as root:
            engine = (
                root
                / "apps"
                / "desktop"
                / "src-tauri"
                / "src"
                / "messaging"
                / "engine.rs"
            )
            engine.write_text(
                engine.read_text(encoding="utf-8")
                + "\npub struct DeliveryReceiptDispatcher;\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "declaration ownership"):
                messaging_owner_zero.validate_owner_zero(root)

    def test_member_authority_trait_adapter_bypass_fails_closed(self) -> None:
        with self.source_copy() as root:
            store = (
                root
                / "apps"
                / "desktop"
                / "src-tauri"
                / "src"
                / "messaging"
                / "store.rs"
            )
            store.write_text(
                store.read_text(encoding="utf-8").replace(
                    "MessagingStore::commit_member_authority_state",
                    "MessagingStore::commit_conversation_state",
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "canonical core"):
                messaging_owner_zero.validate_owner_zero(root)

    def source_copy(self) -> "_TemporaryRoot":
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        for relative in (
            Path("packages/messaging-core"),
            Path("packages/messaging-native-filesystem"),
            Path("apps/desktop/src-tauri/src/messaging"),
            Path("apps/mobile/src-tauri/src/messaging"),
        ):
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(
                ROOT / relative,
                destination,
                ignore=shutil.ignore_patterns("target"),
            )
        for relative in (
            Path("apps/desktop/src-tauri/Cargo.toml"),
            Path("apps/mobile/src-tauri/Cargo.toml"),
            messaging_owner_zero.INVENTORY_PATH,
        ):
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)
        return _TemporaryRoot(temporary, root)


class _TemporaryRoot:
    def __init__(
        self,
        temporary: tempfile.TemporaryDirectory[str],
        root: Path,
    ) -> None:
        self.temporary = temporary
        self.root = root

    def __enter__(self) -> Path:
        return self.root

    def __exit__(self, *_args: object) -> None:
        self.temporary.cleanup()


if __name__ == "__main__":
    unittest.main()
