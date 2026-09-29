#!/usr/bin/env python3
"""Native Desktop proof for OAuth loopback startup before authentication."""

from __future__ import annotations

import json
import os
import re
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    REPO_ROOT,
    call_async_harness,
    load_runtime_manifest,
)
from tooling.acceptance.drivers.native import resolve_native_desktop_runtime
from tooling.acceptance.drivers.tauri import TauriSession


GATE_ID = "station-access-desktop-oauth-native-e2e"
CLIENT_ID = "oauth-login"
PROVIDERS = ("github", "google")
REQUIRED_ASSERTIONS = frozenset(
    {
        "native_login_surface_is_unauthenticated",
        "github_loopback_starts_before_authentication",
        "google_loopback_starts_before_authentication",
        "github_loopback_cancels_before_authentication",
        "google_loopback_cancels_before_authentication",
        "native_runtime_is_source_bound",
        "native_runtime_cleanup",
    }
)
OAUTH_START_SCRIPT = """
const providerId = arguments[0];
const done = arguments[arguments.length - 1];
const internals = window.__TAURI_INTERNALS__;
if (!internals || typeof internals.invoke !== 'function') {
  done({ transport: 'missing', error: 'Tauri invoke is unavailable' });
  return;
}
let settled = false;
const finish = (value) => {
  if (settled) return;
  settled = true;
  window.clearTimeout(timer);
  done(value);
};
const timer = window.setTimeout(
  () => finish({ transport: 'timeout', error: 'oauth2_start_loopback timed out' }),
  10000,
);
Promise.resolve(internals.invoke('oauth2_start_loopback', {
  input: { id: providerId, environment: 'prod' },
})).then(
  (value) => finish({ transport: 'resolved', value }),
  (error) => finish({
    transport: 'rejected',
    error: {
      code: error?.code || error?.error?.code || '',
      message: error?.message || error?.error?.message || String(error),
    },
  }),
);
"""
OAUTH_CANCEL_SCRIPT = """
const sessionId = arguments[0];
const done = arguments[arguments.length - 1];
const internals = window.__TAURI_INTERNALS__;
Promise.resolve(internals.invoke('oauth2_cancel_loopback', {
  input: { session_id: sessionId },
})).then(
  (value) => done({ transport: 'resolved', value }),
  (error) => done({
    transport: 'rejected',
    error: {
      code: error?.code || error?.error?.code || '',
      message: error?.message || error?.error?.message || String(error),
    },
  }),
);
"""


class DesktopOAuthNativeGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "SAL-OAUTH"
    bom = ("SAL-OAUTH-01",)
    spec = ("station-access-desktop-oauth-preauth",)

    def __init__(self) -> None:
        super().__init__()
        manifest_path = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_MANIFEST",
            "",
        ).strip()
        if not manifest_path:
            raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        self.manifest = load_runtime_manifest(Path(manifest_path), self.gate_id)
        self.report.manifest = self.manifest
        runtime_cell_manifest_path = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_CELL_MANIFEST",
            "",
        ).strip()
        if not runtime_cell_manifest_path:
            raise GateError("PT_ACCEPTANCE_RUNTIME_CELL_MANIFEST is required")
        try:
            runtime_cell_manifest = json.loads(
                Path(runtime_cell_manifest_path).read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError) as error:
            raise GateError(
                f"Desktop OAuth runtime-cell manifest is invalid: {error}"
            ) from error
        self.runtime_cell_manifest = self._mapping(
            runtime_cell_manifest,
            "runtime-cell manifest",
        )
        source = self._mapping(self.manifest.get("source"), "runtime source")
        source_commit = str(source.get("commit") or "")
        if source.get("workspaceDigest") != "clean" or not source_commit:
            raise GateError("Desktop OAuth native proof requires clean source")
        cell_id = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()
        if cell_id != "desktop-macos-native":
            raise GateError(
                "Desktop OAuth native proof requires desktop-macos-native"
            )
        self.runtime_binding = resolve_native_desktop_runtime(
            cell_id,
            gate_id=self.gate_id,
            source_commit=source_commit,
        )
        self.runtime_binding.set_runtime_manifest(self.manifest)

    def run(self) -> dict[str, Any]:
        client = self._client()
        session: TauriSession | None = None
        cleanup: dict[str, Any] = {}
        try:
            session = self.runtime_binding.create_bound_session(CLIENT_ID)
            login_card = self._wait_for_displayed(
                session,
                "[data-pt-login-card]",
                timeout=30,
            )
            identity = self._mapping(
                call_async_harness(
                    session,
                    "identityState",
                    {},
                    namespace="stationAccess",
                    script_timeout=10,
                ),
                "Desktop pre-authentication identity",
            )
            self.save_screenshot(session, "desktop-oauth-pre-auth")
            self.save_dom(session, "desktop-oauth-pre-auth")
            self.assert_condition(
                "native_login_surface_is_unauthenticated",
                login_card.is_displayed()
                and identity.get("authenticated") is False
                and not identity.get("actorPtid"),
                json.dumps(identity, sort_keys=True),
            )

            providers = {
                provider_id: self._start_oauth(session, provider_id)
                for provider_id in PROVIDERS
            }
            for provider_id in PROVIDERS:
                self.assert_condition(
                    f"{provider_id}_loopback_starts_before_authentication",
                    providers[provider_id]["transport"] == "resolved"
                    and providers[provider_id]["hasAuthorizationUrl"] is True
                    and providers[provider_id]["hasLoopbackSession"] is True,
                    json.dumps(providers[provider_id], sort_keys=True),
                )
                cancellation = self._cancel_oauth(
                    session,
                    providers[provider_id]["sessionId"],
                )
                providers[provider_id]["cancellation"] = cancellation
                self.assert_condition(
                    f"{provider_id}_loopback_cancels_before_authentication",
                    cancellation["transport"] == "resolved"
                    and cancellation["cancelled"] is True
                    and cancellation["status"] == "cancelled",
                    json.dumps(cancellation, sort_keys=True),
                )
            source_identity = self._source_identity()
            self.assert_condition(
                "native_runtime_is_source_bound",
                session.get_current_url() == "tauri://localhost"
                and source_identity["verified"] is True,
                json.dumps(source_identity, sort_keys=True),
            )
        finally:
            if session is not None:
                session.stop()
                self.save_app_log(session, "desktop-oauth-pre-auth")
            cleanup = self.runtime_binding.finalize_cleanup(
                [session] if session is not None else [],
                {CLIENT_ID: client},
            )
            self.report.runtime["cleanup"] = cleanup

        self.assert_condition(
            "native_runtime_cleanup",
            cleanup.get("portsReleased") is True
            and cleanup.get("processesReleased") is True
            and cleanup.get("storageReleased") is True
            and not cleanup.get("cleanupErrors"),
            json.dumps(cleanup, sort_keys=True),
        )
        assertions = {assertion.name for assertion in self.report.assertions}
        missing = REQUIRED_ASSERTIONS - assertions
        if missing:
            raise GateError(
                f"Desktop OAuth native assertions are missing: {sorted(missing)}"
            )
        return {
            "environment": "station-access-desktop-oauth-native",
            "runtimeCell": "desktop-macos-native",
            "journey": "station-access-desktop-oauth-preauth",
            "providers": providers,
            "sourceIdentity": source_identity,
            "cleanup": cleanup,
        }

    def _client(self) -> dict[str, Any]:
        clients = self.manifest.get("clients")
        if not isinstance(clients, list):
            raise GateError("Desktop OAuth runtime clients are missing")
        matches = [
            dict(client)
            for client in clients
            if isinstance(client, Mapping) and client.get("id") == CLIENT_ID
        ]
        if len(matches) != 1:
            raise GateError("Desktop OAuth runtime requires exactly one login client")
        return matches[0]

    @staticmethod
    def _wait_for_displayed(
        session: TauriSession,
        selector: str,
        *,
        timeout: float,
    ) -> Any:
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            try:
                element = session.find_element(selector, timeout=1)
                if element.is_displayed():
                    return element
            except Exception as error:  # noqa: BLE001 - retained for evidence.
                last_error = error
            time.sleep(0.1)
        suffix = f"; last error: {last_error}" if last_error else ""
        raise GateError(
            f"Desktop OAuth element did not become visible: {selector}{suffix}"
        )

    def _source_identity(self) -> dict[str, Any]:
        source = self._mapping(self.manifest.get("source"), "runtime source")
        services = self._mapping(
            self.manifest.get("services"),
            "runtime services",
        )
        station = self._mapping(services.get("station"), "Station attestation")
        runtime_cell = self.runtime_binding.runtime_identity()
        binary = self.runtime_binding.binary_identity()
        leased_cell = self.runtime_cell_manifest
        cell_source = self._mapping(
            runtime_cell.get("source"),
            "runtime-cell source",
        )
        leased_cell_source = self._mapping(
            leased_cell.get("source"),
            "leased runtime-cell source",
        )
        source_commit = str(source.get("commit") or "")
        binary_sha256 = str(binary.get("sha256") or "")
        verified = (
            self.manifest.get("state") == "FIXTURE_READY"
            and self.manifest.get("gateId") == self.gate_id
            and source.get("workspaceDigest") == "clean"
            and station.get("workspaceDigest") == "clean"
            and station.get("liveCommit") == source_commit
            and runtime_cell.get("cellId") == "desktop-macos-native"
            and runtime_cell.get("gateId") == self.gate_id
            and runtime_cell.get("state") == "LEASED"
            and leased_cell.get("cellId") == "desktop-macos-native"
            and leased_cell.get("gateId") == self.gate_id
            and leased_cell.get("state") == "LEASED"
            and cell_source.get("commit") == source_commit
            and cell_source.get("workspaceDigest") == "clean"
            and leased_cell_source.get("commit") == source_commit
            and leased_cell_source.get("workspaceDigest") == "clean"
            and binary.get("sourceCommit") == source_commit
            and re.fullmatch(r"[0-9a-f]{64}", binary_sha256) is not None
            and cell_source.get("binarySha256") == binary_sha256
            and leased_cell_source.get("binarySha256") == binary_sha256
        )
        return {
            "orchestrator": source,
            "station": station,
            "runtimeCell": runtime_cell,
            "leasedRuntimeCell": leased_cell,
            "binary": binary,
            "verified": verified,
        }

    @staticmethod
    def _start_oauth(
        session: TauriSession,
        provider_id: str,
    ) -> dict[str, Any]:
        raw = session.execute_async_script(OAUTH_START_SCRIPT, provider_id)
        if not isinstance(raw, Mapping) or raw.get("transport") != "resolved":
            raise GateError(
                f"{provider_id} OAuth start failed before authentication: "
                f"{json.dumps(raw, sort_keys=True)}"
            )
        result = raw.get("value")
        if not isinstance(result, Mapping) or result.get("ok") is not True:
            raise GateError(
                f"{provider_id} OAuth start was rejected before authentication: "
                f"{json.dumps(result, sort_keys=True)}"
            )
        data = result.get("data")
        status_raw = data.get("status") if isinstance(data, Mapping) else None
        if not isinstance(status_raw, str):
            raise GateError(f"{provider_id} OAuth start omitted status")
        try:
            status = json.loads(status_raw)
        except json.JSONDecodeError as error:
            raise GateError(
                f"{provider_id} OAuth start returned invalid status JSON"
            ) from error
        auth_url = str(status.get("auth_url") or "")
        session_id = str(status.get("session_id") or "")
        parsed_url = urlparse(auth_url)
        return {
            "provider": provider_id,
            "transport": "resolved",
            "authorizationOrigin": (
                f"{parsed_url.scheme}://{parsed_url.netloc}"
                if parsed_url.scheme and parsed_url.netloc
                else ""
            ),
            "hasAuthorizationUrl": parsed_url.scheme in {"http", "https"},
            "hasLoopbackSession": session_id.startswith("lp-"),
            "sessionId": session_id,
        }

    @staticmethod
    def _cancel_oauth(
        session: TauriSession,
        session_id: str,
    ) -> dict[str, Any]:
        raw = session.execute_async_script(OAUTH_CANCEL_SCRIPT, session_id)
        if not isinstance(raw, Mapping) or raw.get("transport") != "resolved":
            raise GateError(
                "OAuth cancellation failed before authentication: "
                f"{json.dumps(raw, sort_keys=True)}"
            )
        result = raw.get("value")
        if not isinstance(result, Mapping) or result.get("ok") is not True:
            raise GateError(
                "OAuth cancellation was rejected before authentication: "
                f"{json.dumps(result, sort_keys=True)}"
            )
        data = result.get("data")
        status_raw = data.get("status") if isinstance(data, Mapping) else None
        if not isinstance(status_raw, str):
            raise GateError("OAuth cancellation omitted status")
        try:
            status = json.loads(status_raw)
        except json.JSONDecodeError as error:
            raise GateError("OAuth cancellation returned invalid status JSON") from error
        return {
            "transport": "resolved",
            "cancelled": status.get("cancelled") is True,
            "status": str(status.get("status") or ""),
        }

    @staticmethod
    def _mapping(value: object, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must be an object")
        return dict(value)


def main() -> int:
    return DesktopOAuthNativeGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
