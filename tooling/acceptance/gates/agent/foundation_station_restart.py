#!/usr/bin/env python3
"""Bounded Station restart control for the Foundation AS-F06 scenario."""

from __future__ import annotations

import hashlib
import json
from math import ceil
import os
import re
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


EXPECTED_PROFILE = "two"
EXPECTED_DEPLOYMENT = "station-two"
EXPECTED_PROJECT_LABEL = "pt-station-two"
EXPECTED_SERVICE_LABEL = "station"
EXPECTED_STATION_PORT = 18080
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
            "station-two must define PT_DEPLOY_HOST and PT_DEPLOY_USER"
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


def _load_bound_environment(
    runtime_manifest: Mapping[str, Any],
    repo_root: Path,
) -> tuple[dict[str, str], dict[str, str], str, str, str]:
    if os.environ.get("PT_AGENT_V2_ALLOW_STATION_RESTART") != "1":
        raise FoundationStationRestartError(
            "PT_AGENT_V2_ALLOW_STATION_RESTART=1 is required for AS-F06"
        )

    profile = runtime_manifest.get("profile")
    source = runtime_manifest.get("source")
    station = runtime_manifest.get("station")
    if not all(isinstance(value, Mapping) for value in (profile, source, station)):
        raise FoundationStationRestartError(
            "AS-F06 runtime manifest is missing profile/source/station identity"
        )
    assert isinstance(profile, Mapping)
    assert isinstance(source, Mapping)
    assert isinstance(station, Mapping)
    if profile.get("resolvedName") != EXPECTED_PROFILE:
        raise FoundationStationRestartError(
            "AS-F06 requires runtime manifest profile two"
        )

    profile_path = repo_root / ".local" / "dev" / "profiles" / "two.env"
    deployment_path = (
        repo_root / ".local" / "deploy" / "envs" / "station-two.env"
    )
    if not profile_path.is_file() or not deployment_path.is_file():
        raise FoundationStationRestartError(
            "AS-F06 requires profile two and station-two deployment identity"
        )
    profile_env = load_env_file(profile_path)
    deployment_env = load_env_file(deployment_path)
    if (
        profile_env.get("PT_DEV_PROFILE") != EXPECTED_PROFILE
        or profile_env.get("PT_STATION_DEPLOY_ENV") != EXPECTED_DEPLOYMENT
    ):
        raise FoundationStationRestartError(
            "AS-F06 profile two is not bound to station-two"
        )

    station_url = str(station.get("url") or "").rstrip("/")
    expected_url = profile_env.get("PT_STATION_URL", "").rstrip("/")
    health_url = profile_env.get("PT_STATION_HEALTH_URL", "").strip()
    parsed = urllib.parse.urlparse(station_url)
    if (
        not station_url
        or station_url != expected_url
        or parsed.hostname != deployment_env.get("PT_DEPLOY_HOST", "").strip()
        or parsed.port != EXPECTED_STATION_PORT
        or not health_url
    ):
        raise FoundationStationRestartError(
            "AS-F06 Station URL does not match profile two/station-two"
        )

    source_commit = str(source.get("commit") or "")
    source_workspace_digest = str(source.get("workspaceDigest") or "")
    live_commit = str(station.get("liveCommit") or "")
    station_workspace_digest = str(station.get("workspaceDigest") or "")
    proto_digest = str(station.get("protoDigest") or "")
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
    return profile_env, deployment_env, station_url, health_url, source_commit


def _container_snapshot(
    environment: Mapping[str, str],
    *,
    deadline: float | None = None,
) -> dict[str, str]:
    filters = " ".join(
        (
            f"--filter label=com.docker.compose.project={EXPECTED_PROJECT_LABEL}",
            f"--filter label=com.docker.compose.service={EXPECTED_SERVICE_LABEL}",
            f"--filter publish={EXPECTED_STATION_PORT}",
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
            "AS-F06 requires exactly one station-two Station container "
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
    host_bindings = ports.get(f"{EXPECTED_STATION_PORT}/tcp")
    has_expected_port = isinstance(host_bindings, list) and any(
        isinstance(binding, Mapping)
        and str(binding.get("HostPort") or "") == str(EXPECTED_STATION_PORT)
        for binding in host_bindings
    )
    if (
        labels.get("com.docker.compose.project") != EXPECTED_PROJECT_LABEL
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
    during_outage: Callable[[float], None] | None = None,
    after_restart: Callable[[float], None] | None = None,
) -> dict[str, Any]:
    (
        _profile_env,
        deployment_env,
        station_url,
        health_url,
        source_commit,
    ) = _load_bound_environment(runtime_manifest, repo_root)
    before_version = _station_version(station_url)
    before_commit = str(before_version.get("build_commit") or "")
    if not _commits_match(before_commit, source_commit):
        raise FoundationStationRestartError(
            "AS-F06 live Station commit differs before restart"
        )
    before = _container_snapshot(deployment_env)

    operation_started_at = time.monotonic()
    operation_deadline = operation_started_at + RESTART_TIMEOUT_SECONDS
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
            _remaining_seconds(stop_deadline, "Station stop")
            stopped = _remote_command(
                deployment_env,
                f"docker stop {shlex.quote(before['containerId'])}",
                deadline=stop_deadline,
            )
            if not _container_ids_match(stopped, before["containerId"]):
                raise FoundationStationRestartError(
                    "AS-F06 docker stop returned a different container identity"
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
        "profile": EXPECTED_PROFILE,
        "deploymentEnvironment": EXPECTED_DEPLOYMENT,
        "stationUrlHash": _sha256(station_url),
        "sourceCommit": source_commit,
        "protoDigest": str(runtime_manifest["station"]["protoDigest"]),
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
