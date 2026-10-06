from __future__ import annotations

from collections.abc import Mapping

from tooling.acceptance.core import (
    EnvironmentContract,
    EnvironmentProvisioner,
    ProvisioningError,
    RuntimeCellLifecycle,
)

from .chat_storage_native import ChatStorageNativeProvisioner
from .desktop_primary_navigation_native import (
    DesktopPrimaryNavigationNativeProvisioner,
)
from .home_station import HomeStationProvisioner
from .mobile_native import MobileNativeProvisioner
from .mobile_simulator import (
    ChatMixedNativeProvisioner,
    MobileDirectSimulatorProvisioner,
    MobileIOSLayoutSimulatorProvisioner,
    MobileSimulatorProvisioner,
    MobileSocialSimulatorProvisioner,
    MobileStationLifecycleSimulatorProvisioner,
    StationAccessNativeProvisioner,
)
from .native_desktop_linux import NativeDesktopLinuxProvisioner
from .native_desktop_macos import NativeDesktopMacOSProvisioner
from .native_desktop_windows import NativeDesktopWindowsProvisioner
from .native_tauri_embedded_webdriver import (
    CrossStationSocialNativeProvisioner,
    NativeTauriEmbeddedWebDriverProvisioner,
)
from .native_tauri_current_profile import (
    NativeTauriCurrentProfileProvisioner,
)
from .oauth2_client_local import (
    OAuth2ClientLocalBrowserProvisioner,
    OAuth2ClientLocalServiceProvisioner,
)
from .station_access_desktop_oauth_native import (
    StationAccessDesktopOAuthNativeProvisioner,
)


_PROVISIONERS: dict[str, type[EnvironmentProvisioner]] = {
    ChatMixedNativeProvisioner.environment_id: ChatMixedNativeProvisioner,
    ChatStorageNativeProvisioner.environment_id: ChatStorageNativeProvisioner,
    CrossStationSocialNativeProvisioner.environment_id: (
        CrossStationSocialNativeProvisioner
    ),
    DesktopPrimaryNavigationNativeProvisioner.environment_id: (
        DesktopPrimaryNavigationNativeProvisioner
    ),
    HomeStationProvisioner.environment_id: HomeStationProvisioner,
    MobileNativeProvisioner.environment_id: MobileNativeProvisioner,
    MobileDirectSimulatorProvisioner.environment_id: (
        MobileDirectSimulatorProvisioner
    ),
    MobileIOSLayoutSimulatorProvisioner.environment_id: (
        MobileIOSLayoutSimulatorProvisioner
    ),
    MobileSimulatorProvisioner.environment_id: MobileSimulatorProvisioner,
    MobileSocialSimulatorProvisioner.environment_id: (
        MobileSocialSimulatorProvisioner
    ),
    MobileStationLifecycleSimulatorProvisioner.environment_id: (
        MobileStationLifecycleSimulatorProvisioner
    ),
    StationAccessNativeProvisioner.environment_id: (
        StationAccessNativeProvisioner
    ),
    StationAccessDesktopOAuthNativeProvisioner.environment_id: (
        StationAccessDesktopOAuthNativeProvisioner
    ),
    NativeTauriEmbeddedWebDriverProvisioner.environment_id: NativeTauriEmbeddedWebDriverProvisioner,
    NativeTauriCurrentProfileProvisioner.environment_id: NativeTauriCurrentProfileProvisioner,
    OAuth2ClientLocalBrowserProvisioner.environment_id: (
        OAuth2ClientLocalBrowserProvisioner
    ),
    OAuth2ClientLocalServiceProvisioner.environment_id: (
        OAuth2ClientLocalServiceProvisioner
    ),
}

_RUNTIME_CELL_LIFECYCLES: dict[str, type[RuntimeCellLifecycle]] = {
    "desktop-macos-native": NativeDesktopMacOSProvisioner,
    "desktop-linux-native": NativeDesktopLinuxProvisioner,
    "desktop-windows-native": NativeDesktopWindowsProvisioner,
}


def get_provisioner(
    contract: EnvironmentContract,
    *,
    station_profiles: Mapping[str, str] | None = None,
    service_profiles: Mapping[str, str] | None = None,
) -> EnvironmentProvisioner:
    provisioner_class = _PROVISIONERS.get(contract.id)
    if provisioner_class is None:
        raise ProvisioningError(
            f"no provisioner registered for environment: {contract.id}"
        )
    if provisioner_class is CrossStationSocialNativeProvisioner:
        if (
            station_profiles
            and service_profiles
            and dict(station_profiles) != dict(service_profiles)
        ):
            raise ProvisioningError(
                f"environment {contract.id!r} received conflicting "
                "station and service profile bindings"
            )
        return provisioner_class(
            contract,
            station_profiles=service_profiles or station_profiles,
        )
    if provisioner_class is NativeTauriEmbeddedWebDriverProvisioner:
        if service_profiles:
            raise ProvisioningError(
                f"environment {contract.id!r} does not accept service profile bindings"
            )
        return provisioner_class(
            contract,
            station_profiles=station_profiles,
        )
    if provisioner_class in {
        ChatMixedNativeProvisioner,
        MobileDirectSimulatorProvisioner,
        MobileSocialSimulatorProvisioner,
        StationAccessNativeProvisioner,
    }:
        return provisioner_class(
            contract,
            station_profiles=station_profiles,
            service_profiles=service_profiles,
        )
    if station_profiles or service_profiles:
        raise ProvisioningError(
            f"environment {contract.id!r} does not accept runtime profile bindings"
        )
    return provisioner_class(contract)


def get_runtime_cell_lifecycle(cell_id: str) -> RuntimeCellLifecycle:
    lifecycle_class = _RUNTIME_CELL_LIFECYCLES.get(cell_id)
    if lifecycle_class is None:
        raise ProvisioningError(
            f"runtime-cell lifecycle is not implemented for {cell_id!r}"
        )
    lifecycle = lifecycle_class()
    if lifecycle.contract.cell_id != cell_id:
        raise ProvisioningError(
            f"runtime-cell lifecycle resolved {lifecycle.contract.cell_id!r} "
            f"for requested cell {cell_id!r}"
        )
    return lifecycle


__all__ = [
    "ChatMixedNativeProvisioner",
    "ChatStorageNativeProvisioner",
    "CrossStationSocialNativeProvisioner",
    "DesktopPrimaryNavigationNativeProvisioner",
    "HomeStationProvisioner",
    "MobileDirectSimulatorProvisioner",
    "MobileIOSLayoutSimulatorProvisioner",
    "MobileNativeProvisioner",
    "MobileSimulatorProvisioner",
    "MobileSocialSimulatorProvisioner",
    "MobileStationLifecycleSimulatorProvisioner",
    "StationAccessDesktopOAuthNativeProvisioner",
    "StationAccessNativeProvisioner",
    "NativeDesktopLinuxProvisioner",
    "NativeDesktopMacOSProvisioner",
    "NativeDesktopWindowsProvisioner",
    "NativeTauriEmbeddedWebDriverProvisioner",
    "NativeTauriCurrentProfileProvisioner",
    "OAuth2ClientLocalBrowserProvisioner",
    "OAuth2ClientLocalServiceProvisioner",
    "get_provisioner",
    "get_runtime_cell_lifecycle",
]
