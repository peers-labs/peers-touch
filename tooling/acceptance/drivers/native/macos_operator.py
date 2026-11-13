"""Scope-owned, bounded AX object equality; no native actions or shared worker."""

from __future__ import annotations

import hashlib
import json
import math
import os
import select
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Mapping

from tooling.acceptance.core.errors import BlockedError, DriverError
from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic
from tooling.acceptance.drivers.native.base import (
    NativeDesktopObservation, NativeFileChooserSnapshot,
)
from tooling.acceptance.drivers.native.macos_ax import AXReadSession
from tooling.acceptance.drivers.native.macos import (
    NATIVE_OBSERVATION_TIMEOUT_SECONDS as _OBSERVATION_SECONDS,
    OPERATOR_FOCUS_STABILITY_TIMEOUT_SECONDS as _FOCUS_SECONDS,
    OPERATOR_FOCUS_STABILITY_INTERVAL_SECONDS as _INTERVAL_SECONDS,
)


_MAX_MESSAGE_BYTES = 4096
_CLOSE_SECONDS = 2.0
_BOOTSTRAP_FIELDS = {"scopeId", "parentProcessId", "scopeDeadlineMonotonicSeconds"}
_REQUEST_FIELDS = {
    "scopeId", "sequence", "mode", "targetProcessId", "deadlineMonotonicSeconds",
    "focusDeadlineMonotonicSeconds",
}
_IDENTITY_FIELDS = (
    "actualFrontmostPid", "focusedWindow", "frontmost", "kind", "mainWindow",
    "platformRole", "platformSubrole",
)
_PHASE_PREFIX = b"pt-native-observer-phase:"
_PHASES = frozenset((
    "support-loading", "support-ready", "bootstrap-ready", "ax-session-setup",
    "frontmost-before", "focus-control", "pointer-location", "panel-presence",
    "frontmost-after", "response-write", "cleanup",
))


def _emit_phase(phase: str) -> None:
    os.write(2, _PHASE_PREFIX + phase.encode("ascii") + b"\n")


class NativeFocusUnavailable(ValueError):
    """Retain object presence and queried PID without exporting AX contents."""

    def __init__(self, process_id: int, references: list, identity: dict) -> None:
        self.observed = {
            "actualControlRequestPid": process_id,
            "actualFrontmostPid": identity["actualFrontmostPid"],
            "focusReferenceCount": len(references),
            "controlPresent": bool(references[0]) if references else False,
            "windowPresent": bool(references[1]) if len(references) > 1 else False,
            "rolePresent": bool(identity["platformRole"]),
            **{key: identity[key] for key in ("frontmost", "focusedWindow", "mainWindow")},
        }
        super().__init__("native focus objects are unavailable")


