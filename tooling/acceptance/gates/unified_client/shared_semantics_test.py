from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.unified_client import shared_semantics


ROOT = Path(__file__).resolve().parents[4]


class UnifiedClientSharedSemanticsTest(unittest.TestCase):
    def test_current_source_has_one_owner_per_shared_semantic(self) -> None:
        result = shared_semantics.validate_shared_semantics(ROOT)

        self.assertEqual(result["duplicateLocalOwners"], 0)
        self.assertEqual(result["sharedHostImports"], 0)
        self.assertEqual(result["sharedPresentationLeaks"], 0)
        self.assertEqual(result["forkedMobileComponents"], 0)
        self.assertEqual(
            result["canonicalDeclarations"],
            len(shared_semantics.CANONICAL_DECLARATIONS),
        )

    def test_form_policy_in_shared_package_fails_closed(self) -> None:
        with self.source_copy() as root:
            source = root / "packages/client-chat-core/src/index.ts"
            source.write_text(
                source.read_text(encoding="utf-8")
                + "\nconst leakedSurface = 'mobile-main';\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "Presentation Policy"):
                shared_semantics.validate_shared_semantics(root)

    def test_local_storage_retry_owner_fails_closed(self) -> None:
        with self.source_copy() as root:
            source = (
                root / "apps/mobile/src/runtimes/chatStorageRuntime.ts"
            )
            source.write_text(
                source.read_text(encoding="utf-8")
                + "\nconst RECONCILE_INTERVAL_MS = 1000;\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "duplicate local"):
                shared_semantics.validate_shared_semantics(root)

    def test_missing_media_codec_consumer_fails_closed(self) -> None:
        with self.source_copy() as root:
            source = (
                root
                / "apps/desktop/src/components/moments/MomentComposer.tsx"
            )
            source.write_text(
                source.read_text(encoding="utf-8").replace(
                    "clientMediaEncryptionDescriptorFromAttachment",
                    "localMediaDescriptorCodec",
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(GateError, "bypasses canonical"):
                shared_semantics.validate_shared_semantics(root)

    def test_os_specific_mobile_react_fork_fails_closed(self) -> None:
        with self.source_copy() as root:
            fork = root / "apps/mobile/src/pages/Chat.android.tsx"
            fork.parent.mkdir(parents=True, exist_ok=True)
            fork.write_text("export const ChatAndroid = null;\n", encoding="utf-8")

            with self.assertRaisesRegex(GateError, "forked Mobile React"):
                shared_semantics.validate_shared_semantics(root)

    def source_copy(self) -> "_TemporaryRoot":
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        for relative in shared_semantics.SHARED_ROOTS:
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(ROOT / relative, destination)
        for relative in (
            *shared_semantics.REQUIRED_CONSUMERS.keys(),
            *shared_semantics.FORM_POLICY_FILES.keys(),
            shared_semantics.REGISTRY_PATH,
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
