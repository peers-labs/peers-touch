#!/usr/bin/env python3
"""Bounded Station restart control for the Foundation AS-F06 scenario."""

from __future__ import annotations

import hashlib
import json
from math import ceil
import os
import re
import selectors
import shlex
import subprocess
import time
import urllib.parse
import urllib.request
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Callable

from tooling.acceptance.core.attestation import source_proto_digest
from tooling.acceptance.core.provisioner import load_env_file


EXPECTED_SERVICE_LABEL = "station"
EXPECTED_CONTAINER_PORT = 18080
RESTART_TIMEOUT_SECONDS = 180
RESTORE_RESERVE_SECONDS = 15


class FoundationStationRestartError(RuntimeError):
    """The AS-F06 Station restart target is not uniquely source-bound."""


def _hex_identifiers_match(
    left: str,
    right: str,
    *,
    minimum_length: int,
    maximum_length: int,
) -> bool:
    normalized_left = left.strip().lower()
    normalized_right = right.strip().lower()
    pattern = re.compile(rf"^[0-9a-f]{{{minimum_length},{maximum_length}}}$")
    return (
        bool(pattern.fullmatch(normalized_left))
        and bool(pattern.fullmatch(normalized_right))
        and (
            normalized_left.startswith(normalized_right)
            or normalized_right.startswith(normalized_left)
        )
    )


def _commits_match(left: str, right: str) -> bool:
    return _hex_identifiers_match(
        left,
        right,
        minimum_length=12,
        maximum_length=40,
    )


def _container_ids_match(left: str, right: str) -> bool:
    return _hex_identifiers_match(
        left,
        right,
        minimum_length=12,
        maximum_length=64,
    )


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _remaining_seconds(deadline: float, operation: str) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise FoundationStationRestartError(
            f"AS-F06 Station outage deadline expired during {operation}"
        )
    return remaining


def _station_version(url: str, *, timeout: float = 5) -> dict[str, Any]:
    with urllib.request.urlopen(
        f"{url.rstrip('/')}/app-meta/version",
        timeout=timeout,
    ) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise FoundationStationRestartError(
            "AS-F06 Station version response is invalid"
        )
    return value


def _station_healthy(health_url: str, *, timeout: float = 5) -> bool:
    try:
        with urllib.request.urlopen(health_url, timeout=timeout) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def _remote_command(
    environment: Mapping[str, str],
    command: str,
    *,
    deadline: float | None = None,
) -> str:
    host = environment.get("PT_DEPLOY_HOST", "").strip()
    user = environment.get("PT_DEPLOY_USER", "").strip()
    if not host or not user:
        raise FoundationStationRestartError(
            "AS-F06 deployment must define PT_DEPLOY_HOST and PT_DEPLOY_USER"
        )
    timeout = (
        RESTART_TIMEOUT_SECONDS
        if deadline is None
        else _remaining_seconds(deadline, f"remote command: {command}")
    )
    connect_timeout = max(1, min(10, ceil(timeout)))
    completed = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            f"ConnectTimeout={connect_timeout}",
            f"{user}@{host}",
            command,
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return completed.stdout.strip()


