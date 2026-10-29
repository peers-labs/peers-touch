"""Native probe failures preserve their origin without private AX values."""

import ast
from contextlib import redirect_stdout
import ctypes
import io
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tooling.acceptance.core import BlockedError
from tooling.acceptance.core.errors import DriverError
from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic
from tooling.acceptance.drivers.native.base import NativeOperatorObservation
from tooling.acceptance.drivers.native.macos_ax import AXReadSession, NativeAXReadUnavailable
from tooling.acceptance.drivers.native.macos import (
    MacOSNativeDesktopAdapter, _FILE_CHOOSER_SELECTION_PROBE,
    _NATIVE_AX_SUPPORT, _NATIVE_OBSERVATION_BODY, _NATIVE_OBSERVATION_PROBE,
)


def shared_reads(ax, cf, clock):
    session = object.__new__(AXReadSession)
    session.ax, session.cf = ax, cf
    session.deadline = clock.monotonic() + 2.5
    session.read_budget_seconds = 1.5
    session.read_deadline = clock.monotonic() + 1.5
    session.string = lambda name: name

    def invoke(method, *args, **kwargs):
        with patch("tooling.acceptance.drivers.native.macos_ax.time", clock):
            return getattr(session, method)(*args, **kwargs)

    return SimpleNamespace(
        copy_attribute=lambda *a, **kw: invoke("copy_attribute", *a, **kw),
        begin_observation=lambda: invoke("begin_observation"),
    )


def control_probe(replies=None, *, started=0.0):
    """Run actual AX decoding and observation with a controlled OS boundary."""
    clock = SimpleNamespace(now=started)
    clock.monotonic = lambda: clock.now
    clock.sleep = lambda seconds: setattr(clock, "now", clock.now + seconds)
    reads, releases, timeouts, applications = [], [], {}, []
    defaults = {
        "AXFocusedUIElement": (0, 23, 0.0),
        "AXWindows": (0, 22, 0.0),
        "AXSheets": (-25205, 0, 0.0),
    }
    defaults.update(replies or {})

    def native_id(element):
        return element.value if isinstance(element, ctypes.c_void_p) else element

    def read_attribute(element, name, output):
        status, value, elapsed = defaults.get(name, (0, 44, 0.0))
        reads.append((name, clock.now, timeouts.get(native_id(element), timeouts.get(42))))
        clock.now += elapsed
        output._obj.value = value
        return status

    def decode_string(value, buffer, size, encoding):
        buffer.value = b"AXTextArea"
        return True

    def create_application(pid):
        applications.append(pid)
        return 42

    namespace = {
        "ctypes": ctypes, "CFRef": ctypes.c_void_p, "UTF8": 0x08000100,
        "time": clock, "create_string": lambda name: name,
        "frontmost_pid": lambda: 41,
        "pointer_location": lambda: {"x": 100.0, "y": 200.0},
        "applications": applications,
        "application_services": SimpleNamespace(
            AXUIElementCreateApplication=create_application,
            AXUIElementSetMessagingTimeout=lambda element, seconds: (
                timeouts.__setitem__(native_id(element), seconds) or 0
            ),
            AXUIElementCopyAttributeValue=read_attribute,
        ),
        "core_foundation": SimpleNamespace(
            CFRelease=lambda item: releases.append(
                item.value if isinstance(item, ctypes.c_void_p) else item,
            ),
            CFGetTypeID=lambda item: 2 if item.value == 22 else 1,
            CFStringGetTypeID=lambda: 1, CFBooleanGetTypeID=lambda: 1,
            CFBooleanGetValue=lambda item: True,
            CFArrayGetTypeID=lambda: 2, CFArrayGetCount=lambda item: 1,
            CFArrayGetValueAtIndex=lambda item, index: 33,
            CFStringGetLength=lambda item: 10,
            CFStringGetMaximumSizeForEncoding=lambda *args: 40,
            CFStringGetCString=decode_string,
        ),
        "NativeAXReadUnavailable": NativeAXReadUnavailable,
    }
    namespace["reads"] = shared_reads(
        namespace["application_services"], namespace["core_foundation"], clock,
    )
    names = {
        "copy_attribute_result", "copy_attribute", "decode_text", "array_items",
        "copied_text", "copied_boolean", "read_control", "NativeAXReadUnavailable",
    }
    selected = ast.Module(
        body=[
            node for node in ast.parse(_NATIVE_AX_SUPPORT).body
            if getattr(node, "name", "") in names
        ],
        type_ignores=[],
    )
    exec(compile(selected, "<native-ax-support>", "exec"), namespace)
    exec(_NATIVE_OBSERVATION_BODY, namespace)
    return namespace, reads, releases


