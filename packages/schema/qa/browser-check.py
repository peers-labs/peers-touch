"""Bounded real-browser renderer check; no native camera or login claims."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:46971")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.set_default_timeout(10_000)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
            page.goto(args.url)
            page.wait_for_load_state("networkidle")
            page.locator("[data-schema-qr=ready]").wait_for()
            initial_count = int(page.locator("[data-render-count]").inner_text())
            assert initial_count == 1
            page.get_by_role("button", name="Verify PNG, UTF-8 and avatar").click()
            page.locator("output").filter(has_text="PASS").wait_for()
            observations = json.loads(page.locator("[data-cases]").inner_text())
            assert len(observations) == 4
            assert all(row["modulePixels"] >= 3 and row["quietZoneModules"] >= 4 for row in observations)
            assert next(row for row in observations if row["name"] == "avatar")["avatar"]
            assert next(row for row in observations if row["name"] == "peers-3x")["width"] == 960
            assert int(page.locator("[data-render-count]").inner_text()) == initial_count
            page.screenshot(path=str(output / "wide.png"), full_page=True)

            page.get_by_role("button", name="Narrow layout").click()
            page.locator("[data-schema-qr=failed]").wait_for()
            assert page.locator("[data-error]").inner_text() == "PAYLOAD_TOO_DENSE"
            assert page.locator("[data-schema-qr] svg").count() == 0
            page.screenshot(path=str(output / "density-error.png"), full_page=True)
            page.get_by_role("button", name="Wide layout").click()
            page.locator("[data-schema-qr=ready]").wait_for()
            assert int(page.locator("[data-render-count]").inner_text()) == initial_count + 1

            page.get_by_role("button", name="Unmount code").click()
            assert page.locator("[data-schema-qr]").count() == 0
            page.get_by_role("button", name="Mount code").click()
            page.locator("[data-schema-qr=ready]").wait_for()
            assert int(page.locator("[data-render-count]").inner_text()) == initial_count + 2

            page.set_viewport_size({"width": 360, "height": 800})
            page.wait_for_function("""() => {
                const frame = document.querySelector('[data-schema-qr=ready]');
                const svg = frame?.querySelector('svg');
                return frame && svg && Math.abs(frame.getBoundingClientRect().width - svg.getBoundingClientRect().width) <= 1;
            }""")
            geometry = page.locator("[data-schema-qr]").evaluate("""element => {
                const frame = element.getBoundingClientRect();
                const svg = element.querySelector('svg')?.getBoundingClientRect();
                return {frame: frame.width, svg: svg?.width, overflow: document.documentElement.scrollWidth > innerWidth};
            }""")
            assert not geometry["overflow"]
            assert abs(geometry["svg"] - geometry["frame"]) <= 1, geometry
            page.screenshot(path=str(output / "responsive.png"), full_page=True)
            assert errors == [], errors
            report = {"kind": "FUNCTIONAL_CHECK", "scope": "Schema browser renderer",
                      "cases": observations, "geometry": geometry, "errors": errors,
                      "nativeCamera": "UNPROVEN", "deviceLinkJourney": "UNPROVEN"}
            (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps({"result": "PASS", "cases": len(observations), "report": str(output / "report.json")}))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
