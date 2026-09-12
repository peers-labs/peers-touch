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
    MobileIOSLayoutSimulatorProvisioner,
    MobileSimulatorProvisioner,
    MobileSocialSimulatorProvisioner,
    MobileStationLifecycleSimulatorProvisioner,
)
from .native_desktop_linux import NativeDesktopLinuxProvisioner
from .native_desktop_windows import NativeDesktopWindowsProvisioner
from .native_tauri_embedded_webdriver import (
    NativeTauriEmbeddedWebDriverProvisioner,
)


_PROVISIONERS: dict[str, type[EnvironmentProvisioner]] = {
    HomeStationProvisioner.environment_id: HomeStationProvisioner,
    LocalDesktopGatewayProvisioner.environment_id: LocalDesktopGatewayProvisioner,
    MobileNativeProvisioner.environment_id: MobileNativeProvisioner,
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
}

_RUNTIME_CELL_LIFECYCLES: dict[str, type[RuntimeCellLifecycle]] = {
    "desktop-linux-native": NativeDesktopLinuxProvisioner,
    "desktop-windows-native": NativeDesktopWindowsProvisioner,
}


def get_provisioner(
    contract: EnvironmentContract,
    *,
    station_profiles: Mapping[str, str] | None = None,
) -> EnvironmentProvisioner:
    provisioner_class = _PROVISIONERS.get(contract.id)
    if provisioner_class is None:
        raise ProvisioningError(
            f"no provisioner registered for environment: {contract.id}"
        )
    if provisioner_class is NativeTauriEmbeddedWebDriverProvisioner:
        return provisioner_class(
            contract,
            station_profiles=station_profiles,
        )
    if station_profiles:
        raise ProvisioningError(
            f"environment {contract.id!r} does not accept Station profile bindings"
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
    "HomeStationProvisioner",
    "LocalDesktopGatewayProvisioner",
    "MobileIOSLayoutSimulatorProvisioner",
    "MobileNativeProvisioner",
    "MobileSimulatorProvisioner",
    "MobileSocialSimulatorProvisioner",
    "MobileStationLifecycleSimulatorProvisioner",
    "NativeDesktopLinuxProvisioner",
    "NativeDesktopWindowsProvisioner",
    "NativeTauriEmbeddedWebDriverProvisioner",
    "get_provisioner",
    "get_runtime_cell_lifecycle",
]
