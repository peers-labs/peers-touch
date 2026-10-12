from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.attestation import (
    commits_match,
    persist_service_attestation,
    produce_service_attestation,
    source_proto_digest,
)
from tooling.acceptance.core.errors import BlockedError, ProvisioningError
from tooling.acceptance.core.provisioner import (
    EnvironmentProvisioner,
    load_env_file,
    resolve_deployment_environment_path,
)
from tooling.acceptance.core.provisioning import (
    ClientRuntime,
    ProvisioningState,
    RuntimeManifest,
    ServiceAttestation,
    utc_now,
)
from tooling.acceptance.fixtures.chat_native_actors import (
    fixture_password,
    produce_bound_actor_manifest,
)
from tooling.acceptance.transports.ssh import SshTarget, SshTransport


GATE_ID = "NCP-G06"
PROFILE_NAME = "one"
DEPLOYMENT_ENVIRONMENT = "station-1"
COMPOSE_RELATIVE_PATH = (
    "tooling/acceptance/runtime/node-connectivity-cluster.compose.yml"
)
SOURCE_ARCHIVE_NAME = "source.tar.gz"
PROJECT_PREFIX = "pt-ncp-"
REMOTE_ROOT_PREFIX = "peers-touch/acceptance/ncp-"
RESET_DESCRIPTOR_ENV = "PT_ACCEPTANCE_RUNTIME_DESCRIPTOR"
RESET_AUTHORIZATION_ENV = "PT_NCP_CLUSTER_RESET_AUTHORIZED"
SAFE_RUNTIME_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")


def _available_local_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _http_json(url: str, *, timeout: float = 8) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise ProvisioningError(f"runtime endpoint returned no object: {url}")
    data = payload.get("data")
    return dict(data) if isinstance(data, dict) else payload


def _wait_for_station(url: str, *, timeout: float = 180) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(
                f"{url.rstrip('/')}/sub-oss/healthz",
                timeout=3,
            ) as response:
                if 200 <= response.status < 300:
                    return
        except (
            urllib.error.URLError,
            OSError,
            TimeoutError,
        ) as error:
            last_error = error
        time.sleep(1)
    raise ProvisioningError(
        f"Station did not become healthy at {url}: {last_error}"
    )


def _temporary_environment(values: Mapping[str, str]):
    class _TemporaryEnvironment:
        def __enter__(self) -> None:
            self.previous = {
                key: os.environ.get(key)
                for key in values
            }
            os.environ.update(values)

        def __exit__(self, *_: object) -> None:
            for key, value in self.previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    return _TemporaryEnvironment()


def _remote_runtime_identity(
    transport: SshTransport,
    postgres_container: str,
    station_container: str,
) -> tuple[str, str]:
    database = transport.run_argv(
        (
            "docker",
            "exec",
            postgres_container,
            "sh",
            "-lc",
            (
                "psql -At -v ON_ERROR_STOP=1 "
                "-U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" "
                "-c \"SELECT identity FROM station_cluster_identity "
                "WHERE scope='station'\""
            ),
        ),
        timeout=30,
        check=True,
    ).stdout.strip()
    objects = transport.run_argv(
        (
            "docker",
            "exec",
            station_container,
            "cat",
            "/app/shared/oss/.peers-cluster-backing-id",
        ),
        timeout=30,
        check=True,
    ).stdout.strip()
    if (
        re.fullmatch(r"[0-9a-f]{64}", database) is None
        or re.fullmatch(r"[0-9a-f]{64}", objects) is None
    ):
        raise ProvisioningError(
            "remote cluster backing identities are invalid"
        )
    return database, objects


