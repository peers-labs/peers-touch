from __future__ import annotations

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
    MobileSimulatorProvisioner,
    MobileSocialSimulatorProvisioner,
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
    MobileSimulatorProvisioner.environment_id: MobileSimulatorProvisioner,
    MobileSocialSimulatorProvisioner.environment_id: (
        MobileSocialSimulatorProvisioner
    ),
    NativeTauriEmbeddedWebDriverProvisioner.environment_id: NativeTauriEmbeddedWebDriverProvisioner,
}

_RUNTIME_CELL_LIFECYCLES: dict[str, type[RuntimeCellLifecycle]] = {
    "desktop-linux-native": NativeDesktopLinuxProvisioner,
    "desktop-windows-native": NativeDesktopWindowsProvisioner,
}


def get_provisioner(contract: EnvironmentContract) -> EnvironmentProvisioner:
    provisioner_class = _PROVISIONERS.get(contract.id)
    if provisioner_class is None:
        raise ProvisioningError(
            f"no provisioner registered for environment: {contract.id}"
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
    "MobileNativeProvisioner",
    "MobileSimulatorProvisioner",
    "MobileSocialSimulatorProvisioner",
    "NativeDesktopLinuxProvisioner",
    "NativeDesktopWindowsProvisioner",
    "NativeTauriEmbeddedWebDriverProvisioner",
    "get_provisioner",
    "get_runtime_cell_lifecycle",
]
