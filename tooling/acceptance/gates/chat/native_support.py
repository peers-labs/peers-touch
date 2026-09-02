from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Literal

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import (
    ArtifactRef,
    EvidenceStore,
    GateError,
    ProvisioningError,
    REPO_ROOT,
    call_async_harness,
    require_runtime_service,
)
from tooling.acceptance.core.provisioning import load_runtime_manifest
from tooling.acceptance.drivers.native import (
    NativeDesktopRuntimeBinding,
    resolve_native_desktop_runtime,
)
from tooling.acceptance.drivers.station import StationDriver
from tooling.acceptance.drivers.tauri import TauriDriver, TauriSession
from tooling.acceptance.fixtures.chat_native_reset import deploy_environment


DEFAULT_STATION = "http://10.37.94.156:18080"
DEV_ACCOUNT_PASSWORD = "1"
ACCOUNTS = {
    "alice": "alice@p.t",
    "bob": "bob@p.t",
    "charlie": "carol@p.t",
}


def runtime_station_service(manifest: dict[str, Any]) -> dict[str, Any]:
    try:
        return require_runtime_service(manifest, "station", "station")
    except ProvisioningError as error:
        raise GateError(str(error)) from error


@dataclass(frozen=True)
class SelectedNativeRuntime:
    manifest: dict[str, Any]
    actor_manifest: dict[str, Any]
    binding: NativeDesktopRuntimeBinding


NativeProcessState = Literal[
    "starting",
    "live",
    "stopped_preserved",
    "stopped",
]
NativeAuthState = Literal[
    "none",
    "restoring",
    "authenticated",
    "revoked",
    "logged_out",
]
NativeDeviceState = Literal["active", "revoked"]


@dataclass
class NativeClientLifecycle:
    client: TauriSession
    expected_actor_ptid: str
    process_state: NativeProcessState = "starting"
    auth_state: NativeAuthState = "none"
    device_state: NativeDeviceState = "active"
    successor_client_id: int | None = None


class NativeClientLifecycleLedger:
    def __init__(self) -> None:
        self.records: list[NativeClientLifecycle] = []
        self._by_client_id: dict[int, NativeClientLifecycle] = {}

    def register(
        self,
        client: TauriSession,
        expected_actor_ptid: str,
    ) -> NativeClientLifecycle:
        if not expected_actor_ptid.startswith("ptid:"):
            raise GateError(
                "native client lifecycle requires canonical actor PTID"
            )
        record = NativeClientLifecycle(client, expected_actor_ptid)
        self.records.append(record)
        self._by_client_id[id(client)] = record
        return record

    def _record(self, client: TauriSession) -> NativeClientLifecycle:
        record = self._by_client_id.get(id(client))
        if record is None:
            raise GateError(
                f"native client lifecycle is unregistered: {client.profile}"
            )
        return record

    def mark_live(self, client: TauriSession) -> None:
        self._record(client).process_state = "live"

    def mark_restoring(self, client: TauriSession) -> None:
        self._record(client).auth_state = "restoring"

    def mark_authenticated(self, client: TauriSession) -> None:
        self._record(client).auth_state = "authenticated"

    def mark_auth_revoked(self, client: TauriSession) -> None:
        self._record(client).auth_state = "revoked"

    def mark_device_revoked(self, client: TauriSession) -> None:
        self._record(client).device_state = "revoked"

    def transfer_preserved_session(
        self,
        predecessor: TauriSession,
        successor: TauriSession,
    ) -> None:
        predecessor_record = self._record(predecessor)
        successor_record = self._record(successor)
        if predecessor_record.process_state != "stopped_preserved":
            raise GateError(
                "native session transfer requires a preserved predecessor"
            )
        if (
            predecessor_record.expected_actor_ptid
            != successor_record.expected_actor_ptid
        ):
            raise GateError(
                "native session transfer actor PTID mismatch"
            )
        predecessor_record.successor_client_id = id(successor)
        successor_record.auth_state = "restoring"

    def stop_preserving_session(self, client: TauriSession) -> None:
        record = self._record(client)
        client.stop(preserve_state=True)
        record.process_state = "stopped_preserved"

    def release(self, client: TauriSession) -> list[dict[str, str]]:
        record = self._record(client)
        if record.process_state == "stopped":
            return []
        if record.process_state == "stopped_preserved":
            successor = self._by_client_id.get(
                record.successor_client_id or -1
            )
            if successor is None or successor.auth_state not in {
                "authenticated",
                "revoked",
                "logged_out",
            }:
                return [
                    {
                        "resource": f"session:{client.profile}",
                        "error": (
                            "preserved native session has no verified "
                            "successor"
                        ),
                    }
                ]
            return []

        errors: list[dict[str, str]] = []
        if record.auth_state in {"authenticated", "restoring"}:
            try:
                process_alive = client.is_alive()
            except Exception as error:
                process_alive = False
                errors.append(
                    {
                        "resource": f"session:{client.profile}",
                        "error": (
                            "failed to inspect authenticated native window: "
                            f"{error}"
                        ),
                    }
                )
            if not process_alive:
                if not errors:
                    errors.append(
                        {
                            "resource": f"session:{client.profile}",
                            "error": (
                                "authenticated native window terminated before "
                                "logout"
                            ),
                        }
                    )
            else:
                try:
                    logout_native_client(
                        client,
                        record.expected_actor_ptid,
                    )
                    record.auth_state = "logged_out"
                except Exception as error:
                    errors.append(
                        {
                            "resource": f"session:{client.profile}",
                            "error": str(error),
                        }
                    )

        try:
            client.stop()
            record.process_state = "stopped"
        except Exception as error:
            errors.append(
                {
                    "resource": f"client:{client.profile}",
                    "error": str(error),
                }
            )
        return errors

    def release_all(self) -> list[dict[str, str]]:
        errors: list[dict[str, str]] = []
        for record in reversed(self.records):
            errors.extend(self.release(record.client))
        return errors


