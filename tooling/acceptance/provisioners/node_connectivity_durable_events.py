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
    EnvironmentContract,
    ProvisioningState,
    RuntimeManifest,
    ServiceAttestation,
    utc_now,
)


GATE_ID = "NCP-G04"
SERVICE_ID = "events-postgres"


def _available_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _run(command: list[str], *, timeout: int = 60) -> str:
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
                f"Durable Events PostgreSQL command failed: "
                f"{detail or completed.returncode}"
            ),
            resource="service:events-postgres",
        )
    return completed.stdout.strip()


class NodeConnectivityDurableEventsProvisioner(EnvironmentProvisioner):
    environment_id = "node-connectivity-durable-events"

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id != GATE_ID:
                raise BlockedError(
                    reason=f"{self.environment_id} does not support {gate_id}",
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
                tempfile.mkdtemp(prefix="pt-ncp-durable-events-")
            ).resolve()
            data_root = runtime_root / "data"
            # PostgreSQL's Unix-socket path has a tight platform limit. The
            # random TCP port remains the isolated Gate endpoint.
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
            _run(
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
            _run(
                [
                    pg_ctl,
                    "-D",
                    str(data_root),
                    "-l",
                    str(log_path),
                    "-o",
                    (
                        f"-h 127.0.0.1 -p {port} "
                        f"-k {socket_root}"
                    ),
                    "-w",
                    "start",
                ]
            )
            started = True
            _run(
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
            version = _run(
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
                service_id=SERVICE_ID,
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
                producer="node-connectivity-durable-events-provisioner",
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
                "runtime/services/events-postgres/attestation.json"
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

            declared = {
                client.id: client for client in self.contract.clients
            }
            required_clients = ("events-node-a", "events-node-b")
            if set(declared) != set(required_clients):
                raise BlockedError(
                    reason=(
                        "Durable Events environment must declare exactly "
                        "events-node-a and events-node-b"
                    ),
                    resource=f"gate-environment:{gate_id}",
                )
            clients = tuple(
                ClientRuntime(
                    id=client_id,
                    actor="alice",
                    runtime="go-test-process",
                    worktree=str(REPO_ROOT),
                    gateway_port=0,
                    renderer_port=0,
                    webdriver_port=0,
                    profile=self.environment_id,
                    storage_root="<shared-postgresql>",
                    storage_lifecycle="ephemeral",
                    required_service_roles=(
                        declared[client_id].required_service_roles
                    ),
                    service_bindings=declared[client_id].service_bindings,
                )
                for client_id in required_clients
            )
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services={SERVICE_ID: attestation},
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
                    reason=f"Durable Events provisioning failed: {error}",
                    resource=f"environment:{self.environment_id}",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )
