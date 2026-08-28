from __future__ import annotations

import ast
import json
import os
import unittest
from pathlib import Path
from unittest.mock import Mock

from tooling.acceptance.core import GateError
from tooling.acceptance.core.evidence import new_report
from tooling.acceptance.gates.chat.native_support import (
    cleanup_preserving_primary_failure,
)
from tooling.acceptance.gates.chat.native_multi_device_runner import (
    NativeMultiDeviceGate,
)
from tooling.acceptance.gates.chat.native_typing_runner import NativeTypingGate


ROOT = Path(__file__).resolve().parents[4]
RUNNERS = {
    "typing": ROOT
    / "tooling/acceptance/gates/chat/native_typing_runner.py",
    "multi-device": ROOT
    / "tooling/acceptance/gates/chat/native_multi_device_runner.py",
}
ALL_MIGRATED_RUNNERS = (
    "contact_message_resilience_runner.py",
    "native_group_mls_runner.py",
    "native_interactions_runner.py",
    "native_multi_device_runner.py",
    "native_recovery_runner.py",
    "native_typing_runner.py",
)


class NativeRuntimeCellRunnerContractTest(unittest.TestCase):
    def source(self, runner: str) -> str:
        return RUNNERS[runner].read_text(encoding="utf-8")

    def assignment(self, runner: str, name: str):
        tree = ast.parse(self.source(runner))
        return next(
            ast.literal_eval(node.value)
            for node in tree.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name) and target.id == name
                for target in node.targets
            )
        )

    def test_selected_runtime_fails_closed_and_uses_binding(self) -> None:
        support = (
            ROOT / "tooling/acceptance/gates/chat/native_support.py"
        ).read_text(encoding="utf-8")
        self.assertIn("PT_ACCEPTANCE_RUNTIME_MANIFEST", support)
        self.assertIn("load_runtime_manifest(Path(raw_path), gate_id)", support)
        self.assertIn("ArtifactRef.from_dict(actor_ref)", support)
        self.assertIn("resolve_native_desktop_runtime(", support)
        for runner in RUNNERS:
            with self.subTest(runner=runner):
                source = self.source(runner)
                self.assertIn("selected_native_runtime(GATE_ID)", source)
                self.assertIn(
                    "runtime_binding: NativeDesktopRuntimeBinding | None",
                    source,
                )
                self.assertIn(
                    "if selected_cell and runtime_binding is None:",
                    source,
                )
                self.assertIn(
                    "runtime_binding.cell_id != selected_cell",
                    source,
                )
                self.assertIn("self.runtime_binding.create_session(", source)
                self.assertIn("self.report.manifest = manifest", source)
                self.assertIn("native_runtime_source_identity(", source)
                self.assertIn(
                    "self.runtime_binding.finalize_cleanup(",
                    source,
                )

    def test_selected_runtime_does_not_use_local_launch_fallback(self) -> None:
        for runner in RUNNERS:
            with self.subTest(runner=runner):
                source = self.source(runner)
                start = source.index("    def start_client(")
                injected = source.index("    def start_injected_client(", start)
                dispatch = source[start:injected]
                self.assertIn("if self.runtime_binding is not None:", dispatch)
                self.assertLess(
                    dispatch.index("self.start_injected_client(actor)"),
                    dispatch.index("start_authenticated_client("),
                )

    def test_selected_runtime_rejects_uninjected_gate_construction(self) -> None:
        previous = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL")
        os.environ["PT_ACCEPTANCE_RUNTIME_CELL"] = "desktop-linux-native"
        try:
            for gate in (NativeTypingGate, NativeMultiDeviceGate):
                with self.subTest(gate=gate.__name__):
                    with self.assertRaisesRegex(
                        GateError,
                        "requires injected runtime resources",
                    ):
                        gate()
        finally:
            if previous is None:
                os.environ.pop("PT_ACCEPTANCE_RUNTIME_CELL", None)
            else:
                os.environ["PT_ACCEPTANCE_RUNTIME_CELL"] = previous

    def test_runtime_identity_is_clean_source_bound(self) -> None:
        support = (
            ROOT / "tooling/acceptance/gates/chat/native_support.py"
        ).read_text(encoding="utf-8")
        for contract in (
            'source.get("workspaceDigest") == "clean"',
            'station.get("workspaceDigest") == "clean"',
            'runtime_cell.get("state") == "LEASED"',
            'cell_source.get("remoteCheckoutClean") is True',
            'cell_source.get("binarySha256") == binary_sha256',
            'platform.get("imageDigest")',
            'transport.get("hostIdentitySha256")',
            'transport.get("hostKeySha256")',
        ):
            self.assertIn(contract, support)
        for runner in RUNNERS:
            with self.subTest(runner=runner):
                source = self.source(runner)
                identity_start = source.index("    def validate_source_identity(")
                identity_end = source.index(
                    "\n    def ",
                    identity_start + 8,
                )
                identity = source[identity_start:identity_end]
                self.assertIn("native_runtime_source_identity(", identity)

    def test_gate_catalog_routes_all_native_runners_through_cells(self) -> None:
        gates = json.loads(
            (ROOT / "tooling/acceptance/gates.yaml").read_text(
                encoding="utf-8"
            )
        )["gates"]
        expected_cells = [
            "desktop-macos-native",
            "desktop-linux-native",
            "desktop-windows-native",
        ]
        for gate_id in (
            "chat-native-interactions-e2e",
            "chat-contact-message-resilience-e2e",
            "chat-native-typing-e2e",
            "chat-native-multi-device-e2e",
            "chat-native-recovery-e2e",
            "chat-native-group-mls-e2e",
        ):
            with self.subTest(gate=gate_id):
                gate = gates[gate_id]
                self.assertEqual(
                    gate["environment"],
                    "native-tauri-embedded-webdriver",
                )
                self.assertEqual(
                    gate["provisioner"],
                    "native-tauri-embedded-webdriver",
                )
                self.assertEqual(
                    gate["requiredRuntimeCells"],
                    expected_cells,
                )

    def test_multi_device_clones_identity_inside_runtime_owner(self) -> None:
        source = self.source("multi-device")
        self.assertIn(
            "self.runtime_binding.clone_actor_storage(",
            source,
        )

    def test_make_entries_forward_the_selected_runtime_cell(self) -> None:
        makefile = (
            ROOT / "tooling/make/acceptance.mk"
        ).read_text(encoding="utf-8")
        targets = (
            "acceptance-chat-native-interactions",
            "acceptance-chat-native-typing",
            "acceptance-chat-native-multi-device",
            "acceptance-chat-native-recovery",
            "acceptance-chat-native-group-mls",
            "acceptance-chat-contact-message-resilience",
            "acceptance-chat-w11",
        )
        for target in targets:
            with self.subTest(target=target):
                start = makefile.index(f"{target}:")
                next_target = makefile.find("\nacceptance-", start + 1)
                body = makefile[
                    start : next_target if next_target >= 0 else None
                ]
                self.assertIn(
                    'PT_ACCEPTANCE_RUNTIME_CELL="$(RUNTIME_CELL)"',
                    body,
                )
                self.assertIn(
                    '--runtime-cell "$(RUNTIME_CELL)"',
                    body,
                )

    def test_fixed_w11_plan_preserves_runtime_cell_contracts(self) -> None:
        plan = json.loads(
            (
                ROOT / "tooling/acceptance/plans/chat-w11-closure.json"
            ).read_text(encoding="utf-8")
        )
        selected = {
            gate["id"]: gate
            for gate in plan["selected_gates"]
        }
        for gate_id in (
            "chat-native-two-client-e2e",
            "chat-native-interactions-e2e",
            "chat-native-typing-e2e",
            "chat-native-multi-device-e2e",
            "chat-native-recovery-e2e",
            "chat-native-group-mls-e2e",
        ):
            with self.subTest(gate=gate_id):
                self.assertEqual(
                    selected[gate_id]["requiredRuntimeCells"],
                    [
                        "desktop-macos-native",
                        "desktop-linux-native",
                        "desktop-windows-native",
                    ],
                )

    def test_migrated_runners_default_to_current_evidence_store_run(self) -> None:
        for filename in ALL_MIGRATED_RUNNERS:
            with self.subTest(runner=filename):
                source = (
                    ROOT / "tooling/acceptance/gates/chat" / filename
                ).read_text(encoding="utf-8")
                self.assertIn("REPORT_PATH = None", source)
                self.assertNotIn("REPORT_OVERRIDE", source)
                self.assertNotIn("REPORTS_DIR", source)

    def test_cleanup_failure_preserves_first_product_failure(self) -> None:
        report = new_report("synthetic-native-gate")

        def cleanup() -> dict[str, Any]:
            report.runtime["cleanup"] = {
                "cleanupErrors": [{"error": "cleanup failed"}],
            }
            raise GateError("cleanup failed")

        with self.assertRaisesRegex(
            GateError,
            "product failed",
        ) as raised:
            try:
                raise GateError("product failed")
            finally:
                cleanup_preserving_primary_failure(
                    cleanup,
                    report,
                    "Synthetic native gate",
                )

        self.assertIn("cleanupFailure", report.runtime)
        self.assertEqual(
            report.runtime["cleanupFailure"]["error"],
            "cleanup failed",
        )

    def test_runner_log_failure_does_not_replace_product_failure(self) -> None:
        for gate_class in (NativeTypingGate, NativeMultiDeviceGate):
            with self.subTest(gate=gate_class.gate_id):
                client = Mock(
                    profile="acceptance-alice",
                    gateway_port=3030,
                )
                client.is_alive.return_value = False
                binding = Mock()
                binding.finalize_cleanup.return_value = {
                    "portsReleased": True,
                    "processesReleased": True,
                    "storageReleased": True,
                    "logsReleased": True,
                    "cleanupErrors": [],
                }
                gate = object.__new__(gate_class)
                gate.runtime_binding = binding
                gate.clients = {"alice": client}
                gate.runtime_instances = [client]
                gate.authenticated_profiles = set()
                gate.client_specs = {"alice": {}}
                gate.steps = []
                gate.cleanup_evidence = {}
                gate.report = new_report(gate_class.gate_id)
                gate.save_app_log = Mock(
                    side_effect=RuntimeError("log export failed")
                )

                with self.assertRaisesRegex(
                    GateError,
                    "product failed",
                ):
                    try:
                        raise GateError("product failed")
                    finally:
                        cleanup_preserving_primary_failure(
                            gate.cleanup_runtime,
                            gate.report,
                            gate_class.gate_id,
                        )

                self.assertEqual(
                    gate.report.runtime["cleanupFailure"]["resource"],
                    "cleanup",
                )
                self.assertEqual(
                    gate.report.runtime["cleanup"]["cleanupErrors"][0][
                        "error"
                    ],
                    "log export failed",
                )

    def test_static_gate_runs_runtime_cell_regressions(self) -> None:
        gates = json.loads(
            (ROOT / "tooling/acceptance/gates.yaml").read_text(
                encoding="utf-8"
            )
        )["gates"]
        command = gates["chat-native-visible-static"]["command"]
        for suite in (
            "native_runtime_cell_runner_test",
            "native_recovery_runner_test",
            "native_group_mls_runner_test",
        ):
            with self.subTest(suite=suite):
                self.assertIn(suite, command)

    def test_station_readback_uses_strict_shared_ssh_transport(self) -> None:
        support = (
            ROOT / "tooling/acceptance/gates/chat/native_support.py"
        ).read_text(encoding="utf-8")
        self.assertIn("SshTransport(", support)
        self.assertIn("SshTarget(", support)
        self.assertNotIn("StrictHostKeyChecking=no", support)

    def test_typing_contract_is_unchanged(self) -> None:
        self.assertEqual(
            self.assignment("typing", "ACTORS"),
            ("alice", "bob", "charlie"),
        )
        self.assertEqual(
            self.assignment("typing", "CLIENT_PORTS"),
            {"alice": 4461, "bob": 4462, "charlie": 4463},
        )
        self.assertEqual(
            self.assignment("typing", "REQUIRED_ASSERTIONS"),
            {
                "native_runtime",
                "actor_isolation",
                "direct_typing_start_stop",
                "direct_typing_send_clear",
                "direct_typing_blur_clear",
                "direct_typing_switch_clear",
                "direct_typing_disconnect_ttl_clear",
                "group_typing_start_stop",
                "group_typing_send_clear",
                "group_typing_blur_clear",
                "group_typing_switch_clear",
                "group_typing_disconnect_ttl_clear",
                "group_removed_member_rejected",
                "typing_revoked_device_rejected",
                "typing_has_zero_durable_writes",
                "resources_released",
            },
        )

    def test_group_creation_uses_current_production_harness_contract(
        self,
    ) -> None:
        for filename in (
            "native_interactions_runner.py",
            "native_typing_runner.py",
        ):
            with self.subTest(runner=filename):
                source = (
                    ROOT / "tooling/acceptance/gates/chat" / filename
                ).read_text(encoding="utf-8")
                tree = ast.parse(source)
                group_assignment = next(
                    node
                    for node in ast.walk(tree)
                    if isinstance(node, ast.Assign)
                    and any(
                        isinstance(target, ast.Name)
                        and target.id == "group"
                        for target in node.targets
                    )
                )
                self.assertIsInstance(group_assignment.value, ast.Call)
                create_group_call = group_assignment.value
                self.assertIsInstance(create_group_call.func, ast.Name)
                self.assertEqual(create_group_call.func.id, "async_harness")
                self.assertEqual(
                    ast.literal_eval(create_group_call.args[1]),
                    "createGroup",
                )
                payload = create_group_call.args[2]
                self.assertIsInstance(payload, ast.Dict)
                self.assertIn(
                    "memberDids",
                    [ast.literal_eval(key) for key in payload.keys],
                )

                group_id_assignment = next(
                    node
                    for node in ast.walk(tree)
                    if isinstance(node, ast.Assign)
                    and any(
                        isinstance(target, ast.Name)
                        and target.id == "group_id"
                        for target in node.targets
                    )
                )
                group_id_getters = [
                    node
                    for node in ast.walk(group_id_assignment.value)
                    if isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "get"
                    and node.args
                    and isinstance(node.args[0], ast.Constant)
                    and node.args[0].value == "groupUlid"
                ]
                self.assertEqual(
                    len(group_id_getters),
                    1,
                )

    def test_multi_device_contract_is_unchanged(self) -> None:
        self.assertEqual(
            self.assignment("multi-device", "CLIENT_PORTS"),
            {"alice": 4447, "bob1": 4448, "bob2": 4449},
        )
        self.assertEqual(
            self.assignment("multi-device", "REQUIRED_ASSERTIONS"),
            {
                "native_runtime",
                "actor_isolation",
                "bob1_initial_delivery",
                "session_handoff",
                "bob2_enrollment_operational",
            },
        )
        source = self.source("multi-device")
        self.assertLess(
            source.index('for actor in ("alice", "bob1")'),
            source.index('self.start_client("bob2")'),
        )
        self.assertLess(
            source.index('"bob1_initial_delivery"'),
            source.index('"session_handoff"'),
        )
        self.assertLess(
            source.index('"session_handoff"'),
            source.index('"bob2_enrollment_operational"'),
        )

    def test_platform_and_transport_details_stay_out_of_business_runners(
        self,
    ) -> None:
        for runner in RUNNERS:
            with self.subTest(runner=runner):
                source = self.source(runner)
                for forbidden in (
                    "LinuxNativeDesktopRuntimeBinding",
                    "LocalTauriLauncher",
                    "MacOSNativeDesktopAdapter",
                    "SshTransport",
                    "docker exec",
                    "XTest",
                    "AppKit",
                    "Win32",
                ):
                    self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
