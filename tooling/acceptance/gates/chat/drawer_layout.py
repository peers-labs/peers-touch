"""Drawer geometry and input in an already authenticated Native Chat client."""
from __future__ import annotations

from typing import Any

from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.resource_diagnostic import ResourceDiagnostic
from tooling.acceptance.gates.chat.native_support import wait_until

REQUIRED_DRAWER_ASSERTIONS = {
    "drawer_reported_widths_usable", "drawer_compressed_pointer_continuity",
    "drawer_cancel_and_keyboard", "drawer_back_preserves_draft",
}

SNAPSHOT = """
const root = document.querySelector('[data-social-chat-layout]');
if (!root) return null;
const box = e => e.getBoundingClientRect().toJSON();
const cat = root.querySelector('[data-drawer-catalog]');
const handle = root.querySelector('[data-chat-rail-resize]');
const controls = [...root.querySelectorAll('.sc-rail-header button,.sc-chat-head button,.sc-composer button')]
  .filter(e => !e.closest('[inert],[aria-hidden="true"]') && getComputedStyle(e).visibility !== 'hidden'
    && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0)
  .map(e => ({id: e.dataset.actionId || e.getAttribute('aria-label'), box: box(e),
    hit: e.contains(document.elementFromPoint(box(e).x + box(e).width/2, box(e).y + box(e).height/2)),
    disabled: e.disabled || e.getAttribute('aria-disabled') === 'true'}));
return {stage: box(root), catalog: box(cat), handle: box(handle),
  preference: Number(root.dataset.preferredWidth), exposure: Number(root.dataset.catalogExposure),
  navigation: Number(root.dataset.navigationProgress), available: handle.dataset.available,
  paper: root.querySelector('.sc-sessions').getBoundingClientRect().width,
  compact: root.querySelector('.sc-sessions').dataset.railCompact, controls};
"""


