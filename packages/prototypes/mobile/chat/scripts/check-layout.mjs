import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyInlineComments } from './verify-inline-comments.mjs';
import { verifySocialInteractions } from './verify-social-interactions.mjs';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'apps/desktop/package.json'));
const { chromium } = require('@playwright/test');
const settingsCatalog = JSON.parse(await readFile(
  resolve(repoRoot, 'packages/prototypes/mobile/chat/src/settingsCapabilities.json'),
  'utf8',
));
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
        const authScreen = element.querySelector('.mp-auth-screen');
        const authCard = authScreen?.querySelector('.mp-auth-card');
        const authBrand = authScreen?.querySelector('.mp-auth-brand');
        const authLogo = authScreen?.querySelector('.mp-auth-logo');
        const authCardRect = authCard?.getBoundingClientRect();
        const authBrandRect = authBrand?.getBoundingClientRect();
        const authLogoStyle = authLogo ? getComputedStyle(authLogo) : null;
        return {
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
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
        };
      });
      captures.push({ state, viewport, filename, theme: 'light-only', geometry });
    }

    await open('journey');
    await capture('default');
    await device.getByRole('button', { name: 'Add Station', exact: true }).click();
    const stationAddress = device.locator('.mp-station-address');
    await stationAddress.fill('invalid-address');
    await device.getByRole('button', { name: 'Verify and add Station', exact: true }).click();
    assert(await device.getByText('Enter a full HTTP(S) Station URL.', { exact: true }).isVisible());
    assert.equal(await device.locator('.mp-station-protocol').count(), 0);
    await stationAddress.fill('https://edge.peers.social');
    await device.getByRole('button', { name: 'Verify and add Station', exact: true }).click();
    assert(await device.getByText('https://edge.peers.social', { exact: true }).isVisible());
    await open('session-revoked');
    await capture('auth-session-revoked');
    assert.equal(await device.locator('.mp-oauth-overlay').count(), 0);
    await device.getByRole('button', { name: 'Continue with GitHub', exact: true }).click();
    const githubAction = device.locator('[data-oauth-provider="github"]');
    assert.notEqual(await githubAction.getAttribute('data-oauth-state'), 'idle');
    await device.getByRole('button', { name: 'Cancel GitHub sign-in', exact: true }).click();
    assert.equal(await githubAction.getAttribute('data-oauth-state'), 'idle');
    await open('social-unavailable');
    const initial = await device.boundingBox();
    assert.equal(await device.locator('[data-demo-recovery-owner="lifecycle"]').count(), 1);
    assert.equal(await device.locator('.mp-runtime-notice').count(), 0);
    await capture('unavailable');
    await device.getByRole('button', { name: 'Moments', exact: true }).click();
    assert.equal(await device.locator('[data-social-post]').count(), 0);
    assert.equal(await device.locator('[data-demo-recovery-owner="lifecycle"]').count(), 1);
    await capture('social-unavailable');
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

    await open('social-detail-unavailable');
    assert(await device.getByRole('heading', { name: 'Conversation', exact: true }).isVisible());
    assert(await device.getByText('Conversation unavailable', { exact: true }).isVisible());
    assert(await device.getByRole('button', { name: 'Back', exact: true }).isVisible());
    assert.equal(await device.locator('[data-demo-recovery-owner="lifecycle"]').count(), 1);
    assert.equal(await device.locator('.mp-runtime-notice').count(), 0);
    await capture('conversation-unavailable');

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
    await page.getByText('No messages yet', { exact: true }).waitFor();
    await capture('direct-empty');

    // Identity geometry contract (shared with Desktop): no avatar is ever
    // circular. Person avatars use a size-derived rounded-square corner
    // (max(8, round(size/4))); group avatars use the lg-radius rounded
    // square. The list must contain both kinds so the assertion cannot pass
    // on an empty set.
    await open('chat-default');
    const identityShapes = await device.locator('.mp-identity-avatar').evaluateAll(
      (elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const tl = Number.parseFloat(style.borderTopLeftRadius);
        return {
          kind: element.classList.contains('group') ? 'group' : 'person',
          size: Math.round(rect.width),
          radius: Math.round(tl),
        };
      }),
    );
    const personShapes = identityShapes.filter((shape) => shape.kind === 'person');
    const groupShapes = identityShapes.filter((shape) => shape.kind === 'group');
    assert(personShapes.length > 0 && groupShapes.length > 0,
      `expected both person and group identity avatars, got ${JSON.stringify(identityShapes)}`);
    for (const shape of personShapes) {
      const expectedRadius = Math.max(8, Math.round(shape.size / 4));
      assert(shape.radius < shape.size / 2 - 1
        && Math.abs(shape.radius - expectedRadius) <= 1,
        `person avatar must be a size-derived rounded square (radius ${shape.radius}, expected ${expectedRadius} / size ${shape.size}), never circular`);
    }
    for (const shape of groupShapes) {
      assert(shape.radius === 12 && shape.radius < shape.size / 2 - 1,
        `group avatar must use lg radius 12 and never be circular, got ${shape.radius} / size ${shape.size}`);
    }

    // Search is intent-mounted. Its input keeps a compact md corner and
    // unmounts again when the header command closes the search surface.
    assert.equal(
      await device.locator('.mp-search-bar .ant-input-affix-wrapper').count(),
      0,
      'chat search must stay hidden before explicit intent',
    );
    await device.getByRole('button', { name: 'Search chats', exact: true }).click();
    const searchFields = await device.locator('.mp-search-bar .ant-input-affix-wrapper').evaluateAll(
      (elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          height: Math.round(rect.height),
          radius: Math.round(Number.parseFloat(style.borderTopLeftRadius)),
        };
      }),
    );
    assert.equal(searchFields.length, 1, 'expected one intent-mounted chat search input');
    for (const field of searchFields) {
      assert(field.radius === 8 && field.radius < field.height / 2 - 1,
        `search input must use md radius 8 and never be a pill, got radius ${field.radius} / height ${field.height}`);
    }
    await device.getByRole('button', { name: 'Close search', exact: true }).click();
    assert.equal(await device.locator('.mp-search-bar .ant-input-affix-wrapper').count(), 0);

    // ── Desktop↔Mobile chat parity (measured on the delivery-recovery thread) ──
    await open('chat-delivery-recovery');
    await device.locator('.mp-thread-messages').waitFor();

    // 1. Identity anchors the cluster at the TOP, aligned with the sender name;
    //    the bubble tail is the 4px corner at the same TOP edge as Desktop.
    const clusterRows = await device.locator('.mp-message-row.peer.cluster-start').evaluateAll(
      (rows) => rows.map((row) => {
        const avatar = row.querySelector('.mp-message-avatar-slot .mp-identity-avatar');
        const name = row.querySelector('.mp-message-sender');
        const bubble = row.querySelector('.mp-bubble');
        const file = row.querySelector('.mp-message-file');
        const cornerEl = bubble ?? file;
        const avatarRect = avatar?.getBoundingClientRect();
        const nameRect = name?.getBoundingClientRect();
        const style = cornerEl ? getComputedStyle(cornerEl) : null;
        return {
          hasAvatar: Boolean(avatarRect),
          avatarNameDelta: avatarRect && nameRect ? Math.round(avatarRect.top - nameRect.top) : null,
          topLeft: style ? Math.round(Number.parseFloat(style.borderTopLeftRadius)) : null,
          topRight: style ? Math.round(Number.parseFloat(style.borderTopRightRadius)) : null,
        };
      }),
    );
    assert(clusterRows.length > 0, 'expected at least one peer cluster-start row');
    for (const row of clusterRows) {
      assert(row.hasAvatar, 'peer cluster-start row must carry the identity avatar');
      assert(row.avatarNameDelta === null || Math.abs(row.avatarNameDelta) <= 8,
        `cluster identity must top-align with the sender name, delta ${row.avatarNameDelta}px`);
      assert(row.topLeft === 4 && row.topRight === 12,
        `peer cluster bubble tail must be top-left 4px, got ${row.topLeft}/${row.topRight}`);
    }

    // 2. Failed delivery retries inline in the meta row (Desktop parity):
    //    no block-level retry button may exist.
    assert.equal(await device.locator('.mp-message-retry').count(), 0,
      'block-level message retry button must not exist');
    const inlineRetry = device.locator('[data-chat-inline-retry]');
    assert(await inlineRetry.count() >= 1, 'expected an inline failed-message retry');
    const retryBox = await inlineRetry.first().evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { inMeta: Boolean(el.closest('.mp-message-meta')), height: Math.round(rect.height) };
    });
    assert(retryBox.inMeta, 'inline retry must live inside the message meta row');
    assert(retryBox.height <= 28, `inline retry must be a compact inline action, height ${retryBox.height}px`);

    // 3. Composer is one grounded soft-gray dock: no exterior attach button;
    //    attach/emoji/send live inside the dock, whose frame is equal.
    assert.equal(await device.locator('.mp-composer-attach').count(), 0,
      'exterior composer attach button must not exist');
    const dock = device.locator('.mp-composer-dock').first();
    await dock.waitFor();
    const composer = await device.locator('.mp-composer').first().evaluate((bar) => {
      const dockEl = bar.querySelector('.mp-composer-dock');
      const send = bar.querySelector('.mp-composer-send');
      const emoji = bar.querySelector('.mp-composer-tool[aria-label="Emoji"]');
      const attach = bar.querySelector('.mp-composer-tool[aria-label="Attach"]');
      const barRect = bar.getBoundingClientRect();
      const dockRect = dockEl.getBoundingClientRect();
      const insets = {
        top: Math.round(dockRect.top - barRect.top),
        right: Math.round(barRect.right - dockRect.right),
        bottom: Math.round(barRect.bottom - dockRect.bottom),
        left: Math.round(dockRect.left - barRect.left),
      };
      const radius = Math.round(Number.parseFloat(getComputedStyle(dockEl).borderTopLeftRadius));
      return {
        insets,
        radius,
        sendInside: dockEl.contains(send),
        emojiInside: dockEl.contains(emoji),
        attachInside: dockEl.contains(attach),
        attachCount: bar.querySelectorAll('.mp-composer-tool[aria-label="Attach"]').length,
      };
    });
    const insetValues = Object.values(composer.insets);
    assert(composer.radius === 12, `composer dock radius must be 12, got ${composer.radius}`);
    assert(composer.sendInside && composer.emojiInside && composer.attachInside,
      'attach, emoji, and send must live inside the dock');
    assert.equal(composer.attachCount, 1, 'composer must expose exactly one attachment entry');
    assert(Math.max(...insetValues) - Math.min(...insetValues) <= 2,
      `composer dock frame must be equal on all four sides, got ${JSON.stringify(composer.insets)}`);

    // 4. Details rows share stable label / metadata / chevron tracks.
    await device.getByRole('button', { name: 'More', exact: true }).click();
    const detailsGeometry = await device.locator('.mp-chat-details-section').first()
      .locator('.mp-chat-details-item').evaluateAll((rows) => rows.map((row) => {
        const label = row.querySelector('.mp-chat-details-label')?.getBoundingClientRect();
        const meta = row.querySelector('.mp-chat-details-meta')?.getBoundingClientRect();
        const chevron = row.querySelector('.mp-row-chevron')?.getBoundingClientRect();
        return {
          labelRight: label?.right,
          metaLeft: meta?.left,
          metaWidth: meta?.width,
          chevronLeft: chevron?.left,
          chevronRight: chevron?.right,
          columns: getComputedStyle(row).gridTemplateColumns,
        };
      }));
    assert.equal(detailsGeometry.length, 2);
    assert(Math.abs(detailsGeometry[0].chevronRight - detailsGeometry[1].chevronRight) <= 1,
      `Details chevrons must share one trailing axis: ${JSON.stringify(detailsGeometry)}`);
    assert.equal(Math.round(detailsGeometry[1].metaWidth), 28);
    assert(detailsGeometry[1].labelRight <= detailsGeometry[1].metaLeft,
      `Pinned count must not overlap its label: ${JSON.stringify(detailsGeometry[1])}`);
    assert(detailsGeometry[1].metaLeft < detailsGeometry[1].chevronLeft,
      `Pinned count must precede the chevron: ${JSON.stringify(detailsGeometry[1])}`);
    await capture('chat-details');
    await device.getByRole('button', { name: 'Back', exact: true }).click();

    // 5. Social scopes, header Search, Circle lifecycle, and post detail.
    await open('chat-default');
    await device.getByRole('button', { name: 'Moments', exact: true }).click();
    await capture('social-home');
    await verifySocialInteractions(page, device, capture);
    await verifyInlineComments(page, device);
    await device.locator('[data-comment-action="mo1"]').click();
    await capture('social-inline-comment');
    await device.locator('[data-social-post="mo1"] .mp-moment-comment-input').press('Escape');
    await device.getByRole('button', { name: 'Open post by Carol Li', exact: true }).click();
    assert.equal(await device.locator('[data-prototype-page="social-detail"]').count(), 1);
    assert.equal(await device.locator('.mp-tabbar').count(), 0);
    assert(await device.getByPlaceholder('Write a comment...', { exact: true }).isVisible());
    await capture('social-detail');
    await device.getByRole('button', { name: 'Back', exact: true }).click();

    // 6. Mobile Settings preserves Desktop's production ownership groups and every
    // meaningful section. No generic placeholder is allowed to satisfy a row.
    await device.getByRole('button', { name: 'Me', exact: true }).click();
    const profileGeometry = await device.locator('[data-prototype-page="settings"]').evaluate((page) => {
      const cover = page.querySelector('.mp-profile-cover')?.getBoundingClientRect();
      const bounds = page.getBoundingClientRect();
      return { pageTop: bounds.top, coverTop: cover?.top ?? -1 };
    });
    assert(
      Math.abs(profileGeometry.pageTop - profileGeometry.coverTop) <= 1,
      `Me cover must own the top page boundary: ${JSON.stringify(profileGeometry)}`,
    );
    assert.equal(await device.getByRole('button', { name: 'Open account settings', exact: true }).count(), 0);
    assert.equal(await device.getByRole('button', { name: 'Edit profile', exact: true }).count(), 1);
    assert.deepEqual(
      await device.locator('.mp-settings-group-title').allTextContents(),
      settingsCatalog.groups.map((group) => group.label),
    );
    const settingIds = settingsCatalog.groups.flatMap(
      (group) => group.sections.map((section) => section.id),
    );
    assert.equal(await device.locator('[data-setting-id]').count(), settingIds.length);
    await capture('settings-home');
    for (const settingId of settingIds) {
      await device.locator(`[data-setting-id="${settingId}"]`).click();
      const detail = device.locator(`[data-setting-detail="${settingId}"]`);
      assert.equal(await detail.count(), 1, `missing setting detail ${settingId}`);
      assert.equal(await detail.getByText(/Configure your .* preferences here\./).count(), 0,
        `generic setting placeholder leaked for ${settingId}`);
      assert(await detail.locator('.mp-setting-section, .mp-account-identity, .mp-about-hero').count() > 0,
        `setting detail ${settingId} has no meaningful section`);
      await capture(`settings-${settingId}`);
      if (settingId === 'account') {
        assert.equal(await detail.locator('.mp-account-identity button, .mp-account-identity [role="button"]').count(), 2,
          'Account hero must expose background and avatar editing');
        assert.equal(await detail.locator('[data-account-mode="view"]').count(), 1);
        await capture('settings-account-view');
        const mediaFile = {
          name: 'profile.png',
          mimeType: 'image/png',
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
          ),
        };
        const coverChooser = page.waitForEvent('filechooser');
        await detail.getByRole('button', { name: 'Change profile background', exact: true }).click();
        await (await coverChooser).setFiles(mediaFile);
        assert.equal(await detail.locator('[data-account-mode="edit"]').count(), 1);
        assert(await detail.locator('.mp-account-cover').evaluate(
          (element) => getComputedStyle(element).backgroundImage.includes('data:image/png'),
        ));
        await detail.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(
          (await detail.locator('.mp-account-cover').getAttribute('style'))?.includes('data:image/png') ?? false,
          false,
        );
        const avatarChooser = page.waitForEvent('filechooser');
        await detail.getByRole('button', { name: /profile photo$/ }).click();
        await (await avatarChooser).setFiles(mediaFile);
        await detail.getByRole('button', { name: 'Save', exact: true }).click();
        assert(await detail.locator('.mp-account-person img').evaluate(
          (element) => element.getAttribute('src')?.startsWith('data:image/png'),
        ));
        await detail.getByRole('button', { name: 'Edit', exact: true }).click();
        const profileForm = detail.locator('[data-account-mode="edit"]');
        assert.equal(await profileForm.count(), 1);
        assert(await detail.getByRole('button', { name: 'Cancel', exact: true }).isVisible());
        assert(await detail.getByRole('button', { name: 'Save', exact: true }).isVisible());
        const editGeometry = await profileForm.evaluate((form) => {
          const owner = form.getBoundingClientRect();
          return [...form.querySelectorAll('label')].map((label) => {
            const caption = label.querySelector(':scope > span')?.getBoundingClientRect();
            const input = label.querySelector('input, textarea')?.getBoundingClientRect();
            return {
              ownerLeft: owner.left,
              ownerRight: owner.right,
              inputLeft: input?.left,
              inputRight: input?.right,
              captionBottom: caption?.bottom,
              inputTop: input?.top,
            };
          });
        });
        assert(editGeometry.every((row) => (
          Math.abs(row.inputLeft - row.ownerLeft) <= 1
          && Math.abs(row.inputRight - row.ownerRight) <= 1
          && row.captionBottom <= row.inputTop
        )), `Account fields must own a full row without overlap: ${JSON.stringify(editGeometry)}`);
        await capture('settings-account-edit');
        await profileForm.getByLabel('Display name', { exact: true }).fill('Unsaved Name');
        await detail.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await detail.locator('.mp-account-name').innerText(), 'Alice Chen');
        await detail.getByRole('button', { name: 'Edit', exact: true }).click();
        await detail.getByLabel('Display name', { exact: true }).fill('Alice Review');
        await detail.getByRole('button', { name: 'Save', exact: true }).click();
        assert.equal(await detail.locator('.mp-account-name').innerText(), 'Alice Review');
        const unblockActions = detail.getByRole('button', { name: 'Unblock', exact: true });
        await unblockActions.last().scrollIntoViewIfNeeded();
        const accountTailGeometry = await detail.evaluate((owner) => ({
          overflowing: owner.scrollWidth > owner.clientWidth,
          codeWidths: [...owner.querySelectorAll('.mp-setting-code')]
            .map((code) => code.getBoundingClientRect().width),
          unblockRights: [...owner.querySelectorAll('.mp-setting-detail-row .ant-btn')]
            .filter((button) => button.textContent?.trim() === 'Unblock')
            .map((button) => button.getBoundingClientRect().right),
        }));
        assert.equal(accountTailGeometry.overflowing, false);
        assert(accountTailGeometry.codeWidths.every((width) => width >= 72),
          `Technical identity values must remain inspectable: ${JSON.stringify(accountTailGeometry.codeWidths)}`);
        assert(accountTailGeometry.unblockRights.length === 2
          && Math.abs(accountTailGeometry.unblockRights[0] - accountTailGeometry.unblockRights[1]) <= 1,
        `Blocked-user actions must share one trailing edge: ${JSON.stringify(accountTailGeometry.unblockRights)}`);
        await capture('settings-account-bottom');
      }
      if (settingId === 'federation') await capture('settings-federation');
      if (settingId === 'storage') {
        const storageGeometry = await detail.evaluate((owner) => {
          const summary = owner.querySelector('.mp-storage-overview')?.getBoundingClientRect();
          const total = owner.querySelector('.mp-storage-total')?.getBoundingClientRect();
          const breakdown = [...owner.querySelectorAll('.mp-storage-category-grid > span')]
            .map((element) => element.getBoundingClientRect());
          return {
            overflowing: owner.scrollWidth > owner.clientWidth,
            summaryWidth: summary?.width ?? 0,
            totalWidth: total?.width ?? 0,
            breakdownWidths: breakdown.map((rect) => rect.width),
            breakdownRows: breakdown.map((rect) => rect.height),
          };
        });
        assert.equal(storageGeometry.overflowing, false);
        assert(storageGeometry.summaryWidth >= 240 && storageGeometry.totalWidth >= 120,
          `Storage summary must preserve readable tracks: ${JSON.stringify(storageGeometry)}`);
        assert(storageGeometry.breakdownWidths.every((width) => width >= 100)
          && storageGeometry.breakdownRows.every((height) => height >= 56),
        `Storage categories must not collapse into narrow columns: ${JSON.stringify(storageGeometry)}`);
        await capture('settings-storage');
      }
      await detail.getByRole('button', { name: 'Back', exact: true }).click();
    }

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
