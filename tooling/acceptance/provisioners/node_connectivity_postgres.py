from __future__ import annotations

import dataclasses
import hashlib
import json
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.evidence_store import (
    current_artifact_ref,
    write_current_artifact,
)
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    ProvisioningState,
    RuntimeManifest,
    ServiceAttestation,
    utc_now,
)


def _available_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


class NodeConnectivityPostgresProcessProvisioner(EnvironmentProvisioner):
    gate_id = ""
    service_id = ""
    client_ids: tuple[str, ...] = ()
    actor = "alice"
    attestation_producer = ""
    failure_label = "Node Connectivity"

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id != self.gate_id:
                raise BlockedError(
                    reason=(
                        f"{self.environment_id} does not support {gate_id}"
                    ),
                    resource=f"gate-environment:{gate_id}",
                )
            manifest = self._preflighted(
                self._manifest,
                profile_name=self.environment_id,
                slot=0,
            )
            initdb = shutil.which("initdb")
            pg_ctl = shutil.which("pg_ctl")
            pg_isready = shutil.which("pg_isready")
            if not initdb or not pg_ctl or not pg_isready:
                raise BlockedError(
                    reason=(
                        "PostgreSQL initdb, pg_ctl, and pg_isready are required"
                    ),
                    resource="toolchain:postgresql",
                )

            runtime_root = Path(
                tempfile.mkdtemp(prefix=f"pt-{self.environment_id}-")
            ).resolve()
            data_root = runtime_root / "data"
            socket_root = Path("/tmp")
            log_path = runtime_root / "postgres.log"
            started = False

            def cleanup() -> None:
                if started and data_root.is_dir():
                    subprocess.run(
                        [
                            pg_ctl,
                            "-D",
                            str(data_root),
                            "-m",
                            "fast",
                            "-w",
                            "stop",
                        ],
                        cwd=REPO_ROOT,
                        capture_output=True,
                        text=True,
                        check=False,
                        timeout=30,
                    )
                shutil.rmtree(runtime_root, ignore_errors=True)

            self.register_cleanup(
                f"postgres-runtime:{runtime_root}",
                cleanup,
            )
            self._run(
                [
                    initdb,
                    "-D",
                    str(data_root),
                    "--auth=trust",
                    "--encoding=UTF8",
                    "--no-locale",
                    "--username=postgres",
                ]
            )
            port = _available_port()
            self._run(
                [
                    pg_ctl,
                    "-D",
                    str(data_root),
                    "-l",
                    str(log_path),
                    "-o",
                    f"-h 127.0.0.1 -p {port} -k {socket_root}",
                    "-w",
                    "start",
                ]
            )
            started = True
            self._run(
                [
                    pg_isready,
                    "-h",
                    "127.0.0.1",
                    "-p",
                    str(port),
                    "-d",
                    "postgres",
                ]
            )
            version = self._run(
                [
                    str(Path(pg_ctl).with_name("postgres")),
                    "--version",
                ]
            )
            process_id = (
                data_root / "postmaster.pid"
            ).read_text(encoding="utf-8").splitlines()[0]
            endpoint = (
                f"postgresql://postgres@127.0.0.1:{port}/"
                "postgres?sslmode=disable"
            )
            attestation = ServiceAttestation(
                service_id=self.service_id,
                service_kind="postgres",
                environment_id=self.environment_id,
                deployment_environment=self.environment_id,
                endpoint=endpoint,
                live_commit=manifest.source_commit,
                workspace_digest=manifest.workspace_digest,
                protocol_digest=hashlib.sha256(
                    version.encode("utf-8")
                ).hexdigest(),
                artifact_ref={},
                produced_at=utc_now(),
                producer=self.attestation_producer,
                runtime_identity=f"postgres:{process_id}",
            )
            artifact_payload = attestation.to_dict()
            artifact_payload["runtime"] = {
                "host": "127.0.0.1",
                "port": port,
                "authentication": "disposable-local-trust",
                "version": version,
            }
            artifact_path = (
                f"runtime/services/{self.service_id}/attestation.json"
            )
            write_current_artifact(
                artifact_path,
                (
                    json.dumps(
                        artifact_payload,
                        indent=2,
                        sort_keys=True,
                    )
                    + "\n"
                ).encode("utf-8"),
                repo_root=REPO_ROOT,
            )
            attestation = dataclasses.replace(
                attestation,
                artifact_ref=current_artifact_ref(
                    artifact_path,
                    repo_root=REPO_ROOT,
                    media_type="application/json",
                ).to_dict(),
            )
            services = {self.service_id: attestation}
            services.update(
                self._additional_services(
                    manifest=manifest,
                    runtime_root=runtime_root,
                )
            )

            declared = {
                client.id: client for client in self.contract.clients
            }
            if set(declared) != set(self.client_ids):
                raise BlockedError(
                    reason=(
                        f"{self.environment_id} must declare exactly "
                        f"{', '.join(self.client_ids)}"
                    ),
                    resource=f"gate-environment:{gate_id}",
                )
            clients = tuple(
                ClientRuntime(
                    id=client_id,
                    actor=self.actor,
                    runtime="go-test-process",
                    worktree=str(REPO_ROOT),
                    gateway_port=0,
                    renderer_port=0,
                    webdriver_port=0,
                    profile=self.environment_id,
                    storage_root=self._client_storage_root(
                        client_id=client_id,
                        runtime_root=runtime_root,
                    ),
                    storage_lifecycle="ephemeral",
                    required_service_roles=(
                        declared[client_id].required_service_roles
                    ),
                    service_bindings=(
                        declared[client_id].service_bindings
                    ),
                )
                for client_id in self.client_ids
            )
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services=services,
                clients=clients,
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (
            BlockedError,
            OSError,
            RuntimeError,
            subprocess.SubprocessError,
            ValueError,
        ) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"{self.failure_label} provisioning failed: {error}",
                    resource=f"environment:{self.environment_id}",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )

    def _additional_services(
        self,
        *,
        manifest: RuntimeManifest,
        runtime_root: Path,
    ) -> dict[str, ServiceAttestation]:
        return {}

    def _client_storage_root(
        self,
        *,
        client_id: str,
        runtime_root: Path,
    ) -> str:
        del client_id, runtime_root
        return "<shared-postgresql>"

    def _run(self, command: list[str], *, timeout: int = 60) -> str:
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise BlockedError(
                reason=(
                    f"{self.failure_label} PostgreSQL command failed: "
                    f"{detail or completed.returncode}"
                ),
                resource=f"service:{self.service_id}",
            )
        return completed.stdout.strip()
