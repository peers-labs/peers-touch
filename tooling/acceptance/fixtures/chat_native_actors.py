from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
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
    read_fixture_actor,
    seed_cross_station_contact,
    verify_disposable_station_runtime,
)


ACTOR_ACCOUNTS = {
    "alice": "alice@p.t",
    "bob": "bob@p.t",
    "charlie": "carol@p.t",
}

ACTOR_FIXTURE = REPO_ROOT / "apps" / "station" / "app" / "conf" / "actor.yml"
ACTOR_PASSWORD = "1"
RESET_TIMEOUT_SECONDS = 120.0
RESET_TERMINATION_RESERVE_SECONDS = 1.0
RESET_POLL_INTERVAL_SECONDS = 0.05


def fixture_password(path: Path = ACTOR_FIXTURE) -> str:
    current_email = ""
    passwords: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("email:"):
            current_email = line.split(":", 1)[1].strip().strip("'\"")
        elif current_email and line.startswith("password:"):
            passwords[current_email] = line.split(":", 1)[1].strip().strip("'\"")
            current_email = ""

    values = {passwords.get("alice@p.t"), passwords.get("bob@p.t")}
    values.discard(None)
    values.discard("")
    if len(values) != 1:
        raise BlockedError(
            reason=(
                "Committed Alice/Bob Acceptance fixture passwords are "
                "missing or inconsistent"
            ),
            resource="fixture:apps/station/app/conf/actor.yml",
        )
    return values.pop()


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


def resolve_actor_identity(
    station_url: str,
    deployment_environment: str,
    role: str,
) -> ActorIdentity:
    account = ACTOR_ACCOUNTS.get(role)
    if not account:
        raise BlockedError(
            reason=f"Chat native actor role is unsupported: {role}",
            resource=f"fixture-actor:{role}",
        )
    try:
        record = read_fixture_actor(
            station_url,
            deployment_environment,
            account,
        )
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        raise BlockedError(
            reason=f"Cannot resolve canonical PTID for fixture role {role}: {error}",
            resource=f"fixture-actor:{role}",
        ) from error
    return ActorIdentity(
        role=role,
        account_ref=f"station-account:{account}",
        ptid=record.ptid,
    )


def prepare_bound_friendships(
    role_targets: Mapping[str, tuple[str, str]],
    actors: tuple[ActorIdentity, ...],
) -> None:
    if "alice" not in role_targets or "bob" not in role_targets:
        return
    if role_targets["alice"] == role_targets["bob"]:
        return

    by_role = {actor.role: actor for actor in actors}
    alice = by_role["alice"]
    bob = by_role["bob"]
    alice_station_url, alice_environment = role_targets["alice"]
    bob_station_url, bob_environment = role_targets["bob"]
    alice_record = read_fixture_actor(
        alice_station_url,
        alice_environment,
        ACTOR_ACCOUNTS["alice"],
    )
    bob_record = read_fixture_actor(
        bob_station_url,
        bob_environment,
        ACTOR_ACCOUNTS["bob"],
    )

    seed_cross_station_contact(
        alice_station_url,
        alice_environment,
        alice_record,
        bob_record,
    )
    seed_cross_station_contact(
        bob_station_url,
        bob_environment,
        bob_record,
        alice_record,
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


def produce_existing_actor_manifest(
    *,
    environment_id: str,
    run_id: str,
    station_url: str,
    deployment_environment: str,
    roles: Iterable[str],
    credential_ref: str,
) -> tuple[ActorManifest, Path, dict[str, str]]:
    unique_roles = tuple(dict.fromkeys(roles))
    actors = tuple(
        resolve_actor_identity(
            station_url,
            deployment_environment,
            role,
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
        reset_authorized=False,
        target_verified=True,
        initial_state="existing",
    )
    return persist_actor_manifest(manifest)


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
            role_targets[role][1],
            role,
        )
        for role in unique_roles
    )
    prepare_bound_friendships(role_targets, actors)
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
    return persist_actor_manifest(manifest)


def persist_actor_manifest(
    manifest: ActorManifest,
) -> tuple[ActorManifest, Path, dict[str, str]]:
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
