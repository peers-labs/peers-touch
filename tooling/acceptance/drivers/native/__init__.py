from __future__ import annotations

import sys
from typing import TYPE_CHECKING, Any

from tooling.acceptance.core.errors import DriverError
from tooling.acceptance.drivers.native.base import (
    MouseAction,
    NativeControlSnapshot,
    NativeDesktopAdapter,
    NativeKey,
    NativeModifier,
    NativeWindowBounds,
    NativeWindowSnapshot,
    NativeWindowStack,
)
if TYPE_CHECKING:
    from tooling.acceptance.drivers.native.runtime import (
        NativeDesktopRuntimeBinding,
        NativeLaunchOptions,
        TransportOverrideHandle,
    )

__all__ = [
    "MouseAction",
    "NativeControlSnapshot",
    "NativeDesktopAdapter",
    "NativeDesktopRuntimeBinding",
    "NativeLaunchOptions",
    "TransportOverrideHandle",
    "NativeKey",
    "NativeModifier",
    "NativeWindowBounds",
    "NativeWindowSnapshot",
    "NativeWindowStack",
    "create_native_desktop_adapter",
    "resolve_native_desktop_runtime",
]


def create_native_desktop_adapter(
    platform_name: str | None = None,
) -> NativeDesktopAdapter:
    resolved_platform = platform_name or sys.platform
    if resolved_platform == "darwin":
        from tooling.acceptance.drivers.native.macos import (
            MacOSNativeDesktopAdapter,
        )

        return MacOSNativeDesktopAdapter()
    if resolved_platform.startswith("linux"):
        from tooling.acceptance.drivers.native.linux_x11 import (
            LinuxX11NativeDesktopAdapter,
        )

        return LinuxX11NativeDesktopAdapter()
    if resolved_platform == "win32":
        from tooling.acceptance.drivers.native.windows import (
            Win32NativeDesktopAdapter,
        )

        return Win32NativeDesktopAdapter()
    raise DriverError(
        f"NativeDesktopAdapter is not implemented for platform {resolved_platform!r}"
    )


def __getattr__(name: str) -> Any:
    if name in {
        "NativeDesktopRuntimeBinding",
        "NativeLaunchOptions",
        "TransportOverrideHandle",
        "resolve_native_desktop_runtime",
    }:
        from tooling.acceptance.drivers.native import runtime

        return getattr(runtime, name)
    raise AttributeError(name)
