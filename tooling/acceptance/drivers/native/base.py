from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path


class MouseAction(str, Enum):
    MOVE = "move"
    LEFT_DOWN = "left-down"
    LEFT_UP = "left-up"


class NativeKey(str, Enum):
    A = "a"
    G = "g"
    L = "l"
    V = "v"
    DELETE = "delete"
    ENTER = "enter"
    TAB = "tab"
    ESCAPE = "escape"


class NativeModifier(str, Enum):
    PRIMARY = "primary"
    SHIFT = "shift"


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


class NativeDesktopAdapter(ABC):
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

    @abstractmethod
    def reveal_file_chooser_location(self) -> None:
        ...

    @abstractmethod
    def focused_control(self, process_id: int) -> NativeControlSnapshot:
        ...

    @abstractmethod
    def window_stack_at_point(
        self,
        point: tuple[float, float],
    ) -> NativeWindowStack:
        ...

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
        self.post_mouse((MouseAction.LEFT_UP,), point)
        return True
