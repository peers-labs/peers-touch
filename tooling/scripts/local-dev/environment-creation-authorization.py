#!/usr/bin/env python3

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import tempfile
from typing import Any


SCHEMA_VERSION = 1
KIND = "peers-touch-environment-creation-authorization"
PROFILE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
GRANT_TTL = timedelta(minutes=30)


class AuthorizationError(RuntimeError):
    pass


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_timestamp(value: object, field: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise AuthorizationError(f"{field} must be a non-empty UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise AuthorizationError(f"{field} is not a valid timestamp") from error
    if parsed.tzinfo is None:
        raise AuthorizationError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def machine_dev_root() -> Path:
    override = os.environ.get("PT_MACHINE_DEV_ROOT", "").strip()
    root = Path(override).expanduser() if override else Path.home() / ".peers-touch" / "dev"
    if not root.is_absolute():
        raise AuthorizationError("PT_MACHINE_DEV_ROOT must be absolute")
    return root


def canonical_workspace_root(raw_root: str) -> Path:
    root = Path(raw_root).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise AuthorizationError(f"workspace root is not a directory: {root}")
    return root


def workspace_id(root: Path) -> str:
    return hashlib.sha256(str(root).encode("utf-8")).hexdigest()[:16]


def validate_profile_name(value: str) -> str:
    if not PROFILE_PATTERN.fullmatch(value):
        raise AuthorizationError(
            "profile name must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}"
        )
    return value


def validate_slot(value: int) -> int:
    if value < 0 or value > 99:
        raise AuthorizationError("slot must be between 0 and 99")
    return value


def authorization_root() -> Path:
    return machine_dev_root() / "authorizations" / "environment-creation"


def pending_path(root: Path, profile: str) -> Path:
    return authorization_root() / "pending" / f"{workspace_id(root)}-{profile}.json"


def ensure_private_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)


def secure_file(path: Path) -> None:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise AuthorizationError(f"authorization file is missing: {path}") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise AuthorizationError(f"authorization must be a regular file: {path}")
    if metadata.st_uid != os.getuid():
        raise AuthorizationError(f"authorization owner does not match current user: {path}")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise AuthorizationError(f"authorization permissions must be private: {path}")


def read_json(path: Path) -> dict[str, Any]:
    secure_file(path)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AuthorizationError(f"authorization is not valid JSON: {path}") from error
    if not isinstance(value, dict):
        raise AuthorizationError(f"authorization must be a JSON object: {path}")
    return value


def exclusive_write(path: Path, value: dict[str, Any]) -> None:
    ensure_private_directory(path.parent)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary_name, path, follow_symlinks=False)
        except FileExistsError as error:
            raise AuthorizationError(
                f"pending authorization already exists: {path}"
            ) from error
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def validate_authorization(
    value: dict[str, Any],
    root: Path,
    profile: str,
    mode: str,
    slot: int,
    *,
    expected_state: str,
) -> None:
    if value.get("schemaVersion") != SCHEMA_VERSION or value.get("kind") != KIND:
        raise AuthorizationError("authorization schema or kind is unsupported")
    if value.get("state") != expected_state:
        raise AuthorizationError(
            f"authorization state must be {expected_state!r}"
        )
    if value.get("workspaceId") != workspace_id(root):
        raise AuthorizationError("authorization workspaceId does not match")
    if value.get("workspaceRoot") != str(root):
        raise AuthorizationError("authorization workspace root does not match")
    if value.get("profile") != profile:
        raise AuthorizationError("authorization profile does not match")
    target = value.get("target")
    if not isinstance(target, dict):
        raise AuthorizationError("authorization target must be an object")
    if target.get("mode") != mode or target.get("slot") != slot:
        raise AuthorizationError("authorization target mode or slot does not match")
    if not isinstance(value.get("approvedBy"), str) or not value["approvedBy"].strip():
        raise AuthorizationError("authorization approvedBy is missing")
    if not isinstance(value.get("nonce"), str) or not re.fullmatch(
        r"[0-9a-f]{32}", value["nonce"]
    ):
        raise AuthorizationError("authorization nonce is invalid")
    parse_timestamp(value.get("approvedAt"), "approvedAt")
    expires_at = parse_timestamp(value.get("expiresAt"), "expiresAt")
    if expires_at <= utc_now():
        raise AuthorizationError("authorization has expired")


