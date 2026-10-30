/**
 * Craft geometry battery — the machine part of the craft gate (gate ④).
 *
 * It cannot judge taste, signature, or product meaning (those remain an
 * independent human verdict). It enforces the geometry/native-leakage class
 * of craft defects that caused raw "Choose File" buttons, full-width switch
 * tracks, wrapped corner counters and grip collisions: rules that are fully
 * observable from a rendered DOM and must never regress.
 *
 * The function is stringified and executed inside the page, so it must be
 * self-contained (no closure references).
 */
export function craftBatterySource(rootSelector) {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)});
    if (!root) return { pass: false, offenders: [{ rule: 'battery-root-missing' }] };
    const offenders = [];
    const seen = new Set();
    const flag = (rule, node, extra = {}) => {
      const key = rule + '|' + (node || '') + '|' + JSON.stringify(extra);
      if (seen.has(key)) return;
      seen.add(key);
      offenders.push({ rule, node, ...extra });
    };
    const box = el => el.getBoundingClientRect();
    const cs = el => getComputedStyle(el);
    const visible = el => {
      const r = box(el); const s = cs(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    };
    // Screen-reader-only controls render as a 1px clipped absolute box.
    const screenReaderOnly = el => {
      const s = cs(el); const r = box(el);
      return s.position === 'absolute' && r.width <= 1 && r.height <= 1;
    };
    const describe = el => {
      const id = el.getAttribute('data-action-id') || el.getAttribute('aria-label') || '';
      const cls = (el.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
      return (el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (id ? '#' + id : '')).slice(0, 80);
    };

    // C1 — Native OS chrome must never be visibly rendered. File/color inputs
    // are always hidden behind a custom affordance; raw submit/reset inputs are
    // forbidden (a real <button> is the only sanctioned trigger).
    root.querySelectorAll("input[type='file'],input[type='color'],input[type='submit'],input[type='button'],input[type='reset']").forEach(el => {
      if (visible(el) && !screenReaderOnly(el)) flag('native-control-chrome', describe(el));
    });

    // C2 — The switch is an intrinsic compact control (42x24). Even inside a
    // stretchy flex/grid parent it must keep its geometry.
    root.querySelectorAll('.pt-switch').forEach(el => {
      const r = box(el);
      if (r.width > 60 || r.width < 34 || r.height < 20 || r.height > 30) {
        flag('switch-intrinsic-geometry', describe(el), { width: Math.round(r.width), height: Math.round(r.height) });
      }
    });

    // C3 — The thumb stays fully inside the track.
    root.querySelectorAll('.pt-switch').forEach(track => {
      const tr = box(track);
      track.querySelectorAll('.pt-switch-thumb').forEach(thumb => {
        const h = box(thumb);
        if (h.left < tr.left - 1 || h.right > tr.right + 1 || h.top < tr.top - 1 || h.bottom > tr.bottom + 1) {
          flag('switch-thumb-outside-track', describe(track));
        }
      });
    });

    // C4 — One-line corner text never wraps.
    root.querySelectorAll('.pt-character-count').forEach(el => {
      if (visible(el) && el.scrollHeight > el.clientHeight + 2) {
        flag('counter-text-wraps', describe(el), { text: el.textContent.trim() });
      }
    });

    // C5 — The character counter sits on its own row below the textarea and
    // never collides with the native resize grip.
    root.querySelectorAll('.pt-character-count').forEach(el => {
      const frame = el.closest('.pt-field-frame');
      const ta = frame && frame.querySelector('textarea');
      if (ta && visible(el)) {
        const tr = box(ta); const cr = box(el);
        if (cr.top < tr.bottom - 8) flag('counter-grip-collision', describe(el));
      }
    });

    // C6 — Buttons embedded in a field frame (clear, search submit) stay
    // visually inside the frame instead of forming a second attached box.
    root.querySelectorAll('.pt-field-frame').forEach(frame => {
      const fr = box(frame);
      frame.querySelectorAll('button').forEach(btn => {
        if (!visible(btn)) return;
        const r = box(btn);
        if (r.right > fr.right + 1 || r.left < fr.left - 1 || r.bottom > fr.bottom + 1 || r.top < fr.top - 1) {
          flag('control-outside-frame', describe(btn));
        }
      });
    });

    // C7 — Compact hit-target floor. WCAG 2.5.8 AA minimum is 24 CSS px;
    // coarse-pointer contexts raise it to 44 via CSS. Inline text buttons
    // (breadcrumb/link-as-action) are prose, not tap targets, and exempt.
    root.querySelectorAll('.pt-button,.pt-switch,.pt-check-label,.pt-select-trigger,.pt-file-button,.pt-dropzone').forEach(el => {
      if (el.matches('[data-emphasis="inline"]')) return;
      const r = box(el);
      if (r.width > 0 && r.height > 0 && r.height < 24) {
        flag('hit-target-too-small', describe(el), { height: Math.round(r.height) });
      }
    });

    // C8 — Nothing renders beyond a card's horizontal bounds (the page-level
    // overflow gate already covers the board; this catches per-card escape).
    root.querySelectorAll('.cf-card,.pt-card').forEach(card => {
      const cr = box(card);
      card.querySelectorAll('*').forEach(el => {
        if (el.closest('.pt-overlay-host')) return;
        const s = cs(el);
        if (s.position === 'fixed' || s.position === 'absolute') return;
        const r = box(el);
        if (r.width > 0 && (r.right > cr.right + 1 || r.left < cr.left - 1)) {
          flag('card-horizontal-overflow', describe(el));
        }
      });
    });

    // C9 — Embedded native controls inside rounded hosts must not paint the
    // global square focus outline. The recurring defect: a rounded search/field
    // host wraps a radius-0 native input whose :focus-visible outline (>=2px)
    // renders with square corners. Keyboard focus MUST be shown on the rounded
    // host (:focus-within) or on a control that carries the radius itself.
    const TEXT_INPUTS = "input:not([type]),input[type='text'],input[type='search'],input[type='email'],input[type='url'],input[type='tel'],input[type='password'],textarea,select";
    root.querySelectorAll(TEXT_INPUTS).forEach(el => {
      if (!visible(el) || screenReaderOnly(el)) return;
      const host = el.parentElement;
      if (!host) return;
      const ownRadius = parseFloat(cs(el).borderTopLeftRadius) || 0;
      const hostRadius = parseFloat(cs(host).borderTopLeftRadius) || 0;
      const previouslyFocused = document.activeElement;
      el.focus({ focusVisible: true });
      const focused = cs(el);
      const outlineWidth = parseFloat(focused.outlineWidth) || 0;
      // outline-style none means the width is a non-painted residue; only a
      // real stroke (solid/dashed/dotted/...) is a visible square ring.
      const painted = !['none', 'hidden', ''].includes(focused.outlineStyle);
      if (hostRadius >= 8 && ownRadius < 4 && outlineWidth >= 2 && painted) {
        flag('embedded-control-square-focus', describe(el), { outlineWidth, outlineStyle: focused.outlineStyle, hostRadius });
      }
      el.blur();
      if (previouslyFocused && previouslyFocused !== el && previouslyFocused.focus) {
        previouslyFocused.focus({ preventScroll: true });
      }
    });

    // C10 — App-frame chrome zones (icon rail, top bar, side rail) separate by
    // material surfaces + blur, never by hairline border strokes. A border on
    // these zones regresses to the tiled admin-frame seam the owner rejected.
    ['.sk-rail', '.sk-feed-head', '.sk-chats'].forEach(sel => {
      root.querySelectorAll(sel).forEach(el => {
        const s = cs(el);
        const widths = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth]
          .map(w => parseFloat(w) || 0);
        if (Math.max(...widths) > 0) {
          flag('chrome-zone-hairline', describe(el), { borderWidths: widths.join('/') });
        }
      });
    });

    // C11 — Buttons must never keep UA chrome. The recurring defect: a custom
    // <button> without border/background/appearance reset inherits the system
    // outset border (and gray face on some engines), producing a stray box.
    root.querySelectorAll('button').forEach(el => {
      if (!visible(el)) return;
      const s = cs(el);
      if (s.borderStyle === 'outset') flag('ua-button-chrome', describe(el));
    });

    return {
      pass: offenders.length === 0,
      offenders: offenders.slice(0, 30),
      checkedAt: new Date().toISOString(),
    };
  })()`;
}

export async function runCraftBattery(page, rootSelector = '.cf-review') {
  return page.evaluate((source) => {
    // eslint-disable-next-line no-eval
    return eval(source);
  }, craftBatterySource(rootSelector));
}
