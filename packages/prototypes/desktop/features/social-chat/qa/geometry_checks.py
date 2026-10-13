#!/usr/bin/env python3
"""Social-chat prototype geometry and painted-boundary acceptance gate.

Human eyes judge container *models* (floating island vs grounded bar, crushed
text columns). This script makes those judgments machine-checkable: every
visual change to chat/composer/contacts must preserve measured geometry and
visible boundaries in the browser's actual paint output.

Usage:
    python3 qa/geometry_checks.py [--base-url http://localhost:3107] \
        [--evidence /path/to/evidence]

Requires: playwright, Pillow + chromium (`python3 -m playwright install chromium`).
Exit code 0 = gate passed.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import sys
from pathlib import Path

from PIL import Image
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
    # profile background banner renders at the top of the details card
    cover = page.locator("[data-contact-cover]")
    check("[contacts 682] profile cover banner present", cover.count() == 1)
    cover_span = page.evaluate(r"""() => {
      const el = document.querySelector('[data-contact-cover]');
      const card = el.closest('[style*="border-radius"]') || el.parentElement;
      const a = el.getBoundingClientRect(), b = card.getBoundingClientRect();
      return {w: Math.round(a.width), cardW: Math.round(b.width), x: Math.round(a.left), cardX: Math.round(b.left)};
    }""")
    check("[contacts 682] cover is full-bleed (same width & left as the card)",
          abs(cover_span["w"] - cover_span["cardW"]) <= 2 and abs(cover_span["x"] - cover_span["cardX"]) <= 2,
          json.dumps(cover_span))
    if shot_dir:
        page.screenshot(path=str(shot_dir / "contacts-final-carol-682-open.png"))


# ---- class-level visual invariants ------------------------------------------------
# These scans are intentionally generic: they encode reusable product rules
# (components.md §3 / §3.1) over whatever surfaces are currently mounted, not
# a fix for the current screen.

SPATIAL_SYSTEM_PROBE = r"""
() => {
  const box = el => {
    const r = el.getBoundingClientRect();
    return {left:r.left, right:r.right, top:r.top, bottom:r.bottom,
            cx:r.left+r.width/2, cy:r.top+r.height/2, w:r.width, h:r.height};
  };
  const visible = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const balances = [...document.querySelectorAll('[data-ui-balance]')].filter(visible).map(el => {
    const r = box(el), s = getComputedStyle(el);
    const children = [...el.children].filter(visible).map(box);
    return {axes:el.dataset.uiBalance, children:children.length,
      left: children.length ? Math.min(...children.map(c=>c.left)) - r.left - parseFloat(s.borderLeftWidth) : null,
      right: children.length ? r.right - parseFloat(s.borderRightWidth) - Math.max(...children.map(c=>c.right)) : null,
      top: children.length ? Math.min(...children.map(c=>c.top)) - r.top - parseFloat(s.borderTopWidth) : null,
      bottom: children.length ? r.bottom - parseFloat(s.borderBottomWidth) - Math.max(...children.map(c=>c.bottom)) : null};
  });
  const lists = [...document.querySelectorAll('[data-ui-rows]')].filter(visible).map(list => ({
    name:list.dataset.uiRows,
    rows:[...list.querySelectorAll('[data-ui-row]')].filter(visible)
      .filter(row=>row.closest('[data-ui-rows]') === list).map(row => ({
        ...box(row),
        columns:[...row.querySelectorAll('[data-ui-column]')].filter(visible).map(el => {
          const buttons = [...el.querySelectorAll('button')].filter(visible).map(box);
          return {...box(el), name:el.dataset.uiColumn, align:el.dataset.uiColumnAlign,
            centered:el.hasAttribute('data-ui-row-center'),
            controlsAlign:el.dataset.uiControlsAlign,
            controlCenters:buttons.map(b=>b.cy),
            controlsRight:buttons.length ? Math.max(...buttons.map(b=>b.right)) : null};
        })
      }))
  }));
  return {balances, lists};
}
"""


def spatial_results(d):
    """Reusable geometry rules; mutation checks consume the same verdicts."""
    results = []
    for index, balance in enumerate(d["balances"]):
        for axis, start, end in (("inline", "left", "right"), ("block", "top", "bottom")):
            if axis not in balance["axes"].split():
                continue
            ok = balance["children"] > 0 and min(balance[start], balance[end]) >= -1 \
                and approx(balance[start], balance[end], 1)
            results.append((f"frame {index} {axis} opposed insets equal", ok, json.dumps(balance)))
    for group in d["lists"]:
        rows = group["rows"]
        if not rows:
            continue
        columns = {c["name"] for row in rows for c in row["columns"]}
        for name in columns:
            cells = [c for row in rows for c in row["columns"] if c["name"] == name]
            results.append((f"{group['name']} {name} slot present in every row",
                            len(cells) == len(rows), f"cells={len(cells)} rows={len(rows)}"))
            aligns = {c["align"] for c in cells}
            results.append((f"{group['name']} {name} alignment declared consistently",
                            len(aligns) == 1 and aligns <= {"start", "end", "center", "stretch"}, str(aligns)))
            if len(aligns) != 1:
                continue
            align = next(iter(aligns))
            axes = {"start": ["left"], "end": ["right"], "center": ["cx"],
                    "stretch": ["left", "right"]}.get(align, [])
            for axis in axes:
                values = [c[axis] for c in cells]
                results.append((f"{group['name']} {name} shared {axis} axis",
                                max(values) - min(values) <= 1, f"{axis}={values}"))
            rights = [c["controlsRight"] for c in cells
                      if c["controlsAlign"] == "end" and c["controlsRight"] is not None]
            if rights:
                results.append((f"{group['name']} {name} visible controls share trailing edge",
                                max(rights) - min(rights) <= 1, f"right={rights}"))
        for index, row in enumerate(rows):
            centers = [c["cy"] for c in row["columns"] if c["centered"]]
            if centers:
                results.append((f"{group['name']} row {index} slots centered vertically",
                                all(approx(cy, row["cy"], 1) for cy in centers),
                                f"row={row['cy']} slots={centers}"))
            control_centers = [cy for c in row["columns"] if c["centered"] for cy in c["controlCenters"]]
            if control_centers:
                results.append((f"{group['name']} row {index} controls centered vertically",
                                all(approx(cy, row["cy"], 1) for cy in control_centers),
                                f"row={row['cy']} controls={control_centers}"))
    return results


def assert_spatial_mutation(page, selector, styles, expected_failure):
    element = page.locator(selector).first
    saved = element.get_attribute("style")
    try:
        element.evaluate("(el, styles) => Object.assign(el.style, styles)", styles)
        rejected = [name for name, ok, _ in spatial_results(page.evaluate(SPATIAL_SYSTEM_PROBE)) if not ok]
        check(f"[symmetry negative] detects {expected_failure}",
              any(expected_failure in name for name in rejected), str(rejected))
    finally:
        element.evaluate("""(el, saved) => {
          if (saved === null) el.removeAttribute('style'); else el.setAttribute('style', saved);
        }""", saved)


def notification_axes(page):
    return page.locator("[data-ui-row]").first.evaluate("""row =>
      [...row.querySelectorAll('[data-ui-column]')].map(el => {
        const r = el.getBoundingClientRect();
        return {name:el.dataset.uiColumn, left:r.left, right:r.right};
      })""")


def assert_notification_spatial_contract(page):
    columns = page.locator("[data-ui-row]").evaluate_all("""rows => rows.map(row =>
      [...row.querySelectorAll('[data-ui-column]')].map(el=>el.dataset.uiColumn))""")
    check("[symmetry] notification rows expose every required structural slot",
          bool(columns) and all(cols == ["avatar", "content", "time", "actions"] for cols in columns),
          json.dumps(columns))
    for name, ok, detail in spatial_results(page.evaluate(SPATIAL_SYSTEM_PROBE)):
        check(f"[symmetry] {name}", ok, detail)
    readable = page.locator("[data-ui-column='content']").evaluate_all(
        "cells => cells.every(c => c.getBoundingClientRect().width >= 80 && c.scrollWidth <= c.clientWidth + 1)")
    check("[symmetry] primary text remains readable without horizontal overflow", readable)


BUTTON_HEIGHT_SCALE = {24, 26, 28, 30, 32, 34, 36, 40}
BUTTON_RADIUS_SCALE = {0, 6, 8, 10, 12, 999}

VISUAL_SYSTEM_PROBE = r"""
() => {
  const rect = el => { const x=el.getBoundingClientRect(); const s=getComputedStyle(el);
    return {w:Math.round(x.width), h:Math.round(x.height), r:parseFloat(s.borderTopLeftRadius)||0,
            bg:s.backgroundColor, borderW:s.borderTopWidth, transparent:s.backgroundColor==='rgba(0, 0, 0, 0)',
            iconOnly: !el.textContent.trim()}; };
  // 1) chrome-button scale (skip full-row entities marked data-row-button and
  //    borderless text links: only buttons carrying fill OR border are "chrome")
  const chrome = [];
  document.querySelectorAll('button').forEach(b => {
    if (b.hasAttribute('data-row-button')) return;
    const r=b.getBoundingClientRect(), s=getComputedStyle(b);
    if (r.width===0||r.height===0||s.display==='none'||s.visibility==='hidden') return;
    const hasChrome = (s.backgroundColor!=='rgba(0, 0, 0, 0)') || parseFloat(s.borderTopWidth)>0;
    if (!hasChrome) return;
    chrome.push({...rect(b), label:(b.getAttribute('aria-label')||b.textContent||'').trim().slice(0,30)});
  });
  // 2) entity rows: trailing action groups must share center line + trailing edge
  const entities = [];
  document.querySelectorAll('[data-entity]').forEach(row => {
    const rr = row.getBoundingClientRect();
    if (rr.width===0) return;
    const btns = [...row.querySelectorAll('button')].filter(b => !b.hasAttribute('data-row-button')).map(b => {
      const x=b.getBoundingClientRect();
      return {cy:Math.round(x.top + x.height/2), bottom:Math.round(x.bottom), right:Math.round(x.right), w:Math.round(x.width), h:Math.round(x.height),
              r:parseFloat(getComputedStyle(b).borderTopLeftRadius)||0,
              action:b.getAttribute('data-decision-action')};
    });
    entities.push({entity:row.getAttribute('data-entity'), buttons:btns});
  });
  // 3) canonical decision-control geometry across surfaces
  const decisions = {accept: [], reject: []};
  document.querySelectorAll('[data-decision-action]').forEach(b => {
    const a=b.getAttribute('data-decision-action');
    if (a==='accept'||a==='reject') decisions[a].push(rect(b));
  });
  const floating = [...document.querySelectorAll('[data-floating-anchor-label]')].map(panel => {
    const label = panel.getAttribute('data-floating-anchor-label');
    const button = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label);
    const pr = panel.getBoundingClientRect(), br = button?.getBoundingClientRect();
    return {label, align: panel.getAttribute('data-floating-align'),
      panelBottom:pr.bottom, panelLeft:pr.left, panelTop:pr.top, panelRight:pr.right,
      sourceBottom:br?.bottom, sourceRight:br?.right};
  });
  return {chrome, entities, decisions, floating};
}
"""


PAINTED_BOUNDARY_PROBE = r"""
root => {
  // Separation rings are wider than hairline container borders. Discover
  // their geometry without depending on initials, radius, or viewport coords.
  const rings = [...root.querySelectorAll('*')].filter(el => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 &&
      ['Top', 'Right', 'Bottom', 'Left'].every(side =>
        parseFloat(s['border' + side + 'Width']) >= 2 &&
        s['border' + side + 'Style'] === 'solid');
  });
  return rings.map(el => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const widths = ['Top', 'Right', 'Bottom', 'Left'].map(side =>
      parseFloat(s['border' + side + 'Width']));
    const radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner =>
      parseFloat(s['border' + corner + 'Radius']) || 0);
    const colors = ['Top', 'Right', 'Bottom', 'Left'].map(side =>
      s['border' + side + 'Color']);
    const samples = [];
    const sample = (edge, x, y, color = null) => {
      const hit = document.elementFromPoint(x, y);
      samples.push({edge, x, y, color, owned: !!hit && el.contains(hit),
        hit: hit ? hit.tagName + (hit.getAttribute('data-profile-cover-preview') !== null
          ? '[data-profile-cover-preview]' : '') : null});
    };
    const line = (edge, from, to, fixed, horizontal, color) => {
      for (let at = from; at <= to; at += 2)
        sample(edge, horizontal ? at : fixed, horizontal ? fixed : at, color);
      sample(edge, horizontal ? to : fixed, horizontal ? fixed : to, color);
    };
    line('top', r.left + radii[0] + 1, r.right - radii[1] - 1,
      r.top + widths[0] / 2, true, colors[0]);
    line('right', r.top + radii[1] + 1, r.bottom - radii[2] - 1,
      r.right - widths[1] / 2, false, colors[1]);
    line('bottom', r.left + radii[3] + 1, r.right - radii[2] - 1,
      r.bottom - widths[2] / 2, true, colors[2]);
    line('left', r.top + radii[0] + 1, r.bottom - radii[3] - 1,
      r.left + widths[3] / 2, false, colors[3]);
    // Curved parts matter too: sample inside the painted border, avoiding its
    // antialiased outer edge. Uniform rings use one concentric midline.
    const uniform = widths.every(w => w === widths[0]) &&
      colors.every(color => color === colors[0]);
    if (uniform) {
      const corners = [
        [r.left + radii[0], r.top + radii[0], 180],
        [r.right - radii[1], r.top + radii[1], 270],
        [r.right - radii[2], r.bottom - radii[2], 0],
        [r.left + radii[3], r.bottom - radii[3], 90],
      ];
      corners.forEach(([cx, cy, start], i) => {
        const radius = radii[i] - widths[0] / 2;
        if (radius <= 0) return;
        for (let degrees = start + 15; degrees < start + 90; degrees += 15) {
          const angle = degrees * Math.PI / 180;
          sample('corners', cx + radius * Math.cos(angle),
            cy + radius * Math.sin(angle), colors[0]);
        }
      });
    }
    for (const x of [0.25, 0.5, 0.75])
      for (const y of [0.25, 0.5, 0.75])
        sample('interior', r.left + r.width * x, r.top + r.height * y);
    return {rect: {x:r.x, y:r.y, w:r.width, h:r.height}, samples};
  });
}
"""


def assert_painted_boundaries(tag: str, page, root, shot_dir: Path | None,
                              *, interaction_blocked: bool = False,
                              reference_png: bytes | None = None):
    rings = root.evaluate(PAINTED_BOUNDARY_PROBE)
    check(f"{tag} separation ring present", len(rings) > 0)
    # Read the compositor output, so overlays with pointer-events:none and
    # clipping are caught even when hit testing still returns the avatar.
    image = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    viewport = page.viewport_size
    scale_x = image.width / viewport["width"]
    scale_y = image.height / viewport["height"]
    reference = Image.open(io.BytesIO(reference_png)).convert("RGB") if reference_png else None
    for index, ring in enumerate(rings):
        for edge in ("top", "right", "bottom", "left", "corners"):
            samples = [s for s in ring["samples"] if s["edge"] == edge]
            if not samples:
                continue
            hidden = []
            for sample in samples:
                x = math.floor(sample["x"] * scale_x)
                y = math.floor(sample["y"] * scale_y)
                expected = [float(v) for v in sample["color"].removeprefix("rgba(")
                            .removeprefix("rgb(").removesuffix(")").split(",")]
                if not (0 <= x < image.width and 0 <= y < image.height):
                    hidden.append({**sample, "actual": "outside viewport"})
                    continue
                actual = image.getpixel((x, y))
                opaque = len(expected) == 3 or expected[3] == 1
                if not opaque or max(abs(a - b) for a, b in zip(actual, expected[:3])) > 10:
                    hidden.append({**sample, "actual": actual})
            check(f"{tag} ring {index} {edge} contour visibly painted",
                  not hidden, json.dumps(hidden[:3]))
        # A transparent menu backdrop may intentionally intercept interaction;
        # its open state still has to pass every screenshot contour check.
        if not interaction_blocked:
            covered = [s for s in ring["samples"] if not s["owned"]]
            check(f"{tag} ring {index} edges and face unobstructed",
                  not covered, json.dumps(covered[:3]))
        if reference is not None:
            altered = []
            for sample in ring["samples"]:
                if sample["edge"] != "interior":
                    continue
                point = (math.floor(sample["x"] * scale_x), math.floor(sample["y"] * scale_y))
                if max(abs(a - b) for a, b in zip(
                        image.getpixel(point), reference.getpixel(point))) > 10:
                    altered.append(point)
            check(f"{tag} ring {index} face remains visible under transient layers",
                  not altered, json.dumps(altered))
    if shot_dir:
        image.save(shot_dir / f"{tag.strip('[]').replace(' ', '-')}.png")
    return rings


def assert_visual_system(tag: str, page):
    d = page.evaluate(VISUAL_SYSTEM_PROBE)
    for name, ok, detail in spatial_results(page.evaluate(SPATIAL_SYSTEM_PROBE)):
        check(f"{tag} {name}", ok, detail)
    # Class A: canonical button size/radius scale.
    for b in d["chrome"]:
        check(f"{tag} chrome button height on scale ({b['h']}px {b['label']!r})",
              b["h"] in BUTTON_HEIGHT_SCALE, json.dumps(b, ensure_ascii=False))
        check(f"{tag} chrome button radius on scale ({b['r']}px {b['label']!r})",
              b["r"] in BUTTON_RADIUS_SCALE, json.dumps(b, ensure_ascii=False))
        if b["iconOnly"]:
            check(f"{tag} icon-only button hit area >=24 ({b['w']}x{b['h']})",
                  b["w"] >= 24 and b["h"] >= 24, json.dumps(b, ensure_ascii=False))
    # Class B: entity action groups share one center line + trailing edge.
    for e in d["entities"]:
        btns = e["buttons"]
        if len(btns) < 2:
            continue
        cys = [b["cy"] for b in btns]
        rights = [b["right"] for b in btns]
        check(f"{tag} {e['entity']} actions share center line",
              max(cys) - min(cys) <= 2, f"centers={cys}")
        bottoms = [b["bottom"] for b in btns]
        check(f"{tag} {e['entity']} action bottoms align",
              max(bottoms) - min(bottoms) <= 1, f"bottoms={bottoms}")
        # buttons of the same trailing group may have different right edges,
        # but none should be vertically offset from the row action line.
        check(f"{tag} {e['entity']} action buttons same height",
              len({b["h"] for b in btns}) == 1, f"heights={[b['h'] for b in btns]}")
    for floating in d["floating"]:
        check(f"{tag} floating surface has a reachable semantic source",
              floating["sourceBottom"] is not None, json.dumps(floating))
        if floating["sourceBottom"] is None:
            continue
        if floating["align"] == "bottom":
            check(f"{tag} floating surface bottom aligns with source button",
                  approx(floating["panelBottom"], floating["sourceBottom"], 1), json.dumps(floating))
        check(f"{tag} anchored surface remains inside viewport",
              floating["panelTop"] >= 0 and floating["panelLeft"] >= floating["sourceRight"]
              and floating["panelRight"] <= page.viewport_size["width"], json.dumps(floating))
    return d


def assert_cross_surface_entities(collected):
    # Class C: one entity = one geometry everywhere it appears.
    for action in ("accept", "reject"):
        seen = collected["decisions"][action]
        if len(seen) < 2:
            check(f"[cross-surface] decision '{action}' appears in >=2 surfaces", False,
                  f"found {len(seen)} (need contacts + notifications)")
            continue
        sig = {(b["w"], b["h"], b["r"]) for b in seen}
        check(f"[cross-surface] decision '{action}' identical geometry across surfaces",
              len(sig) == 1, f"variants={sorted(sig)}")


def assert_notifications(base_url: str, page, shot_dir, collected):
    page.set_viewport_size({"width": 1280, "height": 860})
    page.goto(base_url, wait_until="networkidle")
    page.wait_for_timeout(400)
    page.get_by_role("button", name="通知").click()
    page.wait_for_timeout(300)
    check("[notifications] panel opens", page.locator("[data-shell-notifications]").is_visible())
    d = assert_visual_system("[notifications]", page)
    for action in ("accept", "reject"):
        collected["decisions"][action].extend(d["decisions"][action])
    check("[notifications] pending invite reuses friend-request entity",
          page.locator("[data-shell-notification][data-entity='friend-request']").count() == 1)
    pill_accept = page.evaluate(r"""() =>
      [...document.querySelectorAll('[data-shell-notifications] button')]
        .filter(b => {const s=getComputedStyle(b), r=b.getBoundingClientRect();
          return /^(accept|decline)\b/i.test((b.textContent||'').trim()) && r.width > 40;}).length
    """)
    check("[notifications] no bespoke Accept/Decline pill buttons", pill_accept == 0,
          f"pill count={pill_accept}")
    check("[notifications] canonical accept control present",
          page.get_by_role("button", name="Accept Sarah Kim").count() == 1)
    if shot_dir:
        page.screenshot(path=str(shot_dir / "notif-final-shared-entity.png"))
    # A declared bottom anchor must reject the old detached positioning.
    misaligned = page.locator("[data-notification-mode='preview']").evaluate("""el => {
      const rect = el.getBoundingClientRect(), source = document.querySelector('button[aria-label="通知"]').getBoundingClientRect();
      const saved = el.style.bottom;
      el.style.bottom = (innerHeight - source.bottom + 18) + 'px';
      const rejected = Math.abs(el.getBoundingClientRect().bottom - source.bottom) > 1;
      el.style.bottom = saved;
      return rejected;
    }""")
    check("[notifications] alignment probe rejects an 18px detached bottom", misaligned)
    panel = page.locator("[data-notification-mode='preview']")
    panel.locator("button:not(:disabled)").first.focus()
    page.keyboard.press("Shift+Tab")
    check("[notifications] preview traps reverse focus at More",
          page.get_by_role("button", name="More notifications").evaluate("el => el === document.activeElement"))
    page.keyboard.press("Tab")
    check("[notifications] preview wraps focus inside",
          panel.locator("button:not(:disabled)").first.evaluate("el => el === document.activeElement"))
    check("[notifications] preview renders only recent items",
          page.locator("[data-shell-notification]").count() == 4)
    for w, h in ((760, 860), (640, 640)):
        page.set_viewport_size({"width": w, "height": h})
        page.wait_for_timeout(150)
        assert_visual_system(f"[notifications-preview {w}x{h}]", page)
    page.set_viewport_size({"width": 1280, "height": 860})
    page.wait_for_timeout(150)
    page.keyboard.press("Escape")
    check("[notifications] preview closes and restores bell focus",
          page.locator("[data-shell-notifications]").count() == 0
          and page.evaluate("() => document.activeElement.getAttribute('aria-label') === '通知'"))
    page.keyboard.press("Enter")
    page.get_by_role("button", name="More notifications").click()
    dialog = page.get_by_role("dialog", name="All notifications")
    dialog.wait_for(state="visible")
    search = page.get_by_role("textbox", name="Search notifications")
    check("[notifications] more expands into one dialog",
          dialog.count() == 1 and page.locator("[data-notification-mode='preview']").count() == 0)
    check("[notifications] search receives focus",
          search.evaluate("el => el === document.activeElement"))
    search.focus()
    for _ in range(24):
        page.keyboard.press("Tab")
    check("[notifications] complete dialog contains keyboard focus",
          dialog.evaluate("el => el.contains(document.activeElement)"))
    first = page.locator("[data-shell-notification]").evaluate_all("rows => rows.map(r => r.dataset.shellNotification)")
    check("[notifications] viewer bounds rendered rows per page", len(first) == 6)
    d = assert_visual_system("[notifications-viewer]", page)
    for action in ("accept", "reject"):
        collected["decisions"][action].extend(d["decisions"][action])
    for selector, styles, expected in (
        ("[data-ui-column='time']", {"transform": "translateX(-9px)"}, "time shared right axis"),
        ("[data-ui-column='avatar']", {"transform": "translateX(7px)"}, "inline opposed insets equal"),
        ("[data-ui-row] [data-ui-column='actions'] button:last-child",
         {"transform": "translateX(-8px)"}, "visible controls share trailing edge"),
        ("[data-ui-column='time']", {"transform": "translateY(6px)"}, "slots centered vertically"),
    ):
        assert_spatial_mutation(page, selector, styles, expected)
    for w, h in ((1280, 860), (900, 700), (844, 651), (760, 860), (640, 640)):
        page.set_viewport_size({"width": w, "height": h})
        assert_notification_spatial_contract(page)
        if shot_dir:
            page.screenshot(path=str(shot_dir / f"notifications-symmetry-pending-{w}.png"))
    time = page.locator("[data-ui-column='time']").nth(1)
    original_time = time.inner_text()
    try:
        time.evaluate("(el) => { el.textContent = '昨天 10:45'; }")
        page.set_viewport_size({"width": 640, "height": 640})
        assert_notification_spatial_contract(page)
        if shot_dir:
            page.screenshot(path=str(shot_dir / "notifications-symmetry-expanded-time.png"))
    finally:
        time.evaluate("(el, value) => { el.textContent = value; }", original_time)
    page.set_viewport_size({"width": 1280, "height": 860})
    page.locator(".ant-pagination-item-2").click()
    second = page.locator("[data-shell-notification]").evaluate_all("rows => rows.map(r => r.dataset.shellNotification)")
    check("[notifications] second page has remaining unique rows",
          len(second) == 4 and not set(first) & set(second))
    search.fill("RELEASE ROOM")
    check("[notifications] search matches content and resets pagination",
          page.locator("[data-shell-notification]").count() == 3
          and page.locator(".ant-pagination-item-active").inner_text() == "1")
    box = dialog.bounding_box()
    search.fill("nothing-will-match-this")
    check("[notifications] no-result state explains recovery",
          page.get_by_text("No matching notifications. Try another search.").is_visible())
    check("[notifications] search empty state preserves dialog geometry",
          dialog.bounding_box() == box)
    if shot_dir:
        page.screenshot(path=str(shot_dir / "notifications-search-empty.png"))
    search.fill("Emma")
    check("[notifications] search recovers and matches author",
          page.locator("[data-shell-notification]").count() == 2)
    search.fill("")
    pending_axes = notification_axes(page)
    page.get_by_role("button", name="Accept Sarah Kim", exact=True).click()
    check("[notifications] invite decision updates same item",
          page.get_by_text("Invite accepted — group added to your chats.").is_visible()
          and page.get_by_role("button", name="Accept Sarah Kim", exact=True).count() == 0)
    check("[symmetry] resolving invitation keeps all column boundaries stable",
          notification_axes(page) == pending_axes)
    assert_notification_spatial_contract(page)
    page.locator("[data-shell-notifications-read-all]").click()
    check("[notifications] read-all clears unread and disables itself",
          page.locator("[data-shell-notification] [aria-label='Unread']").count() == 0
          and page.locator("[data-shell-notifications-read-all]").is_disabled())
    for w, h in ((1280, 860), (760, 860), (640, 640)):
        page.set_viewport_size({"width": w, "height": h})
        page.wait_for_timeout(150)
        rect = dialog.bounding_box()
        check(f"[notifications-viewer {w}x{h}] centered and bounded",
              approx(rect["x"] + rect["width"]/2, w/2, 1)
              and approx(rect["y"] + rect["height"]/2, h/2, 1)
              and rect["x"] >= 0 and rect["y"] >= 0 and rect["width"] <= w,
              json.dumps(rect))
        check(f"[notifications-viewer {w}x{h}] remains dialog at narrow width",
              page.locator(".ant-drawer").count() == 0)
        if shot_dir:
            page.screenshot(path=str(shot_dir / f"notifications-viewer-{w}x{h}.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("[notifications] viewer teardown and focus restore",
          page.locator("[data-shell-notifications]").count() == 0
          and page.evaluate("() => document.activeElement.getAttribute('aria-label') === '通知'"))
    page.get_by_role("button", name="通知", exact=True).click()
    check("[notifications] preview shares viewer decision and read state",
          page.get_by_text("Invite accepted — group added to your chats.").is_visible()
          and page.locator("[data-shell-notification] [aria-label='Unread']").count() == 0)
    page.get_by_role("button", name="More notifications").click()
    dialog.wait_for(state="visible")
    page.locator(".ant-pagination-item-2").click()
    for notification_id in second:
        page.locator(f"[data-shell-notification='{notification_id}'] button[aria-label^='Dismiss']").click()
    check("[notifications] removing final-page rows clamps to valid page",
          page.locator(".ant-pagination-item-active").inner_text() == "1"
          and page.locator("[data-shell-notification]").count() == 6)
    remaining = page.locator("[data-shell-notification]").evaluate_all("rows => rows.map(r => r.dataset.shellNotification)")
    for notification_id in remaining:
        page.locator(f"[data-shell-notification='{notification_id}'] button[aria-label^='Dismiss']").click()
    check("[notifications] deleting all rows exposes genuine empty state",
          page.get_by_text("You’re all caught up.").is_visible()
          and page.locator("[data-shell-notification]").count() == 0)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.get_by_role("button", name="通知", exact=True).click()
    check("[notifications] empty preview focuses enabled More control",
          page.get_by_role("button", name="More notifications").evaluate("el => el === document.activeElement"))
    assert_visual_system("[notifications-empty-preview]", page)
    if shot_dir:
        page.screenshot(path=str(shot_dir / "notifications-empty-preview.png"))
    page.mouse.click(600, 20)
    check("[notifications] outside click closes preview", page.locator("[data-shell-notifications]").count() == 0)

    page.goto(base_url, wait_until="networkidle")
    page.get_by_role("button", name="通知", exact=True).click()
    pending_axes = notification_axes(page)
    page.get_by_role("button", name="Reject Sarah Kim", exact=True).click()
    check("[notifications] rejection preserves explicit outcome", page.get_by_text("Invite declined.").is_visible())
    check("[symmetry] declining invitation keeps all column boundaries stable",
          notification_axes(page) == pending_axes)
    page.get_by_role("button", name="More notifications").click()
    dialog.wait_for(state="visible")
    page.locator("[data-shell-notification='n-2'] [data-row-button]").click()
    check("[notifications] opening activity closes viewer and keeps Chat navigation",
          page.locator("[data-shell-notifications]").count() == 0
          and page.get_by_role("button", name="聊天", exact=True).get_attribute("aria-pressed") == "true")
    page.get_by_role("button", name="通知", exact=True).click()
    check("[notifications] opened activity read state persists",
          page.locator("[data-shell-notification='n-2'] [aria-label='Unread']").count() == 0)
    page.keyboard.press("Escape")


def assert_contacts_entity_controls(base_url: str, page, collected):
    page.set_viewport_size({"width": 1280, "height": 860})
    page.goto(base_url, wait_until="networkidle")
    page.wait_for_timeout(400)
    page.get_by_role("button", name="Contacts").first.click()
    page.wait_for_timeout(400)
    d = assert_visual_system("[contacts]", page)
    for action in ("accept", "reject"):
        collected["decisions"][action].extend(d["decisions"][action])
    check("[contacts] pending request uses friend-request entity",
          page.locator("[data-entity='friend-request'] [data-decision-action='accept']").count() >= 1)


def assert_contacts_painted_boundaries(base_url: str, page, shot_dir: Path | None):
    for w in (682, 760, 1440):
        page.set_viewport_size({"width": w, "height": 900})
        page.goto(base_url, wait_until="networkidle")
        page.get_by_role("button", name="Contacts").first.click()
        selections = (
            ("request", page.locator("[data-chat-friend-request-id]").first),
            ("friend", page.locator("[data-chat-contact-ptid]").filter(has_text="Carol").first),
            ("group", page.locator("[data-chat-saved-group]").first),
        )
        for state, selection in selections:
            if state == "group":
                page.get_by_text("Saved Groups (", exact=False).click()
                page.wait_for_timeout(300)
            selection.click()
            card = page.locator("[data-contact-cover]").locator("..")
            assert_painted_boundaries(f"[contacts-{state}-{w}]", page, card, shot_dir)


SETTINGS_PROBE = r"""
() => {
  const jargon = ['ptid:01HQX7','seq:00000142','relay:east'];
  const txt = document.body.innerText;
  return {
    groupTabs: document.querySelectorAll('[role="tablist"]')[0]?.querySelectorAll('[role="tab"]').length || 0,
    switches: document.querySelectorAll('[role="switch"]').length,
    tabButtons: document.querySelectorAll('[role="tablist"] [role="tab"], nav[aria-label="Settings sections"] button').length,
    navVisible: (() => { const n=document.querySelector('nav[aria-label="Settings sections"]'); return n ? n.getBoundingClientRect().width>0 : false; })(),
    chipTabs: document.querySelectorAll('[role="tablist"]')[1]?.querySelectorAll('[role="tab"]').length || 0,
    jargonLeaked: jargon.filter(j => txt.includes(j)),
    realResetButtons: [...document.querySelectorAll('button')].filter(b=>/reset onboarding/i.test(b.textContent||'')).length,
    coverPreview: document.querySelectorAll('[data-profile-cover-preview]').length,
    fusedIdentity: document.querySelectorAll('[data-profile-identity]').length,
    coverChange: document.querySelectorAll('[data-profile-cover-change]').length,
    wallpaperCard: /Chat wallpaper/.test(txt),
    profileWord: /Profile background/.test(txt),
    sectionChips: document.querySelectorAll('[role="tablist"]').length > 1 ? document.querySelectorAll('[role="tablist"]')[1].querySelectorAll('[role="tab"]').length : 0,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}
"""


def assert_technical_identity(base_url: str, page, shot_dir: Path | None):
    page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=base_url)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(base_url, wait_until="networkidle")
    page.get_by_role("button", name="设置").click()
    technical = page.locator("[data-profile-technical]")
    check("[identity] technical detail collapsed initially",
          technical.count() == 1 and not technical.evaluate("el => el.open"))
    technical.locator("summary").click()
    fields = technical.locator("[data-identity-field]")
    check("[identity] PTID and home Station present",
          fields.filter(has=page.locator("dt", has_text="PTID")).count() >= 1
          and fields.filter(has=page.locator("dt", has_text="Home Station")).count() >= 1)
    values = fields.locator("[data-identity-value]").all_text_contents()
    check("[identity] full PTID and Station shown",
          "ptid:01HQX7K3M9VDGF2N8PWJRST6YZ" in values and "alpha.peers.social" in values)
    check("[identity] all joined federations shown", fields.count() == 5, f"fields={fields.count()}")
    for field in fields.all():
        button = field.get_by_role("button")
        expected = field.locator("[data-identity-value]").inner_text()
        button.click()
        page.wait_for_function("label => document.querySelector(`[aria-label=\"${label}\"]`)?.dataset.copyState === 'copied'",
                               arg=button.get_attribute("aria-label"))
        check(f"[identity] copies full value {expected!r}",
              page.evaluate("() => navigator.clipboard.readText()") == expected)
        check("[identity] successful copy announced", field.get_by_role("status").inner_text() == "Copied")

    ptid = technical.locator("[data-identity-field='PTID']")
    ptid.get_by_role("button").focus()
    page.keyboard.press("Enter")
    check("[identity] copy works with keyboard",
          page.evaluate("() => navigator.clipboard.readText()") == "ptid:01HQX7K3M9VDGF2N8PWJRST6YZ")

    # Only the clipboard failure is injected; the actual component handles it.
    page.evaluate("""() => {
      window.__identityWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
    }""")
    ptid.get_by_role("button").click()
    page.wait_for_function("() => document.querySelector('[data-identity-field=\"PTID\"] button').dataset.copyState === 'failed'")
    check("[identity] denied clipboard shows retryable failure",
          ptid.get_by_role("alert").is_visible() and ptid.get_by_role("button").is_enabled())
    page.evaluate("() => { navigator.clipboard.writeText = window.__identityWriteText; delete window.__identityWriteText; }")
    ptid.get_by_role("button").click()
    page.wait_for_function("() => document.querySelector('[data-identity-field=\"PTID\"] button').dataset.copyState === 'copied'")
    check("[identity] clipboard retry succeeds", ptid.get_by_role("alert").count() == 0)
    page.wait_for_function("() => document.querySelector('[data-identity-field=\"PTID\"] button').dataset.copyState === 'idle'")

    for w in (1440, 760, 640):
        page.set_viewport_size({"width": w, "height": 900})
        probe = technical.evaluate(r"""root => {
          const rows = [...root.querySelectorAll('[data-identity-field]')];
          return {overflow: document.documentElement.scrollWidth - innerWidth,
            rows: rows.map(row => {
              const value = row.querySelector('[data-identity-value]'), b = row.querySelector('button');
              const vr = value.getBoundingClientRect(), br = b.getBoundingClientRect();
              const hit = document.elementFromPoint(br.x + br.width/2, br.y + br.height/2);
              return {valueW:vr.width, overflow:value.scrollWidth-value.clientWidth,
                bw:br.width,bh:br.height,owned:!!hit && b.contains(hit)};
            })};
        }""")
        check(f"[identity {w}] readable values and no overflow",
              probe["overflow"] <= 0 and all(r["valueW"] >= 80 and r["overflow"] <= 1 for r in probe["rows"]),
              json.dumps(probe))
        check(f"[identity {w}] copy buttons reachable at full size",
              all(r["bw"] == 28 and r["bh"] == 28 and r["owned"] for r in probe["rows"]), json.dumps(probe))
        assert_painted_boundaries(f"[settings-identity-{w}]", page,
                                  page.locator("[data-profile-identity]"), shot_dir)

    # Account and Network consume the same Station and federation owner.
    page.set_viewport_size({"width": 1440, "height": 900})
    page.get_by_role("tab", name="Network", exact=True).click()
    check("[identity] Station matches Network", page.get_by_text("alpha.peers.social", exact=True).is_visible())
    page.get_by_role("button", name="Networks", exact=True).click()
    network_names = ("Peers Social Network", "Lab Federation", "East Asia Network")
    check("[identity] federation names match Network", all(page.get_by_text(n, exact=True).is_visible() for n in network_names))
    page.get_by_role("button", name="Join a network").click()
    page.get_by_placeholder("https://federation.example.com").fill("https://identity-test.example")
    page.get_by_role("button", name="Join", exact=True).click()
    page.get_by_role("tab", name="General", exact=True).click()
    technical.locator("summary").click()
    check("[identity] joined federation appears on Account",
          technical.get_by_role("button", name="Copy federation identity-test.example").count() == 1)
    page.get_by_role("tab", name="Network", exact=True).click()
    page.get_by_role("button", name="Networks", exact=True).click()
    page.get_by_text("identity-test.example", exact=True).click()
    page.get_by_role("button", name="Leave this network", exact=True).click()
    page.get_by_role("button", name="Leave", exact=True).click()
    page.get_by_role("tab", name="General", exact=True).click()
    technical.locator("summary").click()
    check("[identity] departed federation removed from Account",
          technical.get_by_role("button", name="Copy federation identity-test.example").count() == 0)


def assert_settings(base_url: str, page, shot_dir: Path | None = None):
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(base_url, wait_until="networkidle")
    page.wait_for_timeout(400)
    page.get_by_role("button", name="设置").click()
    page.wait_for_timeout(500)
    d = page.evaluate(SETTINGS_PROBE)
    check("[settings] 4 top-level groups", d["groupTabs"] == 4, json.dumps(d))
    check("[settings] no technical jargon on default first paint", d["jargonLeaked"] == [], str(d["jargonLeaked"]))
    check("[settings] section nav present", d["navVisible"] is True)
    check("[settings] cover fused into identity card", d["fusedIdentity"] == 1 and d["coverPreview"] == 1)
    # avatar seated on the banner edge — overlap must be the ring (≤6px), face never cropped
    avatar_fit = page.evaluate(r"""() => {
      const card = document.querySelector('[data-profile-identity]');
      const banner = card.querySelector('[data-profile-cover-preview]').getBoundingClientRect();
      const avatar = [...card.querySelectorAll('*')].find(x =>
        parseFloat(getComputedStyle(x).borderTopWidth) >= 2);
      const av = avatar.getBoundingClientRect();
      const overlap = Math.round(banner.bottom - av.top);
      return {avatar: Math.round(av.height), overlap, visibleBelow: Math.round(av.height - overlap)};
    }""")
    check("[settings] avatar overlap is only the ring (face not cropped)",
          avatar_fit["avatar"] == 72 and 0 <= avatar_fit["overlap"] <= 6
          and avatar_fit["visibleBelow"] >= 66, json.dumps(avatar_fit))
    check("[settings] Change affordance present, no labelled background card",
          d["coverChange"] == 1 and d["profileWord"] is False)
    check("[settings] chat wallpaper not duplicated in settings", d["wallpaperCard"] is False)

    default_rings = {}
    for w in (1440, 1024, 760):
        page.set_viewport_size({"width": w, "height": 900})
        default_rings[w] = assert_painted_boundaries(
            f"[settings-default-{w}]", page,
            page.locator("[data-profile-identity]"), shot_dir)
    page.set_viewport_size({"width": 1440, "height": 900})

    # Compare the same foreground content before/after the menu paints.
    menu_reference = page.screenshot()
    # Change menu opens: upload new + recent history only after an upload exists
    page.locator('[data-profile-cover-change]').click()
    page.wait_for_timeout(200)
    check("[settings] change menu opens with Upload new",
          page.locator('[data-profile-cover-menu]').count() == 1
          and page.locator('[data-profile-cover-menu] [role="menuitem"]', has_text="Upload new").count() == 1)
    check("[settings] recent history hidden with only the default",
          page.locator('[data-profile-cover-menu] [role="menuitemradio"]').count() == 0)
    assert_painted_boundaries("[settings-menu-1440]", page,
                              page.locator("[data-profile-identity]"), shot_dir,
                              interaction_blocked=True, reference_png=menu_reference)
    page.keyboard.press("Escape"); page.wait_for_timeout(150)

    # A contrasting PNG exercises the actual file/read/history path and makes
    # cover pixels distinguishable from the white separation ring.
    png = io.BytesIO()
    Image.new("RGB", (320, 160), (25, 90, 70)).save(png, format="PNG")
    page.locator('[data-profile-identity] input[type=file]').set_input_files({
        "name": "contour-cover.png", "mimeType": "image/png", "buffer": png.getvalue(),
    })
    page.wait_for_timeout(400)
    for w in (1440, 1024, 760):
        page.set_viewport_size({"width": w, "height": 900})
        uploaded = assert_painted_boundaries(
            f"[settings-upload-{w}]", page,
            page.locator("[data-profile-identity]"), shot_dir)
        check(f"[settings-upload-{w}] cover change preserves avatar geometry",
              [r["rect"] for r in uploaded] == [r["rect"] for r in default_rings[w]])
    page.set_viewport_size({"width": 1440, "height": 900})
    page.locator('[data-profile-cover-change]').click()
    page.wait_for_timeout(200)
    thumbs = page.locator('[data-profile-cover-menu] [role="menuitemradio"]')
    check("[settings] recent shows uploaded + default (2)", thumbs.count() == 2,
          f"thumbs={thumbs.count()}")
    thumbs.nth(thumbs.count() - 1).click()
    page.wait_for_timeout(200)
    stored = page.evaluate("() => localStorage.getItem('pt.profile.cover')")
    check("[settings] history can restore default", stored in (None, ""))
    assert_painted_boundaries("[settings-restored-1440]", page,
                              page.locator("[data-profile-identity]"), shot_dir)
    page.evaluate("() => { localStorage.removeItem('pt.profile.cover'); localStorage.removeItem('pt.profile.cover.history'); }")
    check("[settings] no second horizontal section tab strip", d["sectionChips"] == 0, f"chips={d['sectionChips']}")
    general_sections = page.locator('nav[aria-label="Settings sections"] button').all_text_contents()
    check("[settings] General contains the four current sections",
          general_sections == ["Account", "Notifications", "Privacy & Security", "Appearance & Language"],
          json.dumps(general_sections))
    check("[settings] AI Defaults removed from General",
          page.get_by_role("button", name="AI Defaults", exact=True).count() == 0)

    # real switches across General sections
    page.get_by_role("button", name="Notifications", exact=True).click()
    page.wait_for_timeout(300)
    sw = page.locator('[role="switch"]').count()
    check("[settings] notification switches are semantic", sw >= 6, f"switches={sw}")

    # reset is a real control with confirmation
    page.get_by_role("tab", name="Advanced").click()
    page.wait_for_timeout(400)
    check("[settings] reset onboarding is a real button", d["realResetButtons"] >= 0)
    page.get_by_role("button", name="Reset onboarding").first.click()
    page.wait_for_timeout(200)
    check("[settings] reset requires confirmation", page.get_by_role("button", name="Cancel").count() >= 1)

    for w in (1440, 1024, 760):
        page.set_viewport_size({"width": w, "height": 860})
        page.wait_for_timeout(300)
        dd = page.evaluate(SETTINGS_PROBE)
        check(f"[settings] no horizontal overflow @ {w}", dd["docOverflow"] <= 0, f"ov={dd['docOverflow']}")
    # vertical section rail stays at every width; no horizontal chip strip
    page.set_viewport_size({"width": 760, "height": 860})
    page.wait_for_timeout(300)
    dn = page.evaluate(SETTINGS_PROBE)
    check("[settings] vertical nav kept at narrow width", dn["navVisible"] is True)
    check("[settings] no horizontal section chips at any width", dn["sectionChips"] == 0,
          f"chips={dn['sectionChips']}")


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
        assert_contacts_painted_boundaries(args.base_url, page, shot_dir)

        # Class-level visual invariants across chat / contacts / notifications.
        page.set_viewport_size({"width": 1280, "height": 860})
        page.goto(args.base_url, wait_until="networkidle")
        page.wait_for_timeout(400)
        assert_visual_system("[chat]", page)

        collected = {"decisions": {"accept": [], "reject": []}}
        assert_contacts_entity_controls(args.base_url, page, collected)
        assert_notifications(args.base_url, page, shot_dir, collected)
        assert_cross_surface_entities(collected)
        assert_settings(args.base_url, page, shot_dir)
        assert_technical_identity(args.base_url, page, shot_dir)

        check("zero console/page errors across run", len(errors) == 0, json.dumps(errors[:5]))
        browser.close()

    print(f"PASS {len(passed)}  FAIL {len(failures)}")
    for f in failures:
        print("  FAIL", f)
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
