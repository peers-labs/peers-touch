"""Execute locked Tauri drag.js on production header DOM fixtures.

This is browser hit-testing/command evidence, not physical NSWindow movement.
Export fixtures with WindowDragRegion.test.tsx. Requires Python Playwright.
"""
import argparse
import hashlib
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def dispatch(page, selector, event_type, button=0, detail=1, x=30, y=30):
    locator = page.locator(selector).first
    assert locator.count(), f"Missing target: {selector}"
    return locator.evaluate("""(el, data) => {
        const event = new MouseEvent(data.type, {
            bubbles: true, composed: true, cancelable: true,
            button: data.button, detail: data.detail, clientX: data.x, clientY: data.y
        });
        el.dispatchEvent(event);
        return event.defaultPrevented;
    }""", {"type": event_type, "button": button, "detail": detail, "x": x, "y": y})


def check(page, selector, draggable, os_name):
    page.evaluate("window.dragCommands = []")
    prevented = dispatch(page, selector, "mousedown")
    commands = page.evaluate("window.dragCommands")
    assert commands == (["plugin:window|start_dragging"] if draggable else []), (selector, commands)
    assert prevented == draggable, (selector, "default event consumed")
    page.evaluate("window.dragCommands = []")
    dispatch(page, selector, "mousedown", detail=2)
    dispatch(page, selector, "mouseup", detail=2)
    commands = page.evaluate("window.dragCommands")
    assert commands == (["plugin:window|internal_toggle_maximize"] if draggable else []), (selector, commands)
    page.evaluate("window.dragCommands = []")
    dispatch(page, selector, "mousedown", button=2)
    assert page.evaluate("window.dragCommands") == [], (selector, "right click")
    if draggable and os_name == "macos":
        dispatch(page, selector, "mousedown", detail=2)
        dispatch(page, selector, "mouseup", detail=2, x=31)
        assert page.evaluate("window.dragCommands") == [], (selector, "moved double click")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--tauri-script", type=Path, required=True)
    parser.add_argument("--browser", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    fixture_data = json.loads(args.fixtures.read_text())
    assert fixture_data["fixtures"], "No rendered fixtures"
    script = args.tauri_script.read_text()
    repo = Path(__file__).resolve().parents[3]
    for relative, digest in fixture_data["sources"].items():
        current = hashlib.sha256((repo / relative).read_bytes()).hexdigest()
        assert current == digest, f"Fixture is stale: {relative}"
    cargo_lock = (repo / "apps/desktop/src-tauri/Cargo.lock").read_text()
    version = cargo_lock.split('name = "tauri"\nversion = "', 1)[1].split('"', 1)[0]
    assert args.tauri_script.parents[3].name == f"tauri-{version}", "Wrong Tauri drag script"
    observations = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=args.browser)
        try:
            for os_name in ("macos", "windows", "linux"):
                for width in (1200, 760):
                    page = browser.new_page(viewport={"width": width, "height": 850})
                    try:
                        for fixture in fixture_data["fixtures"]:
                            page.set_content(fixture["html"])
                            page.evaluate("""window.dragCommands = [];
                                window.__TAURI_INTERNALS__ = {
                                    invoke: command => { window.dragCommands.push(command); return Promise.resolve(); }
                                };""")
                            page.add_script_tag(content=script.replace("__TEMPLATE_os_name__", json.dumps(os_name)))
                            for selector in fixture["drag"]:
                                check(page, selector, True, os_name)
                            for selector in fixture["controls"]:
                                check(page, selector, False, os_name)
                            observations.append({"fixture": fixture["name"], "os": os_name, "width": width,
                                                 "dragTargets": len(fixture["drag"]),
                                                 "excludedTargets": len(fixture["controls"]), "result": "PASS"})
                    finally:
                        page.close()
        finally:
            browser.close()
    args.output.write_text(json.dumps({
        "evidenceClass": "browser-native-script-contract",
        "physicalWindowMovement": "NOT RUN",
        "tauriVersion": version,
        "scriptSha256": hashlib.sha256(args.tauri_script.read_bytes()).hexdigest(),
        "sources": fixture_data["sources"], "observations": observations,
    }, indent=2))
    print(f"PASS: {len(observations)} fixture/platform/width combinations")


if __name__ == "__main__":
    main()
