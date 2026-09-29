from __future__ import annotations

import dataclasses
import shutil

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
)


class _OAuth2ClientLocalProvisioner(EnvironmentProvisioner):
    client_id = ""
    client_runtime = ""

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            manifest = self._preflighted(
                self._manifest,
                profile_name="oauth2-client-local",
                slot=0,
            )
            if shutil.which("go") is None:
                raise BlockedError(
                    reason="Go toolchain is unavailable",
                    resource="toolchain:go",
                )
            module = REPO_ROOT / "apps" / "oauth2-client" / "go.mod"
            if not module.is_file() or manifest.workspace_digest != "clean":
                raise BlockedError(
                    reason="OAuth2 client source is not a clean exact-source module",
                    resource="oauth2-client:source",
                )
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                clients=(
                    ClientRuntime(
                        id=self.client_id,
                        actor="operator",
                        runtime=self.client_runtime,
                        worktree=str(REPO_ROOT),
                        gateway_port=0,
                        renderer_port=0,
                        webdriver_port=0,
                        profile="oauth2-client-local",
                        storage_root="<ephemeral-test-runtime>",
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


class OAuth2ClientLocalServiceProvisioner(_OAuth2ClientLocalProvisioner):
    environment_id = "oauth2-client-local-service"
    client_id = "oauth2-client-service"
    client_runtime = "go-service-test"


class OAuth2ClientLocalBrowserProvisioner(_OAuth2ClientLocalProvisioner):
    environment_id = "oauth2-client-local-browser"
    client_id = "oauth2-client-browser"
    client_runtime = "browser:chromium"
