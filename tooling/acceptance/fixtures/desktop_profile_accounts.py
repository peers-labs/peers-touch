"""Suite-owned Desktop actors registered through the production signup API."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioning import ActorIdentity
from tooling.acceptance.provisioners.home_station import resolve_existing_actor


# Public disposable-test credentials; production signup validates 8-20 characters.
PROFILE_ACCOUNT_PASSWORD = "NativeProof2026"


def prepare_profile_accounts(
    station_url: str, workspace: str,
) -> dict[str, ActorIdentity]:
    """Register once per Suite and reuse the same actors across retries."""
    if not re.fullmatch(r"[a-f0-9]{16}", workspace):
        raise ValueError("Desktop fixture requires a canonical workspace ID")
    actors: dict[str, ActorIdentity] = {}
    for role in ("receiver", "sender"):
        handle = f"desktop-ui-{workspace[:8]}-{role}"
        account = f"{handle}@p.t"
        request = urllib.request.Request(
            f"{station_url.rstrip('/')}/actor/sign-up",
            data=json.dumps({
                "name": handle, "email": account, "password": PROFILE_ACCOUNT_PASSWORD,
                "namespace": "peers", "account_type": "Person",
            }).encode("utf-8"),
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                envelope = json.loads(response.read())
        except urllib.error.HTTPError as error:
            envelope = json.loads(error.read())
        if envelope.get("code") not in (0, 10006):
            raise BlockedError(
                reason=f"Production signup rejected Desktop fixture {role}: {envelope.get('code')}",
                resource=f"fixture-actor:{role}",
            )
        actors[role] = resolve_existing_actor(
            station_url, role, PROFILE_ACCOUNT_PASSWORD, account=account,
        )
    if actors["receiver"].ptid == actors["sender"].ptid:
        raise BlockedError(
            reason="Desktop fixture resolved both roles to one actor",
            resource="fixture:desktop-profile-accounts",
        )
    return actors
