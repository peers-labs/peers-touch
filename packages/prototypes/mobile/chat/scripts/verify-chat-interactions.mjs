import assert from 'node:assert/strict';
import { resolve } from 'node:path';

async function composerGeometry(page, platform, scope = page) {
  const field = scope.locator(platform === 'mobile' ? '.mp-composer-input' : '[data-chat-composer-field] textarea');
  return field.evaluate((input) => {
    const dock = input.closest('.mp-composer-dock, [data-chat-composer-field]');
    const send = dock.querySelector('.mp-composer-send, [data-chat-send]');
    const emoji = dock.querySelector('[aria-label="Emoji"]');
    const i = input.getBoundingClientRect(), d = dock.getBoundingClientRect();
    const s = send.getBoundingClientRect(), e = emoji.getBoundingClientRect();
    const css = getComputedStyle(input);
    return { inputHeight: i.height, dockHeight: d.height, width: i.width,
      border: parseFloat(css.borderTopWidth), background: css.backgroundColor,
      sameRow: Math.abs((i.top + i.bottom) / 2 - (s.top + s.bottom) / 2) <= 3
        && Math.abs((e.top + e.bottom) / 2 - (s.top + s.bottom) / 2) <= 3,
      inputFits: i.left >= e.right && i.right <= s.left,
    };
  });
}

