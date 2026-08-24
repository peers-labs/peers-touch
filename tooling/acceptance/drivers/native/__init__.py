from __future__ import annotations

import sys

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

__all__ = [
    "MouseAction",
    "NativeControlSnapshot",
    "NativeDesktopAdapter",
    "NativeKey",
    "NativeModifier",
    "NativeWindowBounds",
    "NativeWindowSnapshot",
    "NativeWindowStack",
    "create_native_desktop_adapter",
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
    raise DriverError(
        f"NativeDesktopAdapter is not implemented for platform {resolved_platform!r}"
    )
