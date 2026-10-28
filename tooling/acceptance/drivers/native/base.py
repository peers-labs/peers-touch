from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from types import MappingProxyType
from typing import Mapping

from tooling.acceptance.core.errors import BlockedError, DriverError, NativeInputBlocked
from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic
from tooling.acceptance.core.runtime_cell import CellNonInterferenceIdentity


class NativeInputMode(str, Enum):
    SEMANTIC_NON_INTRUSIVE = "semantic-nonintrusive"
    EXCLUSIVE_NATIVE_INPUT = "exclusive-native-input"


class NativeInputIsolation(str, Enum):
    SHARED_USER_SESSION = "shared-user-session"
    ISOLATED_GUI_SESSION = "isolated-gui-session"


def _blocked_input(
    operation: str,
    detail: str,
    *,
    expected: dict[str, object],
    observed: dict[str, object],
    recovery_action: str,
) -> NativeInputBlocked:
    return NativeInputBlocked(
        operation,
        detail,
        diagnostic=ResourceDiagnostic.observed(
            owner="native-input-policy",
            recovery_action=recovery_action,
            resource="desktop-native-input-isolation",
            expected=expected,
            observed={"operation": operation, **observed},
        ),
    )


def resolve_native_input_mode(value: str | None) -> NativeInputMode:
    normalized = (value or "").strip()
    if not normalized:
        return NativeInputMode.SEMANTIC_NON_INTRUSIVE
    try:
        return NativeInputMode(normalized)
    except ValueError as error:
        supported = ", ".join(mode.value for mode in NativeInputMode)
        raise _blocked_input(
            "resolve native input mode",
            f"unsupported mode {normalized!r}; expected one of: {supported}",
            expected={"inputMode": [mode.value for mode in NativeInputMode]},
            observed={"inputMode": normalized},
            recovery_action=(
                "Set PT_ACCEPTANCE_DESKTOP_INPUT_MODE to a supported mode. "
                "Exclusive input additionally requires a reviewed isolated GUI "
                "session; changing a flag does not isolate a shared user session."
            ),
        ) from error


def admit_local_native_input_mode(
    mode_value: str | None,
    isolation_value: str | None,
) -> NativeInputMode:
    mode = resolve_native_input_mode(mode_value)
    isolation_raw = (isolation_value or "").strip()
    try:
        isolation = (
            NativeInputIsolation.SHARED_USER_SESSION
            if not isolation_raw
            else NativeInputIsolation(isolation_raw)
        )
    except ValueError as error:
        supported = ", ".join(
            isolation.value for isolation in NativeInputIsolation
        )
        raise _blocked_input(
            "resolve native input isolation",
            f"unsupported isolation {isolation_raw!r}; expected: {supported}",
            expected={
                "inputIsolation": [
                    isolation.value for isolation in NativeInputIsolation
                ],
            },
            observed={
                "inputMode": mode.value,
                "inputIsolation": isolation_raw,
            },
            recovery_action=(
                "Set PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION to the actual reviewed "
                "GUI session isolation. Do not label a shared user session isolated."
            ),
        ) from error
    if (
        mode is NativeInputMode.EXCLUSIVE_NATIVE_INPUT
        and isolation is not NativeInputIsolation.ISOLATED_GUI_SESSION
    ):
        raise _blocked_input(
            "admit local exclusive native input",
            "exclusive input requires PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION="
            f"{NativeInputIsolation.ISOLATED_GUI_SESSION.value}",
            expected={
                "inputMode": NativeInputMode.EXCLUSIVE_NATIVE_INPUT.value,
                "inputIsolation": NativeInputIsolation.ISOLATED_GUI_SESSION.value,
            },
            observed={
                "inputMode": mode.value,
                "inputIsolation": isolation.value,
            },
            recovery_action=(
                "Prepare a reviewed isolated GUI Runtime Cell before admitting "
                "exclusive input. Keep this native-input claim BLOCKED/UNPROVEN "
                "while using a shared user session."
            ),
        )
    return mode


class MouseAction(str, Enum):
    MOVE = "move"
    LEFT_DOWN = "left-down"
    LEFT_DRAG = "left-drag"
    LEFT_UP = "left-up"


class NativeKey(str, Enum):
    A = "a"
    C = "c"
    G = "g"
    L = "l"
    SLASH = "slash"
    V = "v"
    COMMA = "comma"
    DELETE = "delete"
    ENTER = "enter"
    TAB = "tab"
    ESCAPE = "escape"


class NativeModifier(str, Enum):
    PRIMARY = "primary"
    SHIFT = "shift"