class _ArmedRemoteKill:
    def __init__(
        self,
        environment: Mapping[str, str],
        container_id: str,
        *,
        deadline: float,
    ) -> None:
        host = environment.get("PT_DEPLOY_HOST", "").strip()
        user = environment.get("PT_DEPLOY_USER", "").strip()
        if not host or not user:
            raise FoundationStationRestartError(
                "AS-F06 deployment must define PT_DEPLOY_HOST and PT_DEPLOY_USER"
            )
        timeout = _remaining_seconds(deadline, "arming Station abrupt stop")
        connect_timeout = max(1, min(10, ceil(timeout)))
        remote_command = (
            "printf 'READY\\n'; "
            "if IFS= read -r trigger && [ \"$trigger\" = KILL ]; then "
            f"docker kill --signal KILL {shlex.quote(container_id)}; "
            "fi"
        )
        self._process = subprocess.Popen(
            [
                "ssh",
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                f"ConnectTimeout={connect_timeout}",
                f"{user}@{host}",
                remote_command,
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._settled = False
        stdout = self._process.stdout
        if stdout is None:
            self.abort()
            raise FoundationStationRestartError(
                "AS-F06 pre-armed Station stop has no stdout"
            )
        selector = selectors.DefaultSelector()
        try:
            selector.register(stdout, selectors.EVENT_READ)
            if not selector.select(timeout):
                self.abort()
                raise FoundationStationRestartError(
                    "AS-F06 pre-armed Station stop did not become ready"
                )
            ready = stdout.readline().strip()
        finally:
            selector.close()
        if ready != "READY":
            self.abort()
            raise FoundationStationRestartError(
                "AS-F06 pre-armed Station stop returned invalid readiness"
            )

    def _settle(self, signal: str, deadline: float) -> str:
        if self._settled:
            raise FoundationStationRestartError(
                "AS-F06 pre-armed Station stop was already settled"
            )
        self._settled = True
        stdin = self._process.stdin
        if stdin is None:
            raise FoundationStationRestartError(
                "AS-F06 pre-armed Station stop has no stdin"
            )
        stdin.write(f"{signal}\n")
        stdin.flush()
        stdin.close()
        self._process.stdin = None
        try:
            stdout, stderr = self._process.communicate(
                timeout=_remaining_seconds(
                    deadline,
                    "pre-armed Station abrupt stop",
                ),
            )
        except subprocess.TimeoutExpired as error:
            self._process.kill()
            self._process.communicate()
            raise FoundationStationRestartError(
                "AS-F06 pre-armed Station stop timed out"
            ) from error
        if self._process.returncode != 0:
            raise FoundationStationRestartError(
                "AS-F06 pre-armed Station stop failed: "
                f"{stderr.strip()[:512]}"
            )
        return stdout.strip()

    def trigger(self, *, deadline: float) -> str:
        return self._settle("KILL", deadline)

    def abort(self) -> None:
        if self._settled:
            return
        abort_deadline = time.monotonic() + 10
        try:
            self._settle("ABORT", abort_deadline)
        except Exception:
            if self._process.poll() is None:
                self._process.kill()
                self._process.communicate()


def _reviewed_environment_file(
    repo_root: Path,
    *,
    profile_name: str,
    deployment_name: str | None = None,
) -> Path:
    identifier_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
    if not identifier_pattern.fullmatch(profile_name) or (
        deployment_name is not None
        and not identifier_pattern.fullmatch(deployment_name)
    ):
        raise FoundationStationRestartError(
            "AS-F06 environment identity is invalid"
        )
    env_root = Path(
        os.environ.get("PT_ENV_REPO", "").strip()
        or repo_root.parent / "env"
    ).expanduser().resolve()
    if not (env_root / "peers-touch").is_dir():
        raise FoundationStationRestartError(
            f"AS-F06 reviewed environment repository is unavailable: {env_root}"
        )
    if deployment_name is None:
        candidates = [
            env_root / "peers-touch" / profile_name / "profile.env.example"
        ]
    else:
        candidates = sorted(
            (env_root / "peers-touch").glob(
                f"*/deploy/{deployment_name}.env.example"
            )
        )
    if len(candidates) != 1 or not candidates[0].is_file():
        identity = deployment_name or profile_name
        raise FoundationStationRestartError(
            f"AS-F06 environment identity {identity!r} must resolve to exactly "
            f"one env-repository definition"
        )
    path = candidates[0].resolve()
    relative = path.relative_to(env_root).as_posix()
    relative_parts = Path(relative).parts
    profile_dir = "/".join(relative_parts[:2])
    tracked = subprocess.run(
        ["git", "-C", str(env_root), "ls-files", "--error-unmatch", relative],
        capture_output=True,
        text=True,
        check=False,
    )
    if tracked.returncode != 0:
        raise FoundationStationRestartError(
            f"AS-F06 environment definition is not Git-tracked: {relative}"
        )
    dirty = subprocess.run(
        [
            "git",
            "-C",
            str(env_root),
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--",
            profile_dir,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    if dirty.stdout.strip():
        raise FoundationStationRestartError(
            f"AS-F06 environment definition is dirty or untracked: {profile_dir}"
        )
    return path


def _load_bound_environment(
    runtime_manifest: Mapping[str, Any],
    repo_root: Path,
) -> tuple[dict[str, str], dict[str, str], str, str, str, str]:
    if os.environ.get("PT_AGENT_ALLOW_STATION_RESTART") != "1":
        raise FoundationStationRestartError(
            "PT_AGENT_ALLOW_STATION_RESTART=1 is required for AS-F06"
        )

    profile = runtime_manifest.get("profile")
    source = runtime_manifest.get("source")
    services = runtime_manifest.get("services")
    station = services.get("station") if isinstance(services, Mapping) else None
    if not all(isinstance(value, Mapping) for value in (profile, source, station)):
        raise FoundationStationRestartError(
            "AS-F06 runtime manifest is missing profile/source/service identity"
        )
    assert isinstance(profile, Mapping)
    assert isinstance(source, Mapping)
    assert isinstance(station, Mapping)
    profile_name = str(profile.get("resolvedName") or "").strip()
    approved_profile = os.environ.get("PT_ACCEPTANCE_APPROVED_PROFILE", "").strip()
    if not approved_profile or profile_name != approved_profile:
        raise FoundationStationRestartError(
            "AS-F06 runtime manifest profile does not match "
            "PT_ACCEPTANCE_APPROVED_PROFILE"
        )
    if os.environ.get("PT_ACCEPTANCE_DISPOSABLE") != "1":
        raise FoundationStationRestartError(
            "PT_ACCEPTANCE_DISPOSABLE=1 is required for AS-F06"
        )

    profile_path = _reviewed_environment_file(
        repo_root,
        profile_name=profile_name,
    )
    profile_env = load_env_file(profile_path)
    deployment_name = profile_env.get("PT_STATION_DEPLOY_ENV", "").strip()
    if not deployment_name:
        raise FoundationStationRestartError(
            "AS-F06 requires the approved profile deployment identity"
        )
    deployment_path = _reviewed_environment_file(
        repo_root,
        profile_name=profile_name,
        deployment_name=deployment_name,
    )
    deployment_env = load_env_file(deployment_path)
    if (
        profile_env.get("PT_DEV_PROFILE") != profile_name
        or station.get("deploymentEnvironment") != deployment_name
        or deployment_env.get("PT_ACCEPTANCE_DISPOSABLE") != "1"
    ):
        raise FoundationStationRestartError(
            "AS-F06 requires an approved disposable Station deployment"
        )

    station_url = str(station.get("endpoint") or "").rstrip("/")
    expected_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
    health_url = profile_env.get("PT_STATION_HEALTH_URL", "").strip()
    parsed = urllib.parse.urlparse(station_url)
    try:
        station_port = int(profile_env.get("PT_STATION_PORT", ""))
    except ValueError as error:
        raise FoundationStationRestartError(
            "AS-F06 approved profile Station port is invalid"
        ) from error
    project_label = deployment_env.get("PT_ACCEPTANCE_COMPOSE_PROJECT", "").strip()
    if (
        not station_url
        or station_url != expected_url
        or parsed.hostname != deployment_env.get("PT_DEPLOY_HOST", "").strip()
        or parsed.port != station_port
        or not health_url
        or not project_label
    ):
        raise FoundationStationRestartError(
            "AS-F06 Station identity does not match the approved disposable profile"
        )

    source_commit = str(source.get("commit") or "")
    source_workspace_digest = str(source.get("workspaceDigest") or "")
    live_commit = str(station.get("liveCommit") or "")
    station_workspace_digest = str(station.get("workspaceDigest") or "")
    proto_digest = str(station.get("protocolDigest") or "")
    if source_workspace_digest != "clean" or station_workspace_digest != "clean":
        raise FoundationStationRestartError(
            "AS-F06 requires clean source and Station workspace digests"
        )
    if not _commits_match(source_commit, live_commit):
        raise FoundationStationRestartError(
            "AS-F06 runtime manifest source and Station commits differ"
        )
    if not proto_digest or proto_digest != source_proto_digest(repo_root):
        raise FoundationStationRestartError(
            "AS-F06 runtime manifest proto identity differs from source"
        )
    return (
        profile_env,
        deployment_env,
        station_url,
        health_url,
        source_commit,
        proto_digest,
        profile_name,
        deployment_name,
        project_label,
        station_port,
    )


def _container_snapshot(
    environment: Mapping[str, str],
    *,
    project_label: str,
    station_port: int,
    deadline: float | None = None,
) -> dict[str, str]:
    filters = " ".join(
        (
            f"--filter label=com.docker.compose.project={project_label}",
            f"--filter label=com.docker.compose.service={EXPECTED_SERVICE_LABEL}",
            f"--filter publish={station_port}",
        )
    )
    output = _remote_command(
        environment,
        f"docker ps {filters} --format '{{{{.ID}}}}'",
        deadline=deadline,
    )
    container_ids = [line.strip() for line in output.splitlines() if line.strip()]
    if len(container_ids) != 1:
        raise FoundationStationRestartError(
            "AS-F06 requires exactly one approved disposable Station container "
            f"selected by service labels and port; found {len(container_ids)}"
        )
    container_id = container_ids[0]
    raw = _remote_command(
        environment,
        f"docker inspect {shlex.quote(container_id)}",
        deadline=deadline,
    )
    value = json.loads(raw)
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        raise FoundationStationRestartError(
            "AS-F06 Station container inspect result is invalid"
        )
    inspect = value[0]
    config = inspect.get("Config")
    state = inspect.get("State")
    network = inspect.get("NetworkSettings")
    if not all(isinstance(item, Mapping) for item in (config, state, network)):
        raise FoundationStationRestartError(
            "AS-F06 Station container identity is incomplete"
        )
    assert isinstance(config, Mapping)
    assert isinstance(state, Mapping)
    assert isinstance(network, Mapping)
    labels = config.get("Labels")
    ports = network.get("Ports")
    if not isinstance(labels, Mapping) or not isinstance(ports, Mapping):
        raise FoundationStationRestartError(
            "AS-F06 Station container labels or ports are missing"
        )
    host_bindings = ports.get(f"{EXPECTED_CONTAINER_PORT}/tcp")
    has_expected_port = isinstance(host_bindings, list) and any(
        isinstance(binding, Mapping)
        and str(binding.get("HostPort") or "") == str(station_port)
        for binding in host_bindings
    )
    if (
        labels.get("com.docker.compose.project") != project_label
        or labels.get("com.docker.compose.service") != EXPECTED_SERVICE_LABEL
        or not has_expected_port
    ):
        raise FoundationStationRestartError(
            "AS-F06 Station container identity does not match labels and port"
        )
    started_at = str(state.get("StartedAt") or "")
    image_id = str(inspect.get("Image") or "")
    image_ref = str(config.get("Image") or "")
    canonical_id = str(inspect.get("Id") or "")
    if not all((canonical_id, image_id, image_ref, started_at)):
        raise FoundationStationRestartError(
            "AS-F06 Station container image/start identity is incomplete"
        )
    return {
        "containerId": canonical_id,
        "imageId": image_id,
        "imageRef": image_ref,
        "startedAt": started_at,
    }


def restart_foundation_station(
    runtime_manifest: Mapping[str, Any],
    *,
    repo_root: Path,
    before_outage: Callable[[], None] | None = None,
    during_outage: Callable[[float], None] | None = None,
    after_restart: Callable[[float], None] | None = None,
    prearm_outage: bool = False,
) -> dict[str, Any]:
    (
        _profile_env,
        deployment_env,
        station_url,
        health_url,
        source_commit,
        proto_digest,
        profile_name,
        deployment_name,
        project_label,
        station_port,
    ) = _load_bound_environment(runtime_manifest, repo_root)
    before_version = _station_version(station_url)
    before_commit = str(before_version.get("build_commit") or "")
    if not _commits_match(before_commit, source_commit):
        raise FoundationStationRestartError(
            "AS-F06 live Station commit differs before restart"
        )
    before = _container_snapshot(
        deployment_env,
        project_label=project_label,
        station_port=station_port,
    )
    operation_started_at = time.monotonic()
    operation_deadline = operation_started_at + RESTART_TIMEOUT_SECONDS
    armed_kill: _ArmedRemoteKill | None = None
    if prearm_outage:
        if during_outage is None:
            raise FoundationStationRestartError(
                "AS-F06 pre-armed Station stop requires an outage callback"
            )
        armed_kill = _ArmedRemoteKill(
            deployment_env,
            before["containerId"],
            deadline=operation_deadline,
        )
    try:
        if before_outage is not None:
            before_outage()
    except BaseException:
        if armed_kill is not None:
            armed_kill.abort()
        raise

    outage_error: BaseException | None = None
    if during_outage is None:
        restarted = _remote_command(
            deployment_env,
            f"docker restart {shlex.quote(before['containerId'])}",
            deadline=operation_deadline,
        )
        if not _container_ids_match(restarted, before["containerId"]):
            raise FoundationStationRestartError(
                "AS-F06 docker restart returned a different container identity"
            )
    else:
        try:
            stop_deadline = operation_deadline - RESTORE_RESERVE_SECONDS
            _remaining_seconds(stop_deadline, "Station abrupt stop")
            stopped = (
                armed_kill.trigger(deadline=stop_deadline)
                if armed_kill is not None
                else _remote_command(
                    deployment_env,
                    "docker kill --signal KILL "
                    f"{shlex.quote(before['containerId'])}",
                    deadline=stop_deadline,
                )
            )
            if not _container_ids_match(stopped, before["containerId"]):
                raise FoundationStationRestartError(
                    "AS-F06 docker kill returned a different container identity"
                )
            health_down_deadline = min(
                operation_deadline - RESTORE_RESERVE_SECONDS,
                time.monotonic() + 30,
            )
            while time.monotonic() < health_down_deadline:
                health_timeout = min(
                    5,
                    _remaining_seconds(
                        health_down_deadline,
                        "Station health-down wait",
                    ),
                )
                if not _station_healthy(
                    health_url,
                    timeout=health_timeout,
                ):
                    break
                time.sleep(min(0.5, _remaining_seconds(
                    health_down_deadline,
                    "Station health-down wait",
                )))
            else:
                raise FoundationStationRestartError(
                    "AS-F06 Station remained healthy after bounded stop"
                )
            callback_deadline = operation_deadline - RESTORE_RESERVE_SECONDS
            _remaining_seconds(callback_deadline, "outage callback")
            during_outage(callback_deadline)
        except BaseException as error:
            outage_error = error
        finally:
            started = _remote_command(
                deployment_env,
                f"docker start {shlex.quote(before['containerId'])}",
                deadline=operation_deadline,
            )
            if not _container_ids_match(started, before["containerId"]):
                raise FoundationStationRestartError(
                    "AS-F06 docker start returned a different container identity"
                )

    after_version: dict[str, Any] | None = None
    while time.monotonic() < operation_deadline:
        try:
            request_timeout = min(
                5,
                _remaining_seconds(
                    operation_deadline,
                    "Station recovery verification",
                ),
            )
            candidate = _station_version(
                station_url,
                timeout=request_timeout,
            )
            candidate_commit = str(candidate.get("build_commit") or "")
            health_timeout = min(
                5,
                _remaining_seconds(
                    operation_deadline,
                    "Station recovery health verification",
                ),
            )
            if (
                _station_healthy(health_url, timeout=health_timeout)
                and _commits_match(candidate_commit, source_commit)
            ):
                after_version = candidate
                break
        except Exception:
            pass
        time.sleep(min(1, _remaining_seconds(
            operation_deadline,
            "Station recovery verification",
        )))
    if after_version is None:
        raise FoundationStationRestartError(
            "AS-F06 Station did not recover with the source commit"
        )
    after = _container_snapshot(
        deployment_env,
        project_label=project_label,
        station_port=station_port,
        deadline=operation_deadline,
    )
    if (
        after["containerId"] != before["containerId"]
        or after["imageId"] != before["imageId"]
        or after["imageRef"] != before["imageRef"]
    ):
        raise FoundationStationRestartError(
            "AS-F06 Station container or image changed across restart"
        )
    if after["startedAt"] == before["startedAt"]:
        raise FoundationStationRestartError(
            "AS-F06 Station StartedAt did not change"
        )
    if during_outage is not None and outage_error is not None:
        raise outage_error
    if after_restart is not None:
        _remaining_seconds(operation_deadline, "post-restart callback")
        after_restart(operation_deadline)
        _remaining_seconds(operation_deadline, "post-restart verification")
    return {
        "profile": profile_name,
        "deploymentEnvironment": deployment_name,
        "stationUrlHash": _sha256(station_url),
        "sourceCommit": source_commit,
        "protoDigest": proto_digest,
        "containerId": before["containerId"],
        "imageId": before["imageId"],
        "imageRef": before["imageRef"],
        "beforeStartedAt": before["startedAt"],
        "afterStartedAt": after["startedAt"],
        "beforeCommit": before_commit,
        "afterCommit": str(after_version.get("build_commit") or ""),
        "outageObserved": during_outage is not None,
        "deadlineSeconds": RESTART_TIMEOUT_SECONDS,
        "operationDurationMs": round(
            (time.monotonic() - operation_started_at) * 1000,
        ),
    }
