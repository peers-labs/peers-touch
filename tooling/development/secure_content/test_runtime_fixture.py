from __future__ import annotations

import hashlib
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from typing import Mapping

from tooling.acceptance.core import EphemeralCapabilityBlocked
from tooling.development.secure_content.runtime_fixture import (
    RuntimeFixtureBinding,
    RuntimeFixtureCapabilityHandler,
    RuntimeFixtureOwner,
)


class RuntimeFixtureOwnerTest(unittest.TestCase):
    def test_owner_publishes_source_bound_handles_and_executes_actions(
        self,
    ) -> None:
        calls: list[tuple[str, Mapping[str, object]]] = []
        identity_digest = hashlib.sha256(b"mobile-runtime").hexdigest()

        def action(
            operation: str,
            payload: Mapping[str, object],
            deadline_monotonic: float,
            cancellation: threading.Event,
        ) -> Mapping[str, object]:
            self.assertGreater(deadline_monotonic, time.monotonic())
            self.assertFalse(cancellation.is_set())
            calls.append((operation, payload))
            return {"completed": True}

        owner = RuntimeFixtureOwner(
            source_checkpoint="a" * 40,
            run_id="runtime-fixture-test",
            fixture_set_id="secure-content-mobile-matrix",
            bindings=(
                RuntimeFixtureBinding(
                    capability="secure-content-mobile-matrix",
                    owner="mobile-product-fixture-owner",
                    opaque_id="mobile-matrix-handle",
                    expected_identity_digest=identity_digest,
                    operations=frozenset(
                        {"publish-states", "read-states"}
                    ),
                    action=action,
                ),
            ),
        )
        manifest = owner.manifest()
        handle = manifest["handles"][0]
        self.assertEqual(
            "secure-content-mobile-matrix",
            handle["capability"],
        )
        self.assertEqual("a" * 40, manifest["source_checkpoint"])

        context, client = owner.open_action_channel(
            workspace_id="b" * 16,
            gate_id="sc-dj-mobile-matrix",
            runtime_manifest_digests=("c" * 64,),
        )
        try:
            result = client.invoke(
                "secure-content-mobile-matrix",
                "publish-states",
                {
                    "handleId": "mobile-matrix-handle",
                    "expectedIdentityDigest": identity_digest,
                    "runtimeManifestDigest": "c" * 64,
                    "actionPayload": {"variant": "ios"},
                },
                timeout_seconds=1,
            )
        finally:
            client.close()
            context.quiesce()
            cleanup = context.close()

        self.assertEqual(
            [("publish-states", {"variant": "ios"})],
            calls,
        )
        self.assertTrue(result["outcome"]["completed"])
        self.assertEqual(
            identity_digest,
            result["outcome"]["fixtureIdentityDigest"],
        )
        self.assertEqual(64, len(result["acknowledgementDigest"]))
        self.assertTrue(cleanup.succeeded)

    def test_handler_rejects_action_supplied_conflicting_identity(self) -> None:
        binding = RuntimeFixtureBinding(
            capability="secure-content-mobile-matrix",
            owner="mobile-product-fixture-owner",
            opaque_id="mobile-matrix-handle",
            expected_identity_digest="d" * 64,
            operations=frozenset({"publish-states"}),
            action=lambda *_: {
                "completed": True,
                "fixtureIdentityDigest": "f" * 64,
            },
        )
        handler = RuntimeFixtureCapabilityHandler(
            binding,
            frozenset({"e" * 64}),
        )

        with self.assertRaisesRegex(
            EphemeralCapabilityBlocked,
            "outcome identity does not match",
        ):
            handler.invoke(
                "publish-states",
                {
                    "handleId": "mobile-matrix-handle",
                    "expectedIdentityDigest": "d" * 64,
                    "runtimeManifestDigest": "e" * 64,
                    "actionPayload": {"variant": "ios"},
                },
                deadline_monotonic=time.monotonic() + 1,
                cancellation=threading.Event(),
            )

    def test_action_failure_preserves_redacted_root_cause(self) -> None:
        def action(*_args: object) -> Mapping[str, object]:
            raise RuntimeError(
                "private Social first-use trust requires HTTPS; "
                "Authorization: Bearer secret-token"
            )

        binding = RuntimeFixtureBinding(
            capability="secure-content-mobile-matrix",
            owner="mobile-product-fixture-owner",
            opaque_id="mobile-matrix-handle",
            expected_identity_digest="d" * 64,
            operations=frozenset({"publish-states"}),
            action=action,
        )
        handler = RuntimeFixtureCapabilityHandler(
            binding,
            frozenset({"e" * 64}),
        )

        with self.assertRaises(EphemeralCapabilityBlocked) as raised:
            handler.invoke(
                "publish-states",
                {
                    "handleId": "mobile-matrix-handle",
                    "expectedIdentityDigest": "d" * 64,
                    "runtimeManifestDigest": "e" * 64,
                    "actionPayload": {"variant": "ios"},
                },
                deadline_monotonic=time.monotonic() + 1,
                cancellation=threading.Event(),
            )

        self.assertIn(
            "private Social first-use trust requires HTTPS",
            str(raised.exception),
        )
        self.assertNotIn("secret-token", str(raised.exception))

    def test_owner_writes_private_immutable_manifest(self) -> None:
        binding = RuntimeFixtureBinding(
            capability="chat-attachment-mobile",
            owner="mobile-product-fixture-owner",
            opaque_id="chat-mobile-handle",
            expected_identity_digest="d" * 64,
            operations=frozenset({"prepare-corpus"}),
            action=lambda *_: {"completed": True},
        )
        owner = RuntimeFixtureOwner(
            source_checkpoint="e" * 40,
            run_id="fixture-write-test",
            fixture_set_id="chat-mobile",
            bindings=(binding,),
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.json"
            owner.write_manifest(path)
            self.assertEqual(0o600, path.stat().st_mode & 0o777)
            self.assertEqual(
                owner.manifest(),
                json.loads(path.read_text(encoding="utf-8")),
            )
            with self.assertRaises(FileExistsError):
                owner.write_manifest(path)


if __name__ == "__main__":
    unittest.main()
