from __future__ import annotations

from tooling.acceptance.core import (
    EnvironmentContract,
    EnvironmentProvisioner,
    ProvisioningError,
)

from .home_station import HomeStationProvisioner
from .local_desktop_gateway import LocalDesktopGatewayProvisioner
from .native_tauri_embedded_webdriver import (
    NativeTauriEmbeddedWebDriverProvisioner,
)


_PROVISIONERS: dict[str, type[EnvironmentProvisioner]] = {
    HomeStationProvisioner.environment_id: HomeStationProvisioner,
    LocalDesktopGatewayProvisioner.environment_id: LocalDesktopGatewayProvisioner,
    NativeTauriEmbeddedWebDriverProvisioner.environment_id: NativeTauriEmbeddedWebDriverProvisioner,
}


def get_provisioner(contract: EnvironmentContract) -> EnvironmentProvisioner:
    provisioner_class = _PROVISIONERS.get(contract.id)
    if provisioner_class is None:
        raise ProvisioningError(
            f"no provisioner registered for environment: {contract.id}"
        )
    return provisioner_class(contract)


__all__ = [
    "HomeStationProvisioner",
    "LocalDesktopGatewayProvisioner",
    "NativeTauriEmbeddedWebDriverProvisioner",
    "get_provisioner",
]
