from __future__ import annotations

import dataclasses
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request

from tooling.acceptance.core._paths import REPORTS_DIR, REPO_ROOT
from tooling.acceptance.core.attestation import (
    commits_match,
    produce_station_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
)


class LocalDesktopGatewayProvisioner(EnvironmentProvisioner):
    environment_id = "local-desktop-gateway"

    def __init__(self, contract: EnvironmentContract) -> None:
        super().__init__(contract)

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

    def _start_gateway(self, gateway_url: str, run_id: str) -> None:
        log_path = REPORTS_DIR / "logs" / f"provision-{run_id}-desktop.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_handle = log_path.open("a", encoding="utf-8")
        process = subprocess.Popen(
            ["make", "desktop"],
            cwd=REPO_ROOT,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )

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
                log_handle.close()

        self.register_cleanup(f"desktop-process:{process.pid}", stop_desktop)
        deadline = time.monotonic() + 900
        while time.monotonic() < deadline:
            if process.poll() is not None:
                stop_desktop()
                raise BlockedError(
                    reason=(
                        f"make desktop exited with {process.returncode}; "
                        f"inspect {log_path.relative_to(REPO_ROOT)}"
                    ),
                    resource=f"desktop-gateway:{gateway_url}",
                )
            if self._gateway_ready(gateway_url):
                return
            time.sleep(1)
        raise BlockedError(
            reason=(
                f"Desktop gateway did not become ready at {gateway_url}; "
                f"inspect {log_path.relative_to(REPO_ROOT)}"
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
            if not self._gateway_ready(gateway_url):
                self._start_gateway(gateway_url, manifest.run_id)

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
                        storage_root=str(
                            REPO_ROOT
                            / ".local"
                            / "dev"
                            / "storage"
                            / profile_name
                        ),
                    ),
                ),
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
