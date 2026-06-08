#!/usr/bin/env python3
"""Headless browser visual smoke for the Federation Dashboard page.

The script uses Chrome DevTools Protocol directly through Python stdlib, so it
does not require Playwright/Puppeteer dependencies. When dashboard credentials
are supplied through environment variables, it logs in through the dashboard API,
injects the returned token into localStorage, opens `#/federation`, captures a
PNG screenshot, and asserts user-visible Federation text.

Environment:
  FEDERATION_VISUAL_DASHBOARD_URL       default http://10.37.94.156:18180/dashboard/#/federation
  FEDERATION_VISUAL_CHROME              optional Chrome/Chromium executable
  FEDERATION_VISUAL_ENV_FILE            default .localenv
  FEDERATION_VISUAL_OUT_DIR             default /tmp/peers-touch-federation-visual-smoke
  FEDERATION_VISUAL_ADMIN_USERNAME      optional dashboard admin username
  FEDERATION_VISUAL_ADMIN_PASSWORD      optional dashboard admin password
  FEDERATION_VISUAL_REQUIRE_AUTH        set 1 to fail when credentials are absent
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_URL = "http://10.37.94.156:18180/dashboard/#/federation"
DEFAULT_ENV_FILE = ".localenv"
DEFAULT_OUT_DIR = "/tmp/peers-touch-federation-visual-smoke"
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class CDPError(RuntimeError):
    pass


class CDPSession:
    def __init__(self, websocket_url: str):
        parsed = urllib.parse.urlparse(websocket_url)
        self.host = parsed.hostname or "127.0.0.1"
        self.port = parsed.port or 80
        self.path = parsed.path
        if parsed.query:
            self.path += f"?{parsed.query}"
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        self.next_id = 1
        self._handshake()

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass

    def _handshake(self) -> None:
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode("ascii"))
        response = self.sock.recv(4096).decode("iso-8859-1")
        expected_accept = base64.b64encode(hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")
        if " 101 " not in response or expected_accept not in response:
            raise CDPError(f"websocket handshake failed: {response.splitlines()[0] if response else 'empty'}")

    def send(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        message_id = self.next_id
        self.next_id += 1
        payload = json.dumps({"id": message_id, "method": method, "params": params or {}}).encode("utf-8")
        self._send_frame(payload)
        deadline = time.time() + 30
        while time.time() < deadline:
            frame = self._recv_frame()
            if not frame:
                continue
            data = json.loads(frame.decode("utf-8"))
            if data.get("id") != message_id:
                continue
            if "error" in data:
                raise CDPError(f"{method} failed: {data['error']}")
            return data.get("result", {})
        raise CDPError(f"timeout waiting for {method}")

    def _send_frame(self, payload: bytes) -> None:
        header = bytearray([0x81])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        mask = os.urandom(4)
        header.extend(mask)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def _recv_exact(self, length: int) -> bytes:
        chunks = bytearray()
        while len(chunks) < length:
            chunk = self.sock.recv(length - len(chunks))
            if not chunk:
                raise CDPError("websocket closed")
            chunks.extend(chunk)
        return bytes(chunks)

    def _recv_frame(self) -> bytes:
        first, second = self._recv_exact(2)
        opcode = first & 0x0F
        masked = bool(second & 0x80)
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else b""
        payload = self._recv_exact(length)
        if masked:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        if opcode == 0x8:
            raise CDPError("websocket closed by browser")
        if opcode == 0x9:
            self._send_pong(payload)
            return b""
        return payload

    def _send_pong(self, payload: bytes) -> None:
        header = bytearray([0x8A])
        header.append(0x80 | len(payload))
        mask = os.urandom(4)
        header.extend(mask)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)


def find_chrome() -> str:
    configured = os.environ.get("FEDERATION_VISUAL_CHROME", "").strip()
    candidates = [
        configured,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    raise RuntimeError("Chrome/Chromium executable not found; set FEDERATION_VISUAL_CHROME")


def load_env_file() -> None:
    env_file = Path(os.environ.get("FEDERATION_VISUAL_ENV_FILE", DEFAULT_ENV_FILE))
    if not env_file.exists():
        return

    pattern = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = pattern.match(line)
        if not match:
            continue
        key, value = match.groups()
        if key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ[key] = value


def login_token(dashboard_url: str) -> str | None:
    username = os.environ.get("FEDERATION_VISUAL_ADMIN_USERNAME", "").strip()
    password = os.environ.get("FEDERATION_VISUAL_ADMIN_PASSWORD", "")
    if not username or not password:
        return None
    parsed = urllib.parse.urlparse(dashboard_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    payload = json.dumps({"username": username, "password": password}).encode("utf-8")
    request = urllib.request.Request(
        f"{origin}/dashboard/api/auth/login",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = json.loads(response.read().decode("utf-8"))
    token = body.get("token")
    if not token:
        raise RuntimeError("dashboard login response did not include token")
    return token


def wait_for_debug_port(port: int) -> str:
    url = f"http://127.0.0.1:{port}/json/new?about:blank"
    deadline = time.time() + 15
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            request = urllib.request.Request(url, method="PUT")
            with urllib.request.urlopen(request, timeout=2) as response:
                data = json.loads(response.read().decode("utf-8"))
                websocket_url = data.get("webSocketDebuggerUrl")
                if websocket_url:
                    return websocket_url
        except Exception as error:  # noqa: BLE001
            last_error = error
            time.sleep(0.2)
    raise RuntimeError(f"Chrome debug port did not become ready: {last_error}")


def launch_chrome(chrome: str, port: int, profile_dir: str) -> subprocess.Popen[bytes]:
    args = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_dir}",
        "about:blank",
    ]
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def assert_text(text: str, authenticated: bool) -> None:
    if authenticated:
        required = [
            "Federation",
            "Station Peer ID",
            "Operational Health",
            "Sync Drilldown",
            "Recovery Drilldown",
            "Discovery Drilldown",
            "Operational Event History",
            "Members",
            "Proposals",
            "Sync Cursors",
        ]
    else:
        required = ["Peers Station", "Dashboard Administration", "Sign In"]
    missing = [marker for marker in required if marker not in text]
    if missing:
        mode = "authenticated" if authenticated else "unauthenticated"
        raise RuntimeError(f"{mode} visual smoke missing text: {', '.join(missing)}")


def main() -> int:
    load_env_file()

    target_url = os.environ.get("FEDERATION_VISUAL_DASHBOARD_URL", DEFAULT_URL)
    out_dir = Path(os.environ.get("FEDERATION_VISUAL_OUT_DIR", DEFAULT_OUT_DIR))
    out_dir.mkdir(parents=True, exist_ok=True)
    require_auth = os.environ.get("FEDERATION_VISUAL_REQUIRE_AUTH", "") == "1"
    token = login_token(target_url)
    if require_auth and not token:
        raise RuntimeError("FEDERATION_VISUAL_REQUIRE_AUTH=1 requires FEDERATION_VISUAL_ADMIN_USERNAME/PASSWORD")

    chrome = find_chrome()
    port = random.randint(39000, 45000)
    profile_dir = tempfile.mkdtemp(prefix="pt-fed-visual-")
    process = launch_chrome(chrome, port, profile_dir)
    session: CDPSession | None = None
    try:
        websocket_url = wait_for_debug_port(port)
        session = CDPSession(websocket_url)
        session.send("Page.enable")
        session.send("Runtime.enable")

        parsed = urllib.parse.urlparse(target_url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        session.send("Page.navigate", {"url": origin})
        time.sleep(0.8)
        if token:
            escaped = json.dumps(token)
            session.send("Runtime.evaluate", {"expression": f"localStorage.setItem('dashboard_token', {escaped});"})

        session.send("Page.navigate", {"url": target_url})
        session.send("Page.bringToFront")
        time.sleep(4)

        text_result = session.send(
            "Runtime.evaluate",
            {"expression": "document.body ? document.body.innerText : ''", "returnByValue": True},
        )
        text = text_result.get("result", {}).get("value", "")
        assert_text(text, authenticated=bool(token))

        screenshot = session.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
        screenshot_path = out_dir / ("federation-dashboard-auth.png" if token else "federation-dashboard-login.png")
        screenshot_path.write_bytes(base64.b64decode(screenshot["data"]))
        text_path = out_dir / ("federation-dashboard-auth.txt" if token else "federation-dashboard-login.txt")
        text_path.write_text(text, encoding="utf-8")

        mode = "authenticated federation page" if token else "login gate"
        print("Federation Dashboard Visual Smoke")
        print("=================================")
        print(f"[OK] chrome: {chrome}")
        print(f"[OK] mode: {mode}")
        print(f"[OK] url: {target_url}")
        print(f"[OK] screenshot: {screenshot_path}")
        print(f"[OK] text: {text_path}")
        return 0
    finally:
        if session:
            session.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        shutil.rmtree(profile_dir, ignore_errors=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"visual smoke failed: {error}", file=sys.stderr)
        raise SystemExit(1)