def _registry_rows(
    transport: SshTransport,
    postgres_container: str,
) -> list[dict[str, Any]]:
    completed = transport.run_argv(
        (
            "docker",
            "exec",
            postgres_container,
            "sh",
            "-lc",
            (
                "psql -At -v ON_ERROR_STOP=1 "
                "-U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" "
                "-c \"SELECT coalesce(json_agg(row_to_json(nodes)), '[]') "
                "FROM (SELECT station_peer_id, node_peer_id, incarnation, "
                "mode, cluster_ready, lifecycle_state, "
                "shared_backing_digest, enabled_owners_digest "
                "FROM station_node_registry "
                "WHERE lease_expires_at > clock_timestamp() "
                "ORDER BY node_peer_id) nodes\""
            ),
        ),
        timeout=30,
        check=True,
    )
    try:
        rows = json.loads(completed.stdout.strip())
    except json.JSONDecodeError as error:
        raise ProvisioningError(
            "Station node registry readback is invalid"
        ) from error
    if not isinstance(rows, list) or any(
        not isinstance(row, dict) for row in rows
    ):
        raise ProvisioningError(
            "Station node registry readback is not an array"
        )
    return [dict(row) for row in rows]


class NodeConnectivityClusterProvisioner(EnvironmentProvisioner):
    environment_id = "node-connectivity-cluster"
    gate_id = GATE_ID
    attestation_producer = "node-connectivity-cluster-provisioner"

    def __init__(self, contract) -> None:
        super().__init__(contract)
        self._transport: SshTransport | None = None
        self._project = ""
        self._remote_root = ""
        self._postgres_container = ""
        self._station_containers: dict[str, str] = {}

    def _resolve_credentials(self) -> tuple[tuple[str, ...], dict[str, str]]:
        return self._remember_resolved_credentials(
            ("fixture:apps/station/app/conf/actor.yml#preset_users",),
            {"chat-password": fixture_password()},
            sensitive=False,
        )

    @staticmethod
    def _source_archive(destination: Path) -> str:
        completed = subprocess.run(
            (
                "git",
                "archive",
                "--format=tar.gz",
                f"--output={destination}",
                "HEAD",
            ),
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if completed.returncode != 0 or not destination.is_file():
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise ProvisioningError(
                f"exact-source archive failed: {detail or completed.returncode}"
            )
        return hashlib.sha256(destination.read_bytes()).hexdigest()

    @staticmethod
    def _compose_environment(
        *,
        project: str,
        host: str,
        source_commit: str,
        node_a_http: int,
        node_a_libp2p: int,
        node_b_http: int,
        node_b_libp2p: int,
    ) -> dict[str, str]:
        return {
            "COMPOSE_PROJECT_NAME": project,
            "PT_NCP_STATION_IMAGE": f"{project}-station",
            "PT_NCP_SOURCE_COMMIT": source_commit,
            "PT_NCP_BUILD_TIME": utc_now(),
            "PT_NCP_REMOTE_HOST": host,
            "PT_NCP_NODE_A_HTTP_PORT": str(node_a_http),
            "PT_NCP_NODE_A_LIBP2P_PORT": str(node_a_libp2p),
            "PT_NCP_NODE_B_HTTP_PORT": str(node_b_http),
            "PT_NCP_NODE_B_LIBP2P_PORT": str(node_b_libp2p),
            "PT_NCP_NODE_A_URL": f"http://{host}:{node_a_http}",
            "PT_NCP_NODE_B_URL": f"http://{host}:{node_b_http}",
            "PT_NCP_NODE_LABEL": "NCP Cluster Acceptance",
        }

    @staticmethod
    def _compose_argv(
        remote_root: str,
        station_env: str,
        environment: Mapping[str, str],
        *arguments: str,
    ) -> tuple[str, ...]:
        return (
            "env",
            *(f"{key}={value}" for key, value in sorted(environment.items())),
            "docker",
            "compose",
            "--project-directory",
            remote_root,
            "--env-file",
            station_env,
            "-f",
            f"{remote_root}/{COMPOSE_RELATIVE_PATH}",
            *arguments,
        )

    def _run_remote(
        self,
        argv: Sequence[str],
        *,
        timeout: float,
    ) -> str:
        if self._transport is None:
            raise ProvisioningError("remote cluster transport is unavailable")
        completed = self._transport.run_argv(
            argv,
            timeout=timeout,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise ProvisioningError(
                f"remote cluster command failed: {detail[-4000:]}"
            )
        return completed.stdout.strip()

    def _cleanup_remote(
        self,
        compose_environment: Mapping[str, str],
        station_env: str,
    ) -> None:
        if self._transport is None or not self._remote_root:
            return
        failures: list[str] = []
        try:
            self._transport.run_argv(
                self._compose_argv(
                    self._remote_root,
                    station_env,
                    compose_environment,
                    "down",
                    "--volumes",
                    "--remove-orphans",
                    "--timeout",
                    "10",
                ),
                timeout=120,
                check=True,
            )
        except Exception as error:
            failures.append(f"compose down: {error}")
        try:
            self._transport.run_argv(
                ("rm", "-rf", "--", self._remote_root),
                timeout=30,
                check=True,
            )
        except Exception as error:
            failures.append(f"source cleanup: {error}")
        if failures:
            raise RuntimeError("; ".join(failures))

    def _service_attestations(
        self,
        manifest: RuntimeManifest,
        *,
        project: str,
        node_urls: Mapping[str, str],
        database_identity: str,
        object_identity: str,
    ) -> dict[str, ServiceAttestation]:
        protocol_digest = source_proto_digest(REPO_ROOT)

        def remote_source_identity(_: str) -> tuple[str, str, str]:
            return manifest.source_commit, "clean", protocol_digest

        services = {
            service_id: produce_service_attestation(
                environment_id=self.environment_id,
                run_id=manifest.run_id,
                service_id=service_id,
                service_kind="station",
                endpoint=endpoint,
                mode="remote",
                deployment_environment=project,
                producer=self.attestation_producer,
                require_runtime_identity=True,
                remote_source_identity_provider=remote_source_identity,
            )
            for service_id, endpoint in node_urls.items()
        }
        for service_id, kind, endpoint, runtime_identity in (
            (
                "cluster-postgres",
                "postgres",
                f"docker://{project}/postgres",
                f"postgres:{database_identity}",
            ),
            (
                "cluster-object-backend",
                "object-storage",
                f"docker-volume://{project}/station-shared",
                f"shared-fs:{object_identity}",
            ),
        ):
            services[service_id] = persist_service_attestation(
                ServiceAttestation(
                    service_id=service_id,
                    service_kind=kind,
                    environment_id=self.environment_id,
                    deployment_environment=project,
                    endpoint=endpoint,
                    live_commit=manifest.source_commit,
                    workspace_digest="clean",
                    protocol_digest=hashlib.sha256(
                        f"{kind}:v1".encode("utf-8")
                    ).hexdigest(),
                    artifact_ref={},
                    produced_at=utc_now(),
                    producer=self.attestation_producer,
                    runtime_identity=runtime_identity,
                )
            )
        return services

    def _clients(
        self,
        run_id: str,
        slot: int,
    ) -> tuple[ClientRuntime, ...]:
        declared = {client.id: client for client in self.contract.clients}
        if set(declared) != {"alice", "bob"}:
            raise BlockedError(
                reason="NCP cluster environment must declare Alice and Bob",
                resource="gate-environment:NCP-G06",
            )
        run_root = Path(tempfile.gettempdir()) / (
            f"pt-ncp-cluster-native-{run_id}"
        )
        self.register_cleanup(
            f"client-storage:{run_root}",
            lambda: shutil.rmtree(run_root, ignore_errors=True),
        )
        clients = []
        for actor in ("alice", "bob"):
            client = declared[actor]
            clients.append(
                ClientRuntime(
                    id=actor,
                    actor=actor,
                    runtime="native-tauri",
                    worktree=str(REPO_ROOT),
                    gateway_port=_available_local_port(),
                    renderer_port=_available_local_port(),
                    webdriver_port=_available_local_port(),
                    profile=f"ncp-cluster-{actor}-{slot}",
                    storage_root=str(run_root / actor / "storage"),
                    storage_lifecycle="persistent",
                    required_service_roles=client.required_service_roles,
                    service_bindings=client.service_bindings,
                )
            )
        return tuple(clients)

    def provision(self, gate_id: str) -> RuntimeManifest:
        self._manifest = self._new_base_manifest(gate_id)
        try:
            if gate_id != self.gate_id:
                raise BlockedError(
                    reason=f"{self.environment_id} does not support {gate_id}",
                    resource=f"gate-environment:{gate_id}",
                )
            profile_name, _, slot, profile_env = self._resolve_active_profile()
            manifest = self._preflighted(
                self._manifest,
                profile_name=profile_name,
                slot=slot,
            )
            if (
                profile_name != PROFILE_NAME
                or profile_env.get("PT_STATION_MODE") != "remote"
                or profile_env.get("PT_STATION_DEPLOY_ENV")
                != DEPLOYMENT_ENVIRONMENT
            ):
                raise BlockedError(
                    reason="NCP cluster runtime requires reviewed profile one",
                    resource="profile:one",
                )
            if manifest.workspace_digest != "clean":
                raise BlockedError(
                    reason=(
                        "NCP cluster exact-source proof requires a clean "
                        "candidate worktree"
                    ),
                    resource="source-identity:worktree-cleanliness",
                )
            if os.environ.get(RESET_AUTHORIZATION_ENV) != "1":
                raise BlockedError(
                    reason=(
                        "NCP cluster actor Fixture reset requires explicit "
                        f"{RESET_AUTHORIZATION_ENV}=1"
                    ),
                    resource=f"fixture-authorization:{RESET_AUTHORIZATION_ENV}",
                )

            deployment_path = resolve_deployment_environment_path(
                DEPLOYMENT_ENVIRONMENT
            )
            deployment = load_env_file(deployment_path)
            host = deployment.get("PT_DEPLOY_HOST", "")
            user = deployment.get("PT_DEPLOY_USER", "")
            ssh_port = int(deployment.get("PT_DEPLOY_SSH_PORT", "22"))
            known_hosts = deployment.get(
                "PT_DEPLOY_KNOWN_HOSTS_FILE",
                "",
            )
            self._transport = SshTransport(
                SshTarget(
                    host=host,
                    user=user,
                    port=ssh_port,
                    known_hosts_file=known_hosts,
                )
            )
            owner = f"acceptance:{gate_id}:{manifest.run_id}"
            self.acquire_profile_lease(DEPLOYMENT_ENVIRONMENT, owner)
            self.acquire_remote_git_source_lease(
                DEPLOYMENT_ENVIRONMENT,
                owner,
            )

            home = self._run_remote(
                ("sh", "-lc", 'printf "%s" "$HOME"'),
                timeout=15,
            )
            if not home.startswith("/") or not SAFE_RUNTIME_NAME.fullmatch(
                manifest.run_id
            ):
                raise ProvisioningError(
                    "remote cluster home or run identity is invalid"
                )
            project = PROJECT_PREFIX + manifest.run_id
            remote_root = f"{home}/{REMOTE_ROOT_PREFIX}{manifest.run_id}"
            station_env = f"{home}/peers-touch/station.env"
            self._project = project
            self._remote_root = remote_root
            self._postgres_container = f"{project}-postgres-1"
            self._station_containers = {
                "station-node-a": f"{project}-station-node-a-1",
                "station-node-b": f"{project}-station-node-b-1",
            }

            remote_ports: set[int] = set()
            while len(remote_ports) < 4:
                remote_ports.add(self._transport.available_remote_port())
            (
                node_a_http,
                node_a_libp2p,
                node_b_http,
                node_b_libp2p,
            ) = sorted(remote_ports)
            compose_environment = self._compose_environment(
                project=project,
                host=host,
                source_commit=manifest.source_commit,
                node_a_http=node_a_http,
                node_a_libp2p=node_a_libp2p,
                node_b_http=node_b_http,
                node_b_libp2p=node_b_libp2p,
            )
            self._run_remote(("mkdir", "-p", remote_root), timeout=15)
            self.register_cleanup(
                f"remote-cluster:{project}",
                lambda: self._cleanup_remote(
                    compose_environment,
                    station_env,
                ),
            )
            with tempfile.TemporaryDirectory(
                prefix="pt-ncp-cluster-source-"
            ) as raw:
                archive = Path(raw) / SOURCE_ARCHIVE_NAME
                archive_digest = self._source_archive(archive)
                self._transport.copy_file(
                    archive,
                    f"{remote_root}/{SOURCE_ARCHIVE_NAME}",
                    timeout=120,
                )
            remote_archive_digest = self._run_remote(
                (
                    "sha256sum",
                    f"{remote_root}/{SOURCE_ARCHIVE_NAME}",
                ),
                timeout=30,
            ).split(maxsplit=1)[0]
            if remote_archive_digest != archive_digest:
                raise ProvisioningError(
                    "remote exact-source archive digest mismatch"
                )
            self._run_remote(
                (
                    "tar",
                    "-xzf",
                    f"{remote_root}/{SOURCE_ARCHIVE_NAME}",
                    "-C",
                    remote_root,
                ),
                timeout=120,
            )
            self._run_remote(
                ("rm", "-f", f"{remote_root}/{SOURCE_ARCHIVE_NAME}"),
                timeout=15,
            )
            self._run_remote(
                self._compose_argv(
                    remote_root,
                    station_env,
                    compose_environment,
                    "build",
                    "station-node-a",
                ),
                timeout=1800,
            )
            self._run_remote(
                self._compose_argv(
                    remote_root,
                    station_env,
                    compose_environment,
                    "up",
                    "-d",
                    "postgres",
                    "station-node-a",
                ),
                timeout=180,
            )
            node_urls = {
                "station-node-a": compose_environment["PT_NCP_NODE_A_URL"],
                "station-node-b": compose_environment["PT_NCP_NODE_B_URL"],
            }
            _wait_for_station(node_urls["station-node-a"])
            self._run_remote(
                self._compose_argv(
                    remote_root,
                    station_env,
                    compose_environment,
                    "up",
                    "-d",
                    "station-node-b",
                ),
                timeout=180,
            )
            _wait_for_station(node_urls["station-node-b"])

            node_infos = {
                service_id: _http_json(
                    f"{endpoint}/sub-bootstrap/info"
                )
                for service_id, endpoint in node_urls.items()
            }
            station_ids = {
                str(info.get("station_peer_id") or "")
                for info in node_infos.values()
            }
            node_ids = {
                str(info.get("node_peer_id") or "")
                for info in node_infos.values()
            }
            if (
                len(station_ids) != 1
                or "" in station_ids
                or len(node_ids) != 2
                or "" in node_ids
            ):
                raise ProvisioningError(
                    "remote Station cluster identity topology is invalid"
                )
            rows = _registry_rows(
                self._transport,
                self._postgres_container,
            )
            if (
                len(rows) != 2
                or {row.get("node_peer_id") for row in rows} != node_ids
                or any(
                    row.get("station_peer_id") not in station_ids
                    or row.get("mode") != "cluster"
                    or row.get("cluster_ready") is not True
                    or row.get("lifecycle_state") != "READY"
                    for row in rows
                )
                or len(
                    {row.get("shared_backing_digest") for row in rows}
                )
                != 1
                or len(
                    {row.get("enabled_owners_digest") for row in rows}
                )
                != 1
            ):
                raise ProvisioningError(
                    "remote Station node registry did not converge"
                )
            database_identity, object_identity = _remote_runtime_identity(
                self._transport,
                self._postgres_container,
                self._station_containers["station-node-a"],
            )
            services = self._service_attestations(
                manifest,
                project=project,
                node_urls=node_urls,
                database_identity=database_identity,
                object_identity=object_identity,
            )
            if any(
                not commits_match(
                    service.live_commit,
                    manifest.source_commit,
                )
                for service in services.values()
            ):
                raise ProvisioningError(
                    "remote cluster service commit does not match source"
                )
            manifest = dataclasses.replace(
                manifest,
                state=ProvisioningState.PROVISIONED,
                services=services,
            )
            self._manifest = manifest

            credential_refs, _ = self._resolve_credentials()
            evidence_run_id = os.environ.get(
                "PT_ACCEPTANCE_RUN_ID",
                "",
            ).strip()
            descriptor = {
                "artifactKind": (
                    "acceptance-disposable-runtime-descriptor"
                ),
                "environmentName": project,
                "runId": manifest.run_id,
                "evidenceRunId": evidence_run_id,
                "host": host,
                "user": user,
                "sshPort": ssh_port,
                "knownHostsFile": known_hosts,
                "stationUrl": node_urls["station-node-a"],
                "composeProject": project,
                "stationService": "station-node-a",
                "stationContainer": self._station_containers[
                    "station-node-a"
                ],
                "postgresContainer": self._postgres_container,
                "postgresVolume": f"{project}_postgres-data",
            }
            with tempfile.TemporaryDirectory(
                prefix="pt-ncp-cluster-fixture-"
            ) as raw:
                descriptor_path = Path(raw) / "runtime.json"
                descriptor_path.write_text(
                    json.dumps(descriptor, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                with _temporary_environment(
                    {
                        RESET_DESCRIPTOR_ENV: str(descriptor_path),
                        "CHAT_ACCEPTANCE_RESET": "1",
                    }
                ):
                    _, _, actor_ref = produce_bound_actor_manifest(
                        environment_id=self.environment_id,
                        run_id=manifest.run_id,
                        role_targets={
                            "alice": (
                                node_urls["station-node-a"],
                                project,
                            ),
                            "bob": (
                                node_urls["station-node-a"],
                                project,
                            ),
                        },
                        credential_ref=credential_refs[0],
                        reset_authorized=True,
                        fixture_id="ncp-cluster-actors",
                    )
            manifest = dataclasses.replace(
                manifest,
                actor_manifest_ref=actor_ref,
                credential_refs=credential_refs,
                clients=self._clients(manifest.run_id, slot),
                cleanup_resources=self.contract.cleanup.resources,
            )
            self._manifest = manifest
            return self._ready(manifest)
        except (
            BlockedError,
            OSError,
            RuntimeError,
            subprocess.SubprocessError,
            urllib.error.URLError,
            ValueError,
        ) as error:
            blocked = (
                error
                if isinstance(error, BlockedError)
                else BlockedError(
                    reason=f"Station Cluster provisioning failed: {error}",
                    resource=f"environment:{self.environment_id}",
                )
            )
            return self._blocked(
                self._manifest,
                reason=blocked.reason,
                resource=blocked.resource,
            )


def stop_cluster_node(
    manifest: Mapping[str, Any],
    node: str,
) -> dict[str, Any]:
    if node not in {"station-node-a", "station-node-b"}:
        raise ProvisioningError("cluster node control target is invalid")
    if (
        manifest.get("artifactKind") != "acceptance-runtime-manifest"
        or manifest.get("environmentId") != "node-connectivity-cluster"
        or manifest.get("gateId") != GATE_ID
    ):
        raise ProvisioningError(
            "cluster node control manifest identity is invalid"
        )
    run_id = str(manifest.get("runId") or "")
    if re.fullmatch(r"[0-9a-f]{16}", run_id) is None:
        raise ProvisioningError("cluster node control run identity is invalid")
    project = PROJECT_PREFIX + run_id
    container = f"{project}-{node}-1"
    deployment = load_env_file(
        resolve_deployment_environment_path(DEPLOYMENT_ENVIRONMENT)
    )
    transport = SshTransport(
        SshTarget(
            host=deployment.get("PT_DEPLOY_HOST", ""),
            user=deployment.get("PT_DEPLOY_USER", ""),
            port=int(deployment.get("PT_DEPLOY_SSH_PORT", "22")),
            known_hosts_file=deployment.get(
                "PT_DEPLOY_KNOWN_HOSTS_FILE",
                "",
            ),
        )
    )
    inspection = transport.run_argv(
        (
            "docker",
            "inspect",
            "--format",
            "{{json .Config.Labels}}",
            container,
        ),
        timeout=30,
        check=True,
    )
    try:
        labels = json.loads(inspection.stdout.strip())
    except json.JSONDecodeError as error:
        raise ProvisioningError(
            "cluster node control inspection is invalid"
        ) from error
    if (
        not isinstance(labels, dict)
        or labels.get("com.docker.compose.project") != project
        or labels.get("com.docker.compose.service") != node
    ):
        raise ProvisioningError(
            "cluster node control ownership does not match manifest"
        )
    started = time.monotonic()
    transport.run_argv(
        ("docker", "stop", "--time", "5", container),
        timeout=30,
        check=True,
    )
    return {
        "node": node,
        "container": container,
        "composeProject": project,
        "stopped": True,
        "durationMs": round((time.monotonic() - started) * 1000),
    }


def cluster_message_readback(
    manifest: Mapping[str, Any],
    message_id: str,
) -> dict[str, Any]:
    if (
        manifest.get("artifactKind") != "acceptance-runtime-manifest"
        or manifest.get("environmentId") != "node-connectivity-cluster"
        or manifest.get("gateId") != GATE_ID
    ):
        raise ProvisioningError(
            "cluster readback manifest identity is invalid"
        )
    run_id = str(manifest.get("runId") or "")
    if (
        re.fullmatch(r"[0-9a-f]{16}", run_id) is None
        or re.fullmatch(r"[A-Za-z0-9_-]{1,128}", message_id) is None
    ):
        raise ProvisioningError(
            "cluster readback run or message identity is invalid"
        )
    project = PROJECT_PREFIX + run_id
    postgres_container = f"{project}-postgres-1"
    deployment = load_env_file(
        resolve_deployment_environment_path(DEPLOYMENT_ENVIRONMENT)
    )
    transport = SshTransport(
        SshTarget(
            host=deployment.get("PT_DEPLOY_HOST", ""),
            user=deployment.get("PT_DEPLOY_USER", ""),
            port=int(deployment.get("PT_DEPLOY_SSH_PORT", "22")),
            known_hosts_file=deployment.get(
                "PT_DEPLOY_KNOWN_HOSTS_FILE",
                "",
            ),
        )
    )
    completed = transport.run_argv(
        (
            "docker",
            "exec",
            postgres_container,
            "sh",
            "-lc",
            (
                "psql -At -v ON_ERROR_STOP=1 "
                "-U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" "
                f"-v message_id={message_id} "
                "-c \"WITH target AS ("
                "SELECT event_id FROM conversation_events "
                "WHERE message_id = :'message_id'"
                ") SELECT json_build_object("
                "'eventCount', (SELECT count(*) FROM target), "
                "'eventId', (SELECT min(event_id) FROM target), "
                "'commitmentCount', (SELECT count(*) "
                "FROM conversation_delivery_commitments "
                "WHERE event_id IN (SELECT event_id FROM target)), "
                "'receiptCount', (SELECT count(*) "
                "FROM conversation_delivery_receipts "
                "WHERE event_id IN (SELECT event_id FROM target)))\""
            ),
        ),
        timeout=30,
        check=True,
    )
    try:
        value = json.loads(completed.stdout.strip())
    except json.JSONDecodeError as error:
        raise ProvisioningError(
            "cluster durable message readback is invalid"
        ) from error
    if not isinstance(value, dict):
        raise ProvisioningError(
            "cluster durable message readback is not an object"
        )
    value["liveNodes"] = _registry_rows(
        transport,
        postgres_container,
    )
    return value
