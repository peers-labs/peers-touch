"""One bounded AX error policy for native observations and one-shot actions."""

from __future__ import annotations

import ctypes
import time
from collections.abc import Callable


_REF = ctypes.c_void_p
# -25204 notification/reply timeout and -25200 cannot-complete are both
# transient "the XPC accessibility service is busy; try again" responses.
_TRANSIENT_READ_ERRORS = frozenset((-25204, -25200))
_CANNOT_COMPLETE = -25204
_OPTIONAL_ABSENCE = frozenset((-25205, -25212))
_READ_BUDGET_SECONDS = 1.5
_MESSAGE_TIMEOUT_SECONDS = 0.5


class AXReadSession:
    def __init__(
        self, ax: ctypes.CDLL, cf: ctypes.CDLL, *, deadline: float,
        read_budget_seconds: float | None = None,
    ) -> None:
        self.ax = ax
        self.cf = cf
        self.deadline = deadline
        self.read_budget_seconds = read_budget_seconds or _READ_BUDGET_SECONDS
        self.read_deadline = min(deadline, time.monotonic() + self.read_budget_seconds)
        ax.AXUIElementCreateSystemWide.restype = _REF
        ax.AXUIElementSetMessagingTimeout.argtypes = [_REF, ctypes.c_float]
        ax.AXUIElementSetMessagingTimeout.restype = ctypes.c_int32
        system = ax.AXUIElementCreateSystemWide()
        try:
            self._check(
                ax.AXUIElementSetMessagingTimeout(system, _MESSAGE_TIMEOUT_SECONDS),
                "AX messaging timeout setup",
            )
        finally:
            cf.CFRelease(system)

    def begin_observation(self) -> None:
        """Share one read budget across a complete tree observation."""
        self.read_deadline = min(
            self.deadline, time.monotonic() + self.read_budget_seconds,
        )

    @staticmethod
    def _check(error: int, operation: str) -> None:
        if error != 0:
            raise RuntimeError(f"{operation} failed: AX error {error}")

    def read(self, element: _REF, name: str, operation: Callable[[], int]) -> int:
        error = 0
        while True:
            remaining = self.read_deadline - time.monotonic()
            if remaining <= 0:
                if error in _TRANSIENT_READ_ERRORS:
                    return error
                raise RuntimeError(f"{name} inspection exceeded the AX read budget")
            self._check(
                self.ax.AXUIElementSetMessagingTimeout(
                    element, min(_MESSAGE_TIMEOUT_SECONDS, remaining),
                ),
                f"{name} timeout setup",
            )
            error = int(operation())
            if error not in _TRANSIENT_READ_ERRORS:
                return error
            remaining = self.read_deadline - time.monotonic()
            if remaining <= 0:
                return error
            time.sleep(min(0.01, remaining))

    def string(self, name: str) -> _REF:
        return self.cf.CFStringCreateWithCString(
            None, name.encode("utf-8"), 0x08000100,
        )

    def copy_attribute(
        self, element: _REF, name: str, *, required: bool = False,
    ) -> _REF | None:
        key = self.string(name)
        value = _REF()

        def copy() -> int:
            nonlocal value
            if value:
                self.cf.CFRelease(value)
                value = _REF()
            return int(self.ax.AXUIElementCopyAttributeValue(
                element, key, ctypes.byref(value),
            ))

        try:
            error = self.read(element, name, copy)
            if error != 0:
                if required or error not in _OPTIONAL_ABSENCE:
                    self._check(error, f"{name} inspection")
                return None
            if required and not value:
                raise RuntimeError(f"{name} inspection returned no value")
            result, value = value, _REF()
            return result
        finally:
            self.cf.CFRelease(key)
            if value:
                self.cf.CFRelease(value)

    def set_attribute(self, element: _REF, name: str, value: _REF) -> None:
        key = self.string(name)
        try:
            self._check(
                self.ax.AXUIElementSetAttributeValue(element, key, value),
                f"{name} mutation",
            )
        finally:
            self.cf.CFRelease(key)

    def perform_action(self, element: _REF, name: str) -> None:
        key = self.string(name)
        try:
            self._check(
                self.ax.AXUIElementPerformAction(element, key),
                f"{name} action",
            )
        finally:
            self.cf.CFRelease(key)
