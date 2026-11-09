/**
 * Mobile product geometry gate — the ONE north-star product surface.
 *
 * History: this used to drive a second harness skin (mp-* MobileShell,
 * English demo seeds, 4 tabs). That skin is deleted; evidence now injects
 * state into MobileApp and these assertions validate the product UI's
 * geometry, overflow and touch contracts (ma-* + peers-ui primitives).
 *
 * Run:  node scripts/check-layout.mjs
 * Env:  PROTOTYPE_URL=http://localhost:3108 (default; the package dev server)
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const url = process.env.PROTOTYPE_URL ?? 'http://localhost:3108';
const output = resolve(
  repoRoot,
  process.env.PROTOTYPE_EVIDENCE_DIR ?? 'apps/mobile/src-tauri/target/prototype-layout',
);
// Grammar radii (px tolerance): 4 / 6 / 8 / 10 / 11 / 12 / 16 / 20 / 999.
const RADIUS_FAMILY = [4, 5, 6, 8, 10, 11, 12, 16, 20, 999];
const allViewports = [
  { width: 390, height: 844 },
  { width: 554, height: 954 },
  { width: 1440, height: 1100 },
];
// Test affordance: PROTOTYPE_VIEWPORTS=390 runs one viewport for fast
// mutation verification; the default gate still covers every viewport.
const viewports = process.env.PROTOTYPE_VIEWPORTS
  ? allViewports.filter(v => process.env.PROTOTYPE_VIEWPORTS.split(',').map(Number).includes(v.width))
  : allViewports;
await mkdir(output, { recursive: true });

// Static safe-area / viewport contract.
const cssSource = await readFile(
  resolve(repoRoot, 'packages/prototypes/mobile/chat/index.html'), 'utf8');
assert.ok(cssSource.includes('viewport-fit=cover'), 'viewport meta must cover safe areas');
assert.ok(cssSource.includes('interactive-widget=resizes-content'), 'keyboard must resize content');

const browser = await chromium.launch({ headless: true });
const captures = [];
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport, colorScheme: 'light' });
    await page.addInitScript(() => {
      window.__gram = {
        family: [4, 5, 6, 8, 10, 11, 12, 16, 20, 999],
        nearRadius(value) {
          return this.family.some(r => r === 999 ? value >= 999 : Math.abs(value - r) <= 1.2);
        },
      };
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const device = page.getByRole('region', { name: 'Mobile device preview' });

    async function open(scenario) {
      await page.goto(`${url}/?scenario=${scenario}`);
      await device.waitFor();
      await page.waitForTimeout(400);
    }
    const measure = fn => device.evaluate(fn);
    const geometry = { defects: [], details: {} };
    const record = (name, ok, meta = {}) => { if (!ok) geometry.defects.push(meta.id ?? name); };

    // ── Launch (station select + inline gate) ──
    await open('journey');
    geometry.details.launch = await measure(() => {
      const out = { defects: [] };
      const rect = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, r: parseFloat(getComputedStyle(el).borderRadius) };
      };
      const logo = rect(document.querySelector('[data-launch-logo]'));
      if (!logo || Math.abs(logo.w - 64) > 1 || !__gram.nearRadius(logo.r)) out.defects.push('launch-logo-geometry');
      const continueBtn = document.querySelector('[data-action-id="launch.continue"]');
      if (!continueBtn || continueBtn.getBoundingClientRect().height < 43) out.defects.push('launch-continue-short');
      const rows = [...document.querySelectorAll('.ma-station-pick')];
      if (rows.some(el => el.getBoundingClientRect().height < 52)) out.defects.push('station-target-under-52');
      // The select phase carries no redundant subtitle (title + list already
      // explain themselves); the manual add-station entry must be present.
      if (document.querySelectorAll('.ma-launch-brand p').length !== 0) out.defects.push('launch-redundant-subtitle');
      if (!document.querySelector("[data-action-id='launch.station.add']")) out.defects.push('launch-add-station-missing');
      if (document.querySelector('[class*="ant-"]')) out.defects.push('antd-residue');
      return out;
    });
    record('launch', geometry.details.launch.defects.length === 0, { id: geometry.details.launch.defects[0] });

    // ── Launch add-station mirrors the real device contract: ONE Station URL
    // input (no name field); label is derived from the host. Empty → disabled,
    // malformed → invalid, plain HTTP → warning, valid → added+selected. ──
    const initialRows = await device.locator('.ma-station-pick').count();
    const urlInput = "input[aria-label='Station 或私密连接']";
    await device.locator("[data-action-id='launch.station.add']").click();
    await page.waitForTimeout(250);
    const addEmpty = await measure(() => {
      const out = { defects: [] };
      const dlg = document.querySelector('.pt-modal-layer .pt-dialog');
      if (!dlg) { out.defects.push('add-dialog-missing'); return out; }
      // A single URL field; the legacy name/address two-field form must not exist.
      if (dlg.querySelectorAll('.ma-station-form input').length !== 1) out.defects.push('add-not-single-url-field');
      const confirm = dlg.querySelector("[data-action-id='launch.station.add.confirm']");
      if (confirm?.getAttribute('aria-disabled') !== 'true') out.defects.push('add-confirm-enabled-when-empty');
      return out;
    });
    record('launch-add-empty-disabled', addEmpty.defects.length === 0, { id: addEmpty.defects[0] });
    // Malformed (no scheme) → invalid + disabled.
    await device.locator(urlInput).fill('station.local');
    await page.waitForTimeout(150);
    const addInvalid = await measure(() => {
      const out = { defects: [] };
      const dlg = document.querySelector('.pt-modal-layer .pt-dialog');
      const input = dlg?.querySelector('.ma-station-form input');
      if (input?.getAttribute('aria-invalid') !== 'true') out.defects.push('add-invalid-url-not-flagged');
      const confirm = dlg?.querySelector("[data-action-id='launch.station.add.confirm']");
      if (confirm?.getAttribute('aria-disabled') !== 'true') out.defects.push('add-confirm-enabled-on-invalid');
      return out;
    });
    record('launch-add-invalid-url', addInvalid.defects.length === 0, { id: addInvalid.defects[0] });
    // Valid plain-HTTP URL → warning shown, submit enabled.
    await device.locator(urlInput).fill('http://gate.local:18080');
    await page.waitForTimeout(150);
    const addHttp = await measure(() => {
      const out = { defects: [] };
      const dlg = document.querySelector('.pt-modal-layer .pt-dialog');
      if (!dlg.querySelector('[data-http-warning]')) out.defects.push('add-http-warning-missing');
      const confirm = dlg?.querySelector("[data-action-id='launch.station.add.confirm']");
      if (confirm?.getAttribute('aria-disabled') === 'true') out.defects.push('add-confirm-disabled-on-valid-http');
      return out;
    });
    record('launch-add-http-warning', addHttp.defects.length === 0, { id: addHttp.defects[0] });
    await device.locator("[data-action-id='launch.station.add.confirm']").click();
    await page.waitForTimeout(250);
    const afterRows = await device.locator('.ma-station-pick').count();
    const addDone = await measure(() => {
      const out = { defects: [] };
      if (document.querySelector('.pt-modal-layer .pt-dialog')) out.defects.push('add-dialog-not-closed');
      // Label is DERIVED from the URL host (hostname:port), never user-typed.
      const picked = document.querySelector('.ma-station-pick.is-selected strong');
      if (!picked || picked.textContent.trim() !== 'gate.local:18080') out.defects.push('add-label-not-derived-from-host');
      const cta = document.querySelector("[data-action-id='launch.continue']");
      if (!cta?.textContent.includes('gate.local:18080')) out.defects.push('add-cta-not-updated');
      return out;
    });
    record('launch-add-station-loop', addDone.defects.length === 0 && afterRows === initialRows + 1,
      { id: addDone.defects[0] ?? (afterRows === initialRows + 1 ? null : `add-row-count:${afterRows}`) });

    // ── Scan-to-link: a full-screen camera surface with the reticle centred
    // on the screen (never a bottom sheet) — scanning belongs at optical centre.
    await device.locator("[data-action-id='launch.scan']").click();
    await page.waitForTimeout(300);
    geometry.details.launchScan = await measure(() => {
      const out = { defects: [] };
      const overlay = document.querySelector('[data-scan-overlay]');
      const root = document.querySelector('.ma-root');
      if (!overlay || !root) { out.defects.push('scan-overlay-missing'); return out; }
      const o = overlay.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      // Full-screen, anchored to .ma-root (covers the status bar).
      if (Math.abs(o.top - r.top) > 2) out.defects.push('scan-not-fullscreen-top');
      if (Math.abs(o.height - r.height) > 4) out.defects.push('scan-not-fullscreen-height');
      if (o.width < r.width - 4) out.defects.push('scan-not-fullscreen-width');
      // Reticle geometrically centred on the screen, not docked to the bottom.
      const frame = document.querySelector('[data-scan-frame]');
      if (!frame) { out.defects.push('scan-frame-missing'); return out; }
      const f = frame.getBoundingClientRect();
      const centreY = o.top + o.height / 2;
      const frameCentreY = f.top + f.height / 2;
      if (Math.abs(frameCentreY - centreY) > o.height * 0.08) out.defects.push('scan-reticle-not-centred');
      if (Math.abs(f.width - f.height) > 1) out.defects.push('scan-reticle-not-square');
      // Corner brackets present; the old docked bottom-sheet form must not exist.
      if (overlay.querySelectorAll('.ma-scan-corner').length !== 4) out.defects.push('scan-corners-missing');
      if (document.querySelector('.ma-scan-sheet')) out.defects.push('scan-bottom-sheet-regression');
      // Reticle sits in the upper/middle band, never the bottom third.
      if (f.top > o.top + o.height * 0.62) out.defects.push('scan-reticle-in-bottom-third');
      return out;
    });
    record('launch-scan', geometry.details.launchScan.defects.length === 0, { id: geometry.details.launchScan.defects[0] });
    await device.locator("[data-action-id='launch.scan.close']").click();
    await page.waitForTimeout(250);

    // ── Access gate: handshake → Station-advertised decision → GRANTED ──
    await device.getByRole('button', { name: /打开/ }).click();
    await device.locator('[data-handshake]').waitFor({ timeout: 2000 });
    await device.locator('[data-access-gate]').waitFor({ timeout: 4000 });
    const gateMounted = await measure(() => {
      const out = { defects: [] };
      const gate = document.querySelector('[data-access-gate]');
      if (!gate) { out.defects.push('gate-not-mounted'); return out; }
      // The gate replaces the product shell: no tab bar while unadmitted.
      if (document.querySelector('.pt-mobile-tabbar')) out.defects.push('tabbar-visible-behind-gate');
      // The fabricated username/passkey form must never return.
      if (gate.textContent?.includes('通行密钥') || gate.textContent?.includes('本机身份')) {
        out.defects.push('fabricated-passkey-form');
      }
      // Login gate advertises BOTH credentials: quick (OAuth) + email tabs.
      if (!gate.querySelector('[data-oauth-panel]')) out.defects.push('oauth-panel-missing');
      if (!gate.querySelector('[data-email-panel]')) out.defects.push('email-panel-missing');
      if (!gate.querySelector("[data-action-id='auth.oauth.github']")
        || !gate.querySelector("[data-action-id='auth.oauth.google']")) {
        out.defects.push('oauth-provider-missing');
      }
      if (!gate.querySelector("[data-action-id='segment.email']")
        || !gate.querySelector("[data-action-id='segment.quick']")) {
        out.defects.push('login-tabs-missing');
      }
      return out;
    });
    record('gate-mounted-after-handshake', gateMounted.defects.length === 0, { id: gateMounted.defects[0] });

    // canLogin rule: email+password empty → sign in disabled; filling both
    // enables it, and the admitted shell replaces the gate.
    await device.locator("[data-action-id='segment.email']").click();
    await page.waitForTimeout(200);
    const signinDisabled = await measure(() => {
      const signin = document.querySelector("[data-action-id='auth.signin']");
      const email = document.querySelector('[data-email-panel] input[type="email"], [data-email-panel] input[inputmode="email"]');
      const password = document.querySelector('[data-email-panel] input[type="password"]');
      const out = { defects: [] };
      if (!email || !password) { out.defects.push('email-or-password-field-missing'); return out; }
      if (signin?.getAttribute('aria-disabled') !== 'true') out.defects.push('signin-enabled-when-empty');
      // Exactly two credential fields — no third username input.
      const inputs = document.querySelectorAll('[data-email-panel] input');
      if (inputs.length !== 2) out.defects.push(`credential-field-count:${inputs.length}`);
      return out;
    });
    record('gate-signin-disabled-empty', signinDisabled.defects.length === 0, { id: signinDisabled.defects[0] });
    await device.getByLabel('邮箱地址').fill('linye@songlv.local');
    await device.getByLabel('密码').fill('demo-pass');
    await page.waitForTimeout(150);
    const signinReady = await measure(() => {
      const signin = document.querySelector("[data-action-id='auth.signin']");
      return signin?.getAttribute('aria-disabled') === 'true'
        ? { defects: ['signin-still-disabled'] }
        : { defects: [] };
    });
    record('gate-signin-enabled-filled', signinReady.defects.length === 0, { id: signinReady.defects[0] });
    await device.locator("[data-action-id='auth.signin']").click();
    await page.waitForTimeout(400);
    const admitted = await measure(() => {
      const out = { defects: [] };
      if (document.querySelector('[data-access-gate]')) out.defects.push('gate-still-mounted-after-grant');
      if (!document.querySelector('.ma-conv-item, .ma-rail-header')) out.defects.push('shell-not-admitted');
      return out;
    });
    record('gate-grant-admits-shell', admitted.defects.length === 0, { id: admitted.defects[0] });

    // ── Chat list (desktop ChatRail parity) ──
    geometry.details.chatList = await measure(() => {
      const out = { defects: [] };
      const rows = [...document.querySelectorAll('.ma-conv-item')];
      if (!rows.length) out.defects.push('no-conversations');
      rows.slice(0, 8).forEach(r => { if (r.getBoundingClientRect().height < 58) out.defects.push('conversation-row-under-58'); });
      // Header is the 52px compact icon segmented, not a titled page.
      const header = document.querySelector('.ma-rail-header');
      if (header && Math.abs(header.getBoundingClientRect().height - 52) > 1) out.defects.push('rail-header-not-52');
      // Avatars: square, rounded (never circular), group = member composite.
      const avatars = [...document.querySelectorAll('.ma-conv-item .pt-avatar')];
      avatars.slice(0, 8).forEach(el => {
        const r = el.getBoundingClientRect();
        const radius = parseFloat(getComputedStyle(el).borderRadius);
        if (Math.abs(r.width - r.height) > 1) out.defects.push('avatar-not-square');
        if (radius >= r.width / 2 - 0.5) out.defects.push('avatar-circular');
      });
      if (!document.querySelector('.pt-group-avatar[data-columns]')) out.defects.push('group-composite-missing');
      // Rail header primary/secondary split (主在前，次靠右):
      // 1) the nav segmented hugs its options and its labels NEVER wrap;
      // 2) the primary track never stretches into a wide empty bar;
      // 3) the last tool tile (＋) sits on the header's content right edge.
      const railHeader = document.querySelector('.ma-rail-header');
      const seg = document.querySelector('.ma-chat-subnav.pt-segmented');
      if (railHeader && seg) {
        const segRect = seg.getBoundingClientRect();
        const segStyle = getComputedStyle(seg);
        const options = [...seg.querySelectorAll('.pt-button')];
        let needed = parseFloat(segStyle.paddingLeft) + parseFloat(segStyle.paddingRight)
          + (parseFloat(segStyle.gap) || 0) * (options.length - 1);
        options.forEach(option => {
          const optionStyle = getComputedStyle(option);
          const content = option.querySelector('.pt-button-content');
          const contentRect = content?.getBoundingClientRect();
          if (contentRect && contentRect.height > 26) out.defects.push('segmented-label-wrapped');
          needed += (contentRect?.width ?? option.getBoundingClientRect().width)
            + parseFloat(optionStyle.paddingLeft) + parseFloat(optionStyle.paddingRight);
        });
        if (segRect.width - needed > 16) out.defects.push('segmented-track-stretched');
        const hr = railHeader.getBoundingClientRect();
        const padRight = parseFloat(getComputedStyle(railHeader).paddingRight) || 0;
        const plus = railHeader.querySelector('[data-action-id="ma.new-menu"]')?.getBoundingClientRect();
        if (!plus || Math.abs(plus.right - (hr.right - padRight)) > 2) out.defects.push('tool-tile-not-right-aligned');
      }
      return out;
    });
    record('chat-list', geometry.details.chatList.defects.length === 0, { id: geometry.details.chatList.defects[0] });

    // ── In-place rail search morph (never a page) ──
    await device.locator('.ma-rail-header button[aria-label="搜索"]').click();
    await page.waitForTimeout(250);
    // Type first: the in-field clearable ✕ only renders with a non-empty value,
    // so the "no double cross" assertion must run in the typed state.
    await device.locator('.ma-rail-search input').fill('x');
    await page.waitForTimeout(150);
    geometry.details.search = await measure(() => {
      const out = { defects: [] };
      const field = document.querySelector('.ma-rail-search .pt-field-frame');
      if (!field) out.defects.push('search-did-not-morph');
      else if (Math.abs(field.getBoundingClientRect().height - 34) > 1) out.defects.push('search-field-not-34');
      if (document.querySelector('.pt-mobile-navbar-title')) out.defects.push('search-navigated-to-page');
      // One cancel affordance only: no in-field clearable ✕ next to the cancel button.
      if (field?.querySelector("[data-action-id='field.clear']")) out.defects.push('search-double-cross');
      if (document.querySelectorAll('.ma-rail-header .ma-search-cancel').length !== 1) out.defects.push('search-cancel-missing');
      return out;
    });
    record('search', geometry.details.search.defects.length === 0, { id: geometry.details.search.defects[0] });
    await device.locator("[data-action-id='ma.rail-search-close']").click().catch(() => {});
    await page.waitForTimeout(150);

    // ── Thread ──
    await device.locator('.ma-conv-item').first().click();
    await page.waitForTimeout(400);
    geometry.details.thread = await measure(() => {
      const out = { defects: [] };
      const viewport = document.querySelector('.ma-messages');
      if (!viewport) { out.defects.push('no-thread-viewport'); return out; }
      if (viewport.scrollWidth > viewport.clientWidth + 1) out.defects.push('thread-horizontal-overflow');
      const mine = document.querySelector('.ma-msg.mine');
      if (mine && getComputedStyle(mine).flexDirection !== 'row-reverse') out.defects.push('own-bubble-not-right');
      const peer = document.querySelector('.ma-msg.peer .ma-bubble');
      if (peer && !__gram.nearRadius(parseFloat(getComputedStyle(peer).borderRadius))) out.defects.push('peer-bubble-radius');
      return out;
    });
    // Send a message, then assert the own row carries its right-side avatar
    // and stays right-aligned (regression guard for the dropped self avatar).
    const box = device.getByRole('textbox', { name: '消息' });
    await box.fill('门禁自检消息');
    await device.locator('[data-action-id="ma.send"]').click();
    await page.waitForTimeout(300);
    const ownRow = await measure(() => {
      const out = { defects: [] };
      const row = document.querySelector('.ma-msg.mine:last-of-type')
        ?? [...document.querySelectorAll('.ma-msg.mine')].pop();
      if (!row) { out.defects.push('no-own-message'); return out; }
      const av = row.querySelector('.pt-avatar');
      if (!av) out.defects.push('own-avatar-missing');
      else {
        const r = av.getBoundingClientRect();
        if (Math.abs(r.width - 32) > 1) out.defects.push('own-avatar-not-32');
      }
      const dir = getComputedStyle(row).flexDirection;
      if (dir !== 'row-reverse') out.defects.push('own-not-right-aligned');
      return out;
    });
    record('own-message', ownRow.defects.length === 0, { id: ownRow.defects[0] });
    record('thread', geometry.details.thread.defects.length === 0, { id: geometry.details.thread.defects[0] });

    // ── Message long-press action system (desktop hover bar → touch sheet) ──
    // Hold a PEER bubble: the catalog-derived sheet opens with 8 quick
    // reactions, reply/forward and the peer long tail (no edit/recall).
    const peerBubble = device.locator('.ma-msg.peer .ma-bubble').first();
    await peerBubble.hover();
    await page.mouse.down();
    await page.waitForTimeout(520);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const peerSheet = await measure(() => {
      const out = { defects: [] };
      const sheet = document.querySelector('[data-msg-action-sheet]');
      if (!sheet) { out.defects.push('action-sheet-missing'); return out; }
      if (sheet.getAttribute('data-mine') !== '0') out.defects.push('peer-sheet-mine-flag');
      if (sheet.querySelectorAll('.ma-react-emoji').length !== 8) out.defects.push('quick-reactions-not-8');
      const text = sheet.textContent ?? '';
      for (const label of ['在话题中回复', '复制文本', '多选', '稍后处理', '举报', '仅对我隐藏']) {
        if (!text.includes(label)) out.defects.push(`peer-action-missing:${label}`);
      }
      if (text.includes('编辑')) out.defects.push('peer-has-edit');
      if (text.includes('撤回')) out.defects.push('peer-has-recall');
      // Quiet danger rows stay flat (red text/icon only) — a resting red
      // outline box is banned SaaS chrome on the flat sheet language.
      const dangerRow = sheet.querySelector('.ma-sheet-row.is-danger');
      if (!dangerRow) {
        out.defects.push('danger-row-missing');
      } else {
        const dangerStyle = getComputedStyle(dangerRow);
        for (const edge of ['top', 'right', 'bottom', 'left']) {
          const value = dangerStyle.getPropertyValue(`border-${edge}-color`).trim();
          if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
            out.defects.push(`danger-row-bordered-${edge}:${value}`);
            break;
          }
        }
      }
      return out;
    });
    record('msg-action-sheet-peer', peerSheet.defects.length === 0, { id: peerSheet.defects[0] });

    // Expanded reactions: all 16 kinds must form a strict 8-column × 2-row
    // grid whose two rows share column edges, and the collapse toggle must
    // never occupy a reaction cell (it sits below the grid).
    await device.locator("[data-action-id='msg.react.expand']").click();
    await page.waitForTimeout(250);
    const reactionGrid = await measure(() => {
      const out = { defects: [] };
      const strip = document.querySelector('.ma-react-strip');
      if (strip.querySelector('.ma-react-all')) out.defects.push('toggle-inside-reaction-strip');
      const cells = [...strip.querySelectorAll('.ma-react-emoji')];
      if (cells.length !== 16) { out.defects.push(`expanded-reactions:${cells.length}`); return out; }
      const byTop = new Map();
      for (const cell of cells) {
        const r = cell.getBoundingClientRect();
        const key = Math.round(r.top);
        if (!byTop.has(key)) byTop.set(key, []);
        byTop.get(key).push(Math.round(r.left));
      }
      const tops = [...byTop.keys()].sort((a, b) => a - b);
      if (tops.length !== 2) { out.defects.push(`reaction-rows:${tops.length}`); return out; }
      const rowA = byTop.get(tops[0]);
      const rowB = byTop.get(tops[1]);
      if (rowA.length !== 8 || rowB.length !== 8) out.defects.push(`reaction-cells-per-row:${rowA.length}/${rowB.length}`);
      if (rowA.some((left, i) => Math.abs(left - rowB[i]) > 1)) out.defects.push('reaction-columns-misaligned');
      const widths = new Set(cells.map(c => Math.round(c.getBoundingClientRect().width)));
      if (widths.size !== 1) out.defects.push('reaction-cell-widths-differ');
      return out;
    });
    record('msg-react-expanded-grid', reactionGrid.defects.length === 0, { id: reactionGrid.defects[0] });
    // Collapse back to the quick row before the like/unlike flow.
    await device.locator("[data-action-id='msg.react.expand']").click();
    await page.waitForTimeout(200);

    // React from the sheet → a pill settles under the bubble; tapping again
    // removes it (multi-select toggle, same state contract as desktop).
    await device.locator('[data-action-id="msg.react.like"]').click();
    await page.waitForTimeout(200);
    const reaction = await measure(() => {
      const out = { defects: [] };
      const chip = document.querySelector('.ma-msg.peer .ma-msg-reaction[data-reaction-kind="like"]');
      if (!chip) { out.defects.push('reaction-chip-missing'); return out; }
      if (chip.getAttribute('data-mine') !== '1') out.defects.push('reaction-not-mine');
      return out;
    });
    record('msg-react-toggle', reaction.defects.length === 0, { id: reaction.defects[0] });
    // Guarded: a broken reducer must surface as a recorded defect here, not as
    // an uncaught 30s Playwright timeout that aborts the whole gate run.
    const likeChip = device.locator('.ma-msg.peer .ma-msg-reaction[data-reaction-kind="like"]');
    if (await likeChip.count() === 0) {
      record('msg-react-untoggle', false, { id: 'reaction-chip-missing' });
    } else {
      await likeChip.click();
      await page.waitForTimeout(150);
      const untoggled = await measure(() => {
        const chip = document.querySelector('.ma-msg.peer .ma-msg-reaction[data-reaction-kind="like"]');
        return chip ? { defects: ['reaction-still-present-after-untap'] } : { defects: [] };
      });
      record('msg-react-untoggle', untoggled.defects.length === 0, { id: untoggled.defects[0] });
    }

    // Reply quick row reveals the composer quote strip; sending yields a
    // quoted bubble, then the strip clears.
    await peerBubble.hover();
    await page.mouse.down();
    await page.waitForTimeout(520);
    await page.mouse.up();
    await page.waitForTimeout(250);
    await device.locator('[data-action-id="msg.action.reply"]').click();
    await page.waitForTimeout(200);
    const replyQuote = await measure(() => {
      const strip = document.querySelector('[data-composer-quote="reply"]');
      return strip ? { defects: [] } : { defects: ['reply-strip-missing'] };
    });
    record('msg-reply-strip', replyQuote.defects.length === 0, { id: replyQuote.defects[0] });
    await device.getByRole('textbox', { name: '消息' }).fill('门禁引用回复');
    await device.locator('[data-action-id="ma.send"]').click();
    await page.waitForTimeout(300);
    const quoted = await measure(() => {
      const out = { defects: [] };
      const last = [...document.querySelectorAll('.ma-msg.mine')].pop();
      if (!last?.querySelector('[data-msg-quote]')) out.defects.push('quote-block-missing');
      if (document.querySelector('[data-composer-quote]')) out.defects.push('reply-strip-not-cleared');
      return out;
    });
    record('msg-quote-bubble', quoted.defects.length === 0, { id: quoted.defects[0] });

    // Own fresh message sheet carries edit/recall but never report.
    const ownBubble = device.locator('.ma-msg.mine .ma-bubble').last();
    await ownBubble.hover();
    await page.mouse.down();
    await page.waitForTimeout(520);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const ownSheet = await measure(() => {
      const out = { defects: [] };
      const sheet = document.querySelector('[data-msg-action-sheet]');
      if (!sheet) { out.defects.push('action-sheet-missing'); return out; }
      if (sheet.getAttribute('data-mine') !== '1') out.defects.push('own-sheet-peer-flag');
      const text = sheet.textContent ?? '';
      for (const label of ['置顶消息', '编辑', '撤回']) {
        if (!text.includes(label)) out.defects.push(`own-action-missing:${label}`);
      }
      if (text.includes('举报')) out.defects.push('own-has-report');
      const edit = sheet.querySelector('[data-action-id="msg.action.edit"]');
      const recall = sheet.querySelector('[data-action-id="msg.action.recall"]');
      if (edit?.getAttribute('aria-disabled') === 'true') out.defects.push('edit-disabled-in-window');
      if (recall?.getAttribute('aria-disabled') === 'true') out.defects.push('recall-disabled-in-window');
      return out;
    });
    record('msg-action-sheet-own', ownSheet.defects.length === 0, { id: ownSheet.defects[0] });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // ── Thread composer: ONE framed box (desktop .sk-composer anatomy). All
    // five controls — emoji, file attach, voice, expand, send — live inside the
    // single rounded host; there is NO scissors/screenshot control. ──
    const composer = await device.evaluate(() => {
      const out = { defects: [] };
      const bar = document.querySelector('.ma-composer');
      if (!bar) { out.defects.push('no-composer'); return out; }
      const framed = ['ma.chat.emoji', 'ma.chat.attach', 'ma.chat.voice', 'ma.chat.expand', 'ma.send'];
      for (const id of framed) {
        if (!bar.querySelector(`[data-action-id="${id}"]`)) out.defects.push(`control-outside-frame:${id}`);
      }
      // Scissors was explicitly removed; it must never reappear in the frame.
      if (document.querySelector('[data-action-id="ma.chat.screenshot"]')) out.defects.push('screenshot-present');
      const field = bar.querySelector('.pt-field-frame');
      if (!field || field.getBoundingClientRect().width < 180) out.defects.push('composer-input-not-filling');
      if (!bar.querySelector('textarea.pt-textarea')) out.defects.push('composer-not-textarea');
      const send = bar.querySelector('[data-action-id="ma.send"]');
      if (send && send.getAttribute('aria-disabled') !== 'true') out.defects.push('send-enabled-when-empty');
      return out;
    });
    record('composer', composer.defects.length === 0, { id: composer.defects[0] });
    // Emoji popover exposes the SHARED COMPOSER catalog (40 general emojis),
    // never the 16-kind chat-domain reaction set. Its width is DERIVED from the
    // 8-column grid (cols*cell + gaps + panel padding), not a hand-set pixel.
    await device.locator('[data-action-id="ma.chat.emoji"]').click();
    await page.waitForTimeout(250);
    const emojiPalette = await measure(() => {
      const out = { defects: [] };
      const panel = document.querySelector('[data-emoji-panel]');
      if (!panel) { out.defects.push('emoji-panel-missing'); return out; }
      const grid = panel.querySelector('.ma-emoji-group:last-child .ma-emoji-grid');
      const cells = grid?.querySelectorAll('.ma-chat-emoji-cell') ?? [];
      if (cells.length !== 40) out.defects.push(`emoji-catalog-count:${cells.length}`);
      // First general emoji is 😀; the reaction catalog starts with 👍 — this
      // guards against the composer palette silently reusing reactions again.
      if (cells[0]?.textContent.trim() !== '😀') out.defects.push('emoji-catalog-is-reactions');
      // A general-only emoji (😎) must be present; it is not in REACTION_CATALOG.
      const labels = [...panel.querySelectorAll('.ma-chat-emoji-cell')].map(c => c.textContent.trim());
      if (!labels.includes('😎')) out.defects.push('emoji-catalog-too-narrow');
      // Width must equal the grid-derived width (8 cells + 7 gaps + padding).
      const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      const gap = parseFloat(getComputedStyle(grid).columnGap || getComputedStyle(grid).gap) || 0;
      const cellW = cells[0].getBoundingClientRect().width;
      const pcs = getComputedStyle(panel);
      const expected = cols * cellW + (cols - 1) * gap
        + parseFloat(pcs.paddingLeft) + parseFloat(pcs.paddingRight);
      const actual = panel.getBoundingClientRect().width;
      if (Math.abs(actual - expected) > 3) out.defects.push(`emoji-panel-width-undriven:${Math.round(actual)}!=${Math.round(expected)}`);
      if (actual > window.innerWidth + 1) out.defects.push('emoji-panel-overflow-viewport');
      return out;
    });
    record('composer-emoji-palette', emojiPalette.defects.length === 0, { id: emojiPalette.defects[0] });
    await device.locator('[data-action-id="composer.emoji.all.0"]').click();
    await page.waitForTimeout(150);
    const emojiInsert = await measure(() => {
      const out = { defects: [] };
      const panel = document.querySelector('[data-emoji-panel]');
      if (!panel?.querySelector('[data-emoji-recent]')) out.defects.push('emoji-recent-not-recorded');
      const input = document.querySelector('.ma-composer textarea.pt-textarea');
      if (!input || !input.value.includes('😀')) out.defects.push('emoji-not-inserted');
      return out;
    });
    record('composer-emoji-insert', emojiInsert.defects.length === 0, { id: emojiInsert.defects[0] });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    // The single file control opens a menu with exactly 选择文件 / 照相.
    await device.locator('[data-action-id="ma.chat.attach"]').click();
    await page.waitForTimeout(250);
    const attachMenu = await measure(() => {
      const out = { defects: [] };
      const menu = document.querySelector('.pt-menu');
      if (!menu) { out.defects.push('attach-menu-missing'); return out; }
      if (!menu.querySelector('[data-action-id="ma.attach.choose"]')) out.defects.push('choose-file-missing');
      if (!menu.querySelector('[data-action-id="ma.attach.camera"]')) out.defects.push('take-photo-missing');
      const texts = [...menu.querySelectorAll('[role="menuitem"]')].map(i => i.textContent.trim());
      if (!texts.includes('选择文件') || !texts.includes('照相')) out.defects.push('attach-labels-wrong');
      if (menu.querySelectorAll('[role="menuitem"]').length !== 2) out.defects.push('attach-menu-arity');
      return out;
    });
    record('composer-attach-menu', attachMenu.defects.length === 0, { id: attachMenu.defects[0] });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // ── Thread reply sheet exposes the SAME shared emoji palette ──
    await peerBubble.hover();
    await page.mouse.down();
    await page.waitForTimeout(520);
    await page.mouse.up();
    await page.waitForTimeout(250);
    await device.locator('[data-action-id="msg.action.thread"]').click();
    await page.waitForTimeout(300);
    const threadEmojiTool = await measure(() => {
      const out = { defects: [] };
      if (!document.querySelector('[data-thread-sheet]')) { out.defects.push('thread-sheet-missing'); return out; }
      if (!document.querySelector("[data-action-id='ma.thread.emoji']")) out.defects.push('thread-emoji-tool-missing');
      return out;
    });
    record('thread-emoji-tool', threadEmojiTool.defects.length === 0, { id: threadEmojiTool.defects[0] });
    await device.locator("[data-action-id='ma.thread.emoji']").click();
    await page.waitForTimeout(250);
    const threadPalette = await measure(() => {
      const panels = document.querySelectorAll('[data-emoji-panel]');
      const panel = panels[panels.length - 1];
      const out = { defects: [] };
      if (!panel) { out.defects.push('thread-emoji-panel-missing'); return out; }
      const cells = panel.querySelectorAll('.ma-emoji-group:last-child .ma-chat-emoji-cell');
      if (cells.length !== 40) out.defects.push(`thread-emoji-count:${cells.length}`);
      return out;
    });
    record('thread-emoji-palette', threadPalette.defects.length === 0, { id: threadPalette.defects[0] });
    await page.locator("[data-action-id='composer.emoji.all.20']").last().click();
    await page.waitForTimeout(150);
    const threadInsert = await measure(() => {
      const input = document.querySelector('.ma-thread-composer input.pt-input');
      return input && input.value.includes('❤️') ? { defects: [] } : { defects: ['thread-emoji-not-inserted'] };
    });
    record('thread-emoji-insert', threadInsert.defects.length === 0, { id: threadInsert.defects[0] });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await device.getByRole('button', { name: '返回' }).click();
    await page.waitForTimeout(250);

    // ── Contacts (second segment, no chevrons, composite groups) ──
    await device.locator('[data-action-id="segment.contacts"]').click();
    await page.waitForTimeout(300);
    geometry.details.contacts = await measure(() => {
      const out = { defects: [] };
      const rows = [...document.querySelectorAll('.ma-contact-row')];
      if (rows.some(r => r.getBoundingClientRect().height < 52)) out.defects.push('contact-row-under-52');
      if ([...document.querySelectorAll('.ma-contact-row [data-lucide="chevron-right"]')].length) out.defects.push('contact-has-chevron');
      return out;
    });
    record('contacts', geometry.details.contacts.defects.length === 0, { id: geometry.details.contacts.defects[0] });

    // ── + menu REAL flows (add contact / start group; never the search morph) ──
    // Regression guard: the + menu once opened a fake sheet whose items only
    // switched tabs. Every item must now drive a closed loop, and while the
    // bottom sheet is open the tab bar is suppressed (no chrome ghost through
    // the frosted sheet).
    await device.locator('[data-action-id="ma.new-menu"]').click();
    await page.waitForTimeout(200);
    const newMenuItems = await device.locator('.pt-menu [role="menuitem"]').allInnerTexts();
    record('plus-menu-real-actions',
      newMenuItems.includes('添加联系人') && newMenuItems.includes('发起群聊'),
      { id: 'plus-menu-actions' });
    await device.locator('.pt-menu [role="menuitem"]', { hasText: '添加联系人' }).click();
    await page.waitForTimeout(250);
    const addSheet = await measure(() => {
      const out = { defects: [] };
      const title = document.querySelector('.pt-sheet-title')?.textContent;
      if (title !== '添加联系人') out.defects.push('add-sheet-wrong-title');
      // "添加" must NOT be the in-place search morph.
      if (document.querySelector('.ma-rail-search .pt-field-frame')) out.defects.push('add-opened-search');
      // The tab bar is suppressed while the sheet covers its strip.
      if (document.querySelector('.pt-mobile-tabbar')) out.defects.push('tabbar-not-suppressed');
      const confirm = document.querySelector('[data-action-id="contact.add.confirm"]');
      if (confirm?.getAttribute('aria-disabled') !== 'true') out.defects.push('add-enabled-empty');
      return out;
    });
    record('add-contact-sheet', addSheet.defects.length === 0, { id: addSheet.defects[0] });

    await device.getByLabel('联系人昵称').fill('门禁新联系人');
    await page.waitForTimeout(120);
    await device.locator('[data-action-id="contact.add.confirm"]').click();
    await page.waitForTimeout(300);
    const added = await measure(() => {
      const out = { defects: [] };
      if (document.querySelector('.pt-sheet-title')) out.defects.push('sheet-did-not-close');
      const names = [...document.querySelectorAll('.ma-contact-friend strong')].map(e => e.textContent);
      if (!names.includes('门禁新联系人')) out.defects.push('contact-missing-after-add');
      return out;
    });
    record('contact-add-loop', added.defects.length === 0, { id: added.defects[0] });

    // Duplicate name blocks submit.
    await device.locator('[data-action-id="ma.new-menu"]').click();
    await page.waitForTimeout(200);
    await device.locator('.pt-menu [role="menuitem"]', { hasText: '添加联系人' }).click();
    await page.waitForTimeout(250);
    await device.getByLabel('联系人昵称').fill('门禁新联系人');
    await page.waitForTimeout(120);
    const dupBlocked = await measure(() =>
      document.querySelector('[data-action-id="contact.add.confirm"]')?.getAttribute('aria-disabled') === 'true');
    record('contact-duplicate-blocked', dupBlocked, { id: 'duplicate-allowed' });
    await device.locator('[data-action-id="contact.add.cancel"]').click();
    await page.waitForTimeout(200);

    // Start group: pick two people → a real composite group thread opens and
    // the new group conversation lands in the chat list.
    await device.locator('[data-action-id="ma.new-menu"]').click();
    await page.waitForTimeout(200);
    await device.locator('.pt-menu [role="menuitem"]', { hasText: '发起群聊' }).click();
    await page.waitForTimeout(250);
    const pickChip = device.locator('button[data-action-id^="group.pick."]');
    const pickedNames = await pickChip.evaluateAll(nodes => nodes.slice(0, 2).map(el =>
      [...el.querySelector('.pt-button-content').childNodes]
        .filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()));
    await pickChip.nth(0).click();
    await pickChip.nth(1).click();
    await page.waitForTimeout(120);
    const pickLabel = await device.locator('.ma-picker-label').innerText();
    record('group-pick-count', pickLabel === '选择成员 · 2', { id: `pick-label:${pickLabel}` });
    await device.locator('[data-action-id="group.start.confirm"]').click();
    await page.waitForTimeout(400);
    const groupTitle = `${pickedNames[0]}、${pickedNames[1]} 的群聊`;
    // page.evaluate (not locator.evaluate) so the title is the callback's
    // first argument; locator.evaluate would bind it to the anchor element.
    const groupThread = await page.evaluate(title => {
      const out = { defects: [] };
      if (!document.querySelector('.ma-thread')) out.defects.push('group-thread-did-not-open');
      if (!document.querySelector('.ma-thread')?.textContent.includes(title)) out.defects.push('group-title-mismatch');
      return out;
    }, groupTitle);
    record('group-start-thread', groupThread.defects.length === 0, { id: groupThread.defects[0] });
    await device.getByRole('button', { name: '返回' }).click();
    await page.waitForTimeout(300);
    const groupRow = await page.evaluate(title => {
      const out = { defects: [] };
      const row = [...document.querySelectorAll('.ma-conv-item')]
        .find(r => r.querySelector('strong')?.textContent === title);
      if (!row) { out.defects.push('group-missing-in-list'); return out; }
      const columns = row.querySelector('.pt-group-avatar')?.getAttribute('data-columns');
      if (columns !== '2' && columns !== '3') out.defects.push('group-row-no-composite');
      return out;
    }, groupTitle);
    record('group-start-list-row', groupRow.defects.length === 0, { id: groupRow.defects[0] });

    // ── Moments (feed/circles island, 16-kind reactions, card radius) ──
    await device.locator('.pt-mobile-tabbar button[aria-label="动态"]').click();
    await page.waitForTimeout(400);
    geometry.details.moments = await measure(() => {
      const out = { defects: [] };
      const islandText = [...document.querySelectorAll('.ma-scope-island [data-action-id^="segment."]')]
        .map(e => e.textContent.trim()).join('/');
      if (!islandText.includes('动态') || !islandText.includes('圈友')) out.defects.push('scope-island-wrong');
      const cards = [...document.querySelectorAll('.ma-moment')];
      cards.slice(0, 3).forEach(card => {
        if (!__gram.nearRadius(parseFloat(getComputedStyle(card).borderRadius))) out.defects.push('moment-card-radius');
        if (card.scrollWidth > card.clientWidth + 1) out.defects.push('moment-card-overflow');
      });
      // Same primary/secondary split as the chat header: 动态/圈友 labels never
      // wrap; the ＋ tool tile rests on the subbar's content right edge.
      const subbar = document.querySelector('.ma-moments-subbar');
      const island = document.querySelector('.ma-scope-island');
      if (subbar && island) {
        [...island.querySelectorAll('.pt-button')].forEach(option => {
          const contentRect = option.querySelector('.pt-button-content')?.getBoundingClientRect();
          if (contentRect && contentRect.height > 26) out.defects.push('scope-label-wrapped');
        });
        const br = subbar.getBoundingClientRect();
        const padRight = parseFloat(getComputedStyle(subbar).paddingRight) || 0;
        const plus = subbar.querySelector('[data-action-id="moments.compose"]')?.getBoundingClientRect();
        if (!plus || Math.abs(plus.right - (br.right - padRight)) > 2) out.defects.push('tool-tile-not-right-aligned');
      }
      return out;
    });
    record('moments', geometry.details.moments.defects.length === 0, { id: geometry.details.moments.defects[0] });

    // Active moments search REPLACES the whole subbar row: the segmented and
    // ＋ yield, and the field fills the row (only the close tile stays fixed).
    await device.locator("[data-action-id='ma.subbar-search']").click();
    await page.waitForTimeout(250);
    await device.locator('.ma-subbar-search input').fill('x');
    await page.waitForTimeout(150);
    const momentsSearch = await measure(() => {
      const out = { defects: [] };
      const subbar = document.querySelector('.ma-moments-subbar');
      if (!subbar) { out.defects.push('subbar-missing'); return out; }
      if (subbar.getAttribute('data-subbar-search') !== 'active') out.defects.push('search-not-active');
      // Primary controls yield while searching.
      if (subbar.querySelector('.ma-scope-island')) out.defects.push('segmented-not-yielded');
      if (subbar.querySelector("[data-action-id='moments.compose']")) out.defects.push('compose-not-yielded');
      const field = subbar.querySelector('.ma-subbar-search .pt-field-frame');
      if (!field) { out.defects.push('search-field-missing'); return out; }
      const sr = subbar.getBoundingClientRect();
      const fr = field.getBoundingClientRect();
      const cs = getComputedStyle(subbar);
      const innerW = sr.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      // Field must fill the row minus the fixed close tile (>= 80% of inner width).
      if (fr.width < innerW * 0.8) out.defects.push('search-field-not-filling');
      // One cancel affordance only: borderless text cancel, no in-field clearable ✕.
      if (field.querySelector("[data-action-id='field.clear']")) out.defects.push('search-double-cross');
      const cancel = subbar.querySelector('.ma-search-cancel');
      if (!cancel || cancel.textContent.trim() === '') out.defects.push('search-cancel-text-missing');
      return out;
    });
    record('moments-search-fills-row', momentsSearch.defects.length === 0, { id: momentsSearch.defects[0] });
    await device.locator("[data-action-id='ma.subbar-search-close']").click();
    await page.waitForTimeout(200);

    // Back-to-top tile (shown once the feed is scrolled) is a flat quiet
    // icon tile: opaque surface, zero border, no rest shadow — never a framed
    // SaaS FAB over the flat content surface.
    const backToTop = await page.evaluate(() => {
      const out = { defects: [] };
      const scroller = document.querySelector('.ma-moments-scroll');
      if (!scroller) { out.defects.push('moments-scroller-missing'); return out; }
      scroller.scrollTo({ top: scroller.scrollHeight });
      return out;
    });
    await page.waitForTimeout(200);
    const topTile = await measure(() => {
      const out = { defects: [] };
      const tile = document.querySelector('.ma-feed-top');
      if (!tile) { out.defects.push('back-to-top-missing'); return out; }
      const cs = getComputedStyle(tile);
      if (parseFloat(cs.borderTopWidth) !== 0) out.defects.push('back-to-top-framed');
      if (cs.boxShadow !== 'none' && !/rgba?\([^)]*,\s*0\)/.test(cs.boxShadow)) out.defects.push('back-to-top-shadowed');
      if (parseFloat(cs.width) !== 36) out.defects.push('back-to-top-size');
      // The tile floats over scrolling cards: its fill must be opaque so card
      // text can never read through behind the icon.
      const bg = cs.backgroundColor.match(/[\d.]+\)$/);
      const alpha = bg ? parseFloat(bg[0]) : 0;
      if (alpha < 0.99) out.defects.push('back-to-top-transparent');
      return out;
    });
    record('back-to-top-flat-tile', topTile.defects.length === 0, { id: topTile.defects[0] });
    await page.evaluate(() => document.querySelector('.ma-moments-scroll')?.scrollTo({ top: 0 }));
    await page.waitForTimeout(200);
    assert.deepEqual(backToTop.defects, [], 'back-to-top setup');

    // Comment composer is progressive-disclosure on the narrow surface:
    // absent until the reader taps that card's comment action, then present
    // and focused (an empty 写评论 row must never occupy space by default).
    const composersBefore = await measure(() => document.querySelectorAll('.ma-comment-input').length);
    record('comment-composer-hidden-by-default', composersBefore === 0, { id: `composers-default:${composersBefore}` });
    const firstPostId = await measure(() => document.querySelector('.ma-moment')?.getAttribute('data-post-id') ?? '');
    await device.locator(`[data-action-id="moment.comments.${firstPostId}"]`).click();
    await page.waitForTimeout(250);
    const reveal = await measure(() => {
      const out = { defects: [] };
      const input = document.querySelector('.ma-moment .ma-comment-input input');
      if (!input) out.defects.push('composer-not-revealed');
      else if (document.activeElement !== input) out.defects.push('composer-not-focused');
      return out;
    });
    record('comment-composer-tap-reveal', reveal.defects.length === 0, { id: reveal.defects[0] });
    await page.keyboard.press('Escape');

    // Reaction picker exposes the shared 16-kind catalog.
    await device.locator('.ma-moment').first().locator('button[aria-label="添加反应"]').click();
    await page.waitForTimeout(300);
    const reactionCount = await measure(() => document.querySelectorAll('.ma-react-picker button').length);
    record('reactions-16', reactionCount === 16, { id: 'reaction-catalog-count' });
    await page.keyboard.press('Escape');

    // Composer sheet — image attach must be an in-field accessory on the
    // textarea bottom rail (left, opposite the counter), never a standalone
    // pill row floating in empty space.
    await device.getByRole('button', { name: '发动态' }).click();
    await page.waitForTimeout(300);
    geometry.details.composer = await measure(() => {
      const out = { defects: [] };
      const ta = document.querySelector('.pt-bottom-sheet textarea');
      if (!ta || ta.getBoundingClientRect().height < 90) out.defects.push('composer-textarea-short');
      const foot = document.querySelector('.ma-composer-sheet .pt-textarea-foot');
      const pickerInput = document.querySelector('.ma-composer-sheet .pt-textarea-accessory .pt-file-picker input[accept="image/*"]');
      // Geometry uses the VISIBLE icon button; the native input is sr-only.
      const picker = document.querySelector('.ma-composer-sheet .pt-textarea-accessory .pt-file-button');
      const count = document.querySelector('.ma-composer-sheet .pt-textarea-foot .pt-character-count');
      if (!foot || !pickerInput || !picker || !count) out.defects.push('attach-not-in-field-foot');
      else {
        // Accessory icon (left) and counter (right) share one rail and align
        // to the textarea's TEXT content edges (element rect + its padding),
        // not the textarea border box.
        const pr = picker.getBoundingClientRect();
        const cr = count.getBoundingClientRect();
        const tr = ta.getBoundingClientRect();
        const tcs = getComputedStyle(ta);
        const textLeft = tr.left + parseFloat(tcs.paddingLeft);
        const textRight = tr.right - parseFloat(tcs.paddingRight);
        if (Math.abs((pr.top + pr.bottom) / 2 - (cr.top + cr.bottom) / 2) > 6) out.defects.push('attach-counter-not-same-rail');
        if (Math.abs(pr.left - textLeft) > 4) out.defects.push('attach-not-text-left-edge');
        if (cr.right > textRight + 4) out.defects.push('counter-past-text-right-edge');
      }
      if (document.querySelector('.ma-composer-sheet > .pt-file-picker')) out.defects.push('standalone-attach-pill');
      return out;
    });
    record('composer', geometry.details.composer.defects.length === 0, { id: geometry.details.composer.defects[0] });
    await device.getByRole('button', { name: '取消' }).click().catch(() => {});

    // ── Me: identity hero (plant cover + overlapping avatar), credentials
    // demoted to a pushed page, inset white setting wells, standalone danger
    // zone. The long PTID must NEVER render on the first screen. Each clause
    // is its own record so one defect cannot mask the others in the summary.
    await device.locator('.pt-mobile-tabbar button[aria-label="我的"]').click();
    await page.waitForTimeout(400);

    const heroCover = await measure(() => {
      const out = { defects: [] };
      const me = document.querySelector('.ma-me');
      const cover = document.querySelector('[data-hero-cover]');
      if (!me) { out.defects.push('me-page-missing'); return out; }
      if (!cover) { out.defects.push('hero-cover-missing'); return out; }
      const coverStyle = getComputedStyle(cover);
      const coverRect = cover.getBoundingClientRect();
      const meRect = me.getBoundingClientRect();
      if (!coverStyle.backgroundImage.includes('data:image')) out.defects.push('hero-cover-not-artwork');
      // Desktop-symmetric edit chip: iconOnly FilePicker nested in a
      // bottom-right action span (right:12/bottom:12), not a full-bleed overlay.
      const coverInput = cover.querySelector('.ma-hero-cover-action input[type=file]');
      if (!coverInput) out.defects.push('cover-change-action-missing');
      else if (coverInput.getAttribute('accept') !== 'image/*') out.defects.push('cover-change-accept-wrong');
      const coverAction = cover.querySelector('.ma-hero-cover-action')?.getBoundingClientRect();
      if (coverAction) {
        if (coverAction.right - coverRect.right > 1 || coverAction.bottom - coverRect.bottom > 1) {
          out.defects.push('cover-action-outside-cover');
        }
        if (Math.abs((coverRect.right - coverAction.right) - 12) > 3
          || Math.abs((coverRect.bottom - coverAction.bottom) - 12) > 3) {
          out.defects.push('cover-action-not-bottom-right');
        }
      }
      if (cover.querySelector(':scope > .pt-file-picker')) out.defects.push('cover-fullbleed-picker-regression');
      // 134px visual band + 54px immersive status-bar zone the cover runs under.
      if (coverRect.height < 184 || coverRect.height > 192) out.defects.push(`hero-cover-height:${Math.round(coverRect.height)}`);
      if (Math.abs(coverRect.left - meRect.left) > 1 || Math.abs(coverRect.right - meRect.right) > 1) {
        out.defects.push('hero-cover-not-bleeding');
      }
      return out;
    });
    record('me-hero-cover', heroCover.defects.length === 0, { id: heroCover.defects[0] });

    const coverImmersive = await measure(() => {
      const cover = document.querySelector('[data-hero-cover]');
      const bar = document.querySelector('.pt-mobile-statusbar')?.getBoundingClientRect();
      if (!cover || !bar) return { defects: ['statusbar-missing'] };
      return Math.abs(cover.getBoundingClientRect().top - bar.top) <= 1
        ? { defects: [] }
        : { defects: ['hero-cover-not-under-statusbar'] };
    });
    record('me-cover-immersive', coverImmersive.defects.length === 0, { id: coverImmersive.defects[0] });

    const statusbarFloating = await measure(() => {
      const bar = document.querySelector('.pt-mobile-statusbar');
      if (!bar) return { defects: ['statusbar-missing'] };
      return getComputedStyle(bar).position === 'absolute'
        ? { defects: [] }
        : { defects: ['statusbar-not-floating-on-me'] };
    });
    record('me-statusbar-floating', statusbarFloating.defects.length === 0, { id: statusbarFloating.defects[0] });

    const heroAvatar = await measure(() => {
      const out = { defects: [] };
      const cover = document.querySelector('[data-hero-cover]');
      const avatarWrap = document.querySelector('[data-hero-avatar]');
      const avatar = avatarWrap?.querySelector('.pt-avatar');
      if (!cover) { out.defects.push('hero-cover-missing'); return out; }
      if (!avatar || !avatarWrap) { out.defects.push('hero-avatar-missing'); return out; }
      const ar = avatar.getBoundingClientRect();
      const coverRect = cover.getBoundingClientRect();
      if (Math.abs(ar.height - 68) > 2) out.defects.push(`hero-avatar-size:${Math.round(ar.height)}`);
      if (!(ar.top < coverRect.bottom && ar.bottom > coverRect.bottom)) out.defects.push('hero-avatar-not-overlapping');
      if (!/0px 0px 0px 3px/.test(getComputedStyle(avatar).boxShadow)) out.defects.push('hero-avatar-ring-missing');
      // Desktop-symmetric chip nested inside the avatar corner (right:6/bottom:6).
      const input = avatarWrap.querySelector('.ma-hero-avatar-action input[type=file]');
      if (!input) { out.defects.push('avatar-change-action-missing'); return out; }
      if (input.getAttribute('accept') !== 'image/*') out.defects.push('avatar-change-accept-wrong');
      const ar2 = avatarWrap.querySelector('.ma-hero-avatar-action').getBoundingClientRect();
      if (ar2.right - ar.right > 1 || ar2.bottom - ar.bottom > 1) out.defects.push('avatar-action-outside-avatar');
      if (Math.abs((ar.right - ar2.right) - 6) > 3 || Math.abs((ar.bottom - ar2.bottom) - 6) > 3) {
        out.defects.push('avatar-action-not-corner');
      }
      if (avatarWrap.querySelector(':scope > .pt-file-picker')) out.defects.push('avatar-fullbleed-picker-regression');
      return out;
    });
    record('me-hero-avatar', heroAvatar.defects.length === 0, { id: heroAvatar.defects[0] });

    // Cross-surface symmetry: the cover and avatar use the SAME library
    // iconOnly FilePicker treatment (identical dark-scrim background, radius,
    // 30px size) — one vocabulary, not two bespoke "plaster" chips.
    const imageEditSymmetry = await measure(() => {
      const out = { defects: [] };
      const coverPicker = document.querySelector('.ma-hero-cover-action .pt-file-picker[data-icon-only=true]');
      const avatarPicker = document.querySelector('.ma-hero-avatar-action .pt-file-picker[data-icon-only=true]');
      if (!coverPicker || !avatarPicker) { out.defects.push('icon-only-picker-missing'); return out; }
      const cb = getComputedStyle(coverPicker.querySelector('.pt-file-button'));
      const ab = getComputedStyle(avatarPicker.querySelector('.pt-file-button'));
      if (cb.backgroundColor !== ab.backgroundColor) out.defects.push('edit-chip-bg-diverged');
      if (cb.borderRadius !== ab.borderRadius) out.defects.push('edit-chip-radius-diverged');
      const cr = coverPicker.querySelector('.pt-file-button').getBoundingClientRect();
      const ar3 = avatarPicker.querySelector('.pt-file-button').getBoundingClientRect();
      if (Math.abs(cr.width - 30) > 2 || Math.abs(ar3.width - 30) > 2) out.defects.push('edit-chip-size-diverged');
      return out;
    });
    record('me-image-edit-symmetric', imageEditSymmetry.defects.length === 0, { id: imageEditSymmetry.defects[0] });

    const heroFacts = await measure(() => {
      const out = { defects: [] };
      for (const hook of ['[data-hero-name]', '[data-hero-tag]', '[data-hero-handle]', '[data-hero-stats]']) {
        if (!document.querySelector(hook)) out.defects.push(`hero-missing:${hook}`);
      }
      return out;
    });
    record('me-hero-facts', heroFacts.defects.length === 0, { id: heroFacts.defects[0] });

    const homePrivacy = await measure(() => {
      const out = { defects: [] };
      const me = document.querySelector('.ma-me');
      if (!me) { out.defects.push('me-page-missing'); return out; }
      if (me.textContent?.includes('ptid:3f9a7c21')) out.defects.push('ptid-leaked-on-first-screen');
      for (const banned of ['MCP', 'AI 服务', '渠道', '机器人', '运行日志']) {
        if (me.textContent?.includes(banned)) out.defects.push(`cropped-entry-present:${banned}`);
      }
      return out;
    });
    record('me-home-privacy', homePrivacy.defects.length === 0, { id: homePrivacy.defects[0] });

    // Four inset WHITE wells (credentials / preferences / network / general),
    // inset from the page edge and separated by whitespace.
    const insetWells = await measure(() => {
      const out = { defects: [] };
      const me = document.querySelector('.ma-me');
      if (!me) { out.defects.push('me-page-missing'); return out; }
      const meRect = me.getBoundingClientRect();
      const wells = [...me.querySelectorAll('.pt-list-section[data-inset=true]')];
      if (wells.length !== 4) out.defects.push(`inset-well-count:${wells.length}`);
      const firstBody = wells[0]?.querySelector('.pt-list-body');
      if (firstBody) {
        const bs = getComputedStyle(firstBody);
        if (bs.backgroundColor !== 'rgb(255, 255, 255)') out.defects.push(`inset-well-not-white:${bs.backgroundColor}`);
        if (parseFloat(bs.borderRadius) < 14) out.defects.push('inset-well-radius');
      }
      const firstRect = wells[0]?.getBoundingClientRect();
      if (firstRect && firstRect.left - meRect.left < 15) out.defects.push('inset-well-full-bleed');
      return out;
    });
    record('me-inset-wells', insetWells.defects.length === 0, { id: insetWells.defects[0] });

    // Standalone danger card; the sign-out row is quiet red with no red box.
    const dangerZone = await measure(() => {
      const out = { defects: [] };
      const danger = document.querySelector('[data-danger-zone]');
      if (!danger) { out.defects.push('danger-zone-missing'); return out; }
      if (getComputedStyle(danger).backgroundColor !== 'rgb(255, 255, 255)') out.defects.push('danger-zone-not-card');
      const btn = danger.querySelector('.pt-button');
      if (!btn) { out.defects.push('signout-missing'); return out; }
      const bcs = getComputedStyle(btn);
      if (bcs.color !== 'rgb(192, 57, 47)') out.defects.push('signout-not-danger-colored');
      if (bcs.borderTopColor !== 'rgba(0, 0, 0, 0)') out.defects.push('signout-framed');
      return out;
    });
    record('me-danger-zone', dangerZone.defects.length === 0, { id: dangerZone.defects[0] });

    // Credential entry pushes a real second page that carries the PTID.
    await device.locator('[data-action-id="me.credentials"]').click();
    await page.waitForTimeout(300);
    const credentials = await measure(() => {
      const out = { defects: [] };
      const page2 = document.querySelector('[data-credentials-page]');
      if (!page2) { out.defects.push('credentials-page-missing'); return out; }
      if (!page2.textContent?.includes('ptid:3f9a7c21')) out.defects.push('ptid-missing-on-credentials');
      if (!document.querySelector('[data-action-id="me.copy-ptid"]')) out.defects.push('copy-ptid-missing');
      if (!document.querySelector('[data-credential="username"]')) out.defects.push('username-row-missing');
      if (document.querySelector('.ma-me')) out.defects.push('me-still-mounted-under-credentials');
      // A pushed detail page keeps the status bar in flow (no immersive cover
      // leaking onto its own nav bar).
      if (getComputedStyle(document.querySelector('.pt-mobile-statusbar')).position !== 'relative') {
        out.defects.push('statusbar-floating-on-detail');
      }
      return out;
    });
    record('me-credentials-push', credentials.defects.length === 0, { id: credentials.defects[0] });
    await device.getByRole('button', { name: '返回' }).click();
    await page.waitForTimeout(250);
    const backHome = await measure(() => {
      const me = document.querySelector('.ma-me');
      return me && !me.textContent?.includes('ptid:3f9a7c21')
        ? { defects: [] }
        : { defects: ['ptid-releaked-after-back'] };
    });
    record('me-home-after-back', backHome.defects.length === 0, { id: backHome.defects[0] });

    // The immersive status bar is Me-only: leaving the tab must restore the
    // status bar to normal flow and push the body back beneath it.
    await device.locator('.pt-mobile-tabbar button[aria-label="消息"]').click();
    await page.waitForTimeout(350);
    const tabRestored = await measure(() => {
      const bar = document.querySelector('.pt-mobile-statusbar');
      const body = document.querySelector('.ma-body');
      if (!bar || !body) return { defects: ['chrome-missing'] };
      const out = { defects: [] };
      if (getComputedStyle(bar).position !== 'relative') out.defects.push('statusbar-still-floating-off-me');
      const br = bar.getBoundingClientRect();
      const bodyTop = body.getBoundingClientRect().top;
      if (Math.abs(bodyTop - br.bottom) > 1) out.defects.push('body-not-restored-under-statusbar');
      return out;
    });
    record('me-statusbar-scoped', tabRestored.defects.length === 0, { id: tabRestored.defects[0] });

    // ── Gate surface matrix: every Station-advertised decision state ──
    // Runs last because each scenario deep-link remounts the product; the
    // default shell is restored before the device-wide geometry assertions.
    await runGateSurfaceMatrix(page, device, measure, record, open);
    await open('default');
    await page.waitForTimeout(300);

    // ── Device-wide: no horizontal overflow, no duplicate skin residue ──
    const overflow = await device.evaluate(el => ({
      scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
      ant: document.querySelectorAll('[class*="ant-"]').length,
      mpSkin: document.querySelectorAll('.mp-shell, .mp-tabbar, .mp-conversation-item, .mp-social-moment').length,
    }));
    record('overflow', overflow.scrollWidth <= overflow.clientWidth + 1, { id: 'horizontal-overflow' });
    record('no-antd', overflow.ant === 0, { id: 'antd-residue' });
    record('single-skin', overflow.mpSkin === 0, { id: 'duplicate-harness-skin' });

    await device.screenshot({ path: resolve(output, `${viewport.width}-grammar.png`), animations: 'disabled' });
    captures.push({ viewport, geometry, errors: [...errors] });
    assert.deepEqual(errors, [], `Runtime errors at ${viewport.width}`);
    await page.close();
  }

  const defects = captures.flatMap(c => c.geometry.defects.map(d => `${c.viewport.width}: ${d}`));
  await writeFile(resolve(output, 'captures.json'), JSON.stringify({
    evidenceType: 'prototype-only',
    grammar: 'pine-mobile-product',
    captures: captures.map(({ viewport, geometry, errors }) => ({ viewport, defects: geometry.defects, details: geometry.details, errors })),
  }, null, 2));
  process.stdout.write(`${JSON.stringify({ captures: captures.length, defects }, null, 2)}\n`);
  assert.equal(defects.length, 0, 'Mobile product geometry');
} finally {
  await browser.close();
}

/**
 * Gate surface matrix — deep-link every Station-advertised decision state and
 * assert the SAME branch predicates the native AccessGateHost uses. Each
 * scenario seeds AppState, so no second skin is involved; failures stay on the
 * gate and only a GRANTED decision admits the shell.
 */
