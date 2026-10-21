#!/usr/bin/env node
// Browser proof for the approved Peers Agent Chat scope and reference interaction benchmark.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../../../../..');
function loadPlaywright() {
  try { return require('playwright'); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    const store = path.join(repo, 'node_modules/.pnpm');
    const installed = fs.readdirSync(store).find((name) => name.startsWith('playwright@'));
    if (!installed) throw new Error('Install Playwright to run Agent browser checks.');
    return require(path.join(store, installed, 'node_modules/playwright'));
  }
}

const { chromium } = loadPlaywright();
const evidence = process.env.AGENT_CHAT_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(), 'pt-agent-chat-scope-'));
fs.mkdirSync(evidence, { recursive: true });
const url = process.env.AGENT_CHAT_URL || 'http://127.0.0.1:4173/?state=agent-chat';
const sourcePaths = [
  'packages/prototypes/desktop/shell/src/AgentChatPage.tsx',
  'packages/prototypes/desktop/shell/src/AgentCommandPalette.tsx',
  'packages/prototypes/desktop/shell/src/TurnAttribution.tsx',
  'packages/prototypes/desktop/shell/src/Settings.tsx',
  'packages/prototypes/desktop/features/agent/src/panels/AgentProfile.tsx',
  'packages/prototypes/desktop/shared/PrototypeAgentAvatar.tsx',
  'packages/prototypes/desktop/shared/Toast.tsx',
  'packages/prototypes/desktop/shared/prototypeAgentModels.ts',
  'packages/prototypes/desktop/shell/qa/agent_chat_checks.cjs',
  'docs/architecture/engineering/prototypes/desktop-shell/agent-chat-coverage.md',
  'docs/architecture/engineering/prototypes/desktop-shell/README.md',
  'docs/client/common/ui-identity/modules/agent/README.md',
  'docs/client/common/ui-identity/frontend-component-tree.md',
  'docs/client/common/ui-identity/frontend-component-tree-registry.md',
];
const source = {
  worktree: fs.realpathSync(repo),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  files: Object.fromEntries(sourcePaths.map((file) => [
    file,
    fs.existsSync(path.join(repo, file))
      ? crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')
      : 'missing',
  ])),
};

const results = [];
const errors = [];
const operationCoverageByCheck = {
  'Agent roster keeps stable ownership and reference-style row actions': [
    'agent.roster.persistent',
    'agent.search',
    'agent.row.switches-to-chat',
    'agent.menu.anchored',
    'agent.menu.profile',
    'agent.menu.delete-only-when-allowed',
  ],
  'Profile edits one Agent and binds capabilities from bounded pickers': [
    'agent.create.instant-profile',
    'agent.delete.confirm',
    'profile.identity.autosave-surface',
    'profile.identity.save-toast',
    'profile.identity.no-inline-save-status',
    'profile.identity.alignment',
    'profile.avatar.emoji',
    'profile.avatar.upload-validation',
    'profile.avatar.upload-cancel',
    'profile.avatar.image',
    'profile.avatar.persisted-projection',
    'profile.model-ownership-absent',
    'profile.extensions.skill-bind',
    'profile.extensions.skill-toggle',
    'profile.extensions.skill-remove',
    'profile.extensions.mcp-bind',
    'profile.extensions.picker-unmount',
  ],
  'Topic rail owns new, switch, pin, title search, edit and delete': [
    'topic.agent-identity',
    'topic.actions.equal-icon-slots',
    'topic.search.replaces-action-row',
    'topic.search.cancel-restores-actions',
    'topic.identity.no-avatar',
    'topic.count.inline',
    'topic.new',
    'topic.first-send-title',
    'topic.pin',
    'topic.group-collapse',
    'topic.search-title-only',
    'topic.edit',
    'topic.delete-confirm',
    'topic.batch-select',
    'topic.batch-delete-confirm',
    'topic.batch-delete-cleanup',
    'topic.no-smart-rename',
    'topic.no-sort-filter',
  ],
  'Provider settings create Direct and CLI profiles without type tabs': [
    'settings.provider-list.mixed',
    'settings.provider-create.kind-choice',
    'settings.provider-create.direct',
    'settings.provider-create.cli',
    'settings.provider-schema.selected-only',
    'settings.provider-cli.no-api-fields',
    'settings.provider-cli.registered-adapter',
    'settings.provider-cli.fields',
    'settings.provider-cli.advanced',
    'settings.provider-cli.no-command-editor',
    'settings.provider-cli.check',
    'settings.provider-cli.restore',
    'settings.provider-cli.save-toast',
    'settings.feedback.bottom-right',
    'settings.providers.usable-only.default',
    'settings.providers.usable-only.persisted',
    'settings.provider.enabled-projection',
    'settings.model.enabled-projection',
    'settings.models.default-only',
  ],
  'Composer owns Topic model, slash commands, attachment and keyboard semantics': [
    'composer.enter-send',
    'composer.modified-enter-newline',
    'composer.settings-default-model',
    'composer.provider-model-tree',
    'composer.provider-model-search',
    'composer.topic-model-override',
    'composer.topic-model-restore',
    'composer.slash',
    'composer.command.help',
    'composer.command.tools',
    'composer.command.skills',
    'composer.command.clear-preserves-history',
    'composer.command.typing-slash-opens',
    'composer.command.stale-disables-capabilities',
    'composer.command.unavailable-disables-capabilities',
    'composer.command.text-chat-survives-stale',
    'composer.command.narrow-palette',
    'composer.attachment.choose',
    'composer.attachment.remove',
    'composer.attachment.readback',
  ],
  'Conversation preserves activity, copy, quick reply and basic artifacts': [
    'header.topic-title',
    'header.search.right-aligned',
    'header.search.content',
    'header.search.navigate',
    'header.search.close-focus',
    'header.no-fake-roster-search',
    'header.no-ai-quick-tools',
    'turn.activity',
    'turn.copy',
    'quick-reply.expand',
    'quick-reply.add-to-input',
    'quick-reply.reply-now',
    'quick-reply.preserve-draft',
    'artifact.open',
    'artifact.detail',
    'artifact.basic-scope-only',
    'header.no-export-share-link',
    'turn.no-developer-inspectors',
    'turn.attribution.compact-badges',
    'turn.attribution.detail-included',
    'turn.attribution.detail-omitted',
    'turn.attribution.detail-truncated',
    'turn.attribution.version-pinned',
    'turn.attribution.current-binding-does-not-rewrite-history',
  ],
  'Running turns keep the draft without exposing a queue': [
    'turn.single-active-owner',
    'turn.running-draft-preserved',
    'turn.no-queue-panel',
    'turn.stop-reachable',
    'approval.cancel',
  ],
  'Clarification and approval remain inline and continue the Agent': [
    'ask.option',
    'ask.other',
    'ask.submit',
    'ask.continue',
    'approval.safe-focus',
    'approval.run',
    'approval.system-receipt',
    'approval.continue',
  ],
  'Stop and typed recovery preserve honest failure semantics': [
    'turn.stop',
    'turn.stop.execution-cancelled',
    'turn.stop.topic-error',
    'error.typed-network',
    'error.draft-preserved',
    'error.retry',
  ],
  'Agent and Topic owners preserve isolated drafts': [
    'draft.agent-isolation',
    'draft.agent-restore',
    'topic.switch',
    'draft.topic-restore',
  ],
  'Wide, compact and mobile topology matches observed reference behavior': [
    'layout.wide-roster-topic-chat',
    'layout.compact-rails',
    'layout.mobile-chat',
    'layout.mobile-topic-list',
    'layout.mobile-left-drawer',
    'layout.mobile-no-bottom-sheet',
    'layout.mobile-menu-anchor',
    'layout.zero-horizontal-overflow',
    'motion.reduced',
  ],
};

