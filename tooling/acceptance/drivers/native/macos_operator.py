"""Scope-owned, bounded AX object equality; no native actions or shared worker."""

from __future__ import annotations

import os
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
from tooling.acceptance.drivers.native.macos_operator_probe import (
    NATIVE_OBSERVATION_TIMEOUT_SECONDS as _OBSERVATION_SECONDS,
    OPERATOR_FOCUS_STABILITY_TIMEOUT_SECONDS as _FOCUS_SECONDS,
    _MAX_MESSAGE_BYTES,
    _PHASE_PREFIX,
    _PHASES,
    _encode,
    _finite,
    _read_line,
)


_CLOSE_SECONDS = 2.0


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
             "from tooling.acceptance.drivers.native.macos_operator_probe import serve\n"
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
