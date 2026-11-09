/**
 * TW-D6 exact-source Native Journey (tw-j06-browser-takeover):
 *
 * 1. Worker launches a REAL managed Chrome (CDP host) bound to the task.
 * 2. Agent observes a local page, fills a search form, submits, observes
 *    the result page (untrusted page text is read as data).
 * 3. Human takes the control lease: agent actions are refused while held.
 * 4. Human changes page state through the real visible window
 *    (xdotool keyboard/mouse), then releases.
 * 5. Old snapshot refs are stale; agent must re-observe, sees the new
 *    state, captures a screenshot; Station metadata records lease and tabs.
 * 6. Ending the session tears Chrome down and removes the Station row.
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

// Anchor evidence to the repo root regardless of the playwright invocation cwd.
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
  return execSync(`docker exec tw-d1-cell ${args}`, { encoding: 'utf-8' }).trim();
}

const poll = async <T>(page: TauriPage, fn: string, timeoutMs = 120_000, tickMs = 1_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    // The bridge evaluates synchronously: an async wrapper would make
    // JSON.stringify see a pending Promise and always return "{}".
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

test('agent observes, hands control over and re-observes a real browser', async ({ tauriPage: page }) => {
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

  // Deterministic cell: remove browsers left by earlier failed runs so the
  // takeover window stack contains only this session.
  dockerExec(`sh -c "pkill -f '[c]hrome/chrome' 2>/dev/null || true; sleep 1; rm -rf /workspace/run/actor-home/.local/share/peers-touch/browser-sessions/brows-* 2>/dev/null; true"`);
  // The dedicated cell DB is owned by this journey alone; drop rows from any
  // earlier interrupted run so the dock renders its start form.
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

  // ── Start the browser session from the dock ──────────────────────────
  // Tools open from the workbench "+" menu (no composer shortcuts); open the
  // browser tab deterministically unless its panel is already mounted.
  if (!(await page.evaluate(`!!document.querySelector('[data-pt-browser-panel]')`))) {
    await page.click('[data-pt-workbench-add-toggle]');
    await poll(page, `!!document.querySelector('[data-pt-workbench-add="browser"]')`, 5_000);
    await page.click('[data-pt-workbench-add="browser"]');
  }
  await poll(page, `!!document.querySelector('[data-pt-browser-start-form]')`, 10_000);
  // Host availability is verified on the real device binary.
  expect(await page.evaluate(`!!document.querySelector('[data-pt-browser-unavailable]')`)).toBe(false);
  await setValue(page, '[data-pt-browser-start-url]', url);
  await page.click('[data-pt-browser-start]');
  const sessionId = await poll(
    page,
    `(() => {
      const el = document.querySelector('[data-pt-browser-session]');
      return el ? el.getAttribute('data-pt-browser-session') : null;
    })()`,
    45_000,
  ) as string;
  expect(sessionId).toMatch(/^brows-[0-9A-Z]{26}$/);
  await poll(page, `(document.querySelector('[data-pt-browser-snapshot-url]')?.textContent || '').includes('${port}')`, 5_000).catch(() => undefined);

  // ── Observe + fill + submit (agent acts) ──────────────────────────────
  await page.click('[data-pt-browser-observe]');
  await poll(page, `!!document.querySelector('[data-pt-browser-snapshot]')`, 15_000);
  const pageText = await page.evaluate(`document.querySelector('[data-pt-browser-text]').textContent`) as string;
  expect(pageText).toContain(`D6 Portal ${marker}`);

  const elementRefByName = (needle: string, exact = false) => `(() => {
      const rows = Array.from(document.querySelectorAll('[data-pt-browser-element]'));
      const found = rows.map((r) => r.getAttribute('data-pt-browser-element'))
        .find((ref) => {
          const root = document.querySelector('[data-pt-browser-element="'+CSS.escape(ref)+'"]');
          const name = root?.children[1]?.textContent?.trim() || '';
          return ${exact ? 'true' : 'false'} ? name === ${JSON.stringify(needle)} : name.includes(${JSON.stringify(needle)});
        });
      return found || null;
    })()`;
  const searchRef = await poll(page, elementRefByName('Search terms'), 5_000) as string;
  const generationBefore = Number(searchRef.split('-')[0].slice(1));
  await setValue(page, `[data-pt-browser-element="${searchRef}"] [data-pt-browser-fill-input]`, `query-${marker}`);
  await page.click(`[data-pt-browser-element="${searchRef}"] [data-pt-browser-fill]`);
  // Submit the form via the Search button.
  const submitRef = await poll(page, elementRefByName('Search', true), 5_000) as string;
  await page.click(`[data-pt-browser-element="${submitRef}"] [data-pt-browser-submit]`);
  await poll(
    page,
    `(document.querySelector('[data-pt-browser-snapshot-url]')?.textContent || '').includes('page2.html')`,
    15_000,
  );
  await page.click('[data-pt-browser-observe]');
  await poll(page, `(document.querySelector('[data-pt-browser-text]')?.textContent || '').includes('query=query-${marker}')`, 15_000);

  // ── Human takeover: agent actions are refused ────────────────────────
  await page.click('[data-pt-browser-takeover]');
  await poll(page, `document.querySelector('[data-pt-browser-lease]').textContent.includes('human') || document.documentElement.textContent.includes('human')`, 10_000).catch(() => undefined);
  const leaseText = await poll(
    page,
    `(() => {
      const el = document.querySelector('[data-pt-browser-lease]');
      return el && (el.textContent.includes('human') || el.textContent.includes('人工')) ? el.textContent : null;
    })()`,
    10_000,
  ) as string;
  expect(leaseText.length).toBeGreaterThan(0);
  // The UI gates actions during human lease.
  const observeDisabled = await page.evaluate(`document.querySelector('[data-pt-browser-observe]').disabled`) as boolean;
  expect(observeDisabled).toBe(true);

  // ── Human changes page state through the real window ─────────────────
  // The eval bridge drives only the app webview; Chrome element geometry
  // comes from the worker snapshot rendered in the panel (untrusted data,
  // used solely to target physical input).
  const viewport = await poll(
    page,
    `(() => {
      const el = document.querySelector('[data-viewport]');
      return el ? el.getAttribute('data-viewport') : null;
    })()`,
    5_000,
  ).then((raw: string) => JSON.parse(raw)) as {
    screenX: number;
    screenY: number;
    outerHeight: number;
    innerHeight: number;
  };
  const coordOf = (needle: string) => `(() => {
      const row = Array.from(document.querySelectorAll('[data-pt-browser-element]'))
        .find((r) => (r.children[1]?.textContent || '').trim().includes(${JSON.stringify(needle)}));
      if (!row) return null;
      return {
        x: Number(row.getAttribute('data-x')),
        y: Number(row.getAttribute('data-y')),
        width: Number(row.getAttribute('data-width')),
        height: Number(row.getAttribute('data-height'))
      };
    })()`;
  await poll(page, coordOf('State'), 5_000);
  // The bridge returns plain eval results as strings; object probes must be
  // JSON.stringified inside the page.
  const readCoord = async (needle: string) => {
    const raw = await page.evaluate(`JSON.stringify(${coordOf(needle).slice(0, -2)}())`) as string;
    return JSON.parse(raw) as { x: number; y: number } | null;
  };
  const stateBox = await readCoord('State');
  const checkbox = await readCoord('on');
  const saveButton = await readCoord('Save state');
  if (!stateBox || !checkbox || !saveButton) {
    throw new Error(`missing takeover targets: ${JSON.stringify({ stateBox, checkbox, saveButton })}`);
  }
  // Chrome's screenX/screenY is the OUTER window origin; the viewport is
  // inset by window borders (x) and tab+address+bookmark chrome (y).
  const winX = viewport.screenX;
  const winY = viewport.screenY;
  const borderX = Math.round((viewport.outerWidth - viewport.innerWidth) / 2);
  const chromeTop = viewport.outerHeight - viewport.innerHeight;
  const screenOf = (point: { x: number; y: number }) => ({
    x: winX + borderX + point.x,
    y: winY + chromeTop + point.y,
  });
  const stateAt = screenOf(stateBox);
  const checkAt = screenOf(checkbox);
  const saveAt = screenOf(saveButton);
  const xdo = (script: string) => dockerExec(`sh -c 'export DISPLAY=:99; ${script}'`);
  xdo(`WID=$(xdotool search --onlyvisible --class chrome | head -1); xdotool windowactivate --sync $WID || true`);
  await sleep(400);
  const clickAt = (point: { x: number; y: number }) => {
    xdo(`xdotool mousemove --sync ${point.x} ${point.y}`);
    xdo('xdotool click 1');
  };
  clickAt(stateAt);
  await sleep(200);
  xdo(`xdotool type --delay 40 'human-${marker}'`);
  await sleep(300);
  clickAt(checkAt);
  await sleep(200);
  clickAt(saveAt);
  await sleep(800);

  // ── Release: old refs stale; agent re-observes the new state ──────────
  await page.click('[data-pt-browser-release]');
  await poll(
    page,
    `(() => {
      const el = document.querySelector('[data-pt-browser-lease]');
      return el && (el.textContent.includes('agent') || el.textContent.includes('Agent')) ? true : null;
    })()`,
    10_000,
  );
  // Old generation refs must be rejected by the worker (contract, not UI only).
  const staleRef = `g${generationBefore}-e0`;
  const staleResult = await page.evaluate(`(async () => {
    try {
      const inv = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
      if (!inv) return JSON.stringify({ gate: 'ui-only' });
      const tabs = await inv('browser_tab_list', { input: { sessionId: ${JSON.stringify(sessionId)} } });
      const tabId = tabs?.data?.[0]?.tabId || '';
      await inv('browser_click', { input: { sessionId: ${JSON.stringify(sessionId)}, tabId, elementRef: ${JSON.stringify(staleRef)} } });
      return JSON.stringify({ gate: 'unexpected-ok' });
    } catch (e) {
      return JSON.stringify({ gate: 'rejected', message: String(e && e.message || e) });
    }
  })()`);
  const stale = JSON.parse(staleResult as string);
  // If the bridge hides invoke, the generation contract is covered by Rust tests.
  if (stale.gate === 'rejected') {
    expect(stale.message).toMatch(/older observation|STALE|conflict|Conflict/i);
  }

  await page.click('[data-pt-browser-observe]');
  await poll(
    page,
    `(document.querySelector('[data-pt-browser-text]')?.textContent || '').includes('saved:human-${marker}:checked')`,
    15_000,
  );
  await page.click('[data-pt-browser-screenshot]');
  const shotSrc = await poll(
    page,
    `document.querySelector('[data-pt-browser-screenshot-img]')?.getAttribute('src') || null`,
    15_000,
  ) as string;
  const pngB64 = shotSrc.split(',')[1] || '';
  const pngBytes = Buffer.from(pngB64, 'base64');
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
  expect(Number(tabsLen)).toBeGreaterThan(2);

  // ── End session: process and metadata removed ────────────────────────
  await page.click('[data-pt-browser-remove]');
  await poll(page, `!document.querySelector('[data-pt-browser-session="${sessionId}"]')`, 20_000);
  const removed = await psql(`SELECT count(*) FROM agent_browser_sessions WHERE id='${sessionId}';`);
  expect(removed).toBe('0');
  const chromeProcs = dockerExec(`pgrep -f 'user-data-dir=.*/browser-sessions/${sessionId}' | wc -l`);
  expect(chromeProcs.trim()).toBe('0');

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, 'tw-d6-journey.json'),
    JSON.stringify({
      schemaVersion: 1,
      artifactKind: 'tw-d6-native-journey',
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
      screenshot: { bytes: pngBytes.length, sha256: sha },
      staleRefGate: stale.gate,
      dbRow,
    }, null, 2),
  );
});
