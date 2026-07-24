#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parents[1]
HELPER_PATH = REPO / "tooling/acceptance/gates/dashboard/federation_visible_surface.py"
OUTPUT = REPO / "tooling/acceptance/reports/desktop-performance-prod-preview-stable-manual-flush-cdp-snapshot.json"


def load_helpers() -> Any:
    spec = importlib.util.spec_from_file_location("cdp_helpers", HELPER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load CDP helpers from {HELPER_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def page_ws(port: int = 9223, target: str = "localhost:3211") -> str:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5) as response:
        pages = json.loads(response.read().decode("utf-8"))
    for page in pages:
        if page.get("type") == "page" and target in str(page.get("url")):
            return str(page["webSocketDebuggerUrl"])
    raise RuntimeError(f"CDP target not found: {[page.get('url') for page in pages]}")


def eval_js(session: Any, expression: str, await_promise: bool = False) -> Any:
    result = session.send(
        "Runtime.evaluate",
        {"expression": expression, "returnByValue": True, "awaitPromise": await_promise},
    )
    if result.get("exceptionDetails"):
        raise RuntimeError(json.dumps(result["exceptionDetails"], ensure_ascii=False))
    return result.get("result", {}).get("value")


def click_selector(session: Any, selector: str) -> dict[str, Any]:
    rect = eval_js(
        session,
        f"""
        (() => {{
          const el = document.querySelector({json.dumps(selector)});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {{
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            width: rect.width,
            height: rect.height,
            text: (el.innerText || el.textContent || '').trim(),
          }};
        }})()
        """,
    )
    if not rect:
        raise RuntimeError(f"missing selector {selector}")
    x = rect["x"]
    y = rect["y"]
    session.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "none"})
    session.send(
        "Input.dispatchMouseEvent",
        {"type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1},
    )
    session.send(
        "Input.dispatchMouseEvent",
        {"type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": 1},
    )
    return rect


def main() -> None:
    helpers = load_helpers()
    session = helpers.CDPSession(page_ws())
    general: dict[str, Any] | None = None
    try:
        session.send("Runtime.enable")
        session.send("Page.enable")
        eval_js(session, "window.__PT_FRONTEND_TELEMETRY__?.clear?.(); 'cleared'")
        time.sleep(2.3)
        try:
            general = click_selector(
                session,
                '[data-pt-secondary-tab-id="general"], [data-pt-secondary-tab="general"]',
            )
            time.sleep(0.7)
            # Let background maintenance settle, then clear immediately before
            # the measured click so no scheduled flush can race the sample.
            time.sleep(2.3)
            eval_js(session, "window.__PT_FRONTEND_TELEMETRY__?.clear?.(); 'cleared-after-general'")
        except Exception as error:  # noqa: BLE001 - record preconditioning failure as evidence.
            general = {"error": str(error)}
        ai = click_selector(session, '[data-pt-secondary-tab-id="ai"], [data-pt-secondary-tab="ai"]')
        time.sleep(0.75)
        value = eval_js(
            session,
            r"""
            (async () => {
              const telemetry = window.__PT_FRONTEND_TELEMETRY__;
              const before = telemetry?.snapshot?.() ?? null;
              let result = null;
              let error = null;
              const attempts = [];
              for (let index = 0; index < 24; index += 1) {
                try {
                  result = await telemetry?.flush?.();
                } catch (err) {
                  error = {
                    name: err?.name || 'Error',
                    message: err?.message || String(err),
                    code: err?.code || null,
                    details: err?.details || null
                  };
                }
                const current = telemetry?.snapshot?.() ?? null;
                attempts.push({
                  index,
                  eventCount: current?.eventCount ?? null,
                  result,
                  error
                });
                if (result || error || (current?.eventCount ?? 0) === 0) break;
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
              const after = telemetry?.snapshot?.() ?? null;
              return {
                href: window.location.href,
                targetInteractionIds: Array.from(new Set((before?.events || []).map((event) => event.interactionId).filter(Boolean))),
                runtimes: Array.from(new Set((before?.events || []).map((event) => event.runtime).filter(Boolean))),
                before,
                flushResult: result,
                flushError: error,
                flushAttempts: attempts,
                after
              };
            })()
            """,
            await_promise=True,
        )
    finally:
        session.close()

    artifact = {
        "artifactKind": "desktop-performance-cdp-stable-manual-flush",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "url": "http://localhost:3211/#/settings",
        "gateway": "http://127.0.0.1:3031",
        "runtimeBoundary": "prod-preview-cdp-with-injected-tauri-bridge-not-native-tauri",
        "generalClick": general,
        "aiClick": ai,
        **value,
    }
    OUTPUT.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    print(OUTPUT)
    print("flushResult=", artifact.get("flushResult"))
    print("flushError=", artifact.get("flushError"))
    print(
        "beforeCount=",
        (artifact.get("before") or {}).get("eventCount"),
        "afterCount=",
        (artifact.get("after") or {}).get("eventCount"),
    )
    print("interactions=", artifact.get("targetInteractionIds"))
    print("runtimes=", artifact.get("runtimes"))


if __name__ == "__main__":
    main()
