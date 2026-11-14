#!/usr/bin/env python3
"""Call overlay evidence on the ONE product surface (ma-call).

Drives the real product call lifecycle from a thread header. An outgoing call
has NO caller accept tile — "接听" is incoming-only — so the single pre-answer
control is a red cancel, and the call auto-connects outgoing → connecting →
active on the same timers as the desktop CallOverlay. Then mute / camera →
end, asserting containment in the device, ≥44px controls and no overflow.

PROTOTYPE_URL=http://localhost:3108 python3 scripts/check-call-states.py
"""
import json
import os
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE_URL = os.environ.get("PROTOTYPE_URL", "http://localhost:3108").rstrip("/")
PACKAGE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = PACKAGE_ROOT.parents[3]
EVIDENCE_ROOT = Path(os.environ.get(
    "PROTOTYPE_EVIDENCE_DIR",
    REPO_ROOT / "apps/mobile/src-tauri/target/prototype-call-states",
))


def assert_surface(page: Page, expected: str) -> dict:
    evidence = page.evaluate(
        """() => {
          const surface = document.querySelector('[data-call-state]');
          const device = document.querySelector('.mp-device-screen');
          if (!surface || !device) return null;
          const a = surface.getBoundingClientRect(), d = device.getBoundingClientRect();
          const controls = [...surface.querySelectorAll('.pt-call-control')].map(tile => {
            const icon = tile.querySelector('.pt-call-control-button').getBoundingClientRect();
            const label = tile.querySelector('.pt-call-control-label').getBoundingClientRect();
            return {
              label: tile.querySelector('.pt-call-control-button').getAttribute('aria-label'),
              width: icon.width, height: icon.height,
              // Every dial tile, including its caption, must clear the device
              // screen bottom edge — a clipped 挂断/静音 tile is the regression
              // this guard exists to catch.
              iconBottomGap: d.bottom - icon.bottom,
              labelBottomGap: d.bottom - label.bottom,
            };
          });
          return {
            state: surface.getAttribute('data-call-state'),
            contained: a.left >= d.left - 1 && a.top >= d.top - 1 &&
                       a.right <= d.right + 1 && a.bottom <= d.bottom + 1,
            overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            controls,
          };
        }"""
    )
    assert evidence is not None, f"{expected}: call surface missing"
    assert evidence["state"] == expected, evidence
    assert evidence["contained"], evidence
    assert not evidence["overflowX"], evidence
    assert all(c["width"] >= 44 and c["height"] >= 44 for c in evidence["controls"]), evidence
    assert all(c["iconBottomGap"] >= 24 and c["labelBottomGap"] >= 8
               for c in evidence["controls"]), evidence
    return evidence


def enter_thread_start_call(page: Page, media: str) -> None:
    page.goto(f"{BASE_URL}/?scenario=default", wait_until="networkidle")
    page.locator("[aria-label='Mobile device preview']").wait_for()
    page.locator(".ma-conv-item").first.click()
    page.wait_for_timeout(400)
    page.get_by_role("button", name="视频通话" if media == "video" else "语音通话").click()
    page.wait_for_timeout(400)


def main() -> None:
    EVIDENCE_ROOT.mkdir(parents=True, exist_ok=True)
    report = {"states": {}, "interactions": [], "consoleErrors": [], "pageErrors": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 430, "height": 932})
        page.on("console", lambda m: report["consoleErrors"].append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: report["pageErrors"].append(str(e)))

        # Audio: the caller surface never shows an accept tile — the only
        # pre-answer control is a red cancel — and the call then auto-connects
        # outgoing -> connecting -> active without any caller tap.
        enter_thread_start_call(page, "audio")
        outgoing = assert_surface(page, "outgoing")
        assert page.get_by_role("button", name="接听").count() == 0, \
            "outgoing caller surface must not expose an accept tile"
        assert [c["label"] for c in outgoing["controls"]] == ["取消"], outgoing
        page.wait_for_selector('[data-call-state="connecting"]', timeout=3000)
        report["states"]["connecting-audio"] = assert_surface(page, "connecting")
        page.wait_for_selector('[data-call-state="active"]', timeout=3000)
        report["states"]["active-audio"] = assert_surface(page, "active")
        page.get_by_role("button", name="静音").click()
        page.wait_for_timeout(150)
        assert page.get_by_role("button", name="取消静音").get_attribute("aria-pressed") == "true"
        page.screenshot(path=str(EVIDENCE_ROOT / "430-active-audio.png"))
        page.get_by_role("button", name="挂断").click()
        page.wait_for_timeout(300)
        assert page.locator("[data-call-state]").count() == 0
        report["interactions"].append("audio outgoing(no accept) -> auto connect -> mute -> end")

        # Video: same auto-answer path; the camera toggle flips pressed state.
        enter_thread_start_call(page, "video")
        assert page.get_by_role("button", name="接听").count() == 0, \
            "outgoing caller surface must not expose an accept tile"
        assert_surface(page, "outgoing")
        page.wait_for_selector('[data-call-state="connecting"]', timeout=3000)
        assert_surface(page, "connecting")
        page.wait_for_selector('[data-call-state="active"]', timeout=3000)
        assert_surface(page, "active")
        page.get_by_role("button", name="关闭摄像头").click()
        page.wait_for_timeout(150)
        assert page.get_by_role("button", name="开启摄像头").get_attribute("aria-pressed") == "true"
        page.screenshot(path=str(EVIDENCE_ROOT / "430-active-video.png"))
        page.get_by_role("button", name="挂断").click()
        page.wait_for_timeout(300)
        report["interactions"].append("video outgoing(no accept) -> auto connect -> camera off -> end")

        # Outgoing cancel (pre-answer) returns to the thread without an overlay.
        enter_thread_start_call(page, "audio")
        assert_surface(page, "outgoing")
        page.get_by_role("button", name="取消").click()
        page.wait_for_timeout(300)
        assert page.locator("[data-call-state]").count() == 0
        report["interactions"].append("outgoing cancel -> idle")

        browser.close()

    assert report["consoleErrors"] == [], report["consoleErrors"]
    assert report["pageErrors"] == [], report["pageErrors"]
    (EVIDENCE_ROOT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({"status": "passed", "states": list(report["states"]),
                      "interactions": report["interactions"]}, indent=2))


if __name__ == "__main__":
    main()
