from __future__ import annotations


import hashlib
import inspect
import io
import json
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

from tooling.acceptance.core import (
    CellAdapterIdentity,
    CellDisplayIdentity,
    CellPlatformIdentity,
    CellSourceIdentity,
    CellTransportIdentity,
    REPO_ROOT,
    RuntimeCellContract,
    RuntimeCellState,
)
from tooling.acceptance.core.errors import BlockedError, DriverError
from tooling.acceptance.core.runtime_cell import CellFileChooserIdentity
from tooling.acceptance.drivers.native.base import (
    MouseAction,
    NativeControlSnapshot,
    NativeInputMode,
    NativeOperatorObservation,
    NativeWindowBounds,
    NativeWindowSnapshot,
    NativeWindowStack,
)
from tooling.acceptance.drivers.native.macos import (
    MacOSNativeDesktopAdapter, _ACTIVATION_PROBE, _NATIVE_OBSERVATION_BODY,
    _NATIVE_OBSERVATION_PROBE, _pixel_buffer_has_visible_alpha,
)
from tooling.acceptance.provisioners import get_runtime_cell_lifecycle
from tooling.acceptance.provisioners.native_desktop_macos import (
    NATIVE_FOCUS_READY_TIMEOUT_SECONDS,
    NATIVE_WINDOW_READY_TIMEOUT_SECONDS,
    NativeDesktopMacOSProvisioner,
    _WINDOW_BOUNDS_PROBE,
)


def observation_probe(controls: list[dict[str, object]]) -> dict[str, object]:
    """Execute the actual child algorithm with only native reads substituted."""
    clock = Mock(spec=["monotonic", "sleep"])
    clock.monotonic.return_value = 0.0
    namespace = {
        "time": clock,
        "frontmost_pid": Mock(return_value=41),
        "read_control": Mock(side_effect=controls),
        "pointer_location": Mock(return_value={"x": 100.0, "y": 200.0}),
        "panel_presence": Mock(return_value={"processId": 42, "present": True}),
    }
    exec(_NATIVE_OBSERVATION_BODY, namespace)
    return namespace


class NativeDesktopMacOSProvisionerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contract_path = (
            REPO_ROOT
            / "tooling"
            / "acceptance"
            / "runtime-cells"
            / "desktop-macos-native.yaml"
        )

    def test_contract_declares_local_native_macos_cell(self) -> None:
        contract = RuntimeCellContract.from_yaml(self.contract_path)
        self.assertEqual(contract.cell_id, "desktop-macos-native")
        self.assertEqual(contract.platform, "macos")
        self.assertEqual(contract.architecture, "arm64")
        self.assertEqual(contract.transport.kind, "local")
        self.assertEqual(contract.display.session_type, "native-macos")
        self.assertEqual(contract.source.mode, "local-worktree")
        self.assertIn("gui-session-lease", contract.cleanup_resources)

    def test_registry_resolves_macos_lifecycle(self) -> None:
        lifecycle = get_runtime_cell_lifecycle("desktop-macos-native")
        self.assertIsInstance(lifecycle, NativeDesktopMacOSProvisioner)

    def test_focus_budget_matches_native_window_readiness_budget(self) -> None:
        self.assertEqual(
            NATIVE_FOCUS_READY_TIMEOUT_SECONDS,
            NATIVE_WINDOW_READY_TIMEOUT_SECONDS,
        )

    def test_source_identity_builds_binary_before_attesting_current_commit(
        self,
    ) -> None:
        commit = "a" * 40
        tree = "b" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "peers-touch-desktop"
            binary.write_bytes(b"exact-source-binary")
            lifecycle = NativeDesktopMacOSProvisioner(
                source_root=root,
                state_root=root / "state",
            )
            snapshot = {"commit": commit, "workspaceDigest": "sha256:" + "c" * 64}
            with (
                patch.object(
                    lifecycle,
                    "_git",
                    return_value=tree,
                ),
                patch(
                    "tooling.acceptance.provisioners."
                    "native_desktop_macos.source_identity",
                    return_value=snapshot,
                ),
                patch(
                    "tooling.acceptance.provisioners."
                    "native_desktop_macos.DesktopAcceptanceBuild",
                ) as owner,
            ):
                owner.return_value.ensure.return_value = binary
                source = lifecycle._source_identity()

        self.assertEqual(source.commit, commit)
        self.assertEqual(source.workspace_digest, snapshot["workspaceDigest"])
        self.assertFalse(source.remote_checkout_clean)
        self.assertEqual(
            source.binary_sha256,
            hashlib.sha256(b"exact-source-binary").hexdigest(),
        )
        owner.assert_called_once_with(root.resolve(), binary=None)
        owner.return_value.ensure.assert_called_once_with()

    def test_probe_launcher_places_probe_window_on_main_display(
        self,
    ) -> None:
        launcher = Mock(log_path=None)
        session = Mock(process_id=42, log_path=None)
        session.invoke_app_result.return_value = {"ok": True}
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.window_state.side_effect = (
            {"windowCount": 0},
            {"windowCount": 1},
        )
        adapter.position_main_window.side_effect = (
            lambda *_: self.assertEqual(adapter.window_state.call_count, 2)
        )
        adapter.capture_screenshot.side_effect = (
            lambda path: path.write_bytes(b"screenshot")
        )
        bounds = {
            "left": 0.0,
            "top": 32.0,
            "width": 1280.0,
            "height": 720.0,
        }
        stack = NativeWindowStack(
            windows=(
                NativeWindowSnapshot(
                    index=0,
                    owner_pid=42,
                    owner_name="peers-touch-desktop",
                    window_name="Peers",
                    layer=0,
                    alpha=1.0,
                    bounds=NativeWindowBounds(
                        left=0.0,
                        top=32.0,
                        width=1280.0,
                        height=720.0,
                    ),
                ),
            ),
        )
        point_probe = (
            (640.0, 392.0),
            {"x": 640.0, "y": 392.0},
            stack,
            True,
            ((640.0, 392.0),),
        )
        lifecycle = NativeDesktopMacOSProvisioner()
        lifecycle._acceptance_binary = Path("/tmp/peers-touch-desktop")

        with patch.dict(
            "os.environ",
            {
                "PT_ACCEPTANCE_DESKTOP_INPUT_MODE": "exclusive-native-input",
                "PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION": "isolated-gui-session",
            },
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "resolve_smoke_port",
            return_value=45123,
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "LocalTauriLauncher",
            return_value=launcher,
        ) as launcher_type, patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "TauriSession",
            return_value=session,
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "MacOSNativeDesktopAdapter",
            return_value=adapter,
        ), patch.object(
            NativeDesktopMacOSProvisioner,
            "_await_window_bounds",
            return_value=bounds,
        ), patch.object(
            NativeDesktopMacOSProvisioner,
            "_probe_owned_point",
            side_effect=(point_probe, point_probe),
        ), patch.object(
            NativeDesktopMacOSProvisioner,
            "_await_webview_focus",
            return_value=True,
        ):
            probes, webdriver_port = lifecycle._probe_native_adapter(
                Mock(commit="probe", workspace_digest="clean", binary_sha256="a" * 64),
                "probe-run",
            )

        self.assertEqual(webdriver_port, 45123)
        self.assertTrue(probes.input_probe)
        self.assertTrue(probes.focus_probe)
        self.assertTrue(probes.point_ownership_probe)
        self.assertTrue(probes.screenshot_probe)
        launcher_type.assert_called_once_with(
            app_binary=Path("/tmp/peers-touch-desktop"),
            port=45123,
            profile="desktop-macos-native-probe",
            environment={
                "PT_ACCEPTANCE_WINDOW_SLOT": "0",
                "PT_ACCEPTANCE_WINDOW_COUNT": "1",
                "PT_ACCEPTANCE_DESKTOP_INPUT_MODE": "exclusive-native-input",
                "PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION": "isolated-gui-session",
            },
        )
        adapter.position_main_window.assert_called_once_with(
            42,
            (100.0, 100.0),
        )
        session.invoke_app_result.assert_called_once_with(
            "acceptance_request_activation"
        )
        session.stop.assert_called_once_with()

    def test_owned_point_wait_reactivates_until_exact_process_owns_point(
        self,
    ) -> None:
        process_id = 42
        session = Mock()
        session.invoke_app_result.return_value = {"ok": True}
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        foreign_stack = NativeWindowStack(
            windows=(
                NativeWindowSnapshot(
                    index=0,
                    owner_pid=41,
                    owner_name="other",
                    window_name="Other",
                    layer=0,
                    alpha=1.0,
                    bounds=NativeWindowBounds(
                        left=0,
                        top=0,
                        width=1000,
                        height=800,
                    ),
                ),
            ),
        )
        owned_stack = NativeWindowStack(
            windows=(
                NativeWindowSnapshot(
                    index=0,
                    owner_pid=process_id,
                    owner_name="peers-touch-desktop",
                    window_name="Peers",
                    layer=0,
                    alpha=1.0,
                    bounds=NativeWindowBounds(
                        left=0,
                        top=0,
                        width=1000,
                        height=800,
                    ),
                ),
            ),
        )
        foreign_probe = (
            (500.0, 400.0),
            {"x": 500.0, "y": 400.0},
            foreign_stack,
            True,
            ((500.0, 400.0),),
        )
        owned_probe = (
            (500.0, 400.0),
            {"x": 500.0, "y": 400.0},
            owned_stack,
            True,
            ((500.0, 400.0),),
        )

        with patch.object(
            NativeDesktopMacOSProvisioner,
            "_probe_owned_point",
            side_effect=(foreign_probe, owned_probe),
        ):
            result = (
                NativeDesktopMacOSProvisioner._await_process_owned_point(
                    session,
                    adapter,
                    process_id,
                    {
                        "left": 0,
                        "top": 0,
                        "width": 1000,
                        "height": 800,
                    },
                    timeout_seconds=1,
                    interval_seconds=0,
                )
            )

        self.assertEqual(result, owned_probe)
        self.assertEqual(session.invoke_app_result.call_count, 2)
        session.invoke_app_result.assert_called_with(
            "acceptance_request_activation"
        )

    def test_owned_point_wait_rejects_failed_process_activation(self) -> None:
        session = Mock()
        session.invoke_app_result.return_value = {"ok": False}
        adapter = Mock(spec=MacOSNativeDesktopAdapter)

        with patch.object(
            NativeDesktopMacOSProvisioner,
            "_probe_owned_point",
        ) as point_probe, self.assertRaisesRegex(
            BlockedError,
            "rejected process-owned activation",
        ):
            NativeDesktopMacOSProvisioner._await_process_owned_point(
                session,
                adapter,
                42,
                {
                    "left": 0,
                    "top": 0,
                    "width": 1000,
                    "height": 800,
                },
                timeout_seconds=0,
                interval_seconds=0,
            )

        point_probe.assert_not_called()

    def test_semantic_probe_uses_webdriver_without_native_input(self) -> None:
        events: list[str] = []
        launcher = Mock(log_path=None)
        session = Mock(process_id=42, log_path=None)
        session.start.side_effect = lambda: events.append("session-start")
        session.wait_for_acceptance_harness.side_effect = lambda: events.append(
            "harness-ready"
        )
        session.save_screenshot.side_effect = lambda path: (
            events.append("screenshot"),
            path.write_bytes(b"semantic-screenshot"),
        )[-1]
        session.stop.side_effect = lambda: events.append("session-stop")
        hover = object()
        click = object()
        input_element = object()
        key = object()
        session.find_element.side_effect = (
            hover,
            click,
            input_element,
            key,
        )
        session.execute_script.side_effect = (
            None,
            {
                "hovered": True,
                "clicked": True,
                "text": "semantic-probe",
                "keyCount": 1,
            },
            None,
        )
        session.semantic_hover.side_effect = lambda _element: events.append(
            "semantic-action"
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.observe_operator.side_effect = lambda: NativeOperatorObservation(adapter)
        session.stop.return_value = []
        lifecycle = NativeDesktopMacOSProvisioner()
        operator_state = {
            "frontmostPid": 41,
            "pointerX": 120.0,
            "pointerY": 240.0,
            "keyboardFocusSha256": "b" * 64,
        }
        operator_states = iter((operator_state,) * 7)

        def snapshot_operator_state() -> dict[str, object]:
            events.append("operator-snapshot")
            return next(operator_states)

        def chooser_probe(_session, _adapter, operator):
            for phase in ("chooser-before", "chooser-open", "chooser-selected"):
                operator.sample(phase, target_process_id=42)
            return CellFileChooserIdentity(
                "", "", "", "", "", "macos-accessibility", 42,
                "a" * 64, "a" * 64, "b" * 64, "b" * 64,
                (False, True, False), (),
            )

        with patch.dict(
            "os.environ",
            {
                "PT_ACCEPTANCE_DESKTOP_INPUT_MODE": (
                    "semantic-nonintrusive"
                ),
            },
            clear=True,
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "resolve_smoke_port",
            return_value=45123,
        ), patch.object(
            lifecycle, "_acceptance_binary", Path("/tmp/peers-touch-desktop"),
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "LocalTauriLauncher",
            return_value=launcher,
        ) as launcher_type, patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "TauriSession",
            return_value=session,
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "MacOSNativeDesktopAdapter",
            return_value=adapter,
        ), patch.object(
            adapter,
            "snapshot_operator_state",
            side_effect=snapshot_operator_state,
        ) as snapshot, patch.object(
            lifecycle,
            "_await_window_bounds",
            side_effect=lambda _pid: events.append("visible-window"),
        ), patch.object(
            lifecycle, "_probe_file_chooser", side_effect=chooser_probe,
        ):
            probes, webdriver_port = lifecycle._probe_native_adapter(
                Mock(commit="probe", workspace_digest="clean", binary_sha256="a" * 64),
                "probe-run",
            )

        self.assertEqual(webdriver_port, 45123)
        self.assertEqual(probes.input_mode, "semantic-nonintrusive")
        self.assertEqual(
            probes.semantic_backend,
            "tauri-embedded-webdriver",
        )
        self.assertTrue(probes.semantic_action_probe)
        self.assertTrue(probes.semantic_screenshot_probe)
        self.assertTrue(probes.non_interference_probe)
        self.assertFalse(probes.input_probe)
        self.assertFalse(probes.focus_probe)
        self.assertFalse(probes.point_ownership_probe)
        self.assertFalse(probes.screenshot_probe)
        self.assertEqual(snapshot.call_count, 7)
        probes.file_chooser.validate(
            cell_id="desktop-macos-native", run_id="probe-run",
            source={"commit": "probe", "workspaceDigest": "clean", "binarySha256": "a" * 64},
        )
        self.assertEqual(
            events,
            [
                "operator-snapshot",
                "session-start",
                "harness-ready",
                "operator-snapshot",
                "visible-window",
                "semantic-action",
                "screenshot",
                "operator-snapshot",
                "operator-snapshot",
                "operator-snapshot",
                "operator-snapshot",
                "session-stop",
                "operator-snapshot",
            ],
        )
        launcher_type.assert_called_once_with(
            app_binary=Path("/tmp/peers-touch-desktop"),
            port=45123,
            profile="desktop-macos-native-probe",
            environment={
                "PT_ACCEPTANCE_WINDOW_SLOT": "0",
                "PT_ACCEPTANCE_WINDOW_COUNT": "1",
                "PT_ACCEPTANCE_DESKTOP_INPUT_MODE": (
                    "semantic-nonintrusive"
                ),
                "PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION": (
                    "shared-user-session"
                ),
            },
        )
        session.semantic_hover.assert_called_once_with(hover)
        session.semantic_click.assert_called_once_with(click)
        session.semantic_replace_text.assert_called_once_with(
            input_element,
            "semantic-probe",
        )
        session.semantic_key_sequence.assert_called_once()
        session.driver.set_window_rect.assert_not_called()
        session.invoke_app_result.assert_not_called()
        adapter.position_main_window.assert_not_called()
        adapter.post_mouse.assert_not_called()
        adapter.capture_screenshot.assert_not_called()
        session.stop.assert_called_once_with()

    def test_semantic_probe_does_not_rebaseline_launch_interference(
        self,
    ) -> None:
        lifecycle = NativeDesktopMacOSProvisioner()
        session = Mock(process_id=42)
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        baseline = {
            "frontmostPid": 41,
            "pointerX": 100.0,
            "pointerY": 200.0,
            "keyboardFocusSha256": "b" * 64,
        }
        states = (
            {
                "frontmostPid": 41,
                "pointerX": 120.0,
                "pointerY": 220.0,
                "keyboardFocusSha256": "b" * 64,
            },
            {
                "frontmostPid": 41,
                "pointerX": 120.0,
                "pointerY": 220.0,
                "keyboardFocusSha256": "b" * 64,
            },
            {
                "frontmostPid": 41,
                "pointerX": 120.0,
                "pointerY": 220.0,
                "keyboardFocusSha256": "b" * 64,
            },
        )
        with tempfile.TemporaryDirectory() as directory, patch.object(
            adapter,
            "snapshot_operator_state",
            side_effect=(baseline, *states),
        ) as snapshot, patch.object(
            lifecycle,
            "_probe_semantic_actions",
            return_value=True,
        ) as actions:
            screenshot = Path(directory) / "semantic.png"
            session.save_screenshot.side_effect = (
                lambda path: path.write_bytes(b"semantic-screenshot")
            )

            operator = NativeOperatorObservation(adapter)
            with self.assertRaisesRegex(BlockedError, "changed operator"):
                lifecycle._probe_semantic_non_interference(
                    session,
                    adapter,
                    screenshot,
                    operator=operator,
                )

        self.assertEqual(snapshot.call_count, 2)
        actions.assert_not_called()
        session.save_screenshot.assert_not_called()

    def test_hidden_webview_cannot_qualify_semantic_native_window(self) -> None:
        lifecycle = NativeDesktopMacOSProvisioner()
        session = Mock(process_id=42)
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        baseline = {
            "frontmostPid": 41,
            "pointerX": 100.0,
            "pointerY": 200.0,
            "keyboardFocusSha256": "b" * 64,
        }
        with tempfile.TemporaryDirectory() as directory, patch.object(
            adapter, "snapshot_operator_state", return_value=baseline,
        ), patch.object(
            lifecycle, "_await_window_bounds",
            side_effect=BlockedError(
                reason="no visible process-owned window",
                resource="runtime-cell-window",
            ),
        ), patch.object(lifecycle, "_probe_semantic_actions") as actions:
            with self.assertRaisesRegex(BlockedError, "no visible"):
                lifecycle._probe_semantic_non_interference(
                    session, adapter, Path(directory) / "semantic.png",
                    operator=NativeOperatorObservation(adapter),
                )
        actions.assert_not_called()
        session.save_screenshot.assert_not_called()

    def test_semantic_probe_rejects_target_as_operator_baseline(
        self,
    ) -> None:
        lifecycle = NativeDesktopMacOSProvisioner()
        session = Mock(process_id=41)
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        stable = {
            "frontmostPid": 41,
            "pointerX": 120.0,
            "pointerY": 220.0,
            "keyboardFocusSha256": "b" * 64,
        }
        with tempfile.TemporaryDirectory() as directory, patch.object(
            adapter,
            "snapshot_operator_state",
            return_value=stable,
        ) as snapshot, patch.object(
            lifecycle,
            "_probe_semantic_actions",
            return_value=True,
        ) as actions:
            screenshot = Path(directory) / "semantic.png"
            session.save_screenshot.side_effect = (
                lambda path: path.write_bytes(b"semantic-screenshot")
            )

            with self.assertRaisesRegex(BlockedError, "target client itself"):
                lifecycle._probe_semantic_non_interference(
                    session,
                    adapter,
                    screenshot,
                    operator=NativeOperatorObservation(adapter),
                )

        self.assertEqual(snapshot.call_count, 2)
        actions.assert_not_called()
        session.save_screenshot.assert_not_called()

    def test_keyboard_focus_identity_excludes_mutable_control_state(
        self,
    ) -> None:
        baseline = NativeControlSnapshot(
            kind="text-input",
            title="Composer",
            value="before",
            window_count=1,
            dialog_count=0,
            frontmost=True,
            main_window=True,
            focused_window=True,
            actual_frontmost_pid=41,
            platform_role="AXTextArea",
            platform_subrole="",
        )
        mutable_state_changed = NativeControlSnapshot(
            kind="text-input",
            title="Composer",
            value="after",
            window_count=2,
            dialog_count=1,
            frontmost=True,
            main_window=True,
            focused_window=True,
            actual_frontmost_pid=41,
            platform_role="AXTextArea",
            platform_subrole="",
        )
        focus_changed = NativeControlSnapshot(
            kind="button",
            title="Send",
            frontmost=True,
            main_window=True,
            focused_window=True,
            actual_frontmost_pid=41,
            platform_role="AXButton",
            platform_subrole="",
        )

        self.assertEqual(
            MacOSNativeDesktopAdapter.keyboard_focus_identity(
                baseline
            ),
            MacOSNativeDesktopAdapter.keyboard_focus_identity(
                mutable_state_changed
            ),
        )
        self.assertNotEqual(
            MacOSNativeDesktopAdapter.keyboard_focus_identity(
                baseline
            ),
            MacOSNativeDesktopAdapter.keyboard_focus_identity(
                focus_changed
            ),
        )

    def test_operator_focus_waits_for_two_stable_ax_samples(self) -> None:
        transient = {"actualFrontmostPid": 41, "role": "", "subrole": ""}
        stable = {**transient, "role": "AXWebArea"}
        probe = observation_probe([transient, stable, stable])
        result = probe["observe_native"]("operator-panel", 42, 1.0, 0.05)
        self.assertEqual(result["operator"]["control"]["role"], "AXWebArea")
        self.assertEqual(result["panel"], {"processId": 42, "present": True})
        self.assertEqual(probe["read_control"].call_count, 3)
        self.assertEqual(probe["time"].sleep.call_count, 2)
        probe["panel_presence"].assert_called_once_with(42)

    def test_operator_focus_accepts_stable_absence_of_focused_control(
        self,
    ) -> None:
        control = {"actualFrontmostPid": 41, "role": "", "subrole": ""}
        probe = observation_probe([control, control])
        result = probe["observe_native"]("operator", 0, 1.0, 0.05)
        self.assertEqual(result["operator"]["control"], control)
        self.assertEqual(probe["read_control"].call_count, 2)
        probe["panel_presence"].assert_not_called()

    def test_operator_focus_rejects_stale_frontmost_pid_immediately(
        self,
    ) -> None:
        probe = observation_probe([{"actualFrontmostPid": 42}])
        with self.assertRaises(probe["ObservationFailure"]) as caught:
            probe["observe_native"]("operator", 41, 1.0, 0.05)
        self.assertIn("frontmost process changed", caught.exception.details["reason"])
        probe["read_control"].assert_called_once_with(41, deadline=1.0)
        probe["panel_presence"].assert_not_called()

    def test_operator_focus_rejects_unstable_ax_samples(self) -> None:
        first = {"actualFrontmostPid": 41, "role": "", "subrole": ""}
        second = {**first, "role": "AXTextArea"}
        for controls, times in (
            ([first, second], [0.0, 2.0]),
            ([first, first], [0.0, 2.0]),
        ):
            with self.subTest(controls=controls):
                probe = observation_probe(controls)
                probe["time"].monotonic.side_effect = times
                with self.assertRaises(probe["ObservationFailure"]) as caught:
                    probe["observe_native"]("operator", 41, 1.0, 0.05)
                self.assertIn("did not stabilize", caught.exception.details["reason"])
                probe["pointer_location"].assert_not_called()

    def test_combined_operator_and_panel_uses_one_bounded_current_probe(self) -> None:
        adapter = MacOSNativeDesktopAdapter()
        response = {
            "operator": {
                "processId": 41, "pointer": {"x": 100.0, "y": 200.0},
                "control": {"actualFrontmostPid": 41},
            },
            "panel": {"processId": 42, "present": True},
        }
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=SimpleNamespace(stdout=json.dumps(response)),
        ) as run:
            first = adapter.snapshot_operator_and_file_chooser(42)
            response["panel"]["present"] = False
            run.return_value.stdout = json.dumps(response)
            second = adapter.snapshot_operator_and_file_chooser(42)
        self.assertTrue(first.file_chooser.present)
        self.assertFalse(second.file_chooser.present)
        self.assertEqual(run.call_count, 2)
        for invocation in run.call_args_list:
            self.assertEqual(invocation.args[0][3:5], ("operator-panel", "42"))
            self.assertEqual(invocation.kwargs["timeout"], 3)
        self.assertEqual(first.operator_state["frontmostPid"], 41)

    def test_complete_native_probe_initializes_with_mode_and_pid_arguments(self) -> None:
        library = Mock()
        library.AXUIElementCreateApplication.return_value = 1
        names = {}

        def create_string(_allocator, content, _encoding):
            key = len(names) + 10
            names[key] = content
            return key

        def read_attribute(_element, key, output):
            if names[key] == b"AXWindows":
                output._obj.value = 2
                return 0
            return -25205

        library.CFStringCreateWithCString.side_effect = create_string
        library.AXUIElementCopyAttributeValue.side_effect = read_attribute
        library.AXUIElementSetMessagingTimeout.return_value = 0
        library.CFGetTypeID.return_value = 2
        library.CFArrayGetTypeID.return_value = 2
        library.CFArrayGetCount.return_value = 0
        library.CGEventCreate.return_value = 1
        library.CGEventGetLocation.return_value = SimpleNamespace(x=100.0, y=200.0)
        application = Mock(spec=["processIdentifier"])
        application.processIdentifier.return_value = 41
        workspace = Mock(spec=["frontmostApplication"])
        workspace.frontmostApplication.return_value = application
        appkit = SimpleNamespace(NSWorkspace=SimpleNamespace(
            sharedWorkspace=lambda: workspace,
        ))
        for mode, process_id in (("operator", 0), ("control", 42), ("pointer", 0)):
            with self.subTest(mode=mode):
                output = io.StringIO()
                with patch("ctypes.CDLL", return_value=library), patch.dict(
                    sys.modules, {"AppKit": appkit},
                ), patch.object(sys, "argv", [
                    "probe", mode, str(process_id), str(time.monotonic() + 1.0), "0.05",
                ]), redirect_stdout(output):
                    exec(_NATIVE_OBSERVATION_PROBE, {})
                result = json.loads(output.getvalue())
                self.assertNotIn("error", result)
                if mode == "operator":
                    self.assertEqual(result["operator"]["processId"], 41)
                    self.assertEqual(result["operator"]["pointer"], {"x": 100.0, "y": 200.0})
                elif mode == "control":
                    self.assertEqual(result["control"]["actualFrontmostPid"], 41)
                else:
                    self.assertEqual(result["pointer"], {"x": 100.0, "y": 200.0})
        library.AXUIElementCreateApplication.assert_any_call(42)
        library.CFRelease.assert_any_call(1)

    def test_accessible_window_wait_uses_native_startup_budget(self) -> None:
        default = inspect.signature(
            NativeDesktopMacOSProvisioner._await_accessible_window
        ).parameters["timeout_seconds"].default

        self.assertEqual(default, 30.0)

    def test_accessible_window_wait_preserves_missing_window_failure(self) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.window_state.return_value = {"windowCount": 0}

        with self.assertRaisesRegex(BlockedError, "available within 0.0s"):
            NativeDesktopMacOSProvisioner._await_accessible_window(
                adapter, 42, timeout_seconds=0, interval_seconds=0,
            )

        adapter.window_state.assert_called_once_with(42)
        adapter.position_main_window.assert_not_called()

    def test_accessible_window_wait_does_not_retry_inspection_errors(self) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.window_state.side_effect = DriverError("AXWindows inspection failed")

        with self.assertRaisesRegex(DriverError, "AXWindows inspection failed"):
            NativeDesktopMacOSProvisioner._await_accessible_window(
                adapter, 42, timeout_seconds=1, interval_seconds=0,
            )

        adapter.window_state.assert_called_once_with(42)

    def test_window_bounds_wait_uses_native_startup_budget(self) -> None:
        default = inspect.signature(
            NativeDesktopMacOSProvisioner._await_window_bounds
        ).parameters["timeout_seconds"].default

        self.assertEqual(default, 30.0)

    def test_webview_focus_clicks_process_owned_point(self) -> None:
        session = Mock()
        session.driver.execute_script.side_effect = [False, True]
        adapter = Mock(spec=MacOSNativeDesktopAdapter)

        focused = NativeDesktopMacOSProvisioner._await_webview_focus(
            session,
            adapter,
            activation_point=(640.0, 400.0),
            timeout_seconds=1,
            interval_seconds=0,
        )

        self.assertTrue(focused)
        self.assertEqual(adapter.post_mouse.call_count, 2)
        adapter.post_mouse.assert_called_with(
            (MouseAction.LEFT_DOWN, MouseAction.LEFT_UP),
            (640.0, 400.0),
        )

    def test_window_bounds_wait_retries_transient_visibility(self) -> None:
        transient = BlockedError(
            reason=(
                "macOS runtime-cell window bounds probe failed: "
                "no visible process-owned window"
            ),
            resource="runtime-cell-window-bounds",
        )
        bounds = {
            "left": 0.0,
            "top": 0.0,
            "width": 1280.0,
            "height": 720.0,
        }

        with patch.object(
            NativeDesktopMacOSProvisioner,
            "_json_probe",
            side_effect=(transient, bounds),
        ) as probe:
            result = NativeDesktopMacOSProvisioner._await_window_bounds(
                42,
                timeout_seconds=1,
                interval_seconds=0,
            )

        self.assertEqual(result, bounds)
        self.assertEqual(probe.call_count, 2)

    def test_window_bounds_probe_accepts_acceptance_window_level(
        self,
    ) -> None:
        self.assertIn("kCGWindowListOptionOnScreenOnly", _WINDOW_BOUNDS_PROBE)
        self.assertIn("kCGWindowOwnerPID", _WINDOW_BOUNDS_PROBE)
        self.assertIn("kCGWindowAlpha", _WINDOW_BOUNDS_PROBE)
        self.assertNotIn("kCGWindowLayer", _WINDOW_BOUNDS_PROBE)

    def test_window_bounds_wait_fails_closed_after_timeout(self) -> None:
        transient = BlockedError(
            reason=(
                "macOS runtime-cell window bounds probe failed: "
                "no visible process-owned window"
            ),
            resource="runtime-cell-window-bounds",
        )

        with patch.object(
            NativeDesktopMacOSProvisioner,
            "_json_probe",
            side_effect=transient,
        ) as probe, self.assertRaisesRegex(
            BlockedError,
            "did not become visible within 0.0s",
        ):
            NativeDesktopMacOSProvisioner._await_window_bounds(
                42,
                timeout_seconds=0,
                interval_seconds=0,
            )

        probe.assert_called_once()

    def test_window_bounds_wait_does_not_retry_other_probe_errors(
        self,
    ) -> None:
        failure = BlockedError(
            reason="macOS runtime-cell window bounds probe failed: Quartz error",
            resource="runtime-cell-window-bounds",
        )

        with patch.object(
            NativeDesktopMacOSProvisioner,
            "_json_probe",
            side_effect=failure,
        ) as probe, self.assertRaisesRegex(BlockedError, "Quartz error"):
            NativeDesktopMacOSProvisioner._await_window_bounds(
                42,
                timeout_seconds=1,
                interval_seconds=0,
            )

        probe.assert_called_once()

    def test_window_sample_ignores_transparent_little_endian_surface(
        self,
    ) -> None:
        self.assertFalse(
            _pixel_buffer_has_visible_alpha(
                bytes(
                    (
                        0,
                        0,
                        0,
                        0,
                        10,
                        20,
                        30,
                        0,
                        0,
                        0,
                        0,
                        0,
                        1,
                        2,
                        3,
                        0,
                    )
                ),
                width=2,
                height=2,
                bits_per_pixel=32,
                bytes_per_row=8,
                alpha_info=2,
                bitmap_info=0x2000,
            )
        )

    def test_window_sample_accepts_visible_little_endian_surface(
        self,
    ) -> None:
        self.assertTrue(
            _pixel_buffer_has_visible_alpha(
                bytes((10, 20, 30, 255)),
                width=1,
                height=1,
                bits_per_pixel=32,
                bytes_per_row=4,
                alpha_info=2,
                bitmap_info=0x2000,
            )
        )
        self.assertTrue(
            _pixel_buffer_has_visible_alpha(
                bytes((255, 10, 20, 30)),
                width=1,
                height=1,
                bits_per_pixel=32,
                bytes_per_row=4,
                alpha_info=1,
                bitmap_info=0x2000,
            )
        )

    def test_window_sample_without_alpha_is_conservatively_visible(
        self,
    ) -> None:
        self.assertTrue(
            _pixel_buffer_has_visible_alpha(
                bytes((10, 20, 30, 40)),
                width=1,
                height=1,
                bits_per_pixel=32,
                bytes_per_row=4,
                alpha_info=0,
                bitmap_info=0,
            )
        )

    def test_media_permission_targets_positive_webkit_action_by_process(
        self,
    ) -> None:
        adapter = MacOSNativeDesktopAdapter(
            NativeInputMode.EXCLUSIVE_NATIVE_INPUT
        )
        completed = Mock(returncode=0, stdout="pressed\n", stderr="")

        with patch.object(
            adapter,
            "activate_process",
        ) as activate, patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=completed,
        ) as run:
            self.assertTrue(
                adapter.accept_media_capture_permission_to_process(42)
            )

        command = run.call_args.args[0]
        activate.assert_called_once_with(42)
        self.assertEqual(command[:2], ("osascript", "-e"))
        self.assertIn("unix id is 42", command[2])
        self.assertIn('"action-button-1"', command[2])
        self.assertNotIn('button "Allow"', command[2])
        self.assertNotIn("repeat 40 times", command[2])

    def test_media_permission_survives_transient_frontmost_rejection(
        self,
    ) -> None:
        adapter = MacOSNativeDesktopAdapter(
            NativeInputMode.EXCLUSIVE_NATIVE_INPUT
        )
        completed = Mock(returncode=0, stdout="pressed\n", stderr="")

        with patch.object(
            adapter,
            "activate_process",
            side_effect=DriverError(
                "Native actor process 42 did not become frontmost"
            ),
        ), patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=completed,
        ):
            self.assertTrue(
                adapter.accept_media_capture_permission_to_process(42)
            )

    def test_media_permission_timeout_is_a_retryable_miss(self) -> None:
        adapter = MacOSNativeDesktopAdapter(
            NativeInputMode.EXCLUSIVE_NATIVE_INPUT
        )

        with patch.object(
            adapter,
            "activate_process",
        ) as activate, patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            side_effect=subprocess.TimeoutExpired(
                ("osascript", "-e", "script"),
                2,
            ),
        ):
            self.assertFalse(
                adapter.accept_media_capture_permission_to_process(42)
            )
        activate.assert_called_once_with(42)

    def test_default_adapter_blocks_global_input_before_activation(self) -> None:
        adapter = MacOSNativeDesktopAdapter()

        with self.assertRaisesRegex(
            BlockedError,
            "NATIVE_INPUT_ISOLATION_REQUIRED",
        ):
            adapter.activate_process(42)
        with self.assertRaisesRegex(
            BlockedError,
            "NATIVE_INPUT_ISOLATION_REQUIRED",
        ):
            adapter.post_mouse((MouseAction.MOVE,), (100.0, 200.0))
        with self.assertRaisesRegex(
            BlockedError,
            "NATIVE_INPUT_ISOLATION_REQUIRED",
        ), patch.object(adapter, "_event_frameworks") as frameworks:
            adapter.post_scroll((100.0, 200.0), delta_y=300)
        frameworks.assert_not_called()

    def test_scroll_releases_created_event_when_pointer_delivery_fails(self) -> None:
        adapter = MacOSNativeDesktopAdapter(NativeInputMode.EXCLUSIVE_NATIVE_INPUT)
        graphics, foundation = Mock(), Mock()
        graphics.CGEventCreateScrollWheelEvent2.return_value = 73
        with patch.object(adapter, "_event_frameworks", return_value=(graphics, foundation)), \
                patch.object(adapter, "post_mouse", side_effect=DriverError("pointer failed")):
            with self.assertRaisesRegex(DriverError, "pointer failed"):
                adapter.post_scroll((100.0, 200.0), delta_y=300)
        foundation.CFRelease.assert_called_once_with(73)
        graphics.CGEventPost.assert_not_called()

    def test_exclusive_adapter_keeps_native_input_available(self) -> None:
        adapter = MacOSNativeDesktopAdapter(
            NativeInputMode.EXCLUSIVE_NATIVE_INPUT
        )
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            side_effect=(
                Mock(returncode=0, stdout="{}", stderr=""),
                Mock(returncode=0, stdout='{"operation":"activate"}', stderr=""),
                Mock(
                    returncode=0,
                    stdout=(
                        '{"windowCount":1,"sheetCount":0,"frontmost":true,'
                        '"mainWindow":true,"focusedWindow":true,'
                        '"actualFrontmostPid":42}'
                    ),
                    stderr="",
                ),
            ),
        ) as run:
            adapter.activate_process(42)

        self.assertEqual(run.call_count, 3)

    def test_focus_wait_retries_until_exact_process_owns_focus(self) -> None:
        wrong = NativeControlSnapshot(
            window_count=1,
            frontmost=False,
            actual_frontmost_pid=41,
        )
        accepted = NativeControlSnapshot(
            window_count=1,
            frontmost=True,
            actual_frontmost_pid=42,
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.side_effect = [wrong, accepted]
        control = NativeDesktopMacOSProvisioner._await_focused_process(
            adapter,
            42,
            timeout_seconds=1,
            interval_seconds=0,
        )
        self.assertEqual(control.actual_frontmost_pid, 42)
        self.assertEqual(adapter.activate_process.call_count, 1)

    def test_focus_wait_preserves_already_focused_process(self) -> None:
        accepted = NativeControlSnapshot(
            window_count=1,
            frontmost=True,
            actual_frontmost_pid=42,
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.return_value = accepted

        control = NativeDesktopMacOSProvisioner._await_focused_process(
            adapter,
            42,
            timeout_seconds=1,
            interval_seconds=0,
        )

        self.assertEqual(control.actual_frontmost_pid, 42)
        adapter.activate_process.assert_not_called()

    def test_focus_wait_accepts_nsworkspace_pid_without_ax_window(self) -> None:
        accepted = NativeControlSnapshot(
            window_count=0,
            frontmost=False,
            actual_frontmost_pid=42,
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.return_value = accepted

        control = NativeDesktopMacOSProvisioner._await_focused_process(
            adapter,
            42,
            timeout_seconds=1,
            interval_seconds=0,
        )

        self.assertEqual(control.actual_frontmost_pid, 42)
        adapter.activate_process.assert_not_called()

    def test_focus_wait_clicks_an_owned_window_before_activation(self) -> None:
        wrong = NativeControlSnapshot(
            window_count=1,
            frontmost=False,
            actual_frontmost_pid=41,
        )
        accepted = NativeControlSnapshot(
            window_count=1,
            frontmost=True,
            actual_frontmost_pid=42,
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.side_effect = [wrong, accepted]

        control = NativeDesktopMacOSProvisioner._await_focused_process(
            adapter,
            42,
            timeout_seconds=1,
            interval_seconds=0,
            activation_point=(640.0, 400.0),
        )

        self.assertEqual(control.actual_frontmost_pid, 42)
        adapter.post_mouse.assert_called_once_with(
            (MouseAction.LEFT_DOWN, MouseAction.LEFT_UP),
            (640.0, 400.0),
        )
        adapter.activate_process.assert_not_called()

    def test_focus_wait_retries_transient_activation_rejection(self) -> None:
        wrong = NativeControlSnapshot(
            window_count=1,
            frontmost=False,
            actual_frontmost_pid=41,
        )
        accepted = NativeControlSnapshot(
            window_count=1,
            frontmost=True,
            actual_frontmost_pid=42,
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.activate_process.side_effect = [
            DriverError("Native actor process 42 did not become frontmost"),
            None,
        ]
        adapter.focused_control.side_effect = [wrong, accepted]

        control = NativeDesktopMacOSProvisioner._await_focused_process(
            adapter,
            42,
            timeout_seconds=1,
            interval_seconds=0,
        )

        self.assertEqual(control.actual_frontmost_pid, 42)
        self.assertEqual(adapter.activate_process.call_count, 2)

    def test_appkit_rejection_does_not_skip_accessibility_activation(self) -> None:
        self.assertNotIn("if not request_accepted:", _ACTIVATION_PROBE)

    def test_focus_wait_fails_closed_without_exact_process_focus(
        self,
    ) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.return_value = NativeControlSnapshot(
            window_count=1,
            frontmost=False,
            actual_frontmost_pid=41,
        )
        with self.assertRaisesRegex(
            BlockedError,
            "did not reach exact-PID focus",
        ):
            NativeDesktopMacOSProvisioner._await_focused_process(
                adapter,
                42,
                timeout_seconds=0,
                interval_seconds=0,
            )

    def test_point_probe_uses_unoccluded_process_owned_interior_point(
        self,
    ) -> None:
        process_id = 42
        notification = NativeWindowSnapshot(
            index=0,
            owner_pid=100,
            owner_name="UserNotificationCenter",
            window_name="",
            layer=8,
            alpha=1,
            bounds=NativeWindowBounds(
                left=400,
                top=200,
                width=200,
                height=300,
            ),
        )
        target = NativeWindowSnapshot(
            index=1,
            owner_pid=process_id,
            owner_name="peers-touch-desktop",
            window_name="Peers",
            layer=0,
            alpha=1,
            bounds=NativeWindowBounds(
                left=0,
                top=0,
                width=1000,
                height=800,
            ),
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.window_stack_at_point.side_effect = (
            NativeWindowStack(windows=(notification, target)),
            NativeWindowStack(windows=(target,)),
        )
        with patch.object(
            adapter,
            "pointer_location",
            side_effect=(
                {"x": 500, "y": 400},
                {"x": 250, "y": 600},
            ),
        ):
            point, pointer, stack, input_probe, attempted_points = (
                NativeDesktopMacOSProvisioner._probe_owned_point(
                    adapter,
                    process_id,
                    {
                        "left": 0,
                        "top": 0,
                        "width": 1000,
                        "height": 800,
                    },
                )
            )

        self.assertEqual(point, (250, 600))
        self.assertEqual(pointer, {"x": 250, "y": 600})
        self.assertTrue(input_probe)
        self.assertTrue(stack.point_owned_by(process_id))
        self.assertEqual(
            adapter.post_mouse.call_args_list,
            [
                call((MouseAction.MOVE,), (500, 400)),
                call((MouseAction.MOVE,), (250, 600)),
            ],
        )
        self.assertEqual(attempted_points[0], (500, 400))

    def test_ready_persists_valid_lease_and_stop_cleans_it(self) -> None:
        digest = "a" * 64
        source = CellSourceIdentity(
            mode="local-worktree",
            commit="source-commit",
            workspace_digest="clean",
            remote_source_digest=digest,
            remote_checkout_clean=True,
            binary_sha256=digest,
        )
        platform_identity = CellPlatformIdentity(
            os="macos",
            host_distribution="macOS test",
            host_kernel="test-kernel",
            isolation_kind="host",
            image_digest="",
            distribution="macOS test",
            architecture="arm64",
            webview_backend="WKWebView",
            webview_version="test",
        )
        transport = CellTransportIdentity(
            kind="local",
            host_identity_sha256=digest,
            host_key_sha256=digest,
            webdriver_local_port=0,
            webdriver_remote_port=0,
        )
        display = CellDisplayIdentity(
            session_type="native-macos",
            display_id="main",
            seat="console",
            width=1920,
            height=1080,
            connected_output=True,
            desktop_user_identity_sha256=digest,
        )
        adapter = CellAdapterIdentity(
            input_backend="coregraphics-events",
            window_backend="appkit-accessibility",
            screenshot_backend="coregraphics-screencapture",
            input_probe=True,
            focus_probe=True,
            point_ownership_probe=True,
            screenshot_probe=True,
        )
        with tempfile.TemporaryDirectory() as directory:
            lifecycle = NativeDesktopMacOSProvisioner(
                state_root=Path(directory),
            )
            lifecycle._acceptance_binary = Path(directory) / "binary"
            lifecycle._acceptance_binary.write_bytes(b"probe")
            with patch(
                "tooling.acceptance.provisioners.native_desktop_macos."
                "sys.platform",
                "darwin",
            ), patch.object(
                lifecycle,
                "_source_identity",
                return_value=source,
            ), patch.object(
                lifecycle,
                "_host_identity",
                return_value=(platform_identity, transport, display),
            ), patch.object(
                lifecycle,
                "_probe_native_adapter",
                return_value=(adapter, 45123),
            ), patch(
                "tooling.acceptance.provisioners.native_desktop_macos.source_identity",
                return_value={"commit": source.commit, "workspaceDigest": source.workspace_digest},
            ), patch(
                "tooling.acceptance.provisioners.native_desktop_macos._file_sha256",
                return_value=source.binary_sha256,
            ):
                manifest = lifecycle.ready("synthetic-gate")

            self.assertEqual(manifest.state, RuntimeCellState.LEASED)
            self.assertEqual(
                manifest.transport.webdriver_local_port,
                45123,
            )
            self.assertEqual(
                lifecycle.status()["state"],
                RuntimeCellState.LEASED.value,
            )
            with self.assertRaises(BlockedError):
                lifecycle.ready("second-gate")
            cleanup = lifecycle.stop()
            self.assertTrue(cleanup["clean"])
            self.assertEqual(
                lifecycle.status()["state"],
                RuntimeCellState.CLEANED.value,
            )

    def test_failed_probe_removes_preparing_lease(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lifecycle = NativeDesktopMacOSProvisioner(
                state_root=Path(directory),
            )
            with patch(
                "tooling.acceptance.provisioners.native_desktop_macos."
                "sys.platform",
                "darwin",
            ), patch.object(
                lifecycle,
                "_source_identity",
                side_effect=RuntimeError("probe failed"),
            ):
                with self.assertRaisesRegex(RuntimeError, "probe failed"):
                    lifecycle.ready("synthetic-gate")
            self.assertFalse(lifecycle.state_path.exists())


if __name__ == "__main__":
    unittest.main()
