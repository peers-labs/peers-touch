import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Isolated React regression only. IPC completions are test data, not native or
// Station evidence. No production module is aliased, patched, or replaced.
const root = fileURLToPath(new URL('../../../', import.meta.url));
assert.equal(resolve(process.cwd()), resolve(root), 'Run this script from the worktree root');
const require = createRequire(resolve(root, 'apps/desktop/package.json'));
const { chromium, expect } = require('@playwright/test');
const output = resolve(root, 'apps/mobile/src-tauri/target/search-interaction-browser');
const origin = 'http://127.0.0.1:3265';
const entry = '/__chat-history-search-test__';
const command = 'node apps/mobile/scripts/check-chat-history-search.mjs';
const sourcePaths = [
  'apps/mobile/scripts/fixtures/chat-history-search.tsx',
  'apps/mobile/scripts/check-chat-history-search.mjs',
  'apps/mobile/src/features/chat/useChatHistorySearch.ts',
  'apps/mobile/src/features/chat/chatCommands.ts',
  'apps/mobile/src/features/chat/messageProjection.ts',
  'apps/mobile/src/services/mobileCommands.ts',
  'apps/mobile/src/features/social/socialStore.ts',
];
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [
    path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex'),
  ])));
}
const source = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  files: await sourceHashes(),
};
execFileSync('git', ['check-ignore', 'apps/mobile/src-tauri/target/search-interaction-browser/results.json'], {
  cwd: root, stdio: 'pipe',
});
await mkdir(output, { recursive: true });

const empty = { query: '', loading: false, error: false, index: 0, cursors: [null], page: null };
const cursorOne = { beforeTimestampUnixMs: 1700000000123, beforeMessageId: 'indexed-0201' };
const cursorTwo = { beforeTimestampUnixMs: 1700000000123, beforeMessageId: 'indexed-0101' };
const json = async (page, label) => JSON.parse(await page.locator(`pre[aria-label="${label}"]`).innerText());
const button = (page, name) => page.getByRole('button', { name, exact: true });
function messages(start, count, conversationId = 'conversation-a') {
  return Array.from({ length: count }, (_, index) => ({
    id: `indexed-${String(start - index).padStart(4, '0')}`,
    content: `Indexed fixture message ${start - index}`,
    conversationId,
  }));
}
const firstPage = { messages: messages(300, 100), nextCursor: cursorOne };
const secondPage = { messages: messages(200, 100), nextCursor: cursorTwo };
const freshPage = { messages: messages(900, 1), nextCursor: null };

