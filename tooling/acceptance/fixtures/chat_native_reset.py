#!/usr/bin/env python3
"""Reset disposable native Chat acceptance state while preserving actor identities."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys


REPO_ROOT = Path(__file__).resolve().parents[3]
CHAT_TABLES = (
    "actor_devices",
    "actor_identity_keys",
    "device_queue_items",
    "device_queue_lanes",
    "federated_endpoint_manifests",
    "messaging_attachment_audit",
    "messaging_attachment_grants",
    "messaging_attachment_objects",
    "messaging_attachment_upload_parts",
    "messaging_attachment_uploads",
    "messaging_authority_plans",
    "messaging_command_receipts",
    "messaging_conversation_member_devices",
    "messaging_conversation_members",
    "messaging_conversations",
    "messaging_endpoint_directory_versions",
    "messaging_events",
    "messaging_federation_inbox",
    "messaging_federation_outbox",
    "messaging_read_cursors",
    "messaging_recovery_revisions",
)


def deploy_environment(name: str) -> dict[str, str]:
    path = REPO_ROOT / ".local" / "deploy" / "envs" / f"{name}.env"
    if not path.exists():
        raise RuntimeError(f"deployment environment not found: {path}")
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def reset_local_messaging_databases(accounts: list[str]) -> int:
    removed = 0
    root = REPO_ROOT / ".local" / "acceptance" / "embedded-webdriver"
    for account in accounts:
        storage = root / account / "storage"
        storage.mkdir(parents=True, exist_ok=True)
        for database in storage.glob("**/data/db/users/*/chat.main.db*"):
            database.unlink()
            removed += 1
    return removed


def reset_station_messaging_state(environment_name: str) -> None:
    environment = deploy_environment(environment_name)
    host = environment.get("PT_DEPLOY_HOST", "").strip()
    user = environment.get("PT_DEPLOY_USER", "").strip()
    if not host or not user:
        raise RuntimeError(
            f"{environment_name} must define PT_DEPLOY_HOST and PT_DEPLOY_USER"
        )
    container = os.environ.get(
        "CHAT_ACCEPTANCE_POSTGRES_CONTAINER", "pt-station-a-postgres-1"
    )
    sql = f"TRUNCATE TABLE {', '.join(CHAT_TABLES)} CASCADE;\n"
    remote = (
        f"docker exec -i {container} sh -lc "
        "'psql -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\"'"
    )
    subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "StrictHostKeyChecking=no",
            f"{user}@{host}",
            remote,
        ],
        input=sql,
        text=True,
        check=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", default="station-three")
    parser.add_argument("--accounts", nargs="+", default=["alice", "bob"])
    args = parser.parse_args()

    if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
        raise RuntimeError(
            "native Chat fixture reset requires CHAT_ACCEPTANCE_RESET=1"
        )
    removed = reset_local_messaging_databases(args.accounts)
    reset_station_messaging_state(args.environment)
    sys.stdout.write(
        f"native Chat fixture reset: environment={args.environment} "
        f"local_databases={removed}\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
