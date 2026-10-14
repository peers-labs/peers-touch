from __future__ import annotations

import inspect
import json
import unittest

from tooling.acceptance.gates.station_access.node_connectivity_cluster_native_e2e import (
    RUNTIME_REUSE,
    NodeConnectivityClusterNativeGate,
    _window_session_identity,
)


class _Session:
    def invoke_app_result(self, command: str) -> dict[str, object]:
        if command != "acceptance_window_session_identity":
            raise AssertionError(command)
        return {
            "ok": True,
            "data": {
                "status": json.dumps(
                    {
                        "account_scope_sha256": "c" * 64,
                        "actor_ptid": "ptid:actor-a",
                        "session_binding_sha256": "b" * 64,
                        "session_id_sha256": "a" * 64,
                    }
                )
            },
        }


class NodeConnectivityClusterNativeGateTest(unittest.TestCase):
    def test_durable_scenario_provides_receiver_visible_proof(self) -> None:
        self.assertTrue(RUNTIME_REUSE.require_receiver_visible_proof)
        source = inspect.getsource(
            NodeConnectivityClusterNativeGate._durable_scenario
        )
        self.assertIn("SuiteRuntimeAction.UI_ACTION", source)
        self.assertIn("SuiteRuntimeAction.RECEIVER_ASSERTION", source)

    def test_window_session_identity_uses_redacted_stable_identifiers(
        self,
    ) -> None:
        identity = _window_session_identity(_Session())  # type: ignore[arg-type]

        self.assertEqual(identity["actor_ptid"], "ptid:actor-a")
        self.assertEqual(identity["account_scope_sha256"], "c" * 64)
        self.assertEqual(identity["session_binding_sha256"], "b" * 64)
        self.assertEqual(identity["session_id_sha256"], "a" * 64)


if __name__ == "__main__":
    unittest.main()