def _finite(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def _encode(value: object) -> bytes:
    content = json.dumps(value, separators=(",", ":"), allow_nan=False).encode() + b"\n"
    if len(content) > _MAX_MESSAGE_BYTES:
        raise ValueError("native observation message exceeds its limit")
    return content


def _read_line(fd: int, deadline: float, *, parent_pid: int | None = None) -> dict:
    content = bytearray()
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("native observation deadline expired")
        if parent_pid is not None and os.getppid() != parent_pid:
            raise EOFError("native observation parent exited")
        ready, _, _ = select.select(
            [fd], [], [], min(remaining, 0.25) if parent_pid is not None else remaining,
        )
        if not ready:
            continue
        # Read through exactly one newline; never discard a subsequent message.
        value = os.read(fd, 1)
        if not value:
            raise EOFError("native observation pipe closed")
        content.extend(value)
        if len(content) > _MAX_MESSAGE_BYTES:
            raise ValueError("native observation message exceeds its limit")
        if value == b"\n":
            def unique_fields(pairs):
                result = {}
                for key, value in pairs:
                    if key in result:
                        raise ValueError("duplicate native observation field")
                    result[key] = value
                return result

            result = json.loads(content, object_pairs_hook=unique_fields)
            if not isinstance(result, dict):
                raise ValueError("native observation message is not an object")
            return result


def _failure(error: BaseException) -> dict:
    site = error.__traceback__
    while site is not None and site.tb_next is not None:
        site = site.tb_next
    observed = {
        "errorType": type(error).__name__,
        "failureFunction": site.tb_frame.f_code.co_name if site else "",
        "failureLine": site.tb_lineno if site else None,
    }
    # AX errors expose typed OS facts, never exception messages or AX contents.
    for key, value in getattr(error, "observed", {}).items():
        if key in {
            "axAttribute", "axStatus", "valuePresent", "ownerWindowCount",
            "axReadElapsedSeconds", "focusDeadlineExceeded", "actualControlRequestPid",
            "actualFrontmostPid", "focusReferenceCount", "controlPresent",
            "windowPresent", "rolePresent", "frontmost", "focusedWindow", "mainWindow",
        }:
            observed[key] = value
    return {"reason": "macOS scoped native observation failed",
            "expected": {}, "observed": observed}


def _blocked(mode: str, pid: int, error: BaseException, details: Mapping | None = None) -> BlockedError:
    details = details or {}
    observed = dict(details.get("observed") or {})
    return BlockedError(
        reason="macOS scoped native observation failed",
        resource="runtime-cell-operator-focus",
        diagnostic=ResourceDiagnostic.observed(
            owner="macos-native-driver", resource="runtime-cell-operator-focus",
            expected={"operation": mode, "processId": pid,
                      "timeoutSeconds": _OBSERVATION_SECONDS,
                      "focusTimeoutSeconds": _FOCUS_SECONDS},
            observed={
                **observed, "errorType": observed.get("errorType", type(error).__name__),
                "adapterErrorType": type(error).__name__,
            },
            recovery_action=(
                "Repair the original scoped native observer and qualify the same "
                "Cell; preserve the baseline, native objects and original deadlines."
            ),
        ),
    )


class OperatorScope:
    """One private child, one frozen deadline, one in-flight request."""

    def __init__(self, support: str, *, deadline_monotonic: float | None) -> None:
        started = time.monotonic()
        # Standalone diagnostics get a bounded scope; production owners supply
        # their actual operation/Cell end. The active outer alarm always wins.
        end = started + 30.0 if deadline_monotonic is None else deadline_monotonic
        if not _finite(end) or end <= started:
            raise DriverError("Native observation scope has no remaining lifetime")
        timer = signal.getitimer(signal.ITIMER_REAL)[0]
        self.deadline = min(end, started + timer) if timer else end
        self.scope_id = uuid.uuid4().hex
        self._support = support
        self._process: subprocess.Popen | None = None
        self._sequence = 0
        self._closed = False
        self._failure: BlockedError | None = None
        self._cleanup_failure: BlockedError | DriverError | None = None
        self._lock = threading.Lock()

    def _start(self) -> None:
        self._process = subprocess.Popen(
            (sys.executable, "-c",
             "import os\nos.write(2, b'pt-native-observer-phase:support-loading\\n')\n"
             + self._support + "\n"
             "from tooling.acceptance.drivers.native.macos_operator import serve\n"
             "serve(globals())\n", "observation-scope"),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            bufsize=0,
        )
        os.set_blocking(self._process.stderr.fileno(), False)
        self._process.stdin.write(_encode({
            "scopeId": self.scope_id, "parentProcessId": os.getpid(),
            "scopeDeadlineMonotonicSeconds": self.deadline,
        }))

    def _phase_observation(self) -> dict:
        """Drain once without waiting; retain only fixed, content-free labels."""
        process = self._process
        if process is None:
            return {}
        try:
            content = os.read(process.stderr.fileno(), _MAX_MESSAGE_BYTES)
        except (OSError, ValueError):
            return {}
        phases = [
            line[len(_PHASE_PREFIX):].decode("ascii")
            for line in content.split(b"\n")
            if line.startswith(_PHASE_PREFIX)
            and line[len(_PHASE_PREFIX):] in {phase.encode("ascii") for phase in _PHASES}
        ]
        return {
            "observerPhase": phases[-1],
            "observerChildAlive": process.poll() is None,
        } if phases else {}

    def _exchange(
        self, mode: str, pid: int, end: float, *, focus_end: float | None = None,
    ) -> dict:
        self._sequence += 1
        binding = {
            "scopeId": self.scope_id, "sequence": self._sequence,
            "mode": mode, "targetProcessId": pid,
        }
        self._process.stdin.write(_encode({
            **binding, "deadlineMonotonicSeconds": end,
            "focusDeadlineMonotonicSeconds": focus_end,
        }))
        response = _read_line(self._process.stdout.fileno(), end)
        if any(response.get(key) != value or type(response.get(key)) is not type(value)
               for key, value in binding.items()):
            raise ValueError("native observation response binding differs")
        if set(response) == set(binding) | {"error"}:
            details = response["error"]
            if not isinstance(details, dict) or set(details) != {"reason", "expected", "observed"}:
                raise ValueError("invalid native observation error")
            raise _blocked(mode, pid, ValueError(), details)
        expected = set(binding) | ({"closed"} if mode == "close" else {"operatorState"})
        if mode == "operator-panel":
            expected.add("panel")
        if set(response) != expected:
            raise ValueError("invalid native observation response shape")
        if time.monotonic() >= end:
            raise TimeoutError("native observation reply expired")
        return response

    def observe(self, mode: str, pid: int) -> NativeDesktopObservation:
        if self._failure is not None:
            raise self._failure
        if self._closed:
            raise DriverError("Native observation scope is closed")
        if mode not in ("operator", "operator-panel") or type(pid) is not int or (
            pid != 0 if mode == "operator" else pid <= 0
        ):
            raise DriverError("Invalid scoped native observation request")
        if not self._lock.acquire(blocking=False):
            raise DriverError("Native observation already has an in-flight request")
        started = time.monotonic()
        end = min(self.deadline, started + _OBSERVATION_SECONDS)
        focus_end = min(self.deadline, started + _FOCUS_SECONDS)
        try:
            if self._process is None:
                self._start()
            response = self._exchange(mode, pid, end, focus_end=focus_end)
            state = response["operatorState"]
            if not isinstance(state, dict) or set(state) != {
                "frontmostPid", "pointerX", "pointerY", "keyboardFocusSha256",
            } or type(state["frontmostPid"]) is not int or state["frontmostPid"] <= 0 or any(
                not _finite(state[name]) for name in ("pointerX", "pointerY")
            ) or not isinstance(state["keyboardFocusSha256"], str) or len(
                state["keyboardFocusSha256"]
            ) != 64 or any(char not in "0123456789abcdef" for char in state["keyboardFocusSha256"]):
                raise ValueError("invalid scoped operator state")
            panel = None
            if mode == "operator-panel":
                value = response["panel"]
                if not isinstance(value, dict) or set(value) != {"processId", "present"} or (
                    type(value["processId"]) is not int or value["processId"] != pid
                    or type(value["present"]) is not bool
                ):
                    raise ValueError("invalid scoped exact-PID panel")
                panel = NativeFileChooserSnapshot(pid, value["present"])
            self._phase_observation()
            return NativeDesktopObservation(state, panel)
        except BaseException as error:
            # Cancellation must unwind unchanged; the owner still closes in finally.
            phases = self._phase_observation()
            self._failure = error if isinstance(error, BlockedError) else _blocked(
                mode, pid, error, {"observed": phases},
            )
            if isinstance(error, BlockedError) or not isinstance(error, Exception):
                raise
            raise self._failure from error
        finally:
            self._lock.release()

    def close(self) -> None:
        if self._cleanup_failure is not None:
            raise self._cleanup_failure
        if self._closed:
            return
        if not self._lock.acquire(blocking=False):
            raise DriverError("Cannot close an in-flight native observation")
        try:
            self._close_locked()
        except (BlockedError, DriverError) as error:
            self._cleanup_failure = error
            raise
        finally:
            self._lock.release()

    def _close_locked(self) -> None:
        self._closed = True
        process = self._process
        if process is None:
            return
        graceful = False
        cleanup_error = None
        try:
            if process.poll() is None and time.monotonic() < self.deadline:
                response = self._exchange(
                    "close", 0, min(self.deadline, time.monotonic() + _CLOSE_SECONDS),
                )
                if response["closed"] is not True:
                    raise ValueError("native observation cleanup was not acknowledged")
                graceful = True
        except Exception as error:
            cleanup_error = error
        finally:
            process.stdin.close()
            if not graceful and process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=_CLOSE_SECONDS)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=_CLOSE_SECONDS)
                cleanup_error = cleanup_error or TimeoutError("native observation child required kill")
            finally:
                process.stdout.close()
                process.stderr.close()
        if not graceful and self._failure is None:
            cleanup_error = cleanup_error or ChildProcessError("native scope exited before close")
        if cleanup_error is not None or (graceful and process.returncode != 0):
            raise _blocked("close", 0, cleanup_error or ChildProcessError())


