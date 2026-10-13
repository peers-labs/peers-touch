#!/usr/bin/env python3

import json
import os
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


BASE_URL = os.environ.get("PROTOTYPE_URL", "http://localhost:3109").rstrip("/")
PACKAGE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = PACKAGE_ROOT.parents[3]
EVIDENCE_ROOT = Path(
    os.environ.get(
        "PROTOTYPE_EVIDENCE_DIR",
        REPO_ROOT / "apps" / "mobile" / "src-tauri" / "target"
        / "prototype-call-states",
    )
)

SCENARIOS = (
    "call-outgoing-audio",
    "call-incoming-video",
    "call-active-audio",
    "call-active-video",
    "call-reconnecting",
    "call-handled-elsewhere",
    "call-ended",
)


def state(page: Page) -> str | None:
    return page.locator("[data-prototype-call-state]").get_attribute(
        "data-prototype-call-state"
    )


def assert_layout(page: Page, expected: str) -> dict:
    evidence = page.evaluate(
        """() => {
          const surface = document.querySelector('[data-prototype-call-state]');
          const shell = document.querySelector('.mp-app-shell');
          if (!surface || !shell) return null;
          const surfaceRect = surface.getBoundingClientRect();
          const shellRect = shell.getBoundingClientRect();
          const controls = [...surface.querySelectorAll('.mp-call-control')]
            .map((control) => {
              const rect = control.getBoundingClientRect();
              const icon = control.querySelector('.mp-call-control-icon');
              const iconStyle = icon ? getComputedStyle(icon) : null;
              const iconRect = icon ? icon.getBoundingClientRect() : null;
              return {
                label: control.getAttribute('aria-label'),
                width: rect.width,
                height: rect.height,
                // Icon buttons are rounded-square controls, never circular.
                iconRadius: iconStyle
                  ? Math.round(Number.parseFloat(iconStyle.borderTopLeftRadius))
                  : null,
                iconSize: iconRect ? Math.round(iconRect.width) : null,
              };
            });
          return {
            state: surface.getAttribute('data-prototype-call-state'),
            label: surface.getAttribute('aria-label'),
            text: surface.textContent.trim().replace(/\\s+/g, ' '),
            overflowX: document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
            contained:
              surfaceRect.left >= shellRect.left &&
              surfaceRect.top >= shellRect.top &&
              surfaceRect.right <= shellRect.right &&
              surfaceRect.bottom <= shellRect.bottom,
            controls,
          };
        }"""
    )
    assert evidence is not None, f"{expected}: call surface missing"
    assert evidence["state"] == expected, evidence
    assert not evidence["overflowX"], evidence
    assert evidence["contained"], evidence
    assert all(
        control["width"] >= 44 and control["height"] >= 44
        for control in evidence["controls"]
    ), evidence
    for control in evidence["controls"]:
        if control["iconRadius"] is None or control["iconSize"] is None:
            continue
        assert (
            control["iconRadius"] == 12
            and control["iconRadius"] < control["iconSize"] / 2 - 1
        ), (
            f'{expected}: call control {control["label"]!r} must be a '
            f'rounded-square icon button, got radius '
            f'{control["iconRadius"]} / size {control["iconSize"]}'
        )
    return evidence


def open_scenario(page: Page, scenario: str) -> dict:
    page.goto(f"{BASE_URL}/?scenario={scenario}", wait_until="networkidle")
    page.locator("[data-prototype-call-state]").wait_for(state="visible")
    expected = {
        "call-outgoing-audio": "outgoing",
        "call-incoming-video": "incoming",
        "call-active-audio": "active_here",
        "call-active-video": "active_here",
        "call-reconnecting": "reconnecting",
        "call-handled-elsewhere": "handled_elsewhere",
        "call-ended": "ended",
    }[scenario]
    return assert_layout(page, expected)


