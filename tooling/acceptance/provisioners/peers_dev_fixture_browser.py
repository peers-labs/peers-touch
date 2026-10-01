from __future__ import annotations

import dataclasses
import subprocess
import time
from typing import Any

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.evidence_store import workspace_id
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
)
from tooling.acceptance.provisioners.dev_ui_local_browser import (
    DEV_UI_ENDPOINT,
    probe_dev_ui_server,
)


DRIVER = (
    REPO_ROOT
    / "tooling"
    / "acceptance"
    / "gates"
    / "dev"
    / "dev-ui-browser-e2e.mjs"
)


class PeersDevFixtureBrowserProvisioner(EnvironmentProvisioner):
    environment_id = "peers-dev-fixture-browser"

    def __init__(
        self,
        contract: EnvironmentContract,
        *,
        popen: Any = subprocess.Popen,
        probe: Any = probe_dev_ui_server,
    ) -> None:
        super().__init__(contract)
        self._popen = popen
        self._probe = probe
        self._process: subprocess.Popen[str] | None = None

    def _stop_process(self) -> None:
        process = self._process
        self._process = None
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if process.stdout is not None:
            process.stdout.close()

    def _start_process(self, source_commit: str) -> dict[str, Any]:
        process = self._popen(
            ["node", str(DRIVER), "--serve-fixture"],
            cwd=REPO_ROOT,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        self._process = process
        self.register_cleanup(
            "peers-dev-fixture-runtime",
            self._stop_process,
        )

        deadline = time.monotonic() + 10
        last_error = "server did not become ready"
        while time.monotonic() < deadline:
            if process.poll() is not None:
                output = process.stdout.read().strip() if process.stdout else ""
                raise BlockedError(
                    reason=(
                        "Peers Dev fixture process exited before readiness: "
                        f"{output or process.returncode}"
                    ),
                    resource="peers-dev-fixture:process",
                )
            try:
                identity = dict(self._probe())
            except BlockedError as error:
                last_error = error.reason
                time.sleep(0.1)
                continue
            source = identity.get("source")
            if (
                identity.get("kind") == "peers-touch-dev-server"
                and identity.get("endpoint") == DEV_UI_ENDPOINT
                and isinstance(source, dict)
                and source.get("workspaceId") == workspace_id(REPO_ROOT)
                and source.get("head") == source_commit
                and source.get("dirty") is False
            ):
                return identity
            last_error = "fixture source identity does not match the worktree"
            time.sleep(0.1)
        raise BlockedError(
            reason=f"Peers Dev fixture readiness timed out: {last_error}",
            resource="peers-dev-fixture:readiness",
        )

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            manifest = self._preflighted(
                self._manifest,
                profile_name="dev-ui-local",
                slot=0,
            )
            if manifest.workspace_digest != "clean":
                raise BlockedError(
                    reason="Peers Dev fixture requires a clean worktree",
                    resource="peers-dev-fixture:source",
                )
            self._start_process(manifest.source_commit)
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                clients=(
                    ClientRuntime(
                        id="peers-dev-fixture-browser",
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
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (BlockedError, OSError, ProvisioningError) as error:
            reason = error.reason if isinstance(error, BlockedError) else str(error)
            resource = (
                error.resource
                if isinstance(error, BlockedError)
                else "peers-dev-fixture:provisioning"
            )
            return self._blocked(self._manifest, reason=reason, resource=resource)
