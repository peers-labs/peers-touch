"""Object-identity, protocol, deadline and complete scope-cleanup regressions."""

import ctypes
import json
import os
import subprocess
import sys
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tooling.acceptance.core.errors import BlockedError, DriverError
from tooling.acceptance.drivers.native.base import NativeOperatorObservation
from tooling.acceptance.drivers.native.macos import MacOSNativeDesktopAdapter
from tooling.acceptance.drivers.native.macos_operator import (
    FocusObjects, OperatorScope, _encode, _failure, _read_line,
)


def synthetic_native():
    """Generic child OS boundary for testing the actual private pipe protocol."""
    cf = SimpleNamespace(CFRelease=Mock(), CFEqual=Mock(side_effect=lambda a, b: a == b))

    def read(pid, *, deadline, focus_refs):
        focus_refs.extend((1, 2))
        return {
            "actualFrontmostPid": pid, "role": "AXTextField", "subrole": "",
            "frontmost": True, "focusedWindow": True, "mainWindow": True,
        }

    return {
        "core_foundation": cf, "CFRef": ctypes.c_void_p, "ctypes": ctypes,
        "application_services": SimpleNamespace(
            AXUIElementCreateSystemWide=Mock(return_value=3),
            AXUIElementSetMessagingTimeout=Mock(return_value=0),
        ),
        "frontmost_pid": lambda: 41, "read_control": read,
        "pointer_location": lambda: {"x": 100.0, "y": 200.0},
        "panel_presence": lambda pid: {"processId": pid, "present": True},
    }


_SYNTHETIC_SUPPORT = (
    "from tooling.acceptance.tests.test_macos_operator import synthetic_native\n"
    "globals().update(synthetic_native())\n"
)


