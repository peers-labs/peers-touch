"""Candidate identity regressions: drift and build substitution fail closed."""

import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.core.errors import DriverError
from tooling.acceptance.core.runtime_cell import runtime_source_matches
from tooling.acceptance.drivers.native.runtime import LocalMacOSRuntimeBinding


class RuntimeSourceSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.source = {
            "commit": "a" * 40,
            "workspaceDigest": "sha256:" + "b" * 64,
            "canonicalWorktreeHash": "c" * 16,
        }

    def test_local_dirty_snapshot_matches_only_the_same_digest(self):
        self.assertTrue(runtime_source_matches(self.source, dict(self.source)))
        for field, value in (("commit", "d" * 40), ("workspaceDigest", "clean"),
                             ("workspaceDigest", "sha256:" + "e" * 64)):
            with self.subTest(field=field, value=value):
                self.assertFalse(runtime_source_matches(self.source, {**self.source, field: value}))
        self.assertFalse(runtime_source_matches({**self.source, "workspaceDigest": "dirty"}, self.source))

    def test_remote_runtime_cannot_claim_a_local_dirty_candidate(self):
        self.assertFalse(runtime_source_matches(
            self.source, {**self.source, "remoteCheckoutClean": True}, remote=True,
        ))
        clean = {**self.source, "workspaceDigest": "clean"}
        self.assertTrue(runtime_source_matches(
            clean, {**clean, "remoteCheckoutClean": True}, remote=True,
        ))
        self.assertFalse(runtime_source_matches(clean, clean, remote=True))

    def test_two_clients_consume_the_prepared_cell_without_building(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            binary = root / ".local" / "binary"
            binary.parent.mkdir()
            binary.write_bytes(b"candidate-binary")
            binary.chmod(0o755)
            manifest = {
                "artifactKind": "acceptance-runtime-cell-manifest",
                "cellId": "desktop-macos-native", "gateId": "synthetic-native",
                "runId": "prepared-cell", "state": "LEASED",
                "lease": {"ownerRunId": "prepared-cell"},
                "platform": {"os": "macos"},
                "nativeAdapter": {"inputMode": "semantic-nonintrusive"},
                "source": {
                    **self.source, "mode": "local-worktree",
                    "artifactKind": "acceptance-binary",
                    "canonicalRoot": str(root), "binaryPath": str(binary),
                    "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
                },
            }
            manifest_path = root / "cell.json"
            manifest_path.write_text(json.dumps(manifest))
            environment = {
                "PT_ACCEPTANCE_RUNTIME_CELL_MANIFEST": str(manifest_path),
                "PT_ACCEPTANCE_GATE_ID": "synthetic-native",
            }
            with patch.dict("os.environ", environment, clear=True), patch(
                "tooling.acceptance.drivers.native.runtime.sys.platform", "darwin",
            ), patch(
                "tooling.acceptance.drivers.native.runtime.REPO_ROOT", root,
            ), patch(
                "tooling.acceptance.drivers.native.runtime.source_identity",
                return_value=dict(self.source),
            ), patch(
                "tooling.acceptance.provisioners.desktop_acceptance_build.DesktopAcceptanceBuild",
                side_effect=AssertionError("A child must never build"),
            ) as build:
                binding = LocalMacOSRuntimeBinding()
                self.assertEqual(binding.runtime_identity(), manifest)
                self.assertEqual(
                    binding.binary_identity()["workspaceDigest"],
                    self.source["workspaceDigest"],
                )
                clients = []
                for index, role in enumerate(("alice", "bob")):
                    clients.append(binding._create_session(role, {
                        "worktree": str(root), "webdriver_port": 4445 + index,
                        "gateway_port": 3030 + index, "profile": role,
                        "storage_root": str(root / role),
                    }, {}))
                build.assert_not_called()
                self.assertEqual(
                    clients[0].launcher.app_binary, clients[1].launcher.app_binary,
                )
                self.assertEqual(binding.runtime_identity(), manifest)
                identity = binding.binary_identity()
                self.assertEqual(identity["workspaceDigest"], self.source["workspaceDigest"])
                for field, value in (
                    ("commit", "foreign"), ("workspaceDigest", "clean"),
                    ("binarySha256", "d" * 64), ("canonicalRoot", "/foreign"),
                    ("binaryPath", ""), ("binaryPath", str(root / "foreign")),
                ):
                    rejected = copy.deepcopy(manifest)
                    rejected["source"][field] = value
                    manifest_path.write_text(json.dumps(rejected))
                    with self.subTest(field=field), self.assertRaises(DriverError):
                        LocalMacOSRuntimeBinding()
                manifest_path.write_text(json.dumps(manifest))
                with patch.dict("os.environ", {"PT_ACCEPTANCE_GATE_ID": "foreign"}):
                    with self.assertRaises(DriverError):
                        LocalMacOSRuntimeBinding()
                for field, value in (
                    ("lease", {"ownerRunId": "foreign"}),
                    ("platform", {"os": "linux"}),
                    ("nativeAdapter", {"inputMode": "exclusive-native-input"}),
                ):
                    rejected = {**manifest, field: value}
                    manifest_path.write_text(json.dumps(rejected))
                    with self.subTest(field=field), self.assertRaises(DriverError):
                        LocalMacOSRuntimeBinding()
                manifest_path.write_text(json.dumps(manifest))
                binary.write_bytes(b"replacement")
                with self.assertRaisesRegex(DriverError, "binary changed"):
                    binding.binary_identity()

    def test_acceptance_binding_requires_prepared_cell_before_launch(self):
        with patch.dict("os.environ", {}, clear=True), patch(
            "tooling.acceptance.drivers.native.runtime.sys.platform", "darwin",
        ), patch(
            "tooling.acceptance.drivers.native.runtime.source_identity",
            return_value=dict(self.source),
        ):
            with self.assertRaisesRegex(DriverError, "prepared Runtime Cell"):
                LocalMacOSRuntimeBinding()

    def test_runtime_cannot_relabel_changed_source_at_observation_time(self):
        with patch.dict("os.environ", {"PT_ACCEPTANCE_NATIVE_DEV": "1"}), patch(
            "tooling.acceptance.drivers.native.runtime.source_identity",
            return_value=dict(self.source),
        ) as inspect:
            binding = LocalMacOSRuntimeBinding()
            inspect.return_value = {**self.source, "workspaceDigest": "sha256:" + "d" * 64}
            with self.assertRaisesRegex(DriverError, "source changed"):
                binding.runtime_identity()

    def test_client_launch_rejects_an_unselected_worktree(self):
        with patch.dict("os.environ", {"PT_ACCEPTANCE_NATIVE_DEV": "1"}), patch(
            "tooling.acceptance.drivers.native.runtime.source_identity",
            return_value=dict(self.source),
        ):
            binding = LocalMacOSRuntimeBinding()
            with self.assertRaisesRegex(DriverError, "selected candidate worktree"):
                binding._create_session("alice", {"worktree": "/unselected/worktree"}, {})


if __name__ == "__main__":
    unittest.main()
