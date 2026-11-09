/**
 * TW-D5 exact-source Native Journey (tw-j05): device-held persistent
 * terminal sessions.
 *
 *  0. Activate a local project directory; opening the tab auto-starts an
 *     interactive shell pinned inside that root (zero-form entry).
 *  1. Start a long-running service inside the same root via the custom form.
 *  2. Reach it over HTTP from the cell.
 *  3. Close the viewer; the process stays alive.
 *  4. Reopen and reattach: same session/pid, replayed output, URL action.
 *  5. Kill and read back exit status; remove metadata, including the auto shell.
 *
 * The process is owned by the Rust worker; the Page is only a subscriber.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import type { TauriPage } from '@srsholmes/tauri-playwright';
import { createTauriTest } from '@srsholmes/tauri-playwright';

const { test, expect } = createTauriTest({
  mcpSocket: process.env.PT_PLAYWRIGHT_SOCKET || '/tmp/tw-d1.sock',
  devUrl: '',
});

const SOCKET = process.env.PT_PLAYWRIGHT_SOCKET || '/tmp/tw-d1.sock';
const STATION_URL = process.env.PT_STATION_URL || 'http://127.0.0.1:18092';
const EMAIL = process.env.AGENT_TEST_EMAIL || 'agent-test-a@p.t';
const PASSWORD = process.env.AGENT_TEST_PASSWORD || 'Test-1234';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dir, '../../../../tooling/acceptance/reports/task-workbench');
function writeEvidence(id: string, payload: Record<string, unknown>): void {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, `${id}.json`), JSON.stringify({
    schemaVersion: 1,
    artifactKind: 'tw-d5-native-journey',
    journeyId: id,
    commit: process.env.PT_EVIDENCE_COMMIT || 'unknown',
    stationUrl: STATION_URL,
    recordedAt: new Date().toISOString(),
    ...payload,
  }, null, 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function psql(query: string): Promise<string> {
  return execSync(
    'docker exec -i pt-tw-d1-postgres-1 psql -U peers -d peers_touch_tw_d1 -t -A',
    { encoding: 'utf8', input: query },
  ).trim();
}

function dockerExec(args: string): string {
  return execSync(`docker exec tw-d1-cell ${args}`, { encoding: 'utf8' }).trim();
}

async function nodePoll<T>(
  fn: () => T | null | undefined | false | '',
  timeoutMs = 30_000,
  tickMs = 1_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null | undefined | false | '' = null;
  while (Date.now() < deadline) {
    last = fn();
    if (last !== null && last !== undefined && last !== '' && last !== false) return last as T;
    await sleep(tickMs);
  }
  throw new Error(`node poll timeout (${timeoutMs}ms) last=${String(last)}`);
}

const poll = async <T>(page: TauriPage, fn: string, timeoutMs = 120_000, tickMs = 1_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    // The bridge evaluates synchronously: an async wrapper would make
    // JSON.stringify see a pending Promise and always return "{}", which
    // passes the truthy gate as a false positive. Keep fns synchronous.
    const raw = await page.evaluate(`JSON.stringify((()=>{try{return (${fn})}catch(e){return {__error:String(e)}}})())`);
    const value = JSON.parse(raw) as T;
    if (value && typeof value === 'object' && '__error' in value) {
      last = String((value as { __error: string }).__error);
      await sleep(tickMs);
      continue;
    }
    if (value !== null && value !== undefined && value !== '' && value !== false) return value;
    await sleep(tickMs);
  }
  throw new Error(`poll timeout (${timeoutMs}ms) ${fn.slice(0, 160)} last=${last}`);
};

async function setValue(page: TauriPage, selector: string, value: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('missing ' + ${JSON.stringify(selector)});
          const proto = el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
          descriptor.set.call(el, ${JSON.stringify(value)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await sleep(10_000);
    }
  }
}

test('files and commands stay alive when the viewer closes', async ({ tauriPage: page }) => {
  for (let i = 0; i < 30; i++) {
    if ((await page.evaluate(`document.querySelectorAll('[data-pt-primary-nav]').length`)) as number > 0) break;
    await sleep(1_000);
  }
  if ((await page.evaluate(`document.querySelectorAll('[data-pt-primary-nav]').length`)) as number === 0) {
    if ((await page.evaluate(`!!document.querySelector('[data-login-tab="email"]')`)) as boolean) {
      await page.click('[data-login-tab="email"]');
      await page.fill('[data-login-email]', EMAIL);
      await page.fill('[data-login-password]', PASSWORD);
      await page.click('[data-login-submit]');
    }
    for (let i = 0; i < 30; i++) {
      if ((await page.evaluate(`document.querySelectorAll('[data-pt-primary-nav]').length`)) as number > 0) break;
      await sleep(1_000);
    }
  }
  await page.click('[data-pt-primary-nav="agent"] [role="button"]');
  await poll(page, `!!document.querySelector('[data-pt-agent-composer-input]')`, 60_000);
  // Bind to an existing Station conversation (draft topics have no Station
  // row until their first turn).
  await poll(
    page,
    `Array.from(document.querySelectorAll('[data-pt-agent-topic-row]')).some((el) => {
      const id = el.getAttribute('data-pt-agent-topic-row') || '';
      return id && !id.startsWith('draft:');
    })`,
    // The sidebar hydrates persisted topics on its own Station poll after a
    // cold identity restore; wait for the real list instead of a fixed guess.
    120_000,
  );
  const conversationId = await page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('[data-pt-agent-topic-row]'));
      const target = items.find((el) => {
        const id = el.getAttribute('data-pt-agent-topic-row') || '';
        return id && !id.startsWith('draft:');
      });
      if (!target) throw new Error('no persisted conversation available');
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return target.getAttribute('data-pt-agent-topic-row');
    })()`) as string;
  await poll(page, `!!document.querySelector('[data-pt-agent-composer-input]')`, 15_000);

  // ── Bind the task to a LOCAL project directory ────────────────────────
  // Terminal placement is derived from the task workspace: an activated
  // local root drives the device worker; without one the auto shell would
  // open in the remote Station sandbox. This gate proves the device path.
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-d5-ws-'));
  await page.evaluate(`(() => window.__TAURI_INTERNALS__.invoke('agent_workspace_add_directory', { input: { path: ${JSON.stringify(localRoot)} } }))()`);
  await page.evaluate(`(() => window.__TAURI_INTERNALS__.invoke('agent_workspace_activate', { input: { locator: ${JSON.stringify(localRoot)} } }))()`);

  // ── Start a persistent service ────────────────────────────────────────
  // Tools open from the workbench "+" menu. Reset any terminal tab left by an
  // earlier failed run, then open a fresh one bound to this conversation.
  if (await page.evaluate(`!!document.querySelector('[data-pt-terminal-panel-title]')`)) {
    await page.click('[data-pt-workbench-close="terminal"]');
    await poll(page, `!document.querySelector('[data-pt-terminal-panel-title]')`, 10_000);
  }
  await page.click('[data-pt-workbench-add-toggle]');
  await poll(page, `!!document.querySelector('[data-pt-workbench-add="terminal"]')`, 5_000);
  await page.click('[data-pt-workbench-add="terminal"]');
  await poll(page, `!!document.querySelector('[data-pt-terminal-panel-title]')`, 10_000);

  // ── Zero-form entry: opening the tab auto-starts an interactive shell ──
  // With a local project active the auto shell lands inside that exact root.
  const autoShellId = await poll(
    page,
    `(() => {
      const row = document.querySelector('[data-pt-terminal-session][data-pt-terminal-status="running"]');
      return row ? row.getAttribute('data-pt-terminal-session') : null;
    })()`,
    30_000,
  ) as string;
  await poll(
    page,
    `(() => {
      const root = document.querySelector('[data-pt-terminal-placement-root]')?.textContent || '';
      const cwd = document.querySelector('[data-pt-terminal-cwd]')?.textContent || '';
      return root.includes(${JSON.stringify(localRoot)}) && cwd.includes(${JSON.stringify(localRoot)}) ? cwd : null;
    })()`,
    15_000,
  );
  await sleep(500);
  const port = 18_000 + (Date.now() % 900);
  const marker = `d5${Date.now().toString(36).slice(-6)}`;
  const url = `http://127.0.0.1:${port}/`;
  // Custom commands live behind the collapsed advanced entry.
  await page.click('[data-pt-terminal-custom-toggle]');
  await poll(page, `!!document.querySelector('[data-pt-terminal-command]')`, 10_000);
  await setValue(page, '[data-pt-terminal-command]', 'sh');
  await setValue(
    page,
    '[data-pt-terminal-args]',
    `-c "mkdir -p ${marker} && cd ${marker} && echo ${url} && exec python3 -m http.server ${port}"`,
  );
  await page.click('[data-pt-terminal-start]');

  // ── Running session with a live pid ───────────────────────────────────
  // The auto shell already occupies one row; select the newly started sh
  // service row explicitly instead of whichever row happens to be first.
  const sessionId = await poll(
    page,
    `(() => {
      const rows = Array.from(document.querySelectorAll('[data-pt-terminal-session][data-pt-terminal-status="running"]'));
      const next = rows.find((row) => row.getAttribute('data-pt-terminal-session') !== ${JSON.stringify(autoShellId)});
      return next ? next.getAttribute('data-pt-terminal-session') : null;
    })()`,
    30_000,
  ) as string;
  const pidBefore = await poll(
    page,
    `(() => {
      const pid = document.querySelector('[data-pt-terminal-pid]')?.textContent || '';
      const match = pid.match(/(\\d+)/);
      return match && match[1] !== '0' ? match[1] : null;
    })()`,
    10_000,
  ) as string;
  expect(pidBefore).toMatch(/^\d+$/);

  // Output subscription + URL detection (echo happens before exec).
  await poll(page, `!!document.querySelector('[data-pt-terminal-open-url="${url}"]')`, 15_000);

  // Exercise the open action; headless cell has no browser, the handler is
  // fail-safe and the button is the product surface for Preview/Browser.
  await page.evaluate(`(() => {
      const btn = document.querySelector('[data-pt-terminal-open-url="${url}"]');
      if (btn) btn.click();
    })()`);

  // ── The service really serves from the device ─────────────────────────
  const httpStatus = await nodePoll(
    () => {
      try {
        const code = dockerExec(`curl -s -o /dev/null -w '%{http_code}' --max-time 3 ${url}`);
        return code === '200' ? code : null;
      } catch {
        return null;
      }
    },
    30_000,
    2_000,
  );
  expect(httpStatus).toBe('200');

  // ── Closing the viewer does not kill the process ──────────────────────
  await page.evaluate(`(() => {
      const close = document.querySelector('[data-pt-terminal-close]')?.closest('button');
      if (close) close.click();
    })()`);
  await poll(page, `!document.querySelector('[data-pt-terminal-panel-title]')`, 10_000);
  await sleep(1_500);
  expect(dockerExec(`curl -s -o /dev/null -w '%{http_code}' --max-time 3 ${url}`)).toBe('200');

  // ── Reattach: same session, same pid, replayed history ────────────────
  await page.click('[data-pt-workbench-add-toggle]');
  await poll(page, `!!document.querySelector('[data-pt-workbench-add="terminal"]')`, 5_000);
  await page.click('[data-pt-workbench-add="terminal"]');
  await poll(page, `!!document.querySelector('[data-pt-terminal-panel-title]')`, 10_000);
  const rowStatus = await poll(
    page,
    `(() => {
      const row = document.querySelector('[data-pt-terminal-session="${sessionId}"]');
      return row ? row.getAttribute('data-pt-terminal-status') : null;
    })()`,
    15_000,
  ) as string;
  expect(rowStatus).toBe('running');
  const pidAfter = await poll(
    page,
    `(() => {
      const pid = document.querySelector('[data-pt-terminal-pid]')?.textContent || '';
      const match = pid.match(/(\\d+)/);
      return match ? match[1] : null;
    })()`,
    10_000,
  ) as string;
  expect(pidAfter).toBe(pidBefore);
  // Replayed output re-derives the URL action after reattachment.
  await poll(page, `!!document.querySelector('[data-pt-terminal-open-url="${url}"]')`, 15_000);

  // ── Kill and read terminal status back ────────────────────────────────
  await page.click(`[data-pt-terminal-kill="${sessionId}"]`);
  await poll(
    page,
    `(() => {
      const row = document.querySelector('[data-pt-terminal-session="${sessionId}"]');
      return row && row.getAttribute('data-pt-terminal-status') === 'killed' ? true : null;
    })()`,
    20_000,
  );
  await poll(page, `!!document.querySelector('[data-pt-terminal-exit-code]')`, 10_000);
  await sleep(2_000);
  // The service is gone after kill.
  let serviceDown = false;
  for (let i = 0; i < 10; i += 1) {
    try {
      dockerExec(`curl -s -o /dev/null -w '%{http_code}' --max-time 2 ${url}`);
    } catch {
      serviceDown = true;
      break;
    }
    await sleep(1_000);
  }
  expect(serviceDown).toBe(true);

  // ── Station facts: metadata, binding and honest status ────────────────
  const dbRow = await psql(
    `SELECT status || '|' || pid::text || '|' || output_bytes::text || '|' || cwd
       FROM agent_terminal_sessions WHERE id='${sessionId}'`,
  );
  const [dbStatus, dbPid, dbOutputBytes, dbCwd] = dbRow.split('|');
  expect(dbStatus).toBe('killed');
  expect(Number(dbPid)).toBeGreaterThan(0);
  expect(Number(dbOutputBytes)).toBeGreaterThan(0);
  // Device PTY is pinned inside the activated local project root.
  expect(dbCwd.startsWith(localRoot)).toBe(true);
  const conversationBound = await psql(
    `SELECT count(*) FROM agent_terminal_sessions s
       JOIN agent_conversations c ON c.id = s.conversation_id
      WHERE s.id='${sessionId}' AND s.command='sh'`,
  );
  expect(conversationBound).toBe('1');

  // ── Remove metadata ───────────────────────────────────────────────────
  await page.click(`[data-pt-terminal-remove="${sessionId}"]`);
  await poll(
    page,
    `!document.querySelector('[data-pt-terminal-session="${sessionId}"]')`,
    10_000,
  );
  const removed = await psql(`SELECT count(*) FROM agent_terminal_sessions WHERE id='${sessionId}'`);
  expect(removed).toBe('0');

  // ── Clean up the auto-started shell so the cell keeps no stray PTY ─────
  await page.click(`[data-pt-terminal-kill="${autoShellId}"]`);
  await poll(
    page,
    `(() => {
      const row = document.querySelector('[data-pt-terminal-session="${autoShellId}"]');
      return row && row.getAttribute('data-pt-terminal-status') === 'killed' ? true : null;
    })()`,
    20_000,
  );
  await page.click(`[data-pt-terminal-remove="${autoShellId}"]`);
  await poll(
    page,
    `!document.querySelector('[data-pt-terminal-session="${autoShellId}"]')`,
    10_000,
  );
  const autoRemoved = await psql(
    `SELECT count(*) FROM agent_terminal_sessions WHERE id='${autoShellId}'`,
  );
  expect(autoRemoved).toBe('0');

  // ── Restore the task workspace to the remote-sandbox default ──────────
  await page.evaluate(`(() => window.__TAURI_INTERNALS__.invoke('agent_workspace_activate', { input: { locator: null } }))()`);
  await page.evaluate(`(() => window.__TAURI_INTERNALS__.invoke('agent_workspace_remove', { input: { locator: ${JSON.stringify(localRoot)} } }))()`);
  fs.rmSync(localRoot, { recursive: true, force: true });

  writeEvidence('tw-d5-journey', {
    marker,
    port,
    sessionId,
    autoShellId,
    localRoot,
    pid: pidBefore,
    httpStatus,
    dbRow,
  });
});