class FocusObjectTests(unittest.TestCase):
    def fixture(self, pairs, *, controls=None):
        native = synthetic_native()
        live, counts, equal = [], [], []
        sequence = iter(pairs)
        fields = iter(controls) if controls else None
        clock = SimpleNamespace(now=0.0)
        clock.monotonic = lambda: clock.now
        clock.sleep = lambda seconds: setattr(clock, "now", clock.now + seconds)

        def read(pid, *, deadline, focus_refs):
            refs = next(sequence)
            live.extend(refs)
            counts.append(len(live))
            focus_refs.extend(refs)
            return {
                "actualFrontmostPid": pid, "role": "AXTextField", "subrole": "",
                "frontmost": True, "focusedWindow": True, "mainWindow": True,
                **(next(fields) if fields else {}),
            }

        def compare(a, b):
            equal.append((a, b))
            # Independent copies of one AX object need not share local addresses.
            return a // 10 == b // 10

        native["core_foundation"].CFRelease = lambda ref: live.remove(ref) if ref in live else None
        native["core_foundation"].CFEqual = compare
        native["read_control"] = read
        objects = FocusObjects("a" * 32, native)
        session = SimpleNamespace()
        return objects, native, clock, session, live, counts, equal

    def observe(self, objects, clock, session, *, mode="operator", pid=0, end=1.0):
        with patch("tooling.acceptance.drivers.native.macos_operator.time", clock), patch(
            "tooling.acceptance.drivers.native.macos_operator.AXReadSession", return_value=session,
        ):
            return objects.observe(mode, pid, end)

    def test_title_value_and_counts_do_not_define_identity_and_refs_are_bounded(self):
        objects, native, clock, session, live, peaks, equals = self.fixture(
            [(11, 21), (12, 22), (13, 23), (14, 24)],
            controls=[
                {"title": "one", "value": "before", "windowCount": 1},
                {"title": "two", "value": "after", "windowCount": 3},
                {"title": "three", "value": "changed", "sheetCount": 4},
                {"title": "four", "value": "changed again", "sheetCount": 0},
            ],
        )
        before = self.observe(objects, clock, session)
        after = self.observe(objects, clock, session, mode="operator-panel", pid=42)
        self.assertEqual(before["operatorState"], after["operatorState"])
        self.assertEqual(after["panel"], {"processId": 42, "present": True})
        self.assertEqual(len(live), 4)
        self.assertEqual(max(peaks), 6)
        self.assertIn((11, 14), equals)
        self.assertNotIn("title", json.dumps(after))
        objects.close()
        objects.close()
        self.assertEqual(live, [])

    def test_same_role_same_title_different_control_or_window_is_rejected(self):
        for changed in ((31, 23), (13, 31)):
            with self.subTest(changed=changed):
                objects, _, clock, session, live, *_ = self.fixture(
                    [(11, 21), (12, 22), changed, (14, 24)],
                )
                self.observe(objects, clock, session)
                with self.assertRaisesRegex(ValueError, "frozen baseline"):
                    self.observe(objects, clock, session)
                self.assertEqual(objects.baseline, [11, 21])
                objects.close()
                self.assertEqual(live, [])

    def test_initial_unstable_objects_require_two_current_equal_samples(self):
        objects, _, clock, session, live, peaks, equals = self.fixture(
            [(11, 21), (31, 41), (32, 42)],
        )
        result = self.observe(objects, clock, session)
        self.assertEqual(result["operatorState"]["frontmostPid"], 41)
        self.assertEqual(len(peaks), 3)
        self.assertEqual(objects.baseline, [31, 41])
        self.assertIn((31, 32), equals)
        objects.close()
        self.assertEqual(live, [])

    def test_expiry_before_or_after_native_read_releases_all_current_refs(self):
        for stage in ("before", "after"):
            objects, native, clock, session, live, *_ = self.fixture([(11, 21)])
            if stage == "before":
                clock.now = 1.0
            else:
                read = native["read_control"]

                def late(*args, **kwargs):
                    result = read(*args, **kwargs)
                    clock.now = 1.0
                    return result

                native["read_control"] = late
            with self.subTest(stage=stage), self.assertRaises(TimeoutError):
                self.observe(objects, clock, session)
            objects.close()
            self.assertEqual(live, [])

    def test_missing_objects_or_role_never_admit_an_empty_baseline(self):
        for refs, fields in (((None, 21), {}), ((11, None), {}), ((11, 21), {"role": ""})):
            objects, _, clock, session, live, *_ = self.fixture([refs], controls=[fields])
            with self.subTest(refs=refs, fields=fields), self.assertRaisesRegex(ValueError, "unavailable"):
                self.observe(objects, clock, session)
            objects.close()
            # None is not an owned CF reference.
            self.assertTrue(all(ref is None for ref in live))

    def test_frontmost_change_and_original_read_failure_propagate(self):
        original = RuntimeError("private native contents")
        for failure in ("pid", "read"):
            objects, native, clock, session, live, *_ = self.fixture(
                [(11, 21)], controls=[{"actualFrontmostPid": 42}],
            )
            if failure == "read":
                native["read_control"] = Mock(side_effect=original)
            with self.subTest(failure=failure), self.assertRaises((ValueError, RuntimeError)) as caught:
                self.observe(objects, clock, session)
            if failure == "read":
                self.assertIs(caught.exception, original)
            objects.close()
            self.assertEqual(live, [])

    def test_core_remains_sticky_after_focus_returns_and_close_adds_no_sample(self):
        state = {"frontmostPid": 41, "pointerX": 0.0, "pointerY": 0.0,
                 "keyboardFocusSha256": "a" * 64}
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.snapshot_operator_state.side_effect = (
            state, {**state, "keyboardFocusSha256": "b" * 64}, state,
        )
        observer = NativeOperatorObservation(adapter)
        with self.assertRaises(BlockedError) as first:
            observer.sample("changed", target_process_id=42)
        observer.close()
        observer.close()
        with self.assertRaises(BlockedError) as later:
            observer.sample("returned", target_process_id=42)
        self.assertIs(first.exception, later.exception)
        self.assertEqual(adapter.snapshot_operator_state.call_count, 2)
        adapter.close_operator_observation.assert_called_once()


