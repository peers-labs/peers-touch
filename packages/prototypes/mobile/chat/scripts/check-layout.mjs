import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const url = process.env.PROTOTYPE_URL ?? 'http://localhost:3200';
const output = resolve(repoRoot, process.env.PROTOTYPE_EVIDENCE_DIR
  ?? 'apps/mobile/src-tauri/target/prototype-layout');
const viewports = [
  { width: 1440, height: 1100 },
  { width: 554, height: 954 },
  { width: 390, height: 844 },
];
await mkdir(output, { recursive: true });
const captures = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport, colorScheme: 'light' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const device = page.getByRole('region', { name: 'Mobile device preview' });
    async function open(scenario) {
      await page.goto(`${url}/?scenario=${scenario}`);
      const mobileSite = page.getByRole('button', { name: 'mobile Mobile Prototypes', exact: true });
      if (await mobileSite.getAttribute('aria-pressed') !== 'true') {
        await mobileSite.click();
      }
      await page.getByText('Live Preview', { exact: true }).waitFor();
      await device.waitFor();
    }
    async function capture(state) {
      await device.scrollIntoViewIfNeeded();
      const filename = `${viewport.width}-${state}.png`;
      await device.screenshot({ path: resolve(output, filename), animations: 'disabled' });
      const geometry = await device.evaluate((element) => {
        const rect = (target) => {
          const bounds = target?.getBoundingClientRect();
          return bounds
            ? {
                top: bounds.top,
                right: bounds.right,
                bottom: bounds.bottom,
                left: bounds.left,
                width: bounds.width,
                height: bounds.height,
              }
            : null;
        };
        const authScreen = element.querySelector('.mp-auth-screen');
        const authCard = authScreen?.querySelector('.mp-auth-card');
        const authBrand = authScreen?.querySelector('.mp-auth-brand');
        const authLogo = authScreen?.querySelector('.mp-auth-logo');
        const authCardRect = authCard?.getBoundingClientRect();
        const authBrandRect = authBrand?.getBoundingClientRect();
        const authLogoStyle = authLogo ? getComputedStyle(authLogo) : null;
        const composer = element.querySelector('.mp-social-composer-sheet');
        const composerRect = rect(composer);
        const composerInputRect = rect(composer?.querySelector(':scope > textarea'));
        const composerAudienceRect = rect(
          composer?.querySelector(':scope > .mp-social-audience-row'),
        );
        const composerHeaderRect = rect(
          composer?.querySelector(':scope > .mp-social-sheet-header'),
        );
        const composerPublishRect = rect(
          composer?.querySelector('.mp-social-sheet-header > .primary'),
        );
        const tabbarRect = rect(element.querySelector('.mp-tabbar'));
        const deviceRect = rect(element);
        return {
          width: deviceRect.width,
          height: deviceRect.height,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
          scenarioOverlaps: [...document.querySelectorAll('.mp-scene-label')].some((label) => {
            const scene = label.getBoundingClientRect();
            const device = element.getBoundingClientRect();
            return scene.right > device.left && scene.left < device.right
              && scene.bottom > device.top && scene.top < device.bottom;
          }),
          sections: [...element.querySelectorAll('.mp-detail-section')].map((section) => ({
            clientHeight: section.clientHeight,
            scrollHeight: section.scrollHeight,
          })),
          auth: authScreen && authCard && authBrand && authLogoStyle
            ? {
                cardCount: authScreen.querySelectorAll('.mp-auth-card').length,
                brandInsideCard: authCard.contains(authBrand),
                logoWidth: Number.parseFloat(authLogoStyle.width),
                logoHeight: Number.parseFloat(authLogoStyle.height),
                blankGap: Math.max(0, authCardRect.top - authBrandRect.bottom),
                recoveryCount: element.querySelectorAll(
                  '.mp-recovery-panel, .mp-recovery-sheet',
                ).length,
                hasMobileKicker: String(authScreen.textContent || '')
                  .includes('PEERS TOUCH MOBILE'),
                hasRawStationAddress: /https?:\/\/|(?:\d{1,3}\.){3}\d{1,3}:\d+/
                  .test(String(authScreen.textContent || '')),
                clientHeight: authScreen.clientHeight,
                scrollHeight: authScreen.scrollHeight,
                verticallyScrollable: authScreen.scrollHeight
                  > authScreen.clientHeight + 1,
              }
            : null,
          composer: composerRect
            && composerInputRect
            && composerAudienceRect
            && composerHeaderRect
            && composerPublishRect
            && tabbarRect
            ? {
                inputHeight: composerInputRect.height,
                audienceHeight: composerAudienceRect.height,
                headerHeight: composerHeaderRect.height,
                publishHeight: composerPublishRect.height,
                bottomClearance: deviceRect.bottom - composerRect.bottom,
                tabbarGap: tabbarRect.top - composerRect.bottom,
              }
            : null,
        };
      });
      captures.push({ state, viewport, filename, theme: 'light-only', geometry });
    }

    await open('journey');
    await capture('default');
    await open('session-revoked');
    await capture('auth-session-revoked');
    await open('social-unavailable');
    const initial = await device.boundingBox();
    await capture('unavailable');
    await device.getByRole('button', { name: 'Me', exact: true }).click();
    const me = await device.boundingBox();
    assert.equal(initial.width, me.width);
    assert.equal(initial.height, me.height);
    await capture('me-unavailable');
    await device.getByRole('button', { name: 'Chats', exact: true }).click();
    await device.getByRole('button', { name: 'Retry', exact: true }).click();
    await capture('retry-pending');
    await page.getByRole('button', { name: 'Retry fails', exact: true }).click();
    await capture('retry-failed');

    await open('find-people-no-membership');
    const noMembership = page.getByRole('dialog', { name: 'Find People', exact: true });
    assert(await noMembership.getByRole('button', { name: 'Send Request', exact: true }).isDisabled());
    await capture('no-membership');
    await page.keyboard.press('Shift+Tab');
    assert(await noMembership.evaluate((element) => element.contains(document.activeElement)));
    await page.keyboard.press('Tab');
    assert(await noMembership.evaluate((element) => element.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);

    await open('find-people-member');
    const sheet = page.getByRole('dialog', { name: 'Find People', exact: true });
    await capture('member');
    await sheet.getByRole('button', { name: 'Send Request', exact: true }).click();
    await capture('request-pending');
    await page.getByRole('button', { name: 'Request outcome unknown', exact: true }).click();
    const intent = await page.locator('.mp-evidence-intent').innerText();
    await capture('request-unknown');
    await sheet.getByRole('button', { name: /^Check Status \(\d+\)$/ }).click();
    assert.equal(
      (await page.locator('.mp-evidence-intent').innerText()).split(' / ').slice(0, 2).join(' / '),
      intent.split(' / ').slice(0, 2).join(' / '),
    );
    await capture('request-checking');
    await page.getByRole('button', { name: 'Request confirmed pending', exact: true }).click();
    await page.getByRole('button', { name: 'Relationship accepted', exact: true }).click();
    assert(await sheet.getByRole('button', { name: 'Friends', exact: true }).isDisabled());
    await capture('request-accepted');
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    await device.getByRole('button', { name: /Frank/ }).click();
    await capture('contact');
    await device.getByRole('button', { name: 'Message', exact: true }).click();
    await capture('direct-preparing');
    await page.getByRole('button', { name: 'Direct fails', exact: true }).click();
    await capture('direct-failed');
    const lastInfo = device.locator('.mp-detail-section').getByText('End-to-end encrypted', { exact: true });
    await lastInfo.scrollIntoViewIfNeeded();
    const infoBounds = await lastInfo.evaluate((element) => {
      const row = element.getBoundingClientRect();
      const owner = element.closest('.mp-detail-page')?.getBoundingClientRect();
      return { top: row.top, bottom: row.bottom, ownerTop: owner?.top, ownerBottom: owner?.bottom };
    });
    assert(infoBounds.top >= infoBounds.ownerTop - 1
      && infoBounds.bottom <= infoBounds.ownerBottom + 1, JSON.stringify(infoBounds));
    await capture('direct-info-scrolled');
    await device.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: 'Direct ready', exact: true }).click();
    await device.getByText('No messages yet', { exact: true }).waitFor();
    await capture('direct-empty');

    await open('social-parity');
    await device.getByRole('button', { name: 'Moments', exact: true }).click();
    await device.getByRole('button', { name: 'New post', exact: true }).click();
    await device.getByRole('dialog', { name: 'New Moment', exact: true }).waitFor();
    await capture('social-composer');
    const composer = captures.at(-1).geometry.composer;
    assert(composer, 'Social composer geometry');
    assert(composer.inputHeight >= 220, JSON.stringify(composer));
    assert(
      composer.inputHeight >= composer.audienceHeight * 4,
      JSON.stringify(composer),
    );
    assert(
      composer.audienceHeight >= 40 && composer.audienceHeight <= 44,
      JSON.stringify(composer),
    );
    assert(
      composer.headerHeight >= 42 && composer.headerHeight <= 46,
      JSON.stringify(composer),
    );
    assert(
      composer.publishHeight >= 30 && composer.publishHeight <= 34,
      JSON.stringify(composer),
    );
    assert(Math.abs(composer.tabbarGap) <= 2, JSON.stringify(composer));
    assert(
      composer.bottomClearance >= 50 && composer.bottomClearance <= 72,
      JSON.stringify(composer),
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  const defects = captures.filter(({ geometry }) => geometry.width < 320
    || geometry.pageOverflow
    || geometry.scenarioOverlaps
    || geometry.scrollWidth > geometry.clientWidth
    || geometry.sections.some((section) => section.scrollHeight > section.clientHeight + 1)
    || (geometry.auth && (
      geometry.auth.cardCount !== 1
      || !geometry.auth.brandInsideCard
      || geometry.auth.logoWidth !== 72
      || geometry.auth.logoHeight !== 72
      || geometry.auth.blankGap !== 0
      || geometry.auth.recoveryCount !== 0
      || geometry.auth.hasMobileKicker
      || geometry.auth.hasRawStationAddress
      || geometry.auth.verticallyScrollable
    ))
    || (geometry.composer && (
      geometry.composer.inputHeight < 220
      || geometry.composer.inputHeight < geometry.composer.audienceHeight * 4
      || geometry.composer.audienceHeight < 40
      || geometry.composer.audienceHeight > 44
      || geometry.composer.headerHeight < 42
      || geometry.composer.headerHeight > 46
      || geometry.composer.publishHeight < 30
      || geometry.composer.publishHeight > 34
      || Math.abs(geometry.composer.tabbarGap) > 2
      || geometry.composer.bottomClearance < 50
      || geometry.composer.bottomClearance > 72
    )));
  await writeFile(resolve(output, 'captures.json'), JSON.stringify({
    evidenceType: 'prototype-only',
    captures,
    defects,
  }, null, 2));
  process.stdout.write(`${JSON.stringify({ captures: captures.length, defects }, null, 2)}\n`);
  assert.equal(defects.length, 0, 'usable preview width and unclipped detail sections');
} finally {
  await browser.close();
}
