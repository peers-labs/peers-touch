/**
 * TW-D6 exact-source Native Journey (tw-j06-browser-embedded):
 *
 * One headless managed Chrome (CDP host) is shared by both control planes:
 *
 * 1. The human opens a normal-looking browser tab in the workbench; the panel
 *    renders a live screencast of the real page (frame img, no OS window).
 * 2. The agent plane (CDP tools, invoked directly) observes, fills and
 *    submits a real local form; the frame follows the navigation.
 * 3. The human plane acts INSIDE the panel: Playwright pointer/keyboard on
 *    the frame element are forwarded through CDP Input to the same Page.
 * 4. The agent re-observes the human-made state; old snapshot generations are
 *    rejected as stale; an agent screenshot proves the final page.
 * 5. Closing the last tab tears Chrome down and removes the Station row.
 */
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { TauriPage } from '@srsholmes/tauri-playwright';
import { createTauriTest } from '@srsholmes/tauri-playwright';

const { test, expect } = createTauriTest({
  mcpSocket: process.env.PT_PLAYWRIGHT_SOCKET || '/tmp/tw-d1.sock',
  devUrl: '',
});

const STATION_URL = process.env.PT_STATION_URL || 'http://127.0.0.1:18092';
const EMAIL = process.env.AGENT_TEST_EMAIL || 'agent-test-a@p.t';
const PASSWORD = process.env.AGENT_TEST_PASSWORD || 'Test-1234';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(specDir, '../../../../tooling/acceptance/reports/task-workbench');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function psql(query: string): Promise<string> {
  return execSync('docker exec -i pt-tw-d1-postgres-1 psql -U peers -d peers_touch_tw_d1 -t -A', {
    encoding: 'utf-8',
    input: query,
  }).trim();
}

function dockerExec(args: string): string {
  return execSync(`docker exec tw-d1-cell ${args}`, { encoding: 'utf8' }).trim();
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

async function asyncPoll<T>(fn: () => Promise<T | null>, timeoutMs = 30_000, tickMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(tickMs);
  }
  throw new Error(`async poll timeout (${timeoutMs}ms) last=${String(lastError)}`);
}

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

// Agent-plane CDP tools are internal capabilities, not panel buttons: the
// gate invokes the Tauri worker commands directly.
async function invoke<T>(page: TauriPage, command: string, input: Record<string, unknown>): Promise<T> {
  const raw = await page.evaluate(
    `(async () => {
      const inv = window.__TAURI_INTERNALS__?.invoke || window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
      const result = await inv(${JSON.stringify(command)}, { input: ${JSON.stringify(input)} });
      return JSON.stringify(result);
    })()`,
  ) as string;
  const parsed = JSON.parse(raw) as { data?: T; error?: string };
  if (parsed.error) throw new Error(parsed.error);
  return parsed.data as T;
}

