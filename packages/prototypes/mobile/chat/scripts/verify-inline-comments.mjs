import assert from 'node:assert/strict';

export async function verifyInlineComments(page, device) {
  const url = page.url();
  let feed = await device.locator('[data-prototype-page="social"]').elementHandle();
  const firstPost = device.locator('[data-social-post="mo1"]');
  const emptyPost = device.locator('[data-social-post="mo4"]');
  const firstAction = firstPost.locator('[data-comment-action]');
  const emptyAction = emptyPost.locator('[data-comment-action]');
  const firstInput = firstPost.locator('.mp-moment-comment-input');
  const emptyInput = emptyPost.locator('.mp-moment-comment-input');

  async function verifyContext() {
    assert.equal(page.url(), url, 'Commenting must not navigate');
    assert(await feed.evaluate((element) => element.isConnected), 'Commenting must retain the feed tree');
    assert.equal(await device.locator('[data-prototype-page="social-detail"]').count(), 0,
      'Comment action must not open post detail');
    assert.equal(await device.locator('.mp-tabbar').count(), 1, 'Commenting must retain primary navigation');
  }

  assert.equal(await device.locator('.mp-moment-comment-input').count(), 0, 'Reply fields start closed');
  const before = await firstPost.locator('.mp-moment-comment').count();
  const anatomy = await firstPost.locator('.mp-moment-comment').first().evaluate((element) => {
    const avatar = element.querySelector('.mp-identity-avatar')?.getBoundingClientRect();
    const heading = element.querySelector('.mp-moment-comment-heading');
    const copy = element.querySelector('.mp-moment-comment-copy');
    return {
      avatarSize: avatar?.width,
      authorInsideHeading: Boolean(heading?.querySelector('.mp-actor-link')),
      authorInsideCopy: Boolean(copy?.querySelector('.mp-actor-link')),
      textInsideCopy: Boolean(copy?.querySelector('.mp-moment-comment-text')),
      replyInsideHeading: Boolean(heading?.querySelector('.mp-moment-comment-reply')),
    };
  });
  assert.equal(Math.round(anatomy.avatarSize), 28);
  assert(anatomy.authorInsideHeading && !anatomy.authorInsideCopy && anatomy.textInsideCopy);
  assert(anatomy.replyInsideHeading);
  const commentAlignment = await firstPost.evaluate((post) => {
    const comments = post.querySelector('.mp-moment-comments')?.getBoundingClientRect();
    const actions = post.querySelector('.mp-moment-actions')?.getBoundingClientRect();
    return comments && actions ? Math.abs(comments.left - actions.left) : Number.POSITIVE_INFINITY;
  });
  assert(commentAlignment <= 1, `Comments must align with the post action rail, delta ${commentAlignment}px`);
  await firstAction.click();
  await verifyContext();
  assert.equal(await firstAction.getAttribute('aria-expanded'), 'true');
  assert.equal(await device.locator('.mp-moment-comment-input').count(), 1);
  assert(await firstInput.evaluate((element) => element === document.activeElement));
  const geometry = await firstInput.evaluate((element) => {
    const field = element.getBoundingClientRect();
    const page = element.closest('.mp-page').getBoundingClientRect();
    return {
      visible: field.top >= page.top - 1 && field.bottom <= page.bottom + 1,
      width: field.width,
      height: field.height,
      radius: parseFloat(getComputedStyle(element).borderTopLeftRadius),
    };
  });
  assert(geometry.visible && geometry.width >= 120, 'Reply field must be readable and unobscured');
  assert(geometry.height >= 44 && geometry.radius === 8, 'Reply field must use the Mobile control geometry');

  await firstInput.fill('A preserved draft');
  await firstInput.press('Escape');
  assert.equal(await firstInput.count(), 0);
  assert(await firstAction.evaluate((element) => element === document.activeElement));
  await firstAction.press('Enter');
  assert.equal(await firstInput.inputValue(), 'A preserved draft');

  await firstInput.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  assert.equal(await firstPost.locator('.mp-moment-comment').count(), before, 'IME confirmation must not submit');
  assert.equal(await firstInput.inputValue(), 'A preserved draft');
  await firstInput.fill('Inline comment stays with its post');
  await firstInput.press('Enter');
  assert.equal(await firstPost.locator('.mp-moment-comment').count(), before + 1);
  assert(await firstPost.getByText('Inline comment stays with its post', { exact: true }).isVisible());
  assert.equal(await firstInput.inputValue(), '');
  await verifyContext();

  await firstPost.getByRole('button', { name: 'Reply to Alice Chen', exact: true }).first().click();
  assert.equal(await firstInput.inputValue(), '@Alice Chen ');
  assert(await firstInput.evaluate((element) => element === document.activeElement));
  await firstInput.fill('Draft for the first post');
  await device.locator('[data-tab-id="chat"]').click();
  await device.locator('[data-tab-id="moments"]').click();
  await feed.dispose();
  feed = await device.locator('[data-prototype-page="social"]').elementHandle();
  assert.equal(await device.locator('.mp-moment-comment-input').count(), 0);
  await firstAction.click();
  assert.equal(
    await firstInput.inputValue(),
    'Draft for the first post',
    'Comment drafts must survive selected-only tab remounts',
  );
  await emptyAction.click();
  assert.equal(await device.locator('.mp-moment-comment-input').count(), 1);
  assert.equal(await emptyInput.inputValue(), '', 'Drafts must not leak between posts');
  assert.equal(await emptyPost.locator('.mp-moment-comment').count(), 0);
  await emptyInput.fill('Draft for the public post');

  await device.getByRole('button', { name: 'Public', exact: true }).click();
  assert.equal(await device.locator('.mp-moment-comment-input').count(), 0);
  await emptyAction.click();
  assert.equal(await emptyInput.inputValue(), 'Draft for the public post');
  await emptyInput.fill('   ');
  assert(await emptyPost.locator('button[type="submit"]').isDisabled());
  await emptyInput.press('Enter');
  assert.equal(await emptyPost.locator('.mp-moment-comment').count(), 0);
  await emptyInput.fill('First comment on a public post');
  await emptyPost.locator('button[type="submit"]').click();
  assert.equal(await emptyPost.locator('.mp-moment-comment').count(), 1);
  assert.equal(await emptyInput.inputValue(), '');
  await verifyContext();

  await device.getByRole('button', { name: 'Home', exact: true }).click();
  await firstAction.click();
  assert.equal(await firstInput.inputValue(), 'Draft for the first post');
  await verifyContext();
  await firstInput.press('Escape');
  await feed.dispose();
  return { feedRetained: true, home: true, public: true, drafts: true, keyboard: true, ime: true };
}