def selected_native_runtime(gate_id: str) -> SelectedNativeRuntime | None:
    cell_id = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()
    if not cell_id:
        return None
    raw_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
    if not raw_path:
        raise GateError(
            "PT_ACCEPTANCE_RUNTIME_MANIFEST is required when "
            "PT_ACCEPTANCE_RUNTIME_CELL is selected"
        )
    manifest = load_runtime_manifest(Path(raw_path), gate_id)
    actor_ref = manifest.get("actorManifest")
    if not isinstance(actor_ref, dict):
        raise GateError("runtime manifest actorManifest is required")
    actors = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    ).read_json(ArtifactRef.from_dict(actor_ref))
    if actors.get("artifactKind") != "acceptance-actor-manifest":
        raise GateError("runtime actor manifest has invalid artifact kind")
    source = manifest.get("source")
    source_commit = str(
        source.get("commit") if isinstance(source, dict) else ""
    )
    if not source_commit:
        raise GateError("runtime manifest source commit is required")
    return SelectedNativeRuntime(
        manifest=manifest,
        actor_manifest=actors,
        binding=resolve_native_desktop_runtime(
            cell_id,
            gate_id=gate_id,
            source_commit=source_commit,
        ),
    )


def verify_runtime_fixture_ready(
    manifest: dict[str, Any],
    actor_manifest: dict[str, Any],
) -> None:
    reset = actor_manifest.get("reset")
    if (
        manifest.get("state") != "FIXTURE_READY"
        or not isinstance(reset, dict)
        or reset.get("authorized") is not True
        or reset.get("targetVerified") is not True
    ):
        raise GateError("runtime manifest fixture is not reset and verified")


def cleanup_preserving_primary_failure(
    cleanup: Callable[[], dict[str, Any]],
    report: Any,
    context: str,
) -> dict[str, Any]:
    primary_error = sys.exc_info()[1]
    try:
        return cleanup()
    except Exception as cleanup_error:
        if primary_error is None:
            raise
        failure = {
            "resource": "cleanup",
            "error": str(cleanup_error),
        }
        report.runtime["cleanupFailure"] = failure
        if hasattr(primary_error, "add_note"):
            primary_error.add_note(
                f"{context} cleanup also failed: {cleanup_error}"
            )
        cleanup_evidence = report.runtime.get("cleanup")
        return (
            cleanup_evidence
            if isinstance(cleanup_evidence, dict)
            else {"cleanupErrors": [failure]}
        )