@dataclass(frozen=True)
class NativeFileChooserSnapshot:
    process_id: int
    present: bool

    def to_dict(self) -> dict[str, object]:
        return {"processId": self.process_id, "present": self.present}


@dataclass(frozen=True)
class NativeDesktopObservation:
    operator_state: Mapping[str, object]
    file_chooser: NativeFileChooserSnapshot | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "operator_state", MappingProxyType(dict(self.operator_state)),
        )


@dataclass(frozen=True)
class NativeControlSnapshot:
    kind: str = "unknown"
    title: str = ""
    value: str = ""
    window_count: int = 0
    dialog_count: int = 0
    frontmost: bool = False
    main_window: bool = False
    focused_window: bool = False
    actual_frontmost_pid: int = -1
    platform_role: str = ""
    platform_subrole: str = ""
    error: str = ""

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "title": self.title,
            "value": self.value,
            "windowCount": self.window_count,
            "dialogCount": self.dialog_count,
            "frontmost": self.frontmost,
            "mainWindow": self.main_window,
            "focusedWindow": self.focused_window,
            "actualFrontmostPid": self.actual_frontmost_pid,
            "platformRole": self.platform_role,
            "platformSubrole": self.platform_subrole,
            "error": self.error,
        }


@dataclass(frozen=True)
class NativeWindowBounds:
    left: float
    top: float
    width: float
    height: float


@dataclass(frozen=True)
class NativeWindowSnapshot:
    index: int
    owner_pid: int
    owner_name: str
    window_name: str
    layer: int
    alpha: float
    bounds: NativeWindowBounds

    def to_dict(self) -> dict[str, object]:
        result = asdict(self)
        return {
            "index": result["index"],
            "ownerPid": result["owner_pid"],
            "ownerName": result["owner_name"],
            "windowName": result["window_name"],
            "layer": result["layer"],
            "alpha": result["alpha"],
            "bounds": result["bounds"],
        }


@dataclass(frozen=True)
class NativeWindowStack:
    windows: tuple[NativeWindowSnapshot, ...] = ()
    error: str = ""

    def point_owned_by(self, process_id: int) -> bool:
        for window in self.windows:
            if window.alpha <= 0:
                continue
            return window.owner_pid == process_id
        return False

    def to_dict(self) -> dict[str, object]:
        return {
            "windows": [window.to_dict() for window in self.windows],
            "error": self.error,
        }


class NativeOperatorObservation:
    """One frozen operator baseline; a failed sample can never be rebaselined."""

    def __init__(self, adapter: "NativeDesktopAdapter") -> None:
        self._adapter = adapter
        self._baseline = MappingProxyType(dict(adapter.snapshot_operator_state()))
        self._observations: dict[str, CellNonInterferenceIdentity] = {}
        self._failure: BlockedError | DriverError | None = None

    @property
    def baseline(self) -> Mapping[str, object]:
        return self._baseline

    @property
    def observations(self) -> Mapping[str, CellNonInterferenceIdentity]:
        return MappingProxyType(self._observations)

    def sample(
        self, phase: str, *, target_process_id: int,
    ) -> CellNonInterferenceIdentity:
        after = self._read(phase).operator_state
        identity = self._compare(phase, target_process_id, after)
        self._observations[phase] = identity
        return identity

    def file_chooser(
        self, phase: str, *, target_process_id: int, present: bool,
        timeout_seconds: float = 0.0, interval_seconds: float = 0.05,
    ) -> NativeFileChooserSnapshot:
        """Observe panel and operator together; every waiting sample is checked."""
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        while True:
            observation = self._read(phase, target_process_id=target_process_id)
            identity = self._compare(
                phase, target_process_id, observation.operator_state,
            )
            panel = observation.file_chooser
            if panel is None or panel.process_id != target_process_id:
                self._failure = DriverError("Native observation has no exact-PID chooser")
                raise self._failure
            remaining = deadline - time.monotonic()
            if panel.present is present and (
                timeout_seconds <= 0 or remaining > 0
            ):
                self._observations[phase] = identity
                return panel
            if remaining <= 0:
                self._failure = DriverError(
                    f"Native chooser phase {phase} did not reach present={present}"
                )
                raise self._failure
            time.sleep(min(max(0.0, interval_seconds), remaining))

    def _read(
        self, phase: str, *, target_process_id: int | None = None,
    ) -> NativeDesktopObservation:
        if self._failure is not None:
            raise self._failure
        if phase in self._observations:
            raise DriverError(f"Operator observation phase repeated: {phase}")
        try:
            if target_process_id is not None:
                return self._adapter.snapshot_operator_and_file_chooser(
                    target_process_id,
                )
            return NativeDesktopObservation(self._adapter.snapshot_operator_state())
        except (BlockedError, DriverError) as error:
            if isinstance(error, BlockedError) and error.diagnostic is not None:
                details = error.diagnostic.to_dict()
                for check in details["resourceChecks"]:
                    if check["state"] == "OBSERVED" and isinstance(check["observed"], dict):
                        check["observed"]["observationPhase"] = phase
                error.diagnostic = ResourceDiagnostic.from_dict(details)
            self._failure = error
            raise

    def _compare(
        self, phase: str, target_process_id: int, after: Mapping[str, object],
    ) -> CellNonInterferenceIdentity:
        before = self._baseline
        identity = CellNonInterferenceIdentity(
            before["frontmostPid"], after["frontmostPid"],
            before["pointerX"], before["pointerY"],
            after["pointerX"], after["pointerY"],
            before["keyboardFocusSha256"], after["keyboardFocusSha256"],
        )
        if (
            before["frontmostPid"] == target_process_id
            or not identity.unchanged()
        ):
            self._observations[phase] = identity
            self._failure = BlockedError(
                reason=(
                    "native semantic operation changed operator state or "
                    "uses the target client itself as its operator baseline"
                ),
                resource="runtime-cell-operator-focus",
                diagnostic=ResourceDiagnostic.observed(
                    owner="native-operator-observation",
                    resource="runtime-cell-operator-focus",
                    expected={"operatorBaseline": dict(before), "distinctTargetPid": target_process_id},
                    observed={"phase": phase, "operatorState": dict(after)},
                    recovery_action=(
                        "Repair the observed native operation at its owner and "
                        "qualify the same Cell again. Do not restore focus, "
                        "rebaseline, or substitute global input."
                    ),
                ),
            )
            raise self._failure
        return identity


