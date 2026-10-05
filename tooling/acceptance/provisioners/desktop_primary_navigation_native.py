from __future__ import annotations

from tooling.acceptance.core.provisioning import EnvironmentContract

from .home_station import HomeStationProvisioner


class DesktopPrimaryNavigationNativeProvisioner(HomeStationProvisioner):
    """Provision one source-bound Native Desktop client for navigation proof."""

    environment_id = "desktop-primary-navigation-native"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)