def native_runtime_source_identity(
    *,
    gate_id: str,
    manifest: dict[str, Any],
    runtime_binding: NativeDesktopRuntimeBinding,
    station_live: dict[str, Any],
) -> dict[str, Any]:
    source = manifest.get("source")
    station = runtime_station_service(manifest)
    runtime_cell = runtime_binding.runtime_identity()
    binary = runtime_binding.binary_identity()
    cell_source = (
        runtime_cell.get("source")
        if isinstance(runtime_cell, dict)
        else None
    )
    platform = (
        runtime_cell.get("platform")
        if isinstance(runtime_cell, dict)
        else None
    )
    transport = (
        runtime_cell.get("transport")
        if isinstance(runtime_cell, dict)
        else None
    )
    source_commit = str(
        source.get("commit") if isinstance(source, dict) else ""
    )
    station_commit = str(
        station.get("liveCommit") if isinstance(station, dict) else ""
    )
    binary_sha256 = str(binary.get("sha256") or "")
    linux_runtime_valid = (
        runtime_binding.cell_id != "desktop-linux-native"
        or (
            isinstance(cell_source, dict)
            and cell_source.get("remoteCheckoutClean") is True
            and re.fullmatch(
                r"[0-9a-f]{64}",
                str(cell_source.get("remoteSourceDigest") or ""),
            )
            is not None
            and isinstance(platform, dict)
            and re.fullmatch(
                r"[0-9a-f]{64}",
                str(platform.get("imageDigest") or ""),
            )
            is not None
            and isinstance(transport, dict)
            and re.fullmatch(
                r"[0-9a-f]{64}",
                str(transport.get("hostIdentitySha256") or ""),
            )
            is not None
            and re.fullmatch(
                r"[0-9a-f]{64}",
                str(transport.get("hostKeySha256") or ""),
            )
            is not None
        )
    )
    identity = {
        "orchestrator": source,
        "station": station,
        "stationLive": station_live,
        "runtimeCell": runtime_cell,
        "binary": binary,
    }
    valid = (
        isinstance(source, dict)
        and bool(source_commit)
        and source.get("workspaceDigest") == "clean"
        and isinstance(station, dict)
        and station.get("workspaceDigest") == "clean"
        and station_commit == source_commit
        and re.fullmatch(
            r"[0-9a-f]{64}",
            str(station.get("protocolDigest") or ""),
        )
        is not None
        and commits_match(
            str(station_live.get("build_commit") or ""),
            source_commit,
        )
        and isinstance(runtime_cell, dict)
        and runtime_cell.get("artifactKind")
        == "acceptance-runtime-cell-manifest"
        and runtime_cell.get("cellId") == runtime_binding.cell_id
        and runtime_cell.get("gateId") == gate_id
        and bool(runtime_cell.get("runId"))
        and runtime_cell.get("state") == "LEASED"
        and isinstance(cell_source, dict)
        and cell_source.get("commit") == source_commit
        and cell_source.get("workspaceDigest") == "clean"
        and linux_runtime_valid
        and binary.get("sourceCommit") == source_commit
        and re.fullmatch(r"[0-9a-f]{64}", binary_sha256) is not None
        and cell_source.get("binarySha256") == binary_sha256
    )
    if not valid:
        raise GateError(
            "runtime source identity mismatch: "
            f"{json.dumps(identity, sort_keys=True)}"
        )
    return identity



def reset_fixture(accounts: tuple[str, ...] = ("alice", "bob")) -> None:
    if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
        raise GateError(
            "native Chat gate requires CHAT_ACCEPTANCE_RESET=1 against the "
            "authorized disposable Station"
        )
    subprocess.run(
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
            "station-three",
            "--accounts",
            *accounts,
        ],
        cwd=REPO_ROOT,
        check=True,
    )


def async_harness(
    driver: Any,
    method: str,
    payload: dict[str, Any],
    timeout: float = 45.0,
) -> Any:
    return call_async_harness(
        driver,
        method,
        payload,
        namespace="chat",
        script_timeout=timeout,
    )


def is_station_authorization_rejection(error: BaseException | str) -> bool:
    message = str(error).lower()
    return any(
        marker in message
        for marker in (
            "endpoint is not active",
            "sender unauthorized",
            "forbidden",
            "status 403",
            "station returned 403",
        )
    )


