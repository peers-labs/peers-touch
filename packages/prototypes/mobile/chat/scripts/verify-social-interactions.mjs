import assert from 'node:assert/strict';

export async function verifySocialInteractions(page, device, capture = async () => {}) {
  const initialUrl = page.url();
  const scopes = await device.locator('.mp-social-scope button').allTextContents();
  assert.deepEqual(scopes, ['Home', 'Public', 'Circles']);
  const toolbarHeights = [];
  assert(
    await device.locator('.mp-social-context').evaluate(
      (element) => element.getBoundingClientRect().height,
    ) <= 1,
    'Home refresh slot must not occupy a row while idle',
  );
  assert.equal(await device.locator('[data-social-post]').count(), 5);
  assert.equal(await device.locator('.mp-social-header-actions').getByRole('button').count(), 2);
  const firstPost = device.locator('[data-social-post="mo1"]');
  const likeReaction = firstPost.locator('[data-moment-reaction="like"]');
  assert.equal(await likeReaction.getAttribute('aria-pressed'), 'true');
  await likeReaction.click();
  assert.equal(await likeReaction.getAttribute('aria-pressed'), 'false');
  assert.equal((await likeReaction.innerText()).replace(/\s+/g, ' ').trim(), '👍 19');
  await likeReaction.click();
  assert.equal(await likeReaction.getAttribute('aria-pressed'), 'true');
  assert.equal((await likeReaction.innerText()).replace(/\s+/g, ' ').trim(), '👍 20');
  const reactionGeometry = await likeReaction.evaluate((target) => {
    const visible = target.querySelector('[data-reaction-visual]');
    const targetRect = target.getBoundingClientRect();
    const visibleRect = visible.getBoundingClientRect();
    return {
      targetWidth: targetRect.width,
      targetHeight: targetRect.height,
      visibleHeight: visibleRect.height,
      radius: Number.parseFloat(getComputedStyle(visible).borderTopLeftRadius),
    };
  });
  assert.equal(reactionGeometry.visibleHeight, 28);
  assert(reactionGeometry.radius >= reactionGeometry.visibleHeight / 2);
  assert(reactionGeometry.targetWidth >= 44 && reactionGeometry.targetHeight >= 44);
  const reactionAction = firstPost.getByRole('button', { name: 'React to post', exact: true });
  await reactionAction.click();
  const picker = firstPost.getByRole('group', { name: 'Choose reactions', exact: true });
  assert.equal(await picker.locator('[data-reaction-picker-item]').count(), 5);
  const pickerGeometry = await firstPost.evaluate((post) => {
    const summary = post.querySelector('.mp-moment-reaction-summary')?.getBoundingClientRect();
    const tray = post.querySelector('.mp-moment-reaction-picker')?.getBoundingClientRect();
    return {
      summaryBottom: summary?.bottom ?? 0,
      trayTop: tray?.top ?? 0,
    };
  });
  assert(
    pickerGeometry.summaryBottom <= pickerGeometry.trayTop,
    `Reaction picker must not cover selected reactions: ${JSON.stringify(pickerGeometry)}`,
  );
  const pickerLove = picker.locator('[data-reaction-picker-item="love"]');
  await pickerLove.click();
  assert.equal(await likeReaction.getAttribute('aria-pressed'), 'true');
  const loveReaction = firstPost.locator('[data-moment-reaction="love"]');
  assert.equal(await loveReaction.getAttribute('aria-pressed'), 'true');
  assert.equal((await loveReaction.innerText()).replace(/\s+/g, ' ').trim(), '❤️ 4');
  assert.equal((await reactionAction.innerText()).trim(), 'React');
  assert(await picker.isVisible(), 'Reaction picker stays open for independent multi-select');
  await capture('social-reaction-multi');
  assert.equal(
    await picker.locator('[data-reaction-picker-item="like"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await pickerLove.getAttribute('aria-pressed'),
    'true',
  );
  await capture('social-reaction-picker-selected');
  await pickerLove.click();
  assert.equal(await likeReaction.getAttribute('aria-pressed'), 'true');
  assert.equal(await loveReaction.getAttribute('aria-pressed'), 'false');
  assert.equal((await reactionAction.innerText()).trim(), 'React');
  await capture('social-reaction-independent-remove');
  await picker.locator('[data-reaction-picker-item="wow"]').click();
  assert.equal(
    await firstPost.locator('[data-moment-reaction="wow"]').getAttribute('aria-pressed'),
    'true',
  );
  await reactionAction.click();
  await device.locator('[data-tab-id="chat"]').click();
  await device.locator('[data-tab-id="moments"]').click();
  assert.equal(
    await device.locator('[data-social-post="mo1"] [data-moment-reaction="wow"]')
      .getAttribute('aria-pressed'),
    'true',
    'Moments projection state must survive selected-only tab remounts',
  );
  await device.getByRole('button', { name: 'Open post by Emma Liu', exact: true }).click();
  const detailPost = device.locator('[data-social-post="mo3"]');
  const detailReactionAction = detailPost.getByRole('button', { name: 'React to post', exact: true });
  await detailReactionAction.click();
  const detailPicker = detailPost.locator('[data-reaction-picker]');
  await detailPicker.locator('[data-reaction-picker-item="wow"]').click();
  await detailPicker.locator('[data-reaction-picker-item="celebrate"]').click();
  assert.equal(
    await detailPost.locator('[data-moment-reaction="wow"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await detailPost.locator('[data-moment-reaction="celebrate"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal((await detailReactionAction.innerText()).trim(), 'React');
  await capture('social-detail-reaction-multi');
  await device.getByRole('button', { name: 'Back', exact: true }).click();

  await device.getByRole('button', { name: 'Public', exact: true }).click();
  toolbarHeights.push(
    await device.locator('.mp-social-context').evaluate((element) => element.getBoundingClientRect().height),
  );
  assert.equal(await device.locator('[data-social-post]').count(), 2);
  assert(await device.locator('[data-social-post] .mp-moment-audience').evaluateAll(
    (elements) => elements.every((element) => element.textContent?.trim() === 'Public'),
  ));
  await capture('social-public');

  await device.locator('.mp-social-header-actions')
    .getByRole('button', { name: 'Search', exact: true }).click();
  assert.equal(await device.locator('[data-prototype-page="social-search"]').count(), 1);
  assert.equal(await device.locator('.mp-tabbar').count(), 0);
  const search = device.getByPlaceholder('Search people and posts', { exact: true });
  await search.fill('Carol');
  assert(await device.getByRole('heading', { name: 'People', exact: true }).isVisible());
  assert(await device.getByRole('heading', { name: 'Posts', exact: true }).isVisible());
  const follow = device.getByRole('button', { name: 'Following', exact: true });
  assert(await follow.isVisible());
  await follow.click();
  assert(await device.getByRole('button', { name: 'Follow', exact: true }).isVisible());
  await capture('social-search');

  await device.getByRole('button', { name: 'Open post by Carol Li', exact: true }).click();
  assert.equal(await device.locator('[data-prototype-page="social-detail"]').count(), 1);
  await device.getByRole('button', { name: 'Back', exact: true }).click();
  assert.equal(await search.inputValue(), 'Carol', 'Search query must survive post detail');
  await device.getByRole('button', { name: 'Back', exact: true }).click();
  assert.equal(
    await device.getByRole('button', { name: 'Public', exact: true }).getAttribute('aria-current'),
    'page',
    'Search must return to its originating scope',
  );

  await device.getByRole('button', { name: 'Circles', exact: true }).click();
  toolbarHeights.push(
    await device.locator('.mp-social-context').evaluate((element) => element.getBoundingClientRect().height),
  );
  await capture('social-circles-context');
  assert.equal(await device.locator('[data-social-post]').count(), 1);
  assert(await device.getByText('Design peers', { exact: true }).isVisible());
  await device.getByRole('button', { name: 'Manage', exact: true }).click();
  assert.equal(await device.locator('[data-prototype-page="social-circle-manage"]').count(), 1);
  assert.equal(await device.locator('[data-circle-row]').count(), 2);

  await device.getByRole('button', { name: 'Create circle', exact: true }).click();
  await device.getByLabel('Circle name', { exact: true }).fill('Release review');
  await device.getByLabel('Circle description', { exact: true }).fill('Private release decisions');
  await device.getByRole('button', { name: 'Create', exact: true }).click();
  const circleDetail = device.locator('[data-prototype-page="social-circle-detail"]');
  assert.equal(await circleDetail.count(), 1);
  const createdCircleId = await circleDetail.getAttribute('data-circle-id');
  assert(createdCircleId);

  await device.getByRole('button', { name: 'Add people', exact: true }).click();
  await device.getByRole('button', { name: 'Add Bob Zhang', exact: true }).click();
  assert(await circleDetail.getByText('Bob Zhang', { exact: true }).isVisible());
  await device.getByRole('button', { name: 'Remove Bob Zhang', exact: true }).click();
  assert.equal(await device.getByRole('button', { name: 'Remove Bob Zhang', exact: true }).count(), 0);
  await device.getByRole('button', { name: 'Add Carol Li', exact: true }).click();
  assert(await device.getByRole('button', { name: 'Remove Carol Li', exact: true }).isVisible());
  await capture('social-circle-detail');

  await device.getByRole('button', { name: 'Back', exact: true }).click();
  assert(await device.locator(`[data-circle-row="${createdCircleId}"]`).isVisible());
  await device.getByRole('button', { name: 'Back', exact: true }).click();
  assert.equal(
    await device.getByRole('button', { name: 'Circles', exact: true }).getAttribute('aria-current'),
    'page',
  );

  await device.getByRole('button', { name: 'New post', exact: true }).click();
  const composer = device.getByRole('dialog', { name: 'New post', exact: true });
  await composer.getByPlaceholder("What's on your mind?", { exact: true })
    .fill('Release review notes are ready.');
  await composer.getByRole('button', { name: 'Circles', exact: true }).click();
  assert(await composer.getByRole('button', { name: 'Post', exact: true }).isDisabled(),
    'Circle publishing must require one concrete target');
  const circleOption = composer.locator(`[data-circle-option="${createdCircleId}"]`);
  assert(await circleOption.isVisible());
  await circleOption.click();
  assert(await composer.getByRole('button', { name: 'Post', exact: true }).isEnabled());
  await composer.getByRole('button', { name: 'Post', exact: true }).click();
  const newPost = device.locator('[data-social-post]').filter({
    hasText: 'Release review notes are ready.',
  });
  assert.equal(await newPost.count(), 1);
  assert.equal(
    (await newPost.locator('.mp-moment-audience').innerText()).trim(),
    'Release review',
    'Circle post must retain its concrete audience',
  );
  await capture('social-circle-post');

  await device.getByRole('button', { name: 'Manage', exact: true }).click();
  await device.locator(`[data-circle-row="${createdCircleId}"]`).click();
  await device.getByRole('button', { name: 'Delete circle', exact: true }).click();
  const confirmation = device.getByRole('dialog', { name: 'Delete Release review?', exact: true });
  assert(await confirmation.isVisible());
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal(await device.locator(`[data-circle-row="${createdCircleId}"]`).count(), 0);
  await device.getByRole('button', { name: 'Back', exact: true }).click();

  assert(
    Math.max(...toolbarHeights) - Math.min(...toolbarHeights) <= 1,
    `Public and Circles toolbars must share one height: ${JSON.stringify(toolbarHeights)}`,
  );
  assert(await device.getByRole('button', { name: 'Manage', exact: true }).isVisible());
  assert.equal(await device.getByRole('button', { name: 'Dismiss scope tip', exact: true }).count(), 0);
  await device.getByRole('button', { name: 'Home', exact: true }).click();
  const socialPage = device.locator('[data-prototype-page="social"]');
  await socialPage.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);
  const backToTop = device.getByRole('button', { name: 'Back to top', exact: true });
  assert(await backToTop.isVisible());
  const savedScrollTop = await socialPage.evaluate((element) => element.scrollTop);
  await device.locator('[data-tab-id="chat"]').click();
  await device.locator('[data-tab-id="moments"]').click();
  assert(
    Math.abs(await socialPage.evaluate((element) => element.scrollTop) - savedScrollTop) <= 2,
    'Moments scroll position must survive selected-only tab remounts',
  );
  assert(await backToTop.isVisible());
  await capture('social-scroll-top-visible');
  await backToTop.click();
  await page.waitForFunction(
    (element) => element.scrollTop <= 1,
    await socialPage.elementHandle(),
  );
  assert(
    await socialPage.evaluate((element) => element.scrollTop) <= 1,
    'Back to top must restore the list origin',
  );
  assert.equal(await backToTop.count(), 0);
  await device.getByRole('button', { name: 'Public', exact: true }).click();
  assert(await device.locator('.mp-social-sort').isVisible());
  const refreshRevision = Number(await socialPage.getAttribute('data-social-refresh-revision'));

  await socialPage.dispatchEvent('pointerdown', {
    bubbles: true,
    clientY: 100,
    pointerId: 3,
    pointerType: 'touch',
  });
  await socialPage.dispatchEvent('pointermove', {
    bubbles: true,
    clientY: 185,
    pointerId: 3,
    pointerType: 'touch',
  });
  assert.equal(
    await device.locator('[data-social-refresh-state="ready"]').count(),
    1,
    'Pulling past the threshold must arm refresh',
  );
  await socialPage.dispatchEvent('pointermove', {
    bubbles: true,
    clientY: 90,
    pointerId: 3,
    pointerType: 'touch',
  });
  assert.equal(
    await device.locator('[data-social-refresh-state="idle"]').count(),
    1,
    'Reversing above the pull origin must disarm refresh',
  );
  assert(await device.locator('.mp-social-sort').isVisible());
  await socialPage.dispatchEvent('pointerup', {
    bubbles: true,
    clientY: 90,
    pointerId: 3,
    pointerType: 'touch',
  });
  assert.equal(
    Number(await socialPage.getAttribute('data-social-refresh-revision')),
    refreshRevision,
    'A disarmed pull must not refresh the projection',
  );

  await socialPage.dispatchEvent('pointerdown', {
    bubbles: true,
    clientY: 100,
    pointerId: 4,
    pointerType: 'touch',
  });
  await socialPage.dispatchEvent('pointermove', {
    bubbles: true,
    clientY: 185,
    pointerId: 4,
    pointerType: 'touch',
  });
  assert.equal(await device.locator('.mp-social-sort').count(), 0);
  assert(
    Math.abs(
      await device.locator('.mp-social-context').evaluate(
        (element) => element.getBoundingClientRect().height,
      )
      - toolbarHeights[0]
    ) <= 1,
    'Refresh feedback must replace Public controls without adding another row',
  );
  await capture('social-pull-refresh-ready');
  await socialPage.dispatchEvent('pointerup', {
    bubbles: true,
    clientY: 185,
    pointerId: 4,
    pointerType: 'touch',
  });
  await page.waitForTimeout(400);
  assert(
    Number(await socialPage.getAttribute('data-social-last-refreshed-at')) > 0,
    'Pull refresh must publish a completed refresh result',
  );
  assert.equal(
    Number(await socialPage.getAttribute('data-social-refresh-revision')),
    refreshRevision + 1,
    'Pull refresh must ask the Shell-owned projection for a new snapshot',
  );
  await page.waitForTimeout(500);
  assert.equal(await device.locator('[data-social-refresh-state="idle"]').count(), 1);
  assert(await device.locator('.mp-social-sort').isVisible());
  await device.getByRole('button', { name: 'Home', exact: true }).click();
  assert.equal(page.url(), initialUrl, 'Social workflows must remain in the prototype route');
  return {
    scopes: true,
    searchPeople: true,
    searchPosts: true,
    searchBack: true,
    reactionChipToggle: true,
    reactionMultiSelect: true,
    reactionDetailMultiSelect: true,
    statePersistsAcrossTabs: true,
    homeHasNoRedundantTip: true,
    publicHasOnlyFunctionalToolbar: true,
    socialToolbarEqualHeight: true,
    pullToRefresh: true,
    pullCancellation: true,
    floatingBackToTop: true,
    circleCreate: true,
    circleMembers: true,
    circleAudiencePost: true,
    circleDelete: true,
  };
}
