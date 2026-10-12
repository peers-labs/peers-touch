#!/usr/bin/env python3
"""Social-chat prototype geometric acceptance gate.

Human eyes judge container *models* (floating island vs grounded bar, crushed
text columns). This script makes those judgments machine-checkable: every
visual change to chat/composer/contacts must land with these rect-level
assertions green — never "it clicks, ship it".

Usage:
    python3 qa/geometry_checks.py [--base-url http://localhost:3107] \
        [--evidence /path/to/evidence]

Requires: playwright + chromium (`python3 -m playwright install chromium`).
Exit code 0 = gate passed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

CHAT_WIDTHS = [640, 682, 720, 753, 760, 780, 820, 900, 1100, 1440, 1600]
KEY_WIDTHS = [682, 753, 900, 1440]
HEIGHT = 885

# ---- rect probes ----------------------------------------------------------------

COMPOSER_PROBE = r"""
() => {
  const ta = document.querySelector('textarea[aria-label="Message composer"],textarea[aria-label="Edit message composer"]');
  if (!ta) return {error: 'no composer'};
  const field = ta.closest('[data-chat-composer-field]');
  const bar = ta.closest('[data-chat-composer-bar]');
  const messages = bar.previousElementSibling;
  const r = el => { const x = el.getBoundingClientRect();
    return {x:Math.round(x.x), y:Math.round(x.y), w:Math.round(x.width), h:Math.round(x.height),
            left:Math.round(x.left), right:Math.round(x.right), top:Math.round(x.top), bottom:Math.round(x.bottom)}; };
  const cs = el => getComputedStyle(el);
  const toolbar = ta.parentElement.querySelector('div:last-child');
  const expand = document.querySelector('button[aria-label="Expand input"],button[aria-label="Collapse input"]');
  const send = document.querySelector('[data-chat-send]');
  const divider = field.querySelector('span[aria-hidden="true"]');
  const pad = (el, side) => parseFloat(cs(el)['padding'+side]);
  const msgPadL = parseFloat(cs(messages).paddingLeft), msgPadR = parseFloat(cs(messages).paddingRight);
  return {
    viewport: {w: innerWidth, h: innerHeight},
    messages: {...r(messages),
               contentLeft: Math.round(messages.getBoundingClientRect().left + msgPadL),
               contentRight: Math.round(messages.getBoundingClientRect().right - msgPadR)},
    bar: {...r(bar), bg: cs(bar).backgroundColor, borderTop: cs(bar).borderTop, shadow: cs(bar).boxShadow},
    field: {...r(field), bg: cs(field).backgroundColor, radius: cs(field).borderRadius, shadow: cs(field).boxShadow},
    textarea: {...r(ta), contentH: Math.round(r(ta).h - pad(ta,'Top') - pad(ta,'Bottom')),
               scrollH: ta.scrollHeight, minH: cs(ta).minHeight, maxH: cs(ta).maxHeight},
    toolbar: {...r(toolbar), h: Math.round(toolbar.getBoundingClientRect().height)},
    expand: expand ? {...r(expand), color: cs(expand).color, pressed: expand.getAttribute('aria-pressed'),
                     label: expand.getAttribute('aria-label')} : null,
    send: send ? {...r(send), bg: cs(send).backgroundColor, disabled: send.disabled} : null,
    divider: divider ? {w: Math.round(divider.getBoundingClientRect().width), h: Math.round(divider.getBoundingClientRect().height)} : null,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}
"""

CONTACTS_PROBE = r"""
() => {
  const out = {viewport:{w:innerWidth,h:innerHeight}};
  const list = document.querySelector('[data-chat-contacts]');
  out.list = list ? (()=>{const r=list.getBoundingClientRect();return{x:Math.round(r.x),w:Math.round(r.width),right:Math.round(r.right)};})() : null;
  out.technicalOpen = !!document.querySelector('[data-chat-contact-technical]');
  out.toggle = !!document.querySelector('[data-chat-contact-technical-toggle]');
  out.docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  // vertical-text sickness: leaf text squeezed under ~5ch
  const sick = [];
  for (const e of document.querySelectorAll('[data-chat-contact-technical] span, [data-chat-contact-technical] .ant-typography')) {
    const t=(e.textContent||'').trim(); if (t.length<4) continue;
    const r=e.getBoundingClientRect();
    if (r.width < 40) sick.push({text:t.slice(0,24), w:Math.round(r.width), h:Math.round(r.height)});
  }
  out.sickTexts = sick;
  // value columns must keep a readable width (>= 8ch monospace ≈ 58px) and ellipsize, never overflow
  const vals = [];
  document.querySelectorAll('[data-chat-contact-technical] span[title]').forEach(e=>{
    if (!e.textContent || !e.textContent.trim()) return;
    const r=e.getBoundingClientRect();
    vals.push({w:Math.round(r.width), overflow: e.scrollWidth - e.clientWidth});
  });
  out.valueCols = vals;
  // hero identity must stay in the upper viewport
  const hero = [...document.querySelectorAll('*')].find(e=>e.children.length===0 && e.textContent.trim()==='Carol');
  if (hero) { const r=hero.getBoundingClientRect(); out.heroTop=Math.round(r.top); }
  // global horizontal overflow offenders
  const over=[];
  for (const e of document.querySelectorAll('*')) {
    if (e.clientWidth>40 && e.scrollWidth > e.clientWidth+1)
      over.push({tag:e.tagName, sw:e.scrollWidth, cw:e.clientWidth});
  }
  out.overflows = over.slice(0,8);
  return out;
}
"""

failures: list[str] = []
passed: list[str] = []

def check(name: str, ok: bool, detail: str = ""):
    (passed if ok else failures).append(f"{name}" + (f" — {detail}" if detail and not ok else ""))

def approx(a, b, tol=2):
    return abs(a - b) <= tol


def assert_composer(p, page, w: int, shot_dir: Path | None):
    page.set_viewport_size({"width": w, "height": HEIGHT})
    page.goto(p.base_url, wait_until="networkidle")
    page.wait_for_timeout(450)
    d = page.evaluate(COMPOSER_PROBE)
    if "error" in d:
        check(f"[{w}] composer present", False, d["error"]); return
    # compact threshold is measured against shell content width (viewport - 56 rail),
    # so the DOM branch flips at viewport 836; assertions key off rendered geometry.
    compact = w - 56 < 780
    tag = f"[chat {w}{' compact' if compact else ''}]"

    frame = 4 if compact else 6
    # Grounded gray writing dock: white bar (hairline top, full column width,
    # flush to window) holds ONE soft-gray dock inset by an EQUAL frame on all
    # four sides; the dock is fully rounded with a hairline border on every edge.
    check(f"{tag} bar flush to viewport bottom", approx(d["bar"]["bottom"], HEIGHT, 1),
          f"bottom={d['bar']['bottom']}")
    check(f"{tag} bar is white chrome", d["bar"]["bg"] == "rgb(255, 255, 255)", d["bar"]["bg"])
    check(f"{tag} bar has hairline top, no elevation",
          d["bar"]["borderTop"].startswith("1px") and d["bar"]["shadow"] == "none",
          f"{d['bar']['borderTop']} / {d['bar']['shadow']}")
    check(f"{tag} bar.left == column left", d["bar"]["left"] == d["messages"]["left"],
          f"{d['bar']['left']} vs {d['messages']['left']}")
    check(f"{tag} bar.right == column right", d["bar"]["right"] == d["messages"]["right"],
          f"{d['bar']['right']} vs {d['messages']['right']}")
    # Equal white frame on all four sides of the gray dock.
    insets = {
        "top": d["field"]["top"] - d["bar"]["top"],
        "right": d["bar"]["right"] - d["field"]["right"],
        "bottom": HEIGHT - d["field"]["bottom"],
        "left": d["field"]["left"] - d["bar"]["left"],
    }
    for side_name, v in insets.items():
        check(f"{tag} dock {side_name} frame == {frame}", approx(v, frame, 1),
              f"got {v} (all four: {insets})")
    check(f"{tag} four-side frames equal (max-min <= 1)",
          max(insets.values()) - min(insets.values()) <= 1,
          f"insets={insets}")
    check(f"{tag} dock soft-gray, fully rounded 12px, hairline border, no resting shadow",
          d["field"]["bg"] == "rgb(245, 245, 245)" and d["field"]["radius"] == "12px"
          and d["field"]["shadow"] == "none",
          f"{d['field']['bg']} {d['field']['radius']} {d['field']['shadow']}")
    # Textarea border box: frame + dock border 1 + dock padding 6 (glyphs sit a
    # further 8px inside via textarea padding).
    ta_inset = frame + 7
    check(f"{tag} textarea left inset == {ta_inset}",
          approx(d["textarea"]["left"] - d["bar"]["left"], ta_inset, 2),
          f"got {d['textarea']['left'] - d['bar']['left']}")
    check(f"{tag} textarea right inset == {ta_inset}",
          approx(d["bar"]["right"] - d["textarea"]["right"], ta_inset, 2),
          f"got {d['bar']['right'] - d['textarea']['right']}")
    check(f"{tag} toolbar bottom inset == frame+4",
          approx(HEIGHT - d["toolbar"]["bottom"], frame + 4, 2),
          f"got {HEIGHT - d['toolbar']['bottom']}")
    # Proportions: comfortable single-line text region, single-row toolbar.
    check(f"{tag} textarea content box >= 32px", d["textarea"]["contentH"] >= 32,
          f"contentH={d['textarea']['contentH']}")
    check(f"{tag} collapsed single-line textarea 40-52", 40 <= d["textarea"]["h"] <= 52,
          f"h={d['textarea']['h']}")
    check(f"{tag} toolbar height == 34", d["toolbar"]["h"] == 34, f"h={d['toolbar']['h']}")
    check(f"{tag} dock height 86-104 (single-line)", 86 <= d["field"]["h"] <= 104,
          f"h={d['field']['h']}")
    # Expand affordance: own hit target + 1px divider, reachable.
    check(f"{tag} expand button 34x34 reachable",
          d["expand"] is not None and d["expand"]["w"] == 34 and d["expand"]["h"] == 34,
          json.dumps(d["expand"]))
    check(f"{tag} divider before expand 1x18",
          d["divider"] is not None and d["divider"]["w"] == 1 and d["divider"]["h"] == 18,
          json.dumps(d["divider"]))
    check(f"{tag} send button 34x34", d["send"]["w"] == 34 and d["send"]["h"] == 34)
    check(f"{tag} no document-level horizontal overflow", d["docOverflow"] <= 0,
          f"overflow={d['docOverflow']}")

    if w in KEY_WIDTHS and shot_dir:
        page.screenshot(path=str(shot_dir / f"composer-final-{w}.png"))

    # Deep interaction (key widths only).
    if w in KEY_WIDTHS:
        ta = page.locator('textarea[aria-label="Message composer"]')
        ta.click()
        page.wait_for_timeout(120)
        f = page.evaluate(COMPOSER_PROBE)
        check(f"{tag} focus reveals brand card ring", f["field"]["shadow"] != "none",
              f["field"]["shadow"])
        ta.fill("line one\nline two\nline three")
        page.wait_for_timeout(150)
        g = page.evaluate(COMPOSER_PROBE)
        check(f"{tag} textarea auto-grows multiline", g["textarea"]["h"] >= d["textarea"]["h"] + 18,
              f"{d['textarea']['h']} -> {g['textarea']['h']}")
        check(f"{tag} send enabled with text", g["send"]["disabled"] is False)
        # Expand must produce an IMMEDIATE height jump even with short content:
        # it raises the min-height to a multi-line writing surface.
        page.get_by_role("button", name="Expand input").click()
        page.wait_for_timeout(150)
        e = page.evaluate(COMPOSER_PROBE)
        check(f"{tag} expand jumps textarea to >= 120px immediately",
              e["textarea"]["h"] >= 120, f"h={e['textarea']['h']}")
        check(f"{tag} expand sets min 132 / max 320",
              e["textarea"]["minH"] == "132px" and e["textarea"]["maxH"] == "320px",
              f"{e['textarea']['minH']} / {e['textarea']['maxH']}")
        check(f"{tag} expand grows the band", e["bar"]["h"] > d["bar"]["h"] + 60,
              f"{d['bar']['h']} -> {e['bar']['h']}")
        if shot_dir:
            page.screenshot(path=str(shot_dir / f"composer-expanded-{w}.png"))
        # Collapse releases the reserved multi-line space; with content cleared
        # it returns to the single-line band (with 3 lines still typed it
        # correctly stays content-tall, which is asserted separately).
        page.get_by_role("button", name="Collapse input").click()
        page.wait_for_timeout(150)
        c1 = page.evaluate(COMPOSER_PROBE)
        check(f"{tag} collapse restores min 44 / max 180",
              c1["textarea"]["minH"] == "44px" and c1["textarea"]["maxH"] == "180px",
              f"{c1['textarea']['minH']} / {c1['textarea']['maxH']}")
        check(f"{tag} collapse never stays reserved-tall with 3 short lines",
              c1["textarea"]["h"] < 120, f"h={c1['textarea']['h']}")
        ta.fill("")
        page.wait_for_timeout(150)
        c = page.evaluate(COMPOSER_PROBE)
        check(f"{tag} collapse restores 40-52 textarea when empty", 40 <= c["textarea"]["h"] <= 52,
              f"h={c['textarea']['h']}")
        if shot_dir:
            page.screenshot(path=str(shot_dir / f"composer-grown-{w}.png"))


def assert_contacts(base_url: str, page, shot_dir: Path | None):
    page.set_viewport_size({"width": 682, "height": 885})
    page.goto(base_url, wait_until="networkidle")
    page.wait_for_timeout(400)
    page.get_by_role("button", name="Contacts").first.click()
    page.wait_for_timeout(400)
    page.get_by_text("Carol", exact=True).first.click()
    page.wait_for_timeout(400)

    d = page.evaluate(CONTACTS_PROBE)
    check("[contacts 682] technical provenance collapsed by default", d["technicalOpen"] is False)
    check("[contacts 682] disclosure toggle present", d["toggle"] is True)
    check("[contacts 682] no document horizontal overflow", d["docOverflow"] <= 0,
          f"overflow={d['docOverflow']} overflows={d['overflows']}")
    check("[contacts 682] hero identity stays on top", d.get("heroTop", 999) < 260,
          f"heroTop={d.get('heroTop')}")
    if shot_dir:
        page.screenshot(path=str(shot_dir / "contacts-final-carol-682-collapsed.png"))
    # List shares the row instead of crushing the detail pane to 0.
    check("[contacts 682] list 240-300px", 240 <= d["list"]["w"] <= 300, json.dumps(d["list"]))
    detail_w = 682 - 56 - d["list"]["w"]
    check("[contacts 682] detail pane >= 330px", detail_w >= 330, f"detail={detail_w}")

    page.locator("[data-chat-contact-technical-toggle]").click()
    page.wait_for_timeout(300)
    d2 = page.evaluate(CONTACTS_PROBE)
    check("[contacts 682] technical opens", d2["technicalOpen"] is True)
    check("[contacts 682] no one-char-per-line text", len(d2["sickTexts"]) == 0,
          json.dumps(d2["sickTexts"]))
    check("[contacts 682] value columns >= 58px (8ch)",
          all(v["w"] >= 58 for v in d2["valueCols"]) and len(d2["valueCols"]) >= 1,
          json.dumps(d2["valueCols"]))
    check("[contacts 682] values ellipsize, never overflow",
          all(v["overflow"] <= 1 for v in d2["valueCols"]), json.dumps(d2["valueCols"]))
    check("[contacts 682] open state still no page overflow", d2["docOverflow"] <= 0,
          f"overflows={d2['overflows']}")
    if shot_dir:
        page.screenshot(path=str(shot_dir / "contacts-final-carol-682-open.png"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:3107")
    ap.add_argument("--evidence", default=None)
    args = ap.parse_args()
    shot_dir = Path(args.evidence) if args.evidence else None
    if shot_dir:
        shot_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(device_scale_factor=2)
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        for w in CHAT_WIDTHS:
            assert_composer(args, page, w, shot_dir)
        assert_contacts(args.base_url, page, shot_dir)

        check("zero console/page errors across run", len(errors) == 0, json.dumps(errors[:5]))
        browser.close()

    print(f"PASS {len(passed)}  FAIL {len(failures)}")
    for f in failures:
        print("  FAIL", f)
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
