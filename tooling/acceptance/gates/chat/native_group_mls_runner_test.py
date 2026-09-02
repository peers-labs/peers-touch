from __future__ import annotations

import ast
import os
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch

from tooling.acceptance.core import GateError
from tooling.acceptance.core.evidence import new_report
from tooling.acceptance.gates.chat.native_group_mls_runner import (
    ACTORS,
    CLIENT_PORTS,
    NativeGroupMlsGate,
    REQUIRED_ASSERTIONS,
    SELECTORS,
)
from tooling.acceptance.gates.chat.native_support import (
    NativeClientLifecycleLedger,
)


RUNNER = Path(__file__).with_name("native_group_mls_runner.py")


class SyntheticRuntimeBinding:
    cell_id = "desktop-linux-native"

    def __init__(self) -> None:
        self.cleaned_sessions: tuple[Any, ...] = ()
        self.cleaned_specs: dict[str, dict[str, Any]] = {}

    def runtime_identity(self) -> dict[str, Any]:
        return {
            "artifactKind": "acceptance-runtime-cell-manifest",
            "cellId": self.cell_id,
            "gateId": NativeGroupMlsGate.gate_id,
            "runId": "cell-run-a",
            "state": "LEASED",
            "source": {
                "commit": "commit-a",
                "workspaceDigest": "clean",
                "remoteSourceDigest": "b" * 64,
                "remoteCheckoutClean": True,
                "binarySha256": "a" * 64,
            },
            "platform": {"imageDigest": "d" * 64},
            "transport": {
                "hostIdentitySha256": "e" * 64,
                "hostKeySha256": "f" * 64,
            },
        }

    def binary_identity(self) -> dict[str, str]:
        return {
            "path": "runtime-cell:desktop-linux-native:cell-run-a:bin",
            "sha256": "a" * 64,
            "sourceCommit": "commit-a",
        }

    def finalize_cleanup(
        self,
        sessions: list[Any],
        client_specs: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        self.cleaned_sessions = tuple(sessions)
        self.cleaned_specs = client_specs
        return {
            "portsReleased": True,
            "processesReleased": True,
            "storageReleased": True,
            "logsReleased": True,
            "cleanupErrors": [],
        }


class NativeGroupMlsRuntimeBindingTests(unittest.TestCase):
    def gate(self) -> tuple[NativeGroupMlsGate, SyntheticRuntimeBinding]:
        binding = SyntheticRuntimeBinding()
        gate = object.__new__(NativeGroupMlsGate)
        gate.manifest = {
            "source": {
                "commit": "commit-a",
                "workspaceDigest": "clean",
            },
            "services": {
                "station": {
                    "kind": "station",
                    "endpoint": "http://station",
                    "liveCommit": "commit-a",
                    "workspaceDigest": "clean",
                    "protocolDigest": "c" * 64,
                },
            },
        }
        gate.tested_commit = "commit-a"
        gate.runtime_binding = binding
        gate.runtime_instances = []
        gate.clients = {}
        gate.client_specs = {
            "alice": {},
            "bob": {},
            "charlie": {},
        }
        gate.client_lifecycles = NativeClientLifecycleLedger()
        gate.report = new_report(gate.gate_id)
        return gate, binding

    def test_linux_identity_and_cleanup_are_binding_owned(self) -> None:
        gate, binding = self.gate()

        identity = gate.source_identity({"build_commit": "commit-a"})
        cleanup = gate.cleanup_clients()

        self.assertEqual(identity["runtimeCell"]["cellId"], binding.cell_id)
        self.assertEqual(identity["binary"]["sha256"], "a" * 64)
        self.assertEqual(
            gate.report.runtime["runtimeCellRunId"],
            "cell-run-a",
        )
        self.assertEqual(binding.cleaned_specs, gate.client_specs)
        self.assertTrue(cleanup["storageReleased"])

    def test_runner_requires_runtime_cell_without_local_launcher_fallback(
        self,
    ) -> None:
        source = RUNNER.read_text(encoding="utf-8")
        tree = ast.parse(source)
        imported_names = {
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            for alias in node.names
        }

        self.assertIn("NativeDesktopRuntimeBinding", imported_names)
        self.assertIn("selected_native_runtime", imported_names)
        self.assertIn("native_runtime_source_identity", imported_names)
        self.assertIn(
            "runtime_binding: NativeDesktopRuntimeBinding | None",
            source,
        )
        self.assertIn(
            "if selected_cell and runtime_binding is None:",
            source,
        )
        self.assertIn(
            "if self.runtime_binding is None:",
            source,
        )
        self.assertIn("runtime_binding.create_bound_session(", source)
        self.assertIn("runtime_binding.finalize_cleanup(", source)
        self.assertNotIn("LocalTauriLauncher", imported_names)

    def test_logout_failure_still_stops_runtime_client(self) -> None:
        gate, _ = self.gate()
        client = Mock(
            profile="acceptance-charlie",
            gateway_port=3030,
        )
        client.is_alive.return_value = True
        gate.client_lifecycles.register(
            client,
            "ptid:v1:actor:charlie",
        )
        gate.client_lifecycles.mark_live(client)
        gate.client_lifecycles.mark_authenticated(client)

        with patch(
            "tooling.acceptance.gates.chat.native_support."
            "logout_native_client",
            side_effect=RuntimeError("logout failed"),
        ), self.assertRaisesRegex(RuntimeError, "logout failed"):
            gate.stop_authenticated_client(client)

        client.stop.assert_called_once_with()

    def test_selected_runtime_rejects_uninjected_construction(self) -> None:
        previous = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL")
        os.environ["PT_ACCEPTANCE_RUNTIME_CELL"] = "desktop-linux-native"
        try:
            with self.assertRaisesRegex(
                GateError,
                "requires injected runtime resources",
            ):
                NativeGroupMlsGate()
        finally:
            if previous is None:
                os.environ.pop("PT_ACCEPTANCE_RUNTIME_CELL", None)
            else:
                os.environ["PT_ACCEPTANCE_RUNTIME_CELL"] = previous

    def test_product_contract_constants_remain_unchanged(self) -> None:
        self.assertEqual(ACTORS, ("alice", "bob", "charlie"))
        self.assertEqual(
            CLIENT_PORTS,
            {"alice": 4445, "bob": 4446, "charlie": 4450},
        )
        self.assertEqual(
            REQUIRED_ASSERTIONS,
            {
                "native_runtime",
                "actor_isolation",
                "group_created",
                "member_added",
                "group_message_delivered",
                "member_removed",
            },
        )
        self.assertEqual(
            SELECTORS["group_manage"],
            "[data-chat-group-manage-members]",
        )


if __name__ == "__main__":
    unittest.main()
