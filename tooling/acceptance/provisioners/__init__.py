"""Resolve only the selected runtime adapter; registration does not launch it."""

from __future__ import annotations

from collections.abc import Mapping
from importlib import import_module

from tooling.acceptance.core import (
    EnvironmentContract,
    EnvironmentProvisioner,
    ProvisioningError,
    RuntimeCellLifecycle,
)

# environment -> module, class, constructor binding policy
_PROVISIONERS = {
    "chat-mixed-native": ("mobile_simulator", "ChatMixedNativeProvisioner", "both"),
    "chat-storage-native": ("chat_storage_native", "ChatStorageNativeProvisioner", "none"),
    "cross-station-social-native": ("native_tauri_embedded_webdriver", "CrossStationSocialNativeProvisioner", "shared"),
    "desktop-primary-navigation-native": ("desktop_primary_navigation_native", "DesktopPrimaryNavigationNativeProvisioner", "none"),
    "desktop-shell-native": ("desktop_shell_native", "DesktopShellNativeProvisioner", "none"),
    "home-station": ("home_station", "HomeStationProvisioner", "service"),
    "mobile-native": ("mobile_native", "MobileNativeProvisioner", "none"),
    "mobile-android-physical": ("mobile_native", "MobileAndroidPhysicalProvisioner", "station"),
    "mobile-direct-simulator": ("mobile_simulator", "MobileDirectSimulatorProvisioner", "both"),
    "mobile-ios-layout-simulator": ("mobile_simulator", "MobileIOSLayoutSimulatorProvisioner", "none"),
    "mobile-relay-simulator": ("mobile_simulator", "MobileRelaySimulatorProvisioner", "both"),
    "mobile-simulator": ("mobile_simulator", "MobileSimulatorProvisioner", "none"),
    "mobile-social-ios-simulator": ("mobile_simulator", "MobileSocialIOSSimulatorProvisioner", "both"),
    "mobile-social-simulator": ("mobile_simulator", "MobileSocialSimulatorProvisioner", "both"),
    "mobile-station-lifecycle-simulator": ("mobile_simulator", "MobileStationLifecycleSimulatorProvisioner", "station"),
    "social-cross-station-mobile-desktop": ("mobile_simulator", "SocialCrossStationMobileDesktopProvisioner", "both"),
    "station-access-native": ("mobile_simulator", "StationAccessNativeProvisioner", "both"),
    "station-access-desktop-oauth-native": ("station_access_desktop_oauth_native", "StationAccessDesktopOAuthNativeProvisioner", "none"),
    "station-access-dual-relay": ("station_access_dual_relay", "StationAccessDualRelayProvisioner", "none"),
    "station-access-relay-role": ("station_access_relay_role", "StationAccessRelayRoleProvisioner", "none"),
    "native-tauri-embedded-webdriver": ("native_tauri_embedded_webdriver", "NativeTauriEmbeddedWebDriverProvisioner", "station"),
    "native-tauri-current-profile": ("native_tauri_current_profile", "NativeTauriCurrentProfileProvisioner", "none"),
    "node-connectivity-agent-fencing": ("node_connectivity_agent_fencing", "NodeConnectivityAgentFencingProvisioner", "none"),
    "node-connectivity-cluster": ("node_connectivity_cluster", "NodeConnectivityClusterProvisioner", "none"),
    "node-connectivity-durable-events": ("node_connectivity_durable_events", "NodeConnectivityDurableEventsProvisioner", "none"),
    "node-connectivity-oss-fencing": ("node_connectivity_oss_fencing", "NodeConnectivityOSSFencingProvisioner", "none"),
    "node-connectivity-shared-access": ("node_connectivity_shared_access", "NodeConnectivitySharedAccessProvisioner", "none"),
    "oauth2-client-local-browser": ("oauth2_client_local", "OAuth2ClientLocalBrowserProvisioner", "none"),
    "oauth2-client-local-service": ("oauth2_client_local", "OAuth2ClientLocalServiceProvisioner", "none"),
    "x-config-home-runtime": ("x_config_home", "XConfigHomeProvisioner", "none"),
}

