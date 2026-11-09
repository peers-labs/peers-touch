"""Reviewed Relay preparation; callers retain the original service/source leases."""
from __future__ import annotations

import hashlib
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any
from uuid import uuid4

from tooling.acceptance.core.attestation import read_service_runtime_identity
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.provisioning import RuntimeManifest
from tooling.acceptance.provisioners.posix_service_runtime import (
    PosixServiceRuntimeConfig, inspect_posix_runtime,
    mint_posix_relay_operator_token,
)


def relay_json_request(
    url: str, *, method: str, body: Mapping[str, object] | None = None,
    token: str = "", trust_anchor: bytes | None = None,
) -> tuple[int, dict[str, Any]]:
    headers = {"Accept": "application/json"}
    payload = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(dict(body), separators=(",", ":")).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=payload, headers=headers, method=method)
    context = None
    if trust_anchor is not None:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        context.load_verify_locations(cadata=trust_anchor.decode("ascii"))
    try:
        with urllib.request.urlopen(request, context=context, timeout=30) as response:
            raw, status = response.read((1 << 20) + 1), response.status
    except urllib.error.HTTPError as error:
        raw, status = error.read((1 << 20) + 1), error.code
    if len(raw) > 1 << 20:
        raise BlockedError(reason="Relay attachment response exceeds its bound",
                           resource="relay-attachment-fixture")
    try:
        value = json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BlockedError(reason="Relay attachment response is invalid",
                           resource="relay-attachment-fixture") from error
    if not isinstance(value, dict):
        raise BlockedError(reason="Relay attachment response is not an object",
                           resource="relay-attachment-fixture")
    data = value.get("data")
    return status, dict(data) if isinstance(data, Mapping) else value


_INSTALL_CA = r"""
final=$1
partial=$2
digest=$3
[ ! -e "$final" ] && [ ! -L "$final" ] || exit 21
[ ! -e "$partial" ] && [ ! -L "$partial" ] || exit 21
umask 077
set -C
cat > "$partial"
[ "$(sha256sum "$partial" | cut -d ' ' -f 1)" = "$digest" ] || exit 22
ln "$partial" "$final"
rm -- "$partial"
"""

_REMOVE_CA = r"""
final=$1
partial=$2
digest=$3
for path in "$final" "$partial"; do
  [ ! -L "$path" ] || exit 23
  if [ -e "$path" ]; then
    [ -f "$path" ] && [ "$(stat -c '%a:%u' "$path")" = "600:$(id -u)" ] || exit 24
  fi
done
if [ -e "$final" ]; then
  [ "$(sha256sum "$final" | cut -d ' ' -f 1)" = "$digest" ] || exit 25
  rm -- "$final"
fi
if [ -e "$partial" ]; then rm -- "$partial"; fi
update-ca-certificates
"""

_BOUND_CA_CLEANUP = r"""
container=$1
project=$2
service=$3
script=$4
final=$5
partial=$6
digest=$7
containers=$(docker ps -a --format '{{.ID}}' \
  --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.service=$service")
[ "$containers" = "$container" ] || exit 26
docker exec "$container" sh -ceu "$script" -- "$final" "$partial" "$digest"
docker restart "$container" >/dev/null
"""


