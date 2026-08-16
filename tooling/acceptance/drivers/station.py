from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from tooling.acceptance.core import BaseDriver, GateError


class StationDriver(BaseDriver):

    def __init__(self, gateway_url: str, timeout: float = 25.0):
        self.gateway_url = gateway_url.rstrip("/")
        self.timeout = timeout
        self._started = False

    def start(self) -> "StationDriver":
        self._started = True
        return self

    def stop(self) -> None:
        self._started = False

    def wait_for_ready(self, timeout: float = 10.0) -> None:
        try:
            self.command("station_list")
        except Exception as error:
            raise GateError(f"station gateway not ready at {self.gateway_url}: {error}") from error

    def is_alive(self) -> bool:
        return self._started

    def command(self, cmd: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self._started:
            raise GateError("StationDriver not started")
        request = urllib.request.Request(
            f"{self.gateway_url}/api/gateway",
            data=json.dumps({"cmd": cmd, "args": args or {}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                envelope = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise GateError(f"gateway command {cmd} failed status={error.code} body={detail}") from error
        except (urllib.error.URLError, OSError) as error:
            raise GateError(f"gateway command {cmd} connection failed: {error}") from error
        if not envelope.get("ok"):
            raise GateError(f"gateway command {cmd} failed envelope={envelope}")
        data = envelope.get("data")
        if not isinstance(data, dict):
            raise GateError(f"gateway command {cmd} missing data envelope={envelope}")
        return data

    def station_add(self, url: str) -> dict[str, Any]:
        return self.command("station_add", {"url": url})

    def station_set_active(self, url: str) -> dict[str, Any]:
        return self.command("station_set_active", {"url": url})

    def station_list(self) -> dict[str, Any]:
        return self.command("station_list")

    def auth_logout(self) -> dict[str, Any]:
        return self.command("auth_logout")
