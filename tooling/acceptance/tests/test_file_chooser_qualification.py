from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tooling.acceptance.core.errors import (
    BlockedError, DriverError, ProvisioningError,
)
from tooling.acceptance.core.runtime_cell import (
    CellFileChooserIdentity, CellNonInterferenceIdentity,
)
from tooling.acceptance.drivers.native.base import (
    NativeControlSnapshot, NativeDesktopObservation, NativeFileChooserSnapshot,
    NativeInputMode, NativeOperatorObservation,
)
from tooling.acceptance.drivers.native.macos import MacOSNativeDesktopAdapter
from tooling.acceptance.drivers.native.runtime import LocalMacOSRuntimeBinding
from tooling.acceptance.gates.chat.native_file_picker import select_native_file
from tooling.acceptance.provisioners.native_desktop_macos import NativeDesktopMacOSProvisioner


BASELINE = {
    "frontmostPid": 41, "pointerX": 100.0, "pointerY": 200.0,
    "keyboardFocusSha256": "b" * 64,
}


def qualifier(binary_hash: str = "c" * 64) -> CellFileChooserIdentity:
    identity = CellNonInterferenceIdentity(
        41, 41, 100.0, 200.0, 100.0, 200.0, "b" * 64, "b" * 64,
    )
    return CellFileChooserIdentity(
        "desktop-macos-native", "cell-run", "candidate", "clean", binary_hash,
        "macos-accessibility", 42, "a" * 64, "a" * 64, "d" * 64, "d" * 64,
        (False, True, False), (identity,) * 6,
    )


def source(binary_hash: str = "c" * 64) -> dict[str, str]:
    return {"commit": "candidate", "workspaceDigest": "clean", "binarySha256": binary_hash}


