"""Chat Search's explicit bilateral iOS/Android runtime composition."""
from tooling.acceptance.core import EnvironmentContract, ProvisioningError
from tooling.acceptance.provisioners.mobile_simulator import (
    MobileDirectSimulatorProvisioner,
    MobileSimulatorProvisioner,
    SelectedMobileSimulatorProvisioner,
    SimulatorClientSpec,
)


class MobileSearchSimulatorProvisioner(MobileDirectSimulatorProvisioner):
    environment_id = "chat-mobile-search-simulator"
    overlay_filename = "chat-mobile-search-simulator.yaml"
    actor_manifest_kind = "chat-mobile-search-actor-manifest"
    actor_manifest_path = "runtime/chat-mobile-search-actors.json"

    def _new_base_provisioner(
        self, contract: EnvironmentContract, source_commit: str,
    ) -> MobileSimulatorProvisioner:
        platforms = {
            "tauri-ios-simulator": "ios",
            "tauri-android-emulator": "android",
        }
        clients = tuple(
            SimulatorClientSpec(
                id=client.id, platform=platforms[client.runtime],
                role=f"{platforms[client.runtime]}-search-receiver",
                runtime=client.runtime,
                port_roles=("wda-local", "mjpeg", "webview")
                if platforms[client.runtime] == "ios"
                else ("system", "mjpeg", "webview"),
                storage_root=f"<runtime-home>/acceptance/mobile-search/<run-id>/{client.id}",
            )
            for client in self.contract.clients
            if client.runtime in platforms
        )
        if {client.platform for client in clients} != {"ios", "android"}:
            raise ProvisioningError("Mobile Search requires one iOS and one Android receiver")
        return SelectedMobileSimulatorProvisioner(
            contract, clients=clients, runtime_source_commit=source_commit,
        )
