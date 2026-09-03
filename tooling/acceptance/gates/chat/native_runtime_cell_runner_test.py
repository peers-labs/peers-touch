from __future__ import annotations

import ast
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.core import GateError
from tooling.acceptance.core.evidence import new_report
from tooling.acceptance.gates.chat import desktop_gateway_e2e
from tooling.acceptance.gates.chat.native_support import (
    NativeClientLifecycleLedger,
    cleanup_preserving_primary_failure,
    is_station_authorization_rejection,
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
TRACEABLE_GATE_CLASSES = {
    "contact_message_resilience_runner.py": "ContactMessageResilienceGate",
    "native_group_mls_runner.py": "NativeGroupMlsGate",
    "native_interactions_runner.py": "NativeInteractionsGate",
    "native_multi_device_runner.py": "NativeMultiDeviceGate",
    "native_product_closure_runner.py": "NativeProductClosureGate",
    "native_recovery_runner.py": "NativeRecoveryGate",
    "native_typing_runner.py": "NativeTypingGate",
}


class NativeRuntimeCellRunnerContractTest(unittest.TestCase):
    def source(self, runner: str) -> str:
        return RUNNERS[runner].read_text(encoding="utf-8")

    def function_source(self, path: Path, name: str) -> str:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        function = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == name
        )
        return ast.get_source_segment(source, function) or ""

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
                self.assertIn("self.runtime_binding.create_bound_session(", source)
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
                self.assertIn("self.start_injected_client(actor)", dispatch)
                self.assertNotIn("start_authenticated_client(", dispatch)
                self.assertNotIn("if self.runtime_binding is not None:", dispatch)

    def test_native_restart_preserves_and_restores_session(self) -> None:
        contracts = {
            "native_interactions_runner.py": (
                "self.create_authenticated_client(\n"
                "            actor,\n"
                "            restore_session=self.runtime_binding is not None,",
                "    def create_authenticated_client(",
                "stop_preserving_session(client)",
            ),
            "native_typing_runner.py": (
                "restored_from=self.clients[actor]",
                "    def start_injected_client(",
                "stop_preserving_session(client)",
            ),
        }
        for runner, (restore_call, initial_start, stop_call) in contracts.items():
            with self.subTest(runner=runner):
                source = (
                    ROOT / "tooling/acceptance/gates/chat" / runner
                ).read_text(encoding="utf-8")
                stop_start = source.index("    def stop_client_for_restart(")
                stop_end = source.index("\n    def ", stop_start + 8)
                stop_source = source[stop_start:stop_end]
                self.assertIn(stop_call, stop_source)
                self.assertNotIn("auth_logout", stop_source)
                self.assertIn(restore_call, source)
                self.assertIn("def wait_for_realtime_device(", source)
                initial_start_index = source.index(initial_start)
                initial_end_index = source.index(
                    "\n    def ",
                    initial_start_index + len(initial_start),
                )
                initial_source = source[initial_start_index:initial_end_index]
                self.assertNotIn("station.auth_logout()", initial_source)

    def test_revoke_current_device_uses_messaging_endpoint_identity(self) -> None:
        harness = (
            ROOT / "apps/desktop/src/acceptance/chat/harness.ts"
        ).read_text(encoding="utf-8")
        get_device = harness[
            harness.index("    async getRealtimeDevice() {"):
            harness.index("    async revokeCurrentDevice() {")
        ]
        revoke_device = harness[
            harness.index("    async revokeCurrentDevice() {"):
            harness.index("    async dispatchRealtimeFrame(", harness.index(
                "    async revokeCurrentDevice() {"
            ))
        ]
        for source in (get_device, revoke_device):
            self.assertIn("messagingAcceptanceCurrentEndpoint", source)
            self.assertNotIn("accountGetDeviceId", source)
        rust_commands = (
            ROOT
            / "apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs"
        ).read_text(encoding="utf-8")
        endpoint_start = rust_commands.index(
            "pub fn messaging_acceptance_current_endpoint("
        )
        endpoint_end = rust_commands.index(
            "\n#[cfg(feature = \"acceptance-webdriver\")]",
            endpoint_start,
        )
        endpoint_source = rust_commands[endpoint_start:endpoint_end]
        self.assertIn("engine.endpoint().device_id.as_str()", endpoint_source)
        self.assertIn("engine.endpoint().ptid != actor_ptid", endpoint_source)

    def test_native_acceptance_commands_are_registered_with_tauri(self) -> None:
        main = (
            ROOT / "apps/desktop/src-tauri/src/main.rs"
        ).read_text(encoding="utf-8")
        for command in (
            "auth::acceptance_logout_window_session",
            "messaging_commands::messaging_acceptance_current_endpoint",
            "messaging_commands::messaging_acceptance_interaction_snapshot",
        ):
            with self.subTest(command=command):
                self.assertIn(command, main)

    def test_acceptance_window_is_positioned_before_it_is_shown(self) -> None:
        main = (
            ROOT / "apps/desktop/src-tauri/src/main.rs"
        ).read_text(encoding="utf-8")
        start = main.index("fn configure_acceptance_window(")
        end = main.index(
            "\n#[cfg(all(test, feature = \"acceptance-webdriver\"))]",
            start,
        )
        function = main[start:end]
        resize = function.rindex(".set_size(")
        direct_position = function.rindex("position_acceptance_window(")
        show = function.rindex(".show()")

        self.assertLess(resize, direct_position)
        self.assertLess(direct_position, show)

    def test_initial_authentication_never_logs_out(self) -> None:
        runner_functions = {
            "contact_message_resilience_runner.py": "start_client",
            "native_group_mls_runner.py": "start_injected_client",
            "native_interactions_runner.py": "create_authenticated_client",
            "native_multi_device_runner.py": "start_injected_client",
            "native_product_closure_runner.py": "launch_actor",
            "native_recovery_runner.py": "start_injected_client",
            "native_two_client_runner.py": "start_client",
            "native_typing_runner.py": "start_injected_client",
        }
        for runner, function_name in runner_functions.items():
            with self.subTest(runner=runner):
                path = ROOT / "tooling/acceptance/gates/chat" / runner
                source = self.function_source(path, function_name)
                self.assertIn("loginWithPassword", source)
                self.assertNotIn("station.auth_logout()", source)
        support = (
            ROOT / "tooling/acceptance/gates/chat/native_support.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("def start_authenticated_client(", support)

    def test_native_cleanup_uses_window_owned_lifecycle(self) -> None:
        cleanup_functions = {
            "contact_message_resilience_runner.py": "cleanup_runtime",
            "native_group_mls_runner.py": "stop_authenticated_client",
            "native_interactions_runner.py": "cleanup_clients",
            "native_multi_device_runner.py": "cleanup_runtime",
            "native_product_closure_runner.py": "cleanup_clients",
            "native_recovery_runner.py": "stop_authenticated_client",
            "native_two_client_runner.py": "cleanup_clients",
            "native_typing_runner.py": "cleanup_runtime",
        }
        for runner, function_name in cleanup_functions.items():
            with self.subTest(runner=runner):
                path = ROOT / "tooling/acceptance/gates/chat" / runner
                source = self.function_source(path, function_name)
                self.assertIn("client_lifecycles", source)
                self.assertNotIn("station.auth_logout()", source)

        support = (
            ROOT / "tooling/acceptance/gates/chat/native_support.py"
        ).read_text(encoding="utf-8")
        self.assertIn('"logout"', self.function_source(
            ROOT / "tooling/acceptance/gates/chat/native_support.py",
            "logout_native_client",
        ))
        self.assertIn('"actorPtid": actor_ptid', support)

    def test_corrected_native_runners_register_authenticated_windows(self) -> None:
        start_functions = {
            "contact_message_resilience_runner.py": "start_client",
            "native_interactions_runner.py": "create_authenticated_client",
            "native_product_closure_runner.py": "launch_actor",
        }
        for runner, function_name in start_functions.items():
            with self.subTest(runner=runner):
                source = self.function_source(
                    ROOT / "tooling/acceptance/gates/chat" / runner,
                    function_name,
                )
                self.assertIn("self.client_lifecycles.register(", source)
                self.assertIn("self.client_lifecycles.mark_live(", source)
                self.assertIn(
                    "self.client_lifecycles.mark_authenticated(",
                    source,
                )
                self.assertIn("self.client_lifecycles.release(", source)

    def test_corrected_restart_paths_transfer_preserved_sessions(self) -> None:
        runners = (
            "native_interactions_runner.py",
            "native_product_closure_runner.py",
        )
        for runner in runners:
            with self.subTest(runner=runner):
                source = (
                    ROOT / "tooling/acceptance/gates/chat" / runner
                ).read_text(encoding="utf-8")
                self.assertIn(
                    "self.client_lifecycles.stop_preserving_session(",
                    source,
                )
                self.assertIn(
                    "self.client_lifecycles.transfer_preserved_session(",
                    source,
                )

    def test_revoked_typing_is_submitted_and_receiver_stays_inactive(self) -> None:
        source = self.function_source(
            ROOT / "tooling/acceptance/gates/chat/native_typing_runner.py",
            "prove_revoked_device",
        )
        self.assertIn('"submitTyping"', source)
        self.assertIn('self.clients["bob"]', source)
        self.assertIn("except GateError as error:", source)
        self.assertIn("is_station_authorization_rejection(rejection)", source)
        self.assertIn("self.assert_typing_inactive_for(", source)
        self.assertIn('"alice"', source)
        self.assertNotIn(
            'self.assert_condition("typing_revoked_device_rejected", True)',
            source,
        )

    def test_station_authorization_rejection_is_explicit(self) -> None:
        for error in (
            "endpoint is not active",
            "sender unauthorized",
            "Forbidden",
            "request failed status 403",
            "station returned 403 :",
        ):
            with self.subTest(error=error):
                self.assertTrue(is_station_authorization_rejection(error))
        for error in (
            "",
            "station returned 404 :",
            "request timed out",
            "connection refused",
        ):
            with self.subTest(error=error):
                self.assertFalse(is_station_authorization_rejection(error))

    def test_revoked_metadata_interaction_requires_rejection_and_no_event(self) -> None:
        source = self.function_source(
            ROOT / "tooling/acceptance/gates/chat/native_interactions_runner.py",
            "prove_revoked_device",
        )
        self.assertIn('"submitMetadataInteraction"', source)
        self.assertIn('self.clients["bob"]', source)
        self.assertIn("except GateError as error:", source)
        self.assertIn("is_station_authorization_rejection(rejection)", source)
        self.assertIn(
            "authority_event_count_after == authority_event_count_before",
            source,
        )
        self.assertNotIn('self.clients["alice"]', source)
        self.assertNotIn(
            'self.assert_condition("revoked_device_denied", True)',
            source,
        )

    def test_native_lifecycle_logs_out_device_revoked_window(self) -> None:
        client = Mock(profile="acceptance-bob")
        client.is_alive.return_value = True
        lifecycle = NativeClientLifecycleLedger()
        lifecycle.register(client, "ptid:v1:actor:bob")
        lifecycle.mark_live(client)
        lifecycle.mark_authenticated(client)
        lifecycle.mark_device_revoked(client)

        with patch(
            "tooling.acceptance.gates.chat.native_support."
            "logout_native_client",
            return_value={
                "actorPtid": "ptid:v1:actor:bob",
                "status": "logged_out",
            },
        ) as logout:
            self.assertEqual(lifecycle.release(client), [])

        logout.assert_called_once_with(client, "ptid:v1:actor:bob")
        client.stop.assert_called_once_with()

    def test_native_lifecycle_skips_auth_revoked_window_logout(self) -> None:
        client = Mock(profile="acceptance-bob1")
        client.is_alive.return_value = True
        lifecycle = NativeClientLifecycleLedger()
        lifecycle.register(client, "ptid:v1:actor:bob")
        lifecycle.mark_live(client)
        lifecycle.mark_authenticated(client)
        lifecycle.mark_auth_revoked(client)

        with patch(
            "tooling.acceptance.gates.chat.native_support."
            "logout_native_client",
        ) as logout:
            self.assertEqual(lifecycle.release(client), [])

        logout.assert_not_called()
        client.stop.assert_called_once_with()

    def test_native_lifecycle_reports_dead_authenticated_window(self) -> None:
        client = Mock(profile="acceptance-alice")
        client.is_alive.return_value = False
        lifecycle = NativeClientLifecycleLedger()
        lifecycle.register(client, "ptid:v1:actor:alice")
        lifecycle.mark_live(client)
        lifecycle.mark_authenticated(client)

        errors = lifecycle.release(client)

        self.assertEqual(len(errors), 1)
        self.assertIn("terminated before logout", errors[0]["error"])
        client.stop.assert_called_once_with()

    def test_native_lifecycle_retains_logout_and_stop_failures(self) -> None:
        client = Mock(profile="acceptance-alice")
        client.is_alive.return_value = True
        client.stop.side_effect = RuntimeError("stop failed")
        lifecycle = NativeClientLifecycleLedger()
        lifecycle.register(client, "ptid:v1:actor:alice")
        lifecycle.mark_live(client)
        lifecycle.mark_authenticated(client)

        with patch(
            "tooling.acceptance.gates.chat.native_support."
            "logout_native_client",
            side_effect=RuntimeError("logout failed"),
        ):
            errors = lifecycle.release(client)

        self.assertEqual(
            [error["error"] for error in errors],
            ["logout failed", "stop failed"],
        )

    def test_native_lifecycle_requires_preserved_session_successor(self) -> None:
        client = Mock(profile="acceptance-alice")
        lifecycle = NativeClientLifecycleLedger()
        lifecycle.register(client, "ptid:v1:actor:alice")
        lifecycle.mark_live(client)
        lifecycle.mark_authenticated(client)
        lifecycle.stop_preserving_session(client)

        errors = lifecycle.release(client)

        self.assertEqual(len(errors), 1)
        self.assertIn("no verified successor", errors[0]["error"])
        client.stop.assert_called_once_with(preserve_state=True)

    def test_native_lifecycle_transfers_preserved_session_ownership(self) -> None:
        predecessor = Mock(profile="acceptance-alice-old")
        successor = Mock(profile="acceptance-alice-new")
        successor.is_alive.return_value = True
        lifecycle = NativeClientLifecycleLedger()
        lifecycle.register(predecessor, "ptid:v1:actor:alice")
        lifecycle.mark_live(predecessor)
        lifecycle.mark_authenticated(predecessor)
        lifecycle.stop_preserving_session(predecessor)
        lifecycle.register(successor, "ptid:v1:actor:alice")
        lifecycle.transfer_preserved_session(predecessor, successor)
        lifecycle.mark_live(successor)
        lifecycle.mark_authenticated(successor)

        with patch(
            "tooling.acceptance.gates.chat.native_support."
            "logout_native_client",
            return_value={
                "actorPtid": "ptid:v1:actor:alice",
                "status": "logged_out",
            },
        ):
            self.assertEqual(lifecycle.release_all(), [])

        successor.stop.assert_called_once_with()

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
                gate.client_lifecycles = NativeClientLifecycleLedger()
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

    def test_environment_gate_classes_declare_traceability(self) -> None:
        runner_root = ROOT / "tooling/acceptance/gates/chat"
        for filename, class_name in TRACEABLE_GATE_CLASSES.items():
            with self.subTest(runner=filename):
                tree = ast.parse(
                    (runner_root / filename).read_text(encoding="utf-8")
                )
                gate_class = next(
                    node
                    for node in tree.body
                    if isinstance(node, ast.ClassDef)
                    and node.name == class_name
                )
                assignments = {
                    target.id: ast.literal_eval(node.value)
                    for node in gate_class.body
                    if isinstance(node, ast.Assign)
                    for target in node.targets
                    if isinstance(target, ast.Name)
                    and target.id in {"phase", "bom", "spec"}
                }
                self.assertTrue(assignments.get("phase"))
                self.assertTrue(assignments.get("bom"))
                self.assertTrue(assignments.get("spec"))

    def test_desktop_gateway_gate_runs_as_repo_module(self) -> None:
        gates = json.loads(
            (ROOT / "tooling/acceptance/gates.yaml").read_text(
                encoding="utf-8"
            )
        )["gates"]

        self.assertEqual(
            gates["chat-desktop-gateway-e2e"]["command"],
            "python3 -m "
            "tooling.acceptance.gates.chat.desktop_gateway_e2e",
        )

    def test_desktop_gateway_login_uses_canonical_actor_ptid(self) -> None:
        actor = desktop_gateway_e2e.ActorCredentials(
            name="alice",
            email="alice@example.com",
            password="password",
            actor_ptid="ptid:test:alice",
        )
        identity = {
            "accountId": "station:test:password:alice",
            "actorPtid": "ptid:test:alice",
            "activeAccountId": "station:test:password:alice",
            "tokenFingerprint": "a" * 64,
            "messagingProfileMatches": True,
        }

        with patch.object(
            desktop_gateway_e2e,
            "gateway_command",
            return_value={"actor_ptid": "ptid:test:alice"},
        ), patch.object(
            desktop_gateway_e2e,
            "current_identity",
            return_value=identity,
        ):
            actor_ptid = desktop_gateway_e2e.gateway_login(
                "http://127.0.0.1:3030",
                actor,
            )

        self.assertEqual(actor_ptid, "ptid:test:alice")
        self.assertEqual(actor.actor_ptid, "ptid:test:alice")
        self.assertEqual(actor.account_id, "station:test:password:alice")

    def test_desktop_gateway_login_rejects_legacy_ptid_response(self) -> None:
        actor = desktop_gateway_e2e.ActorCredentials(
            name="alice",
            email="alice@example.com",
            password="password",
            actor_ptid="ptid:test:alice",
        )

        with patch.object(
            desktop_gateway_e2e,
            "gateway_command",
            return_value={"ptid": "ptid:test:alice"},
        ):
            with self.assertRaisesRegex(
                desktop_gateway_e2e.GateError,
                "missing actor_ptid",
            ):
                desktop_gateway_e2e.gateway_login(
                    "http://127.0.0.1:3030",
                    actor,
                )

    def test_desktop_gateway_legacy_pin_fixture_removes_actor_ptid(self) -> None:
        state = {
            "accounts": [
                {
                    "id": "oauth-account",
                    "encrypted_session": {
                        "actor_ptid": "ptid:test:bob",
                        "ciphertext": "ciphertext",
                    },
                },
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "identities.json"
            path.write_text(json.dumps(state), encoding="utf-8")
            with patch.object(
                desktop_gateway_e2e,
                "identity_state_path",
                return_value=path,
            ):
                selected_path, original = (
                    desktop_gateway_e2e.remove_persisted_actor_binding(
                        "oauth-account",
                    )
                )

            updated = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(selected_path, path)
        self.assertEqual(json.loads(original), state)
        self.assertNotIn(
            "actor_ptid",
            updated["accounts"][0]["encrypted_session"],
        )

    def test_desktop_gateway_gate_has_no_legacy_actor_id_contract(self) -> None:
        source = (
            ROOT / "tooling/acceptance/gates/chat/desktop_gateway_e2e.py"
        ).read_text(encoding="utf-8")

        self.assertNotIn("actor_id", source)
        self.assertNotIn('data.get("ptid")', source)
        self.assertIn('"actor_ptid": actor_b.actor_ptid', source)

    def test_native_chat_gates_use_canonical_actor_ptid(self) -> None:
        runner_root = ROOT / "tooling/acceptance/gates/chat"
        runner_names = (
            "contact_message_resilience_runner.py",
            "native_group_mls_runner.py",
            "native_interactions_runner.py",
            "native_multi_device_runner.py",
            "native_product_closure_runner.py",
            "native_recovery_runner.py",
            "native_support.py",
            "native_two_client_runner.py",
            "native_typing_runner.py",
        )

        for runner_name in runner_names:
            with self.subTest(runner=runner_name):
                source = (runner_root / runner_name).read_text(
                    encoding="utf-8"
                )
                self.assertNotIn('.get("actorId")', source)
                self.assertIn('.get("actorPtid")', source)

    def test_desktop_gateway_pin_flow_preserves_independent_account(self) -> None:
        source = (
            ROOT / "tooling/acceptance/gates/chat/desktop_gateway_e2e.py"
        ).read_text(encoding="utf-8")
        pin_flow = source.split('"account_set_pin"', 1)[1].split(
            "unlocked =",
            1,
        )[0]

        self.assertIn('{"id": account_a}', pin_flow)
        self.assertNotIn('{"id": account_b}', pin_flow)

    def test_desktop_gateway_gate_publishes_typed_evidence(self) -> None:
        report = Mock()
        report.status = "RUNNING"
        report.runtime = {}
        manifest = {
            "gateId": "chat-desktop-gateway-e2e",
            "services": {
                "station": {
                    "kind": "station",
                    "endpoint": "http://station.example:18132",
                },
            },
        }
        runtime = {
            "conversationId": "conversation-1",
            "messageId": "message-1",
        }

        with patch(
            "tooling.acceptance.core.gate.new_report",
            return_value=report,
        ) as report_factory, patch.object(
            desktop_gateway_e2e,
            "runtime_manifest",
            return_value=manifest,
        ), patch.object(
            desktop_gateway_e2e,
            "station_url",
            return_value="http://station.example:18132",
        ), patch.object(
            desktop_gateway_e2e,
            "gateway_url",
            return_value="http://127.0.0.1:3030",
        ), patch.object(
            desktop_gateway_e2e,
            "run_gateway_flow",
            return_value=runtime,
        ), patch.object(
            desktop_gateway_e2e,
            "gateway_logout",
        ):
            self.assertEqual(desktop_gateway_e2e.main(), 0)

        self.assertEqual(report.manifest, manifest)
        self.assertEqual(report.station_url, "http://station.example:18132")
        self.assertEqual(report.runtime, runtime)
        self.assertEqual(report.status, "PASS")
        report.write.assert_called_once_with(None)
        report_factory.assert_called_once_with(
            "chat-desktop-gateway-e2e",
            phase="MP-W03",
            bom=("MP-G01", "MP-G02", "MP-G03", "MP-G04"),
            spec=("chat-desktop-gateway-message-flow",),
        )

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
            "native_group_mls_runner.py",
            "native_interactions_runner.py",
            "native_typing_runner.py",
        ):
            with self.subTest(runner=filename):
                source = (
                    ROOT / "tooling/acceptance/gates/chat" / filename
                ).read_text(encoding="utf-8")
                tree = ast.parse(source)
                create_group_call = next(
                    node
                    for node in ast.walk(tree)
                    if isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "async_harness"
                    and len(node.args) >= 3
                    and isinstance(node.args[1], ast.Constant)
                    and node.args[1].value == "createGroup"
                )
                payload = create_group_call.args[2]
                self.assertIsInstance(payload, ast.Dict)
                self.assertIn(
                    "memberPtids",
                    [ast.literal_eval(key) for key in payload.keys],
                )
                self.assertNotIn(
                    "memberDids",
                    [ast.literal_eval(key) for key in payload.keys],
                )

                if filename == "native_group_mls_runner.py":
                    continue
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

        group_runner = (
            ROOT
            / "tooling/acceptance/gates/chat/native_group_mls_runner.py"
        ).read_text(encoding="utf-8")
        self.assertIn('"memberPtid": self.ptids["charlie"]', group_runner)
        self.assertNotIn('"memberDid":', group_runner)

    def test_typing_start_stop_waits_for_receiver_evidence(self) -> None:
        source = (
            ROOT / "tooling/acceptance/gates/chat/native_typing_runner.py"
        ).read_text(encoding="utf-8")
        prove_direct = self.function_source(
            ROOT / "tooling/acceptance/gates/chat/native_typing_runner.py",
            "prove_direct",
        )

        self.assertIn("def submit_typing_and_wait(", source)
        self.assertEqual(
            prove_direct.count("self.submit_typing_and_wait("),
            2,
        )
        self.assertNotIn("or self.wait_typing(", prove_direct)

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
        revoked_wait = source.index('self.wait_for_revoked_identity("bob1")')
        revoked_mark = source.index(
            "self.client_lifecycles.mark_auth_revoked(bob1)"
        )
        self.assertLess(
            source.index('self.start_client("bob2")'),
            revoked_wait,
        )
        self.assertLess(revoked_wait, revoked_mark)
        self.assertLess(revoked_mark, source.index('"session_handoff"', revoked_mark))

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
