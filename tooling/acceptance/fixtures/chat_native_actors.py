from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Iterable, Mapping

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.evidence_store import (
    current_artifact_ref,
    write_current_artifact,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioning import (
    ActorIdentity,
    ActorManifest,
    utc_now,
)
from tooling.acceptance.fixtures.chat_native_reset import (
    acceptance_station_environment,
    verify_disposable_station_runtime,
)


ACTOR_ACCOUNTS = {
    "alice": "alice@p.t",
    "bob": "bob@p.t",
    "charlie": "carol@p.t",
}

ACTOR_PASSWORD = "1"
RESET_TIMEOUT_SECONDS = 120.0
RESET_TERMINATION_RESERVE_SECONDS = 1.0
RESET_POLL_INTERVAL_SECONDS = 0.05


def _remaining_timeout(
    configured_timeout: float,
    deadline_monotonic: float | None,
    cancellation: threading.Event | None,
) -> float:
    if cancellation is not None and cancellation.is_set():
        raise TimeoutError("Chat native actor reset was cancelled")
    if deadline_monotonic is None:
        return configured_timeout
    remaining = deadline_monotonic - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Chat native actor reset exceeded its deadline")
    return min(configured_timeout, remaining)


def verify_reset_target(
    station_url: str,
    deployment_environment: str,
    *,
    deadline_monotonic: float | None = None,
    cancellation: threading.Event | None = None,
) -> None:
    _remaining_timeout(
        RESET_TIMEOUT_SECONDS,
        deadline_monotonic,
        cancellation,
    )
    try:
        environment = acceptance_station_environment(
            station_url,
            deployment_environment,
        )
        verify_disposable_station_runtime(
            environment,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        raise BlockedError(
            reason=(
                "Fixture reset target is not an isolated disposable Station: "
                f"{error}"
            ),
            resource=f"fixture-target:{deployment_environment}",
        ) from error


def reset_fixture(
    deployment_environment: str,
    actors: Iterable[str],
    *,
    deadline_monotonic: float | None = None,
    cancellation: threading.Event | None = None,
) -> None:
    accounts = sorted(set(actors))
    remaining = _remaining_timeout(
        RESET_TIMEOUT_SECONDS,
        deadline_monotonic,
        cancellation,
    )
    effective_deadline = time.monotonic() + remaining
    termination_reserve = min(
        RESET_TERMINATION_RESERVE_SECONDS,
        remaining / 2,
    )
    operation_deadline = effective_deadline - termination_reserve
    try:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "tooling.acceptance.fixtures.chat_native_reset",
                "--environment",
                deployment_environment,
                "--accounts",
                *accounts,
            ],
            cwd=REPO_ROOT,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=False,
            close_fds=True,
            start_new_session=os.name == "posix",
        )
    except OSError as error:
        raise BlockedError(
            reason=f"Chat native actor reset could not start: {error}",
            resource=f"fixture-reset:{deployment_environment}",
        ) from error

    try:
        while True:
            _remaining_timeout(
                RESET_TIMEOUT_SECONDS,
                deadline_monotonic,
                cancellation,
            )
            operation_remaining = operation_deadline - time.monotonic()
            if operation_remaining <= 0:
                raise TimeoutError(
                    "Chat native actor reset exceeded its deadline"
                )
            try:
                stdout, stderr = process.communicate(
                    timeout=min(
                        RESET_POLL_INTERVAL_SECONDS,
                        operation_remaining,
                    )
                )
                break
            except subprocess.TimeoutExpired:
                continue
    except BaseException:
        _terminate_reset_process(process, effective_deadline)
        raise

    _kill_remaining_reset_group(process, effective_deadline)
    _remaining_timeout(
        RESET_TIMEOUT_SECONDS,
        deadline_monotonic,
        cancellation,
    )
    if process.returncode != 0:
        detail = stderr.strip() or stdout.strip() or "no output"
        raise BlockedError(
            reason=f"Chat native actor reset failed: {detail}",
            resource=f"fixture-reset:{deployment_environment}",
        )


def _signal_reset_process_group(
    process: subprocess.Popen[str],
    process_signal: signal.Signals,
) -> None:
    try:
        if os.name == "posix":
            os.killpg(process.pid, process_signal)
        elif process_signal == signal.SIGTERM:
            process.terminate()
        else:
            process.kill()
    except ProcessLookupError:
        return
    except OSError as error:
        raise RuntimeError(
            "Chat native actor reset process group could not be signalled"
        ) from error


def _terminate_reset_process(
    process: subprocess.Popen[str],
    deadline_monotonic: float,
) -> None:
    _signal_reset_process_group(process, signal.SIGTERM)
    remaining = max(0.0, deadline_monotonic - time.monotonic())
    try:
        process.communicate(timeout=min(0.25, remaining))
    except subprocess.TimeoutExpired:
        _signal_reset_process_group(process, signal.SIGKILL)
        remaining = max(0.0, deadline_monotonic - time.monotonic())
        try:
            process.communicate(timeout=remaining)
        except subprocess.TimeoutExpired as error:
            raise TimeoutError(
                "Chat native actor reset process did not stop before deadline"
            ) from error
    _kill_remaining_reset_group(process, deadline_monotonic)


