from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Mapping, Sequence

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
    FixtureActorRecord,
    RESET_ENVIRONMENTS_AUTHORIZATION_ENV,
    RESET_PROFILE_AUTHORIZATION_ENV,
    acceptance_station_environment,
    fixture_federation_id,
    machine_lease_reset_profile,
    read_fixture_actor,
    read_fixture_actors,
    seed_bound_contacts,
    seed_federation_context,
    verify_disposable_station_runtime,
)
from tooling.acceptance.fixtures.chat_reset_targets import (
    PROFILE_BINDINGS_ENV,
    require_reset_lease,
)


ACTOR_ACCOUNTS = {
    "alice": "alice@p.t",
    "bob": "bob@p.t",
    "charlie": "carol@p.t",
    "eve": "carol@p.t",
    "federation_secondary_owner": "alice@p.t",
}

ACTOR_FIXTURE = REPO_ROOT / "apps" / "station" / "app" / "conf" / "actor.yml"
ACTOR_PASSWORD = "1"
RESET_TIMEOUT_SECONDS = 120.0
RESET_TERMINATION_RESERVE_SECONDS = 1.0
RESET_POLL_INTERVAL_SECONDS = 0.05
EXISTING_ACTOR_PROFILE_TIMEOUT_SECONDS = 30.0
EXISTING_ACTOR_PROFILE_MAX_BYTES = 1024 * 1024
FEDERATION_ROUTING_TIMEOUT_SECONDS = 30.0
FEDERATION_ROUTING_MAX_BYTES = 1024 * 1024


@dataclass(frozen=True)
class ResolvedActorIdentity(ActorIdentity):
    display_name: str = ""
    federated_handle: str = ""
    home_station_peer_id: str = ""


@dataclass(frozen=True)
class FederationRoutingActor:
    ptid: str
    federated_handle: str
    home_station_peer_id: str
    locator_seq: int = 0


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
    reset_authorized: bool | None = None,
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
        child_environment = os.environ.copy()
        if not any(child_environment.get(key) for key in (
            RESET_PROFILE_AUTHORIZATION_ENV,
            RESET_ENVIRONMENTS_AUTHORIZATION_ENV,
            PROFILE_BINDINGS_ENV,
        )):
            lease_profile = machine_lease_reset_profile()
            if lease_profile:
                child_environment[
                    RESET_PROFILE_AUTHORIZATION_ENV
                ] = lease_profile
        inherited_fds: tuple[int, ...] = ()
        if child_environment.get("PT_MACHINE_LEASE_KIND") == "station.reset":
            require_reset_lease()
            inherited_fds = (int(child_environment["PT_MACHINE_LEASE_FD"]),)
        if reset_authorized is not None:
            if reset_authorized:
                child_environment["CHAT_ACCEPTANCE_RESET"] = "1"
            else:
                child_environment.pop("CHAT_ACCEPTANCE_RESET", None)
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
            env=child_environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=False,
            close_fds=True,
            pass_fds=inherited_fds,
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
        if os.name == "posix":
            _signal_reset_process_group(process, signal.SIGKILL)
        else:
            process.kill()
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
    if os.name != "posix":
        return
    _signal_reset_process_group(process, signal.SIGKILL)
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
) -> ResolvedActorIdentity:
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
    return _resolved_actor_identity(role, record)


def _resolved_actor_identity(
    role: str,
    record: FixtureActorRecord,
) -> ResolvedActorIdentity:
    return ResolvedActorIdentity(
        role=role,
        account_ref=f"station-account:{ACTOR_ACCOUNTS[role]}",
        ptid=record.ptid,
        display_name=record.name.strip(),
        federated_handle=record.federated_handle,
        home_station_peer_id=record.home_station_peer_id,
    )


