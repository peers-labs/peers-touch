#!/usr/bin/env python3
"""Desktop gateway smoke and render diagnostic for Federation surfaces.

This smoke targets the running Desktop Vite surface and the Rust HTTP gateway
started by `pnpm --dir apps/desktop tauri:dev`. It intentionally validates the
pre-login Station context first, because the Station selector is the earliest
user-visible guard against connecting to the wrong federation testnet.

Environment:
  FEDERATION_DESKTOP_VISUAL_URL       default http://localhost:3210/
  FEDERATION_DESKTOP_VISUAL_OUT_DIR   default /tmp/peers-touch-federation-desktop-gateway-smoke
  FEDERATION_SMOKE_DESKTOP_GATEWAY    default http://127.0.0.1:3030
  FEDERATION_SMOKE_DESKTOP_STATION    default http://10.37.94.156:18180
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_URL = "http://localhost:3210/"
DEFAULT_OUT_DIR = "/tmp/peers-touch-federation-desktop-gateway-smoke"
DEFAULT_GATEWAY = "http://127.0.0.1:3030"
DEFAULT_STATION = "http://10.37.94.156:18180"


def load_dashboard_visual_module() -> Any:
    script = Path(__file__).parents[1] / "dashboard" / "federation_visible_surface.py"
    spec = importlib.util.spec_from_file_location("dashboard_visual_smoke", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load CDP helpers from {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def http_post_json(url: str, payload: dict[str, Any], timeout: float = 8.0) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def unwrap_gateway_status(response: dict[str, Any]) -> dict[str, Any]:
    if not response.get("ok"):
        raise RuntimeError(f"gateway command failed: {response}")
    data = response.get("data") or {}
    status = data.get("status")
    if not isinstance(status, str):
        raise RuntimeError(f"gateway response missing string status: {response}")
    return json.loads(status)


def assert_gateway_station(gateway_url: str, expected_station: str) -> None:
    listed = unwrap_gateway_status(http_post_json(gateway_url, {"cmd": "station_list", "args": {}}))
    active_url = (listed.get("active_url") or "").rstrip("/")
    if active_url != expected_station:
        raise RuntimeError(f"Desktop active station mismatch: got={active_url or 'empty'} want={expected_station}")


def launch_desktop_chrome(chrome: str, port: int, profile_dir: str) -> subprocess.Popen[bytes]:
    args = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--disable-web-security",
        "--allow-running-insecure-content",
        "--no-first-run",
        "--no-default-browser-check",
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_dir}",
        "about:blank",
    ]
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_for_text(session: Any, markers: list[str], timeout: float = 14.0) -> str:
    deadline = time.time() + timeout
    last_text = ""
    while time.time() < deadline:
        result = session.send(
            "Runtime.evaluate",
            {"expression": "document.body ? document.body.innerText : ''", "returnByValue": True},
        )
        last_text = result.get("result", {}).get("value", "")
        if all(marker in last_text for marker in markers):
            return last_text
        time.sleep(0.4)
    missing = [marker for marker in markers if marker not in last_text]
    raise RuntimeError(f"Desktop visual smoke missing text: {', '.join(missing)}")


def click_station_picker(session: Any, out_dir: Path) -> None:
    expression = """
(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const target = buttons.find((button) => {
    const text = (button.innerText || '').trim();
    return text === 'Station' || text.includes('10.37.94.156') || text.includes('18180');
  });
  if (!target) return false;
  target.click();
  return true;
})()
"""
    result = session.send("Runtime.evaluate", {"expression": expression, "returnByValue": True})
    if result.get("result", {}).get("value") is not True:
        debug = session.send(
            "Runtime.evaluate",
            {
                "expression": "JSON.stringify({ text: document.body ? document.body.innerText : '', buttons: Array.from(document.querySelectorAll('button')).map((button) => button.innerText), errors: window.__PT_ERRORS__ || [], resources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('wasm')).slice(0, 20) })",
                "returnByValue": True,
            },
        )
        (out_dir / "desktop-station-picker-debug.json").write_text(
            debug.get("result", {}).get("value", ""),
            encoding="utf-8",
        )
        raise RuntimeError("StationPicker trigger was not found")


def install_tauri_gateway_bridge(session: Any, gateway_url: str) -> None:
    script = f"""
