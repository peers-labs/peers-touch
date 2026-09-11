from __future__ import annotations

import dataclasses
import json
import os
import shutil
import signal
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.attestation import (
    commits_match,
    persist_service_attestation,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.evidence_store import write_current_artifact
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
    ServiceAttestation,
    utc_now,
)
from tooling.acceptance.fixtures.chat_native_actors import (
    fixture_password,
    produce_actor_manifest,
)
from tooling.acceptance.provisioners.remote_source_identity import (
    resolve_remote_source_identity,
)


class LocalDesktopGatewayProvisioner(EnvironmentProvisioner):
    environment_id = "local-desktop-gateway"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

    def _resolve_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        return self._remember_resolved_credentials(
            ("fixture:apps/station/app/conf/actor.yml#preset_users",),
            {"chat-password": fixture_password()},
            sensitive=False,
        )

    def _gateway_ready(self, gateway_url: str) -> bool:
        request = urllib.request.Request(
            f"{gateway_url.rstrip('/')}/api/gateway",
            data=json.dumps({"cmd": "station_list", "args": {}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            return isinstance(payload, dict) and payload.get("ok") is True
        except (
            urllib.error.URLError,
            OSError,
            TimeoutError,
            json.JSONDecodeError,
        ):
            return False

    def _start_gateway(
        self,
        gateway_url: str,
        run_id: str,
        *,
        gateway_port: int,
        renderer_port: int,
        profile_name: str,
        storage_parent: Path,
    ) -> Path:
        log_directory = Path(
            tempfile.mkdtemp(prefix=f"pt-desktop-{run_id}-")
        )
        log_path = log_directory / "provision-desktop.log"
        log_handle = log_path.open("a", encoding="utf-8")
        launch_env = {
            **os.environ,
            "PT_DESKTOP_E2E": "true",
            "PT_GATEWAY_PORT": str(gateway_port),
            "PT_RENDERER_PORT": str(renderer_port),
            "PT_PROFILE": f"{profile_name}-gateway-{run_id}",
            "PEERS_STORAGE_ROOT": str(storage_parent),
        }
        process = subprocess.Popen(
            ["make", "desktop"],
            cwd=REPO_ROOT,
            env=launch_env,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )
        persisted_log = False

        def stop_desktop() -> None:
            nonlocal persisted_log
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=5)
            finally:
                log_handle.close()
                if not persisted_log and log_path.is_file():
                    write_current_artifact(
                        "logs/provision-desktop.log",
                        log_path.read_bytes(),
                        repo_root=REPO_ROOT,
                    )
                    persisted_log = True
                shutil.rmtree(log_directory, ignore_errors=True)

        self.register_cleanup(f"desktop-process:{process.pid}", stop_desktop)
        deadline = time.monotonic() + 900
        while time.monotonic() < deadline:
            if process.poll() is not None:
                stop_desktop()
                raise BlockedError(
                    reason=(
                        f"make desktop exited with {process.returncode}; "
                        "inspect the provision-desktop log artifact"
                    ),
                    resource=f"desktop-gateway:{gateway_url}",
                )
            if self._gateway_ready(gateway_url):
                return storage_parent / "peers-touch"
            time.sleep(1)
        raise BlockedError(
            reason=(
                f"Desktop gateway did not become ready at {gateway_url}; "
                "inspect the provision-desktop log artifact"
            ),
            resource=f"desktop-gateway:{gateway_url}",
        )

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            station_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
            health_url = profile_env.get("PT_STATION_HEALTH_URL", "")
            if not station_url:
                raise BlockedError(
                    reason="Active profile is missing PT_STATION_URL",
                    resource="profile:PT_STATION_URL",
                )
            if not self._station_ready(station_url, health_url):
                if profile_env.get("PT_STATION_MODE", "local") == "remote":
                    raise BlockedError(
                        reason=(
                            f"Remote Station is not reachable at {station_url}. "
                            "Use the approved git-based deployment workflow."
                        ),
                        resource=f"station:{station_url}",
                    )
                started = subprocess.run(
                    ["make", "station"],
                    cwd=REPO_ROOT,
                    capture_output=True,
                    text=True,
                    timeout=180,
                    check=False,
                )
                if started.returncode != 0 or not self._station_ready(
                    station_url,
                    health_url,
                ):
                    detail = (
                        started.stderr.strip()
                        or started.stdout.strip()
                        or "Station remained unavailable"
                    )
                    raise BlockedError(
                        reason=f"Local Station provisioning failed: {detail}",
                        resource=f"station:{station_url}",
                    )

                def stop_local_station() -> None:
                    stopped = subprocess.run(
                        ["make", "station-stop"],
                        cwd=REPO_ROOT,
                        capture_output=True,
                        text=True,
                        timeout=60,
                        check=False,
                    )
                    if stopped.returncode != 0:
                        detail = (
                            stopped.stderr.strip()
                            or stopped.stdout.strip()
                            or "unknown station-stop failure"
                        )
                        raise RuntimeError(detail)

                self.register_cleanup("local-station", stop_local_station)

            gateway_port = int(
                profile_env.get(
                    "PT_DESKTOP_APP_GATEWAY_PORT",
                    str(3030 + slot * 100),
                )
            )
            renderer_port = int(
                profile_env.get(
                    "PT_DESKTOP_APP_WEB_PORT",
                    str(3210 + slot * 100),
                )
            )
            gateway_url = f"http://127.0.0.1:{gateway_port}"
            if self._gateway_ready(gateway_url):
                raise BlockedError(
                    reason=(
                        "Desktop gateway is already running at "
                        f"{gateway_url}; Acceptance requires a run-owned "
                        "process and storage root"
                    ),
                    resource=f"desktop-gateway:{gateway_url}",
                )
            attestation = produce_station_attestation(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                service_id="station",
                station_url=station_url,
                profile_env=profile_env,
                remote_source_identity_provider=resolve_remote_source_identity,
            )
            if not commits_match(attestation.live_commit, manifest.source_commit):
                raise BlockedError(
                    reason=(
                        f"Station commit {attestation.live_commit} does not match "
                        f"client source commit {manifest.source_commit}"
                    ),
                    resource="source-identity:commit",
                )
            if attestation.protocol_digest != source_proto_digest(REPO_ROOT):
                raise BlockedError(
                    reason="Station and client proto digests do not match",
                    resource="source-identity:proto",
                )
            deployment_environment = profile_env.get(
                "PT_STATION_DEPLOY_ENV",
                "",
            )
            if not deployment_environment:
                raise BlockedError(
                    reason=(
                        "Active profile is missing PT_STATION_DEPLOY_ENV for "
                        "the Chat actor Fixture"
                    ),
                    resource="profile:PT_STATION_DEPLOY_ENV",
                )
            credential_refs, _ = self.prepare_credentials()
            if len(credential_refs) != 1:
                raise BlockedError(
                    reason="Chat gateway requires one actor Fixture credential",
                    resource="fixture:chat-native-actors",
                )
            _, _, actor_ref = produce_actor_manifest(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                station_url=station_url,
                deployment_environment=deployment_environment,
                roles=("alice", "bob"),
                credential_ref=credential_refs[0],
                reset_authorized=os.environ.get(
                    "CHAT_ACCEPTANCE_RESET",
                    "",
                ) == "1",
            )
            storage_parent = (
                REPO_ROOT
                / ".local"
                / "acceptance"
                / "runtime"
                / manifest.run_id
                / "desktop-gateway"
            )
            storage_parent.mkdir(parents=True, exist_ok=False)
            self.register_cleanup(
                f"desktop-storage:{manifest.run_id}",
                lambda: shutil.rmtree(storage_parent),
            )
            storage_root = self._start_gateway(
                gateway_url,
                manifest.run_id,
                gateway_port=gateway_port,
                renderer_port=renderer_port,
                profile_name=profile_name,
                storage_parent=storage_parent,
            )
            gateway_attestation = persist_service_attestation(
                ServiceAttestation(
                    service_id="desktop-gateway",
                    service_kind="desktop-gateway",
                    environment_id=self.environment_id,
                    deployment_environment=profile_name,
                    endpoint=gateway_url,
                    live_commit=manifest.source_commit,
                    workspace_digest=manifest.workspace_digest,
                    protocol_digest=source_proto_digest(REPO_ROOT),
                    artifact_ref={},
                    produced_at=utc_now(),
                    producer="desktop-deployment",
                )
            )

            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services={
                    attestation.service_id: attestation,
                    gateway_attestation.service_id: gateway_attestation,
                },
                clients=(
                    ClientRuntime(
                        actor="desktop-gateway",
                        runtime="tauri-dev",
                        worktree=str(REPO_ROOT),
                        gateway_port=gateway_port,
                        renderer_port=renderer_port,
                        webdriver_port=0,
                        profile=profile_name,
                        storage_root=str(storage_root),
                    ),
                ),
                actor_manifest_ref=actor_ref,
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (BlockedError, ValueError) as error:
            if isinstance(error, BlockedError):
                blocked = error
            else:
                blocked = BlockedError(
                    reason=f"Desktop gateway profile has an invalid port: {error}",
                    resource="profile:desktop-port",
                )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
