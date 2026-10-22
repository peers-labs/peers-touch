from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.unified_client import secure_content_owner_zero


ROOT = Path(__file__).resolve().parents[4]


class SecureContentOwnerZeroTest(unittest.TestCase):
    def test_current_source_has_one_secure_content_semantic_owner(self) -> None:
        result = secure_content_owner_zero.validate_owner_zero(ROOT)

        self.assertEqual(result["forbiddenLegacySymbols"], 0)
        self.assertEqual(result["manualMobileUploadOwners"], 0)
        self.assertEqual(result["portableCoreHostImports"], 0)
        self.assertEqual(
            result["canonicalDeclarations"],
            len(secure_content_owner_zero.CANONICAL_DECLARATIONS),
        )

    def test_deleted_worker_fails_closed(self) -> None:
        with self.source_copy() as root:
            worker = (
                root
                / "apps/mobile/src-tauri/src/secure_content/worker.rs"
            )
            worker.write_text("pub struct PrivateSocialWorker;\n", encoding="utf-8")

            with self.assertRaisesRegex(GateError, "deleted Secure Content"):
                secure_content_owner_zero.validate_owner_zero(root)

    def test_manual_mobile_chunk_loop_fails_closed(self) -> None:
        with self.source_copy() as root:
            social = root / "apps/mobile/src-tauri/src/social/mod.rs"
            social.write_text(
                social.read_text(encoding="utf-8")
                + "\nfn bypass() { let _ = put_private_object_chunk; }\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "manual object-transfer"):
                secure_content_owner_zero.validate_owner_zero(root)

    def test_duplicate_operation_owner_fails_closed(self) -> None:
        with self.source_copy() as root:
            runtime = (
                root
                / "apps/mobile/src-tauri/src/secure_content/runtime.rs"
            )
            runtime.write_text(
                runtime.read_text(encoding="utf-8")
                + "\npub fn complete_operation() {}\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "canonical ownership"):
                secure_content_owner_zero.validate_owner_zero(root)

    def test_missing_core_consumer_fails_closed(self) -> None:
        with self.source_copy() as root:
            object_runtime = (
                root
                / "apps/mobile/src-tauri/src/secure_content/object_runtime.rs"
            )
            object_runtime.write_text(
                object_runtime.read_text(encoding="utf-8").replace(
                    "ObjectTransferWorker",
                    "RetiredTransferWorker",
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "bypass"):
                secure_content_owner_zero.validate_owner_zero(root)

    def test_mobile_private_comment_operation_bypass_fails_closed(self) -> None:
        with self.source_copy() as root:
            private_comment = (
                root
                / "apps/mobile/src-tauri/src/secure_content/private_comment.rs"
            )
            private_comment.write_text(
                private_comment.read_text(encoding="utf-8").replace(
                    "acquire_comment_submission",
                    "dispatch_comment_without_core_operation",
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "bypass"):
                secure_content_owner_zero.validate_owner_zero(root)

    def source_copy(self) -> "_TemporaryRoot":
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        for relative in (
            Path("packages/secure-content-core"),
            Path("apps/desktop/src-tauri/src/secure_content"),
            Path("apps/desktop/src-tauri/src/social"),
            Path("apps/mobile/src-tauri/src/secure_content"),
            Path("apps/mobile/src-tauri/src/social"),
        ):
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(
                ROOT / relative,
                destination,
                ignore=shutil.ignore_patterns("target"),
            )
        destination = root / secure_content_owner_zero.INVENTORY_PATH
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / secure_content_owner_zero.INVENTORY_PATH, destination)
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