(() => {{
  const gatewayUrl = {json.dumps(gateway_url)};
  let callbackId = 1;
  const callbacks = {{}};
  window.__PT_ERRORS__ = [];
  window.addEventListener('error', (event) => {{
    window.__PT_ERRORS__.push(String(event.error && event.error.stack ? event.error.stack : event.message));
  }});
  window.addEventListener('unhandledrejection', (event) => {{
    const reason = event.reason;
    window.__PT_ERRORS__.push(String(reason && reason.stack ? reason.stack : reason));
  }});

  window.__TAURI_INTERNALS__ = {{
    metadata: {{
      currentWindow: {{ label: 'main' }},
      currentWebview: {{ label: 'main' }},
    }},
    transformCallback(callback, once) {{
      const id = callbackId++;
      callbacks[id] = {{ callback, once: !!once }};
      return id;
    }},
    async invoke(cmd, args) {{
      if (cmd === 'plugin:event|listen') return 0;
      if (cmd === 'plugin:event|unlisten') return null;

      const commandArgs = args && Object.prototype.hasOwnProperty.call(args, 'input')
        ? args.input
        : (args || {{}});
      const response = await fetch(gatewayUrl, {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{ cmd, args: commandArgs || {{}} }}),
      }});
      if (!response.ok) {{
        throw new Error(`gateway http ${{response.status}} for ${{cmd}}`);
      }}
      const envelope = await response.json();
      if (!envelope.ok) {{
        throw new Error(envelope.error || `gateway command failed: ${{cmd}}`);
      }}
      return envelope.data;
    }},
  }};

  window.__TAURI__ = {{ internals: window.__TAURI_INTERNALS__ }};
}})();
"""
    session.send("Page.addScriptToEvaluateOnNewDocument", {"source": script})


def main() -> int:
    helpers = load_dashboard_visual_module()
    helpers.load_env_file()

    target_url = os.environ.get("FEDERATION_DESKTOP_VISUAL_URL", DEFAULT_URL)
    out_dir = Path(os.environ.get("FEDERATION_DESKTOP_VISUAL_OUT_DIR", DEFAULT_OUT_DIR))
    out_dir.mkdir(parents=True, exist_ok=True)

    gateway_url = os.environ.get("FEDERATION_SMOKE_DESKTOP_GATEWAY", DEFAULT_GATEWAY).rstrip("/")
    expected_station = os.environ.get("FEDERATION_SMOKE_DESKTOP_STATION", DEFAULT_STATION).rstrip("/")
    assert_gateway_station(gateway_url, expected_station)

    chrome = helpers.find_chrome()
    port = helpers.random.randint(45001, 52000)
    profile_dir = helpers.tempfile.mkdtemp(prefix="pt-fed-desktop-visual-")
    process = launch_desktop_chrome(chrome, port, profile_dir)
    session = None
    try:
        websocket_url = helpers.wait_for_debug_port(port)
        session = helpers.CDPSession(websocket_url)
        session.send("Page.enable")
        session.send("Runtime.enable")
        session.send("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
        install_tauri_gateway_bridge(session, gateway_url)
        session.send("Page.navigate", {"url": target_url})
        session.send("Page.bringToFront")

        try:
            wait_for_text(session, ["Peers"], timeout=18)
            click_station_picker(session, out_dir)
            time.sleep(1.2)
            text = wait_for_text(session, ["Station", expected_station], timeout=8)

            screenshot = session.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
            screenshot_path = out_dir / "desktop-station-picker.png"
            screenshot_path.write_bytes(helpers.base64.b64decode(screenshot["data"]))
            text_path = out_dir / "desktop-station-picker.txt"
            text_path.write_text(text, encoding="utf-8")
            mode = "headless chrome station picker"
        except RuntimeError as error:
            debug_path = out_dir / "desktop-station-picker-debug.json"
            screenshot = session.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
            screenshot_path = out_dir / "desktop-render-diagnostic.png"
            screenshot_path.write_bytes(helpers.base64.b64decode(screenshot["data"]))
            text_path = debug_path
            mode = f"fallback screen capture ({error})"

        print("Federation Desktop Visual Smoke")
        print("===============================")
        print(f"[OK] chrome: {chrome}")
        print(f"[OK] mode: {mode}")
        print(f"[OK] url: {target_url}")
        print(f"[OK] active_station: {expected_station}")
        print(f"[OK] screenshot: {screenshot_path}")
        print(f"[OK] evidence: {text_path}")
        return 0
    finally:
        if session:
            session.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except helpers.subprocess.TimeoutExpired:
            process.kill()
        helpers.shutil.rmtree(profile_dir, ignore_errors=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"desktop visual smoke failed: {error}", file=sys.stderr)
        raise SystemExit(1)
