import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const catalogPath = fileURLToPath(
  new URL('../src/settingsCapabilities.json', import.meta.url),
);

async function loadCatalog() {
  return JSON.parse(await readFile(catalogPath, 'utf8'));
}

async function chooseOption(page, control, optionName) {
  await control.click();
  const option = page.locator('.ant-select-dropdown:visible').last()
    .getByRole('option', { name: optionName, exact: true });
  await option.dispatchEvent('mousedown');
  await option.dispatchEvent('mouseup');
  await option.dispatchEvent('click');
}

export async function verifySettingsCapabilities({
  page,
  device,
  goToSettings,
  openSetting,
  backFromSetting,
  inspectSurface,
  record,
  capture,
  onePixelPng,
  coverPng,
}) {
  const catalog = await loadCatalog();
  const expectedGroups = catalog.groups.map((group) => group.label);
  const expectedSections = catalog.groups.flatMap((group) => group.sections);
  const seen = new Set();

  async function collect(detail) {
    const capabilities = await detail.locator('[data-capability-id]').evaluateAll(
      (elements) => elements.map((element) => ({
        id: element.getAttribute('data-capability-id'),
        disposition: element.getAttribute('data-capability-disposition'),
      })),
    );
    for (const capability of capabilities) {
      if (capability.id) seen.add(capability.id);
    }
  }

  async function finishSection(detail, sectionId) {
    await collect(detail);
    await inspectSurface(`settings-${sectionId}`);
    const expected = expectedSections.find((section) => section.id === sectionId)?.capabilities ?? [];
    const missing = expected.filter((capability) => !seen.has(capability));
    assert.deepEqual(missing, [], `${sectionId}: unvisited capabilities`);
    await backFromSetting(detail);
  }

  const groupLabels = await device.locator('.mp-settings-group-title').allTextContents();
  assert.deepEqual(groupLabels, expectedGroups);
  const rowIds = await device.locator('[data-setting-id]').evaluateAll(
    (elements) => elements.map((element) => element.getAttribute('data-setting-id')),
  );
  assert.deepEqual(rowIds, expectedSections.map((section) => section.id));
  await inspectSurface('settings-home');

  let detail = await openSetting('account');
  await collect(detail);
  await record('account background draft and rollback', async () => {
    const chooser = page.waitForEvent('filechooser');
    await detail.getByRole('button', { name: 'Change profile background', exact: true }).click();
    await (await chooser).setFiles(coverPng);
    assert.equal(await detail.locator('[data-account-mode="edit"]').count(), 1);
    await detail.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(
      (await detail.locator('.mp-account-cover').getAttribute('style'))?.includes('data:image/png') ?? false,
      false,
    );
  });
  await record('account avatar and profile save persist', async () => {
    const chooser = page.waitForEvent('filechooser');
    await detail.getByRole('button', { name: /profile photo$/ }).click();
    await (await chooser).setFiles(onePixelPng);
    await detail.getByLabel('Display name', { exact: true }).fill('Alice Mobile');
    await detail.getByLabel('Bio', { exact: true }).fill('Mobile profile saved.');
    await detail.getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal(await detail.locator('.mp-account-name').innerText(), 'Alice Mobile');
  });
  await record('account identity copy and unblock', async () => {
    await detail.getByRole('button', { name: 'Copy PTID', exact: true }).click();
    await detail.getByRole('button', { name: /^(Copied|Copy unavailable)$/ }).waitFor();
    await detail.getByRole('button', { name: 'Unblock', exact: true }).first().click();
    assert.equal(await detail.getByRole('button', { name: 'Unblock', exact: true }).count(), 1);
  });
  await capture('account-aligned');
  await finishSection(detail, 'account');

  detail = await openSetting('security');
  await collect(detail);
  await record('security PIN change and removal', async () => {
    await detail.getByRole('button', { name: 'Change PIN', exact: true }).click();
    const pin = detail.getByLabel('New PIN', { exact: true });
    await pin.fill('24ab');
    assert.equal(await pin.inputValue(), '24');
    await pin.fill('2468');
    await detail.getByRole('button', { name: 'Save PIN', exact: true }).click();
    assert(await detail.getByText('PIN updated on this device.', { exact: true }).isVisible());
    await detail.getByRole('button', { name: 'Remove PIN', exact: true }).click();
    assert(await detail.getByText('PIN removed from this device.', { exact: true }).isVisible());
  });
  await record('security recovery generation copy backup and restore', async () => {
    await detail.getByRole('button', { name: 'Generate recovery phrase', exact: true }).click();
    await collect(detail);
    await detail.getByRole('button', { name: 'Copy phrase', exact: true }).click();
    const download = page.waitForEvent('download');
    await detail.getByRole('button', { name: 'Create backup', exact: true }).click();
    assert.equal((await download).suggestedFilename(), 'peers-touch-recovery-backup.json');
    await detail.getByRole('button', { name: 'Restore from phrase', exact: true }).click();
    const input = detail.getByLabel('Recovery phrase', { exact: true });
    await input.fill('too short');
    await detail.getByRole('button', { name: 'Verify phrase', exact: true }).click();
    assert(await detail.getByText('Enter all 12 recovery words.', { exact: true }).isVisible());
    await input.fill('anchor bright cedar drift ember field glass harbor island juniper kernel lantern');
    await detail.getByRole('button', { name: 'Verify phrase', exact: true }).click();
    assert(await detail.getByText('Recovery phrase verified.', { exact: true }).isVisible());
  });
  await record('authorized-device removal is confirmed', async () => {
    await detail.getByRole('button', { name: 'Remove', exact: true }).click();
    const dialog = detail.getByRole('dialog', { name: 'Remove MacBook Pro?', exact: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await detail.getByRole('button', { name: 'Remove', exact: true }).click();
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    assert.equal(await detail.getByText('MacBook Pro', { exact: true }).count(), 0);
  });
  await finishSection(detail, 'security');

  detail = await openSetting('general');
  await collect(detail);
  await record('general language theme notification and audience controls persist', async () => {
    await chooseOption(page, detail.getByLabel('Display language', { exact: true }), '简体中文');
    await chooseOption(page, detail.getByLabel('Display language', { exact: true }), 'English');
    await detail.getByRole('button', { name: 'Dark', exact: true }).click();
    assert.equal(await page.locator('.mobile-prototype-scope').getAttribute('data-theme'), 'dark');
    await detail.getByRole('button', { name: 'Light', exact: true }).click();
    const notification = detail.getByRole('button', { name: 'Mentions & replies', exact: true });
    const before = await notification.getAttribute('aria-pressed');
    await notification.click();
    assert.notEqual(await notification.getAttribute('aria-pressed'), before);
    await chooseOption(page, detail.getByLabel('Default audience', { exact: true }), 'Public');
  });
  await record('general Agent defaults update', async () => {
    await chooseOption(page, detail.getByLabel('Default provider', { exact: true }), 'OpenAI');
    await chooseOption(page, detail.getByLabel('Default model', { exact: true }), 'GPT-5');
    await chooseOption(page, detail.getByLabel('Reasoning effort', { exact: true }), 'High');
  });
  assert(await detail.getByText(catalog.degraded['general.chat.shortcut'], { exact: true }).isVisible());
  await finishSection(detail, 'general');
  await record('general default audience reaches New Post composer', async () => {
    await device.getByRole('button', { name: 'Moments', exact: true }).click();
    await device.getByRole('button', { name: 'New post', exact: true }).click();
    assert.equal(
      await device.getByRole('dialog', { name: 'New post', exact: true })
        .getByRole('button', { name: 'Public', exact: true }).getAttribute('aria-pressed'),
      'true',
    );
    await page.keyboard.press('Escape');
    await device.getByRole('button', { name: 'Me', exact: true }).click();
  });

  detail = await openSetting('federation');
  await collect(detail);
  await record('federation identity visibility and discovery controls', async () => {
    await detail.getByRole('button', { name: 'Copy handle', exact: true }).click();
    await detail.getByRole('button', { name: /^(Copied|Unavailable)$/ }).waitFor();
    await chooseOption(page, detail.getByLabel('Federation visibility', { exact: true }), 'By handle only');
    const discoverable = detail.getByRole('button', { name: 'Discoverable', exact: true });
    await discoverable.click();
    await chooseOption(page, detail.getByLabel('Accept requests from', { exact: true }), 'Nobody');
  });
  await record('federation join validation and membership confirmation', async () => {
    await detail.getByRole('button', { name: 'Join', exact: true }).click();
    const endpoint = detail.getByLabel('Federation endpoint', { exact: true });
    await endpoint.fill('invalid');
    await detail.getByRole('button', { name: 'Join federation', exact: true }).click();
    assert(await detail.getByText('Enter a valid federation endpoint.', { exact: true }).isVisible());
    await endpoint.fill('https://new.peers.social');
    await detail.getByRole('button', { name: 'Join federation', exact: true }).click();
    assert(await detail.getByText('new.peers.social', { exact: true }).first().isVisible());
    await detail.getByRole('button', { name: 'Leave Lab Federation', exact: true }).click();
    const leave = detail.getByRole('dialog', { name: 'Leave Lab Federation?', exact: true });
    await leave.getByRole('button', { name: 'Cancel', exact: true }).click();
    await detail.getByRole('button', { name: 'Delete Peers Social Network', exact: true }).click();
    const remove = detail.getByRole('dialog', { name: 'Delete Peers Social Network?', exact: true });
    await remove.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  await record('Station switching requires confirmation', async () => {
    await detail.getByRole('button', { name: 'Switch Station', exact: true }).click();
    await detail.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  await finishSection(detail, 'federation');

  detail = await openSetting('providers');
  await collect(detail);
  await record('provider selected editor controls readiness and models', async () => {
    await detail.getByLabel('Search providers', { exact: true }).fill('OpenAI');
    await detail.getByRole('button', { name: /OpenAI/ }).click();
    await detail.getByLabel('Search providers', { exact: true }).fill('');
    const enabled = detail.getByRole('button', { name: 'Enable OpenAI', exact: true });
    await enabled.click();
    await enabled.click();
    await detail.getByLabel('Provider API endpoint', { exact: true }).fill('https://api.openai.com/v1');
    await detail.getByLabel('Provider API key', { exact: true }).fill('prototype-key');
    await detail.getByRole('button', { name: 'Test connection', exact: true }).click();
    assert(await detail.getByText('Connection verified.', { exact: true }).isVisible());
    await detail.getByRole('button', { name: 'Refresh models', exact: true }).click();
    assert(await detail.getByText('OpenAI Latest', { exact: true }).isVisible());
  });
  await record('provider creation validates mobile cloud endpoint', async () => {
    await detail.getByRole('button', { name: 'Add', exact: true }).click();
    await detail.getByLabel('Provider name', { exact: true }).fill('Custom Cloud');
    await detail.getByLabel('Provider endpoint', { exact: true }).fill('https://models.example.com/v1');
    await detail.getByRole('button', { name: 'Add provider', exact: true }).click();
    assert(await detail.getByText('Custom Cloud', { exact: true }).first().isVisible());
  });
  assert(await detail.getByText(catalog.degraded['providers.local-runtime'], { exact: true }).isVisible());
  await finishSection(detail, 'providers');

  detail = await openSetting('models');
  await collect(detail);
  for (const [label, target] of [
    ['Default conversations', 'GPT-5 · OpenAI'],
    ['Topic naming', 'Claude Sonnet · Anthropic'],
    ['Translation', 'GPT-5 · OpenAI'],
    ['History compression', 'Claude Sonnet · Anthropic'],
    ['Scheduled tasks', 'GPT-5 · OpenAI'],
    ['Agent router', 'Claude Sonnet · Anthropic'],
  ]) {
    await record(`model route: ${label}`, async () => {
      const control = detail.getByLabel(label, { exact: true });
      await chooseOption(page, control, target);
    });
  }
  await finishSection(detail, 'models');

  detail = await openSetting('memory');
  await collect(detail);
  await record('memory configuration save reset and review', async () => {
    await detail.getByRole('button', { name: 'Enable memory', exact: true }).click();
    await chooseOption(page, detail.getByLabel('Embedding model', { exact: true }), 'Keyword search only');
    await detail.getByRole('button', { name: 'Automatic memory tuning', exact: true }).click();
    await detail.getByLabel('Vector weight', { exact: true }).fill('0.5');
    await detail.getByLabel('Keyword weight', { exact: true }).fill('0.5');
    await detail.getByRole('button', { name: 'Review 3', exact: true }).click();
    await collect(detail);
    await detail.getByRole('button', { name: 'Remove Prefers concise answers', exact: true }).click();
    await detail.getByRole('button', { name: 'Save', exact: true }).click();
    assert(await detail.getByText('Memory settings saved.', { exact: true }).isVisible());
    await detail.getByRole('button', { name: 'Reset', exact: true }).click();
    assert(await detail.getByText('Defaults restored.', { exact: true }).isVisible());
  });
  assert(await detail.getByText(catalog.degraded['memory.storage.postgres'], { exact: true }).isVisible());
  await finishSection(detail, 'memory');

  detail = await openSetting('skills');
  await collect(detail);
  await record('skills search filter toggle and detail', async () => {
    await detail.getByLabel('Search skills', { exact: true }).fill('Code');
    const toggle = detail.getByRole('button', { name: 'Enable Code Review', exact: true });
    await toggle.click();
    await detail.locator('[data-capability-action="skills.detail"]').filter({ hasText: 'Code Review' }).click();
    await detail.getByRole('region', { name: 'Code Review details', exact: true })
      .getByRole('button', { name: 'Close', exact: true }).click();
    await detail.getByLabel('Search skills', { exact: true }).fill('');
    await detail.getByRole('tab', { name: 'Built-in', exact: true }).click();
    await detail.getByRole('tab', { name: 'Market', exact: true }).click();
    await detail.getByRole('tab', { name: 'Installed', exact: true }).click();
  });
  await record('skills create URL upload and market actions', async () => {
    await detail.getByRole('button', { name: 'Create', exact: true }).click();
    await detail.getByLabel('Skill name', { exact: true }).fill('Mobile Notes');
    await detail.getByRole('button', { name: 'Create skill', exact: true }).click();
    assert(await detail.getByText('Mobile Notes', { exact: true }).isVisible());
    await detail.getByRole('button', { name: 'From URL', exact: true }).click();
    await detail.getByLabel('Skill source URL', { exact: true }).fill('https://github.com/peers/calendar-skill');
    await detail.getByRole('button', { name: 'Import skill', exact: true }).click();
    assert(await detail.getByText('calendar-skill', { exact: true }).isVisible());
    const chooser = page.waitForEvent('filechooser');
    await detail.getByRole('button', { name: 'Upload ZIP', exact: true }).click();
    await (await chooser).setFiles({ name: 'uploaded-skill.zip', mimeType: 'application/zip', buffer: Buffer.from('zip') });
    assert(await detail.getByText('uploaded-skill', { exact: true }).isVisible());
    await detail.getByRole('button', { name: 'Install featured', exact: true }).click();
  });
  assert(await detail.getByText(catalog.degraded['skills.local-directory'], { exact: true }).isVisible());
  await finishSection(detail, 'skills');

  detail = await openSetting('mcp');
  await collect(detail);
  await record('MCP remote server operations and edit', async () => {
    const toggle = detail.getByRole('button', { name: 'Enable GitHub', exact: true });
    await toggle.click();
    await toggle.click();
    await detail.getByRole('button', { name: 'Manage GitHub', exact: true }).click();
    await collect(detail);
    await detail.getByRole('button', { name: 'Test', exact: true }).click();
    await detail.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await detail.getByLabel('Edit MCP endpoint', { exact: true }).fill('https://mcp.github.example/v2');
    await detail.getByRole('button', { name: 'Done', exact: true }).click();
  });
  await record('MCP add import and confirmed delete', async () => {
    await detail.getByRole('button', { name: 'Add', exact: true }).click();
    await detail.getByLabel('MCP server name', { exact: true }).fill('Docs');
    await detail.getByLabel('MCP server endpoint', { exact: true }).fill('https://mcp.docs.example');
    await detail.getByRole('button', { name: 'Add server', exact: true }).click();
    assert(await detail.getByText('Docs', { exact: true }).isVisible());
    await detail.getByRole('button', { name: 'Import', exact: true }).click();
    await detail.getByLabel('MCP configuration JSON', { exact: true })
      .fill('{"name":"Issues","url":"https://mcp.issues.example"}');
    await detail.getByRole('button', { name: 'Import', exact: true }).last().click();
    assert(await detail.getByText('Issues', { exact: true }).isVisible());
    await detail.getByRole('button', { name: 'Manage Docs', exact: true }).click();
    await detail.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = detail.getByRole('dialog', { name: 'Delete Docs?', exact: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  assert(await detail.getByText(catalog.degraded['mcp.server.local-stdio'], { exact: true }).isVisible());
  await finishSection(detail, 'mcp');

  detail = await openSetting('tts');
  await collect(detail);
  await record('voice output and speech input controls', async () => {
    await chooseOption(page, detail.getByLabel('Text to speech provider', { exact: true }), 'Station voice');
    await chooseOption(page, detail.getByLabel('Voice', { exact: true }), 'Coral');
    await detail.getByLabel('Speech speed', { exact: true }).fill('1.4');
    await detail.getByRole('button', { name: 'Automatically read responses', exact: true }).click();
    await detail.getByRole('button', { name: 'Play preview', exact: true }).click();
    assert(await detail.getByText('Preview played with Coral.', { exact: true }).isVisible());
    await chooseOption(page, detail.getByLabel('Speech input provider', { exact: true }), 'OpenAI Whisper');
    await chooseOption(page, detail.getByLabel('Speech input language', { exact: true }), 'English');
    await detail.getByRole('button', { name: 'Stop after silence', exact: true }).click();
  });
  await finishSection(detail, 'tts');

  detail = await openSetting('cron');
  await collect(detail);
  await record('Cron search create run history pause edit delete', async () => {
    await detail.getByLabel('Search scheduled tasks', { exact: true }).fill('Daily');
    await detail.getByLabel('Search scheduled tasks', { exact: true }).fill('');
    await detail.getByRole('button', { name: 'New', exact: true }).click();
    await detail.getByLabel('Task name', { exact: true }).fill('Monthly archive');
    await detail.getByLabel('Task schedule', { exact: true }).fill('First day · 18:00');
    await detail.getByRole('button', { name: 'Save task', exact: true }).click();
    await detail.getByRole('button', { name: 'Run Monthly archive', exact: true }).click();
    assert(await detail.getByText('Monthly archive completed.', { exact: true }).isVisible());
    await detail.getByRole('button', { name: 'History for Monthly archive', exact: true }).click();
    await detail.getByRole('region', { name: 'Task run history', exact: true })
      .getByRole('button', { name: 'Close', exact: true }).click();
    await detail.getByRole('button', { name: 'Pause Monthly archive', exact: true }).click();
    await detail.getByRole('button', { name: 'Edit Monthly archive', exact: true }).click();
    await detail.getByLabel('Task schedule', { exact: true }).fill('First day · 19:00');
    await detail.getByRole('button', { name: 'Save task', exact: true }).click();
    await detail.getByRole('button', { name: 'Delete Monthly archive', exact: true }).click();
    const dialog = detail.getByRole('dialog', { name: 'Delete Monthly archive?', exact: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  await finishSection(detail, 'cron');

  detail = await openSetting('command-menu');
  await collect(detail);
  await record('command palette search and route command', async () => {
    await detail.getByRole('button', { name: 'Open Command Palette', exact: true }).click();
    await collect(detail);
    const palette = detail.getByRole('dialog', { name: 'Command Palette', exact: true });
    await palette.getByLabel('Search commands', { exact: true }).fill('Chats');
    assert.equal(await palette.getByRole('button', { name: 'Open Chats', exact: true }).count(), 1);
    await palette.getByRole('button', { name: 'Open Chats', exact: true }).click();
    assert.equal(await device.locator('[data-prototype-page="chats"]').count(), 1);
  });
  await goToSettings();
  detail = await openSetting('command-menu');
  await finishSection(detail, 'command-menu');

  detail = await openSetting('tools');
  await collect(detail);
  await record('tools provider selection and catalog detail', async () => {
    await detail.getByRole('button', { name: /Tavily/ }).click();
    await detail.getByRole('button', { name: 'Details', exact: true }).first().click();
    assert(await detail.getByText(/is supplied by the active Agent runtime/).isVisible());
  });
  assert(await detail.getByText(catalog.degraded['tools.local-filesystem'], { exact: true }).isVisible());
  assert(await detail.getByText(catalog.degraded['tools.local-shell'], { exact: true }).isVisible());
  await finishSection(detail, 'tools');

  detail = await openSetting('channels');
  await collect(detail);
  await record('channels refresh toggle test edit send events statistics', async () => {
    await detail.getByRole('button', { name: 'Refresh channels', exact: true }).click();
    const toggle = detail.getByRole('button', { name: 'Enable Email', exact: true });
    await toggle.click();
    await toggle.click();
    await detail.getByRole('button', { name: 'Test Email', exact: true }).click();
    await detail.getByRole('button', { name: 'Edit Email', exact: true }).click();
    await detail.getByLabel('Channel endpoint', { exact: true }).fill('alice+mobile@peers.social');
    await detail.getByRole('button', { name: 'Save channel', exact: true }).click();
    await detail.getByRole('button', { name: 'Send test', exact: true }).first().click();
    await detail.getByRole('button', { name: 'Events', exact: true }).first().click();
    await detail.getByRole('button', { name: 'Statistics', exact: true }).first().click();
  });
  await record('channels create and confirmed delete', async () => {
    await detail.getByRole('button', { name: 'Add', exact: true }).click();
    await detail.getByLabel('Channel name', { exact: true }).fill('Build Hook');
    await chooseOption(page, detail.getByLabel('Channel type', { exact: true }), 'Webhook');
    await detail.getByLabel('Channel endpoint', { exact: true }).fill('https://hooks.example.com/build');
    await detail.getByRole('button', { name: 'Save channel', exact: true }).click();
    assert(await detail.getByText('Build Hook', { exact: true }).isVisible());
    await detail.getByRole('button', { name: 'Delete Build Hook', exact: true }).click();
    const dialog = detail.getByRole('dialog', { name: 'Delete Build Hook?', exact: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  await finishSection(detail, 'channels');

  detail = await openSetting('applets');
  await collect(detail);
  await record('applets toggle and selected-only settings', async () => {
    const toggle = detail.getByRole('button', { name: 'Enable Notes', exact: true });
    await toggle.click();
    await toggle.click();
    await detail.getByRole('button', { name: 'Settings for Notes', exact: true }).click();
    assert(await detail.getByText('Notes settings', { exact: true }).isVisible());
    await detail.getByRole('button', { name: 'Back to applets', exact: true }).click();
  });
  await finishSection(detail, 'applets');

  detail = await openSetting('storage');
  await collect(detail);
  await record('storage measurement retention cache confirmation and result', async () => {
    await detail.getByRole('button', { name: 'Refresh storage measurement', exact: true }).click();
    assert(await detail.getByText('Measurement failed. Existing totals are retained.', { exact: true }).isVisible());
    await detail.getByRole('button', { name: 'Retry', exact: true }).click();
    assert(await detail.getByText('Current', { exact: true }).isVisible());
    await chooseOption(page, detail.getByLabel('Storage retention', { exact: true }), '90 days');
    await detail.getByRole('button', { name: 'Clear cache · 204 MB', exact: true }).click();
    await collect(detail);
    await detail.getByRole('button', { name: 'Cancel', exact: true }).click();
    await detail.getByRole('button', { name: 'Clear cache · 204 MB', exact: true }).click();
    await detail.getByRole('button', { name: 'Clear cache', exact: true }).click();
    assert(await detail.getByText('204 MB released.', { exact: true }).isVisible());
  });
  await record('storage search sort batch partial failure and retry', async () => {
    await detail.getByLabel('Search conversations', { exact: true }).fill('Release');
    await detail.getByLabel('Search conversations', { exact: true }).fill('');
    await detail.getByRole('button', { name: 'Recent', exact: true }).click();
    await detail.getByRole('button', { name: 'Manage', exact: true }).click();
    await collect(detail);
    await detail.getByLabel('Select Release Room', { exact: true }).check();
    await detail.getByLabel('Select Alice Chen', { exact: true }).check();
    await detail.getByRole('button', { name: 'Clear selected', exact: true }).click();
    await collect(detail);
    await detail.getByRole('button', { name: 'Clear conversations', exact: true }).click();
    await detail.locator('[data-batch-status="partial"]').waitFor();
    await collect(detail);
    await detail.getByRole('button', { name: 'Retry failed', exact: true }).click();
    await detail.getByRole('button', { name: 'Clear conversations', exact: true }).click();
    await detail.locator('[data-batch-status="success"]').waitFor();
  });
  await capture('storage-aligned');
  await finishSection(detail, 'storage');

  detail = await openSetting('oss');
  await collect(detail);
  await record('files refresh filter visibility download delete restore upload', async () => {
    await detail.locator('[data-capability-action="files.refresh"]').click();
    await detail.getByLabel('Filter files', { exact: true }).fill('missing-file');
    assert(await detail.getByText('No matching files', { exact: true }).isVisible());
    await detail.getByLabel('Filter files', { exact: true }).fill('');
    await detail.getByRole('button', { name: 'Include deleted files', exact: true }).click();
    await collect(detail);
    await detail.getByRole('button', { name: 'Restore', exact: true }).click();
    await detail.getByRole('button', { name: 'private', exact: true }).click();
    await chooseOption(page, detail.getByLabel('File visibility', { exact: true }), 'Conversation');
    const download = page.waitForEvent('download');
    await detail.getByRole('button', { name: 'Download roadmap.pdf', exact: true }).click();
    assert.equal((await download).suggestedFilename(), 'roadmap.pdf');
    await detail.getByRole('button', { name: 'Delete roadmap.pdf', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await detail.getByRole('button', { name: 'Upload', exact: true }).click();
    await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') });
    assert(await detail.getByText('notes.txt', { exact: true }).isVisible());
  });
  await finishSection(detail, 'oss');

  detail = await openSetting('logs');
  await collect(detail);
  await record('logs filter levels pause refresh export clear and follow', async () => {
    await detail.getByLabel('Filter logs', { exact: true }).fill('station');
    await detail.getByLabel('Filter logs', { exact: true }).fill('');
    await detail.getByRole('checkbox', { name: 'debug', exact: true }).uncheck();
    await detail.getByRole('button', { name: 'Pause logs', exact: true }).click();
    await detail.getByRole('button', { name: 'Resume logs', exact: true }).click();
    await detail.getByRole('button', { name: 'Refresh logs', exact: true }).click();
    const download = page.waitForEvent('download');
    await detail.getByRole('button', { name: 'Export visible logs', exact: true }).click();
    assert.equal((await download).suggestedFilename(), 'peers-touch-visible-logs.txt');
    await detail.getByRole('button', { name: 'Follow new log entries', exact: true }).click();
    await detail.getByRole('button', { name: 'Clear visible logs', exact: true }).click();
    assert(await detail.getByText('No visible logs', { exact: true }).isVisible());
  });
  await finishSection(detail, 'logs');

  detail = await openSetting('help');
  await collect(detail);
  for (const label of ['Release notes', 'Open-source licenses', 'Support']) {
    await record(`help action: ${label}`, async () => {
      await detail.getByRole('button', { name: label, exact: true }).click();
      const panel = detail.getByRole('region', {
        name: `${label === 'Release notes' ? 'release' : label === 'Open-source licenses' ? 'licenses' : 'support'} details`,
        exact: true,
      });
      assert(await panel.isVisible());
      await panel.getByRole('button', { name: 'Close', exact: true }).click();
    });
  }
  await record('help reset onboarding requires confirmation', async () => {
    await detail.getByRole('button', { name: 'Reset onboarding', exact: true }).click();
    await detail.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  await finishSection(detail, 'help');

  const expectedCapabilities = expectedSections.flatMap((section) => section.capabilities);
  assert.deepEqual(
    expectedCapabilities.filter((capability) => !seen.has(capability)),
    [],
    'every catalog capability must be rendered and exercised',
  );
  return {
    groups: expectedGroups,
    sections: expectedSections.map((section) => section.id),
    capabilities: [...seen].sort(),
  };
}