function assertCompact(geometry) {
  assert(geometry.sameRow && geometry.inputFits, `composer must have one row: ${JSON.stringify(geometry)}`);
  assert(geometry.dockHeight <= 52 && geometry.width > 80, `compact usable input: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.border, 0, 'actual textarea must be borderless');
  assert.equal(geometry.background, 'rgba(0, 0, 0, 0)', 'actual textarea must be transparent');
}

export async function verifyChatInteractions({ browser, open, platform, output }) {
  const mobile = platform === 'mobile';
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: mobile });
  const replyCounts = [0, 3, 10, 11];
  const base = Date.now() - 100_000;
  const roots = replyCounts.map((count) => {
    const replies = Array.from({ length: count }, (_, index) => mobile
      ? { id: `reply-${count}-${index}`, mine: index % 2 === 0, text: `Reply ${index + 1} of ${count}`,
        sender: { id: 'user-1', name: 'Sarah Kim', avatar: 'SK' }, time: '10:25', status: 'read' }
      : { id: `reply-${count}-${index}`, senderId: index % 2 === 0 ? 'user-self' : 'user-1',
        content: `Reply ${index + 1} of ${count}`, timestamp: base, type: 'text', status: 'read' });
    return mobile
      ? { id: `root-${count}`, mine: count === 11, text: `Review with ${count} replies`, time: '10:24',
        sender: { id: 'user-1', name: 'Sarah Kim', avatar: 'SK' }, pinned: count > 0, threadReplies: replies, status: 'read' }
      : { id: `root-${count}`, senderId: count === 11 ? 'user-self' : 'user-1', content: `Review with ${count} replies`,
        timestamp: base, type: 'text', pinned: count > 0, threadReplies: replies, status: 'read' };
  });
  await page.route(mobile ? '**/mobile/chat/src/data.ts*' : '**/social-chat/src/mock.ts*', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: body + (mobile
      ? `\ndemoMessages.splice(0,demoMessages.length,...${JSON.stringify(roots)});`
      : `\nMESSAGES['conv-1']=${JSON.stringify(roots)};`) });
  });
  try {
    await open(page, platform, true);
    const scope = mobile ? page.getByRole('region', { name: 'Mobile device preview' }) : page;
    const textarea = scope.locator(mobile ? '.mp-composer-input' : '[data-chat-composer-field] textarea');
    const compact = await composerGeometry(page, platform, scope);
    assertCompact(compact);
    if (mobile) {
      const emojiDialog = scope.getByRole('dialog', { name: 'Emoji picker', exact: true });
      const attachmentDialog = scope.getByRole('dialog', { name: 'Attachment options', exact: true });
      const attach = scope.getByRole('button', { name: 'Attach', exact: true });
      assert.equal(await attach.count(), 1, 'Mobile composer exposes one attachment entry');

      await scope.getByRole('button', { name: 'Emoji', exact: true }).click();
      await emojiDialog.waitFor();
      await scope.screenshot({ path: resolve(output, 'mobile-emoji-drawer.png') });
      await textarea.click();
      await emojiDialog.waitFor({ state: 'detached' });

      await attach.click();
      await attachmentDialog.waitFor();
      await textarea.click();
      await attachmentDialog.waitFor({ state: 'detached' });

      await attach.click();
      await attachmentDialog.waitFor();
      await scope.getByRole('button', { name: 'Emoji', exact: true }).click();
      assert.equal(await attachmentDialog.count(), 0, 'Attachment and emoji drawers are mutually exclusive');
      await emojiDialog.waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await emojiDialog.count(), 0, 'Escape closes the emoji drawer');

      await attach.click();
      await attachmentDialog.waitFor();
      await scope.screenshot({ path: resolve(output, 'mobile-attachment-drawer.png') });
      const chooserPromise = page.waitForEvent('filechooser');
      await attachmentDialog.getByRole('button', { name: 'File', exact: true }).click();
      const chooser = await chooserPromise;
      await chooser.setFiles({
        name: 'release-notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('release notes'),
      });
      await scope.locator('[data-composer-attachment="file"]').waitFor();
      await scope.screenshot({ path: resolve(output, 'mobile-attachment-preview.png') });
      assert.equal(await attachmentDialog.count(), 0, 'File selection closes the attachment drawer');
      await scope.getByRole('button', { name: 'Send', exact: true }).click();
      await scope.getByText('release-notes.txt', { exact: true }).last().waitFor();
      assertCompact(await composerGeometry(page, platform, scope));
    }
    await textarea.fill('First line');
    await textarea.press('End');
    await textarea.press('Shift+Enter');
    await textarea.press('b');
    assert.equal(await textarea.inputValue(), 'First line\nb');
    const grown = await composerGeometry(page, platform, scope);
    assert(grown.inputHeight > compact.inputHeight, 'multiline input grows');
    await textarea.dispatchEvent('compositionstart');
    await textarea.press('Enter');
    await textarea.dispatchEvent('compositionend');
    assert((await textarea.inputValue()).startsWith('First line\nb'), 'IME Enter must preserve the draft');
    await textarea.fill('');
    await scope.getByRole('button', { name: 'Emoji', exact: true }).click();
    const emoji = mobile ? '👍' : '😀';
    await scope.getByRole('button', { name: `Insert ${emoji}`, exact: true }).first().click();
    assert.equal(await textarea.inputValue(), emoji);
    await textarea.fill('');

    for (const count of replyCounts) {
      const row = page.locator(`[data-chat-message-id="root-${count}"]`);
      assert.equal(await row.locator('[data-chat-inline-reply]').count(), Math.min(count, 10), `${count}: visible replies`);
      assert.equal(await row.locator('[data-chat-replies-more]').count(), Number(count > 10), `${count}: More threshold`);
      assert.equal(await row.getByRole('button', {
        name: `Open thread with ${count} ${count === 1 ? 'reply' : 'replies'}`, exact: true,
      }).count(), Number(count > 0), `${count}: visible thread entry`);
      assert.equal(await row.locator('[data-chat-sender]').count(), 0);
    }
    await page.locator('[data-chat-message-id="root-11"] [data-chat-replies-more]').click();
    assert.equal(await page.locator('[data-chat-message-id="root-11"] [data-chat-inline-reply]').count(), 11);
    assert.equal(await page.locator('[data-chat-replies-more]').count(), 0);
    assert.equal(await page.locator('.mp-thread-view, [data-chat-thread-panel]').count(), 0, 'More stays in place');

    const pins = scope.locator('[data-chat-pins]');
    const counter = pins.locator('[data-chat-pin-count]');
    await counter.getByText('1/3', { exact: true }).waitFor();
    await pins.getByRole('button', { name: 'Next pinned message', exact: true }).click();
    await counter.getByText('2/3', { exact: true }).waitFor();
    const track = pins.locator('[data-chat-pins-track]');
    if (mobile) {
      assert.equal(await track.evaluate((element) => getComputedStyle(element).touchAction), 'pan-x');
      await track.evaluate((element) => element.scrollTo({ left: element.clientWidth * 2, behavior: 'smooth' }));
    } else {
      const trackRect = await track.boundingBox();
      await track.hover();
      await page.mouse.wheel(trackRect.width, 0);
    }
    await counter.getByText('3/3', { exact: true }).waitFor();
    await pins.locator('[data-chat-pin="root-11"]').press('ArrowLeft');
    await counter.getByText('2/3', { exact: true }).waitFor();
    await pins.locator('[data-chat-pin="root-10"]').click();
    const target = page.locator('[data-chat-message-id="root-10"]');
    await target.scrollIntoViewIfNeeded();
    const jumpRect = await target.boundingBox();
    assert(jumpRect.y >= 0 && jumpRect.y < 1000, 'pin activation reveals the matching message');

    const action = async (id, label) => {
      const row = page.locator(`[data-chat-message-id="${id}"]`);
      await row.evaluate((element) => new Promise((resolve) => {
        element.scrollIntoView({ block: 'center', behavior: 'instant' });
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      if (mobile) await row.locator('.mp-bubble').click({ button: 'right' });
      else {
        await row.hover();
        await row.getByRole('button', { name: 'More message actions', exact: true }).click();
      }
      const button = (mobile ? scope : row).getByRole('button', { name: label, exact: true });
      if (await button.count() === 0) {
        const names = await (mobile ? scope : row).getByRole('button').allTextContents();
        throw new Error(`${platform} ${id}: missing ${label}; buttons=${JSON.stringify(names)}`);
      }
      await button.click();
    };
    if (mobile) {
      const row = page.locator('[data-chat-message-id="root-3"]');
      await row.locator('.mp-bubble').click({ button: 'right' });
      const actionSheet = scope.getByRole('dialog', { name: 'Message actions', exact: true });
      await actionSheet.waitFor();
      await scope.getByRole('button', { name: 'More', exact: true }).focus();
      await actionSheet.waitFor({ state: 'detached' });

      await row.locator('.mp-bubble').click({ button: 'right' });
      await actionSheet.waitFor();
      await page.keyboard.press('Escape');
      await actionSheet.waitFor({ state: 'detached' });

      await row.locator('.mp-bubble').click({ button: 'right' });
      await actionSheet.getByRole('button', { name: 'Forward', exact: true }).click();
      const forwardSheet = scope.getByRole('dialog', { name: 'Forward message', exact: true });
      await forwardSheet.waitFor();
      await scope.getByRole('button', { name: 'More', exact: true }).focus();
      await forwardSheet.waitFor({ state: 'detached' });

      await row.locator('.mp-bubble').click({ button: 'right' });
      await actionSheet.getByRole('button', { name: 'Forward', exact: true }).click();
      await forwardSheet.waitFor();
      await page.keyboard.press('Escape');
      await forwardSheet.waitFor({ state: 'detached' });
    }
    // Removing the pin before the current one keeps the selected actor/message stable.
    await action('root-3', 'Unpin');
    await counter.getByText('1/2', { exact: true }).waitFor();
    assert.equal(await pins.locator('[data-chat-pin][tabindex="0"]').getAttribute('data-chat-pin'), 'root-10');
    await action('root-10', 'Unpin');
    assert.equal(await counter.count(), 0, 'single pin has no count tag');
    assert.equal(await pins.locator('[data-chat-pin][tabindex="0"]').getAttribute('data-chat-pin'), 'root-11');
    await action('root-11', mobile ? 'Recall' : 'Recall');
    if (mobile && await scope.getByRole('button', { name: 'Recall', exact: true }).count()) {
      await scope.getByRole('button', { name: 'Recall', exact: true }).click();
    }
    assert.equal(await pins.count(), 0, 'recalled messages disappear from pin previews');

    await action('root-3', mobile ? 'Thread' : 'Reply in thread');
    const panel = scope.locator(mobile ? '.mp-thread-view' : '[data-chat-thread-panel]');
    await panel.waitFor();
    if (mobile) assertCompact(await composerGeometry(page, platform, panel));
    await panel.locator('textarea').fill('A reply shared by both views');
    await panel.getByRole('button', { name: mobile ? 'Send' : 'Send thread reply', exact: true }).click();
    await panel.getByText('A reply shared by both views', { exact: true }).waitFor();
    const threadSurface = mobile ? scope : page.getByText('Live Preview', { exact: true }).locator('../..');
    await threadSurface.screenshot({ path: resolve(output, `${platform}-thread-panel.png`) });
    await panel.getByRole('button', { name: mobile ? 'Back' : 'Close thread', exact: true }).click();
    const replyRoot = scope.locator('[data-chat-message-id="root-3"]');
    assert.equal(await replyRoot.locator('[data-chat-inline-reply]').count(), 4);
    await replyRoot.getByText('A reply shared by both views', { exact: true }).waitFor();
    await action('root-3', 'Pin');
    await action('root-10', 'Pin');
    await counter.getByText('1/2', { exact: true }).waitFor();
    await replyRoot.scrollIntoViewIfNeeded();
    const surface = mobile ? scope : page.getByText('Live Preview', { exact: true }).locator('../..');
    await surface.screenshot({ path: resolve(output, `${platform}-inline-replies-compact-composer-pins.png`) });
    if (mobile) {
      await page.getByText('Dark', { exact: true }).click();
      assertCompact(await composerGeometry(page, platform, scope));
      await surface.screenshot({ path: resolve(output, 'mobile-inline-replies-dark.png') });
      await scope.getByRole('button', { name: 'Attach', exact: true }).click();
      await scope.getByRole('dialog', { name: 'Attachment options', exact: true }).waitFor();
      await scope.screenshot({ path: resolve(output, 'mobile-attachment-drawer-dark.png') });
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 390, height: 844 });
      assertCompact(await composerGeometry(page, platform, scope));
    }
    // A regression to the old stacked layout must fail the geometry gate.
    await page.addStyleTag({ content: mobile
      ? '.mp-composer-dock { display: block !important; } textarea.mp-composer-input.ant-input { width: 100% !important; border: 1px solid black !important; }'
      : '[data-chat-composer-field] { display: block !important; }' });
    assert.throws(() => assertCompact({ ...compact, sameRow: false }), /one row/);
    const broken = await composerGeometry(page, platform, scope);
    assert.throws(() => assertCompact(broken), /one row|borderless|compact/);
    return { replyCounts, more: 'in-place', sharedReplyMutation: true, pins: 'swipe-keyboard-add-unpin-recall',
      mobileTransientLayers: mobile ? 'emoji-attachment-actions-forward-dismissed' : 'not-applicable',
      compact, multilineHeight: grown.inputHeight, ime: 'preserved', negativeControl: 'stacked-composer-rejected' };
  } finally {
    await page.close();
  }
}

export async function verifyMobileTransientLayers({ browser, open }) {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, hasTouch: true });
  try {
    await open(page, 'mobile');
    const device = page.getByRole('region', { name: 'Mobile device preview' });
    await device.getByRole('button', { name: 'Back', exact: true }).click();

    await device.getByRole('button', { name: 'Contacts', exact: true }).click();
    await device.getByRole('button', { name: 'Find People', exact: true }).click();
    const people = device.getByRole('dialog', { name: 'Find People', exact: true });
    await people.waitFor();
    await page.keyboard.press('Escape');
    await people.waitFor({ state: 'detached' });
    await device.getByRole('button', { name: 'Find People', exact: true }).click();
    await device.locator('.mp-action-sheet-backdrop').click({ position: { x: 5, y: 5 } });
    await people.waitFor({ state: 'detached' });

    await device.getByRole('button', { name: 'Moments', exact: true }).click();
    await device.getByRole('button', { name: 'New post', exact: true }).click();
    const newPost = device.getByRole('dialog', { name: 'New post', exact: true });
    await newPost.waitFor();
    const momentTextarea = newPost.locator('textarea');
    await momentTextarea.waitFor();
    assert.equal(await momentTextarea.evaluate((element) => document.activeElement === element), true,
      'New post owns focus after its Portal mounts');
    await page.keyboard.press('Escape');
    await newPost.waitFor({ state: 'detached' });

    await device.getByRole('button', { name: 'Me', exact: true }).click();
    await device.getByText('Command Palette', { exact: true }).click();
    await device.getByRole('button', { name: 'Open Command Palette', exact: true }).click();
    const command = device.getByRole('dialog', { name: 'Command Palette', exact: true });
    await command.waitFor();
    await device.getByRole('button', { name: 'Back', exact: true }).focus();
    await command.waitFor({ state: 'detached' });
    await device.getByRole('button', { name: 'Open Command Palette', exact: true }).click();
    await command.waitFor();
    await page.keyboard.press('Escape');
    await command.waitFor({ state: 'detached' });
    await device.getByRole('button', { name: 'Back', exact: true }).click();
    const signOut = device.getByRole('button', {
      name: 'Sign out and switch Station',
      exact: true,
    });
    await signOut.click();
    const confirmation = device.getByRole('dialog', {
      name: 'Sign out and switch Station?',
      exact: true,
    });
    assert(await confirmation.getByRole('button', { name: 'Cancel', exact: true })
      .evaluate((element) => element === document.activeElement));
    assert.equal(await device.locator('.mp-profile-body').getAttribute('inert'), '');
    await page.keyboard.press('Shift+Tab');
    assert(await confirmation.evaluate((element) => element.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await confirmation.waitFor({ state: 'detached' });
    assert(await signOut.evaluate((element) => element === document.activeElement));
    return {
      composerPanels: 'focus-outside/escape/mutual-exclusion',
      messageActions: 'escape',
      forwarding: 'escape',
      findPeople: 'escape/outside-press',
      newPost: 'escape',
      commandPalette: 'focus-outside/escape',
      dangerConfirmation: 'focus-trap/background-inert/escape/focus-return',
      intentionalExceptions: ['blocking recovery', 'active call'],
    };
  } finally {
    await page.close();
  }
}
