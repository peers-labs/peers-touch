from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence
from urllib.parse import urlparse

GIT_COMMIT = re.compile(r"^[0-9a-f]{40}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
MAX_INPUT_BYTES = 1 << 20
MODULE = "tooling.development.secure_content.activation_transport"


class ActivationTransportError(RuntimeError):
    pass


def reviewed_remote_transport(deployment_environment: str) -> Any:
    from tooling.acceptance.provisioners.remote_source_identity import (
        reviewed_remote_transport as resolve,
    )

    try:
        return resolve(deployment_environment)
    except Exception as error:
        raise ActivationTransportError(str(error)) from error


def _station_port(environment: Mapping[str, str]) -> int:
    raw = environment.get("PT_DEPLOY_HTTP_PORT", "").strip()
    if not raw:
        health_url = _required(
            environment.get("PT_DEPLOY_HEALTH_URL"),
            "PT_DEPLOY_HEALTH_URL",
        )
        try:
            raw = str(urlparse(health_url).port or "")
        except ValueError as error:
            raise ActivationTransportError(
                "PT_DEPLOY_HEALTH_URL has an invalid port"
            ) from error
    try:
        port = int(raw)
    except ValueError as error:
        raise ActivationTransportError(
            "reviewed Station port is invalid"
        ) from error
    if port < 1024 or port > 65535:
        raise ActivationTransportError(
            "reviewed Station port is outside the allowed range"
        )
    return port


def read_service_version(station_url: str) -> Mapping[str, Any]:
    from tooling.acceptance.core.attestation import read_service_version as read

    return read(station_url)


def commits_match(actual: str, expected: str) -> bool:
    from tooling.acceptance.core.attestation import commits_match as compare

    return compare(actual, expected)


def read_service_runtime_identity(station_url: str) -> str:
    from tooling.acceptance.core.attestation import (
        read_service_runtime_identity as read,
    )

    return read(station_url)


def resolve_remote_source_identity(
    deployment_environment: str,
) -> tuple[str, str, str]:
    from tooling.acceptance.provisioners.remote_source_identity import (
        resolve_remote_source_identity as resolve,
    )

    return resolve(deployment_environment)


def _required(
    value: Any,
    field: str,
    *,
    pattern: re.Pattern[str] | None = None,
) -> str:
    if not isinstance(value, str) or not value or value.strip() != value:
        raise ActivationTransportError(f"{field} is required")
    if pattern is not None and pattern.fullmatch(value) is None:
        raise ActivationTransportError(f"{field} is invalid")
    return value


def _run_checked(
    command: Sequence[str],
    *,
    cwd: Path,
    timeout: int,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        list(command),
        cwd=cwd,
        input=input_text,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout)[-4000:].strip()
        raise ActivationTransportError(
            f"{Path(command[0]).name} failed with exit "
            f"{completed.returncode}: {detail}"
        )
    return completed


def _remote_command(
    deploy_path: str,
    arguments: Sequence[str],
) -> list[str]:
    command = shlex.join(["python3", "-m", MODULE, *arguments])
    return [
        "bash",
        "-lc",
        f"cd \"$HOME\"/{shlex.quote(deploy_path)} && exec {command}",
    ]


def _deployment_environment(budget_seconds: int) -> dict[str, str]:
    # The parent owns the reset lease. Deployment acquires its own Profile lease
    # and must not receive descriptor metadata that subprocess closes on exec.
    environment = {
        key: value for key, value in os.environ.items()
        if not key.startswith("PT_MACHINE_LEASE_")
    }
    environment["PT_STATION_LEASE_BUDGET_SECONDS"] = str(budget_seconds)
    return environment


class ReviewedSchemaActivationTransport:
    def __init__(
        self,
        *,
        repo_root: Path,
        command_runner: Callable[..., subprocess.CompletedProcess[str]] = (
            subprocess.run
        ),
    ) -> None:
        self.repo_root = repo_root.resolve()
        self.command_runner = command_runner

    def prepare(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None:
        self._select_profile(request, budget_seconds=budget_seconds)
        self._deploy_and_attest(request, budget_seconds=budget_seconds)

    def deploy(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None:
        self._deploy_and_attest(request, budget_seconds=budget_seconds)

    def requiesce(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None:
        deployment_environment = _required(
            request.get("deployment_environment"),
            "deployment_environment",
            pattern=IDENTIFIER,
        )
        profile_id = _required(
            request.get("profile_id"),
            "profile_id",
            pattern=IDENTIFIER,
        )
        transport, environment = reviewed_remote_transport(
            deployment_environment
        )
        deploy_path = _required(
            environment.get("PT_DEPLOY_PATH"),
            "PT_DEPLOY_PATH",
        )
        completed = transport.run_argv(
            _remote_command(
                deploy_path,
                [
                    "remote-quiesce",
                    "--profile",
                    profile_id,
                    "--station-port",
                    str(_station_port(environment)),
                ],
            ),
            timeout=budget_seconds,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout)[-4000:].strip()
            raise ActivationTransportError(
                f"remote Station re-quiescence failed: {detail}"
            )

    def maintenance_command(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> list[str]:
        del budget_seconds
        deployment_environment = _required(
            request.get("deployment_environment"),
            "deployment_environment",
            pattern=IDENTIFIER,
        )
        transport, environment = reviewed_remote_transport(
            deployment_environment
        )
        deploy_path = _required(
            environment.get("PT_DEPLOY_PATH"),
            "PT_DEPLOY_PATH",
        )
        remote = _remote_command(
            deploy_path,
            [
                "remote-session",
                *(
                    ["--skip-quiesce"]
                    if request.get("skip_quiesce") is True
                    else []
                ),
                "--source-commit",
                _required(
                    request.get("source_commit"),
                    "source_commit",
                    pattern=GIT_COMMIT,
                ),
                "--workspace-id",
                _required(
                    request.get("workspace_id"),
                    "workspace_id",
                    pattern=IDENTIFIER,
                ),
                "--profile",
                _required(
                    request.get("profile_id"),
                    "profile_id",
                    pattern=IDENTIFIER,
                ),
                "--deployment-environment",
                deployment_environment,
                "--destructive-scope",
                _required(
                    request.get("destructive_scope"),
                    "destructive_scope",
                    pattern=IDENTIFIER,
                ),
                "--declaration-digest",
                _required(
                    request.get("declaration_digest"),
                    "declaration_digest",
                    pattern=DIGEST,
                ),
                "--station-port",
                str(_station_port(environment)),
            ],
        )
        return [
            *transport.command_prefix(),
            transport.target.destination,
            transport.render_remote_argv(remote),
        ]

    def schema_verify_command(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> list[str]:
        del budget_seconds
        deployment_environment = _required(
            request.get("deployment_environment"),
            "deployment_environment",
            pattern=IDENTIFIER,
        )
        transport, environment = reviewed_remote_transport(
            deployment_environment
        )
        deploy_path = _required(
            environment.get("PT_DEPLOY_PATH"),
            "PT_DEPLOY_PATH",
        )
        remote = _remote_command(
            deploy_path,
            [
                "remote-schema-verify",
                "--source-commit",
                _required(
                    request.get("source_commit"),
                    "source_commit",
                    pattern=GIT_COMMIT,
                ),
                "--workspace-id",
                _required(
                    request.get("workspace_id"),
                    "workspace_id",
                    pattern=IDENTIFIER,
                ),
                "--profile",
                _required(
                    request.get("profile_id"),
                    "profile_id",
                    pattern=IDENTIFIER,
                ),
                "--deployment-environment",
                deployment_environment,
                "--destructive-scope",
                _required(
                    request.get("destructive_scope"),
                    "destructive_scope",
                    pattern=IDENTIFIER,
                ),
                "--station-port",
                str(_station_port(environment)),
            ],
        )
        return [
            *transport.command_prefix(),
            transport.target.destination,
            transport.render_remote_argv(remote),
        ]

    def _deploy_and_attest(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None:
        profile_id = _required(
            request.get("profile_id"),
            "profile_id",
            pattern=IDENTIFIER,
        )
        deployment_environment = _required(
            request.get("deployment_environment"),
            "deployment_environment",
            pattern=IDENTIFIER,
        )
        station_service_id = _required(
            request.get("station_service_id"),
            "station_service_id",
            pattern=IDENTIFIER,
        )
        source_commit = _required(
            request.get("source_commit"),
            "source_commit",
            pattern=GIT_COMMIT,
        )
        profile = self._profile(profile_id)
        if profile.get("PT_STATION_MODE") != "remote":
            raise ActivationTransportError(
                f"profile {profile_id} is not a remote Station profile"
            )
        if profile.get("PT_STATION_DEPLOY_ENV") != deployment_environment:
            raise ActivationTransportError(
                f"profile {profile_id} does not bind {deployment_environment}"
            )
        station_url = _required(
            profile.get("PT_STATION_URL"),
            "PT_STATION_URL",
        )
        command_environment = _deployment_environment(budget_seconds)
        completed = self.command_runner(
            ["make", "station"],
            cwd=self.repo_root,
            env=command_environment,
            capture_output=True,
            text=True,
            timeout=budget_seconds,
            check=False,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout)[-4000:].strip()
            raise ActivationTransportError(
                f"reviewed Station deployment failed: {detail}"
            )

        version = read_service_version(station_url)
        deployed_commit, workspace_digest, protocol_digest = (
            resolve_remote_source_identity(deployment_environment)
        )
        if deployed_commit != source_commit:
            raise ActivationTransportError(
                "deployed Station source does not match activation source"
            )
        build_commit = str(version.get("build_commit") or "")
        if not commits_match(build_commit, source_commit):
            raise ActivationTransportError(
                "live Station source does not match activation source"
            )
        runtime_identity = str(
            version.get("peer_id")
            or version.get("station_peer_id")
            or version.get("service_id")
            or ""
        )
        if not runtime_identity:
            runtime_identity = read_service_runtime_identity(station_url)
        from tooling.acceptance.core.provisioning import ServiceAttestation

        attestation = ServiceAttestation(
            service_id=station_service_id,
            service_kind="station",
            environment_id=profile_id,
            deployment_environment=deployment_environment,
            endpoint=station_url.rstrip("/"),
            live_commit=deployed_commit,
            workspace_digest=workspace_digest,
            protocol_digest=protocol_digest,
            artifact_ref={},
            produced_at=datetime.now(timezone.utc).isoformat(
                timespec="milliseconds"
            ).replace("+00:00", "Z"),
            producer="secure-content-schema-activation",
            build_time=str(version.get("build_time") or ""),
            runtime_identity=runtime_identity,
        ).to_dict()
        transport, environment = reviewed_remote_transport(
            deployment_environment
        )
        deploy_path = _required(
            environment.get("PT_DEPLOY_PATH"),
            "PT_DEPLOY_PATH",
        )
        installed = transport.run_argv(
            _remote_command(
                deploy_path,
                ["install-attestation", "--profile", profile_id],
            ),
            timeout=min(budget_seconds, 60),
            input_text=json.dumps(attestation, sort_keys=True) + "\n",
        )
        if installed.returncode != 0:
            detail = (installed.stderr or installed.stdout)[-4000:].strip()
            raise ActivationTransportError(
                f"service attestation installation failed: {detail}"
            )

    def _select_profile(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None:
        profile_id = _required(
            request.get("profile_id"),
            "profile_id",
            pattern=IDENTIFIER,
        )
        command_environment = _deployment_environment(budget_seconds)
        selected = self.command_runner(
            ["make", "profile", f"PROFILE={profile_id}"],
            cwd=self.repo_root,
            env=command_environment,
            capture_output=True,
            text=True,
            timeout=min(budget_seconds, 60),
            check=False,
        )
        if selected.returncode != 0:
            detail = (selected.stderr or selected.stdout)[-4000:].strip()
            raise ActivationTransportError(
                f"reviewed Station profile selection failed: {detail}"
            )

    def _profile(self, profile_id: str) -> dict[str, str]:
        env_repo = Path(
            os.environ.get(
                "PT_ENV_REPO",
                str(self.repo_root.parent / "env"),
            )
        ).resolve()
        profile_path = (
            env_repo
            / "peers-touch"
            / profile_id
            / "profile.env.example"
        )
        if not profile_path.is_file():
            raise ActivationTransportError(
                f"reviewed profile is missing: {profile_id}"
            )
        from tooling.acceptance.core.provisioner import load_env_file

        return load_env_file(profile_path)


def _compose_container(
    repo_root: Path,
    *,
    compose_project: str,
    compose_service: str,
) -> str:
    command = ["docker", "ps", "--format", "{{.ID}}"]
    for value in (
        f"label=com.docker.compose.project={compose_project}",
        f"label=com.docker.compose.service={compose_service}",
    ):
        command.extend(["--filter", value])
    containers = [
        line.strip()
        for line in _run_checked(
            command,
            cwd=repo_root,
            timeout=15,
        ).stdout.splitlines()
        if line.strip()
    ]
    if len(containers) != 1:
        raise ActivationTransportError(
            "reviewed Compose service must own exactly one running container"
        )
    return containers[0]


def _station_container_for_port(
    repo_root: Path,
    station_port: int,
) -> tuple[str, Mapping[str, Any]]:
    candidates = [
        line.strip()
        for line in _run_checked(
            [
                "docker",
                "ps",
                "--format",
                "{{.ID}}",
                "--filter",
                "label=com.docker.compose.service=station",
            ],
            cwd=repo_root,
            timeout=15,
        ).stdout.splitlines()
        if line.strip()
    ]
    matches: list[tuple[str, Mapping[str, Any]]] = []
    for container_id in candidates:
        container = _inspect_container(repo_root, container_id)
        network_settings = container.get("NetworkSettings")
        ports = (
            network_settings.get("Ports")
            if isinstance(network_settings, Mapping)
            else None
        )
        if not isinstance(ports, Mapping):
            continue
        host_ports = {
            str(binding.get("HostPort") or "")
            for bindings in ports.values()
            if isinstance(bindings, list)
            for binding in bindings
            if isinstance(binding, Mapping)
        }
        if str(station_port) in host_ports:
            matches.append((container_id, container))
    if len(matches) != 1:
        raise ActivationTransportError(
            "reviewed Station endpoint must identify exactly one "
            "running Compose container"
        )
    return matches[0]


def _compose_project(container: Mapping[str, Any]) -> str:
    config = container.get("Config")
    labels = config.get("Labels") if isinstance(config, Mapping) else None
    return _required(
        labels.get("com.docker.compose.project")
        if isinstance(labels, Mapping)
        else None,
        "Compose project",
        pattern=IDENTIFIER,
    )


def _station_data_volume(container: Mapping[str, Any]) -> str:
    mounts = container.get("Mounts")
    if not isinstance(mounts, list):
        raise ActivationTransportError(
            "Station data volume metadata is unavailable"
        )
    matches = [
        str(mount.get("Name") or "")
        for mount in mounts
        if isinstance(mount, Mapping)
        and mount.get("Type") == "volume"
        and mount.get("Destination") == "/app/data"
        and mount.get("Name")
    ]
    if len(matches) != 1 or IDENTIFIER.fullmatch(matches[0]) is None:
        raise ActivationTransportError(
            "Station must own exactly one reviewed data volume"
        )
    return matches[0]


def _attestation_path(repo_root: Path, profile_id: str) -> Path:
    return (
        repo_root.parent
        / "secure-content"
        / f"{profile_id}-service-attestation.json"
    )


def _remote_source(repo_root: Path, expected_commit: str) -> None:
    head = _run_checked(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        timeout=10,
    ).stdout.strip()
    if head != expected_commit:
        raise ActivationTransportError(
            "remote maintenance source does not match activation source"
        )
    status = _run_checked(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        cwd=repo_root,
        timeout=10,
    ).stdout.splitlines()
    dirty = [line for line in status if line != "?? .bare.git/"]
    if dirty:
        raise ActivationTransportError(
            "remote maintenance source is dirty"
        )


def _quiesce(
    repo_root: Path,
    *,
    station_port: int,
) -> None:
    station_container, _inspection = _station_container_for_port(
        repo_root,
        station_port,
    )
    _run_checked(
        ["docker", "stop", "-t", "30", station_container],
        cwd=repo_root,
        timeout=60,
    )
    state = _run_checked(
        [
            "docker",
            "inspect",
            "--format",
            "{{.State.Running}}",
            station_container,
        ],
        cwd=repo_root,
        timeout=15,
    ).stdout.strip()
    if state != "false":
        raise ActivationTransportError("Station did not become quiescent")


def _install_attestation(repo_root: Path, profile_id: str) -> None:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if not raw or len(raw) > MAX_INPUT_BYTES:
        raise ActivationTransportError(
            "service attestation input has an invalid size"
        )
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ActivationTransportError(
            "service attestation input is not JSON"
        ) from error
    if not isinstance(payload, dict):
        raise ActivationTransportError(
            "service attestation input must be an object"
        )
    path = _attestation_path(repo_root, profile_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and (path.is_symlink() or not path.is_file()):
        raise ActivationTransportError(
            "service attestation target is not a regular file"
        )
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    path.chmod(0o600)
    print(json.dumps({"status": "PASS", "path": str(path)}))


def _inspect_container(repo_root: Path, container_id: str) -> Mapping[str, Any]:
    try:
        value = json.loads(
            _run_checked(
                ["docker", "inspect", container_id],
                cwd=repo_root,
                timeout=15,
            ).stdout
        )
    except json.JSONDecodeError as error:
        raise ActivationTransportError(
            "reviewed Compose container inspection is invalid"
        ) from error
    if not isinstance(value, list) or len(value) != 1 or not isinstance(
        value[0],
        Mapping,
    ):
        raise ActivationTransportError(
            "reviewed Compose container inspection is incomplete"
        )
    return value[0]


def _container_environment(container: Mapping[str, Any]) -> dict[str, str]:
    config = container.get("Config")
    values = config.get("Env") if isinstance(config, Mapping) else None
    if not isinstance(values, list):
        raise ActivationTransportError(
            "reviewed Compose container environment is unavailable"
        )
    result: dict[str, str] = {}
    for raw in values:
        if isinstance(raw, str) and "=" in raw:
            key, value = raw.split("=", 1)
            result[key] = value
    return result


def _remote_maintenance(arguments: argparse.Namespace) -> None:
    repo_root = Path(arguments.repo_root).resolve()
    _remote_source(repo_root, arguments.source_commit)
    attestation = _attestation_path(repo_root, arguments.profile)
    if not attestation.is_file():
        raise ActivationTransportError(
            "service attestation is missing before maintenance startup"
        )
    station_container, station = _station_container_for_port(
        repo_root,
        arguments.station_port,
    )
    compose_project = _compose_project(station)
    database_container = _compose_container(
        repo_root,
        compose_project=compose_project,
        compose_service="postgres",
    )
    database = _inspect_container(repo_root, database_container)
    network = f"{compose_project}_default"
    for label, container in (
        ("Station", station),
        ("PostgreSQL", database),
    ):
        network_settings = container.get("NetworkSettings")
        networks = (
            network_settings.get("Networks")
            if isinstance(network_settings, Mapping)
            else None
        )
        if not isinstance(networks, Mapping) or network not in networks:
            raise ActivationTransportError(
                f"{label} is not attached to the reviewed Compose network"
            )
    data_volume = _station_data_volume(station)
    station_config = station.get("Config")
    station_image = _required(
        station_config.get("Image")
        if isinstance(station_config, Mapping)
        else None,
        "Station image",
    )
    database_environment = _container_environment(database)
    database_user = database_environment.get("POSTGRES_USER", "peers")
    database_password = _required(
        database_environment.get("POSTGRES_PASSWORD"),
        "POSTGRES_PASSWORD",
    )
    database_name = database_environment.get("POSTGRES_DB", "peers_touch")
    runtime_environment = (
        repo_root.parent
        / "secure-content"
        / f"{arguments.profile}-maintenance.env"
    )
    runtime_environment.parent.mkdir(parents=True, exist_ok=True)
    environment_values = {
        "PT_SECURE_CONTENT_WORKSPACE_ID": arguments.workspace_id,
        "PT_SECURE_CONTENT_PROFILE_ID": arguments.profile,
        "PT_SECURE_CONTENT_DEPLOYMENT_ENVIRONMENT": (
            arguments.deployment_environment
        ),
        "PT_SECURE_CONTENT_DESTRUCTIVE_SCOPE": arguments.destructive_scope,
        "PT_SECURE_CONTENT_POSTGRES_DSN": (
            f"host=postgres user={database_user} "
            f"password={database_password} dbname={database_name} "
            "port=5432 sslmode=disable TimeZone=Asia/Shanghai"
        ),
        "PT_SECURE_CONTENT_SOCIAL_PRIVATE_OBJECT_ROOT": (
            "/app/data/social-private-objects"
        ),
        "PT_SECURE_CONTENT_OSS_BACKEND": "local",
        "PT_SECURE_CONTENT_OSS_LOCAL_ROOT": "/app/data/oss",
        "PT_SECURE_CONTENT_SERVICE_ATTESTATION_FILE": (
            "/app/secure-content-service-attestation.json"
        ),
        "PT_SECURE_CONTENT_STATION_QUIESCE_COMMAND_JSON": (
            '["/bin/true"]'
        ),
    }
    schema_verify = arguments.command == "remote-schema-verify"
    if not schema_verify:
        environment_values["PT_SECURE_CONTENT_DECLARATION_DIGEST"] = (
            arguments.declaration_digest
        )
    for key, value in environment_values.items():
        if "\n" in value or "\r" in value:
            raise ActivationTransportError(
                f"{key} contains an invalid newline"
            )
    with runtime_environment.open("w", encoding="utf-8") as handle:
        for key, value in environment_values.items():
            handle.write(f"{key}={value}\n")
        handle.flush()
        os.fsync(handle.fileno())
    runtime_environment.chmod(0o600)
    operation = "schema_verify" if schema_verify else "session"
    shell = f"exec /app/secure-content-maintenance --operation {operation}"
    process = subprocess.Popen(
        [
            "docker",
            "run",
            "--rm",
            "-i",
            "--network",
            network,
            "--env-file",
            str(runtime_environment),
            "--entrypoint",
            "/bin/sh",
            "-v",
            f"{data_volume}:/app/data",
            "-v",
            (
                f"{attestation}:"
                "/app/secure-content-service-attestation.json:ro"
            ),
            station_image,
            "-lc",
            shell,
        ],
        cwd=repo_root,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    quiesced = False
    try:
        assert process.stdin is not None
        assert process.stdout is not None
        if schema_verify:
            raw = sys.stdin.read(MAX_INPUT_BYTES + 1)
            if not raw or len(raw.encode("utf-8")) > MAX_INPUT_BYTES:
                raise ActivationTransportError(
                    "schema verification input has an invalid size"
                )
            process.stdin.write(raw)
            process.stdin.close()
            response = process.stdout.read()
            if not response:
                detail = (
                    process.stderr.read()[-4000:]
                    if process.stderr is not None
                    else ""
                )
                raise ActivationTransportError(
                    f"maintenance container closed: {detail}"
                )
            sys.stdout.write(response)
            sys.stdout.flush()
        else:
            for line in sys.stdin:
                try:
                    envelope = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ActivationTransportError(
                        "maintenance envelope is not JSON"
                    ) from error
                operation = (
                    envelope.get("operation")
                    if isinstance(envelope, dict)
                    else None
                )
                if (
                    operation == "reset"
                    and not quiesced
                    and not arguments.skip_quiesce
                ):
                    _quiesce(
                        repo_root,
                        station_port=arguments.station_port,
                    )
                    quiesced = True
                process.stdin.write(line)
                process.stdin.flush()
                response = process.stdout.readline()
                if not response:
                    detail = (
                        process.stderr.read()[-4000:]
                        if process.stderr is not None
                        else ""
                    )
                    raise ActivationTransportError(
                        f"maintenance container closed: {detail}"
                    )
                sys.stdout.write(response)
                sys.stdout.flush()
    finally:
        if process.stdin is not None and not process.stdin.closed:
            process.stdin.close()
        try:
            return_code = process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                return_code = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                return_code = process.wait()
        try:
            runtime_environment.unlink()
        except FileNotFoundError:
            pass
        if return_code != 0 and sys.exc_info()[0] is None:
            detail = (
                process.stderr.read()[-4000:]
                if process.stderr is not None
                else ""
            )
            raise ActivationTransportError(
                f"maintenance container exited with {return_code}: {detail}"
            )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    install = subparsers.add_parser("install-attestation")
    install.add_argument("--profile", required=True)
    install.add_argument("--repo-root", default=".")

    quiesce = subparsers.add_parser("remote-quiesce")
    quiesce.add_argument("--profile", required=True)
    quiesce.add_argument("--repo-root", default=".")

    session = subparsers.add_parser("remote-session")
    session.add_argument("--repo-root", default=".")
    session.add_argument("--source-commit", required=True)
    session.add_argument("--workspace-id", required=True)
    session.add_argument("--profile", required=True)
    session.add_argument("--deployment-environment", required=True)
    session.add_argument("--destructive-scope", required=True)
    session.add_argument("--declaration-digest", required=True)
    session.add_argument("--skip-quiesce", action="store_true")

    verify = subparsers.add_parser("remote-schema-verify")
    verify.add_argument("--repo-root", default=".")
    verify.add_argument("--source-commit", required=True)
    verify.add_argument("--workspace-id", required=True)
    verify.add_argument("--profile", required=True)
    verify.add_argument("--deployment-environment", required=True)
    verify.add_argument("--destructive-scope", required=True)
    for remote in (quiesce, session, verify):
        remote.add_argument("--station-port", required=True, type=int)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        arguments.profile = _required(
            arguments.profile,
            "profile",
            pattern=IDENTIFIER,
        )
        repo_root = Path(arguments.repo_root).resolve()
        if arguments.command == "install-attestation":
            _install_attestation(repo_root, arguments.profile)
        else:
            if arguments.station_port < 1024 or arguments.station_port > 65535:
                raise ActivationTransportError(
                    "station_port is outside the allowed range"
                )
            if arguments.command == "remote-quiesce":
                _quiesce(
                    repo_root,
                    station_port=arguments.station_port,
                )
                return 0
            arguments.source_commit = _required(
                arguments.source_commit,
                "source_commit",
                pattern=GIT_COMMIT,
            )
            arguments.workspace_id = _required(
                arguments.workspace_id,
                "workspace_id",
                pattern=IDENTIFIER,
            )
            arguments.deployment_environment = _required(
                arguments.deployment_environment,
                "deployment_environment",
                pattern=IDENTIFIER,
            )
            arguments.destructive_scope = _required(
                arguments.destructive_scope,
                "destructive_scope",
                pattern=IDENTIFIER,
            )
            if arguments.command == "remote-session":
                arguments.declaration_digest = _required(
                    arguments.declaration_digest,
                    "declaration_digest",
                    pattern=DIGEST,
                )
            _remote_maintenance(arguments)
    except (
        ActivationTransportError,
        OSError,
        subprocess.SubprocessError,
        UnicodeDecodeError,
        ValueError,
    ) as error:
        print(
            json.dumps(
                {
                    "status": "BLOCKED",
                    "code": "SCHEMA_ACTIVATION_TRANSPORT_UNAVAILABLE",
                    "message": str(error),
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
