"""Suite-owned Desktop actors registered through the production signup API."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from tooling.acceptance.core.errors import BlockedError


# Public test credentials satisfying the complete production password validator.
PROFILE_ACCOUNT_PASSWORD = "NativeProof2026!"


def prepare_profile_accounts(
    station_url: str, workspace: str,
) -> dict[str, str]:
    """Register once; the Native Access Gate resolves canonical actor identity."""
    if not re.fullmatch(r"[a-f0-9]{16}", workspace):
        raise ValueError("Desktop fixture requires a canonical workspace ID")
    accounts: dict[str, str] = {}
    for role in ("receiver", "sender"):
        handle = f"dui-{workspace[:8]}-{role[0]}"
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
        if envelope.get("code") not in ("200", 10006):
            raise BlockedError(
                reason=f"Production signup rejected Desktop fixture {role}: {envelope.get('code')}",
                resource=f"fixture-actor:{role}",
            )
        accounts[role] = account
    return accounts
