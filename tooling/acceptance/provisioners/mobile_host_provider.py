"""Parent-only push provider configuration for the physical Mobile Host suite."""

from __future__ import annotations

import json
import re
import stat
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tooling.acceptance.core import BlockedError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa


APPLICATION_ID = "com.peers.touch.mobile"
MAX_CONFIG_BYTES = 128 * 1024


@dataclass(frozen=True)
class HostProviderConfiguration:
    platform: str
    application_resources_json: str = field(repr=False)
    sensitive_values: tuple[str, ...] = field(repr=False)
    team_id: str = ""


def _blocked(platform: str) -> BlockedError:
    return BlockedError(
        reason=f"{platform} Host push provider configuration is invalid or unavailable",
        resource=f"mobile-runtime:{platform}-push-provider",
    )


def _read_file(path: Path, platform: str, *, private: bool = False) -> bytes:
    try:
        if not path.is_absolute() or any(part.is_symlink() for part in (path, *path.parents)):
            raise _blocked(platform)
        metadata = path.stat()
        if (
            not stat.S_ISREG(metadata.st_mode)
            or not 0 < metadata.st_size <= MAX_CONFIG_BYTES
            or (private and metadata.st_mode & 0o077)
        ):
            raise _blocked(platform)
        with path.open("rb") as stream:
            value = stream.read(MAX_CONFIG_BYTES + 1)
        if not 0 < len(value) <= MAX_CONFIG_BYTES:
            raise _blocked(platform)
        return value
    except OSError:
        raise _blocked(platform) from None


def _json_file(path: Path, platform: str, *, private: bool = False) -> dict[str, Any]:
    try:
        value = json.loads(_read_file(path, platform, private=private))
    except (ValueError, UnicodeError):
        raise _blocked(platform) from None
    if not isinstance(value, dict):
        raise _blocked(platform)
    return value


def _validate_key(key: str, platform: str) -> None:
    try:
        parsed = serialization.load_pem_private_key(key.encode("ascii"), password=None)
    except (ValueError, TypeError, UnicodeError):
        raise _blocked(platform) from None
    if platform == "android":
        if not isinstance(parsed, rsa.RSAPrivateKey) or parsed.key_size < 2048:
            raise _blocked(platform)
    elif not isinstance(parsed, ec.EllipticCurvePrivateKey) or not isinstance(parsed.curve, ec.SECP256R1):
        raise _blocked(platform)


def load_host_provider_config(platform: str, reference: str) -> HostProviderConfiguration:
    if platform not in {"android", "ios"}:
        raise ValueError("unsupported Host provider platform")
    config = _json_file(Path(reference), platform, private=True)
    if platform == "android":
        if set(config) != {"schemaVersion", "applicationId", "googleServices", "serviceAccount"}:
            raise _blocked(platform)
        if type(config["schemaVersion"]) is not int or config["schemaVersion"] != 1:
            raise _blocked(platform)
        if config["applicationId"] != APPLICATION_ID:
            raise _blocked(platform)
        if not all(isinstance(config[field], str) for field in ("googleServices", "serviceAccount")):
            raise _blocked(platform)
        google = _json_file(Path(config["googleServices"]), platform)
        account = _json_file(Path(config["serviceAccount"]), platform, private=True)
        try:
            project = google["project_info"]
            matches = [
                client for client in google["client"]
                if client["client_info"]["android_client_info"]["package_name"] == APPLICATION_ID
            ]
            if len(matches) != 1:
                raise _blocked(platform)
            client = matches[0]
            resources = {
                "google_app_id": client["client_info"]["mobilesdk_app_id"],
                "gcm_defaultSenderId": project["project_number"],
                "google_api_key": client["api_key"][0]["current_key"],
                "project_id": project["project_id"],
            }
            if "storage_bucket" in project:
                resources["google_storage_bucket"] = project["storage_bucket"]
            if (
                account["type"] != "service_account"
                or account["project_id"] != resources["project_id"]
                or account["token_uri"] != "https://oauth2.googleapis.com/token"
                or not account["client_email"].endswith(".iam.gserviceaccount.com")
                or not account["private_key"].startswith("-----BEGIN PRIVATE KEY-----\n")
                or "-----END PRIVATE KEY-----" not in account["private_key"]
                or not re.fullmatch(r"1:[0-9]+:android:[a-f0-9]+", resources["google_app_id"])
                or resources["google_app_id"].split(":")[1] != resources["gcm_defaultSenderId"]
                or any(not isinstance(value, str) or not value.strip() for value in resources.values())
            ):
                raise _blocked(platform)
        except (KeyError, TypeError, IndexError, AttributeError):
            raise _blocked(platform) from None
        _validate_key(account["private_key"], platform)
        return HostProviderConfiguration(
            platform=platform,
            application_resources_json=json.dumps(resources, sort_keys=True, separators=(",", ":")),
            sensitive_values=(account["private_key"], account["client_email"]),
        )
    if set(config) != {
        "schemaVersion", "applicationId", "teamId", "keyId", "environment", "privateKey",
    }:
        raise _blocked(platform)
    if (
        type(config["schemaVersion"]) is not int
        or config["schemaVersion"] != 1
        or config["applicationId"] != APPLICATION_ID
        or config["environment"] != "development"
        or any(
            not isinstance(config[field], str)
            or not re.fullmatch(r"[A-Z0-9]{10}", config[field])
            for field in ("teamId", "keyId")
        )
        or not isinstance(config["privateKey"], str)
    ):
        raise _blocked(platform)
    try:
        key = _read_file(Path(config["privateKey"]), platform, private=True).decode("ascii")
    except UnicodeError:
        raise _blocked(platform) from None
    if not key.startswith("-----BEGIN PRIVATE KEY-----\n") or "-----END PRIVATE KEY-----" not in key:
        raise _blocked(platform)
    _validate_key(key, platform)
    return HostProviderConfiguration(platform, "", (key, config["keyId"]), config["teamId"])
