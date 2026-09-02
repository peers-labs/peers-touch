"""Acceptance driver adapters for Desktop UI gates."""

from typing import TYPE_CHECKING, Any

from tooling.acceptance.core.drivers.base import BaseDriver, DomDriver

if TYPE_CHECKING:
    from tooling.acceptance.drivers.chrome import ChromeDriver
    from tooling.acceptance.drivers.station import StationDriver
    from tooling.acceptance.drivers.tauri import (
        LocalTauriLauncher,
        ProvisionedTauriLauncher,
        TauriDriver,
        TauriSession,
    )

__all__ = [
    "BaseDriver",
    "DomDriver",
    "TauriDriver",
    "TauriSession",
    "LocalTauriLauncher",
    "ProvisionedTauriLauncher",
    "ChromeDriver",
    "StationDriver",
]


def __getattr__(name: str) -> Any:
    if name == "TauriDriver":
        from tooling.acceptance.drivers.tauri import TauriDriver

        return TauriDriver
    if name in {
        "TauriSession",
        "LocalTauriLauncher",
        "ProvisionedTauriLauncher",
    }:
        from tooling.acceptance.drivers import tauri

        return getattr(tauri, name)
    if name == "ChromeDriver":
        from tooling.acceptance.drivers.chrome import ChromeDriver

        return ChromeDriver
    if name == "StationDriver":
        from tooling.acceptance.drivers.station import StationDriver

        return StationDriver
    raise AttributeError(name)
