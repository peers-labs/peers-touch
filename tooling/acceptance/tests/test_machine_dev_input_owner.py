"""MachineDev input ownership includes real fixture ports and exact commands."""

from __future__ import annotations

import errno
import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.input_owners.machine_dev_toolchain import (
    COMMAND, GATE_ID, OWNER_ID, fixture_inputs, machine_dev_observation,
)


ROOT = Path(__file__).resolve().parents[3]


class MachineDevInputOwnerTest(unittest.TestCase):
    def context(self, **extra):
        return {
            "gate": {"id": GATE_ID, "command": COMMAND, **extra},
            "source": {"commit": "candidate"}, "contextDigest": "candidate",
        }

    def test_changed_command_or_foreign_gate_rejects_before_observation(self):
        for extra in ({"id": "foreign"}, {"command": COMMAND + " --foreign"}):
            with self.subTest(extra=extra), patch(
                "tooling.acceptance.input_owners.machine_dev_toolchain.node_source_observation",
            ) as observe:
                with self.assertRaises(ValueError):
                    machine_dev_observation(self.context(**extra), root=ROOT)
                observe.assert_not_called()

    def test_product_equipment_remains_outside_the_self_check_owner(self):
        for extra in (
            {"environment": "live"}, {"provisioner": "runtime"},
            {"requiredRuntimeCells": ["native"]},
            {"ephemeralCapabilities": ["runtime"]},
        ):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                machine_dev_observation(self.context(**extra), root=ROOT)

    @unittest.skipUnless(sys.platform == "darwin", "macOS MachineDev owner")
    def test_real_port_drift_changes_identity_and_preserves_the_listener(self):
        before = fixture_inputs(ROOT)
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.addCleanup(listener.close)
        port = None
        for item in before["ports"][1:]:
            if item["listening"]:
                continue
            try:
                listener.bind(("127.0.0.1", item["port"]))
            except OSError as error:
                if error.errno == errno.EADDRINUSE:
                    continue
                raise
            port = item["port"]
            break
        self.assertIsNotNone(port, "No canonical fixture port is available")
        listener.listen()
        during = fixture_inputs(ROOT)
        self.assertTrue(next(
            item["listening"] for item in during["ports"] if item["port"] == port
        ))
        baseline = {
            "artifactKind": "acceptance-gate-input-observation",
            "gateId": GATE_ID, "ownerId": "node-source-toolchain",
            "inputs": {axis: "a" * 64 for axis in (
                "runtime", "provider", "oracle", "actionPlan", "fixture",
            )},
        }
        with patch(
            "tooling.acceptance.input_owners.machine_dev_toolchain.node_source_observation",
            side_effect=lambda *args, **kwargs: {
                **baseline, "inputs": dict(baseline["inputs"]),
            },
        ), patch(
            "tooling.acceptance.input_owners.machine_dev_toolchain.fixture_inputs",
            side_effect=[before, during],
        ):
            first = machine_dev_observation(self.context(), root=ROOT)
            second = machine_dev_observation(self.context(), root=ROOT)
        self.assertEqual(second["ownerId"], OWNER_ID)
        self.assertNotEqual(first["inputs"]["oracle"], second["inputs"]["oracle"])
        self.assertNotEqual(first["inputs"]["fixture"], second["inputs"]["fixture"])
        self.assertEqual(first["inputs"]["runtime"], second["inputs"]["runtime"])
        # Observation neither closes nor takes ownership of the real listener.
        self.assertEqual(listener.getsockname()[1], port)
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            pass
        listener.close()
        after = fixture_inputs(ROOT)
        self.assertFalse(next(
            item["listening"] for item in after["ports"] if item["port"] == port
        ))


if __name__ == "__main__":
    unittest.main()