def profile_metadata(path: Path) -> tuple[str, str, int, str]:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise AuthorizationError(f"profile file is missing: {path}") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise AuthorizationError(f"profile must be a regular file: {path}")
    values: dict[str, str] = {}
    raw = path.read_bytes()
    for line in raw.decode("utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key in {"PT_DEV_PROFILE", "PT_STATION_MODE", "PT_DEV_SLOT"}:
            values[key] = value.strip()
    try:
        slot = int(values["PT_DEV_SLOT"])
    except (KeyError, ValueError) as error:
        raise AuthorizationError("profile PT_DEV_SLOT is missing or invalid") from error
    return (
        validate_profile_name(values.get("PT_DEV_PROFILE", "")),
        values.get("PT_STATION_MODE", ""),
        validate_slot(slot),
        hashlib.sha256(raw).hexdigest(),
    )


def grant(args: argparse.Namespace) -> None:
    root = canonical_workspace_root(args.workspace_root)
    profile = validate_profile_name(args.profile)
    slot = validate_slot(args.slot)
    if args.mode != "compose":
        raise AuthorizationError("profile-init authorization supports compose mode only")
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise AuthorizationError(
            "authorization must be created interactively by a human developer"
        )

    phrase = f"AUTHORIZE {profile} {args.mode} SLOT {slot}"
    sys.stdout.write("Environment creation authorization\n")
    sys.stdout.write(f"  Workspace: {root}\n")
    sys.stdout.write(f"  Profile:   {profile}\n")
    sys.stdout.write(f"  Target:    {args.mode}, slot {slot}\n")
    entered = input(f"Type exactly '{phrase}' to continue: ")
    if entered != phrase:
        raise AuthorizationError("authorization phrase did not match")

    now = utc_now()
    value = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": KIND,
        "state": "pending",
        "workspaceId": workspace_id(root),
        "workspaceRoot": str(root),
        "profile": profile,
        "target": {"mode": args.mode, "slot": slot},
        "approvedBy": getpass.getuser(),
        "approvedAt": iso_timestamp(now),
        "expiresAt": iso_timestamp(now + GRANT_TTL),
        "nonce": secrets.token_hex(16),
    }
    path = pending_path(root, profile)
    if path.exists() or path.is_symlink():
        existing = read_json(path)
        expires_at = parse_timestamp(existing.get("expiresAt"), "expiresAt")
        if expires_at > now:
            raise AuthorizationError(f"pending authorization already exists: {path}")
        path.unlink()
    exclusive_write(path, value)
    sys.stdout.write(f"[OK] Pending authorization: {path}\n")


def consume(args: argparse.Namespace) -> None:
    root = canonical_workspace_root(args.workspace_root)
    profile = validate_profile_name(args.profile)
    profile_path = Path(args.profile_file).resolve(strict=True)
    declared_profile, mode, slot, digest = profile_metadata(profile_path)
    if declared_profile != profile:
        raise AuthorizationError("profile file identity does not match requested profile")

    source = pending_path(root, profile)
    value = read_json(source)
    validate_authorization(
        value,
        root,
        profile,
        mode,
        slot,
        expected_state="pending",
    )

    claims = authorization_root() / "claims"
    receipts = authorization_root() / "receipts"
    ensure_private_directory(claims)
    ensure_private_directory(receipts)
    claim = claims / f"{source.stem}-{value['nonce']}.json"
    try:
        os.link(source, claim, follow_symlinks=False)
        source.unlink()
    except (FileExistsError, FileNotFoundError) as error:
        raise AuthorizationError("authorization was already consumed") from error

    receipt = {
        **value,
        "state": "consumed",
        "consumedAt": iso_timestamp(utc_now()),
        "profileSha256": digest,
    }
    receipt_path = receipts / (
        f"{workspace_id(root)}-{profile}-{value['nonce']}.json"
    )
    try:
        exclusive_write(receipt_path, receipt)
        os.chmod(receipt_path, 0o400)
    except Exception:
        receipt_path.unlink(missing_ok=True)
        raise
    finally:
        claim.unlink(missing_ok=True)
    sys.stdout.write(f"{receipt_path}\n")


