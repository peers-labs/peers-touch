from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Iterable

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


ACTOR_ACCOUNTS = {
    "alice": "alice@p.t",
    "bob": "bob@p.t",
    "charlie": "carol@p.t",
}


def _load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def verify_reset_target(
    station_url: str,
    deployment_environment: str,
) -> None:
    environment_path = (
        REPO_ROOT
        / ".local"
        / "deploy"
        / "envs"
        / f"{deployment_environment}.env"
    )
    if not environment_path.is_file():
        raise BlockedError(
            reason=f"Reset target environment is missing: {environment_path}",
            resource=f"fixture-target:{deployment_environment}",
        )
    environment = _load_env(environment_path)
    target_host = str(environment.get("PT_DEPLOY_HOST") or "").strip()
    station_host = urllib.parse.urlparse(station_url).hostname or ""
    if not target_host or target_host != station_host:
        raise BlockedError(
            reason=(
                f"Fixture reset target mismatch: Station host {station_host!r} "
                f"does not match deployment host {target_host!r}"
            ),
            resource=f"fixture-target:{deployment_environment}",
        )


def reset_fixture(deployment_environment: str, actors: Iterable[str]) -> None:
    accounts = sorted(set(actors))
    completed = subprocess.run(
        [
            sys.executable,
            str(
                REPO_ROOT
                / "tooling"
                / "acceptance"
                / "fixtures"
                / "chat_native_reset.py"
            ),
            "--environment",
            deployment_environment,
            "--accounts",
            *accounts,
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "no output"
        raise BlockedError(
            reason=f"Chat native actor reset failed: {detail}",
            resource=f"fixture-reset:{deployment_environment}",
        )


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
    password: str,
    credential_ref: str,
    reset_authorized: bool,
) -> tuple[ActorManifest, Path, dict[str, str]]:
    unique_roles = tuple(dict.fromkeys(roles))
    if not reset_authorized:
        raise BlockedError(
            reason=(
                "Chat native actor reset requires CHAT_ACCEPTANCE_RESET=1 "
                "against the approved disposable Station"
            ),
            resource="fixture-authorization:CHAT_ACCEPTANCE_RESET",
        )

    verify_reset_target(station_url, deployment_environment)
    reset_fixture(deployment_environment, unique_roles)
    actors = tuple(
        resolve_actor_identity(station_url, role, password)
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