class RelayAttachmentFixture:
    """One owner for CA additions, invitations and newly imported attachments."""

    def __init__(self, *, register_cleanup: Callable[[str, Callable[[], None]], None]) -> None:
        self._register_cleanup = register_cleanup

    @staticmethod
    def wait_runtime(config: PosixServiceRuntimeConfig, *, timeout_seconds: float = 120) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            try:
                return inspect_posix_runtime(config)
            except BlockedError:
                pass
            time.sleep(min(1, max(0, deadline - time.monotonic())))
        raise BlockedError(reason="Prepared service runtime did not become healthy",
                           resource=f"runtime-status:{config.environment_name}")

    def install_station_ca(
        self, config: PosixServiceRuntimeConfig, trust_anchor: bytes, *, run_id: str,
    ) -> None:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", run_id):
            raise ValueError("Relay CA preparation requires a bounded run identity")
        status = self.wait_runtime(config)
        container = str(status["containerId"])
        transport = config.transport()
        stem = f"/usr/local/share/ca-certificates/ncp-relay-{run_id}-{uuid4().hex}"
        final, partial = stem + ".crt", stem + ".partial"
        digest = hashlib.sha256(trust_anchor).hexdigest()
        absent = transport.run_argv(
            ("docker", "exec", container, "sh", "-ceu",
             '[ ! -e "$1" ] && [ ! -L "$1" ] && [ ! -e "$2" ] && [ ! -L "$2" ]',
             "--", final, partial), timeout=15, check=False,
        )
        if absent.returncode != 0:
            raise BlockedError(reason="Relay CA path is not available",
                               resource="relay-attachment-fixture")

        def remove() -> None:
            # Cleanup needs the exact original Compose container, not health.
            # Removal and restart also retire the process's cached system trust.
            config.transport().run_argv(
                ("sh", "-ceu", _BOUND_CA_CLEANUP, "--", container,
                 config.compose_project, config.compose_service, _REMOVE_CA,
                 final, partial, digest), timeout=180, check=True,
            )
            if str(self.wait_runtime(config)["containerId"]) != container:
                raise RuntimeError("Relay CA cleanup runtime identity changed")

        self._register_cleanup(f"station-relay-ca:{config.environment_name}:{run_id}", remove)
        transport.run_argv(
            ("docker", "exec", "-i", container, "sh", "-ceu", _INSTALL_CA,
             "--", final, partial, digest), timeout=30, check=True,
            input_text=trust_anchor.decode("ascii"),
        )
        transport.run_argv(
            ("docker", "exec", container, "update-ca-certificates"), timeout=60, check=True,
        )
        transport.run_argv(("docker", "restart", container), timeout=120, check=True)
        if str(self.wait_runtime(config)["containerId"]) != container:
            raise BlockedError(reason="Relay CA installation runtime identity changed",
                               resource="relay-attachment-fixture")

    @staticmethod
    def dashboard_token(station_url: str) -> str:
        status, result = relay_json_request(
            station_url.rstrip("/") + "/dashboard/api/auth/login",
            method="POST", body={"username": "peers", "password": "peers"},
        )
        token = str(result.get("token") or "")
        if status != 200 or token.count(".") != 2:
            raise BlockedError(reason="Station Dashboard fixture login failed",
                               resource="relay-attachment-fixture")
        return token

    @staticmethod
    def attachment_items(station_url: str, dashboard_token: str) -> list[dict[str, Any]]:
        status, result = relay_json_request(
            station_url.rstrip("/") + "/dashboard/api/relay/attachments",
            method="GET", token=dashboard_token,
        )
        items = result.get("items")
        if status != 200 or not isinstance(items, list) or any(
            not isinstance(item, Mapping) for item in items
        ):
            raise BlockedError(reason="Station Relay attachment readback is invalid",
                               resource="relay-attachment-fixture")
        return [dict(item) for item in items]

    @staticmethod
    def _find(items: list[dict[str, Any]], relay_peer_id: str) -> dict[str, Any] | None:
        matches = [item for item in items if item.get("relay_peer_id") == relay_peer_id]
        if len(matches) > 1:
            raise BlockedError(reason="Station Relay attachment identity is ambiguous",
                               resource="relay-attachment-fixture")
        return matches[0] if matches else None

    def wait_attachment(
        self, station_url: str, dashboard_token: str, relay_peer_id: str, *,
        present: bool, label: str | None = None, control_origin: str | None = None,
        timeout_seconds: float = 120,
    ) -> dict[str, Any] | None:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            item = self._find(self.attachment_items(station_url, dashboard_token), relay_peer_id)
            if item is not None and (
                (label is not None and item.get("label") != label)
                or (control_origin is not None and item.get("control_origin") != control_origin)
            ):
                raise BlockedError(reason="Station Relay attachment ownership changed",
                                   resource="relay-attachment-fixture")
            if present and item and item.get("state") == "active" and item.get("enabled") is True:
                return item
            if not present and item is None:
                return None
            time.sleep(min(1, max(0, deadline - time.monotonic())))
        raise BlockedError(reason="Station Relay attachment did not converge",
                           resource="relay-attachment-fixture")

    def _detach(
        self, station_url: str, relay_peer_id: str, *, label: str,
        control_origin: str, station_peer_id: str,
    ) -> None:
        if read_service_runtime_identity(station_url) != station_peer_id:
            raise RuntimeError("Relay attachment cleanup Station identity changed")
        token = self.dashboard_token(station_url)
        item = self._find(self.attachment_items(station_url, token), relay_peer_id)
        if item is None:
            return
        if item.get("label") != label or item.get("control_origin") != control_origin:
            raise RuntimeError("Relay attachment cleanup does not own the current attachment")
        endpoint = station_url.rstrip("/") + "/dashboard/api/relay/attachments/" + urllib.parse.quote(
            relay_peer_id, safe="",
        )
        status, result = relay_json_request(endpoint, method="DELETE", token=token)
        if status != 200:
            raise RuntimeError(f"Relay attachment cleanup failed: HTTP {status}")
        if result.get("cleanup_pending") is True:
            status, _ = relay_json_request(endpoint + "/retry", method="POST", body={}, token=token)
            if status != 200:
                raise RuntimeError(f"Relay attachment cleanup retry failed: HTTP {status}")
        self.wait_attachment(station_url, token, relay_peer_id, present=False,
                             label=label, control_origin=control_origin)

    @staticmethod
    def _close_invite(
        relay_url: str, *, label: str, station_peer_id: str,
        relay_config: PosixServiceRuntimeConfig, trust_anchor: bytes,
    ) -> None:
        token = mint_posix_relay_operator_token(relay_config)
        status, result = relay_json_request(
            relay_url + "/api/v1/relay/invites", method="GET",
            token=token, trust_anchor=trust_anchor,
        )
        invites = result.get("invites")
        if status != 200 or not isinstance(invites, list) or any(
            not isinstance(item, Mapping) for item in invites
        ):
            raise RuntimeError("Relay invitation cleanup readback is invalid")
        owned = [item for item in invites if item.get("label") == label]
        if not owned:
            return
        if (len(owned) != 1 or owned[0].get("intended_station_peer_id") != station_peer_id
                or not isinstance(owned[0].get("id"), str)
                or not re.fullmatch(r"[1-9][0-9]{0,19}", owned[0]["id"])):
            raise RuntimeError("Relay invitation cleanup identity changed")
        invite = owned[0]
        if invite.get("status") == 2:
            return
        if invite.get("status") != 1:
            raise RuntimeError("Relay invitation cleanup state is invalid")
        status, _ = relay_json_request(
            relay_url + "/api/v1/relay/invite", method="DELETE",
            body={"invite_id": invite["id"]}, token=token, trust_anchor=trust_anchor,
        )
        if status != 200:
            raise RuntimeError(f"Relay invitation cleanup failed: HTTP {status}")
        status, result = relay_json_request(
            relay_url + "/api/v1/relay/invites", method="GET",
            token=token, trust_anchor=trust_anchor,
        )
        remaining = result.get("invites")
        if (status != 200 or not isinstance(remaining, list) or any(
                not isinstance(item, Mapping) or item.get("label") == label
                for item in remaining)):
            raise RuntimeError("Relay invitation cleanup did not converge")

    def ensure_attachment(
        self, *, manifest: RuntimeManifest, station_url: str, relay_url: str,
        relay_peer_id: str, relay_config: PosixServiceRuntimeConfig, trust_anchor: bytes,
    ) -> dict[str, Any]:
        dashboard_token = self.dashboard_token(station_url)
        current = self._find(self.attachment_items(station_url, dashboard_token), relay_peer_id)
        origin = relay_url.rstrip("/")
        if current is not None:
            if (current.get("control_origin") != origin or current.get("state") != "active"
                    or current.get("enabled") is not True):
                raise BlockedError(reason="Existing operator Relay attachment is not reusable",
                                   resource="relay-attachment-fixture")
            return current
        station_peer_id = read_service_runtime_identity(station_url)
        label = f"ncp-{manifest.run_id}-{uuid4().hex}"
        self._register_cleanup(
            f"relay-invitation:{station_peer_id}:{relay_peer_id}",
            lambda: self._close_invite(origin, label=label, station_peer_id=station_peer_id,
                                       relay_config=relay_config, trust_anchor=trust_anchor),
        )
        status, created = relay_json_request(
            origin + "/api/v1/relay/invite", method="POST",
            body={"station_peer_id": station_peer_id, "label": label,
                  "max_clients": 8, "bandwidth_limit": 1 << 30},
            token=mint_posix_relay_operator_token(relay_config), trust_anchor=trust_anchor,
        )
        invitation = created.get("invitation")
        if (status != 200 or not isinstance(invitation, Mapping)
                or invitation.get("relay_peer_id") != relay_peer_id
                or invitation.get("control_origin") != origin
                or invitation.get("intended_station_peer_id") != station_peer_id
                or invitation.get("label") != label or not invitation.get("invite_token")):
            raise BlockedError(reason="Relay invitation fixture identity is invalid",
                               resource="relay-attachment-fixture")
        self._register_cleanup(
            f"relay-attachment:{station_peer_id}:{relay_peer_id}",
            lambda: self._detach(station_url, relay_peer_id, label=label,
                                 control_origin=origin, station_peer_id=station_peer_id),
        )
        status, _ = relay_json_request(
            station_url.rstrip("/") + "/dashboard/api/relay/attachments",
            method="POST", body=dict(invitation), token=dashboard_token,
        )
        if status != 200:
            raise BlockedError(reason=f"Station Relay attachment import failed: HTTP {status}",
                               resource="relay-attachment-fixture")
        result = self.wait_attachment(station_url, dashboard_token, relay_peer_id, present=True,
                                      label=label, control_origin=origin)
        assert result is not None
        return result

    def prepare(
        self, *, manifest: RuntimeManifest, station_config: PosixServiceRuntimeConfig,
        station_url: str, relay_url: str, relay_peer_id: str,
        relay_config: PosixServiceRuntimeConfig, trust_anchor: bytes,
    ) -> dict[str, Any]:
        self.install_station_ca(station_config, trust_anchor, run_id=manifest.run_id)
        return self.ensure_attachment(
            manifest=manifest, station_url=station_url, relay_url=relay_url,
            relay_peer_id=relay_peer_id, relay_config=relay_config, trust_anchor=trust_anchor,
        )
