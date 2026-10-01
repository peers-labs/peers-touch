from __future__ import annotations

import dataclasses
import json
import subprocess
import time
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
FIXTURE_GATE_ID = "peers-dev-ui-browser-e2e"
FIXTURE_DRIVER = (
    REPO_ROOT
    / "tooling"
    / "acceptance"
    / "gates"
    / "dev"
    / "dev-ui-browser-e2e.mjs"
)


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
        popen: Any = subprocess.Popen,
    ) -> None:
        super().__init__(contract)
        self._probe = probe or probe_dev_ui_server
        self._popen = popen
        self._process: subprocess.Popen[str] | None = None

    def _stop_fixture(self) -> None:
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

    def _start_fixture(self, source_commit: str) -> None:
        process = self._popen(
            ["node", str(FIXTURE_DRIVER), "--serve-fixture"],
            cwd=REPO_ROOT,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        self._process = process
        self.register_cleanup("peers-dev-fixture-runtime", self._stop_fixture)
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
                identity = self._probe()
            except BlockedError as error:
                last_error = error.reason
                time.sleep(0.1)
                continue
            source = identity.get("source")
            if (
                identity.get("kind") == "peers-touch-dev-server"
                and identity.get("endpoint") == DEV_UI_ENDPOINT
                and isinstance(source, Mapping)
                and source.get("workspaceId") == workspace_id(REPO_ROOT)
                and source.get("head") == source_commit
                and source.get("dirty") is False
            ):
                return
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
            if gate_id == FIXTURE_GATE_ID:
                if manifest.workspace_digest != "clean":
                    raise BlockedError(
                        reason="Peers Dev fixture requires a clean worktree",
                        resource="peers-dev-fixture:source",
                    )
                self._start_fixture(manifest.source_commit)
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
                        id=(
                            "peers-dev-fixture-browser"
                            if gate_id == FIXTURE_GATE_ID
                            else "dev-ui-browser"
                        ),
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
                cleanup_resources=(
                    ("peers-dev-fixture-runtime",)
                    if gate_id == FIXTURE_GATE_ID
                    else ()
                ),
            )
            self._manifest = manifest
            return self._ready(manifest)
        except BlockedError as error:
            return self._blocked(
                self._manifest,
                reason=error.reason,
                resource=error.resource,
            )