class FileChooserQualificationTests(unittest.TestCase):
    def test_closed_descriptor_rejects_missing_extra_reordered_and_unclosed_data(self) -> None:
        valid = qualifier().to_dict()
        CellFileChooserIdentity.from_dict(valid).validate(
            cell_id="desktop-macos-native", run_id="cell-run", source=source(),
        )
        mutations = []
        for name in valid:
            mutations.append({key: value for key, value in valid.items() if key != name})
        mutations.extend((
            {**valid, "pass": True},
            {**valid, "observations": list(reversed(valid["observations"]))},
            {**valid, "observations": valid["observations"][:-1]},
            {**valid, "panelPresence": [False, True, True]},
            {**valid, "panelPresence": [False, False, False]},
            {**valid, "panelPresence": [True, True, False]},
            {**valid, "panelPresence": [0, 1, 0]},
            {**valid, "windowCounts": [1, 2, 1]},
            {**valid, "dialogCounts": [0, 1, 0]},
            {**valid, "targetProcessId": True},
            {**valid, "selectedPathSha256": "e" * 64},
            {**valid, "selectedFileSha256": "e" * 64},
        ))
        for mutation in mutations:
            with self.subTest(keys=list(mutation)):
                with self.assertRaises(ProvisioningError):
                    CellFileChooserIdentity.from_dict(mutation).validate(
                        cell_id="desktop-macos-native", run_id="cell-run", source=source(),
                    )

    def test_each_phase_preserves_one_distinct_operator_and_current_cell_source(self) -> None:
        valid = qualifier()
        for index in range(6):
            for changed in (
                replace(valid.observations[index], frontmost_pid_after=42),
                replace(valid.observations[index], pointer_x_after=101.0),
                replace(valid.observations[index], pointer_x_after=float("nan")),
                replace(valid.observations[index], keyboard_focus_after_sha256="e" * 64),
                replace(valid.observations[index], keyboard_focus_before_sha256="e" * 64,
                        keyboard_focus_after_sha256="e" * 64),
            ):
                samples = list(valid.observations)
                samples[index] = changed
                with self.subTest(index=index, changed=changed):
                    with self.assertRaises(ProvisioningError):
                        replace(valid, observations=tuple(samples)).validate(
                            cell_id=valid.cell_id, run_id=valid.run_id, source=source(),
                        )
        for values in (
            {"cell_id": "another-cell"}, {"run_id": "another-run"},
            {"source": {**source(), "commit": "another-candidate"}},
            {"source": {**source(), "workspaceDigest": "sha256:" + "e" * 64}},
            {"source": source("e" * 64)},
        ):
            with self.subTest(values=values), self.assertRaises(ProvisioningError):
                valid.validate(**{"cell_id": valid.cell_id, "run_id": valid.run_id,
                                  "source": source(), **values})
        with self.assertRaises(ProvisioningError):
            replace(valid, target_process_id=41).validate(
                cell_id=valid.cell_id, run_id=valid.run_id, source=source(),
            )

    def test_operator_failure_cannot_be_cleared_by_a_later_matching_sample(self) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.snapshot_operator_state.side_effect = (
            BASELINE, {**BASELINE, "frontmostPid": 42}, BASELINE,
        )
        observation = NativeOperatorObservation(adapter)
        with self.assertRaises(BlockedError) as first:
            observation.sample("opened", target_process_id=43)
        with self.assertRaises(BlockedError) as later:
            observation.sample("closed", target_process_id=43)
        self.assertIs(first.exception, later.exception)
        self.assertEqual(adapter.snapshot_operator_state.call_count, 2)

    def test_operator_baseline_and_samples_have_no_consumer_write_authority(self) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.snapshot_operator_state.return_value = BASELINE
        observation = NativeOperatorObservation(adapter)
        with self.assertRaises(TypeError):
            observation.baseline["frontmostPid"] = 42
        with self.assertRaises(AttributeError):
            observation.baseline = {**BASELINE, "frontmostPid": 42}
        observation.sample("opened", target_process_id=42)
        with self.assertRaises(TypeError):
            observation.observations["opened"] = qualifier().observations[0]
        self.assertEqual(observation.baseline["frontmostPid"], 41)

    def test_unavailable_operator_sample_remains_failed_after_recovery(self) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        unavailable = BlockedError(reason="bounded AX sample failed", resource="runtime-cell-operator-focus")
        adapter.snapshot_operator_state.side_effect = (BASELINE, unavailable, BASELINE)
        observation = NativeOperatorObservation(adapter)
        for phase in ("opened", "closed"):
            with self.assertRaises(BlockedError) as caught:
                observation.sample(phase, target_process_id=42)
            self.assertIs(caught.exception, unavailable)
        self.assertEqual(adapter.snapshot_operator_state.call_count, 2)

    def test_binding_requires_same_cell_qualification_and_unchanged_binary(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            binary = Path(raw) / "desktop"
            binary.write_bytes(b"qualified-source-binary")
            digest = hashlib.sha256(binary.read_bytes()).hexdigest()
            binding = object.__new__(LocalMacOSRuntimeBinding)
            binding._native_adapter = Mock(spec=MacOSNativeDesktopAdapter)
            binding._native_adapter.input_mode = NativeInputMode.SEMANTIC_NON_INTRUSIVE
            binding._binary, binding._binary_sha256 = binary, digest
            binding._prepared_cell = {
                "runId": "cell-run", "source": source(digest),
                "nativeAdapter": {"fileChooser": qualifier(digest).to_dict()},
            }
            with patch.object(binding, "_verify_source_snapshot"):
                binding.begin_file_chooser()
                binding._native_adapter.observe_operator.assert_called_once()
                for changed in (
                    None, {**qualifier(digest).to_dict(), "runId": "foreign-run"},
                    {**qualifier(digest).to_dict(), "backend": "foreign-driver"},
                ):
                    binding._prepared_cell["nativeAdapter"]["fileChooser"] = changed
                    with self.assertRaises(BlockedError):
                        binding.begin_file_chooser()
                binding._prepared_cell["nativeAdapter"]["fileChooser"] = qualifier(digest).to_dict()
                binary.write_bytes(b"changed-binary")
                with self.assertRaises(BlockedError):
                    binding.begin_file_chooser()
            with patch.object(binding, "_verify_source_snapshot", side_effect=DriverError("source drift")):
                with self.assertRaisesRegex(DriverError, "source drift"):
                    binding.begin_file_chooser()
            self.assertEqual(binding._native_adapter.observe_operator.call_count, 1)

    def test_shared_picker_uses_real_selector_and_process_primitive_without_global_input(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            fixture = Path(raw) / "file.txt"
            fixture.write_bytes(b"fixture")
            digest = hashlib.sha256(fixture.read_bytes()).hexdigest()
            adapter = Mock(spec=MacOSNativeDesktopAdapter)
            adapter.snapshot_operator_state.return_value = BASELINE
            adapter.focused_control.return_value = NativeControlSnapshot(window_count=1)
            adapter.snapshot_operator_and_file_chooser.side_effect = (
                NativeDesktopObservation(BASELINE, NativeFileChooserSnapshot(42, False)),
                NativeDesktopObservation(BASELINE, NativeFileChooserSnapshot(42, True)),
                NativeDesktopObservation(BASELINE, NativeFileChooserSnapshot(42, False)),
            )
            adapter.select_file_chooser_path_to_process.return_value = NativeControlSnapshot(
                kind="file-selection", value=str(fixture), window_count=1,
            )
            binding = SimpleNamespace(
                native_adapter=adapter,
                begin_file_chooser=Mock(return_value=NativeOperatorObservation(adapter)),
                stage_native_file=Mock(return_value=fixture),
                native_file_sha256=Mock(return_value=digest),
                request_cooperative_activation=Mock(),
            )
            element = Mock()
            client = SimpleNamespace(
                process_id=42, driver=Mock(), find_elements=Mock(return_value=[element]),
                semantic_click=Mock(),
            )
            result = select_native_file(
                actor="actor", client=client, sessions=(client,),
                runtime_binding=binding, source_path=fixture, trigger_selector="[data-real-trigger]",
                timeout_seconds=0.1,
            )
            self.assertEqual(result, {"name": "file.txt", "size": 7})
            client.find_elements.assert_called_with("[data-real-trigger]")
            client.semantic_click.assert_called_once_with(element)
            adapter.select_file_chooser_path_to_process.assert_called_once_with(42, str(fixture))
            binding.request_cooperative_activation.assert_not_called()
            for name in (
                "activate_process", "post_key", "post_mouse", "write_clipboard",
                "read_clipboard", "reveal_file_chooser_location",
            ):
                getattr(adapter, name).assert_not_called()

    def test_parent_observes_native_command_commit_and_exact_fixture(self) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.snapshot_operator_state.return_value = BASELINE
        adapter.focused_control.return_value = NativeControlSnapshot(window_count=1)
        adapter.snapshot_operator_and_file_chooser.side_effect = (
            NativeDesktopObservation(BASELINE, NativeFileChooserSnapshot(42, False)),
            NativeDesktopObservation(BASELINE, NativeFileChooserSnapshot(42, True)),
            NativeDesktopObservation(BASELINE, NativeFileChooserSnapshot(42, False)),
        )
        session = Mock(process_id=42)
        picked = {}

        def select(_pid, path):
            picked["path"] = path
            return NativeControlSnapshot(kind="file-selection", value=path, window_count=1)

        adapter.select_file_chooser_path_to_process.side_effect = select
        session.execute_script.side_effect = lambda script: (
            {"pending": False, "result": {"ok": True, "data": {
                "command": "oss_pick_local_file", "status": picked["path"],
            }}}
            if script == "return window.__ptChooserQualification" else None
        )
        observation = NativeOperatorObservation(adapter)
        with tempfile.TemporaryDirectory() as raw, patch.object(Path, "home", return_value=Path(raw)):
            result = NativeDesktopMacOSProvisioner._probe_file_chooser(session, adapter, observation)
            self.assertFalse(Path(picked["path"]).exists())
        self.assertEqual(result.fixture_sha256, result.selected_file_sha256)
        self.assertEqual(result.requested_path_sha256, result.selected_path_sha256)
        self.assertEqual(result.panel_presence, (False, True, False))
        self.assertEqual(tuple(observation.observations), (
            "chooser-before", "chooser-open", "chooser-selected",
        ))
        self.assertNotIn("invoke_app_result", json.dumps(session.method_calls, default=str))

    def test_native_panel_observation_rejects_foreign_pid_invalid_types_and_probe_failure(self) -> None:
        adapter = MacOSNativeDesktopAdapter()
        for value in (
            {"processId": 43, "present": True},
            {"processId": True, "present": False},
            {"processId": 42, "present": 0},
            {"processId": 42},
            {"processId": 42, "present": False, "pass": True},
        ):
            with self.subTest(value=value), patch(
                "tooling.acceptance.drivers.native.macos.subprocess.run",
                return_value=SimpleNamespace(stdout=json.dumps({"panel": value})),
            ), self.assertRaises(BlockedError) as caught:
                adapter.file_chooser_state_to_process(42)
            self.assertEqual(caught.exception.diagnostic.to_dict()["owner"], "macos-native-driver")
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            side_effect=subprocess.TimeoutExpired("AX", 3),
        ), self.assertRaises(BlockedError):
            adapter.file_chooser_state_to_process(42)
        for present in (False, True):
            with patch(
                "tooling.acceptance.drivers.native.macos.subprocess.run",
                return_value=SimpleNamespace(stdout=json.dumps({"panel": {
                    "processId": 42, "present": present,
                }})),
            ):
                self.assertEqual(
                    adapter.file_chooser_state_to_process(42),
                    NativeFileChooserSnapshot(42, present),
                )

    def test_combined_panel_wait_preserves_baseline_phase_and_sticky_failure(self) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.snapshot_operator_state.return_value = BASELINE
        false_panel = NativeFileChooserSnapshot(42, False)
        true_panel = NativeFileChooserSnapshot(42, True)
        adapter.snapshot_operator_and_file_chooser.side_effect = (
            NativeDesktopObservation(BASELINE, false_panel),
            NativeDesktopObservation(BASELINE, true_panel),
            NativeDesktopObservation({**BASELINE, "pointerX": 101.0}, false_panel),
            NativeDesktopObservation(BASELINE, false_panel),
        )
        observation = NativeOperatorObservation(adapter)
        opened = observation.file_chooser(
            "opened", target_process_id=42, present=True,
            timeout_seconds=1.0, interval_seconds=0,
        )
        self.assertEqual(opened, true_panel)
        self.assertEqual(tuple(observation.observations), ("opened",))
        with self.assertRaises(DriverError):
            observation.file_chooser("opened", target_process_id=42, present=True)
        with self.assertRaises(BlockedError) as first:
            observation.file_chooser("closed", target_process_id=42, present=False)
        with self.assertRaises(BlockedError) as second:
            observation.sample("after-stop", target_process_id=42)
        self.assertIs(first.exception, second.exception)
        self.assertEqual(adapter.snapshot_operator_and_file_chooser.call_count, 3)
        self.assertEqual(adapter.snapshot_operator_state.call_count, 1)

    def test_operator_mismatch_during_panel_wait_stops_before_later_open(self) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.snapshot_operator_state.return_value = BASELINE
        adapter.snapshot_operator_and_file_chooser.side_effect = (
            NativeDesktopObservation(
                {**BASELINE, "frontmostPid": 43}, NativeFileChooserSnapshot(42, False),
            ),
            NativeDesktopObservation(BASELINE, NativeFileChooserSnapshot(42, True)),
        )
        observation = NativeOperatorObservation(adapter)
        with self.assertRaises(BlockedError):
            observation.file_chooser(
                "opened", target_process_id=42, present=True, timeout_seconds=1.0,
            )
        self.assertEqual(adapter.snapshot_operator_and_file_chooser.call_count, 1)

    def test_late_panel_and_unavailable_combined_read_cannot_be_retried(self) -> None:
        for unavailable in (False, True):
            with self.subTest(unavailable=unavailable):
                adapter = Mock(spec=MacOSNativeDesktopAdapter)
                adapter.snapshot_operator_state.return_value = BASELINE
                adapter.snapshot_operator_and_file_chooser.side_effect = (
                    DriverError("native read unavailable") if unavailable
                    else NativeDesktopObservation(BASELINE, NativeFileChooserSnapshot(42, True)),
                )
                observation = NativeOperatorObservation(adapter)
                with patch(
                    "tooling.acceptance.drivers.native.base.time.monotonic",
                    side_effect=(0.0, 2.0),
                ), self.assertRaises(DriverError) as first:
                    observation.file_chooser(
                        "opened", target_process_id=42, present=True,
                        timeout_seconds=1.0,
                    )
                with self.assertRaises(DriverError) as second:
                    observation.file_chooser("closed", target_process_id=42, present=False)
                self.assertIs(first.exception, second.exception)
                self.assertEqual(adapter.snapshot_operator_and_file_chooser.call_count, 1)


if __name__ == "__main__":
    unittest.main()
