from __future__ import annotations

from collections.abc import Mapping

from tooling.acceptance.core import (
    EnvironmentContract,
    EnvironmentProvisioner,
    ProvisioningError,
    RuntimeCellLifecycle,
)

from .home_station import HomeStationProvisioner
from .local_desktop_gateway import LocalDesktopGatewayProvisioner
from .mobile_native import MobileNativeProvisioner
from .mobile_simulator import (
    ChatMixedNativeProvisioner,
    MobileDirectSimulatorProvisioner,
    MobileIOSLayoutSimulatorProvisioner,
    MobileSimulatorProvisioner,
    MobileSocialSimulatorProvisioner,
    MobileStationLifecycleSimulatorProvisioner,
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


_PROVISIONERS: dict[str, type[EnvironmentProvisioner]] = {
    ChatMixedNativeProvisioner.environment_id: ChatMixedNativeProvisioner,
    CrossStationSocialNativeProvisioner.environment_id: (
        CrossStationSocialNativeProvisioner
    ),
    HomeStationProvisioner.environment_id: HomeStationProvisioner,
    LocalDesktopGatewayProvisioner.environment_id: LocalDesktopGatewayProvisioner,
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
    NativeTauriEmbeddedWebDriverProvisioner.environment_id: NativeTauriEmbeddedWebDriverProvisioner,
    NativeTauriCurrentProfileProvisioner.environment_id: NativeTauriCurrentProfileProvisioner,
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
    if provisioner_class in {
        CrossStationSocialNativeProvisioner,
        NativeTauriEmbeddedWebDriverProvisioner,
    }:
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
    "CrossStationSocialNativeProvisioner",
    "HomeStationProvisioner",
    "LocalDesktopGatewayProvisioner",
    "MobileDirectSimulatorProvisioner",
    "MobileIOSLayoutSimulatorProvisioner",
    "MobileNativeProvisioner",
    "MobileSimulatorProvisioner",
    "MobileSocialSimulatorProvisioner",
    "MobileStationLifecycleSimulatorProvisioner",
    "NativeDesktopLinuxProvisioner",
    "NativeDesktopMacOSProvisioner",
    "NativeDesktopWindowsProvisioner",
    "NativeTauriEmbeddedWebDriverProvisioner",
    "NativeTauriCurrentProfileProvisioner",
    "get_provisioner",
    "get_runtime_cell_lifecycle",
]