class NativeDesktopAdapter(ABC):
    @property
    def input_mode(self) -> NativeInputMode:
        return NativeInputMode.EXCLUSIVE_NATIVE_INPUT

    def require_exclusive_input(self, operation: str) -> None:
        if self.input_mode is NativeInputMode.EXCLUSIVE_NATIVE_INPUT:
            return
        raise _blocked_input(
            operation,
            "global focus, keyboard, or pointer injection is forbidden in "
            f"{self.input_mode.value!r} mode",
            expected={"inputMode": NativeInputMode.EXCLUSIVE_NATIVE_INPUT.value},
            observed={"inputMode": self.input_mode.value},
            recovery_action=(
                "Run the declared native operation in a reviewed isolated GUI "
                "Runtime Cell with exclusive-native-input. A Station Profile "
                "does not provide GUI isolation. Keep this claim BLOCKED/UNPROVEN "
                "until that resource is available; do not relabel the shared "
                "user session or replace the operation with a Harness action."
            ),
        )

    def snapshot_operator_state(self) -> dict[str, object]:
        raise DriverError("Native operator observation is unavailable")

    def snapshot_operator_and_file_chooser(
        self, process_id: int,
    ) -> NativeDesktopObservation:
        del process_id
        raise DriverError("Combined native operator and chooser observation is unavailable")

    def observe_operator(self) -> NativeOperatorObservation:
        return NativeOperatorObservation(self)

    @property
    @abstractmethod
    def platform(self) -> str:
        ...

    @abstractmethod
    def activate_process(self, process_id: int) -> None:
        ...

    @abstractmethod
    def post_mouse(
        self,
        actions: tuple[MouseAction, ...],
        point: tuple[float, float],
    ) -> None:
        ...

    def post_mouse_to_process(
        self,
        process_id: int,
        actions: tuple[MouseAction, ...],
        point: tuple[float, float],
    ) -> None:
        self.require_exclusive_input("post mouse to process")
        self.activate_process(process_id)
        self.post_mouse(actions, point)

    def post_scroll(
        self,
        point: tuple[float, float],
        *,
        delta_y: int,
    ) -> None:
        """Scroll in pixels; positive delta moves down through the document."""
        self.require_exclusive_input("post native scroll")
        raise DriverError(f"Native pixel scrolling is unavailable on {self.platform}")

    def post_scroll_to_process(
        self,
        process_id: int,
        point: tuple[float, float],
        *,
        delta_y: int,
    ) -> None:
        self.require_exclusive_input("post scroll to process")
        self.activate_process(process_id)
        if not self.window_stack_at_point(point).point_owned_by(process_id):
            raise DriverError("Native scroll target is not owned by the actor")
        self.post_scroll(point, delta_y=delta_y)

    def drag_mouse(
        self,
        start: tuple[float, float],
        end: tuple[float, float],
        *,
        duration_seconds: float = 0.3,
        steps: int = 10,
    ) -> None:
        if duration_seconds <= 0:
            raise ValueError("Native mouse drag duration must be positive")
        if steps < 1:
            raise ValueError("Native mouse drag steps must be positive")
        self.require_exclusive_input("drag mouse")

        interval_seconds = duration_seconds / (steps + 1)
        current = start
        self.post_mouse((MouseAction.MOVE,), start)
        self.post_mouse((MouseAction.LEFT_DOWN,), start)
        try:
            time.sleep(interval_seconds)
            for step in range(1, steps + 1):
                fraction = step / steps
                current = (
                    start[0] + (end[0] - start[0]) * fraction,
                    start[1] + (end[1] - start[1]) * fraction,
                )
                self.post_mouse((MouseAction.LEFT_DRAG,), current)
                time.sleep(interval_seconds)
        finally:
            self.post_mouse((MouseAction.LEFT_UP,), current)

    @abstractmethod
    def post_key(
        self,
        key: NativeKey,
        *,
        modifiers: tuple[NativeModifier, ...] = (),
        text: str = "",
        private_source: bool = False,
    ) -> None:
        ...

    def post_key_to_process(
        self,
        process_id: int,
        key: NativeKey,
        *,
        modifiers: tuple[NativeModifier, ...] = (),
        text: str = "",
        private_source: bool = False,
    ) -> None:
        self.require_exclusive_input("post key to process")
        self.activate_process(process_id)
        self.post_key(
            key,
            modifiers=modifiers,
            text=text,
            private_source=private_source,
        )

    def post_key_sequence_to_process(
        self,
        process_id: int,
        keys: tuple[NativeKey, ...],
        *,
        interval_seconds: float = 0.1,
        private_source: bool = False,
    ) -> None:
        if not keys:
            raise ValueError("Native key sequence must not be empty")
        if interval_seconds < 0:
            raise ValueError("Native key sequence interval must not be negative")
        self.require_exclusive_input("post key sequence to process")
        self.activate_process(process_id)
        for index, key in enumerate(keys):
            self.post_key(key, private_source=private_source)
            if index + 1 < len(keys) and interval_seconds > 0:
                time.sleep(interval_seconds)

    @abstractmethod
    def reveal_file_chooser_location(self) -> None:
        ...

    def reveal_file_chooser_location_to_process(
        self,
        process_id: int,
    ) -> NativeControlSnapshot | None:
        self.require_exclusive_input("reveal native file chooser location")
        self.activate_process(process_id)
        self.reveal_file_chooser_location()
        return None

    def select_file_chooser_path_to_process(
        self,
        process_id: int,
        path: str,
    ) -> NativeControlSnapshot | None:
        del process_id, path
        return None

    def file_chooser_state_to_process(
        self,
        process_id: int,
    ) -> NativeFileChooserSnapshot:
        del process_id
        raise DriverError("Process-scoped native file chooser observation is unavailable")

    def verify_focused_text(
        self,
        expected: str,
        *,
        timeout_seconds: float,
    ) -> bool | None:
        del expected, timeout_seconds
        return None

    def accept_media_capture_permission_to_process(
        self,
        process_id: int,
    ) -> bool:
        del process_id
        return False

    @abstractmethod
    def focused_control(self, process_id: int) -> NativeControlSnapshot:
        ...

    def activate_and_focused_control(
        self,
        process_id: int,
    ) -> NativeControlSnapshot:
        self.require_exclusive_input("activate process and inspect focus")
        self.activate_process(process_id)
        return self.focused_control(process_id)

    @abstractmethod
    def window_stack_at_point(
        self,
        point: tuple[float, float],
    ) -> NativeWindowStack:
        ...

    def content_origin(
        self,
        process_id: int,
    ) -> tuple[float, float] | None:
        del process_id
        return None

    @abstractmethod
    def mouse_button_down(self) -> bool:
        ...

    @abstractmethod
    def capture_screenshot(self, path: Path) -> None:
        ...

    @abstractmethod
    def read_clipboard(self) -> bytes:
        ...

    @abstractmethod
    def write_clipboard(self, value: bytes) -> None:
        ...

    def release_stuck_mouse_button(self, point: tuple[float, float]) -> bool:
        if not self.mouse_button_down():
            return False
        self.require_exclusive_input("release stuck mouse button")
        self.post_mouse((MouseAction.LEFT_UP,), point)
        return True