def logout_native_client(
    client: TauriSession,
    actor_ptid: str,
) -> dict[str, Any]:
    result = async_harness(
        client,
        "logout",
        {"actorPtid": actor_ptid},
        timeout=30,
    )
    if (
        not isinstance(result, dict)
        or result.get("actorPtid") != actor_ptid
        or result.get("status") != "logged_out"
    ):
        raise GateError(
            "native window logout returned invalid lifecycle evidence: "
            f"{result}"
        )
    return result


def configure_station(client: TauriDriver, station_url: str) -> None:
    with StationDriver(f"http://127.0.0.1:{client.gateway_port}") as station:
        station.station_add(station_url)
        station.station_set_active(station_url)


def enter_chat_page(client: TauriDriver) -> None:
    if client.get_current_url().endswith("#/chat"):
        return
    WebDriverWait(client.driver, 20).until(
        lambda driver: driver.find_element(
            By.CSS_SELECTOR,
            '[data-pt-primary-nav="chat"] button, '
            '[data-pt-primary-nav="chat"] [role="button"]',
        )
    ).click()
    WebDriverWait(client.driver, 20).until(
        lambda driver: driver.current_url.endswith("#/chat")
    )


def start_authenticated_client(
    account: str,
    port: int,
    station_url: str,
    instance: str = "",
) -> tuple[TauriDriver, str]:
    label = instance or account
    storage = (
        REPO_ROOT
        / ".local"
        / "acceptance"
        / "embedded-webdriver"
        / label
        / "storage"
    )
    storage.mkdir(parents=True, exist_ok=True)
    client = TauriDriver(
        port=port,
        profile=f"acceptance-{label}",
        storage_root=str(storage),
        environment={"PEERS_STATION_URL": station_url},
    )
    client.start()
    try:
        client.wait_for_acceptance_harness(30)
        configure_station(client, station_url)
        login = async_harness(
            client,
            "loginWithPassword",
            {
                "account": ACCOUNTS[account],
                "password": DEV_ACCOUNT_PASSWORD,
            },
            timeout=30,
        )
        ptid = str((login or {}).get("actorPtid") or "")
        if not (login or {}).get("authenticated") or not ptid.startswith("ptid:"):
            raise GateError(
                f"{account} login did not return canonical PTID: {login}"
            )
        if not client.get_current_url().startswith("tauri://localhost"):
            raise GateError(
                f"{account} is not running in native Tauri WebView: "
                f"{client.get_current_url()}"
            )
        return client, ptid
    except Exception:
        client.stop()
        raise


def stop_client(client: TauriDriver) -> None:
    try:
        with StationDriver(
            f"http://127.0.0.1:{client.gateway_port}"
        ) as station:
            station.auth_logout()
    finally:
        client.stop()


def current_commit() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()


def current_workspace_digest() -> str:
    digest = hashlib.sha256()
    digest.update(
        subprocess.run(
            ["git", "diff", "--binary", "HEAD"],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
        ).stdout
    )
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    ).stdout.split(b"\0")
    for raw_path in sorted(path for path in untracked if path):
        digest.update(raw_path)
        digest.update(b"\0")
        digest.update((REPO_ROOT / raw_path.decode("utf-8")).read_bytes())
    return digest.hexdigest()


def commits_match(live_commit: str, expected_commit: str) -> bool:
    return (
        len(live_commit) >= 7
        and len(expected_commit) >= 7
        and (
            live_commit.startswith(expected_commit)
            or expected_commit.startswith(live_commit)
        )
    )


def read_station_version(station_url: str) -> dict[str, Any]:
    with urllib.request.urlopen(
        f"{station_url.rstrip('/')}/app-meta/version",
        timeout=10,
    ) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise GateError("Station version response must be an object")
    return value


def wait_until(
    predicate: Callable[[], Any],
    description: str,
    timeout: float = 120,
    interval: float = 0.25,
) -> Any:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as error:  # noqa: BLE001
            last_error = error
        time.sleep(interval)
    suffix = f"; last error: {last_error}" if last_error else ""
    raise GateError(f"timed out waiting for {description}{suffix}")


