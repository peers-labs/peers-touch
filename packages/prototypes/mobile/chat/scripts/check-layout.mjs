import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMessageLayout } from './message-layout.mjs';
import { checkEmojiActionSheet } from './emoji-action-sheet.mjs';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const url = process.env.PROTOTYPE_URL ?? 'http://localhost:3108';
const output = resolve(
  repoRoot,
  process.env.PROTOTYPE_EVIDENCE_DIR ??
    'apps/mobile/src-tauri/target/prototype-layout',
);
// Grammar radii: 4 / 6 / 8 / 11 / 12 / 16 / 20 / 999 (computed px tolerance).
const RADIUS_FAMILY = [4, 5, 6, 8, 10, 11, 12, 16, 20, 999];
const viewports = [
  { width: 390, height: 844 },
  { width: 554, height: 954 },
  { width: 1440, height: 1100 },
];
await mkdir(output, { recursive: true });
const captures = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PROTOTYPE_BROWSER_CHANNEL ? { channel: process.env.PROTOTYPE_BROWSER_CHANNEL } : {}),
});

try {
  if (process.env.PROTOTYPE_MESSAGE_LAYOUT_ONLY === '1') {
    await checkMessageLayout({ browser, url, output, viewports });
  } else if (process.env.PROTOTYPE_EMOJI_ACTION_SHEET_ONLY === '1') {
    await checkEmojiActionSheet({ browser, url, output, viewports });
  } else {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport, colorScheme: 'light' });
      await page.addInitScript(() => {
        window.__gram = {
          family: [4, 5, 6, 8, 10, 11, 12, 16, 20, 999],
          nearRadius(value) {
            return this.family.some((r) => r === 999 ? value >= 999 : Math.abs(value - r) <= 1.2);
          },
          parseColor(value) {
            const m = value.match(/rgba?\(([^)]+)\)/);
            return m ? m[1].split(',').map((part) => parseFloat(part)) : null;
          },
          isInk(rgb) {
            const [r, g, b] = rgb.map(Number);
            return Math.max(r, g, b) < 90 && (Math.max(r, g, b) - Math.min(r, g, b)) < 28;
          },
        };
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const device = page.getByRole('region', { name: 'Mobile device preview' });

      async function open(scenario) {
        await page.goto(`${url}/?scenario=${scenario}`);
        // Works both standalone (mobile own dev server) and inside the Portal harness.
        const portalToggle = page.getByRole('button', { name: 'mobile Mobile Prototypes', exact: true });
        if (await portalToggle.count().catch(() => 0)) {
          if ((await portalToggle.getAttribute('aria-pressed')) !== 'true') {
            await portalToggle.click();
          }
        }
        await device.waitFor();
        await page.waitForTimeout(450);
      }

      async function measure(evaluateFn) {
        return device.evaluate(evaluateFn);
      }

      const geometry = { width: 0, height: 0, defects: [], details: {} };
      function record(name, value, meta = {}) {
        if (!value) geometry.defects.push(typeof meta.id === 'string' ? meta.id : name);
      }

      // ── Launch ──
      await open('journey');
      geometry.details.launch = await measure(() => {
        const out = { defects: [] };
        const rect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height, r: parseFloat(getComputedStyle(el).borderRadius) };
        };
        const logo = document.querySelector('.mp-launch-brand-logo');
        const logoR = rect(logo);
        if (!logoR || Math.abs(logoR.w - 44) > 1 || Math.abs(logoR.h - 44) > 1 || !__gram.nearRadius(logoR.r)) {
          out.defects.push('launch-logo-geometry');
        }
        const continueBtn = document.querySelector('.mp-launch-actions .pt-button');
        if (continueBtn && continueBtn.getBoundingClientRect().height < 43) out.defects.push('launch-continue-short');
        const stationRows = [...document.querySelectorAll('.mp-station-entry-main, .mp-station-remove')];
        if (stationRows.some((el) => el.getBoundingClientRect().height < 40)) out.defects.push('station-target-under-40');
        // No antd residue anywhere in the surface.
        if (document.querySelector('[class*="ant-"]')) out.defects.push('antd-residue');
        out.logo = logoR;
        return out;
      });
      record('launch', geometry.details.launch.defects.length === 0, { id: geometry.details.launch.defects[0] });

      // ── Auth gate ──
      await device.getByRole('button', { name: /^Open / }).click();
      await page.waitForTimeout(300);
      geometry.details.auth = await measure(() => {
        const out = { defects: [] };
        const cards = document.querySelectorAll('.mp-auth-card');
        if (cards.length !== 1) out.defects.push('auth-card-count');
        const logo = document.querySelector('.mp-auth-logo, .mp-auth-logo-placeholder');
        if (logo) {
          const r = logo.getBoundingClientRect();
          const radius = parseFloat(getComputedStyle(logo).borderRadius);
          if (Math.abs(r.width - 44) > 1 || !__gram.nearRadius(radius)) out.defects.push('auth-logo-geometry');
        }
        const panels = [...document.querySelectorAll('.mp-auth-tab-content > *')];
        const visibleInactive = panels.filter((panel) =>
          !panel.classList.contains('active') && getComputedStyle(panel).display !== 'none');
        if (visibleInactive.length) out.defects.push('auth-inactive-panel-visible');
        const oauth = document.querySelector('.mp-oauth-btn');
        if (oauth && getComputedStyle(oauth).backgroundImage.includes('linear-gradient')) {
          out.defects.push('auth-gradient-cta');
        }
        return out;
      });
      record('auth', geometry.details.auth.defects.length === 0, { id: geometry.details.auth.defects[0] });

      // ── Chat list ──
      await open('chat-default');
      geometry.details.chatList = await measure(() => {
        const out = { defects: [], rows: [], avatars: [] };
        const rows = [...document.querySelectorAll('.mp-conversation-item')];
        rows.slice(0, 8).forEach((row) => {
          const r = row.getBoundingClientRect();
          if (r.height < 60) out.defects.push('conversation-row-under-60');
        });
        // Unified mobile input grammar: 16px frame, no legacy native wells.
        if (document.querySelector('.mp-filter-field')) out.defects.push('legacy-filter-well');
        const searchFrame = document.querySelector('.mp-search-well .pt-field-frame');
        if (searchFrame) {
          const radius = parseFloat(getComputedStyle(searchFrame).borderRadius);
          if (!__gram.nearRadius(radius)) out.defects.push('search-frame-radius');
        }
        out.rowCount = rows.length;
        const avatars = [...document.querySelectorAll('.mp-conversation-item .mp-identity-avatar')];
        avatars.slice(0, 8).forEach((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const radius = parseFloat(cs.borderRadius);
          if (Math.abs(r.width - r.height) > 1) out.defects.push('avatar-not-square');
          if (radius >= r.width / 2 - 0.5) out.defects.push('avatar-circular');
          if (!__gram.nearRadius(radius)) out.defects.push('avatar-radius-family');
          if (cs.backgroundImage.includes('linear-gradient')) out.defects.push('avatar-gradient-fill');
        });
        // Unread badge = neutral ink, never semantic red/blue.
        const badge = document.querySelector('.mp-conv-badge .pt-badge-count, .mp-tabbar .pt-badge-count');
        if (badge) {
          const rgb = __gram.parseColor(getComputedStyle(badge).backgroundColor);
          if (rgb && !__gram.isInk(rgb)) out.defects.push('badge-not-ink');
        }
        // No verbose "N member group · Pinned · Muted" sentence.
        if ([...document.querySelectorAll('.mp-conv-relationship')].length) out.defects.push('verbose-relationship-text');
        return out;
      });
      record('chat-list', geometry.details.chatList.defects.length === 0, { id: geometry.details.chatList.defects[0] });

      // ── Thread ──
      await page.locator('.mp-conversation-item').first().click();
      await page.waitForTimeout(400);
      geometry.details.thread = await measure(() => {
        const out = { defects: [] };
        const viewport = document.querySelector('.mp-thread-messages');
        if (!viewport) { out.defects.push('no-thread-viewport'); return out; }
        if (viewport.scrollWidth > viewport.clientWidth + 1) out.defects.push('thread-horizontal-overflow');
        const padL = parseFloat(getComputedStyle(viewport).paddingLeft);
        const padR = parseFloat(getComputedStyle(viewport).paddingRight);
        if (Math.abs(padL - padR) > 0.1) out.defects.push('thread-padding-asymmetric');
        const own = [...document.querySelectorAll('.mp-message-row.mine .mp-bubble')];
        const peer = [...document.querySelectorAll('.mp-message-row.peer .mp-bubble')];
        const darkEnough = (rgb) => rgb && (rgb[0] + rgb[1] + rgb[2]) < 240;
        if (own.length) {
          const bg = __gram.parseColor(getComputedStyle(own[0]).backgroundColor);
          if (!darkEnough(bg)) out.defects.push('own-bubble-not-ink');
        }
        if (peer.length) {
          const radius = parseFloat(getComputedStyle(peer[0]).borderRadius);
          if (!__gram.nearRadius(radius)) out.defects.push('peer-bubble-radius');
        }
        // Own avatars render on the right edge.
        const mineRow = document.querySelector('.mp-message-row.mine');
        if (mineRow) {
          const dir = getComputedStyle(mineRow).flexDirection;
          if (dir !== 'row-reverse') out.defects.push('own-avatar-not-right');
        }
        const slot = document.querySelector('.mp-message-avatar-slot');
        if (slot) {
          const w = slot.getBoundingClientRect().width;
          if (Math.abs(w - 28) > 1) out.defects.push('avatar-slot-width');
        }
        // Long title must stay one line and never overlap the banner.
        return out;
      });
      record('thread', geometry.details.thread.defects.length === 0, { id: geometry.details.thread.defects[0] });

      // ── Long content: single-line header title ──
      await open('long-content');
      await page.locator('.mp-conversation-item').first().click();
      await page.waitForTimeout(400);
      geometry.details.longTitle = await measure(() => {
        const out = { defects: [] };
        const name = document.querySelector('.mp-thread-name');
        if (name) {
          if (name.getBoundingClientRect().height > 28) out.defects.push('thread-title-wraps');
          if (name.scrollWidth > name.clientWidth + 1) {
            // ellipsis expected, no second line
            if (name.getBoundingClientRect().height > 28) out.defects.push('thread-title-clips-ugly');
          }
        }
        return out;
      });
      record('long-title', geometry.details.longTitle.defects.length === 0, { id: geometry.details.longTitle.defects[0] });

      // ── Contacts ──
      await open('chat-default');
      await page.locator('.mp-tabbar-item').nth(2).click();
      await page.waitForTimeout(300);
      geometry.details.contacts = await measure(() => {
        const out = { defects: [] };
        const rows = [...document.querySelectorAll('.mp-contact-item, .mp-group-item')];
        if (rows.some((r) => r.getBoundingClientRect().height < 56)) out.defects.push('contact-row-under-56');
        if (document.querySelector('.mp-search-well .pt-field-frame') === null) out.defects.push('contacts-missing-filter');
        // Letter separators stay compact.
        const letters = [...document.querySelectorAll('.mp-contact-letter')];
        if (letters.some((l) => l.getBoundingClientRect().height > 24)) out.defects.push('letter-index-tall');
        return out;
      });
      record('contacts', geometry.details.contacts.defects.length === 0, { id: geometry.details.contacts.defects[0] });

      // ── Moments ──
      await page.locator('.mp-tabbar-item').nth(1).click();
      await page.waitForTimeout(300);
      geometry.details.moments = await measure(() => {
        const out = { defects: [] };
        const cards = [...document.querySelectorAll('.mp-social-moment')];
        cards.slice(0, 3).forEach((card) => {
          const radius = parseFloat(getComputedStyle(card).borderRadius);
          if (!__gram.nearRadius(radius)) out.defects.push('moment-card-radius');
          if (card.scrollWidth > card.clientWidth + 1) out.defects.push('moment-card-overflow');
        });
        // No gradient avatar tiles anywhere on this surface.
        if ([...document.querySelectorAll('.mp-social-moment [style*="linear-gradient"]')].length) {
          out.defects.push('moment-gradient-art');
        }
        // Comment send / reaction controls stay within card.
        return out;
      });
      record('moments', geometry.details.moments.defects.length === 0, { id: geometry.details.moments.defects[0] });

      // Composer sheet
      await page.getByRole('button', { name: 'New post' }).click();
      await page.waitForTimeout(300);
      geometry.details.composer = await measure(() => {
        const out = { defects: [] };
        const ta = document.querySelector('.mp-social-composer-sheet textarea');
        if (!ta || ta.getBoundingClientRect().height < 96) out.defects.push('composer-textarea-short');
        const audience = document.querySelector('.mp-social-audience-row');
        if (audience && audience.getBoundingClientRect().height < 40) out.defects.push('audience-row-short');
        return out;
      });
      record('composer', geometry.details.composer.defects.length === 0, { id: geometry.details.composer.defects[0] });
      await page.locator('.mp-action-sheet-backdrop').first().click({ position: { x: 5, y: 5 } }).catch(() => {});

      // ── Me / settings ──
      await page.locator('.mp-tabbar-item').nth(3).click();
      await page.waitForTimeout(300);
      // ── Account form: textarea resize grip must be gone, frames on grammar ──
      await page.locator('.mp-setting-row').first().click();
      await page.waitForTimeout(300);
      geometry.details.accountForm = await measure(() => {
        const out = { defects: [] };
        const frames = [...document.querySelectorAll('.mp-setting-detail-content .pt-field-frame')];
        if (!frames.length) out.defects.push('account-form-no-frames');
        frames.forEach((frame) => {
          const cs = getComputedStyle(frame);
          if (!__gram.nearRadius(parseFloat(cs.borderRadius))) out.defects.push('account-frame-radius');
          if (cs.minHeight.replace('px', '') < 45) out.defects.push('account-frame-short');
        });
        const textarea = document.querySelector('.mp-setting-detail-content textarea');
        if (textarea && getComputedStyle(textarea).resize !== 'none') out.defects.push('textarea-resize-grip');
        return out;
      });
      record('account-form', geometry.details.accountForm.defects.length === 0, { id: geometry.details.accountForm.defects[0] });
      await page.getByRole('button', { name: 'Back' }).first().click();
      await page.waitForTimeout(200);

      geometry.details.me = await measure(() => {
        const out = { defects: [] };
        const rows = [...document.querySelectorAll('.mp-setting-row')];
        if (rows.some((r) => r.getBoundingClientRect().height < 44)) out.defects.push('setting-row-under-44');
        // Vanity stat strip was removed.
        if (document.querySelector('.mp-profile-stats')) out.defects.push('vanity-stats-present');
        // Rows carry quiet icons, never pastel tint tiles.
        const icons = [...document.querySelectorAll('.mp-setting-icon')];
        if (icons.some((i) => {
          const bg = getComputedStyle(i).backgroundColor;
          return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
        })) out.defects.push('pastel-setting-tiles');
        return out;
      });
      record('me', geometry.details.me.defects.length === 0, { id: geometry.details.me.defects[0] });

      const deviceRect = await device.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
      geometry.width = deviceRect.width;
      geometry.height = deviceRect.height;
      geometry.pageOverflow = deviceRect.scrollWidth > deviceRect.clientWidth + 1;
      record('overflow', !geometry.pageOverflow, { id: 'horizontal-overflow' });

      await device.screenshot({
        path: resolve(output, `${viewport.width}-grammar.png`),
        animations: 'disabled',
      });
      captures.push({ viewport, geometry, errors: [...errors] });
      assert.deepEqual(errors, [], `Runtime errors at ${viewport.width}`);
      await page.close();
    }

    const defects = captures.flatMap((c) => c.geometry.defects.map((d) => `${c.viewport.width}: ${d}`));
    await writeFile(resolve(output, 'captures.json'), JSON.stringify({
      evidenceType: 'prototype-only',
      grammar: 'pine-mobile-2026',
      captures: captures.map(({ viewport, geometry, errors }) => ({ viewport, defects: geometry.defects, details: geometry.details, errors })),
    }, null, 2));
    process.stdout.write(`${JSON.stringify({ captures: captures.length, defects }, null, 2)}\n`);
    assert.equal(defects.length, 0, 'Mobile pine grammar geometry');
  }
} finally {
  await browser.close();
}