def verify(args: argparse.Namespace) -> None:
    root = canonical_workspace_root(args.workspace_root)
    profile = validate_profile_name(args.profile)
    profile_path = Path(args.profile_file).resolve(strict=True)
    declared_profile, mode, slot, digest = profile_metadata(profile_path)
    if declared_profile != profile:
        raise AuthorizationError("profile file identity does not match requested profile")

    receipts = authorization_root() / "receipts"
    candidates = sorted(
        receipts.glob(f"{workspace_id(root)}-{profile}-*.json"),
        key=lambda path: path.stat().st_mtime_ns,
        reverse=True,
    ) if receipts.is_dir() else []
    for candidate in candidates:
        try:
            value = read_json(candidate)
            if value.get("schemaVersion") != SCHEMA_VERSION or value.get("kind") != KIND:
                continue
            if value.get("state") != "consumed":
                continue
            if value.get("workspaceId") != workspace_id(root):
                continue
            if value.get("workspaceRoot") != str(root):
                continue
            if value.get("profile") != profile:
                continue
            target = value.get("target")
            if not isinstance(target, dict):
                continue
            if target.get("mode") != mode or target.get("slot") != slot:
                continue
            if not isinstance(value.get("approvedBy"), str) or not value[
                "approvedBy"
            ].strip():
                continue
            approved_at = parse_timestamp(value.get("approvedAt"), "approvedAt")
            expires_at = parse_timestamp(value.get("expiresAt"), "expiresAt")
            consumed_at = parse_timestamp(value.get("consumedAt"), "consumedAt")
            if not approved_at <= consumed_at <= expires_at:
                continue
            if not isinstance(value.get("nonce"), str) or not re.fullmatch(
                r"[0-9a-f]{32}", value["nonce"]
            ):
                continue
            if value.get("profileSha256") != digest:
                continue
        except AuthorizationError:
            continue
        sys.stdout.write(f"{candidate}\n")
        return
    raise AuthorizationError(
        "local profile has no matching consumed human authorization receipt"
    )


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Manage human environment-creation authorizations."
    )
    subparsers = result.add_subparsers(dest="command", required=True)

    grant_parser = subparsers.add_parser("grant")
    grant_parser.add_argument("--workspace-root", required=True)
    grant_parser.add_argument("--profile", required=True)
    grant_parser.add_argument("--mode", default="compose")
    grant_parser.add_argument("--slot", type=int, required=True)
    grant_parser.set_defaults(handler=grant)

    consume_parser = subparsers.add_parser("consume")
    consume_parser.add_argument("--workspace-root", required=True)
    consume_parser.add_argument("--profile", required=True)
    consume_parser.add_argument("--profile-file", required=True)
    consume_parser.set_defaults(handler=consume)

    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("--workspace-root", required=True)
    verify_parser.add_argument("--profile", required=True)
    verify_parser.add_argument("--profile-file", required=True)
    verify_parser.set_defaults(handler=verify)
    return result


def main() -> int:
    try:
        args = parser().parse_args()
        args.handler(args)
    except (AuthorizationError, OSError) as error:
        sys.stderr.write(f"[ERROR] {error}\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