def send_text(client: TauriDriver, text: str) -> dict[str, Any]:
    composer = client.find_element('[data-pt-text-input="chat-composer"]', 30)
    client.execute_script(
        """
        const element = arguments[0];
        const value = arguments[1];
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        if (!setter) throw new Error('textarea setter missing');
        setter.call(element, value);
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: value,
          inputType: 'insertText',
        }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        """,
        composer,
        text,
    )
    client.find_element("[data-chat-send]", 10).click()
    return wait_until(
        lambda: message_snapshot(client, text),
        "sender optimistic message",
    )


def message_snapshot(client: TauriDriver, text: str) -> dict[str, Any] | None:
    value = client.execute_script(
        """
        const text = arguments[0];
        const row = Array.from(document.querySelectorAll('[data-message-ulid]'))
          .find((item) => (item.innerText || '').includes(text));
        if (!row) return null;
        return {
          messageUlid: row.getAttribute('data-message-ulid') || '',
          text: row.innerText || '',
          receipt: row.querySelector('[data-message-receipt]')
            ?.getAttribute('data-message-receipt') || '',
        };
        """,
        text,
    )
    return value if isinstance(value, dict) else None


def gateway_command(
    client: TauriDriver,
    command: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    request = urllib.request.Request(
        f"http://127.0.0.1:{client.gateway_port}",
        data=json.dumps({"cmd": command, "args": args}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        envelope = json.loads(response.read().decode("utf-8"))
    if not isinstance(envelope, dict) or envelope.get("ok") is not True:
        raise GateError(f"{command} failed: {envelope}")
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise GateError(f"{command} returned invalid data")
    return data


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def station_readback(conversation_id: str, message_id: str) -> dict[str, Any]:
    environment = deploy_environment("station-three")
    host = environment.get("PT_DEPLOY_HOST", "").strip()
    user = environment.get("PT_DEPLOY_USER", "").strip()
    if not host or not user:
        raise GateError("station-three deployment host identity is unavailable")
    container = os.environ.get(
        "CHAT_ACCEPTANCE_POSTGRES_CONTAINER",
        "pt-station-a-postgres-1",
    )
    conversation = sql_literal(conversation_id)
    message = sql_literal(message_id)
    query = f"""
SELECT json_build_object(
  'events', COALESCE((
    SELECT json_agg(json_build_object(
      'eventId', event_id,
      'sequence', sequence,
      'commandId', command_id,
      'messageId', message_id,
      'hashBytes', octet_length(event_hash)
    ) ORDER BY sequence)
    FROM messaging_events
    WHERE conversation_id = {conversation} AND message_id = {message}
  ), '[]'::json),
  'authorityEvents', COALESCE((
    SELECT json_agg(json_build_object(
      'eventId', event_id,
      'sequence', sequence,
      'commandId', command_id
    ) ORDER BY sequence)
    FROM messaging_events
    WHERE conversation_id = {conversation}
  ), '[]'::json),
  'queue', COALESCE((
    SELECT json_agg(json_build_object(
      'itemId', item_id,
      'eventId', event_id,
      'recipientPtid', recipient_ptid,
      'recipientDeviceId', recipient_device_id,
      'laneSequence', lane_sequence,
      'state', state,
      'attemptCount', attempt_count,
      'payloadSha256', encode(payload_sha256, 'hex')
    ) ORDER BY recipient_ptid, recipient_device_id, lane_sequence)
    FROM device_queue_items
    WHERE conversation_id = {conversation}
  ), '[]'::json),
  'readCursors', COALESCE((
    SELECT json_agg(json_build_object(
      'readerPtid', reader_ptid,
      'lastReadSequence', last_read_sequence
    ) ORDER BY reader_ptid)
    FROM messaging_read_cursors
    WHERE conversation_id = {conversation}
  ), '[]'::json)
);
"""
    remote = (
        f"docker exec -i {container} sh -lc "
        "'psql -At -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\"'"
    )
    result = subprocess.run(
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
        input=query,
        text=True,
        check=True,
        capture_output=True,
    )
    value = json.loads(result.stdout.strip())
    if not isinstance(value, dict):
        raise GateError("Station interaction readback is invalid")
    return value
