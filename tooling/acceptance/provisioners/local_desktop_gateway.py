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
)
from tooling.acceptance.fixtures.chat_native_actors import (
    produce_actor_manifest,
    reset_fixture,
    verify_reset_target,
)


PROVISION_DESKTOP_LOG = "logs/provision-desktop.log"


class LocalDesktopGatewayProvisioner(EnvironmentProvisioner):
    environment_id = "local-desktop-gateway"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

    def _resolve_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        return self._remember_resolved_credentials(
            ("fixture:apps/station/app/conf/actor.yml#preset_users",),
            {},
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

    def _start_gateway(self, gateway_url: str, storage_root: Path) -> None:
        storage_root.mkdir(parents=True, exist_ok=False)

        def remove_storage() -> None:
            if storage_root.exists():
                shutil.rmtree(storage_root)
            if storage_root.exists():
                raise RuntimeError(
                    f"Desktop storage cleanup did not remove {storage_root.name}"
                )

        self.register_cleanup(
            f"desktop-storage:{storage_root.name}",
            remove_storage,
        )
        log_handle = tempfile.NamedTemporaryFile(
            mode="w+",
            encoding="utf-8",
            prefix="pt-provision-desktop-",
            suffix=".log",
            delete=False,
        )
        log_path = Path(log_handle.name)
        environment = dict(os.environ)
        environment["PEERS_STORAGE_ROOT"] = str(storage_root)
        try:
            process = subprocess.Popen(
                ["make", "desktop"],
                cwd=REPO_ROOT,
                env=environment,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
        except BaseException:
            log_handle.close()
            log_path.unlink(missing_ok=True)
            raise

        log_persisted = False

        def persist_log() -> None:
            nonlocal log_persisted
            if log_persisted:
                return
            if not log_handle.closed:
                log_handle.flush()
                log_handle.close()
            try:
                write_current_artifact(
                    PROVISION_DESKTOP_LOG,
                    log_path.read_bytes(),
                    repo_root=REPO_ROOT,
                )
                log_persisted = True
            finally:
                log_path.unlink(missing_ok=True)

        def stop_desktop() -> None:
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
                persist_log()

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
                return
            time.sleep(1)
        raise BlockedError(
            reason=(
                f"Desktop gateway did not become ready at {gateway_url}; "
                f"inspect Evidence Store artifact {PROVISION_DESKTOP_LOG}"
            ),
            resource=f"desktop-gateway:{gateway_url}",
        )

    def _profile_ports(
        self,
        profile_env: dict[str, str],
        slot: int,
        worktree_id: str = REPO_ROOT.name,
    ) -> tuple[int, int]:
        try:
            # Keep readiness aligned with desktop-dev.sh's worktree isolation.
            checksum = subprocess.run(
                ["cksum"],
                input=worktree_id,
                capture_output=True,
                text=True,
                check=True,
            ).stdout.split()
            worktree_offset = int(checksum[0]) % 100
            return (
                int(
                    profile_env.get(
                        "PT_DESKTOP_APP_GATEWAY_PORT",
                        str(3030 + slot * 100),
                    )
                )
                + worktree_offset,
                int(
                    profile_env.get(
                        "PT_DESKTOP_APP_WEB_PORT",
                        str(3210 + slot * 100),
                    )
                )
                + worktree_offset,
            )
        except (IndexError, ValueError, subprocess.SubprocessError) as error:
            raise BlockedError(
                reason=f"Desktop gateway profile has an invalid port: {error}",
                resource="profile:desktop-port",
            ) from error

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            deployment_environment = (
                profile_env.get("PT_STATION_DEPLOY_ENV", "").strip()
                or profile_name
            )
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            self.acquire_profile_lease(
                deployment_environment,
                f"acceptance:{gate_id}:{manifest.run_id}",
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

            gateway_port, renderer_port = self._profile_ports(
                profile_env,
                slot,
            )
            gateway_url = f"http://127.0.0.1:{gateway_port}"
            if self._gateway_ready(gateway_url):
                raise BlockedError(
                    reason=(
                        "Desktop gateway port is already owned by a process "
                        "outside this Acceptance run"
                    ),
                    resource=f"desktop-gateway:{gateway_url}",
                )
            storage_root = Path(tempfile.gettempdir()) / (
                f"pt-desktop-gateway-{manifest.run_id}"
            )
            attestation = produce_station_attestation(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                station_url=station_url,
                profile_env=profile_env,
            )
            if not commits_match(attestation.live_commit, manifest.source_commit):
                raise BlockedError(
                    reason=(
                        f"Station commit {attestation.live_commit} does not match "
                        f"client source commit {manifest.source_commit}"
                    ),
                    resource="source-identity:commit",
                )
            if attestation.proto_digest != source_proto_digest(REPO_ROOT):
                raise BlockedError(
                    reason="Station and client proto digests do not match",
                    resource="source-identity:proto",
                )

            actor_ref = None
            credential_refs: tuple[str, ...] = ()
            if gate_id == "chat-desktop-gateway-e2e":
                credential_refs, _ = self.prepare_credentials()
                fixture = next(
                    (
                        item
                        for item in self.contract.fixtures
                        if item.id == "chat-native-actors"
                    ),
                    None,
                )
                if fixture is None:
                    raise BlockedError(
                        reason=(
                            "local-desktop-gateway contract is missing "
                            "chat-native-actors fixture"
                        ),
                        resource="fixture:chat-native-actors",
                    )
                authorization_ref = (
                    fixture.authorization_ref or "env:CHAT_ACCEPTANCE_RESET"
                )
                authorization_name = (
                    authorization_ref[4:]
                    if authorization_ref.startswith("env:")
                    else authorization_ref
                )
                reset_authorized = (
                    not fixture.authorization_required
                    or os.environ.get(authorization_name) == "1"
                )
                if not reset_authorized:
                    raise BlockedError(
                        reason=(
                            "Chat native actor reset requires "
                            f"{authorization_name}=1 against the approved "
                            "disposable Station"
                        ),
                        resource=f"fixture-authorization:{authorization_name}",
                    )
                verify_reset_target(station_url, deployment_environment)
                self.register_cleanup(
                    "fixture:chat-native-actors",
                    lambda: reset_fixture(
                        deployment_environment,
                        ("alice", "bob"),
                    ),
                )
                _, _, actor_ref = produce_actor_manifest(
                    environment_id=self.environment_id,
                    run_id=manifest.run_id,
                    station_url=station_url,
                    deployment_environment=deployment_environment,
                    roles=("alice", "bob"),
                    credential_ref=(
                        credential_refs[0] if credential_refs else ""
                    ),
                    reset_authorized=reset_authorized,
                )
            self._start_gateway(gateway_url, storage_root)

            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                station=attestation,
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
                credential_refs=credential_refs,
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except BlockedError as blocked:
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
