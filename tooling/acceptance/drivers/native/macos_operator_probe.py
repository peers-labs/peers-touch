"""Lean child protocol and retained AX identity, without Acceptance runtime imports."""

from __future__ import annotations

import hashlib
import json
import math
import os
import select
import signal
import time

from tooling.acceptance.drivers.native.macos_ax import AXReadSession


OPERATOR_FOCUS_STABILITY_TIMEOUT_SECONDS = 1.0
OPERATOR_FOCUS_STABILITY_INTERVAL_SECONDS = 0.05
NATIVE_OBSERVATION_TIMEOUT_SECONDS = 3.0
_MAX_MESSAGE_BYTES = 4096
_BOOTSTRAP_FIELDS = {"scopeId", "parentProcessId", "scopeDeadlineMonotonicSeconds"}
_REQUEST_FIELDS = {
    "scopeId", "sequence", "mode", "targetProcessId", "deadlineMonotonicSeconds",
    "focusDeadlineMonotonicSeconds",
}
_IDENTITY_FIELDS = {
    "actualFrontmostPid": "actual_frontmost_pid",
    "focusedWindow": "focused_window",
    "frontmost": "frontmost",
    "kind": "kind",
    "mainWindow": "main_window",
    "platformRole": "platform_role",
    "platformSubrole": "platform_subrole",
}
_CONTROL_KINDS = {"AXList": "list", "AXTextField": "text-field"}
_PHASE_PREFIX = b"pt-native-observer-phase:"
_PHASES = frozenset((
    "support-loading", "support-ready", "bootstrap-ready", "ax-session-setup",
    "frontmost-before", "focus-control", "pointer-location", "panel-presence",
    "frontmost-after", "response-write", "cleanup",
))


def control_fields(value: dict[str, object]) -> dict[str, object]:
    """One conversion for the parent snapshot and child identity fields."""
    if not isinstance(value, dict):
        raise ValueError("invalid AX response")
    role = str(value.get("role") or "")
    subrole = str(value.get("subrole") or "")
    return {
        "kind": (
            "application-dialog" if subrole == "AXApplicationDialog"
            else _CONTROL_KINDS.get(role, "other" if role else "unknown")
        ),
        "title": str(value.get("title") or ""),
        "value": str(value.get("value") or ""),
        "window_count": int(value.get("windowCount") or 0),
        "dialog_count": int(value.get("sheetCount") or 0),
        "frontmost": bool(value.get("frontmost")),
        "main_window": bool(value.get("mainWindow")),
        "focused_window": bool(value.get("focusedWindow")),
        "actual_frontmost_pid": int(value.get("actualFrontmostPid") or -1),
        "platform_role": role,
        "platform_subrole": subrole,
    }


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
            "focusSamplesCompleted", "focusBudgetRemainingAtEntrySeconds",
            "frontmostReadElapsedSeconds",
            "selectorTraversalPhase", "selectorDepth", "selectorSiblingIndex",
            "selectorLevelWidth", "selectorLookupPhase", "selectorRootKind",
            "selectorRootIndex",
        }:
            observed[key] = value
    return {"reason": "macOS scoped native observation failed",
            "expected": {}, "observed": observed}


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
        focus_budget_at_entry = focus_end - time.monotonic()
        native = self.native
        self._phase("ax-session-setup")
        native["reads"] = AXReadSession(
            native["application_services"], native["core_foundation"], deadline=end,
        )
        self._phase("frontmost-before")
        frontmost_started = time.monotonic()
        operator_pid = native["frontmost_pid"]()
        frontmost_elapsed = time.monotonic() - frontmost_started
        if type(operator_pid) is not int or operator_pid <= 0:
            raise ValueError("native operator PID is unavailable")
        count = 0
        while True:
            if time.monotonic() >= focus_end:
                error = TimeoutError("native keyboard focus did not stabilize")
                error.observed = {
                    "focusSamplesCompleted": count,
                    "focusBudgetRemainingAtEntrySeconds": focus_budget_at_entry,
                    "frontmostReadElapsedSeconds": frontmost_elapsed,
                }
                raise error
            current: list = []
            try:
                self._phase("focus-control")
                control = native["read_control"](
                    operator_pid, deadline=focus_end, focus_refs=current,
                )
                fields = control_fields(control)
                identity = {key: fields[field] for key, field in _IDENTITY_FIELDS.items()}
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
                        # Panel owns its original read cap within the same request.
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
            time.sleep(min(
                OPERATOR_FOCUS_STABILITY_INTERVAL_SECONDS,
                max(0.0, focus_end - time.monotonic()),
            ))


def serve(native: dict) -> None:
    """Private pipe protocol; EOF, parent exit, invalid input and expiry close it."""
    def cancelled(_signal, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, cancelled)
    _emit_phase("support-ready")
    native["_observation_phase"] = _emit_phase
    objects = None
    try:
        bootstrap = _read_line(0, time.monotonic() + OPERATOR_FOCUS_STABILITY_TIMEOUT_SECONDS)
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
                if request_end > started + NATIVE_OBSERVATION_TIMEOUT_SECONDS:
                    raise ValueError("native observation deadline exceeds its budget")
                if focus_end > started + OPERATOR_FOCUS_STABILITY_TIMEOUT_SECONDS:
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