function operationCoverage() {
  const missingChecks = Object.keys(operationCoverageByCheck).filter((name) => !results.includes(name));
  assert.deepEqual(missingChecks, []);
  const operations = Object.entries(operationCoverageByCheck).flatMap(([checkName, ids]) =>
    ids.map((operationId) => ({ operationId, checkName })));
  assert.equal(new Set(operations.map(({ operationId }) => operationId)).size, operations.length);
  return operations;
}

async function check(name, run) {
  await run();
  results.push(name);
  process.stdout.write(`PASS ${name}\n`);
}

function attachErrorCapture(page) {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    await context.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('agent-chat-agent-order', JSON.stringify(['second-agent']));
      localStorage.setItem('agent-chat-agent-second-agent', JSON.stringify({
        id: 'second-agent',
        name: 'Second Agent',
        description: 'Second Agent for draft isolation.',
        model: 'default',
        createdAt: Date.now(),
      }));
      localStorage.setItem('peers-prototype-default-chat-model', 'claude-haiku');
    });
    const page = await context.newPage();
    attachErrorCapture(page);
    await page.goto(url, { waitUntil: 'networkidle' });

    const root = page.getByTestId('desktop-shell-agent-chat');
    await root.waitFor();
    const roster = () => root.getByRole('complementary', { name: 'My Agents' });
    const topics = () => root.getByRole('complementary', { name: / topics$/ });
    const conversation = () => root.getByRole('region', { name: 'Agent conversation' });
    const profile = () => root.getByRole('region', { name: 'Agent profile' });
    const composer = () => root.getByRole('textbox', { name: /^Message / });
    const startNew = async () => {
      await topics().getByRole('button', { name: 'Start new topic', exact: true }).click();
      await composer().waitFor();
    };
    const send = async (text) => {
      await composer().fill(text);
      await composer().press('Enter');
      await root.locator('.pt-user-row').filter({ hasText: text }).waitFor();
    };
    const finish = async () => {
      await root.getByRole('button', { name: 'Send message', exact: true }).waitFor({ timeout: 20000 });
    };
    const agentRow = (name) => roster().getByRole('button', { name, exact: true });
    const agentActions = (name) => agentRow(name).locator('xpath=..').getByRole('button', {
      name: `More actions for ${name}`,
      exact: true,
    });
    const activeTopic = () => topics().locator('[aria-current="true"]');
    const topicActions = (row) => row.locator('xpath=..').getByRole('button', {
      name: 'Chat actions',
      exact: true,
    });

    await check('Agent roster keeps stable ownership and reference-style row actions', async () => {
      assert.equal(Math.round((await roster().boundingBox()).width), 230);
      assert.equal(Math.round((await topics().boundingBox()).width), 238);
      await roster().getByRole('textbox', { name: 'Search agents' }).fill('Second');
      await agentRow('Second Agent').waitFor();
      assert.equal(await agentRow('Agent').count(), 0);
      await roster().getByRole('textbox', { name: 'Search agents' }).fill('');

      await agentActions('Second Agent').click();
      const menu = page.getByRole('menu', { name: 'Second Agent actions' });
      assert.deepEqual(
        (await menu.getByRole('menuitem').allTextContents()).map((text) => text.trim()),
        ['Agent Profile', 'Delete'],
      );
      const menuBox = await menu.boundingBox();
      const triggerBox = await agentActions('Second Agent').boundingBox();
      assert.ok(menuBox.x <= triggerBox.x + triggerBox.width);
      await menu.getByRole('menuitem', { name: 'Agent Profile', exact: true }).click();
      await profile().waitFor();
      assert.equal(await roster().count(), 1);
      assert.equal(Math.round((await roster().boundingBox()).width), 230);

      await agentRow('Agent').click();
      await conversation().waitFor();
      assert.equal(await profile().count(), 0);
      await agentRow('Second Agent').click();
      await conversation().waitFor();
      await root.screenshot({ path: path.join(evidence, '01-agent-roster-wide.png') });
    });

    let createdAgentName = '';
    await check('Profile edits one Agent and binds capabilities from bounded pickers', async () => {
      await root.getByRole('button', { name: 'Create Agent', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Create Local', exact: true }).click();
      await profile().waitFor();
      createdAgentName = await profile().getByRole('textbox', { name: 'Agent title' }).inputValue();
      assert.match(createdAgentName, /^New Agent/);
      assert.equal(await agentRow(createdAgentName).count(), 1);

      const back = profile().getByRole('button', { name: 'Back to chat', exact: true });
      const avatar = profile().getByRole('button', { name: 'Change Agent avatar', exact: true });
      const title = profile().getByRole('textbox', { name: 'Agent title', exact: true });
      const description = profile().getByRole('textbox', { name: 'Agent description', exact: true });
      const [backBox, avatarBox, titleBox, descriptionBox] = await Promise.all([
        back.boundingBox(), avatar.boundingBox(), title.boundingBox(), description.boundingBox(),
      ]);
      assert.ok(Math.abs(backBox.x - avatarBox.x) <= 1);
      assert.ok(Math.abs(backBox.y - titleBox.y) <= 1);
      assert.ok(Math.abs(avatarBox.y - descriptionBox.y) <= 1);
      assert.ok(Math.abs(titleBox.x - descriptionBox.x) <= 1);
      assert.equal(Math.round(backBox.width), 36);
      assert.equal(Math.round(avatarBox.width), 64);
      assert.equal(Math.round(avatarBox.height), 64);
      assert.equal(Math.round(descriptionBox.height), 64);
      assert.deepEqual(
        await avatar.evaluate((element) => ({
          border: getComputedStyle(element).borderWidth,
          padding: getComputedStyle(element).padding,
        })),
        { border: '0px', padding: '0px' },
      );
      assert.equal(await profile().getByText('Changes save automatically', { exact: true }).count(), 0);
      assert.equal(await profile().getByRole('combobox').count(), 0);
      await description.fill('Updated ordinary workspace Agent description.');
      await page.getByText('Changes saved', { exact: true }).last().waitFor();

      await avatar.click();
      const avatarPicker = page.getByRole('dialog', { name: 'Change Agent avatar', exact: true });
      await avatarPicker.getByRole('button', { name: 'Use 🤖 avatar', exact: true }).click();
      assert.match(await avatar.innerText(), /🤖/);
      assert.match(await agentRow(createdAgentName).innerText(), /🤖/);
      const storedAvatar = await page.evaluate((name) => {
        const order = JSON.parse(localStorage.getItem('agent-chat-agent-order') || '[]');
        const id = order.find((candidate) => {
          const value = JSON.parse(localStorage.getItem(`agent-chat-agent-${candidate}`) || 'null');
          return value?.name === name;
        });
        return id ? JSON.parse(localStorage.getItem(`agent-chat-agent-${id}`)).avatar : null;
      }, createdAgentName);
      assert.deepEqual(storedAvatar, { kind: 'emoji', value: '🤖' });

      const onePixelPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      );
      await avatar.click();
      await page.getByRole('dialog', { name: 'Change Agent avatar', exact: true })
        .getByRole('tab', { name: 'Upload', exact: true }).click();
      let chooser = page.waitForEvent('filechooser');
      await page.getByRole('dialog', { name: 'Change Agent avatar', exact: true })
        .getByRole('button', { name: 'Choose file', exact: true }).click();
      await (await chooser).setFiles({ name: 'avatar.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
      await page.getByRole('alert').getByText('Choose a PNG, JPEG, WebP, or GIF image.', { exact: true }).waitFor();
      chooser = page.waitForEvent('filechooser');
      await page.getByRole('dialog', { name: 'Change Agent avatar', exact: true })
        .getByRole('button', { name: 'Choose file', exact: true }).click();
      await (await chooser).setFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: onePixelPng });
      await page.getByRole('img', { name: 'Avatar preview', exact: true }).waitFor();
      await page.getByRole('dialog', { name: 'Change Agent avatar', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.match(await avatar.innerText(), /🤖/);

      await avatar.click();
      await page.getByRole('dialog', { name: 'Change Agent avatar', exact: true })
        .getByRole('tab', { name: 'Upload', exact: true }).click();
      chooser = page.waitForEvent('filechooser');
      await page.getByRole('dialog', { name: 'Change Agent avatar', exact: true })
        .getByRole('button', { name: 'Choose file', exact: true }).click();
      await (await chooser).setFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: onePixelPng });
      await page.getByRole('dialog', { name: 'Change Agent avatar', exact: true })
        .getByRole('button', { name: 'Save', exact: true }).click();
      assert.equal(await avatar.locator('img').count(), 1);
      assert.equal(await agentRow(createdAgentName).locator('img').count(), 1);
      const storedImageKind = await page.evaluate((name) => {
        const order = JSON.parse(localStorage.getItem('agent-chat-agent-order') || '[]');
        const id = order.find((candidate) => {
          const value = JSON.parse(localStorage.getItem(`agent-chat-agent-${candidate}`) || 'null');
          return value?.name === name;
        });
        return id ? JSON.parse(localStorage.getItem(`agent-chat-agent-${id}`)).avatar.kind : null;
      }, createdAgentName);
      assert.equal(storedImageKind, 'image');
      await page.getByText('Changes saved', { exact: true }).last().waitFor({ state: 'hidden', timeout: 5000 });

      const [profileBox, soulBox, agentsBox] = await Promise.all([
        profile().boundingBox(),
        profile().getByRole('textbox', { name: 'SOUL.md', exact: true }).boundingBox(),
        profile().getByRole('textbox', { name: 'AGENTS.md', exact: true }).boundingBox(),
      ]);
      assert.ok(profileBox.y + profileBox.height - (soulBox.y + soulBox.height) <= 40);
      assert.ok(Math.abs((soulBox.y + soulBox.height) - (agentsBox.y + agentsBox.height)) <= 1);
      await root.screenshot({ path: path.join(evidence, '02-profile-identity.png') });

      await profile().getByRole('tab', { name: /Extensions/ }).click();

      await profile().getByRole('button', { name: 'Add skill', exact: true }).click();
      let picker = page.getByRole('dialog', { name: 'Add skill', exact: true });
      assert.ok((await picker.getByRole('button', { name: /^Add / }).count()) <= 12);
      await picker.getByRole('button', { name: 'Add Meeting digest', exact: true }).click();
      const skills = profile().getByRole('region', { name: 'Skills', exact: true });
      await skills.getByText('Meeting digest', { exact: true }).waitFor();
      await skills.getByRole('switch', { name: 'Disable Meeting digest', exact: true }).click();
      await skills.getByRole('switch', { name: 'Enable Meeting digest', exact: true }).waitFor();

      await profile().getByRole('button', { name: 'Add MCP tool', exact: true }).click();
      picker = page.getByRole('dialog', { name: 'Add MCP tool', exact: true });
      await picker.getByRole('button', { name: 'Add Integrated browser', exact: true }).click();
      await profile().getByRole('region', { name: 'MCP tools', exact: true })
        .getByText('Integrated browser', { exact: true }).waitFor();

      await skills.getByRole('button', { name: 'Remove Meeting digest', exact: true }).click();
      assert.equal(await skills.getByText('Meeting digest', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('dialog', { name: /Add (skill|MCP tool)/ }).count(), 0);
      await page.getByText('Changes saved', { exact: true }).last().waitFor({ state: 'hidden', timeout: 5000 });
      await root.screenshot({ path: path.join(evidence, '02-profile-extensions.png') });
      await profile().getByRole('button', { name: 'Back to chat', exact: true }).click();
      assert.equal(await root.getByRole('button', { name: 'Insert Integrated browser', exact: true }).count(), 0);
      assert.equal(await root.getByLabel('Topic quick tools').count(), 0);

      await agentActions(createdAgentName).click();
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      let dialog = page.getByRole('alertdialog', { name: 'Delete this Agent?' });
      assert.equal(
        await dialog.getByRole('button', { name: 'Cancel', exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.waitForFunction((name) => {
        const trigger = document.querySelector(`[data-agent-actions-for="${name}"]`);
        return trigger === document.activeElement;
      }, await page.evaluate((name) => {
        const order = JSON.parse(localStorage.getItem('agent-chat-agent-order') || '[]');
        return order.find((candidate) => {
          const value = JSON.parse(localStorage.getItem(`agent-chat-agent-${candidate}`) || 'null');
          return value?.name === name;
        });
      }, createdAgentName));
      assert.equal(
        await agentActions(createdAgentName).evaluate((element) => element === document.activeElement),
        true,
      );
      await agentActions(createdAgentName).click();
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      dialog = page.getByRole('alertdialog', { name: 'Delete this Agent?' });
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
      assert.equal(await agentRow(createdAgentName).count(), 0);
    });

    await check('Topic rail owns new, switch, pin, title search, edit and delete', async () => {
      await startNew();
      const input = composer();
      await input.fill('First line');
      await input.press('Shift+Enter');
      await input.type('Second line');
      assert.equal(await input.inputValue(), 'First line\nSecond line');
      await input.fill('Scope ledger topic');
      await input.press('Enter');
      await topics().getByRole('button', { name: 'Generating title…', exact: true }).waitFor();
      let row = topics().getByRole('button', { name: 'Scope ledger topic', exact: true });
      await row.waitFor();
      await finish();

      await topicActions(row).click();
      assert.deepEqual(
        (await page.getByRole('menu', { name: 'Chat actions' }).getByRole('menuitem').allTextContents())
          .map((text) => text.trim()),
        ['Pin', 'Edit', 'Delete'],
      );
      await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
      assert.equal(await row.getByLabel('Pinned topic').count(), 1);

      await topicActions(row).click();
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      const titleInput = topics().getByRole('textbox', { name: 'Chat title', exact: true });
      await titleInput.fill('Manual scope title');
      await titleInput.press('Enter');
      row = topics().getByRole('button', { name: 'Manual scope title', exact: true });
      await row.waitFor();

      const topicHead = topics().locator(':scope > div').first();
      assert.equal(await topicHead.evaluate((element) => element.children.length), 1);
      assert.equal(await topicHead.locator('img').count(), 0);

      const searchTrigger = topics().getByRole('button', { name: 'Search', exact: true });
      const actionHeight = await searchTrigger.evaluate((element) =>
        Math.round(element.parentElement.parentElement.getBoundingClientRect().height));
      await searchTrigger.click();
      const search = topics().getByRole('textbox', { name: 'Search topic titles', exact: true });
      assert.equal(
        await search.evaluate((element) =>
          Math.round(element.parentElement.parentElement.parentElement.getBoundingClientRect().height)),
        actionHeight,
      );
      assert.equal(await topics().getByRole('button', { name: 'Start new topic', exact: true }).count(), 0);
      assert.equal(await topics().getByRole('button', { name: 'Agent Profile', exact: true }).count(), 0);
      await search.fill('single goal');
      assert.equal(await row.count(), 0);
      await search.fill('Manual scope');
      await row.waitFor();
      await search.fill('');
      await root.screenshot({ path: path.join(evidence, '03-topic-search-inline.png') });
      await topics().getByRole('button', { name: 'Cancel topic search', exact: true }).click();
      await topics().getByRole('button', { name: 'Search', exact: true }).waitFor();
      assert.equal(await topics().getByRole('textbox', { name: 'Search topic titles', exact: true }).count(), 0);

      await startNew();
      await send('Batch cleanup topic');
      await finish();
      const batchRow = topics().getByRole('button', { name: 'Batch cleanup topic', exact: true });
      await batchRow.waitFor();
      const topicLabel = topics().getByText('Topics', { exact: false }).first();
      assert.match(await topicLabel.innerText(), /Topics\s+2/);
      const topicActionsBar = topics().getByRole('button', { name: 'Start new topic', exact: true }).locator('xpath=..');
      const actionWidths = await topicActionsBar.getByRole('button').evaluateAll((buttons) =>
        buttons.map((button) => Math.round(button.getBoundingClientRect().width)));
      assert.equal(new Set(actionWidths).size, 1);

      await topics().getByRole('button', { name: 'Select topics', exact: true }).click();
      await topics().getByRole('checkbox', { name: 'Select Manual scope title', exact: true }).click();
      await topics().getByRole('checkbox', { name: 'Select Batch cleanup topic', exact: true }).click();
      await topics().getByRole('button', { name: 'Delete selected topics', exact: true }).click();
      let batchDialog = page.getByRole('alertdialog', { name: 'Delete 2 topics?' });
      await batchDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await topics().getByRole('checkbox', { name: 'Select Manual scope title', exact: true }).click();
      await topics().getByRole('button', { name: 'Delete selected topics', exact: true }).click();
      batchDialog = page.getByRole('alertdialog', { name: 'Delete 1 topics?' });
      await batchDialog.getByRole('button', { name: 'Delete', exact: true }).click();
      assert.equal(await batchRow.count(), 0);
      await row.waitFor();

      await topics().getByRole('button', { name: 'Pinned', exact: true }).click();
      assert.equal(await row.count(), 0);
      await topics().getByRole('button', { name: 'Pinned', exact: true }).click();
      await topicActions(row).click();
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Delete this chat?' });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await row.waitFor();
      assert.equal(await root.getByText('Smart Rename', { exact: true }).count(), 0);
      assert.equal(await topics().getByRole('button', { name: 'Sort & filter', exact: true }).count(), 0);
      await root.screenshot({ path: path.join(evidence, '03-topic-management.png') });
    });

    await check('Provider settings create Direct and CLI profiles without type tabs', async () => {
      const openProviderSettings = async () => {
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByRole('tab', { name: 'AI', exact: true }).click();
        const sections = page.getByRole('navigation', { name: 'Settings sections', exact: true });
        await sections.getByRole('button', { name: 'Providers', exact: true }).click();
        return sections;
      };
      let settingsSections = await openProviderSettings();

      assert.equal(await page.getByRole('tab', { name: /^(Direct|CLI)$/ }).count(), 0);
      const usableOnly = page.getByRole('switch', { name: 'Show usable only', exact: true });
      assert.equal(await usableOnly.getAttribute('aria-checked'), 'true');
      await page.getByRole('button', { name: 'Select OpenAI-compatible provider', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Select TRAE CLI provider', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Select Anthropic provider', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Select Codex CLI provider', exact: true }).count(), 0);
      await page.screenshot({ path: path.join(evidence, '04-provider-usable-filter.png') });
      await usableOnly.click();
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peers-prototype-show-usable-providers')),
        'false',
      );
      await page.getByRole('button', { name: 'Select Anthropic provider', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Select Codex CLI provider', exact: true }).waitFor();
      assert.equal(await page.getByRole('group', { name: 'Direct provider settings', exact: true }).count(), 1);
      assert.equal(await page.getByRole('group', { name: 'CLI provider settings', exact: true }).count(), 0);

      await page.getByRole('button', { name: 'Select Codex CLI provider', exact: true }).click();
      let cliSettings = page.getByRole('group', { name: 'CLI provider settings', exact: true });
      await cliSettings.waitFor();
      assert.equal(await page.getByRole('group', { name: 'Direct provider settings', exact: true }).count(), 0);
      assert.equal(await page.locator('[aria-label="API Key"]').count(), 0);
      assert.equal(await page.locator('[aria-label="Base URL"]').count(), 0);
      assert.equal(await cliSettings.getByRole('button', { name: 'Add Model', exact: true }).count(), 0);

      const addProviderButton = page.getByRole('button', { name: 'Add Provider', exact: true });
      await addProviderButton.click();
      let addDialog = page.getByRole('dialog', { name: 'Add provider', exact: true });
      assert.equal(await addDialog.getByRole('tab').count(), 0);
      assert.equal(await addDialog.getByRole('radio', { name: 'Direct model', exact: true }).getAttribute('aria-checked'), 'true');
      assert.equal(
        await addDialog.getByRole('radio', { name: 'Direct model', exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.keyboard.press('Escape');
      assert.equal(await addDialog.count(), 0);
      await page.waitForFunction(() =>
        document.activeElement?.textContent?.trim() === 'Add Provider');
      assert.equal(await addProviderButton.evaluate((element) => element === document.activeElement), true);
      await addProviderButton.click();
      addDialog = page.getByRole('dialog', { name: 'Add provider', exact: true });
      await addDialog.getByRole('button', { name: 'Create provider', exact: true }).click();
      await page.getByRole('group', { name: 'Direct provider settings', exact: true }).waitFor();
      assert.equal(await page.getByRole('group', { name: 'CLI provider settings', exact: true }).count(), 0);

      await addProviderButton.click();
      addDialog = page.getByRole('dialog', { name: 'Add provider', exact: true });
      await addDialog.getByRole('radio', { name: 'CLI', exact: true }).click();
      await addDialog.getByRole('combobox', { name: 'New CLI adapter', exact: true }).selectOption('trae-cli');
      await addDialog.getByRole('button', { name: 'Create provider', exact: true }).click();

      cliSettings = page.getByRole('group', { name: 'CLI provider settings', exact: true });
      await cliSettings.waitFor();
      assert.equal(await page.getByRole('group', { name: 'Direct provider settings', exact: true }).count(), 0);
      assert.equal(await page.locator('[aria-label="API Key"]').count(), 0);
      assert.equal(await page.locator('[aria-label="Base URL"]').count(), 0);
      assert.equal(await cliSettings.getByRole('combobox', { name: 'CLI provider profile', exact: true }).inputValue(), 'trae-cli');

      const defaultModel = cliSettings.getByRole('textbox', { name: 'CLI default model', exact: true });
      const startupArgs = cliSettings.getByRole('textbox', { name: 'CLI startup args', exact: true });
      const environment = cliSettings.getByRole('textbox', { name: 'CLI environment variables', exact: true });
      await defaultModel.fill('fast');
      await startupArgs.fill('--resume\n--quiet');
      await environment.fill('PEERS_ENV=prototype');
      await cliSettings.getByRole('button', { name: 'Advanced', exact: true }).click();
      const advanced = cliSettings.getByRole('group', { name: 'CLI advanced settings', exact: true });
      await advanced.waitFor();
      const registeredCommand = advanced.getByRole('textbox', { name: 'Registered adapter command', exact: true });
      assert.equal(await registeredCommand.inputValue(), 'traecli --json exec --skip-git-repo-check -');
      assert.equal(await registeredCommand.getAttribute('readonly'), '');
      assert.equal(await advanced.getByRole('textbox', { name: 'CLI workspace policy', exact: true }).getAttribute('readonly'), '');
      assert.equal(await page.getByLabel(/binary path|executable path/i).count(), 0);
      assert.equal(await page.getByRole('textbox', { name: /command/i }).count(), 1);
      await advanced.getByRole('spinbutton', { name: 'CLI timeout seconds', exact: true }).fill('90');

      await cliSettings.getByRole('button', { name: 'Restore defaults', exact: true }).click();
      await page.getByText('Defaults restored', { exact: true }).waitFor();
      assert.equal(await defaultModel.inputValue(), 'default');
      assert.equal(await startupArgs.inputValue(), '');
      assert.equal(await environment.inputValue(), '');
      assert.equal(await advanced.getByRole('spinbutton', { name: 'CLI timeout seconds', exact: true }).inputValue(), '120');

      await page.getByRole('button', { name: 'Check', exact: true }).click();
      await page.getByRole('button', { name: 'Ready', exact: true }).waitFor();
      await cliSettings.getByRole('button', { name: 'Save', exact: true }).click();
      const savedToast = page.getByText('Provider saved', { exact: true });
      await savedToast.waitFor();
      const toastSurface = savedToast.locator('xpath=ancestor::*[@role="dialog"][1]');
      const [toastBox, viewport] = await Promise.all([toastSurface.boundingBox(), Promise.resolve(page.viewportSize())]);
      assert.ok(viewport.width - (toastBox.x + toastBox.width) <= 32);
      assert.ok(toastBox.y > viewport.height * 0.75);
      await page.screenshot({ path: path.join(evidence, '04-cli-provider-settings.png') });

      await page.getByRole('button', { name: 'Select OpenAI-compatible provider', exact: true }).click();
      let providerToggle = page.getByRole('switch', { name: 'OpenAI-compatible provider enabled', exact: true });
      assert.equal(await providerToggle.getAttribute('aria-checked'), 'true');
      await providerToggle.click();
      assert.equal(await providerToggle.getAttribute('aria-checked'), 'false');

      await page.locator('button[aria-label="Agent"][aria-pressed]').click();
      await root.waitFor();
      await root.getByRole('button', { name: 'Topic model', exact: true }).click();
      let modelTree = page.getByRole('tree', { name: 'Provider model tree', exact: true });
      assert.equal(await modelTree.getByRole('treeitem').filter({ hasText: 'OpenAI-compatible' }).count(), 0);
      await page.keyboard.press('Escape');

      settingsSections = await openProviderSettings();
      assert.equal(
        await page.getByRole('switch', { name: 'Show usable only', exact: true }).getAttribute('aria-checked'),
        'false',
      );
      await page.getByRole('button', { name: 'Select OpenAI-compatible provider', exact: true }).click();
      providerToggle = page.getByRole('switch', { name: 'OpenAI-compatible provider enabled', exact: true });
      assert.equal(await providerToggle.getAttribute('aria-checked'), 'false');
      await providerToggle.click();
      await page.getByRole('button', { name: 'Select Anthropic provider', exact: true }).click();
      const anthropicToggle = page.getByRole('switch', { name: 'Anthropic provider enabled', exact: true });
      assert.equal(await anthropicToggle.getAttribute('aria-checked'), 'false');
      await anthropicToggle.click();

      await page.locator('button[aria-label="Agent"][aria-pressed]').click();
      await root.waitFor();
      await root.getByRole('button', { name: 'Topic model', exact: true }).click();
      modelTree = page.getByRole('tree', { name: 'Provider model tree', exact: true });
      await modelTree.getByRole('treeitem').filter({ hasText: 'Anthropic' }).click();
      await modelTree.getByRole('treeitem').filter({ hasText: /^claude-haiku-4Fast response model$/ }).click();
      assert.match(await root.getByRole('button', { name: 'Topic model', exact: true }).innerText(), /claude-haiku-4/);

      settingsSections = await openProviderSettings();
      await page.getByRole('button', { name: 'Select Anthropic provider', exact: true }).click();
      const modelToggle = page.getByRole('switch', { name: 'claude-haiku-4 enabled', exact: true });
      assert.equal(await modelToggle.getAttribute('aria-checked'), 'true');
      await modelToggle.click();

      await page.locator('button[aria-label="Agent"][aria-pressed]').click();
      await root.waitFor();
      assert.doesNotMatch(
        await root.getByRole('button', { name: 'Topic model', exact: true }).innerText(),
        /claude-haiku-4/,
      );
      await root.getByRole('button', { name: 'Topic model', exact: true }).click();
      modelTree = page.getByRole('tree', { name: 'Provider model tree', exact: true });
      assert.equal(await modelTree.getByRole('treeitem').filter({ hasText: 'claude-haiku-4' }).count(), 0);
      await root.screenshot({ path: path.join(evidence, '04-model-availability.png') });
      await page.keyboard.press('Escape');

      settingsSections = await openProviderSettings();
      await page.getByRole('button', { name: 'Select Anthropic provider', exact: true }).click();
      await page.getByRole('switch', { name: 'claude-haiku-4 enabled', exact: true }).click();
      await page.getByRole('button', { name: 'Select Ollama (local) provider', exact: true }).click();
      await page.getByRole('switch', { name: 'Ollama (local) provider enabled', exact: true }).click();
      await settingsSections.getByRole('button', { name: 'Models', exact: true }).click();
      await page.getByRole('combobox', { name: 'Default chat model', exact: true }).waitFor();
      assert.equal(await page.getByText('Provider model tree', { exact: true }).count(), 0);
      await page.screenshot({ path: path.join(evidence, '04-default-model-only.png') });

      await page.locator('button[aria-label="Agent"][aria-pressed]').click();
      await root.waitFor();
    });

    await check('Composer owns Topic model, slash commands, attachment and keyboard semantics', async () => {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('tab', { name: 'AI', exact: true }).click();
      const settingsSections = page.getByRole('navigation', { name: 'Settings sections', exact: true });
      await settingsSections.getByRole('button', { name: 'Models', exact: true }).click();
      const defaultModelSelect = page.getByRole('combobox', { name: 'Default chat model', exact: true });
      assert.deepEqual(
        await defaultModelSelect.locator('optgroup').evaluateAll((groups) =>
          groups.map((group) => group.getAttribute('label'))),
        ['OpenAI-compatible', 'Anthropic', 'Ollama (local)', 'TRAE CLI'],
      );
      assert.equal(await page.getByText('Provider model tree', { exact: true }).count(), 0);
      await defaultModelSelect.selectOption('qwen-max');
      assert.equal(
        await page.evaluate(() => localStorage.getItem('peers-prototype-default-chat-model')),
        'qwen-max',
      );
      await page.locator('button[aria-label="Agent"][aria-pressed]').click();
      await root.waitFor();
      await topics().getByRole('button', { name: 'Manual scope title', exact: true }).click();
      await composer().fill('Composer line one');
      await composer().press('Control+Enter');
      await composer().type('Composer line two');
      assert.equal(await composer().inputValue(), 'Composer line one\nComposer line two');
      await composer().fill('');

      assert.match(await root.getByRole('button', { name: 'Topic model', exact: true }).innerText(), /gpt-5.4/);
      await root.getByRole('button', { name: 'Topic model', exact: true }).click();
      const modelTree = page.getByRole('tree', { name: 'Provider model tree', exact: true });
      assert.equal(await modelTree.getByRole('treeitem').filter({ hasText: 'OpenAI-compatible' }).count(), 1);
      assert.equal(await modelTree.getByRole('treeitem').filter({ hasText: 'Anthropic' }).count(), 1);
      assert.equal(await modelTree.getByRole('treeitem').filter({ hasText: 'Ollama (local)' }).count(), 1);
      const openAIProvider = modelTree.getByRole('treeitem').filter({ hasText: 'OpenAI-compatible' });
      await openAIProvider.click();
      await root.screenshot({ path: path.join(evidence, '04-provider-model-tree.png') });
      const modelSearch = page.getByRole('textbox', { name: 'Search providers and models', exact: true });
      await modelSearch.fill('qwen');
      assert.equal(await modelTree.getByRole('treeitem').filter({ hasText: 'qwen-max' }).count(), 1);
      assert.equal(await modelTree.getByRole('treeitem').filter({ hasText: 'gpt-5.4' }).count(), 0);
      await modelSearch.fill('');
      await modelTree.getByRole('treeitem').filter({ hasText: 'Anthropic' }).click();
      await modelTree.getByRole('treeitem').filter({ hasText: /^claude-haiku-4Fast response model$/ }).click();
      assert.match(await root.getByRole('button', { name: 'Topic model', exact: true }).innerText(), /claude-haiku-4/);
      await startNew();
      assert.match(await root.getByRole('button', { name: 'Topic model', exact: true }).innerText(), /qwen-max/);
      await topics().getByRole('button', { name: 'Manual scope title', exact: true }).click();
      await root.getByRole('button', { name: 'Topic model', exact: true }).filter({ hasText: 'claude-haiku-4' }).waitFor();
      assert.match(await root.getByRole('button', { name: 'Topic model', exact: true }).innerText(), /claude-haiku-4/);
      await root.getByRole('button', { name: 'Commands and Skills', exact: true }).click();
      let commandPalette = page.getByRole('menu', { name: 'Commands and Skills', exact: true });
      await commandPalette.waitFor();
      await root.screenshot({ path: path.join(evidence, '04-command-palette-empty.png') });
      for (const command of ['/help', '/tools', '/skills', '/clear']) {
        assert.equal(
          await commandPalette.getByRole('menuitem').filter({ hasText: command }).count(),
          1,
        );
      }
      await commandPalette.getByRole('menuitem').filter({ hasText: '/help' }).click();
      await commandPalette.getByText('Visibility never grants Tool authority or bypasses approval.', { exact: false }).waitFor();
      await commandPalette.getByRole('button', { name: 'Back to all commands', exact: true }).click();
      await commandPalette.getByRole('menuitem').filter({ hasText: '/tools' }).click();
      await commandPalette.getByText('No Tools in this snapshot.', { exact: true }).waitFor();
      await commandPalette.getByRole('button', { name: 'Back to all commands', exact: true }).click();
      await commandPalette.getByRole('menuitem').filter({ hasText: '/skills' }).click();
      await commandPalette.getByText('No Skills in this snapshot.', { exact: true }).waitFor();
      await commandPalette.getByRole('button', { name: 'Back to all commands', exact: true }).click();
      await commandPalette.getByRole('menuitem').filter({ hasText: '/clear' }).click();
      await composer().waitFor();
      assert.equal(await topics().getByRole('button', { name: 'Manual scope title', exact: true }).count(), 1);

      await composer().fill('/');
      commandPalette = page.getByRole('menu', { name: 'Commands and Skills', exact: true });
      await commandPalette.waitFor();
      await page.keyboard.press('Escape');
      assert.equal(
        await root.getByRole('button', { name: 'Commands and Skills', exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await composer().fill('');

      const chooser = page.waitForEvent('filechooser');
      await root.getByRole('button', { name: 'Upload file', exact: true }).click();
      await (await chooser).setFiles([
        { name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('Brief') },
        { name: 'discard.txt', mimeType: 'text/plain', buffer: Buffer.from('Discard') },
      ]);
      await root.getByRole('button', { name: 'Remove discard.txt', exact: true }).click();
      await send('Read the attached brief');
      await finish();
      await root.locator('[aria-label="Message attachments"]').getByText('brief.txt', { exact: true }).waitFor();
      const attachmentAnswer = root.locator('.pt-assistant-row').last();
      await attachmentAnswer.getByRole('button', { name: /Attachment: brief.txt/ }).waitFor();
      await attachmentAnswer.getByRole('button', { name: /Tool:/ }).waitFor();

      const projectionContext = await browser.newContext({ viewport: { width: 1180, height: 820 } });
      await projectionContext.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem('agent-profile-assistant-extensions', JSON.stringify({
          bound: ['skill.meeting-digest', 'mcp.integrated-browser'],
          enabled: ['skill.meeting-digest', 'mcp.integrated-browser'],
        }));
      });
      for (const state of ['ready', 'stale', 'unavailable']) {
        const projectionPage = await projectionContext.newPage();
        attachErrorCapture(projectionPage);
        await projectionPage.goto(`${url}${url.includes('?') ? '&' : '?'}review=1&agentCapabilityState=${state}`, {
          waitUntil: 'networkidle',
        });
        const projectionRoot = projectionPage.getByTestId('desktop-shell-agent-chat');
        await projectionRoot.getByRole('button', { name: 'Commands and Skills', exact: true }).click();
        const projectionPalette = projectionPage.getByRole('menu', { name: 'Commands and Skills', exact: true });
        await projectionPalette.waitFor();
        assert.equal(
          await projectionPalette.getByRole('menuitem').filter({ hasText: 'Meeting digest' }).isDisabled(),
          state !== 'ready',
        );
        assert.equal(
          await projectionPalette.getAttribute('data-capability-projection-state'),
          state,
        );
        if (state === 'ready' || state === 'stale' || state === 'unavailable') {
          await projectionRoot.screenshot({
            path: path.join(evidence, `04-command-palette-${state}.png`),
          });
        }
        await projectionPage.keyboard.press('Escape');
        const projectionComposer = projectionRoot.getByRole('textbox', { name: /^Message / });
        await projectionComposer.fill(`Text chat remains available while ${state}`);
        assert.equal(
          await projectionRoot.getByRole('button', { name: 'Send message', exact: true }).isEnabled(),
          true,
        );
        await projectionPage.close();
      }
      await projectionContext.close();
    });

    await check('Conversation preserves activity, copy, quick reply and basic artifacts', async () => {
      await startNew();
      await send('Draft a short project update from this week’s work');
      await finish();
      assert.equal(await root.getByRole('heading', { name: 'Draft a short project update from this week’s work', exact: true }).count(), 0);
      const conversationHeader = root.locator('header');
      assert.match(await conversationHeader.innerText(), /Draft a short project update/);
      const conversationSearchButton = conversationHeader.getByRole('button', { name: 'Search conversation', exact: true });
      const [headerTitleBox, headerSearchBox] = await Promise.all([
        conversationHeader.locator('strong').first().boundingBox(),
        conversationSearchButton.boundingBox(),
      ]);
      assert.ok(headerSearchBox.x > headerTitleBox.x);
      await conversationSearchButton.click();
      const conversationSearch = conversationHeader.getByRole('textbox', { name: 'Search this conversation', exact: true });
      await conversationSearch.fill('Risks');
      const searchStatus = conversationHeader.getByRole('status', { name: 'Conversation search results', exact: true });
      assert.equal(await searchStatus.innerText(), '1 / 1');
      let matchedMessage = root.locator('[data-conversation-search-match="true"]');
      assert.equal(await matchedMessage.count(), 1);
      assert.match(await matchedMessage.innerText(), /Risks/);

      await conversationSearch.fill('project');
      await page.waitForFunction(() => {
        const status = document.querySelector('[aria-label="Conversation search results"]');
        return status?.textContent?.trim() === '1 / 2';
      });
      matchedMessage = root.locator('[data-conversation-search-match="true"]');
      const firstMatchId = await matchedMessage.getAttribute('data-message-id');
      await conversationHeader.getByRole('button', { name: 'Next match', exact: true }).click();
      await page.waitForFunction((previousId) =>
        document.querySelector('[data-conversation-search-match="true"]')?.getAttribute('data-message-id') !== previousId,
      firstMatchId);
      assert.notEqual(await root.locator('[data-conversation-search-match="true"]').getAttribute('data-message-id'), firstMatchId);
      await root.screenshot({ path: path.join(evidence, '05-conversation-search.png') });
      await conversationHeader.getByRole('button', { name: 'Close conversation search', exact: true }).click();
      await page.waitForFunction(() =>
        document.activeElement?.getAttribute('aria-label') === 'Search conversation');
      assert.equal(await conversationSearchButton.evaluate((element) => element === document.activeElement), true);

      const assistant = root.locator('.pt-assistant-row').last();
      const activity = assistant.getByRole('button', { name: /thought|command/ });
      await activity.click();
      assert.equal(await activity.getAttribute('aria-expanded'), 'true');

      await assistant.getByRole('button', { name: /Memory: Working preferences/ }).waitFor();
      await assistant.getByRole('button', { name: /Knowledge: Workspace architecture notes/ }).waitFor();
      await assistant.getByRole('button', { name: 'Turn sources', exact: true }).click();
      const attributionDetail = assistant.getByRole('region', {
        name: 'Historical Turn source details',
        exact: true,
      });
      await attributionDetail.waitFor();
      assert.match(await attributionDetail.innerText(), /Included/);
      assert.match(await attributionDetail.innerText(), /Omitted/);
      assert.match(await attributionDetail.innerText(), /Partially included/);
      assert.match(await attributionDetail.innerText(), /Pinned to this response/);
      const historicalSkill = attributionDetail.locator('[data-attribution-detail-kind="skill"]');
      const historicalSkillText = await historicalSkill.innerText();
      assert.match(historicalSkillText, /No Skill selected/);
      await page.evaluate(() => {
        localStorage.setItem('agent-profile-assistant-extensions', JSON.stringify({
          bound: ['skill.meeting-digest'],
          enabled: ['skill.meeting-digest'],
        }));
      });
      assert.equal(await historicalSkill.innerText(), historicalSkillText);
      await root.screenshot({ path: path.join(evidence, '05-turn-attribution-detail.png') });

      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await assistant.getByRole('button', { name: 'Copy', exact: true }).click();
      assert.match(await page.evaluate(() => navigator.clipboard.readText()), /project update/i);
      assert.equal(await assistant.getByRole('button', { name: /Reading view|Debug detail|Skill trace/ }).count(), 0);

      await composer().fill('Preserved draft');
      await assistant.getByRole('button', { name: 'Make it more formal', exact: true }).click();
      await assistant.getByRole('button', { name: /Add "Make it more formal" to input/ }).click();
      assert.match(await composer().inputValue(), /Preserved draft Make it more formal/);
      await composer().fill('Preserved draft');
      await assistant.getByRole('button', { name: 'Add a metrics section', exact: true }).click();
      await assistant.getByRole('button', { name: /Reply now with "Add a metrics section"/ }).click();
      await finish();
      assert.equal(await composer().inputValue(), 'Preserved draft');

      await root.getByRole('button', { name: 'Project update.md', exact: true }).first().click();
      const drawer = root.getByRole('dialog', { name: 'Artifacts and references', exact: true });
      await drawer.getByText('This week', { exact: true }).waitFor();
      await drawer.getByRole('button', { name: 'All artifacts', exact: true }).click();
      await drawer.getByRole('button', { name: 'Project update.md', exact: true }).waitFor();
      assert.equal(await drawer.getByRole('tab').count(), 0);
      assert.equal(await drawer.getByRole('textbox').count(), 0);
      await root.screenshot({ path: path.join(evidence, '04-basic-artifacts.png') });
      await drawer.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await root.getByRole('button', { name: /Share conversation|More conversation actions/ }).count(), 0);
    });

    await check('Running turns keep the draft without exposing a queue', async () => {
      await startNew();
      await send('Run the tests');
      const approval = root.getByRole('group', { name: 'Tool approval', exact: true });
      await approval.waitFor();
      await composer().fill('Keep this draft while the Agent is running');
      await composer().press('Enter');
      assert.equal(await root.locator('.pt-user-row').filter({ hasText: 'Keep this draft while the Agent is running' }).count(), 0);
      assert.equal(await composer().inputValue(), 'Keep this draft while the Agent is running');
      assert.equal(await root.getByTestId('agent-chat-queue-panel').count(), 0);
      assert.equal(await root.getByRole('button', { name: 'Queue message', exact: true }).count(), 0);
      assert.equal(await root.getByRole('button', { name: 'Stop generating', exact: true }).count(), 1);
      await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
      await finish();
      assert.equal(await composer().inputValue(), 'Keep this draft while the Agent is running');
      await composer().fill('');
    });

    await check('Clarification and approval remain inline and continue the Agent', async () => {
      await startNew();
      await send('Write an email to the team');
      const ask = root.getByRole('group', { name: 'Agent needs an answer', exact: true });
      await ask.waitFor();
      await ask.getByRole('radio', { name: 'Other', exact: true }).check();
      await ask.getByRole('textbox', { name: 'Other', exact: true }).fill('Warm and direct');
      await ask.getByRole('button', { name: 'Submit', exact: true }).click();
      await root.getByText('Answered · Warm and direct', { exact: true }).waitFor();
      await finish();
      assert.match(await root.locator('.pt-assistant-row').last().innerText(), /warm and direct/i);

      await startNew();
      await send('Run the tests');
      const approval = root.getByRole('group', { name: 'Tool approval', exact: true });
      assert.equal(
        await approval.getByRole('button', { name: 'Cancel', exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await approval.getByRole('button', { name: 'Run tool', exact: true }).click();
      await root.getByText(/Approved the execution request/).waitFor();
      await finish();
      assert.match(await root.locator('.pt-assistant-row').last().innerText(), /all checks pass/i);
      await root.screenshot({ path: path.join(evidence, '05-approval-continuation.png') });
    });

    await check('Stop and typed recovery preserve honest failure semantics', async () => {
      await startNew();
      await send('Write an email to the team');
      await root.getByRole('group', { name: 'Agent needs an answer', exact: true }).waitFor();
      await root.getByRole('button', { name: 'Stop generating', exact: true }).click();
      await root.getByRole('alert').getByText('Agent execution cancelled', { exact: true }).waitFor();
      assert.equal(await topics().getByLabel('Topic error').count(), 1);
      assert.equal(await root.locator('.pt-assistant-row').last().getByRole('button', { name: 'Regenerate', exact: true }).count(), 0);

      const errorPage = await context.newPage();
      attachErrorCapture(errorPage);
      const errorUrl = `${url}${url.includes('?') ? '&' : '?'}review=1&agentError=network`;
      await errorPage.goto(errorUrl, { waitUntil: 'networkidle' });
      const errorRoot = errorPage.getByTestId('desktop-shell-agent-chat');
      const errorInput = errorRoot.getByRole('textbox', { name: /^Message / });
      await errorInput.fill('Recover this request');
      await errorInput.press('Enter');
      const alert = errorRoot.getByRole('alert');
      await alert.getByText('Can’t reach the model service', { exact: true }).waitFor({ timeout: 10000 });
      assert.equal(await errorInput.inputValue(), 'Recover this request');
      await alert.getByRole('button', { name: 'Retry', exact: true }).click();
      await errorRoot.getByRole('button', { name: 'Send message', exact: true }).waitFor({ timeout: 20000 });
      assert.equal(await alert.count(), 0);
      await errorRoot.screenshot({ path: path.join(evidence, '06-typed-error-recovered.png') });
      await errorPage.close();
    });

    await check('Agent and Topic owners preserve isolated drafts', async () => {
      await startNew();
      await composer().fill('Primary Agent draft');
      await agentRow('Second Agent').click();
      await composer().fill('Second Agent draft');
      await agentRow('Agent').click();
      assert.equal(await composer().inputValue(), 'Primary Agent draft');
      await agentRow('Second Agent').click();
      assert.equal(await composer().inputValue(), 'Second Agent draft');

      await composer().fill('');
      await send('Second Agent topic');
      await finish();
      await composer().fill('Topic-owned draft');
      await startNew();
      await composer().fill('New topic draft');
      await topics().getByRole('button', { name: 'Second Agent topic', exact: true }).click();
      assert.equal(await composer().inputValue(), 'Topic-owned draft');
    });

    await check('Wide, compact and mobile topology matches observed reference behavior', async () => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="desktop-shell-agent-chat"]')?.clientWidth > 1040);
      let geometry = await root.evaluate((element) => ({
        width: element.clientWidth,
        overflow: element.scrollWidth - element.clientWidth,
        roster: element.querySelector('aside[aria-label="My Agents"]')?.getBoundingClientRect().width ?? 0,
        topics: element.querySelector('aside[aria-label$=" topics"]')?.getBoundingClientRect().width ?? 0,
      }));
      assert.equal(geometry.overflow, 0);
      assert.equal(Math.round(geometry.roster), 230);
      assert.equal(Math.round(geometry.topics), 238);

      await page.setViewportSize({ width: 900, height: 900 });
      await page.waitForFunction(() => {
        const rootElement = document.querySelector('[data-testid="desktop-shell-agent-chat"]');
        const rosterElement = rootElement?.querySelector('aside[aria-label="My Agents"]');
        const topicsElement = rootElement?.querySelector('aside[aria-label$=" topics"]');
        return Math.round(rosterElement?.getBoundingClientRect().width ?? 0) === 48
          && Math.round(topicsElement?.getBoundingClientRect().width ?? 0) === 48;
      });
      assert.equal(await root.getByRole('button', { name: 'My Agents', exact: true }).count(), 0);
      await root.getByRole('button', { name: 'Search conversation', exact: true }).waitFor();

      await page.setViewportSize({ width: 430, height: 900 });
      await root.getByRole('button', { name: 'Back to topics', exact: true }).waitFor();
      assert.equal(await roster().count(), 0);
      assert.equal(await topics().count(), 0);
      await root.getByRole('button', { name: 'Back to topics', exact: true }).click();
      await topics().waitFor();
      const switchAgent = topics().getByRole('button', { name: 'Switch Agent', exact: true });
      await switchAgent.click();
      const drawer = root.getByRole('dialog', { name: 'Switch Agent', exact: true });
      await drawer.waitFor();
      const [rootBox, drawerBox] = await Promise.all([root.boundingBox(), drawer.boundingBox()]);
      assert.equal(Math.round(drawerBox.x), Math.round(rootBox.x));
      assert.equal(Math.round(drawerBox.y), Math.round(rootBox.y));
      assert.equal(Math.round(drawerBox.height), Math.round(rootBox.height));
      assert.ok(drawerBox.width < rootBox.width);
      assert.ok(drawerBox.width >= rootBox.width - 25);
      assert.equal(
        await drawer.getByRole('button', { name: 'Close Agent picker', exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );

      const mobileMore = drawer.getByRole('button', { name: 'More actions for Second Agent', exact: true });
      await mobileMore.click();
      const menu = page.getByRole('menu', { name: 'Second Agent actions', exact: true });
      assert.deepEqual(
        (await menu.getByRole('menuitem').allTextContents()).map((text) => text.trim()),
        ['Agent Profile', 'Delete'],
      );
      const [mobileMenuBox, mobileMoreBox] = await Promise.all([menu.boundingBox(), mobileMore.boundingBox()]);
      assert.ok(mobileMenuBox.x + mobileMenuBox.width <= rootBox.x + rootBox.width);
      const anchoredBelow = Math.abs(mobileMenuBox.y - (mobileMoreBox.y + mobileMoreBox.height + 4)) <= 2;
      const anchoredAbove = Math.abs(mobileMenuBox.y + mobileMenuBox.height + 4 - mobileMoreBox.y) <= 2;
      assert.ok(anchoredBelow || anchoredAbove);
      await page.keyboard.press('Escape');
      assert.equal(await mobileMore.evaluate((element) => element === document.activeElement), true);
      await root.screenshot({ path: path.join(evidence, '07-mobile-left-agent-drawer.png') });
      await drawer.getByRole('button', { name: 'Close Agent picker', exact: true }).click();
      await page.waitForFunction(() =>
        document.activeElement?.getAttribute('aria-label') === 'Switch Agent');
      assert.equal(await switchAgent.evaluate((element) => element === document.activeElement), true);

      geometry = await root.evaluate((element) => ({
        overflow: element.scrollWidth - element.clientWidth,
        topics: element.querySelector('aside[aria-label$=" topics"]')?.getBoundingClientRect().width ?? 0,
      }));
      assert.equal(geometry.overflow, 0);
      assert.equal(Math.round(geometry.topics), Math.round(rootBox.width));
      await topics().getByRole('button', { name: 'Start new topic', exact: true }).click();
      await root.getByRole('button', { name: 'Back to topics', exact: true }).waitFor();

      await root.getByRole('button', { name: 'Commands and Skills', exact: true }).click();
      const mobilePalette = page.getByRole('menu', { name: 'Commands and Skills', exact: true });
      const [mobileRootBox, mobilePaletteBox] = await Promise.all([
        root.boundingBox(),
        mobilePalette.boundingBox(),
      ]);
      assert.ok(mobilePaletteBox.x >= mobileRootBox.x);
      assert.ok(mobilePaletteBox.x + mobilePaletteBox.width <= mobileRootBox.x + mobileRootBox.width);
      await root.screenshot({ path: path.join(evidence, '08-mobile-command-palette.png') });
      await page.keyboard.press('Escape');

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await composer().fill('Reduced motion turn');
      await composer().press('Enter');
      await root.locator('.pt-typing-dot').first().waitFor();
      const animationNames = await root.locator('.pt-typing-dot').evaluateAll((nodes) =>
        nodes.map((element) => getComputedStyle(element).animationName));
      assert.ok(animationNames.every((name) => name === 'none'));
      await root.getByRole('button', { name: 'Stop generating', exact: true }).click();
      await root.screenshot({ path: path.join(evidence, '08-mobile-chat.png') });
    });

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

main().then(() => {
  const operations = operationCoverage();
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({
    classification: 'PROTOTYPE_AGENT_CHAT_SCOPE_AND_REFERENCE_PARITY_CHECK',
    benchmark: {
      runtime: 'Historical reference instance #6 at http://127.0.0.1:8436',
      historicalEvidenceInventory:
        'https://github.com/peers-labs/peers-touch/blob/e26b81c4cf3c5b9d0b920e9d1a434a751cfba208/docs/architecture/engineering/prototypes/desktop-shell/agent-chat-coverage.md#L121-L146',
    },
    source,
    coverage: {
      topLevelChecks: results.length,
      coveredOperationContracts: operations.length,
      operations,
    },
    results,
    errors,
  }, null, 2));
  process.stdout.write(`Evidence: ${evidence}\n`);
}).catch((error) => {
  fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({
    source,
    results,
    errors,
    failure: String(error.stack || error),
  }, null, 2));
  console.error(error);
  console.error(`Evidence: ${evidence}`);
  process.exitCode = 1;
});