class OperatorProtocolTests(unittest.TestCase):
    def scope(self, support=_SYNTHETIC_SUPPORT, *, lifetime=5.0):
        scope = OperatorScope(support, deadline_monotonic=time.monotonic() + lifetime)
        def release():
            try:
                scope.close()
            except BlockedError:
                self.assertIsNotNone(scope._process.poll())
        self.addCleanup(release)
        return scope

    def test_one_child_reused_for_fresh_reads_and_close_is_terminal(self):
        scope = self.scope()
        first = scope.observe("operator", 0)
        child = scope._process
        second = scope.observe("operator-panel", 42)
        self.assertIs(scope._process, child)
        self.assertEqual(first.operator_state, second.operator_state)
        self.assertTrue(second.file_chooser.present)
        scope.close()
        self.assertEqual(child.poll(), 0)
        self.assertTrue(child.stdin.closed and child.stdout.closed)
        self.assertEqual(scope._sequence, 3)
        with self.assertRaises(DriverError):
            scope.observe("operator", 0)

    def test_foreign_or_extra_response_fields_fail_closed_without_restarting(self):
        evil = """
import json, os
bootstrap = json.loads(input())
request = json.loads(input())
request.pop('deadlineMonotonicSeconds')
request['scopeId'] = 'b' * 32
request['operatorState'] = {}
print(json.dumps(request), flush=True)
input()
"""
        scope = self.scope(evil)
        with self.assertRaises(BlockedError) as first:
            scope.observe("operator", 0)
        child = scope._process
        with self.assertRaises(BlockedError) as later:
            scope.observe("operator", 0)
        self.assertIs(first.exception, later.exception)
        self.assertIs(scope._process, child)
        with self.assertRaises(BlockedError):
            scope.close()
        self.assertIsNotNone(child.poll())

    def test_initial_child_failure_is_reaped_and_never_rebaselined(self):
        scope = self.scope("raise RuntimeError('private child text')\n")
        with self.assertRaises(BlockedError) as caught:
            scope.observe("operator", 0)
        self.assertNotIn("private child text", str(caught.exception.diagnostic.to_dict()))
        scope.close()
        self.assertIsNotNone(scope._process.poll())

    def test_scope_deadline_includes_startup_and_cannot_refresh(self):
        scope = self.scope(lifetime=0.001)
        frozen = scope.deadline
        with self.assertRaises(BlockedError):
            scope.observe("operator", 0)
        self.assertEqual(scope.deadline, frozen)
        scope.close()
        self.assertIsNotNone(scope._process.poll())

    def test_nested_scope_and_inflight_requests_are_rejected(self):
        adapter = MacOSNativeDesktopAdapter()
        with patch(
            "tooling.acceptance.drivers.native.macos_operator.OperatorScope",
            return_value=self.scope(),
        ):
            observer = adapter.observe_operator()
            with self.assertRaises(DriverError):
                adapter.observe_operator()
            scope = adapter._operator_scope
            scope._lock.acquire()
            try:
                with self.assertRaises(DriverError):
                    scope.observe("operator", 0)
            finally:
                scope._lock.release()
            observer.close()
            with self.assertRaises(DriverError):
                observer.sample("closed", target_process_id=42)

    def test_invalid_requests_child_eof_and_expiry_release_the_child(self):
        for change in (
            {"scopeId": "b" * 32}, {"sequence": 0}, {"sequence": 2},
            {"sequence": True}, {"mode": "unknown"}, {"targetProcessId": 42},
            {"deadlineMonotonicSeconds": 0}, {"deadlineMonotonicSeconds": float("inf")},
            {"extra": True},
        ):
            scope = self.scope()
            scope._start()
            request = {
                "scopeId": scope.scope_id, "sequence": 1, "mode": "operator",
                "targetProcessId": 0, "deadlineMonotonicSeconds": time.monotonic() + 1,
                **change,
            }
            with self.subTest(change=change):
                # Allow invalid non-finite JSON only at this hostile boundary.
                scope._process.stdin.write((json.dumps(request) + "\n").encode())
                scope._process.wait(timeout=2)
                self.assertEqual(scope._process.poll(), 0)
                with self.assertRaises(BlockedError):
                    scope.close()
        for exit_mode in ("eof", "expiry"):
            scope = self.scope(lifetime=0.3)
            scope._start()
            if exit_mode == "eof":
                scope._process.stdin.close()
            scope._process.wait(timeout=2)
            self.assertEqual(scope._process.poll(), 0)
            with self.assertRaises(BlockedError):
                scope.close()

    def test_message_bound_and_duplicate_fields_are_rejected(self):
        with self.assertRaises(ValueError):
            _encode({"oversized": "x" * 4096})
        read_fd, write_fd = os.pipe()
        try:
            for raw in (b'{"a":1,"a":2}\n', b"x" * 4097):
                os.write(write_fd, raw)
                with self.assertRaises(ValueError):
                    _read_line(read_fd, time.monotonic() + 1)
        finally:
            os.close(read_fd)
            os.close(write_fd)

    def test_error_origin_excludes_private_exception_text(self):
        def native_failure():
            raise RuntimeError("private AX title/value")

        try:
            native_failure()
        except RuntimeError as error:
            details = _failure(error)
        self.assertEqual(details["observed"]["failureFunction"], "native_failure")
        self.assertNotIn("private AX", json.dumps(details))


if __name__ == "__main__":
    unittest.main()
