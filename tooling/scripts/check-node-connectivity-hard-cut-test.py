from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("check-node-connectivity-hard-cut.py")
SPEC = importlib.util.spec_from_file_location("node_connectivity_hard_cut", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


class NodeConnectivityHardCutTest(unittest.TestCase):
    def test_clean_inventory_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "model/domain/federation/locator.proto"
            source.parent.mkdir(parents=True)
            source.write_text("message ActorLocatorRecord {}\n", encoding="utf-8")

            self.assertEqual(CHECK.violations(root), [])

    def test_retired_contract_and_path_fail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "model/domain/federation/locator.proto"
            source.parent.mkdir(parents=True)
            source.write_text("string inbox_relay_mounts = 4;\n", encoding="utf-8")
            retired = (
                root
                / "apps/station/frame/core/plugin/native/subserver/relay-client/client.go"
            )
            retired.parent.mkdir(parents=True)
            retired.write_text("package relayclient\n", encoding="utf-8")

            found = CHECK.violations(root)

            self.assertTrue(
                any("inbox_relay_mounts" in violation for violation in found)
            )
            self.assertTrue(any("retired path remains" in violation for violation in found))


if __name__ == "__main__":
    unittest.main()
