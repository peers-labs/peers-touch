from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioning import (
    ActorIdentity,
    RetainedRuntimeFixture,
)


ACCESS_CLIENT_ROOT = REPO_ROOT / "apps" / "station" / "app"
ACTOR_IDENTITY_IMPORT_ENV = (
    "PT_MESSAGE_PUBLISHING_ACTOR_IDENTITY_IMPORT_FILE"
)
MACHINE_FIXTURE_ROOT = (
    Path.home() / ".peers-touch" / "dev" / "fixtures"
)
ED25519_PKCS8_PREFIX = bytes.fromhex("302e020100300506032b657004220420")
ED25519_SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")


@dataclass(frozen=True)
class ResolvedPresetActorIdentity:
    actor: ActorIdentity
    station_peer_id: str
    actor_identity_fingerprint: str
    fixture: RetainedRuntimeFixture


def _blocked(reason: str, resource: str) -> BlockedError:
    return BlockedError(reason=reason, resource=resource)


def _run_access_client(
    *,
    station_url: str,
    role: str,
    account: str,
    password: str,
    include_device_authority: bool,
) -> dict[str, Any]:
    go = shutil.which("go")
    if not go:
        raise _blocked(
            "Canonical Access client requires Go on PATH",
            "toolchain:go",
        )
    environment = os.environ.copy()
    environment.update(
        {
            "PT_ACCESS_CLIENT_STATION": station_url,
            "PT_ACCESS_CLIENT_EMAIL": account,
            "PT_ACCESS_CLIENT_PASSWORD": password,
        }
    )
    command = [go, "run", "./tests/access_client"]
    if include_device_authority:
        command.append("--include-device-authority")
    completed = subprocess.run(
        command,
        cwd=ACCESS_CLIENT_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or "canonical Access client failed"
        raise _blocked(
            (
                f"Cannot resolve existing actor {role} through canonical "
                f"Access Gate: {detail[-1000:]}"
            ),
            f"fixture-actor:{role}",
        )
    try:
        session = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise _blocked(
            f"Canonical Access client returned invalid actor {role}",
            f"fixture-actor:{role}",
        ) from error
    if not isinstance(session, dict):
        raise _blocked(
            f"Canonical Access client returned invalid actor {role}",
            f"fixture-actor:{role}",
        )
    return session


def _release_session(
    *,
    station_url: str,
    role: str,
    token: str,
) -> None:
    logout = urllib.request.Request(
        f"{station_url.rstrip('/')}/actor/logout",
        data=b"{}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        urllib.request.urlopen(logout, timeout=15).close()
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        raise _blocked(
            (
                f"Existing actor {role} discovery session could not be "
                f"released: {error}"
            ),
            f"fixture-session:{role}",
        ) from error


def _validated_actor(
    session: dict[str, Any],
    *,
    role: str,
    account: str,
    device_policy: str,
) -> tuple[ActorIdentity, str]:
    token = str(session.get("token") or "")
    ptid = str(session.get("ptid") or "")
    if not token or not ptid.startswith("ptid:"):
        raise _blocked(
            f"Canonical Access client returned incomplete actor {role}",
            f"fixture-actor:{role}",
        )
    return (
        ActorIdentity(
            role=role,
            account_ref=f"station-account:{account}",
            ptid=ptid,
            device_policy=device_policy,
        ),
        token,
    )


def _sanitize_storage_segment(value: str) -> str:
    normalized = "".join(
        character
        if character.isascii()
        and (character.isalnum() or character in "-_.")
        else "_"
        for character in value.strip()
    )
    return normalized or "__default__"


def actor_identity_key_name(
    station_peer_id: str,
    actor_ptid: str,
) -> str:
    identity_key_ref = (
        f"station_peer_{_sanitize_storage_segment(station_peer_id)}/"
        f"{_sanitize_storage_segment(actor_ptid)}"
    )
    return hashlib.sha256(identity_key_ref.encode("utf-8")).hexdigest()


def actor_identity_fixture_root(
    station_peer_id: str,
    actor_ptid: str,
    *,
    machine_root: Path = MACHINE_FIXTURE_ROOT,
) -> Path:
    station_segment = _sanitize_storage_segment(station_peer_id)
    if (
        not station_peer_id.strip()
        or station_segment != station_peer_id.strip()
        or not actor_ptid.startswith("ptid:")
    ):
        raise _blocked(
            "Preset actor identity scope is invalid",
            "fixture-identity:scope",
        )
    actor_digest = hashlib.sha256(
        actor_ptid.encode("utf-8")
    ).hexdigest()
    return (
        machine_root.expanduser()
        / "stations"
        / station_segment
        / "actors"
        / actor_digest
        / "actor-identity"
    )


def _require_private_directory(path: Path, *, resource: str) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise _blocked(
            "Preset actor identity directory is unavailable",
            resource,
        ) from error
    if path.is_symlink() or not stat.S_ISDIR(metadata.st_mode):
        raise _blocked(
            "Preset actor identity directory is not a regular directory",
            resource,
        )
    if stat.S_IMODE(metadata.st_mode) != 0o700:
        raise _blocked(
            "Preset actor identity directory must use mode 0700",
            resource,
        )


def _read_private_seed(path: Path, *, resource: str) -> bytearray:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise _blocked(
            "Preset actor identity seed is unavailable",
            resource,
        ) from error
    if path.is_symlink() or not stat.S_ISREG(metadata.st_mode):
        raise _blocked(
            "Preset actor identity seed must be a regular non-symlink file",
            resource,
        )
    if stat.S_IMODE(metadata.st_mode) != 0o600:
        raise _blocked(
            "Preset actor identity seed must use mode 0600",
            resource,
        )
    try:
        seed_hex = path.read_text(encoding="ascii").strip()
    except OSError as error:
        raise _blocked(
            "Preset actor identity seed could not be read",
            resource,
        ) from error
    if re.fullmatch(r"[0-9a-f]{64}", seed_hex) is None:
        raise _blocked(
            "Preset actor identity seed has an invalid encoding",
            resource,
        )
    return bytearray.fromhex(seed_hex)


def _seed_fingerprint(path: Path, *, resource: str) -> str:
    openssl = shutil.which("openssl")
    if not openssl:
        raise _blocked(
            "Preset actor identity validation requires OpenSSL on PATH",
            "toolchain:openssl",
        )
    seed = _read_private_seed(path, resource=resource)
    private_der = bytearray(ED25519_PKCS8_PREFIX)
    private_der.extend(seed)
    try:
        completed = subprocess.run(
            [
                openssl,
                "pkey",
                "-inform",
                "DER",
                "-pubout",
                "-outform",
                "DER",
            ],
            input=bytes(private_der),
            capture_output=True,
            timeout=15,
            check=False,
        )
    finally:
        seed[:] = b"\x00" * len(seed)
        private_der[:] = b"\x00" * len(private_der)
    if (
        completed.returncode != 0
        or len(completed.stdout) != len(ED25519_SPKI_PREFIX) + 32
        or not completed.stdout.startswith(ED25519_SPKI_PREFIX)
    ):
        raise _blocked(
            "Preset actor identity public key derivation failed",
            resource,
        )
    return hashlib.sha256(
        completed.stdout[len(ED25519_SPKI_PREFIX):]
    ).hexdigest()


def _fixture_metadata_path(identity_root: Path) -> Path:
    return identity_root.parent / "fixture.json"


def _identity_key_path(
    identity_root: Path,
    station_peer_id: str,
    actor_ptid: str,
) -> Path:
    return (
        identity_root
        / "peers-touch"
        / "desktop"
        / "data"
        / "secure-store"
        / "identity-keys"
        / actor_identity_key_name(station_peer_id, actor_ptid)
    )


def _scope_digest(station_peer_id: str, actor_ptid: str) -> str:
    return hashlib.sha256(
        f"{station_peer_id}\x1f{actor_ptid}".encode("utf-8")
    ).hexdigest()


def _validate_fixture(
    *,
    identity_root: Path,
    station_peer_id: str,
    actor_ptid: str,
    actor_identity_fingerprint: str,
    resource: str,
) -> None:
    actor_root = identity_root.parent
    metadata_path = _fixture_metadata_path(identity_root)
    key_path = _identity_key_path(
        identity_root,
        station_peer_id,
        actor_ptid,
    )
    directories = (
        actor_root,
        *(
            path
            for path in actor_root.rglob("*")
            if path.is_dir()
        ),
    )
    for directory in directories:
        _require_private_directory(directory, resource=resource)
    if any(path.is_symlink() for path in actor_root.rglob("*")):
        raise _blocked(
            "Preset actor identity fixture contains a symlink",
            resource,
        )
    files = {
        path
        for path in actor_root.rglob("*")
        if path.is_file()
    }
    if files != {metadata_path, key_path}:
        raise _blocked(
            "Preset actor identity fixture contains unexpected files",
            resource,
        )
    entries = tuple(key_path.parent.iterdir())
    if len(entries) != 1 or entries[0].name != key_path.name:
        raise _blocked(
            "Preset actor identity fixture does not contain exactly one expected key",
            resource,
        )
    try:
        metadata_stat = metadata_path.lstat()
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise _blocked(
            "Preset actor identity fixture metadata is unavailable",
            resource,
        ) from error
    expected_metadata = {
        "schemaVersion": 1,
        "stationPeerId": station_peer_id,
        "actorPtidSha256": hashlib.sha256(
            actor_ptid.encode("utf-8")
        ).hexdigest(),
        "actorIdentityFingerprint": actor_identity_fingerprint,
        "keyName": key_path.name,
    }
    if (
        metadata_path.is_symlink()
        or not stat.S_ISREG(metadata_stat.st_mode)
        or stat.S_IMODE(metadata_stat.st_mode) != 0o600
        or metadata != expected_metadata
    ):
        raise _blocked(
            "Preset actor identity fixture metadata does not match its scope",
            resource,
        )
    if _seed_fingerprint(key_path, resource=resource) != (
        actor_identity_fingerprint
    ):
        raise _blocked(
            "Preset actor identity fixture does not match Station authority",
            resource,
        )


def _ensure_private_path(path: Path, *, root: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    current = path
    while True:
        if current == root.parent:
            break
        if current == root or root in current.parents:
            if current.is_symlink() or not current.is_dir():
                raise _blocked(
                    "Preset actor identity fixture path is unsafe",
                    "fixture-identity:path",
                )
            current.chmod(0o700)
        if current == root:
            break
        current = current.parent


def _create_fixture(
    *,
    identity_root: Path,
    migration_source: Path,
    station_peer_id: str,
    actor_ptid: str,
    actor_identity_fingerprint: str,
    machine_root: Path,
    resource: str,
) -> None:
    expected_key_name = actor_identity_key_name(
        station_peer_id,
        actor_ptid,
    )
    source = migration_source.expanduser()
    if not source.is_absolute():
        source = Path.cwd() / source
    if source.name != expected_key_name:
        raise _blocked(
            "Preset actor identity import is not the expected scoped key",
            resource,
        )
    if _seed_fingerprint(source, resource=resource) != (
        actor_identity_fingerprint
    ):
        raise _blocked(
            "Preset actor identity import does not match Station authority",
            resource,
        )

    actor_root = identity_root.parent
    actors_root = actor_root.parent
    _ensure_private_path(actors_root, root=machine_root)
    temporary = actors_root / (
        f".{actor_root.name}.tmp-{os.getpid()}-{time.time_ns()}"
    )
    if actor_root.exists():
        _validate_fixture(
            identity_root=identity_root,
            station_peer_id=station_peer_id,
            actor_ptid=actor_ptid,
            actor_identity_fingerprint=actor_identity_fingerprint,
            resource=resource,
        )
        return
    try:
        key_path = _identity_key_path(
            temporary / "actor-identity",
            station_peer_id,
            actor_ptid,
        )
        key_path.parent.mkdir(parents=True, mode=0o700)
        for directory in (
            temporary,
            temporary / "actor-identity",
            temporary / "actor-identity" / "peers-touch",
            temporary / "actor-identity" / "peers-touch" / "desktop",
            temporary / "actor-identity" / "peers-touch" / "desktop" / "data",
            (
                temporary
                / "actor-identity"
                / "peers-touch"
                / "desktop"
                / "data"
                / "secure-store"
            ),
            key_path.parent,
        ):
            directory.chmod(0o700)
        seed = _read_private_seed(source, resource=resource)
        try:
            descriptor = os.open(
                key_path,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
            )
            try:
                os.write(descriptor, seed.hex().encode("ascii"))
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        finally:
            seed[:] = b"\x00" * len(seed)
        metadata = {
            "schemaVersion": 1,
            "stationPeerId": station_peer_id,
            "actorPtidSha256": hashlib.sha256(
                actor_ptid.encode("utf-8")
            ).hexdigest(),
            "actorIdentityFingerprint": actor_identity_fingerprint,
            "keyName": key_path.name,
        }
        metadata_path = temporary / "fixture.json"
        metadata_path.write_text(
            json.dumps(metadata, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        metadata_path.chmod(0o600)
        try:
            os.rename(temporary, actor_root)
        except FileExistsError:
            _validate_fixture(
                identity_root=identity_root,
                station_peer_id=station_peer_id,
                actor_ptid=actor_ptid,
                actor_identity_fingerprint=actor_identity_fingerprint,
                resource=resource,
            )
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def ensure_preset_actor_identity_fixture(
    *,
    role: str,
    station_peer_id: str,
    actor_ptid: str,
    actor_identity_fingerprint: str,
    machine_root: Path = MACHINE_FIXTURE_ROOT,
    migration_source: Path | None = None,
) -> RetainedRuntimeFixture:
    resource = f"fixture-identity:{role}"
    if re.fullmatch(r"[0-9a-f]{64}", actor_identity_fingerprint) is None:
        raise _blocked(
            "Station returned an invalid actor identity fingerprint",
            resource,
        )
    identity_root = actor_identity_fixture_root(
        station_peer_id,
        actor_ptid,
        machine_root=machine_root,
    )
    if not identity_root.exists():
        source = migration_source
        if source is None:
            raw_source = os.environ.get(ACTOR_IDENTITY_IMPORT_ENV, "").strip()
            source = Path(raw_source) if raw_source else None
        if source is None:
            raise _blocked(
                (
                    "Preset actor identity fixture is missing and no reviewed "
                    f"one-time import was supplied through {ACTOR_IDENTITY_IMPORT_ENV}"
                ),
                resource,
            )
        _create_fixture(
            identity_root=identity_root,
            migration_source=source,
            station_peer_id=station_peer_id,
            actor_ptid=actor_ptid,
            actor_identity_fingerprint=actor_identity_fingerprint,
            machine_root=machine_root.expanduser(),
            resource=resource,
        )
    _validate_fixture(
        identity_root=identity_root,
        station_peer_id=station_peer_id,
        actor_ptid=actor_ptid,
        actor_identity_fingerprint=actor_identity_fingerprint,
        resource=resource,
    )
    return RetainedRuntimeFixture(
        fixture_id=f"preset-actor-identity-{role}",
        kind="actor-identity",
        root=str(identity_root),
        lifecycle="machine-retained",
        scope_digest=_scope_digest(station_peer_id, actor_ptid),
    )


def resolve_existing_preset_actor(
    *,
    station_url: str,
    role: str,
    account: str,
    password: str,
    device_policy: str,
) -> ActorIdentity:
    session = _run_access_client(
        station_url=station_url,
        role=role,
        account=account,
        password=password,
        include_device_authority=False,
    )
    actor, token = _validated_actor(
        session,
        role=role,
        account=account,
        device_policy=device_policy,
    )
    _release_session(station_url=station_url, role=role, token=token)
    return actor


def resolve_existing_preset_actor_identity(
    *,
    station_url: str,
    station_peer_id: str,
    role: str,
    account: str,
    password: str,
    device_policy: str,
    machine_root: Path = MACHINE_FIXTURE_ROOT,
    migration_source: Path | None = None,
) -> ResolvedPresetActorIdentity:
    session = _run_access_client(
        station_url=station_url,
        role=role,
        account=account,
        password=password,
        include_device_authority=True,
    )
    actor, token = _validated_actor(
        session,
        role=role,
        account=account,
        device_policy=device_policy,
    )
    try:
        observed_station_peer_id = str(
            session.get("stationPeerId") or ""
        )
        fingerprint = str(
            session.get("actorIdentityFingerprint") or ""
        )
        if observed_station_peer_id != station_peer_id:
            raise _blocked(
                "Canonical Access client resolved a different Station identity",
                f"fixture-identity:{role}",
            )
        fixture = ensure_preset_actor_identity_fixture(
            role=role,
            station_peer_id=station_peer_id,
            actor_ptid=actor.ptid,
            actor_identity_fingerprint=fingerprint,
            machine_root=machine_root,
            migration_source=migration_source,
        )
    except BaseException:
        try:
            _release_session(
                station_url=station_url,
                role=role,
                token=token,
            )
        except BlockedError:
            pass
        raise
    _release_session(station_url=station_url, role=role, token=token)
    return ResolvedPresetActorIdentity(
        actor=actor,
        station_peer_id=station_peer_id,
        actor_identity_fingerprint=fingerprint,
        fixture=fixture,
    )