interface InvokeTab {
  tabId: string;
  generation: number;
  url: string;
  title: string;
}
interface InvokeElement {
  ref: string;
  tag: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface InvokeSnapshot {
  tab: InvokeTab;
  text: string;
  elements: InvokeElement[];
}

test('agent tools and human panel input share one real browser page', async ({ tauriPage: page }) => {
  for (let i = 0; i < 30; i += 1) {
    if ((await page.evaluate('document.querySelectorAll(\'[data-pt-primary-nav]\').length>0')) as number > 0) break;
    await sleep(1_000);
  }
  if ((await page.evaluate('!!document.querySelector(\'[data-pt-login-tab="email"]\')')) as boolean) {
    if ((await page.evaluate('!!document.querySelector(\'[data-login-tab="email"]\')')) as boolean) {
      await page.click('[data-login-tab="email"]');
    }
    await setValue(page, '[data-login-email]', EMAIL);
    await page.fill('[data-login-password]', PASSWORD);
    await page.click('[data-login-submit]');
    await poll(page, `!!document.querySelector('[data-pt-primary-nav]')`, 60_000);
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

  // Deterministic cell: no browser from an earlier run, no stale truth rows.
  dockerExec(`sh -c "pkill -f '[c]hrome/chrome' 2>/dev/null || true; sleep 1; rm -rf /workspace/run/actor-home/.local/share/peers-touch/browser-sessions/brows-* 2>/dev/null; true"`);
  await psql(`DELETE FROM agent_browser_sessions;`);

  // ── Serve a real local site inside the cell ──────────────────────────
  const marker = `d6${Date.now().toString(36).slice(-6)}`;
  const port = 18_000 + (Date.now() % 900);
  const url = `http://127.0.0.1:${port}/`;
  const indexHtml = `<!doctype html><html><body>
    <h1 id="brand">D6 Portal ${marker}</h1>
    <form id="searchform" action="page2.html" method="get">
      <input id="q" name="q" placeholder="Search terms" aria-label="Search terms" />
      <button type="submit" id="searchbtn">Search</button>
    </form></body></html>`;
  const page2Html = `<!doctype html><html><body>
    <h1 id="result-title">Results</h1>
    <div id="query"></div>
    <label for="statebox">Account state</label>
    <input id="statebox" name="statebox" placeholder="State" aria-label="State" />
    <input type="checkbox" id="humanbox" aria-label="Confirmed by human" />
    <button id="savebtn" type="button">Save state</button>
    <div id="statediv">unsaved</div>
    <script>
      const p = new URLSearchParams(location.search);
      document.getElementById('query').textContent = 'query=' + (p.get('q') || '');
      document.getElementById('savebtn').addEventListener('click', () => {
        document.getElementById('statediv').textContent =
          'saved:' + document.getElementById('statebox').value + ':' +
          (document.getElementById('humanbox').checked ? 'checked' : 'unchecked');
      });
    </script></body></html>`;
  const b64index = Buffer.from(indexHtml).toString('base64');
  const b64page2 = Buffer.from(page2Html).toString('base64');
  dockerExec(`sh -c "mkdir -p /tmp/${marker} && echo ${b64index} | base64 -d > /tmp/${marker}/index.html && echo ${b64page2} | base64 -d > /tmp/${marker}/page2.html && (cd /tmp/${marker} && nohup python3 -m http.server ${port} >/tmp/${marker}.log 2>&1 &) && sleep 1"`);
  expect(dockerExec(`curl -s -o /dev/null -w '%{http_code}' --max-time 3 ${url}`)).toBe('200');

  // ── Start the browser session from the normal browser UI ─────────────
  // A closed work area exposes the floating vertical rail (direct entry);
  // an open work area without a browser tab uses the header "+" menu.
  if (!(await page.evaluate(`!!document.querySelector('[data-pt-browser-panel]')`))) {
    const railEntry = await page.evaluate(
      `!!document.querySelector('[data-pt-workbench-rail-item="browser"]')`,
    );
    if (railEntry) {
      await page.click('[data-pt-workbench-rail-item="browser"]');
    } else {
      await page.click('[data-pt-workbench-add-toggle]');
      await poll(page, `!!document.querySelector('[data-pt-workbench-add="browser"]')`, 5_000);
      await page.click('[data-pt-workbench-add="browser"]');
    }
  }
  await poll(page, `!!document.querySelector('[data-pt-browser-start-form]')`, 10_000);
  expect(await page.evaluate(`!!document.querySelector('[data-pt-browser-unavailable]')`)).toBe(false);
  await setValue(page, '[data-pt-browser-start-url]', url);
  await page.click('[data-pt-browser-start]');

  const sessionId = await asyncPoll(async () => {
    const list = await invoke<{ sessionId: string; status: string }[]>(
      page,
      'browser_session_list',
      {},
    );
    const first = list[0];
    return first && /^brows-[0-9A-Z]{26}$/.test(first.sessionId) ? first.sessionId : null;
  }, 45_000);
  expect(sessionId).toMatch(/^brows-[0-9A-Z]{26}$/);

  // ── Live screencast: the real page renders inside the panel ──────────
  const frameSrc = await poll(
    page,
    `(() => {
      const img = document.querySelector('[data-pt-browser-frame-img]');
      return img && (img.getAttribute('src') || '').startsWith('data:image/jpeg;base64,')
        ? img.getAttribute('src')
        : null;
    })()`,
    30_000,
  ) as string;
  expect(frameSrc.length).toBeGreaterThan(1000);
  // Address bar follows the started URL.
  await poll(page, `(document.querySelector('[data-pt-browser-url]')?.value || '').includes('${port}')`, 10_000);
  const firstList = await invoke<{ tabs: InvokeTab[] }[]>(page, 'browser_session_list', {});
  const tabId = firstList[0].tabs[0].tabId;

  // ── Agent plane: observe, fill, submit, observe result ───────────────
  const firstSnap = await invoke<InvokeSnapshot>(page, 'browser_snapshot', { sessionId, tabId });
  expect(firstSnap.text).toContain(`D6 Portal ${marker}`);
  const searchInput = firstSnap.elements.find((el) => el.name.includes('Search terms'));
  const searchButton = firstSnap.elements.find((el) => el.name === 'Search');
  expect(searchInput).toBeTruthy();
  expect(searchButton).toBeTruthy();
  const generationBefore = Number(searchInput!.ref.split('-')[0].slice(1));
  await invoke(page, 'browser_fill', {
    sessionId,
    tabId,
    elementRef: searchInput!.ref,
    value: `query-${marker}`,
  });
  await invoke(page, 'browser_submit', { sessionId, tabId, elementRef: searchButton!.ref });
  await poll(
    page,
    `(document.querySelector('[data-pt-browser-url]')?.value || '').includes('page2.html')`,
    15_000,
  );
  await asyncPoll(async () => {
    const snap = await invoke<InvokeSnapshot>(page, 'browser_snapshot', { sessionId, tabId });
    return snap.text.includes(`query=query-${marker}`) ? snap : null;
  }, 15_000);
  const resultSnap = await invoke<InvokeSnapshot>(page, 'browser_snapshot', { sessionId, tabId });
  expect(resultSnap.text).toContain(`query=query-${marker}`);

  // ── Human plane: pointer + keyboard inside the streamed frame ────────
  // The frame is letterboxed (object-fit: contain) inside the container, so
  // map remote coordinates through the displayed content rect.
  const contentRect = await page.evaluate(`JSON.stringify((() => {
    const img = document.querySelector('[data-pt-browser-frame-img]');
    const box = document.querySelector('[data-pt-browser-frame]').getBoundingClientRect();
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    return {
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
      width,
      height,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    };
  })())`) as string;
  const box = JSON.parse(contentRect) as {
    x: number; y: number; width: number; height: number;
    naturalWidth: number; naturalHeight: number;
  };
  const byName = (name: string) => resultSnap.elements.find((el) => el.name.includes(name));
  const stateBox = byName('State');
  const checkbox = byName('Confirmed by human');
  const saveButton = resultSnap.elements.find((el) => el.name === 'Save state');
  expect(stateBox && checkbox && saveButton).toBeTruthy();
  const clickRemote = (el: InvokeElement) =>
    page.mouse.click(
      box.x + (el.x / box.naturalWidth) * box.width,
      box.y + (el.y / box.naturalHeight) * box.height,
    );
  await clickRemote(stateBox!);
  await sleep(300);
  await page.keyboard.type(`human-${marker}`, { delay: 20 });
  await sleep(300);
  await clickRemote(checkbox!);
  await sleep(200);
  await clickRemote(saveButton!);
  await sleep(800);

  // ── Agent re-observes the state the human created in the same Page ────
  const humanSnap = await asyncPoll(async () => {
    const snap = await invoke<InvokeSnapshot>(page, 'browser_snapshot', { sessionId, tabId });
    return snap.text.includes(`saved:human-${marker}:checked`) ? snap : null;
  }, 15_000);
  expect(humanSnap.text).toContain(`saved:human-${marker}:checked`);

  // ── Old observation generations must be rejected (contract, not UI) ───
  const staleRef = `g${generationBefore}-e0`;
  let staleGate = 'ui-only';
  try {
    await invoke(page, 'browser_click', { sessionId, tabId, elementRef: staleRef });
    staleGate = 'unexpected-ok';
  } catch (error) {
    expect(String(error)).toMatch(/older observation|STALE|conflict|Conflict/i);
    staleGate = 'rejected';
  }
  expect(staleGate).toBe('rejected');

  // ── Agent screenshot proves the final page bytes ─────────────────────
  const shot = await invoke<{ mime: string; dataB64: string }>(page, 'browser_screenshot', {
    sessionId,
    tabId,
  });
  expect(shot.mime).toBe('image/png');
  const pngBytes = Buffer.from(shot.dataB64, 'base64');
  expect(pngBytes.length).toBeGreaterThan(3000);
  expect(pngBytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const sha = createHash('sha256').update(pngBytes).digest('hex');

  // ── Station facts ────────────────────────────────────────────────────
  const dbRow = await psql(`SELECT status || '|' || lease || '|' || (engine <> '') || '|' || length(tabs_json) || '|' || conversation_id FROM agent_browser_sessions WHERE id='${sessionId}';`);
  expect(dbRow.endsWith(`|${conversationId}`)).toBe(true);
  const [dbStatus, dbLease, engineProven, tabsLen] = dbRow.split('|');
  expect(dbStatus).toBe('active');
  expect(dbLease).toBe('agent');
  expect(engineProven).toBe('true');
  expect(Number(tabsLen)).toBeGreaterThan(0);

  // ── Closing the only tab ends the session: process and metadata gone ──
  await page.click(`[data-pt-browser-tab-close="${tabId}"]`);
  await poll(page, `!!document.querySelector('[data-pt-browser-start-form]')`, 20_000);
  const removed = await psql(`SELECT count(*) FROM agent_browser_sessions WHERE id='${sessionId}';`);
  expect(removed).toBe('0');
  const chromeProcs = dockerExec(`pgrep -f 'user-data-dir=.*/browser-sessions/${sessionId}' | wc -l`);
  expect(chromeProcs.trim()).toBe('0');

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, 'tw-d6-journey.json'),
    JSON.stringify({
      schemaVersion: 1,
      artifactKind: 'tw-d6-embedded-journey',
      journeyId: 'tw-d6-journey',
      commit: process.env.PT_EVIDENCE_COMMIT || 'unknown',
      stationUrl: STATION_URL,
      recordedAt: new Date().toISOString(),
      marker,
      port,
      sessionId,
      conversationId,
      url,
      humanState: `saved:human-${marker}:checked`,
      frame: { bytes: Math.floor(frameSrc.length * 0.75), kind: 'jpeg' },
      screenshot: { bytes: pngBytes.length, sha256: sha },
      staleRefGate: staleGate,
      dbRow,
    }, null, 2),
  );
});
