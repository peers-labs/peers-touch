from __future__ import annotations

import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request

from tooling.acceptance.core._paths import REPO_ROOT
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioning import ActorIdentity


ACCESS_CLIENT_ROOT = REPO_ROOT / "apps" / "station" / "app"


def resolve_existing_preset_actor(
    *,
    station_url: str,
    role: str,
    account: str,
    password: str,
    device_policy: str,
) -> ActorIdentity:
    go = shutil.which("go")
    if not go:
        raise BlockedError(
            reason="Canonical Access client requires Go on PATH",
            resource="toolchain:go",
        )
    environment = os.environ.copy()
    environment.update(
        {
            "PT_ACCESS_CLIENT_STATION": station_url,
            "PT_ACCESS_CLIENT_EMAIL": account,
            "PT_ACCESS_CLIENT_PASSWORD": password,
        }
    )
    completed = subprocess.run(
        [go, "run", "./tests/access_client"],
        cwd=ACCESS_CLIENT_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise BlockedError(
            reason=(
                f"Cannot resolve existing actor {role} through canonical "
                f"Access Gate: {detail[-1000:]}"
            ),
            resource=f"fixture-actor:{role}",
        )
    try:
        session = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise BlockedError(
            reason=f"Canonical Access client returned invalid actor {role}",
            resource=f"fixture-actor:{role}",
        ) from error
    token = str(session.get("token") or "")
    ptid = str(session.get("ptid") or "")
    if not token or not ptid.startswith("ptid:"):
        raise BlockedError(
            reason=f"Canonical Access client returned incomplete actor {role}",
            resource=f"fixture-actor:{role}",
        )
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
        raise BlockedError(
            reason=(
                f"Existing actor {role} discovery session could not be "
                f"released: {error}"
            ),
            resource=f"fixture-session:{role}",
        ) from error
    return ActorIdentity(
        role=role,
        account_ref=f"station-account:{account}",
        ptid=ptid,
        device_policy=device_policy,
    )
