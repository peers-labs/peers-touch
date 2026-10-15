/**
 * Live Desktop↔Mobile chat parity gate.
 *
 * Unlike the single-surface gates, this one loads BOTH running prototypes and
 * compares the chat thread on each with its own platform-appropriate probe:
 * Desktop is a full-width app, Mobile is the phone-frame prototype, so pixel
 * equality is meaningless — instead both must satisfy the same semantic
 * geometry contract, and the paired canonical measurements must match.
 *
 * Requires both portals running:
 *   PROTOTYPE_URL / MOBILE_URL  (default http://localhost:3210, VITE_PROTOTYPE_SITE=mobile)
 *   DESKTOP_URL                 (default http://localhost:3211, VITE_PROTOTYPE_SITE=desktop)
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');

const mobileUrl = process.env.MOBILE_URL ?? process.env.PROTOTYPE_URL ?? 'http://localhost:3210';
const desktopUrl = process.env.DESKTOP_URL ?? mobileUrl;

const TAIL = { max: 6 };        // small cluster-start tail corner
const FULL = { value: 12, tol: 2 }; // full rounded-square corner
const CROSS = 2;                // paired measurement tolerance

async function measureMobile(page) {
  const device = page.getByRole('region', { name: 'Mobile device preview' });
  await page.goto(`${mobileUrl}/?scenario=chat-delivery-recovery`);
  const mobileSite = page.getByRole('button', { name: 'mobile Mobile Prototypes', exact: true });
  if (await mobileSite.count() && await mobileSite.getAttribute('aria-pressed') !== 'true') {
    await mobileSite.click();
  }
  await page.getByText('Live Preview', { exact: true }).waitFor();
  await device.waitFor();
  await device.locator('.mp-thread-messages').waitFor();

  return device.evaluate(() => {
    const radii = (el) => {
      const s = getComputedStyle(el);
      return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius]
        .map((v) => Math.round(Number.parseFloat(v)));
    };
    const pick = (rows, own) => [...rows].map((row) => {
      const avatar = row.querySelector('.mp-message-avatar-slot .mp-identity-avatar');
      const bubble = row.querySelector('.mp-bubble') ?? row.querySelector('.mp-message-file');
      if (!bubble) return null;
      const ab = avatar?.getBoundingClientRect();
      const bb = bubble.getBoundingClientRect();
      const primary = row.querySelector('.mp-reply-quote, .mp-message-image, .mp-message-file, .mp-bubble');
      const identityTop = primary?.getBoundingClientRect().top ?? bb.top;
      return {
        id: row.getAttribute('data-chat-message-id') ?? row.getAttribute('data-scroll-anchor-id'),
        own,
        hasAvatar: Boolean(ab),
        avatar: ab ? { w: Math.round(ab.width), h: Math.round(ab.height) } : null,
        avatarIdentityDelta: ab ? Math.round(ab.top - identityTop) : null,
        radii: radii(bubble),
      };
    }).filter(Boolean);

    const peerStarts = pick(document.querySelectorAll('.mp-message-row.peer.cluster-start'), false);
    const ownStarts = pick(document.querySelectorAll('.mp-message-row.mine.cluster-start'), true);
    const midPeer = [...document.querySelectorAll('.mp-message-row.peer:not(.cluster-start) .mp-bubble')]
      .map((el) => radii(el));

    const inlineRetry = document.querySelector('[data-chat-inline-retry]');
    const retryButtons = [...document.querySelectorAll('button')]
      .filter((b) => /retry|重试/i.test(b.textContent))
      .map((b) => ({ h: Math.round(b.getBoundingClientRect().height), inMeta: Boolean(b.closest('.mp-message-meta')) }));

    const bar = document.querySelector('.mp-composer');
    const dock = document.querySelector('.mp-composer-dock');
    const send = document.querySelector('.mp-composer-send');
    const emoji = document.querySelector('.mp-composer-tool[aria-label="Emoji"]');
    const attach = document.querySelector('.mp-composer-tool[aria-label="Attach"]');
    const barRect = bar.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const dockStyle = getComputedStyle(dock);
    const sendStyle = getComputedStyle(send);

    return {
      platform: 'mobile',
      peerStarts,
      ownStarts,
      midPeer,
      retry: {
        inlineCount: document.querySelectorAll('[data-chat-inline-retry]').length,
        legacyBlockCount: document.querySelectorAll('.mp-message-retry').length,
        inlineInMeta: inlineRetry ? Boolean(inlineRetry.closest('.mp-message-meta')) : false,
        inlineHeight: inlineRetry ? Math.round(inlineRetry.getBoundingClientRect().height) : null,
        allRetryButtons: retryButtons,
      },
      composer: {
        radius: Math.round(Number.parseFloat(dockStyle.borderTopLeftRadius)),
        sendRadius: Math.round(Number.parseFloat(sendStyle.borderTopLeftRadius)),
        insets: {
          top: Math.round(dockRect.top - barRect.top),
          right: Math.round(barRect.right - dockRect.right),
          bottom: Math.round(barRect.bottom - dockRect.bottom),
          left: Math.round(dockRect.left - barRect.left),
        },
        sendInside: dock.contains(send),
        emojiInside: dock.contains(emoji),
        attachInside: dock.contains(attach),
        attachCount: document.querySelectorAll('.mp-composer-tool[aria-label="Attach"]').length,
        exteriorAttach: document.querySelectorAll('.mp-composer-attach').length,
        dockBg: dockStyle.backgroundColor,
      },
    };
  });
}

async function measureDesktop(page) {
  await page.goto(`${desktopUrl}/`, { waitUntil: 'networkidle' });
  const desktopSite = page.getByRole('button', { name: 'desktop Desktop Prototypes', exact: true });
  if (await desktopSite.count() && await desktopSite.getAttribute('aria-pressed') !== 'true') {
    await desktopSite.click();
  }
  const railChat = page.locator('[aria-label="聊天"]').first();
  if (await desktopSite.count()) {
    await railChat.waitFor();
    await railChat.click();
  } else if (await railChat.count()) await railChat.click();
  await page.locator('[data-chat-composer-bar]').first().waitFor();

  // Ensure the Release Room review conversation (the one carrying the failed
  // own message) is open; the shell defaults to it, but select explicitly.
  const threadTitle = page.locator('[data-chat-composer-bar]').first();
  await threadTitle.waitFor();
  const hasFailed = await page.locator('[data-chat-inline-retry]').count();
  if (!hasFailed) {
    const row = page.getByText('Release Room', { exact: true }).first();
    if (await row.count()) await row.click();
    await page.locator('[data-chat-inline-retry]').first().waitFor();
  }
  return page.evaluate(() => {
    const radii = (el) => {
      const s = getComputedStyle(el);
      return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius]
        .map((v) => Math.round(Number.parseFloat(v)));
    };
    const peerStarts = [];
    const ownStarts = [];
    const midPeer = [];
    for (const row of document.querySelectorAll('[data-chat-message-id]')) {
      const own = row.getAttribute('data-chat-message-own') === 'true';
      const bubble = row.querySelector('.msg-bubble');
      if (!bubble) continue;
      if (row.getAttribute('data-chat-cluster-start') === 'false') {
        if (!own) midPeer.push(radii(bubble));
        continue;
      }
      const column = bubble.parentElement;
      const flexRow = column?.parentElement;
      const avatar = row.querySelector('[data-chat-avatar-slot] > *');
      const bb = bubble.getBoundingClientRect();
      const name = row.querySelector('[data-chat-sender]');
      const identityTop = name ? name.getBoundingClientRect().top : bb.top;
      const ab = avatar?.getBoundingClientRect();
      const record = {
        id: row.getAttribute('data-chat-message-id'),
        own,
        hasAvatar: Boolean(avatar),
        avatar: ab ? { w: Math.round(ab.width), h: Math.round(ab.height) } : null,
        avatarIdentityDelta: ab ? Math.round(ab.top - identityTop) : null,
        radii: radii(bubble),
      };
      (own ? ownStarts : peerStarts).push(record);
    }

    const inlineRetry = document.querySelector('[data-chat-inline-retry]');
    const retryButtons = [...document.querySelectorAll('button')]
      .filter((b) => /retry|重试/i.test(b.textContent))
      .map((b) => ({ h: Math.round(b.getBoundingClientRect().height) }));

    const bar = document.querySelector('[data-chat-composer-bar]');
    const dock = document.querySelector('[data-chat-composer-field]');
    const send = document.querySelector('[data-chat-send]');
    const emoji = dock?.querySelector('[aria-label="Emoji"]');
    const barRect = bar.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const dockStyle = getComputedStyle(dock);
    const sendStyle = getComputedStyle(send);

    return {
      platform: 'desktop',
      peerStarts,
      ownStarts,
      midPeer,
      retry: {
        inlineCount: document.querySelectorAll('[data-chat-inline-retry]').length,
        inlineInMeta: true, // desktop retry is rendered inside the own meta row
        inlineHeight: inlineRetry ? Math.round(inlineRetry.getBoundingClientRect().height) : null,
        allRetryButtons: retryButtons,
      },
      composer: {
        radius: Math.round(Number.parseFloat(dockStyle.borderTopLeftRadius)),
        sendRadius: Math.round(Number.parseFloat(sendStyle.borderTopLeftRadius)),
        insets: {
          top: Math.round(dockRect.top - barRect.top),
          right: Math.round(barRect.right - dockRect.right),
          bottom: Math.round(barRect.bottom - dockRect.bottom),
          left: Math.round(dockRect.left - barRect.left),
        },
        sendInside: dock.contains(send),
        emojiInside: dock.contains(emoji),
        exteriorAttach: 0,
        dockBg: dockStyle.backgroundColor,
      },
    };
  });
}

function assertPlatformContract(label, m) {
  assert(m.peerStarts.length > 0, `${label}: expected peer cluster-start messages`);
  assert(m.ownStarts.length > 0, `${label}: expected own messages`);
  for (const row of m.peerStarts) {
    assert(row.hasAvatar, `${label}: peer cluster start must carry the identity avatar`);
    assert(Math.abs(row.avatar.w - row.avatar.h) <= 2,
      `${label}: identity avatar must be square, got ${row.avatar.w}x${row.avatar.h}`);
    assert(Math.abs(row.avatarIdentityDelta) <= 8,
      `${label}: ${row.id} avatar must top-align with message body, delta ${row.avatarIdentityDelta}px`);
    const [tl, tr, br, bl] = row.radii;
    assert(tl <= TAIL.max, `${label}: peer tail must be top-left small corner, got ${tl}`);
    assert(Math.abs(tr - FULL.value) <= FULL.tol && Math.abs(br - FULL.value) <= FULL.tol && Math.abs(bl - FULL.value) <= FULL.tol,
      `${label}: peer non-tail corners must stay full 12, got ${[tl, tr, br, bl].join('/')}`);
  }
  for (const row of m.ownStarts) {
    const [tl, tr, br, bl] = row.radii;
    assert(tr <= TAIL.max, `${label}: own tail must be top-right small corner, got ${tr}`);
    assert(Math.abs(tl - FULL.value) <= FULL.tol && Math.abs(br - FULL.value) <= FULL.tol && Math.abs(bl - FULL.value) <= FULL.tol,
      `${label}: own non-tail corners must stay full 12, got ${[tl, tr, br, bl].join('/')}`);
  }
  for (const radii of m.midPeer) {
    assert(radii.every((r) => Math.abs(r - FULL.value) <= FULL.tol),
      `${label}: non-start cluster bubble must keep full corners, got ${radii.join('/')}`);
  }
  assert(m.retry.inlineCount >= 1, `${label}: failed message must expose an inline retry`);
  assert(m.retry.inlineInMeta, `${label}: inline retry must live in the message meta row`);
  assert(m.retry.inlineHeight !== null && m.retry.inlineHeight <= 28,
    `${label}: inline retry must be compact, height ${m.retry.inlineHeight}px`);
  for (const button of m.retry.allRetryButtons) {
    assert(button.h <= 28, `${label}: no block-level retry control, height ${button.h}px`);
  }
  if ('legacyBlockCount' in m.retry) {
    assert.equal(m.retry.legacyBlockCount, 0, `${label}: legacy block retry button must be gone`);
  }
  const insetValues = Object.values(m.composer.insets);
  assert.equal(m.composer.radius, 12, `${label}: composer dock radius must be 12, got ${m.composer.radius}`);
  assert.equal(m.composer.sendRadius, 8, `${label}: composer send radius must be 8, got ${m.composer.sendRadius}`);
  assert(Math.max(...insetValues) - Math.min(...insetValues) <= 2,
    `${label}: composer dock frame must be equal, got ${JSON.stringify(m.composer.insets)}`);
  assert(m.composer.sendInside && m.composer.emojiInside,
    `${label}: send and emoji must live inside the composer dock`);
  if (label === 'mobile') {
    assert(m.composer.attachInside && m.composer.attachCount === 1,
      'mobile: exactly one attachment entry must live inside the composer dock');
  }
  assert.equal(m.composer.exteriorAttach, 0, `${label}: no exterior composer attach button`);
}

function assertParity(d, m) {
  const dAvatar = d.peerStarts[0].avatar;
  const mAvatar = m.peerStarts[0].avatar;
  assert(Math.abs(dAvatar.w - mAvatar.w) <= CROSS,
    `parity: avatar size diverged desktop ${dAvatar.w}px vs mobile ${mAvatar.w}px`);
  assert(Math.abs(d.peerStarts[0].radii[0] - m.peerStarts[0].radii[0]) <= CROSS,
    `parity: peer tail radius diverged desktop ${d.peerStarts[0].radii[0]} vs mobile ${m.peerStarts[0].radii[0]}`);
  assert(Math.abs(d.ownStarts[0].radii[1] - m.ownStarts[0].radii[1]) <= CROSS,
    `parity: own tail radius diverged desktop ${d.ownStarts[0].radii[1]} vs mobile ${m.ownStarts[0].radii[1]}`);
  assert(Math.abs(d.composer.radius - m.composer.radius) <= CROSS,
    `parity: composer dock radius diverged ${d.composer.radius} vs ${m.composer.radius}`);
  assert(Math.abs(d.composer.sendRadius - m.composer.sendRadius) <= CROSS,
    `parity: send radius diverged ${d.composer.sendRadius} vs ${m.composer.sendRadius}`);
  for (const side of ['top', 'right', 'bottom', 'left']) {
    assert(Math.abs(d.composer.insets[side] - m.composer.insets[side]) <= CROSS,
      `parity: composer ${side} inset diverged ${d.composer.insets[side]} vs ${m.composer.insets[side]}`);
  }
  assert(Math.abs(d.retry.inlineHeight - m.retry.inlineHeight) <= CROSS,
    `parity: inline retry height diverged ${d.retry.inlineHeight} vs ${m.retry.inlineHeight}`);
}

const browser = await chromium.launch({ headless: true });
try {
  const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const mobilePage = await browser.newPage({ viewport: { width: 430, height: 932 }, colorScheme: 'light' });
  const pageErrors = [];
  for (const page of [desktopPage, mobilePage]) {
    page.on('pageerror', (error) => pageErrors.push(`${page.url()}: ${error.message}`));
  }

  const desktop = await measureDesktop(desktopPage);
  const mobile = await measureMobile(mobilePage);

  assertPlatformContract('desktop', desktop);
  assertPlatformContract('mobile', mobile);
  assertParity(desktop, mobile);
  assert.deepEqual(pageErrors, [], `page errors: ${JSON.stringify(pageErrors)}`);

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    desktop: {
      peerStarts: desktop.peerStarts.length,
      ownStarts: desktop.ownStarts.length,
      avatar: desktop.peerStarts[0].avatar,
      peerTail: desktop.peerStarts[0].radii[0],
      ownTail: desktop.ownStarts[0].radii[1],
      inlineRetryHeight: desktop.retry.inlineHeight,
      composer: desktop.composer,
    },
    mobile: {
      peerStarts: mobile.peerStarts.length,
      ownStarts: mobile.ownStarts.length,
      avatar: mobile.peerStarts[0].avatar,
      peerTail: mobile.peerStarts[0].radii[0],
      ownTail: mobile.ownStarts[0].radii[1],
      inlineRetryHeight: mobile.retry.inlineHeight,
      composer: mobile.composer,
    },
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
