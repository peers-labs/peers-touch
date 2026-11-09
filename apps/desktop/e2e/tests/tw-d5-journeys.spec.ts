/**
 * TW-D5 exact-source Native Journey (tw-j05): device-held persistent
 * terminal sessions behind the Trae-style shell tab strip.
 *
 *  0. Activate a local project directory; opening the tab auto-starts an
 *     interactive shell pinned inside that root (zero-form entry).
 *  1. Start a long-running service inside the same root via the "+" custom
 *     command entry.
 *  2. Reach it over HTTP from the cell.
 *  3. Close the workbench viewer; the process stays alive.
 *  4. Reopen and reattach: the same session tab is still running.
 *  5. Closing the session tab kills the process and removes the Station row.
 *
 * The process is owned by the Rust worker; the tab strip is only a view.
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('missing ' + ${JSON.stringify(selector)});
          const proto = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
          if (proto && proto.set) proto.set.call(el, ${JSON.stringify(value)});
          else el.value = ${JSON.stringify(value)};
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

test('shell tabs stay alive when the viewer closes; closing a tab tears the process down', async ({ tauriPage: page }) => {
  for (let i = 0; i < 30; i += 1) {
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
    for (let i = 0; i < 30; i += 1) {
      if ((await page.evaluate(`document.querySelectorAll('[data-pt-primary-nav]').length`)) as number > 0) break;
      await sleep(1_000);
    }
  }
  await page.click('[data-pt-primary-nav="agent"] [role="button"]');
  await poll(page, `!!document.querySelector('[data-pt-agent-composer-input]')`, 60_000);
  await poll(
    page,
    `Array.from(document.querySelectorAll('[data-pt-agent-topic-row]')).some((el) => {
      const id = el.getAttribute('data-pt-agent-topic-row') || '';
      return id && !id.startsWith('draft:');
    })`,
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
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-d5-ws-'));
  await page.evaluate(`(() => window.__TAURI_INTERNALS__.invoke('agent_workspace_add_directory', { input: { path: ${JSON.stringify(localRoot)} } }))()`);
  await page.evaluate(`(() => window.__TAURI_INTERNALS__.invoke('agent_workspace_activate', { input: { locator: ${JSON.stringify(localRoot)} } }))()`);

  // ── Open a fresh terminal work surface ────────────────────────────────
  // A closed work area shows only the floating right-edge rail; its terminal
  // icon opens the panel with the terminal surface active.
  if (!(await page.evaluate(`!!document.querySelector('[data-pt-workbench-panel]')`))) {
    await page.click('[data-pt-workbench-rail-item="terminal"]');
    await poll(page, `!!document.querySelector('[data-pt-workbench-panel]')`, 5_000);
  }
  if (await page.evaluate(`!!document.querySelector('[data-pt-terminal-panel]')`)) {
    await page.click('[data-pt-workbench-close="terminal"]');
    await poll(page, `!document.querySelector('[data-pt-terminal-panel]')`, 10_000);
  }
  const launcherEntry = await page.evaluate(
    `!!document.querySelector('[data-pt-workbench-launcher] [data-pt-workbench-add="terminal"]')`,
  );
  if (launcherEntry) {
    await page.click('[data-pt-workbench-launcher] [data-pt-workbench-add="terminal"]');
  } else {
    await page.click('[data-pt-workbench-add-toggle]');
    await poll(page, `!!document.querySelector('[data-pt-workbench-add="terminal"]')`, 5_000);
    await page.click('[data-pt-workbench-add="terminal"]');
  }
  await poll(page, `!!document.querySelector('[data-pt-terminal-panel]')`, 10_000);

  // ── Zero-form entry: opening the tab auto-starts an interactive shell ──
  const autoShellId = await poll(
    page,
    `(() => {
      const tab = document.querySelector('[data-pt-terminal-session][data-pt-terminal-status="running"]');
      return tab ? tab.getAttribute('data-pt-terminal-session') : null;
    })()`,
    30_000,
  ) as string;
  const port = 18_000 + (Date.now() % 900);
  const marker = `d5${Date.now().toString(36).slice(-6)}`;
  const url = `http://127.0.0.1:${port}/`;

  // Custom commands live behind the tab-strip "+" menu.
  await page.click('[data-pt-terminal-add]');
  await poll(page, `!!document.querySelector('[data-pt-terminal-custom-toggle]')`, 5_000);
  await page.click('[data-pt-terminal-custom-toggle]');
  await poll(page, `!!document.querySelector('[data-pt-terminal-command]')`, 5_000);
  await setValue(page, '[data-pt-terminal-command]', 'sh');
  await setValue(
    page,
    '[data-pt-terminal-args]',
    `-c "mkdir -p ${marker} && cd ${marker} && echo ${url} && exec python3 -m http.server ${port}"`,
  );
  await page.click('[data-pt-terminal-start]');

  // ── The service gets its own shell tab, distinct from the auto shell ──
  const sessionId = await poll(
    page,
    `(() => {
      const tabs = Array.from(document.querySelectorAll('[data-pt-terminal-session][data-pt-terminal-status="running"]'));
      const next = tabs.find((tab) => tab.getAttribute('data-pt-terminal-session') !== ${JSON.stringify(autoShellId)});
      return next ? next.getAttribute('data-pt-terminal-session') : null;
    })()`,
    30_000,
  ) as string;

  // ── The service really serves from the device, pinned to the project ──
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

  // Station facts while the process is alive.
  const liveRow = await nodePoll(() => {
    const row = execSync(
      'docker exec -i pt-tw-d1-postgres-1 psql -U peers -d peers_touch_tw_d1 -t -A',
      {
        encoding: 'utf8',
        input: `SELECT status || '|' || pid::text || '|' || output_bytes::text || '|' || cwd
                 FROM agent_terminal_sessions WHERE id='${sessionId}'`,
      },
    ).trim();
    const [status, pid] = row.split('|');
    return status === 'running' && Number(pid) > 0 ? row : null;
  }, 20_000);
  const [liveStatus, livePid, liveOutputBytes, liveCwd] = liveRow.split('|');
  expect(liveStatus).toBe('running');
  expect(Number(livePid)).toBeGreaterThan(0);
  expect(Number(liveOutputBytes)).toBeGreaterThan(0);
  expect(liveCwd.startsWith(localRoot)).toBe(true);

  // ── Closing the viewer does not kill the process ──────────────────────
  await page.click('[data-pt-workbench-close="terminal"]');
  await poll(page, `!document.querySelector('[data-pt-terminal-panel]')`, 10_000);
  await sleep(1_500);
  expect(dockerExec(`curl -s -o /dev/null -w '%{http_code}' --max-time 3 ${url}`)).toBe('200');

  // ── Reattach: the same shell tab is still running ─────────────────────
  const launcherEntry = await page.evaluate(
    `!!document.querySelector('[data-pt-workbench-launcher] [data-pt-workbench-add="terminal"]')`,
  );
  if (launcherEntry) {
    await page.click('[data-pt-workbench-launcher] [data-pt-workbench-add="terminal"]');
  } else {
    await page.click('[data-pt-workbench-add-toggle]');
    await poll(page, `!!document.querySelector('[data-pt-workbench-add="terminal"]')`, 5_000);
    await page.click('[data-pt-workbench-add="terminal"]');
  }
  await poll(page, `!!document.querySelector('[data-pt-terminal-panel]')`, 10_000);
  const rowStatus = await poll(
    page,
    `(() => {
      const tab = document.querySelector('[data-pt-terminal-session="${sessionId}"]');
      return tab ? tab.getAttribute('data-pt-terminal-status') : null;
    })()`,
    15_000,
  ) as string;
  expect(rowStatus).toBe('running');
  // The service is still reachable through the reattached session.
  expect(dockerExec(`curl -s -o /dev/null -w '%{http_code}' --max-time 3 ${url}`)).toBe('200');

  // ── Station binding facts ─────────────────────────────────────────────
  const conversationBound = await psql(
    `SELECT count(*) FROM agent_terminal_sessions s
       JOIN agent_conversations c ON c.id = s.conversation_id
      WHERE s.id='${sessionId}' AND s.command='sh'`,
  );
  expect(conversationBound).toBe('1');

  // ── Closing the service tab kills the process and removes its row ─────
  await page.evaluate(`(() => {
      const close = document.querySelector('[data-pt-terminal-close="${sessionId}"]');
      if (close) (close.closest('button') || close).click();
    })()`);
  await poll(
    page,
    `!document.querySelector('[data-pt-terminal-session="${sessionId}"]')`,
    15_000,
  );
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
  const removed = await psql(`SELECT count(*) FROM agent_terminal_sessions WHERE id='${sessionId}'`);
  expect(removed).toBe('0');

  // ── Close the auto-started shell tab so the cell keeps no stray PTY ───
  await page.evaluate(`(() => {
      const close = document.querySelector('[data-pt-terminal-close="${autoShellId}"]');
      if (close) (close.closest('button') || close).click();
    })()`);
  await poll(
    page,
    `!document.querySelector('[data-pt-terminal-session="${autoShellId}"]')`,
    15_000,
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
    pid: livePid,
    httpStatus,
    dbRow: liveRow,
  });
});