class NativeObservationDiagnosticTests(unittest.TestCase):
    def test_panel_lookup_finds_shallow_controls_before_file_list_descendants(self) -> None:
        names = {"find_path", "release_path", "open_panel"}
        support = ast.Module(body=[
            node for node in ast.parse(_NATIVE_AX_SUPPORT).body
            if getattr(node, "name", "") in names
        ], type_ignores=[])
        for scenario in ("direct-panel", "shallow-button", "absent", "unreadable", "predicate-error"):
            with self.subTest(scenario=scenario):
                tree = {1: [2], 2: [3, 4], 3: [5], 4: [], 5: [6],
                        6: [7], 7: [8], 8: []}
                arrays, released, retained, reads = [], [], [], []
                failure = RuntimeError("original native refusal")
                windows = [1]

                class NativeArray(list):
                    def __bool__(self):
                        return True

                def children(element, name, **kwargs):
                    if name == "AXWindows":
                        return windows
                    self.assertEqual(name, "AXChildren")
                    reads.append(element)
                    if element == 8 and scenario in ("shallow-button", "unreadable"):
                        raise failure
                    value = NativeArray(tree[element])
                    arrays.append(value)
                    return value

                def identifier(element, name):
                    self.assertEqual(name, "AXIdentifier")
                    if scenario == "predicate-error" and element == 4:
                        raise failure
                    if scenario == "direct-panel" and element == 1:
                        return "open-panel"
                    return "OKButton" if scenario == "shallow-button" and element == 4 else ""

                def retain(element):
                    retained.append(element)
                    return element

                namespace = {
                    "time": SimpleNamespace(monotonic=lambda: 0.0),
                    "copy_attribute": children, "copied_text": identifier,
                    "reads": SimpleNamespace(begin_observation=lambda: None),
                    "NativeAXReadUnavailable": NativeAXReadUnavailable,
                    "array_items": lambda value: value,
                    "core_foundation": SimpleNamespace(
                        CFRetain=retain, CFRelease=released.append,
                    ),
                }
                exec(compile(support, "<native-panel-lookup>", "exec"), namespace)
                if scenario in ("unreadable", "predicate-error"):
                    with self.assertRaises(RuntimeError) as caught:
                        namespace["open_panel"](42)
                    self.assertIs(caught.exception, failure)
                else:
                    panel = namespace["open_panel"](42)
                    self.assertEqual(
                        panel, 1 if scenario in ("direct-panel", "shallow-button") else None,
                    )
                    if panel is not None:
                        namespace["core_foundation"].CFRelease(panel)
                if scenario == "shallow-button":
                    self.assertNotIn(8, reads)
                    self.assertIn(4, retained)
                if scenario == "direct-panel":
                    self.assertEqual(reads, [])
                self.assertEqual(
                    sorted(item for item in released if isinstance(item, int)),
                    sorted(retained),
                )
                self.assertEqual(
                    sorted(id(item) for item in released if isinstance(item, list)),
                    sorted(id(item) for item in [windows, *arrays]),
                )

    def test_home_lookup_reads_only_sidebar_text_and_preserves_failures(self) -> None:
        selector = ast.parse(_FILE_CHOOSER_SELECTION_PROBE)
        predicate = next(
            node.value.args[0] for node in ast.walk(selector)
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "home_path"
                    for target in node.targets)
        )
        support = ast.Module(body=[
            node for node in ast.parse(_NATIVE_AX_SUPPORT).body
            if getattr(node, "name", "") in {"find_path", "release_path"}
        ], type_ignores=[])
        for sidebar, text, failed_attribute in (
            (True, "operator", None), (True, "other", None),
            (False, "operator", None), (True, "operator", "AXRole"),
            (True, "operator", "AXValue"),
        ):
            with self.subTest(sidebar=sidebar, text=text, failure=failed_attribute):
                reads, retained, released = [], [], []
                tree = {1: [2], 2: [3], 3: []}
                failure = RuntimeError("native attribute failure")

                def read_text(element, name):
                    reads.append((element, name))
                    if name == failed_attribute and element == 3:
                        raise failure
                    if name == "AXRole":
                        return {1: "AXWindow", 2: "AXOutline", 3: "AXStaticText"}[element]
                    if name == "AXDescription":
                        return "sidebar" if sidebar and element == 2 else ""
                    if name == "AXValue":
                        if element == 2 and sidebar and not failed_attribute:
                            raise RuntimeError("AXOutline value system failure")
                        return text if element == 3 else ""
                    raise AssertionError(name)

                def retain(element):
                    retained.append(element)
                    return element

                namespace = {
                    "home": SimpleNamespace(name="operator"), "copied_text": read_text,
                    "copy_attribute": lambda element, name: tree[element],
                    "array_items": lambda children: children,
                    "core_foundation": SimpleNamespace(
                        CFRetain=retain, CFRelease=released.append,
                    ),
                }
                exec(compile(support, "<native-ax-support>", "exec"), namespace)
                lookup = eval(compile(ast.Expression(predicate), "<home-predicate>", "eval"), namespace)
                if failed_attribute:
                    with self.assertRaises(RuntimeError) as caught:
                        namespace["find_path"](1, lookup)
                    self.assertIs(caught.exception, failure)
                    self.assertFalse(retained)
                else:
                    path = namespace["find_path"](1, lookup)
                    expected = (1, 2, 3) if sidebar and text == "operator" else None
                    self.assertEqual(path, expected)
                    self.assertEqual(retained, list(expected or ()))
                    namespace["release_path"](path)
                    self.assertEqual([item for item in released if isinstance(item, int)],
                                     list(expected or ()))
                self.assertEqual(
                    [(element, name) for element, name in reads if name == "AXValue"],
                    [(3, "AXValue")] if sidebar and failed_attribute != "AXRole" else [],
                )

    def test_control_reads_distinguish_optional_absence_and_native_failure(self) -> None:
        for name, status, value in (
            ("AXFocusedUIElement", -25204, 0),
            ("AXFocusedUIElement", -25202, 23),
            ("AXFocusedUIElement", 0, 0),
            ("AXWindows", -25205, 0),
            ("AXWindows", -25212, 0),
            ("AXWindows", 0, 0),
            ("AXRole", -25204, 44),
        ):
            with self.subTest(attribute=name, status=status, value=value):
                probe, reads, releases = control_probe({name: (status, value, 0.1)})
                with self.assertRaises(RuntimeError) as caught:
                    probe["read_control"](41)
                self.assertEqual(caught.exception.observed["axAttribute"], name)
                self.assertEqual(caught.exception.observed["axStatus"], status)
                self.assertEqual(caught.exception.observed["valuePresent"], bool(value))
                elapsed = caught.exception.observed["axReadElapsedSeconds"]
                self.assertGreaterEqual(elapsed, 1.5 if status == -25204 else 0.1)
                self.assertEqual(reads[-1][0], name)
                self.assertEqual(releases.count(42), 1)
                if value:
                    self.assertGreaterEqual(releases.count(value), 1)
                self.assertEqual(caught.exception.observed["actualControlRequestPid"], 41)
        for status in (-25205, -25212):
            with self.subTest(optional_status=status):
                probe, _, releases = control_probe({
                    "AXFocusedUIElement": (status, 0, 0.0),
                })
                control = probe["read_control"](41)
                self.assertEqual(control["role"], "")
                self.assertEqual(control["windowCount"], 1)
                self.assertEqual(control["sheetCount"], 0)
                self.assertTrue(control["frontmost"])
                self.assertEqual(releases.count(22), 1)
                self.assertEqual(releases.count(42), 1)
        probe, _, releases = control_probe()
        result = probe["observe_native"]("operator", 0, 1.0, 0.05)
        self.assertEqual(result["operator"]["control"]["role"], "AXTextArea")
        self.assertEqual(releases.count(23), 2)
        self.assertEqual(releases.count(22), 2)
        self.assertEqual(releases.count(42), 2)

    def test_control_failure_retains_queried_pid_through_probe_and_adapter(self) -> None:
        suffix = _NATIVE_OBSERVATION_PROBE.removeprefix(
            _NATIVE_AX_SUPPORT + _NATIVE_OBSERVATION_BODY,
        )
        for mode, caller_pid, recipient_pid, name, status, value in (
            ("operator", 0, 41, "AXFocusedUIElement", -25204, 0),
            ("operator-panel", 59, 41, "AXWindows", -25205, 0),
            ("control", 59, 59, "AXRole", -25204, 44),
            ("control", 41, 41, "AXFrontmost", -25202, 44),
        ):
            with self.subTest(mode=mode, pid=caller_pid, attribute=name):
                probe, reads, releases = control_probe({name: (status, value, 0.1)})
                probe.update({
                    "sys": SimpleNamespace(
                        argv=["probe", mode, str(caller_pid), "1.0", "0.05"],
                    ),
                    "json": json,
                    "NativeAXWindowsUnavailable": type(
                        "NativeAXWindowsUnavailable", (RuntimeError,), {},
                    ),
                })
                output = io.StringIO()
                with redirect_stdout(output):
                    exec(suffix, probe)
                payload = json.loads(output.getvalue())
                observed = payload["error"]["observed"]
                self.assertEqual(observed["errorType"], "NativeAXReadUnavailable")
                self.assertEqual(observed["failureFunction"], "copy_attribute")
                self.assertIsInstance(observed["failureLine"], int)
                self.assertEqual(observed["axAttribute"], name)
                self.assertEqual(observed["axStatus"], status)
                self.assertEqual(observed["valuePresent"], bool(value))
                self.assertGreaterEqual(
                    observed["axReadElapsedSeconds"], 1.0 if status == -25204 else 0.1,
                )
                self.assertEqual(observed["focusDeadlineExceeded"], status == -25204)
                self.assertEqual(probe["applications"], [recipient_pid])
                self.assertEqual(reads[-1][0], name)
                self.assertEqual(releases.count(42), 1)
                self.assertEqual(set(observed), {
                    "errorType", "failureFunction", "failureLine", "axAttribute",
                    "axStatus", "valuePresent", "axReadElapsedSeconds",
                    "focusDeadlineExceeded", "actualControlRequestPid",
                })
                self.assertEqual(observed["actualControlRequestPid"], recipient_pid)
                with patch(
                    "tooling.acceptance.drivers.native.macos.subprocess.run",
                    return_value=SimpleNamespace(stdout=output.getvalue()),
                ) as run:
                    with self.assertRaises(BlockedError) as caught:
                        MacOSNativeDesktopAdapter._native_observation(mode, caller_pid)
                check = caught.exception.diagnostic.to_dict()["resourceChecks"][0]
                self.assertEqual(check["expected"]["processId"], caller_pid)
                self.assertEqual(
                    check["observed"],
                    {**observed, "adapterErrorType": "ValueError", "returnCode": None},
                )
                self.assertEqual(run.call_args.args[0][3:5], (mode, str(caller_pid)))
                self.assertEqual(run.call_args.kwargs["timeout"], 3.0)
        for started, elapsed, expected_status, expected_present, expected_reads in (
            (1.0, 0.0, None, False, []),
            (0.0, 1.0, 0, True, ["AXFocusedUIElement"]),
        ):
            with self.subTest(started=started, elapsed=elapsed):
                probe, reads, releases = control_probe(
                    {"AXFocusedUIElement": (0, 23, elapsed)}, started=started,
                )
                with self.assertRaises(probe["NativeAXReadUnavailable"]) as caught:
                    probe["read_control"](59, deadline=1.0)
                observed = caught.exception.observed
                self.assertEqual(observed["axStatus"], expected_status)
                self.assertEqual(observed["valuePresent"], expected_present)
                self.assertEqual(observed["axReadElapsedSeconds"], elapsed)
                self.assertTrue(observed["focusDeadlineExceeded"])
                self.assertEqual([item[0] for item in reads], expected_reads)
                self.assertEqual(probe["applications"], [59])
                self.assertEqual(releases.count(42), 1)
                self.assertEqual(releases.count(23), bool(expected_reads))
                self.assertEqual(observed["actualControlRequestPid"], 59)

    def test_operator_attribute_reads_consume_one_deadline(self) -> None:
        for started, replies, expected_reads, expected_limits in (
            (1.0, {}, [], []),
            (0.0, {"AXFocusedUIElement": (0, 23, 1.1)},
             ["AXFocusedUIElement"], [0.5]),
            (0.0, {
                "AXFocusedUIElement": (0, 23, 0.35),
                "AXWindows": (0, 22, 0.35),
                "AXSheets": (-25205, 0, 0.31),
            }, ["AXFocusedUIElement", "AXWindows", "AXSheets"], [0.5, 0.5, 0.3]),
        ):
            with self.subTest(started=started, replies=replies):
                probe, reads, releases = control_probe(replies, started=started)
                with self.assertRaises(Exception):
                    probe["observe_native"]("operator", 0, 1.0, 0.05)
                self.assertEqual([item[0] for item in reads], expected_reads)
                for actual, expected in zip(reads, expected_limits):
                    self.assertAlmostEqual(actual[2], expected)
                    self.assertLess(actual[1], 1.0)
                self.assertEqual(releases.count(23), bool(expected_reads))
                self.assertEqual(releases.count(22), len(expected_reads) == 3)

    def test_actual_ax_window_read_preserves_status_and_releases_ownership(self) -> None:
        tree = ast.parse(_NATIVE_AX_SUPPORT)
        names = {
            "copy_attribute_result", "copy_attribute",
            "NativeAXWindowsUnavailable", "NativeAXReadUnavailable", "open_panel",
        }
        selected = ast.Module(
            body=[node for node in tree.body if getattr(node, "name", "") in names],
            type_ignores=[],
        )
        for status, value, windows, identifier, expected in (
            (-25204, 0, [], "", "failure"),
            (-25202, 22, [], "", "failure"),
            (0, 0, [], "", "failure"),
            (0, 22, [], "", "failure"),
            (0, 22, [33], "", "absent"),
            (0, 22, [33], "open-panel", "present"),
        ):
            with self.subTest(status=status, value=value, expected=expected):
                namespace, _, released = control_probe({
                    "AXWindows": (status, value, 0.1),
                })
                namespace.update({
                    "array_items": lambda item: windows,
                    "copied_text": lambda item, name: identifier,
                    "find_path": lambda *args: None,
                })
                namespace["core_foundation"].CFRetain = lambda item: item
                exec(compile(selected, "<native-ax-support>", "exec"), namespace)
                if expected == "failure":
                    with self.assertRaises(namespace["NativeAXWindowsUnavailable"]) as caught:
                        namespace["open_panel"](42)
                    observed = caught.exception.observed
                    self.assertEqual(observed["axStatus"], status)
                    self.assertEqual(observed["valuePresent"], bool(value))
                    self.assertEqual(
                        observed["ownerWindowCount"], 0 if status == 0 and value else None,
                    )
                    self.assertGreaterEqual(observed["axReadElapsedSeconds"], 0.1)
                else:
                    panel = namespace["open_panel"](42)
                    self.assertEqual(panel, 33 if expected == "present" else None)
                self.assertGreaterEqual(released.count(22), bool(value))
                released.clear()
                namespace["reads"].begin_observation()
                if status == 0 and value:
                    copied = namespace["copy_attribute"](42, "AXWindows", required=True)
                    self.assertEqual(copied.value, value)
                else:
                    with self.assertRaises(namespace["NativeAXReadUnavailable"]):
                        namespace["copy_attribute"](42, "AXWindows", required=True)
                self.assertGreaterEqual(
                    released.count(22), bool(status != 0 and value),
                )

    def test_chooser_failure_retains_original_phase_and_stays_sticky(self) -> None:
        for phase, kind in (
            ("chooser-before", "diagnostic"),
            ("chooser-open", "diagnostic"),
            ("chooser-selected", "diagnostic"),
            ("chooser-open", "blocked"),
            ("chooser-selected", "driver"),
        ):
            with self.subTest(phase=phase, kind=kind):
                diagnostic = ResourceDiagnostic(
                    owner="macos-native-driver", recovery_action="Repair exact-PID read",
                    resource_checks=[
                        {"resource": "native-file-chooser", "state": "OBSERVED",
                         "expected": {"processId": 42},
                         "observed": {"axStatus": -25204, "axReadElapsedSeconds": 1.25}},
                        {"resource": "native-selection", "state": "NOT_EVALUATED",
                         "expected": {"selected": True}, "reason": "Panel read failed"},
                    ],
                )
                original = diagnostic.to_dict()
                error = (
                    DriverError("Native read failed") if kind == "driver"
                    else BlockedError(
                        "Native read failed", "native-file-chooser",
                        diagnostic=diagnostic if kind == "diagnostic" else None,
                    )
                )
                reads = []

                def read_panel(pid):
                    reads.append(pid)
                    raise error

                observation = NativeOperatorObservation(SimpleNamespace(
                    snapshot_operator_state=lambda: {},
                    snapshot_operator_and_file_chooser=read_panel,
                ))
                for current_phase in (phase, "later-phase"):
                    with self.assertRaises(type(error)) as caught:
                        observation.file_chooser(
                            current_phase, target_process_id=42, present=True,
                        )
                    self.assertIs(caught.exception, error)
                self.assertEqual(reads, [42])
                self.assertEqual(diagnostic.to_dict(), original)
                if kind == "diagnostic":
                    expected = diagnostic.to_dict()
                    expected["resourceChecks"][0]["observed"]["observationPhase"] = phase
                    self.assertEqual(error.diagnostic.to_dict(), expected)

    def test_adapter_preserves_probe_error_and_failure_site(self) -> None:
        payload = {
            "error": {
                "reason": "macOS native observation failed",
                "expected": {},
                "observed": {
                    "errorType": "RuntimeError",
                    "failureFunction": "open_panel",
                    "failureLine": 123,
                },
            },
        }
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=SimpleNamespace(stdout=json.dumps(payload)),
        ) as run:
            with self.assertRaises(BlockedError) as caught:
                MacOSNativeDesktopAdapter._native_observation("operator-panel", 42)
        check = caught.exception.diagnostic.to_dict()["resourceChecks"][0]
        self.assertEqual(check["observed"]["errorType"], "RuntimeError")
        self.assertEqual(check["observed"]["adapterErrorType"], "ValueError")
        self.assertEqual(check["observed"]["failureFunction"], "open_panel")
        self.assertEqual(check["observed"]["failureLine"], 123)
        self.assertEqual(check["expected"]["processId"], 42)
        self.assertEqual(run.call_args.kwargs["timeout"], 3.0)
        self.assertEqual(caught.exception.resource, "runtime-cell-operator-focus")

    def test_decode_failure_remains_the_observed_origin(self) -> None:
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=SimpleNamespace(stdout="{"),
        ):
            with self.assertRaises(BlockedError) as caught:
                MacOSNativeDesktopAdapter._native_observation("operator", 0)
        observed = caught.exception.diagnostic.to_dict()["resourceChecks"][0]["observed"]
        self.assertEqual(observed["errorType"], "JSONDecodeError")
        self.assertEqual(observed["adapterErrorType"], "JSONDecodeError")

    def test_actual_probe_failure_wrapper_emits_code_site_without_private_text(self) -> None:
        private_text = "private AX control contents"

        def read_private_control(*args):
            raise RuntimeError(private_text)

        class ObservationFailure(Exception):
            pass

        suffix = _NATIVE_OBSERVATION_PROBE.removeprefix(
            _NATIVE_AX_SUPPORT + _NATIVE_OBSERVATION_BODY,
        )
        namespace = {
            "observe_native": read_private_control,
            "ObservationFailure": ObservationFailure,
            "NativeAXWindowsUnavailable": type("NativeAXWindowsUnavailable", (RuntimeError,), {}),
            "NativeAXReadUnavailable": type("NativeAXReadUnavailable", (RuntimeError,), {}),
            "sys": SimpleNamespace(
                argv=["probe", "operator-panel", "42", "1.0", "0.05"],
            ),
            "json": json,
        }
        output = io.StringIO()
        with redirect_stdout(output):
            exec(suffix, namespace)
        payload = json.loads(output.getvalue())
        observed = payload["error"]["observed"]
        self.assertEqual(observed["errorType"], "RuntimeError")
        self.assertEqual(observed["failureFunction"], "read_private_control")
        self.assertIsInstance(observed["failureLine"], int)
        self.assertNotIn(private_text, output.getvalue())
        self.assertNotIn("Traceback", output.getvalue())


if __name__ == "__main__":
    unittest.main()