async function runGateSurfaceMatrix(page, device, measure, record, open) {
  const waitGate = () => device.locator('[data-access-gate]').waitFor({ timeout: 4000 });

  // Email-only policy: the Station never advertised OAuth, so the quick panel
  // and the login tabs must not render at all.
  await open('gate-login-email');
  await waitGate();
  const emailOnly = await measure(() => {
    const out = { defects: [] };
    const gate = document.querySelector('[data-access-gate]');
    if (gate?.getAttribute('data-gate-surface') !== 'login') out.defects.push('surface-not-login');
    if (gate?.querySelector('[data-oauth-panel]')) out.defects.push('oauth-rendered-without-advertisement');
    if (gate?.querySelector('.ma-gate-tabs')) out.defects.push('tabs-rendered-for-single-credential');
    if (!gate?.querySelector('[data-email-panel]')) out.defects.push('email-panel-missing');
    return out;
  });
  record('gate-email-only-policy', emailOnly.defects.length === 0, { id: emailOnly.defects[0] });

  // OAuth-only policy: no email credentials, admission lives in the provider
  // buttons; the email sign-in primary must not render.
  await open('gate-login-oauth');
  await waitGate();
  const oauthOnly = await measure(() => {
    const out = { defects: [] };
    const gate = document.querySelector('[data-access-gate]');
    if (!gate?.querySelector('[data-oauth-panel]')) out.defects.push('oauth-panel-missing');
    if (gate?.querySelector('[data-email-panel]')) out.defects.push('email-rendered-without-advertisement');
    if (gate?.querySelector("[data-action-id='auth.signin']")) out.defects.push('email-signin-rendered-oauth-only');
    if (!gate?.querySelector("[data-action-id='auth.oauth.github']")) out.defects.push('github-provider-missing');
    return out;
  });
  record('gate-oauth-only-policy', oauthOnly.defects.length === 0, { id: oauthOnly.defects[0] });

  // Invite gate chain: a wrong code fails the attempt on the same gate; the
  // fixture demo code advances to the advertised login gate (never grants).
  await open('gate-invite');
  await waitGate();
  const inviteMount = await measure(() => {
    const gate = document.querySelector('[data-access-gate]');
    const out = { defects: [] };
    if (gate?.getAttribute('data-gate-surface') !== 'invite') out.defects.push('surface-not-invite');
    if (!gate?.querySelector("[data-action-id='auth.invite.submit']")) out.defects.push('invite-submit-missing');
    return out;
  });
  record('gate-invite-mounted', inviteMount.defects.length === 0, { id: inviteMount.defects[0] });
  await device.getByLabel('邀请码').fill('WRONG-CODE');
  await device.locator("[data-action-id='auth.invite.submit']").click();
  await page.waitForTimeout(200);
  const inviteRejected = await measure(() => {
    const out = { defects: [] };
    if (!document.querySelector('[data-gate-error]')) out.defects.push('invite-error-not-surfaced');
    if (!document.querySelector('[data-access-gate]')) out.defects.push('rejection-left-the-gate');
    return out;
  });
  record('gate-invite-wrong-rejected', inviteRejected.defects.length === 0, { id: inviteRejected.defects[0] });
  await device.getByLabel('邀请码').fill('PEERS-2026');
  await device.locator("[data-action-id='auth.invite.submit']").click();
  await page.waitForTimeout(200);
  const inviteAdvanced = await measure(() => {
    const gate = document.querySelector('[data-access-gate]');
    const out = { defects: [] };
    if (!gate?.querySelector('[data-email-panel]')) out.defects.push('chain-did-not-advance-to-login');
    if (document.querySelector('.pt-mobile-tabbar')) out.defects.push('invite-granted-without-login');
    return out;
  });
  record('gate-invite-advances-chain', inviteAdvanced.defects.length === 0, { id: inviteAdvanced.defects[0] });

  // Schema-driven gate: required checkbox blocks submission until accepted.
  await open('gate-terms');
  await waitGate();
  const termsMount = await measure(() => {
    const out = { defects: [] };
    const gate = document.querySelector('[data-access-gate]');
    if (gate?.getAttribute('data-gate-surface') !== 'schema') out.defects.push('surface-not-schema');
    if (!gate?.querySelector('[data-schema-gate]')) out.defects.push('schema-form-missing');
    return out;
  });
  record('gate-terms-schema-mounted', termsMount.defects.length === 0, { id: termsMount.defects[0] });
  const schemaBefore = await measure(() =>
    document.querySelector("[data-action-id='auth.schema.submit']")?.getAttribute('aria-disabled') === 'true'
      ? { defects: [] }
      : { defects: ['schema-submit-enabled-required-empty'] });
  record('gate-schema-required-fence', schemaBefore.defects.length === 0, { id: schemaBefore.defects[0] });
  await device.locator('.pt-check-label').click();
  await page.waitForTimeout(150);
  const schemaAccepted = await measure(() =>
    document.querySelector("[data-action-id='auth.schema.submit']")?.getAttribute('aria-disabled') === 'true'
      ? { defects: ['schema-submit-still-disabled-after-accept'] }
      : { defects: [] });
  record('gate-schema-submit-unlocks', schemaAccepted.defects.length === 0, { id: schemaAccepted.defects[0] });

  // Unsupported gate (device trust): explanatory fallback with zero inputs.
  await open('gate-unavailable');
  await waitGate();
  const unavailable = await measure(() => {
    const gate = document.querySelector('[data-access-gate]');
    const out = { defects: [] };
    if (gate?.getAttribute('data-gate-surface') !== 'unavailable') out.defects.push('surface-not-unavailable');
    if (gate?.querySelector('input, textarea, select')) out.defects.push('unavailable-gate-has-inputs');
    if (!gate?.querySelector("[data-action-id='auth.change-station']")) out.defects.push('change-station-missing');
    return out;
  });
  record('gate-unavailable-no-inputs', unavailable.defects.length === 0, { id: unavailable.defects[0] });

  // Recovery-only decisions render no submission controls, just retry/change.
  for (const scenario of ['gate-blocked', 'gate-failed', 'gate-pending']) {
    await open(scenario);
    await waitGate();
    const recovery = await measure(() => {
      const gate = document.querySelector('[data-access-gate]');
      const out = { defects: [] };
      if (!gate?.querySelector('[data-gate-recovery]')) out.defects.push('recovery-copy-missing');
      if (gate?.querySelector('input, textarea, select')) out.defects.push('recovery-gate-has-inputs');
      for (const blocked of ['auth.signin', 'auth.invite.submit', 'auth.schema.submit']) {
        if (gate?.querySelector(`[data-action-id='${blocked}']`)) out.defects.push(`recovery-has-${blocked}`);
      }
      if (!gate?.querySelector("[data-action-id='auth.retry']")) out.defects.push('retry-missing');
      return out;
    });
    record(`gate-recovery-${scenario}`, recovery.defects.length === 0, { id: recovery.defects[0] });
  }

  // Session-expired re-auth surfaces the welcome-back notice above login.
  await open('gate-session-expired');
  await waitGate();
  const expired = await measure(() => {
    const out = { defects: [] };
    if (!document.querySelector('[data-session-expired]')) out.defects.push('session-expired-notice-missing');
    return out;
  });
  record('gate-session-expired-notice', expired.defects.length === 0, { id: expired.defects[0] });

  // Login failure stays on the gate with an inline error (no shell admission).
  await open('gate-login-failed');
  await waitGate();
  const loginFailed = await measure(() => {
    const out = { defects: [] };
    if (!document.querySelector('[data-gate-error]')) out.defects.push('login-error-missing');
    if (!document.querySelector('[data-access-gate]')) out.defects.push('error-left-the-gate');
    return out;
  });
  record('gate-login-failed-inline', loginFailed.defects.length === 0, { id: loginFailed.defects[0] });

  // OAuth progress exposes the phase message and an in-flow cancel action.
  await open('gate-oauth-progress');
  await waitGate();
  // The seeded evidence phase must stay FROZEN across a full timer window;
  // a user-unstarted flow never drives the phase machine.
  await page.waitForTimeout(900);
  const oauthProgress = await measure(() => {
    const state = document.querySelector('.ma-gate-oauth-state');
    const out = { defects: [] };
    if (!state) { out.defects.push('oauth-state-missing'); return out; }
    if (state.getAttribute('data-oauth-phase') !== 'awaiting_provider') out.defects.push('oauth-phase-wrong');
    if (!state.querySelector("[data-action-id='auth.oauth.cancel']")) out.defects.push('oauth-cancel-missing');
    return out;
  });
  record('gate-oauth-progress-phase', oauthProgress.defects.length === 0, { id: oauthProgress.defects[0] });

  // Failed OAuth offers the restart recovery, never a dead-end.
  await open('gate-oauth-failed');
  await waitGate();
  const oauthFailed = await measure(() => {
    const out = { defects: [] };
    const state = document.querySelector('.ma-gate-oauth-state');
    if (!state?.querySelector("[data-action-id='auth.oauth.restart']")) out.defects.push('oauth-restart-missing');
    return out;
  });
  record('gate-oauth-failed-recovery', oauthFailed.defects.length === 0, { id: oauthFailed.defects[0] });
}
