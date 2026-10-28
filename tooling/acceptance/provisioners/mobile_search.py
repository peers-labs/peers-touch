"""Chat Search's explicit bilateral iOS/Android runtime composition."""
import json
import os

from tooling.acceptance.core import EnvironmentContract, ProvisioningError
from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioning import RuntimeManifest
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
    station_outage_gate_ids = frozenset({"social-content-search-mobile-native-e2e"})

    def provision(self, gate_id: str) -> RuntimeManifest:
        if gate_id in self.station_outage_gate_ids:
            from tooling.development.secure_content.runtime_schema import (
                prepare_private_social_runtime,
            )
            try:
                self._inject_station_profile_bindings(os.environ)
                schema_path = prepare_private_social_runtime(
                    REPO_ROOT, task_id=gate_id,
                )
                self.evidence_run.write_json(
                    "runtime/canonical-private-schema-attestation.json",
                    json.loads(schema_path.read_text()),
                    role="social-private-schema-attestation",
                )
            except BlockedError as error:
                return self._blocked(
                    self._new_base_manifest(gate_id),
                    reason=error.reason, resource=error.resource,
                )
        return super().provision(gate_id)

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