def _kill_remaining_reset_group(
    process: subprocess.Popen[str],
    deadline_monotonic: float,
) -> None:
    _signal_reset_process_group(process, signal.SIGKILL)
    if os.name != "posix":
        return
    while True:
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            pass
        except OSError as error:
            raise RuntimeError(
                "Chat native actor reset process-group extinction "
                "could not be verified"
            ) from error
        remaining = deadline_monotonic - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(
                "Chat native actor reset process group survived its deadline"
            )
        time.sleep(min(0.01, remaining))


def _response_data(payload: dict[str, object]) -> dict[str, object]:
    data = payload.get("data")
    return data if isinstance(data, dict) else payload


def _login_session(
    payload: dict[str, object],
    role: str,
) -> tuple[str, str, str]:
    data = _response_data(payload)
    actor_ref = data.get("actor_ref") or data.get("actorRef")
    tokens = data.get("tokens")
    ptid = (
        str(actor_ref.get("ptid") or "")
        if isinstance(actor_ref, dict)
        else ""
    )
    access_token = (
        str(
            tokens.get("access_token")
            or tokens.get("accessToken")
            or ""
        )
        if isinstance(tokens, dict)
        else ""
    )
    session_id = str(
        data.get("session_id") or data.get("sessionId") or ""
    )
    if not ptid.startswith("ptid:"):
        raise BlockedError(
            reason=f"Station login did not return canonical PTID for fixture role {role}",
            resource=f"fixture-actor:{role}",
        )
    if not access_token or not session_id:
        raise BlockedError(
            reason=f"Station login did not return a releasable session for fixture role {role}",
            resource=f"fixture-session:{role}",
        )
    return ptid, access_token, session_id


def resolve_actor_identity(
    station_url: str,
    role: str,
    password: str,
) -> ActorIdentity:
    account = ACTOR_ACCOUNTS.get(role)
    if not account:
        raise BlockedError(
            reason=f"Chat native actor role is unsupported: {role}",
            resource=f"fixture-actor:{role}",
        )

    cookie_jar = CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cookie_jar)
    )
    request = urllib.request.Request(
        f"{station_url.rstrip('/')}/actor/login",
        data=json.dumps(
            {
                "email": account,
                "password": password,
                "device_type": "acceptance-fixture",
            }
        ).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with opener.open(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (
        urllib.error.URLError,
        OSError,
        TimeoutError,
        json.JSONDecodeError,
    ) as error:
        raise BlockedError(
            reason=f"Cannot resolve canonical PTID for fixture role {role}: {error}",
            resource=f"fixture-actor:{role}",
        ) from error

    ptid, access_token, session_id = _login_session(
        payload if isinstance(payload, dict) else {},
        role,
    )

    logout_request = urllib.request.Request(
        f"{station_url.rstrip('/')}/actor/logout",
        data=json.dumps({"session_id": session_id}).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        opener.open(logout_request, timeout=10).close()
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        raise BlockedError(
            reason=f"Cannot release fixture login session for role {role}: {error}",
            resource=f"fixture-session:{role}",
        ) from error

    return ActorIdentity(
        role=role,
        account_ref=f"station-account:{account}",
        ptid=ptid,
    )


def produce_actor_manifest(
    *,
    environment_id: str,
    run_id: str,
    station_url: str,
    deployment_environment: str,
    roles: Iterable[str],
    credential_ref: str,
    reset_authorized: bool,
) -> tuple[ActorManifest, Path, dict[str, str]]:
    return produce_bound_actor_manifest(
        environment_id=environment_id,
        run_id=run_id,
        role_targets={
            role: (station_url, deployment_environment)
            for role in roles
        },
        credential_ref=credential_ref,
        reset_authorized=reset_authorized,
    )


def produce_bound_actor_manifest(
    *,
    environment_id: str,
    run_id: str,
    role_targets: Mapping[str, tuple[str, str]],
    credential_ref: str,
    reset_authorized: bool,
) -> tuple[ActorManifest, Path, dict[str, str]]:
    unique_roles = tuple(dict.fromkeys(role_targets))
    if not reset_authorized:
        raise BlockedError(
            reason=(
                "Chat native actor reset requires CHAT_ACCEPTANCE_RESET=1 "
                "against the approved disposable Station"
            ),
            resource="fixture-authorization:CHAT_ACCEPTANCE_RESET",
        )

    grouped_roles: dict[tuple[str, str], list[str]] = {}
    for role in unique_roles:
        station_url, deployment_environment = role_targets[role]
        grouped_roles.setdefault(
            (station_url, deployment_environment),
            [],
        ).append(role)
    for (station_url, deployment_environment), target_roles in grouped_roles.items():
        verify_reset_target(station_url, deployment_environment)
        reset_fixture(deployment_environment, target_roles)
    actors = tuple(
        resolve_actor_identity(
            role_targets[role][0],
            role,
            ACTOR_PASSWORD,
        )
        for role in unique_roles
    )
    manifest = ActorManifest(
        fixture_id="chat-native-actors",
        environment_id=environment_id,
        run_id=run_id,
        created_at=utc_now(),
        actors=actors,
        credential_refs=(credential_ref,),
        reset_authorized=True,
        target_verified=True,
    )
    relative_path = "runtime/actor-manifest.json"
    path = write_current_artifact(
        relative_path,
        (
            json.dumps(manifest.to_dict(), indent=2, sort_keys=True) + "\n"
        ).encode("utf-8"),
        repo_root=REPO_ROOT,
    )
    reference = current_artifact_ref(
        relative_path,
        repo_root=REPO_ROOT,
        media_type="application/json",
    )
    return manifest, path, reference.to_dict()