class FocusObjects:
    """Own copied AX references; CFEqual alone defines window/control identity."""

    def __init__(self, scope_id: str, native: dict) -> None:
        self.scope_id, self.native = scope_id, native
        self._phase = native.get("_observation_phase", lambda _: None)
        self.baseline: list = []
        self.previous: list = []
        self.previous_identity: dict | None = None
        self.baseline_identity: dict | None = None

    def _release(self, references: list) -> None:
        while references:
            reference = references.pop()
            if reference:
                self.native["core_foundation"].CFRelease(reference)

    def close(self) -> None:
        self._release(self.previous)
        self._release(self.baseline)

    def _equal(self, left: list, right: list) -> bool:
        return len(left) == len(right) == 2 and all(
            a and b and self.native["core_foundation"].CFEqual(a, b)
            for a, b in zip(left, right)
        )

    def observe(self, mode: str, pid: int, end: float, *, focus_end: float) -> dict:
        from tooling.acceptance.drivers.native.macos import MacOSNativeDesktopAdapter

        native = self.native
        self._phase("ax-session-setup")
        native["reads"] = AXReadSession(
            native["application_services"], native["core_foundation"], deadline=end,
        )
        self._phase("frontmost-before")
        operator_pid = native["frontmost_pid"]()
        if type(operator_pid) is not int or operator_pid <= 0:
            raise ValueError("native operator PID is unavailable")
        count = 0
        while True:
            if time.monotonic() >= focus_end:
                raise TimeoutError("native keyboard focus did not stabilize")
            current: list = []
            try:
                self._phase("focus-control")
                control = native["read_control"](
                    operator_pid, deadline=focus_end, focus_refs=current,
                )
                snapshot = MacOSNativeDesktopAdapter._control_snapshot(control)
                identity = {key: getattr(snapshot, {
                    "actualFrontmostPid": "actual_frontmost_pid",
                    "focusedWindow": "focused_window", "mainWindow": "main_window",
                    "platformRole": "platform_role", "platformSubrole": "platform_subrole",
                }.get(key, key)) for key in _IDENTITY_FIELDS}
                if identity["actualFrontmostPid"] != operator_pid:
                    raise ValueError("native operator frontmost process changed")
                if not identity["platformRole"] or len(current) != 2 or not all(current):
                    raise NativeFocusUnavailable(operator_pid, current, identity)
                if self.baseline and (
                    identity != self.baseline_identity or not self._equal(self.baseline, current)
                ):
                    raise ValueError("native operator focus changed from its frozen baseline")
                count += 1
                if time.monotonic() >= focus_end:
                    raise TimeoutError("native keyboard focus reply expired")
                stable = count >= 2 and identity == self.previous_identity and self._equal(
                    self.previous, current,
                )
                if stable:
                    if not self.baseline:
                        self.baseline, self.previous = self.previous, []
                        self.baseline_identity = dict(identity)
                    matches = [
                        bool(native["core_foundation"].CFEqual(a, b))
                        for a, b in zip(self.baseline, current)
                    ]
                    self._release(self.previous)
                    self.previous, current = current, []
                    self.previous_identity = identity
                    focus = {
                        **identity, "scopeId": self.scope_id,
                        "controlEqualsBaseline": matches[0], "windowEqualsBaseline": matches[1],
                    }
                    self._phase("pointer-location")
                    pointer = native["pointer_location"]()
                    result = {"operatorState": {
                        "frontmostPid": operator_pid,
                        "pointerX": pointer["x"], "pointerY": pointer["y"],
                        "keyboardFocusSha256": hashlib.sha256(_encode(focus)).hexdigest(),
                    }}
                    if mode == "operator-panel":
                        # Focus attributes narrow the shared read deadline.
                        # Panel observation has its own original read cap
                        # inside the unchanged enclosing request deadline.
                        native["reads"].begin_observation()
                        self._phase("panel-presence")
                        result["panel"] = native["panel_presence"](pid)
                    self._phase("frontmost-after")
                    if native["frontmost_pid"]() != operator_pid:
                        raise ValueError("native operator frontmost process changed")
                    if time.monotonic() >= end:
                        raise TimeoutError("native observation reply expired")
                    return result
                self._release(self.previous)
                self.previous, current = current, []
                self.previous_identity = identity
            finally:
                self._release(current)
            time.sleep(min(_INTERVAL_SECONDS, max(0.0, focus_end - time.monotonic())))


