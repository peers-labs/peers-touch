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
    // Resolved paint alpha. Engines serialize colors as either rgba(r,g,b,a)
    // or the modern color(srgb r g b / a) form; both must yield a number.
    const rgbaAlpha = value => {
      const m = /rgba?\\(([^)]+)\\)/.exec(value);
      if (!m) return 1;
      const parts = m[1].split(',').map(p => parseFloat(p.trim()));
      return parts.length === 4 ? parts[3] : 1;
    };
    const colorAlpha = value => {
      if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return 0;
      const slash = /\\/\\s*([0-9.]+)/.exec(value);
      if (slash) return parseFloat(slash[1]);
      return rgbaAlpha(value);
    };

    // C1 — Native OS chrome must never be visibly rendered. File/color inputs
    // are always hidden behind a custom affordance; raw submit/reset inputs are
    // forbidden (a real <button> is the only sanctioned trigger).
    root.querySelectorAll("input[type='file'],input[type='color'],input[type='submit'],input[type='button'],input[type='reset']").forEach(el => {
      if (visible(el) && !screenReaderOnly(el)) flag('native-control-chrome', describe(el));
    });

    // C1b — The visually-hidden utility must collapse even when applied on top
    // of a real control (e.g. a .pt-button context-menu anchor). Component
    // chrome rules (min-height, border, relative positioning) must never win
    // the cascade; a leaking sr-only button paints a 36px phantom row.
    root.querySelectorAll('.pt-sr-only').forEach(el => {
      if (!screenReaderOnly(el)) {
        const r = box(el);
        flag('sr-only-leak', describe(el), { width: Math.round(r.width), height: Math.round(r.height) });
      }
    });

    // C2 — The switch is an intrinsic dense 36x20 control (promoted from the
    // old 44x26 iOS pill). Even inside a stretchy parent it must keep its
    // geometry; the old tall/wide bounds are now defects.
    root.querySelectorAll('.pt-switch').forEach(el => {
      const r = box(el);
      if (r.width > 44 || r.width < 32 || r.height < 18 || r.height > 24) {
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
    const TARGET_SELECTOR = [
      '.pt-button', '.pt-switch', '.pt-check-label', '.pt-select-trigger', '.pt-file-button', '.pt-dropzone',
      // increment 12-14 social controls
      '.sk-composer-tool', '.sk-msg-action', '.sk-react-emoji', '.sk-emoji-cell',
      '.sk-draft-op', '.sk-voice-toggle', '.sk-voice-rec-cancel', '.sk-voice-rec-finish',
      '.sk-voice-send', '.sk-voice-discard', '.sk-call-ctl', '.sk-msg-image', '.sk-file-chip',
      '.sk-chat-back', '.sk-contact-back',
    ].join(',');
    root.querySelectorAll(TARGET_SELECTOR).forEach(el => {
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
    ['.sk-rail', '.sk-chats'].forEach(sel => {
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

    // C12 — No dead affordances in the app frame: every element styled/named
    // as interactive (rail icons, stacked avatars, conversation rows, moment
    // actions, increment 12-14 chat controls) must be a real control
    // (button/a/input itself or nested inside one), or expose role=button
    // with a tabindex. A clickable-looking span silently swallows clicks.
    const AFFORDANCE_SELECTOR = [
      '.sk-rail-icon', '.sk-stack-item', '.sk-stack-more',
      '.sk-chat', '.sk-moment-action',
      '.sk-msg-action', '.sk-react-emoji', '.sk-emoji-cell', '.sk-composer-tool',
      '.sk-draft-op', '.sk-voice-toggle', '.sk-call-ctl', '.sk-msg-image',
      '.sk-file-chip', '.sk-thread-entry', '.sk-side-thumb',
    ].join(',');
    root.querySelectorAll(AFFORDANCE_SELECTOR).forEach(el => {
      const tag = el.tagName.toLowerCase();
      const nativeControl = tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'select';
      const wrapped = !!el.closest('button,a,input,textarea,select');
      const a11yControl = el.getAttribute('role') === 'button' && el.hasAttribute('tabindex');
      if (!(nativeControl || wrapped || a11yControl)) {
        flag('dead-affordance-not-a-control', describe(el));
      }
    });

    // C13 — The keyboard focus indicator must be instant. When the focus ring
    // is painted via box-shadow (north-star fields use :focus-within shadows),
    // a non-zero box-shadow transition delays the ring and makes its
    // immediately-read computed value interpolate at zero spread/alpha. Only
    // fields whose ring channel is box-shadow are scoped here; outline-ring
    // controls may transition other properties.
    root.querySelectorAll('.sf-field').forEach(el => {
      const s = cs(el);
      const durations = (s.transitionDuration || '').split(',').map(d => parseFloat(d) || 0);
      const props = (s.transitionProperty || '').split(',').map(p => p.trim());
      const shadowAnimates = props.some((p, i) => (p === 'box-shadow' || p === 'all') && (durations[i] ?? durations[0]) > 0);
      if (shadowAnimates) flag('focus-ring-transitioned', describe(el), { transitionProperty: s.transitionProperty, transitionDuration: s.transitionDuration });
    });

    // C14 — Floating overlays that sit above a busy surface must paint
    // opaquely. The recurring defect: translucent card tokens let the stream
    // and composer bleed through side sheets and the hover action bar.
    ['.sk-side-sheet', '.sk-msg-actions-bar'].forEach(sel => {
      root.querySelectorAll(sel).forEach(el => {
        const alpha = colorAlpha(cs(el).backgroundColor);
        if (alpha < 0.98) flag('translucent-overlay', describe(el), { backgroundColor: cs(el).backgroundColor });
      });
    });

    // C15 — An icon-only button (no text content) must expose an accessible
    // name; an unlabeled glyph is unannounced by screen readers and silently
    // breaks keyboard understanding of the surface.
    root.querySelectorAll('button').forEach(el => {
      if (!visible(el) || screenReaderOnly(el)) return;
      const hasText = (el.textContent || '').trim().length > 0;
      if (hasText) return;
      const named = (el.getAttribute('aria-label') || '').trim()
        || el.hasAttribute('aria-labelledby')
        || (el.getAttribute('title') || '').trim();
      const hasGlyph = !!el.querySelector('svg,img,[class*="avatar"]');
      if (hasGlyph && !named) flag('icon-button-unlabeled', describe(el));
    });

    // C16 — Scrollbars are quiet infrastructure, never UA admin chrome.
    // Every scrolling surface inside the frame must opt into the thin
    // grammar: a <=10px gutter with a transparent track and a low-alpha
    // thumb. The recurring defect was the default thick solid gray bar
    // painting beside the contact list ("可以跑火车了").
    // One grammar across TWO scopes: product surfaces inside .sk-theme and
    // the harness preview host (.prototype-portal-preview-body), which is an
    // ancestor of .sk-shell and therefore invisible to root.querySelectorAll —
    // it previously kept the UA-default thick gutter.
    const quietScrollbarOn = el => {
      const s = cs(el);
      if (!['auto', 'scroll'].includes(s.overflowY) && !['auto', 'scroll'].includes(s.overflowX)) return;
      const bar = getComputedStyle(el, '::-webkit-scrollbar');
      const gutter = parseFloat(bar.width) || 0;
      if (gutter > 10) flag('loud-scrollbar-gutter', describe(el), { width: bar.width });
      const track = getComputedStyle(el, '::-webkit-scrollbar-track');
      const trackAlpha = colorAlpha(track.backgroundColor);
      if (trackAlpha > 0.05) flag('painted-scrollbar-track', describe(el), { track: track.backgroundColor });
      const thumb = getComputedStyle(el, '::-webkit-scrollbar-thumb');
      const thumbAlpha = colorAlpha(thumb.backgroundColor);
      if (thumbAlpha > 0.4) flag('loud-scrollbar-thumb', describe(el), { thumb: thumb.backgroundColor, alpha: thumbAlpha });
    };
    root.querySelectorAll('*').forEach(el => {
      if (el.closest('.sk-theme')) quietScrollbarOn(el);
    });
    document.querySelectorAll('.prototype-portal-preview-body').forEach(quietScrollbarOn);

    // C17 — A floating layer (menu/popover/tooltip) is portaled OUTSIDE the
    // app frame (.sk-shell), so viewport clamping alone let a menu opened near
    // the rail paint over the outer page. Its rect must stay within the frame
    // that clips its anchor. Dialogs/drawers are modal centering layers that
    // may cover the viewport, so they are intentionally excluded.
    (() => {
      const frame = document.querySelector('.sk-shell');
      if (!frame) return;
      const f = box(frame), gap = 4;
      document.querySelectorAll('.pt-overlay.pt-menu,.pt-overlay.pt-popover,.pt-overlay.pt-tooltip')
        .forEach(el => {
          if (!visible(el)) return;
          const r = box(el);
          if (r.left < f.left - gap || r.right > f.right + gap
            || r.top < f.top - gap || r.bottom > f.bottom + gap) {
            flag('overlay-escapes-frame', describe(el), {
              overlay: [r.left, r.top, r.right, r.bottom].map(n => Math.round(n)).join(','),
              frame: [f.left, f.top, f.right, f.bottom].map(n => Math.round(n)).join(','),
            });
          }
        });
    })();

    // C18 — A ghost Select inside a flat settings row is a quiet action: at
    // rest (closed, not hovered) it paints no fill and no visible border.
    // Only hover/open may raise the neutral well. A painted resting box is the
    // bordered-SaaS-input look the ghost variant exists to remove.
    root.querySelectorAll('.pt-select[data-appearance=ghost] .pt-select-trigger').forEach(el => {
      if (!visible(el) || el.getAttribute('aria-expanded') === 'true') return;
      const s = cs(el);
      if (s.hovered) return;
      const bgAlpha = colorAlpha(s.backgroundColor);
      const borderWidth = parseFloat(s.borderTopWidth) || 0;
      const borderAlpha = colorAlpha(s.borderTopColor);
      if (bgAlpha > 0.02 || (borderWidth > 0 && borderAlpha > 0.05)) {
        flag('ghost-select-painted-at-rest', describe(el),
          { bg: s.backgroundColor, borderWidth, border: s.borderTopColor });
      }
    });

    // C19 — Floating surfaces must carry the single surface-in motion contract
    // (opacity + settle), never appear instantly or each define their own
    // transition. Assert the stylesheet actually defines the keyframes and the
    // popover/menu/dialog/drawer rules consume it — a presentational claim
    // must exist in shipped CSS, not only in the token file.
    (() => {
      let hasKeyframes = false, consumesMotion = false;
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try { rules = sheet.cssRules; } catch (error) { continue; }
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          if (rule.type === 7 && rule.name === 'pt-surface-in') hasKeyframes = true;
          const text = rule.cssText || '';
          if (/\\.pt-overlay\\.pt-(popover|menu|dialog|drawer)/.test(text) && /pt-surface-in/.test(text)) {
            consumesMotion = true;
          }
        }
      }
      if (!hasKeyframes || !consumesMotion) {
        flag('overlay-surface-in-missing', 'styles.css', { hasKeyframes, consumesMotion });
      }
    })();

    // C20 — Pine-on-neutral glass discipline: the glass skin's container is a
    // flat NEUTRAL paper floor (channel spread tight), never a green canvas,
    // and the ambient color glow must stay flattened to none. Frosted
    // translucency lives on card surfaces; hue is reserved for pine accents.
    (() => {
      const skin = document.querySelector('.sk-theme.sk-skin-glass');
      if (!skin) return;
      const vars = getComputedStyle(skin);
      const parse = (value) => {
        const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
        if (hex) {
          const d = hex[1];
          return [0, 2, 4].map(i => parseInt(d.slice(i, i + 2), 16));
        }
        const rgb = value.match(/rgba?\\(\\s*([\\d.]+)[\\s,]+([\\d.]+)[\\s,]+([\\d.]+)/);
        return rgb ? rgb.slice(1, 4).map(Number) : null;
      };
      const canvas = parse(vars.getPropertyValue('--sk-canvas'));
      if (canvas) {
        const spread = Math.max(...canvas) - Math.min(...canvas);
        if (spread > 12) {
          flag('glass-canvas-tinted', '.sk-skin-glass --sk-canvas', { canvas: vars.getPropertyValue('--sk-canvas'), spread });
        }
      }
      if (vars.getPropertyValue('--sk-shell-glow').trim() !== 'none') {
        flag('glass-glow-not-flat', '.sk-skin-glass --sk-shell-glow', { glow: vars.getPropertyValue('--sk-shell-glow') });
      }
    })();

    // C21 — Spatial rotation on the moments scope sub-bar: under squeeze the
    // peer controls must NOT wrap. The scope group is a single-line scrollable
    // island (library primitive), driven by a CONTAINER query on the frame
    // width (not the viewport). The old redundant hint text must be gone.
    const subbar = document.querySelector('.sk-moments-subbar');
    if (subbar) {
      if (document.querySelector('.sk-moments-hint')) {
        flag('moments-scope-hint-present', '.sk-moments-hint', {});
      }
      if (cs(subbar).flexWrap !== 'nowrap') {
        flag('moments-subbar-wraps', '.sk-moments-subbar', { flexWrap: cs(subbar).flexWrap });
      }
      const island = subbar.querySelector('.sk-scope-island');
      if (!island || island.getAttribute('data-scrollable') === null) {
        flag('moments-scope-island-missing', '.sk-scope-island[data-scrollable]', {});
      }
      const moments = document.querySelector('.sk-moments');
      if (moments && cs(moments).containerType !== 'inline-size') {
        flag('moments-container-missing', '.sk-moments', { containerType: moments ? cs(moments).containerType : null });
      }
      // Shipped CSS must contain both halves of the contract: the library's
      // scrollable island rule and the frame-driven @container collapse.
      let shippedIsland = false, shippedContainer = false;
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try { rules = sheet.cssRules; } catch (error) { continue; }
        if (!rules) continue;
        const walkRules = (list) => {
          for (const rule of Array.from(list)) {
            const text = rule.cssText || '';
            if (text.includes('[data-scrollable]')) shippedIsland = true;
            if (text.includes('@container') && text.includes('sk-scope-wrap')) shippedContainer = true;
            if (rule.cssRules) walkRules(rule.cssRules);
          }
        };
        walkRules(rules);
      }
      if (!shippedIsland) flag('scrollable-island-css-missing', 'styles.css [data-scrollable]', {});
      if (!shippedContainer) flag('moments-container-css-missing', 'moments.css @container', {});
    }

    // C22 — Settings grouped-card language (Trae parity): titled white cards
    // open immediately under the rail (the active rail item is the subject);
    // there is NO article-style page heading. Cards separate by whitespace,
    // never a flat full-bleed hairline document or a cold SaaS grey floor.
    const settingsSurface = document.querySelector('.sk-settings');
    if (settingsSurface) {
      if (settingsSurface.querySelector('.sk-settings-pagehead, .sk-settings-scroll > h1')) {
        flag('settings-article-pagehead-present', '.sk-settings-pagehead', {});
      }
      const card = settingsSurface.querySelector('.sk-settings-card, .pt-list-section[data-inset] .pt-list-body');
      if (!card) {
        flag('settings-grouped-card-missing', '.sk-settings-card / [data-inset] .pt-list-body', {});
      } else {
        const bg = cs(card).backgroundColor;
        // Forbidden cold SaaS panel grey.
        if (bg === 'rgb(233, 236, 242)') {
          flag('settings-card-cold-grey', '.sk-settings card', { bg });
        }
      }
      // The old flat-document rule (full-bleed top hairline between every
      // section) must not divide the page any more.
      for (const section of Array.from(settingsSurface.querySelectorAll('.sk-settings-section + .sk-settings-section'))) {
        const top = cs(section).borderTopWidth;
        if (top && top !== '0px') {
          flag('settings-flat-section-hairline', '.sk-settings-section + .sk-settings-section', { top });
          break;
        }
      }
    }

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