_RUNTIME_CELL_LIFECYCLES = {
    "desktop-macos-native": ("native_desktop_macos", "NativeDesktopMacOSProvisioner"),
    "desktop-linux-native": ("native_desktop_linux", "NativeDesktopLinuxProvisioner"),
    "desktop-windows-native": ("native_desktop_windows", "NativeDesktopWindowsProvisioner"),
}


def _resolve(module: str, name: str) -> type:
    return getattr(import_module(f"{__name__}.{module}"), name)


def _constructor_arguments(
    contract_id: str,
    policy: str,
    station_profiles: Mapping[str, str] | None,
    service_profiles: Mapping[str, str] | None,
) -> dict:
    if policy == "both":
        return {"station_profiles": station_profiles, "service_profiles": service_profiles}
    if policy == "shared":
        return {"station_profiles": {**(station_profiles or {}), **(service_profiles or {})}}
    if policy == "station":
        if service_profiles:
            raise ProvisioningError(
                f"environment {contract_id!r} does not accept service profile bindings"
            )
        return {"station_profiles": station_profiles}
    if policy == "service":
        if station_profiles:
            raise ProvisioningError(
                f"environment {contract_id!r} does not accept station profile bindings"
            )
        return {"service_profiles": service_profiles}
    if station_profiles or service_profiles:
        raise ProvisioningError(
            f"environment {contract_id!r} does not accept runtime profile bindings"
        )
    return {}


def get_provisioner(
    contract: EnvironmentContract,
    *,
    station_profiles: Mapping[str, str] | None = None,
    service_profiles: Mapping[str, str] | None = None,
    catalog_bindings: bool = False,
) -> EnvironmentProvisioner:
    registration = _PROVISIONERS.get(contract.id)
    if registration is None:
        raise ProvisioningError(f"no provisioner registered for environment: {contract.id}")
    module, name, policy = registration
    if catalog_bindings:
        # A full catalog allocation supplies inputs to their registered owners.
        # Exact Gate requests still reject unsupported binding arguments.
        if policy in ("service", "none"):
            station_profiles = None
        if policy in ("station", "none"):
            service_profiles = None
    for service_id in sorted(set(station_profiles or {}) & set(service_profiles or {})):
        if station_profiles[service_id] != service_profiles[service_id]:
            raise ProvisioningError(
                f"environment {contract.id!r} received conflicting station and service "
                f"profile bindings for {service_id!r}"
            )
    arguments = _constructor_arguments(contract.id, policy, station_profiles, service_profiles)
    provisioner_class = _resolve(module, name)
    if not issubclass(provisioner_class, EnvironmentProvisioner) or provisioner_class.environment_id != contract.id:
        raise ProvisioningError(f"provisioner registration identity mismatch: {contract.id}")
    return provisioner_class(contract, **arguments)


def get_runtime_cell_lifecycle(
    cell_id: str, *, provisioner: EnvironmentProvisioner | None = None,
) -> RuntimeCellLifecycle:
    if cell_id in ("mobile-ios-native", "mobile-android-native"):
        from .mobile_runtime_cell import MobileRuntimeCellLifecycle

        return MobileRuntimeCellLifecycle(cell_id, provisioner=provisioner)
    registration = _RUNTIME_CELL_LIFECYCLES.get(cell_id)
    if registration is None:
        raise ProvisioningError(
            f"runtime-cell lifecycle is not implemented for {cell_id!r}"
        )
    lifecycle = _resolve(*registration)()
    if lifecycle.contract.cell_id != cell_id:
        raise ProvisioningError(
            f"runtime-cell lifecycle resolved {lifecycle.contract.cell_id!r} for requested cell {cell_id!r}"
        )
    return lifecycle


_EXPORTS = {
    name: module for module, name, _policy in _PROVISIONERS.values()
}
_EXPORTS.update({name: module for module, name in _RUNTIME_CELL_LIFECYCLES.values()})


def __getattr__(name: str):
    module = _EXPORTS.get(name)
    if module is None:
        raise AttributeError(name)
    value = _resolve(module, name)
    globals()[name] = value
    return value


__all__ = sorted(_EXPORTS) + ["get_provisioner", "get_runtime_cell_lifecycle"]