def serve(native: dict) -> None:
    """Private pipe protocol; EOF, parent exit, invalid input and expiry close it."""
    def cancelled(_signal, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, cancelled)
    _emit_phase("support-ready")
    native["_observation_phase"] = _emit_phase
    objects = None
    try:
        bootstrap = _read_line(0, time.monotonic() + _FOCUS_SECONDS)
        if set(bootstrap) != _BOOTSTRAP_FIELDS:
            raise ValueError("invalid native observation bootstrap")
        scope_id, parent, end = (
            bootstrap["scopeId"], bootstrap["parentProcessId"],
            bootstrap["scopeDeadlineMonotonicSeconds"],
        )
        if not isinstance(scope_id, str) or len(scope_id) != 32 or any(
            char not in "0123456789abcdef" for char in scope_id
        ) or type(parent) is not int or parent != os.getppid() or not _finite(end) or end <= time.monotonic():
            raise ValueError("invalid native observation bootstrap binding")
        cf = native["core_foundation"]
        cf.CFEqual.argtypes = [native["CFRef"], native["CFRef"]]
        cf.CFEqual.restype = native["ctypes"].c_bool
        _emit_phase("bootstrap-ready")
        objects = FocusObjects(scope_id, native)
        sequence, failed = 0, False
        while True:
            request = _read_line(0, end, parent_pid=parent)
            sequence += 1
            mode, pid, request_end, focus_end = (
                request.get("mode"), request.get("targetProcessId"),
                request.get("deadlineMonotonicSeconds"),
                request.get("focusDeadlineMonotonicSeconds"),
            )
            if set(request) != _REQUEST_FIELDS or request["scopeId"] != scope_id or (
                type(request["sequence"]) is not int or request["sequence"] != sequence
                or mode not in ("operator", "operator-panel", "close")
                or type(pid) is not int or (pid <= 0 if mode == "operator-panel" else pid != 0)
                or not _finite(request_end) or request_end <= time.monotonic() or request_end > end
                or (
                    focus_end is not None if mode == "close" else
                    not _finite(focus_end) or focus_end > request_end
                )
            ):
                raise ValueError("invalid native observation request binding")
            binding = {key: request[key] for key in (
                "scopeId", "sequence", "mode", "targetProcessId",
            )}
            if mode == "close":
                _emit_phase("cleanup")
                objects.close()
                os.write(1, _encode({**binding, "closed": True}))
                return
            try:
                if failed:
                    raise ValueError("native observation scope is failed")
                started = time.monotonic()
                if request_end > started + _OBSERVATION_SECONDS:
                    raise ValueError("native observation deadline exceeds its budget")
                if focus_end > started + _FOCUS_SECONDS:
                    raise ValueError("native focus deadline exceeds its budget")
                response = objects.observe(mode, pid, request_end, focus_end=focus_end)
            except Exception as error:
                failed = True
                objects.close()
                response = {"error": _failure(error)}
            _emit_phase("response-write")
            os.write(1, _encode({**binding, **response}))
    except (EOFError, TimeoutError, ValueError, OSError):
        return
    finally:
        if objects is not None:
            objects.close()
