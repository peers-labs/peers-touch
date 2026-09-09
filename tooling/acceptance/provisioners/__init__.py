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
    MobileIOSLayoutSimulatorProvisioner,
    MobileSimulatorProvisioner,
    MobileSocialSimulatorProvisioner,
    MobileStationLifecycleSimulatorProvisioner,
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
}


def get_provisioner(contract: EnvironmentContract) -> EnvironmentProvisioner:
    provisioner_class = _PROVISIONERS.get(contract.id)
    if provisioner_class is None:
        raise ProvisioningError(
            f"no provisioner registered for environment: {contract.id}"
        )
    return provisioner_class(contract)


def get_runtime_cell_lifecycle(cell_id: str) -> RuntimeCellLifecycle:
    raise ProvisioningError(
        f"runtime-cell lifecycle is not implemented for {cell_id!r}"
    )


__all__ = [
    "HomeStationProvisioner",
    "LocalDesktopGatewayProvisioner",
    "MobileIOSLayoutSimulatorProvisioner",
    "MobileNativeProvisioner",
    "MobileSimulatorProvisioner",
    "MobileSocialSimulatorProvisioner",
    "MobileStationLifecycleSimulatorProvisioner",
    "get_provisioner",
    "get_runtime_cell_lifecycle",
]
