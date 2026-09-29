from __future__ import annotations

import dataclasses

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
)


class StationAccessLoginBrowserProvisioner(EnvironmentProvisioner):
    environment_id = "station-access-login-browser"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            manifest = self._preflighted(
                self._manifest,
                profile_name=self.environment_id,
                slot=0,
            )
            if manifest.workspace_digest != "clean":
                raise BlockedError(
                    reason="Desktop login browser journey requires a clean worktree",
                    resource=f"{self.environment_id}:source",
                )

            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                clients=(
                    ClientRuntime(
                        id=self.environment_id,
                        actor="unauthenticated-user",
                        runtime="browser",
                        worktree=str(REPO_ROOT),
                        gateway_port=0,
                        renderer_port=0,
                        webdriver_port=0,
                        profile=self.environment_id,
                        storage_root="<ephemeral-browser-context>",
                        required_service_roles=(),
                        service_bindings={},
                    ),
                ),
                cleanup_resources=(),
            )
            self._manifest = manifest
            return self._ready(manifest)
        except BlockedError as error:
            return self._blocked(
                self._manifest,
                reason=error.reason,
                resource=error.resource,
            )