async function assertState(page, overrides = {}, open = true) {
  const expected = { ...empty, ...overrides };
  await expect.poll(() => json(page, 'Search snapshot')).toEqual(expected);
  if (!open) {
    await expect(page.getByRole('form', { name: 'History search' })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Search results', exact: true })).toHaveCount(0);
    return;
  }
  const status = expected.loading ? 'Loading' : expected.error ? 'Failed'
    : expected.page ? (expected.page.messages.length ? 'Results' : 'No results') : 'Idle';
  await expect(page.getByRole('status', { name: 'Search status' })).toHaveText(status);
  await expect(page.getByRole('alert')).toHaveCount(expected.error ? 1 : 0);
  await expect(page.getByRole('list', { name: 'Search results', exact: true }).getByRole('listitem'))
    .toHaveText(expected.page?.messages.map((message) => message.content) ?? []);
  await expect(button(page, 'Retry')).toBeEnabled({ enabled: !expected.loading && expected.error });
  await expect(button(page, 'Previous')).toBeEnabled({ enabled: !expected.loading && expected.index > 0 });
  await expect(button(page, 'Next')).toBeEnabled({ enabled: !expected.loading && Boolean(expected.page?.nextCursor) });
}

async function request(page, id, query, { cursor, actor = 'alice', conversationId = 'conversation-a' } = {}) {
  await expect.poll(async () => (await json(page, 'IPC snapshot')).length).toBe(id);
  const call = (await json(page, 'IPC snapshot'))[id - 1];
  assert.equal(call.command, 'messaging_search_messages');
  assert.deepEqual(call.input, {
    stationPeerId: 'component-station', actorPtid: `ptid:component-${actor}`,
    conversationId, query, limit: 100, ...cursor,
  });
  assert.equal(call.status, 'pending');
}

async function submit(page, query, id, scope) {
  const before = (await json(page, 'IPC snapshot')).length;
  await page.getByRole('textbox', { name: 'Search query', exact: true }).fill(query);
  assert.equal((await json(page, 'IPC snapshot')).length, before, 'Typing must not invoke indexed search');
  await button(page, 'Search').click();
  await request(page, id, query.trim(), scope);
  await assertState(page, { query: query.trim(), loading: true });
}

async function settle(page, id, completion = 'fresh', outcome = 'resolve') {
  await page.getByRole('combobox', { name: 'Completion data', exact: true }).selectOption(completion);
  await button(page, `${outcome === 'reject' ? 'Reject' : 'Resolve'} request ${id}`).click();
  await expect(page.locator(`[data-request-id="${id}"]`)).toHaveAttribute('data-flushed', 'true');
  assert.equal((await json(page, 'IPC snapshot'))[id - 1].status, outcome === 'reject' ? 'rejected' : 'resolved');
}

async function screenshot(page, name) {
  await page.getByRole('heading', { name: 'Chat history search regression' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: false, scale: 'css' });
}

const cases = [
  {
    name: 'loading-results-exact-next-previous-cursors',
    async run(page, kind) {
      await submit(page, '  Indexed  ', 1);
      await screenshot(page, `${kind}-loading`);
      await settle(page, 1, 'first');
      await assertState(page, { query: 'Indexed', page: firstPage });
      await screenshot(page, `${kind}-results`);
      await button(page, 'Next').click();
      await request(page, 2, 'Indexed', { cursor: cursorOne });
      await assertState(page, { query: 'Indexed', loading: true, index: 1, cursors: [null, cursorOne] });
      await settle(page, 2, 'second');
      await assertState(page, { query: 'Indexed', index: 1, cursors: [null, cursorOne], page: secondPage });
      await button(page, 'Next').click();
      await request(page, 3, 'Indexed', { cursor: cursorTwo });
      await assertState(page, { query: 'Indexed', loading: true, index: 2, cursors: [null, cursorOne, cursorTwo] });
      await settle(page, 3, 'tail');
      await assertState(page, {
        query: 'Indexed', index: 2, cursors: [null, cursorOne, cursorTwo],
        page: { messages: messages(100, 1), nextCursor: null },
      });
      await button(page, 'Previous').click();
      await request(page, 4, 'Indexed', { cursor: cursorOne });
      await settle(page, 4, 'second');
      await assertState(page, { query: 'Indexed', index: 1, cursors: [null, cursorOne, cursorTwo], page: secondPage });
      await button(page, 'Previous').click();
      await request(page, 5, 'Indexed');
      await settle(page, 5, 'first');
      await assertState(page, { query: 'Indexed', cursors: [null, cursorOne, cursorTwo], page: firstPage });
      // Branching forward must discard any later cursor history.
      await button(page, 'Next').click();
      await request(page, 6, 'Indexed', { cursor: cursorOne });
      await settle(page, 6, 'second');
      await assertState(page, { query: 'Indexed', index: 1, cursors: [null, cursorOne], page: secondPage });
    },
  },
  {
    name: 'page-failure-retry-retains-query-and-cursor',
    async run(page, kind) {
      await submit(page, 'Indexed', 1);
      await settle(page, 1, 'first');
      await button(page, 'Next').click();
      await request(page, 2, 'Indexed', { cursor: cursorOne });
      await settle(page, 2, 'empty', 'reject');
      await assertState(page, { query: 'Indexed', error: true, index: 1, cursors: [null, cursorOne] });
      await expect(page.getByRole('textbox', { name: 'Search query', exact: true })).toHaveValue('Indexed');
      await screenshot(page, `${kind}-failure`);
      await button(page, 'Retry').click();
      await request(page, 3, 'Indexed', { cursor: cursorOne });
      assert.deepEqual((await json(page, 'IPC snapshot'))[2].input, (await json(page, 'IPC snapshot'))[1].input);
      await assertState(page, { query: 'Indexed', loading: true, index: 1, cursors: [null, cursorOne] });
      await settle(page, 3, 'second');
      await assertState(page, { query: 'Indexed', index: 1, cursors: [null, cursorOne], page: secondPage });
    },
  },
  {
    name: 'rejection-is-not-empty',
    async run(page, kind) {
      await submit(page, 'Indexed', 1);
      await settle(page, 1, 'empty', 'reject');
      await assertState(page, { query: 'Indexed', error: true });
      await button(page, 'Retry').click();
      await request(page, 2, 'Indexed');
      await assertState(page, { query: 'Indexed', loading: true });
      await settle(page, 2, 'empty');
      await assertState(page, { query: 'Indexed', page: { messages: [], nextCursor: null } });
      await screenshot(page, `${kind}-empty`);
    },
  },
  {
    name: 'non-advancing-cursor-is-retryable-failure',
    async run(page) {
      await submit(page, 'Indexed', 1);
      await settle(page, 1, 'first');
      await button(page, 'Next').click();
      await request(page, 2, 'Indexed', { cursor: cursorOne });
      await settle(page, 2, 'first');
      await assertState(page, { query: 'Indexed', error: true, index: 1, cursors: [null, cursorOne] });
      await button(page, 'Retry').click();
      await request(page, 3, 'Indexed', { cursor: cursorOne });
      await settle(page, 3, 'second');
      await assertState(page, { query: 'Indexed', index: 1, cursors: [null, cursorOne], page: secondPage });
    },
  },
  {
    name: 'new-query-resets-page-and-cursor',
    async run(page) {
      await submit(page, 'Indexed', 1);
      await settle(page, 1, 'first');
      await button(page, 'Next').click();
      await request(page, 2, 'Indexed', { cursor: cursorOne });
      await settle(page, 2, 'second');
      await submit(page, 'Latest', 3);
      await settle(page, 3);
      await assertState(page, { query: 'Latest', page: freshPage });
    },
  },
  {
    name: 'unauthenticated-search-fails-before-ipc',
    async run(page) {
      await page.getByRole('combobox', { name: 'Account', exact: true }).selectOption('none');
      await page.getByRole('textbox', { name: 'Search query', exact: true }).fill('Indexed');
      await button(page, 'Search').click();
      await assertState(page, { query: 'Indexed', error: true });
      assert.deepEqual(await json(page, 'IPC snapshot'), []);
    },
  },
];

for (const outcome of ['resolve', 'reject']) {
  for (const invalidate of ['blank', 'clear', 'close']) {
    cases.push({
      name: `${invalidate}-invalidates-pending-${outcome}`,
      async run(page) {
        await submit(page, 'Indexed', 1);
        if (invalidate === 'blank') {
          await page.getByRole('textbox', { name: 'Search query', exact: true }).fill('   ');
          await button(page, 'Search').click();
        } else {
          await button(page, invalidate === 'clear' ? 'Clear search' : 'Close search').click();
        }
        await assertState(page, {}, invalidate !== 'close');
        assert.equal((await json(page, 'IPC snapshot')).length, 1, 'Invalidation must not issue a search');
        await settle(page, 1, 'stale', outcome);
        await assertState(page, {}, invalidate !== 'close');
        if (invalidate === 'close') {
          await button(page, 'Open search').click();
          await assertState(page);
          assert.equal((await json(page, 'IPC snapshot')).length, 1, 'Reopening must not replay a search');
        }
        await submit(page, 'Indexed', 2);
        await settle(page, 2);
        await assertState(page, { query: 'Indexed', page: freshPage });
      },
    });
  }
  for (const ordering of ['old-first', 'latest-first']) {
    cases.push({
      name: `latest-query-fence-${ordering}-${outcome}`,
      async run(page) {
        await submit(page, 'Earlier', 1);
        await submit(page, 'Indexed', 2);
        if (ordering === 'old-first') {
          await settle(page, 1, 'stale', outcome);
          await assertState(page, { query: 'Indexed', loading: true });
        }
        await settle(page, 2);
        await assertState(page, { query: 'Indexed', page: freshPage });
        if (ordering === 'latest-first') {
          await settle(page, 1, 'stale', outcome);
          await assertState(page, { query: 'Indexed', page: freshPage });
        }
      },
    });
  }
  for (const replacement of ['account', 'session-object', 'conversation', 'kind']) {
    cases.push({
      name: `pending-${replacement}-replacement-${outcome}`,
      async run(page, kind) {
        const probe = page.getByRole('region', { name: 'Search probe', exact: true });
        const instance = await probe.getAttribute('data-instance');
        await submit(page, 'Indexed', 1);
        if (replacement === 'account') {
          await page.getByRole('combobox', { name: 'Account', exact: true }).selectOption('ptid:component-bob');
        } else if (replacement === 'session-object') {
          await button(page, 'Replace session object').click();
        } else {
          await page.getByRole('combobox', {
            name: replacement === 'conversation' ? 'Conversation' : 'Conversation kind', exact: true,
          }).selectOption(replacement === 'conversation' ? 'conversation-b' : kind === 'friend' ? 'group' : 'friend');
        }
        await expect(probe).toHaveAttribute('data-instance', instance);
        await assertState(page);
        assert.equal((await json(page, 'IPC snapshot')).length, 1, 'Scope replacement must not fetch');
        const conversationId = replacement === 'conversation' ? 'conversation-b' : 'conversation-a';
        await submit(page, 'Indexed', 2, {
          actor: replacement === 'account' ? 'bob' : 'alice', conversationId,
        });
        // Both requests have the same query; query-only fencing would be unsafe.
        await settle(page, 1, 'stale', outcome);
        await assertState(page, { query: 'Indexed', loading: true });
        await settle(page, 2);
        await assertState(page, {
          query: 'Indexed', page: { messages: messages(900, 1, conversationId), nextCursor: null },
        });
      },
    });
  }
  for (const completionTime of ['while-unmounted', 'after-remount']) {
    cases.push({
      name: `unmount-fence-${completionTime}-${outcome}`,
      async run(page) {
        const probe = page.getByRole('region', { name: 'Search probe', exact: true });
        const instance = await probe.getAttribute('data-instance');
        await submit(page, 'Indexed', 1);
        await button(page, 'Unmount search').click();
        await expect(probe).toHaveCount(0);
        if (completionTime === 'while-unmounted') await settle(page, 1, 'stale', outcome);
        await button(page, 'Mount search').click();
        await expect(probe).not.toHaveAttribute('data-instance', instance);
        await assertState(page);
        assert.equal((await json(page, 'IPC snapshot')).length, 1, 'Remount must not fetch');
        await submit(page, 'Indexed', 2);
        if (completionTime === 'after-remount') {
          await settle(page, 1, 'stale', outcome);
          await assertState(page, { query: 'Indexed', loading: true });
        }
        await settle(page, 2);
        await assertState(page, { query: 'Indexed', page: freshPage });
      },
    });
  }
}

let server;
let browser;
const results = [];
const harnessErrors = [];
const cleanup = { browserClosed: false, serverClosed: false };
try {
  server = await createServer({
    configFile: false,
    envFile: false,
    root: resolve(root, 'apps/mobile'),
    publicDir: false,
    cacheDir: resolve(output, 'vite-cache'),
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['scripts/fixtures/chat-history-search.tsx'] },
    plugins: [{
      name: 'chat-history-search-test-entry',
      configureServer(instance) {
        instance.middlewares.use((req, res, next) => {
          if (req.url !== entry) return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>Component-only search regression</title>
            <style>body{font:14px system-ui;margin:12px}h1{font-size:18px}label{display:inline-block;margin:4px}
            button,input,select{font:inherit;margin:4px;min-height:32px}pre{max-height:48px;overflow:auto;font-size:10px}
            fieldset{padding:4px}li{margin-bottom:4px}</style></head><body><div id="root"></div>
            <script type="module" src="/scripts/fixtures/chat-history-search.tsx"></script></body></html>`);
        });
      },
    }],
    server: { host: '127.0.0.1', port: 3265, strictPort: true, hmr: false, watch: null },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const kind of ['friend', 'group']) {
    for (const scenario of cases) {
      const result = { name: `${kind}/${scenario.name}`, status: 'FAIL', errors: [], blockedNetwork: [] };
      const context = await browser.newContext({
        viewport: { width: 390, height: 760 }, locale: 'en-US', reducedMotion: 'reduce', serviceWorkers: 'block',
      });
      let page;
      try {
        await context.route('**/*', async (route) => {
          const req = route.request();
          const url = new URL(req.url());
          if (url.origin !== origin || req.method() !== 'GET'
            || ['fetch', 'xhr', 'eventsource', 'websocket', 'ping'].includes(req.resourceType())
            || url.pathname.startsWith('/api/')) {
            result.blockedNetwork.push({ url: req.url(), method: req.method(), type: req.resourceType() });
            await route.abort('blockedbyclient');
          } else {
            await route.continue();
          }
        });
        await context.routeWebSocket('**/*', (socket) => {
          result.blockedNetwork.push({ url: socket.url(), type: 'websocket' });
          socket.close();
        });
        page = await context.newPage();
        page.setDefaultTimeout(6000);
        page.on('pageerror', (error) => result.errors.push(error.message));
        page.on('console', (message) => { if (message.type() === 'error') result.errors.push(message.text()); });
        await page.goto(`${origin}${entry}`, { waitUntil: 'load' });
        await page.getByRole('combobox', { name: 'Conversation kind', exact: true }).selectOption(kind);
        await assertState(page);
        assert.deepEqual(await json(page, 'IPC snapshot'), [], 'Mount must not invoke IPC');
        await scenario.run(page, kind);
        result.requests = await json(page, 'IPC snapshot');
        assert(result.requests.every((call) => call.status !== 'pending' && call.flushed), 'All IPC must settle');
        assert.deepEqual(await json(page, 'Unexpected IPC'), []);
        assert.deepEqual(await json(page, 'Projection keys'), {
          socialMessages: [], socialThreads: [],
        }, 'Indexed search must not hydrate runtime message projections');
        assert.deepEqual(result.blockedNetwork, [], 'API or external network was attempted');
        assert.deepEqual(result.errors, [], 'Browser errors must not be ignored');
        result.status = 'PASS';
      } catch (error) {
        result.failure = error instanceof Error ? error.message : String(error);
        if (page) {
          try {
            result.requests = await json(page, 'IPC snapshot');
            result.search = await json(page, 'Search snapshot');
            result.screenshot = `${kind}-${scenario.name}-failure.png`;
            await screenshot(page, `${kind}-${scenario.name}-failure`);
          } catch (diagnosticError) {
            result.errors.push(`Failure capture: ${String(diagnosticError)}`);
          }
        }
      } finally {
        try { await context.close(); } catch (error) { harnessErrors.push(`Context cleanup: ${String(error)}`); }
        results.push(result);
        process.stdout.write(
          `${result.status} ${result.name}${result.failure ? `: ${result.failure}` : ''}\n`,
        );
      }
    }
  }
  assert.deepEqual(await sourceHashes(), source.files, 'Tested sources changed during this run; evidence is invalid');
} catch (error) {
  harnessErrors.push(error instanceof Error ? error.stack : String(error));
} finally {
  try {
    await browser?.close();
    cleanup.browserClosed = true;
  } catch (error) {
    harnessErrors.push(`Browser cleanup: ${String(error)}`);
  } finally {
    try {
      await server?.close();
      cleanup.serverClosed = true;
    } catch (error) {
      harnessErrors.push(`Server cleanup: ${String(error)}`);
    }
  }
  const passed = results.filter((result) => result.status === 'PASS').length;
  const failed = results.length - passed;
  const planned = cases.length * 2;
  const report = {
    evidence: 'component-only',
    command,
    contract: 'docs/client/mobile/chat-layout-contract.md#12-bounded-history-and-restoration',
    plan: 'docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/tasks/W6A.md',
    boundary: 'React -> useChatHistorySearch -> dispatchSearchMessages -> messagingSearchMessages -> controlled Tauri invoke',
    notProven: ['real native index/cursor ordering', 'Station/API behavior', 'ChatPage product UI', 'native/device Acceptance'],
    source,
    counts: { planned, passed, failed, notRun: planned - results.length },
    cleanup,
    harnessErrors,
    results,
  };
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...report.counts, cleanup, harnessErrors, artifact: 'apps/mobile/src-tauri/target/search-interaction-browser/results.json' })}\n`);
  if (failed || harnessErrors.length || results.length !== planned) process.exitCode = 1;
}