def drawer_geometry_valid(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    stage, cat, handle = (value[key] for key in ("stage", "catalog", "handle"))
    return (
        cat["width"] >= 64 and value["available"] == "true"
        and abs(handle["x"] + handle["width"] / 2 - cat["right"]) < .75
        and all(
            (control["hit"] or control["disabled"])
            and control["box"]["left"] >= stage["left"] - .75
            and control["box"]["right"] <= stage["right"] + .75
            and control["box"]["bottom"] <= stage["bottom"] + .75
            for control in value["controls"]
        )
    )


def prove_drawer_layout(gate: Any) -> None:
    """Borrow the existing client, window, send/restart and cleanup lifecycle."""
    client = gate.clients["bob"]
    driver = client.driver
    original = driver.get_window_rect()
    viewport = client.execute_script("return {width: innerWidth, height: innerHeight, scale: devicePixelRatio};")
    scale = viewport["scale"]
    chrome = {axis: original[axis] - round(viewport[axis] * scale) for axis in ("width", "height")}
    evidence: dict[str, Any] = {"inputMode": "semantic-nonintrusive", "frames": [], "pointer": []}
    gate.report.runtime["drawerLayout"] = evidence

    def snapshot():
        return client.execute_script(SNAPSHOT)

    def settled():
        return wait_until(
            lambda: v if (v := snapshot()) and abs(v["paper"] - v["preference"]) < .1 else None,
            "native drawer guide at its intended paper width", timeout=10, interval=.05,
        )

    def resize(width: int, height: int):
        driver.set_window_size(round(width * scale) + chrome["width"], round(height * scale) + chrome["height"])
        wait_until(
            lambda: client.execute_script("return innerWidth === arguments[0] && innerHeight === arguments[1];", width, height),
            f"native {width}x{height} viewport", timeout=10, interval=.05,
        )
        return wait_until(lambda: v if drawer_geometry_valid(v := snapshot()) else None,
                          "native drawer frame and complete controls", timeout=10, interval=.05)

    try:
        handle = client.find_element("[data-chat-rail-resize]")
        # End then a double-click returns to the default through real UI input.
        ActionChains(driver).double_click(handle).perform()
        settled()
        for width in (676, 554):
            v = resize(width, 672)
            evidence["frames"].append(v)
            gate.assert_condition("drawer_reported_widths_usable",
                                  v["catalog"]["width"] >= 200 and v["compact"] == "false",
                                  f"{width}px window: {v}")
            gate.save_screenshot(client, f"drawer-{width}")
        handle = client.find_element("[data-chat-rail-resize]")
        handle.send_keys(Keys.HOME)
        gate.assert_condition("drawer_cancel_and_keyboard", settled()["preference"] == 64)
        handle.send_keys(Keys.ARROW_RIGHT)
        gate.assert_condition("drawer_cancel_and_keyboard", settled()["preference"] == 240)
        ActionChains(driver).double_click(handle).perform()
        settled()
        editor = client.find_element("[data-drawer-work] textarea")
        draft = "Native drawer pressure preserves this draft."
        editor.send_keys(draft)
        handle.send_keys(Keys.ESCAPE)
        closed = wait_until(lambda: v if (v := snapshot()) and v["navigation"] == 0 else None,
                            "native Back restores catalogue", timeout=10, interval=.05)
        evidence["back"] = closed
        gate.assert_condition("drawer_back_preserves_draft",
                              drawer_geometry_valid(closed) and abs(closed["catalog"]["width"] - closed["paper"]) < .75)
        client.semantic_click(client.find_element(".sc-session-row.is-active"))
        wait_until(lambda: (snapshot() or {}).get("navigation") == 1,
                   "native conversation returns", timeout=10, interval=.05)
        retained = client.find_element("[data-drawer-work] textarea").get_attribute("value")
        evidence["draftRetained"] = retained == draft
        gate.assert_condition("drawer_back_preserves_draft", evidence["draftRetained"])
        for width, height in ((390, 320), (554, 320), (676, 420)):
            evidence["frames"].append(resize(width, height))
        for width in (676, 554):
            v = resize(width, 672)
            handle = client.find_element("[data-chat-rail-resize]")
            client.execute_script("""
                const handle = arguments[0], counts = {pointerDown:0, mouseDown:0};
                const pointer = () => counts.pointerDown++;
                const mouse = () => counts.mouseDown++;
                handle.addEventListener('pointerdown', pointer, true);
                handle.addEventListener('mousedown', mouse, true);
                handle.__ptDrawerInputObservation = {counts, close: () => {
                    handle.removeEventListener('pointerdown', pointer, true);
                    handle.removeEventListener('mousedown', mouse, true);
                }};
            """, handle)
            try:
                ActionChains(driver, duration=0).move_to_element(handle).click_and_hold().move_by_offset(-16, 0).perform()
                counts = client.execute_script("return arguments[0].__ptDrawerInputObservation.counts;", handle)
                evidence["driverInput"] = counts
                if counts["pointerDown"] == 0 and counts["mouseDown"] > 0:
                    raise BlockedError(
                        reason="Native WebDriver emitted only MouseEvent for the required pointer gesture",
                        resource="native-drawer-pointer-input",
                        diagnostic=ResourceDiagnostic.observed(
                            owner="native-webdriver", resource="native-drawer-pointer-input",
                            expected={"pointerDown": 1, "captureLifecycle": True},
                            observed=counts,
                            recovery_action="Use a qualified pointer input backend; preserve the resizer's pointer capture and the original gesture assertions.",
                        ),
                    )
            finally:
                client.execute_script("""
                    arguments[0].__ptDrawerInputObservation.close();
                    delete arguments[0].__ptDrawerInputObservation;
                """, handle)
                # The protocol button must be released even if capability
                # observation fails; no system pointer input is posted.
                if evidence.get("driverInput", {}).get("pointerDown") == 0:
                    ActionChains(driver).release().perform()
            moved = wait_until(
                lambda: s if (s := snapshot()) and abs(s["catalog"]["width"] - (v["catalog"]["width"] - 16)) < .75 else None,
                "native compressed boundary follows pointer", timeout=10, interval=.05,
            )
            evidence["pointer"].append({"before": v, "after": moved})
            gate.assert_condition("drawer_compressed_pointer_continuity",
                                  moved["preference"] == v["preference"])
            ActionChains(driver).send_keys(Keys.ESCAPE).release().perform()
            restored = settled()
            gate.assert_condition("drawer_cancel_and_keyboard",
                                  restored["preference"] == v["preference"]
                                  and abs(restored["catalog"]["width"] - v["catalog"]["width"]) < .75)
    finally:
        driver.set_window_rect(**original)
        wait_until(
            lambda: client.execute_script("return innerWidth === arguments[0] && innerHeight === arguments[1];",
                                          viewport["width"], viewport["height"]),
            "native original window bounds restored", timeout=10, interval=.05,
        )
        evidence["windowRestored"] = True
