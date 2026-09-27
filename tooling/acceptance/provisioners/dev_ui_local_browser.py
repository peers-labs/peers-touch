from __future__ import annotations

import dataclasses
import json
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.evidence_store import workspace_id
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
)


DEV_UI_ENDPOINT = "http://127.0.0.1:4177"
MAX_RESPONSE_BYTES = 1024 * 1024


def probe_dev_ui_server() -> dict[str, Any]:
    request = urllib.request.Request(
        f"{DEV_UI_ENDPOINT}/api/server",
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        raise BlockedError(
            reason=f"Peers Dev is unavailable at its fixed endpoint: {error}",
            resource="dev-ui:127.0.0.1:4177",
        ) from error
    if len(body) > MAX_RESPONSE_BYTES:
        raise BlockedError(
            reason="Peers Dev identity response exceeds the byte limit",
            resource="dev-ui:identity",
        )
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BlockedError(
            reason=f"Peers Dev identity response is invalid: {error}",
            resource="dev-ui:identity",
        ) from error
    if not isinstance(payload, dict):
        raise BlockedError(
            reason="Peers Dev identity response must be an object",
            resource="dev-ui:identity",
        )
    return payload


class DevUiLocalBrowserProvisioner(EnvironmentProvisioner):
    environment_id = "dev-ui-local-browser"

    def __init__(
        self,
        contract: EnvironmentContract,
        *,
        probe: Callable[[], Mapping[str, Any]] | None = None,
    ) -> None:
        super().__init__(contract)
        self._probe = probe or probe_dev_ui_server

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            manifest = self._preflighted(
                self._manifest,
                profile_name="dev-ui-local",
                slot=0,
            )
            identity = self._probe()
            source = identity.get("source")
            if (
                identity.get("kind") != "peers-touch-dev-server"
                or identity.get("endpoint") != DEV_UI_ENDPOINT
                or not isinstance(source, Mapping)
                or source.get("workspaceId") != workspace_id(REPO_ROOT)
                or not isinstance(source.get("branch"), str)
                or not source["branch"]
                or source.get("head") != manifest.source_commit
                or source.get("dirty") is not False
                or manifest.workspace_digest != "clean"
            ):
                raise BlockedError(
                    reason=(
                        "Peers Dev listener does not match the clean current "
                        "worktree source"
                    ),
                    resource="dev-ui:source-identity",
                )

            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                clients=(
                    ClientRuntime(
                        id="dev-ui-browser",
                        actor="developer",
                        runtime="browser",
                        worktree=str(REPO_ROOT),
                        gateway_port=4177,
                        renderer_port=4177,
                        webdriver_port=0,
                        profile="dev-ui-local",
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