def main() -> None:
    EVIDENCE_ROOT.mkdir(parents=True, exist_ok=True)
    report = {
        "baseUrl": BASE_URL,
        "screenshots": [],
        "states": {},
        "interactions": [],
        "consoleErrors": [],
        "consoleWarnings": [],
        "pageErrors": [],
    }

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 430, "height": 932})

        def record_console(message) -> None:
            if message.type != "error":
                return
            if "[antd: List] The `List` component is deprecated" in message.text:
                report["consoleWarnings"].append(message.text)
                return
            report["consoleErrors"].append(message.text)

        page.on("console", record_console)
        page.on("pageerror", lambda error: report["pageErrors"].append(str(error)))

        for scenario in SCENARIOS:
            report["states"][scenario] = open_scenario(page, scenario)
            screenshot = EVIDENCE_ROOT / f"430-{scenario}.png"
            page.screenshot(path=screenshot, full_page=True)
            report["screenshots"].append(str(screenshot))

        open_scenario(page, "call-outgoing-audio")
        page.get_by_role("button", name="Cancel").click()
        assert state(page) == "ended"
        report["interactions"].append("outgoing -> cancel -> ended")

        open_scenario(page, "call-incoming-video")
        assert page.evaluate(
            "() => document.activeElement?.getAttribute('aria-label')"
        ) == "Accept"
        page.get_by_role("button", name="Accept").click()
        assert state(page) == "active_here"
        assert page.evaluate(
            "() => document.activeElement?.getAttribute('aria-label')"
        ) == "Mute"
        page.get_by_role("button", name="Mute").click()
        page.get_by_role("button", name="Turn camera off").click()
        assert page.get_by_role("button", name="Unmute").get_attribute(
            "aria-pressed"
        ) == "true"
        assert page.get_by_role("button", name="Turn camera on").get_attribute(
            "aria-pressed"
        ) == "true"
        accepted = EVIDENCE_ROOT / "430-incoming-accepted-controls.png"
        page.screenshot(path=accepted, full_page=True)
        report["screenshots"].append(str(accepted))
        page.get_by_role("button", name="End call").click()
        assert state(page) == "ended"
        report["interactions"].append(
            "incoming video -> accept -> mute/camera off -> end"
        )

        open_scenario(page, "call-handled-elsewhere")
        page.get_by_role("button", name="Close").click()
        assert page.locator("[data-prototype-call-state]").count() == 0
        report["interactions"].append("handled_elsewhere -> close")

        page.goto(f"{BASE_URL}/?scenario=journey", wait_until="networkidle")
        page.get_by_role("button", name="Continue", exact=True).click()
        page.get_by_role("button", name="Email Login").click()
        page.get_by_role("button", name="Sign In", exact=True).click()
        page.get_by_role("heading", name="Chats").wait_for(state="visible")
        page.locator(".mp-conversation-item").filter(has_text="Alice Chen").click()
        page.get_by_role("button", name="Start audio call").click()
        assert_layout(page, "outgoing")
        header_action = EVIDENCE_ROOT / "430-direct-header-start-audio.png"
        page.screenshot(path=header_action, full_page=True)
        report["screenshots"].append(str(header_action))
        report["interactions"].append(
            "journey -> Direct conversation -> header audio action -> outgoing"
        )

        page.set_viewport_size({"width": 1440, "height": 1100})
        open_scenario(page, "call-active-video")
        wide = EVIDENCE_ROOT / "1440-call-active-video.png"
        page.screenshot(path=wide, full_page=True)
        report["screenshots"].append(str(wide))

        browser.close()

    assert report["consoleErrors"] == [], report["consoleErrors"]
    assert report["pageErrors"] == [], report["pageErrors"]
    report_path = EVIDENCE_ROOT / "report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({
        "status": "passed",
        "report": str(report_path),
        "screenshots": len(report["screenshots"]),
        "states": len(report["states"]),
        "interactions": report["interactions"],
    }, indent=2))


if __name__ == "__main__":
    main()