def _read_bound_actor_records(
    role_targets: Mapping[str, tuple[str, str]],
) -> dict[str, FixtureActorRecord]:
    grouped: dict[tuple[str, str], list[str]] = {}
    for role, target in role_targets.items():
        if role not in ACTOR_ACCOUNTS:
            raise BlockedError(
                reason=f"Chat native actor role is unsupported: {role}",
                resource=f"fixture-actor:{role}",
            )
        grouped.setdefault(target, []).append(role)
    records: dict[str, FixtureActorRecord] = {}
    for (station_url, environment), roles in grouped.items():
        try:
            by_account = read_fixture_actors(
                station_url, environment,
                tuple(ACTOR_ACCOUNTS[role] for role in roles),
            )
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            raise BlockedError(
                reason=(
                    f"Cannot resolve canonical PTIDs for fixture roles "
                    f"{','.join(roles)}: {error}"
                ),
                resource=f"fixture-actor:{roles[0]}",
            ) from error
        records.update({
            role: by_account[ACTOR_ACCOUNTS[role]] for role in roles
        })
    return {role: records[role] for role in role_targets}


def resolve_existing_actor_identity(
    station_url: str,
    role: str,
) -> ResolvedActorIdentity:
    account = ACTOR_ACCOUNTS.get(role)
    if not account:
        raise BlockedError(
            reason=f"Chat native actor role is unsupported: {role}",
            resource=f"fixture-actor:{role}",
        )
    parsed_station = urllib.parse.urlparse(station_url)
    if (
        parsed_station.scheme not in {"http", "https"}
        or not parsed_station.netloc
    ):
        raise BlockedError(
            reason="Existing actor Station URL is invalid",
            resource=f"fixture-actor:{role}",
        )
    username = account.split("@", 1)[0]
    endpoint = (
        f"{station_url.rstrip('/')}/actor/"
        f"{urllib.parse.quote(username, safe='')}/profile"
    )
    request = urllib.request.Request(
        endpoint,
        headers={"Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(
            request,
            timeout=EXISTING_ACTOR_PROFILE_TIMEOUT_SECONDS,
        ) as response:
            encoded = response.read(EXISTING_ACTOR_PROFILE_MAX_BYTES + 1)
        if len(encoded) > EXISTING_ACTOR_PROFILE_MAX_BYTES:
            raise BlockedError(
                reason=(
                    f"Public profile for existing actor {role} exceeded "
                    "the response limit"
                ),
                resource=f"fixture-actor:{role}",
            )
        profile = json.loads(encoded.decode("utf-8"))
    except (
        urllib.error.URLError,
        OSError,
        TimeoutError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ) as error:
        raise BlockedError(
            reason=(
                f"Cannot resolve public profile for existing actor "
                f"{role}: {error}"
            ),
            resource=f"fixture-actor:{role}",
        ) from error

    actor_ref = (
        profile.get("ref")
        if isinstance(profile, Mapping)
        and isinstance(profile.get("ref"), Mapping)
        else {}
    )
    ptid = str(actor_ref.get("ptid") or "")
    federated_handle = (
        str(profile.get("federated_handle") or "")
        if isinstance(profile, Mapping)
        else ""
    )
    home_station_peer_id = (
        str(profile.get("home_station_peer_id") or "")
        if isinstance(profile, Mapping)
        else ""
    )
    resolved_username = (
        str(profile.get("username") or "")
        if isinstance(profile, Mapping)
        else ""
    )
    display_name = (
        str(profile.get("display_name") or "").strip()
        if isinstance(profile, Mapping)
        else ""
    )
    if (
        not ptid.startswith("ptid:")
        or not federated_handle
        or not home_station_peer_id
        or resolved_username != username
        or not display_name
    ):
        raise BlockedError(
            reason=(
                f"Public profile for existing actor {role} is incomplete "
                "or does not match the preset account"
            ),
            resource=f"fixture-actor:{role}",
        )
    return ResolvedActorIdentity(
        role=role,
        account_ref=f"station-account:{account}",
        ptid=ptid,
        display_name=display_name,
        federated_handle=federated_handle,
        home_station_peer_id=home_station_peer_id,
    )


def _bootstrap_request(
    station_url: str,
    path: str,
    *,
    method: str = "GET",
) -> Mapping[str, object]:
    endpoint = f"{station_url.rstrip('/')}{path}"
    request = urllib.request.Request(
        endpoint,
        headers={"Accept": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(
            request,
            timeout=FEDERATION_ROUTING_TIMEOUT_SECONDS,
        ) as response:
            encoded = response.read(FEDERATION_ROUTING_MAX_BYTES + 1)
        if len(encoded) > FEDERATION_ROUTING_MAX_BYTES:
            raise ValueError("response exceeded the byte limit")
        payload = json.loads(encoded.decode("utf-8"))
    except (
        urllib.error.URLError,
        OSError,
        TimeoutError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        ValueError,
    ) as error:
        raise BlockedError(
            reason=f"Chat fixture Federation routing request failed: {error}",
            resource=f"fixture-federation-routing:{station_url}",
        ) from error
    if not isinstance(payload, Mapping):
        raise BlockedError(
            reason="Chat fixture Federation routing response is invalid",
            resource=f"fixture-federation-routing:{station_url}",
        )
    data = payload.get("data")
    return data if isinstance(data, Mapping) else payload


def prepare_bound_federation_routing(
    role_targets: Mapping[str, tuple[str, str]],
    records: Mapping[str, FixtureActorRecord],
) -> None:
    stations: dict[str, list[FederationRoutingActor]] = {}
    for role, (station_url, _) in role_targets.items():
        record = records.get(role)
        if record is None:
            raise BlockedError(
                reason=f"Chat fixture actor role is unresolved: {role}",
                resource=f"fixture-federation-routing:{role}",
            )
        stations.setdefault(station_url.rstrip("/"), []).append(
            FederationRoutingActor(
                ptid=record.ptid,
                federated_handle=record.federated_handle,
                home_station_peer_id=record.home_station_peer_id,
                locator_seq=record.locator_seq,
            )
        )
    prepare_federation_routing(stations, request=_bootstrap_request)


def prepare_federation_routing(
    stations: Mapping[str, Sequence[FederationRoutingActor]],
    *,
    request: Callable[..., Mapping[str, object]] = _bootstrap_request,
    timeout_seconds: float = FEDERATION_ROUTING_TIMEOUT_SECONDS,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    if len(stations) < 2:
        return

    dial_addresses: dict[str, str] = {}
    for station_url in stations:
        info = request(station_url, "/sub-bootstrap/info")
        addresses = info.get("dial_addrs")
        if not isinstance(addresses, list):
            addresses = info.get("dialAddrs")
        dial_address = next(
            (
                str(value)
                for value in (addresses or [])
                if isinstance(value, str) and "/p2p/" in value
            ),
            "",
        )
        if not dial_address:
            raise BlockedError(
                reason="Station exposes no dialable Federation DHT address",
                resource=f"fixture-federation-routing:{station_url}",
            )
        dial_addresses[station_url] = dial_address

    for source_url in stations:
        for target_url, multiaddr in dial_addresses.items():
            if source_url == target_url:
                continue
            query = urllib.parse.urlencode({"multiaddr": multiaddr})
            request(
                source_url,
                f"/sub-bootstrap/connect?{query}",
            )

    for station_url, actors in stations.items():
        for actor in actors:
            query = urllib.parse.urlencode({"actor_ptid": actor.ptid})
            request(
                station_url,
                f"/sub-bootstrap/locator/publish?{query}",
                method="POST",
            )

    deadline = monotonic() + timeout_seconds
    pending = {
        (observer_url, actor.federated_handle): actor
        for observer_url in stations
        for actor_url, actors in stations.items()
        if observer_url != actor_url
        for actor in actors
    }
    while pending and monotonic() < deadline:
        for key, actor in tuple(pending.items()):
            observer_url, handle = key
            query = urllib.parse.urlencode({"handle": handle})
            try:
                locator = request(
                    observer_url,
                    f"/sub-bootstrap/locator/lookup?{query}",
                )
            except BlockedError:
                continue
            if (
                str(locator.get("federated_handle") or "").lstrip("@")
                == handle.lstrip("@")
                and str(locator.get("home_station_peer_id") or "")
                == actor.home_station_peer_id
                and int(locator.get("seq") or 0) > actor.locator_seq
            ):
                pending.pop(key)
        if pending:
            sleep(0.25)
    if pending:
        unresolved = ", ".join(
            f"{observer} -> {handle}"
            for observer, handle in sorted(pending)
        )
        raise BlockedError(
            reason=(
                "Cross-Station Federation locator convergence timed out: "
                f"{unresolved}"
            ),
            resource="fixture-federation-routing:locator-convergence",
        )


def prepare_bound_friendships(
    role_targets: Mapping[str, tuple[str, str]],
    actors: tuple[ActorIdentity, ...],
) -> None:
    by_role = {actor.role: actor for actor in actors}
    records = _read_bound_actor_records(role_targets)
    for role, record in records.items():
        identity = by_role.get(role)
        if identity is None or identity.ptid != record.ptid:
            raise BlockedError(
                reason=(
                    f"Fixture actor identity drifted while preparing contacts "
                    f"for role {role}"
                ),
                resource=f"fixture-actor:{role}",
            )
    federation_members = tuple(records.values())
    contacts_by_target: dict[
        tuple[str, str], list[tuple[FixtureActorRecord, FixtureActorRecord]]
    ] = {}
    for actor_role, (station_url, environment) in role_targets.items():
        for peer_role in role_targets:
            if actor_role == peer_role:
                continue
            contacts_by_target.setdefault((station_url, environment), []).append(
                (records[actor_role], records[peer_role])
            )
    for (station_url, environment), contacts in contacts_by_target.items():
        seed_bound_contacts(
            station_url, environment, tuple(contacts), federation_members,
        )
    prepare_bound_federation_routing(role_targets, records)


def prepare_federation_contexts(
    targets: Mapping[str, tuple[str, str, tuple[str, ...]]],
) -> str:
    records_by_target: dict[str, tuple[FixtureActorRecord, ...]] = {}
    for service_id, (station_url, environment, roles) in targets.items():
        by_account = read_fixture_actors(
            station_url, environment, tuple(ACTOR_ACCOUNTS[role] for role in roles),
        )
        records_by_target[service_id] = tuple(
            by_account[ACTOR_ACCOUNTS[role]]
            for role in roles
        )
    members = tuple({
        record.ptid: record
        for records in records_by_target.values()
        for record in records
    }.values())
    expected_federation_id = fixture_federation_id(members)
    for service_id, (station_url, environment, _) in targets.items():
        local_records = records_by_target[service_id]
        local_station_ids = {
            record.home_station_peer_id for record in local_records
        }
        if len(local_station_ids) != 1:
            raise BlockedError(
                reason=(
                    "Fixture Federation target does not resolve to one "
                    f"Home Station: {service_id}"
                ),
                resource=f"fixture-federation:{service_id}",
            )
        actual_federation_id = seed_federation_context(
            station_url,
            environment,
            local_station_ids.pop(),
            members,
        )
        if actual_federation_id != expected_federation_id:
            raise BlockedError(
                reason="Fixture Federation identity drifted during setup",
                resource=f"fixture-federation:{service_id}",
            )
    return expected_federation_id


def produce_actor_manifest(
    *,
    environment_id: str,
    run_id: str,
    station_url: str,
    deployment_environment: str,
    roles: Iterable[str],
    credential_ref: str,
    reset_authorized: bool | None,
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
    reset_authorized: bool | None,
    fixture_id: str = "chat-native-actors",
) -> tuple[ActorManifest, Path, dict[str, str]]:
    unique_roles = tuple(dict.fromkeys(role_targets))
    if reset_authorized is None:
        require_reset_lease()
    elif not reset_authorized:
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
        reset_fixture(
            deployment_environment,
            target_roles,
            reset_authorized=reset_authorized,
        )
    records = _read_bound_actor_records(role_targets)
    actors = tuple(
        _resolved_actor_identity(role, records[role]) for role in unique_roles
    )
    prepare_bound_friendships(role_targets, actors)
    manifest = ActorManifest(
        fixture_id=fixture_id,
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
