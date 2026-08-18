from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request
from typing import Any, Callable

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import GateError, REPO_ROOT, call_async_harness
from tooling.acceptance.drivers.station import StationDriver
from tooling.acceptance.drivers.tauri import TauriDriver
from tooling.acceptance.fixtures.chat_native_reset import deploy_environment


DEFAULT_STATION = "http://10.37.94.156:18080"
DEV_ACCOUNT_PASSWORD = "1"
ACCOUNTS = {
    "alice": "alice@p.t",
    "bob": "bob@p.t",
    "charlie": "carol@p.t",
}


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
) -> tuple[TauriDriver, str]:
    storage = (
        REPO_ROOT
        / ".local"
        / "acceptance"
        / "embedded-webdriver"
        / account
        / "storage"
    )
    storage.mkdir(parents=True, exist_ok=True)
    client = TauriDriver(
        port=port,
        profile=f"acceptance-{account}",
        storage_root=str(storage),
        environment={"PEERS_STATION_URL": station_url},
    )
    client.start()
    try:
        client.wait_for_acceptance_harness(30)
        configure_station(client, station_url)
        with StationDriver(
            f"http://127.0.0.1:{client.gateway_port}"
        ) as station:
            station.auth_logout()
        login = async_harness(
            client,
            "loginWithPassword",
            {
                "account": ACCOUNTS[account],
                "password": DEV_ACCOUNT_PASSWORD,
            },
            timeout=30,
        )
        ptid = str((login or {}).get("actorId") or "")
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
