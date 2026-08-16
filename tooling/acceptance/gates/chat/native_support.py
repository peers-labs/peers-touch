from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import GateError, REPO_ROOT, call_async_harness
from tooling.acceptance.drivers.station import StationDriver
from tooling.acceptance.drivers.tauri import TauriDriver


DEFAULT_STATION = "http://10.37.94.156:18080"
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
        password = os.environ.get("CHAT_ACCEPTANCE_PASSWORD", "")
        if not password:
            raise GateError("CHAT_ACCEPTANCE_PASSWORD is required")
        client.wait_for_acceptance_harness(30)
        configure_station(client, station_url)
        with StationDriver(
            f"http://127.0.0.1:{client.gateway_port}"
        ) as station:
            station.auth_logout()
        login = async_harness(
            client,
            "loginWithPassword",
            {"account": ACCOUNTS[account], "password": password},
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
