#!/usr/bin/env node
// TW O12 (browser physical-takeover leg) — real Chrome CDP + real OS input.
//
// Headless-native re-proof of TW-D6 without a GUI harness, a webview bridge,
// or a human at the keyboard:
//   1. the gateway boots the actor-device engine (device identity) and the
//      device browser worker launches a REAL managed Google Chrome (CDP) on
//      the cell Xorg display;
//   2. agent observe/fill/submit drive the page through the worker (CDP),
//      reading untrusted page text only through snapshots;
//   3. takeover hands the lease to HUMAN: every agent action (snapshot and
//      click) is refused fail-closed (BROWSER_HUMAN_TAKEOVER_HELD);
//   4. the "human" acts through the REAL visible window with OS-level input
//      (xdotool on Xorg :99: window activation, mouse move/click, key typing)
//      — the same physical-input path a human user generates, never CDP;
//   5. after release, the pre-takeover snapshot refs are rejected as stale
//      and a fresh observe sees the human-entered state;
//   6. a PNG screenshot captures the real window; Station metadata records
//      status/lease/engine/tabs bound to the conversation;
//   7. ending the session tears Chrome down and removes the Station row.
//
// The strong-model browser-tool journey remains a separate product surface
// (browser actions are not yet exposed as model-callable tools); this closure
// owns the resource/lease/physical-input contract.
//
// Run INSIDE the acceptance cell (Xorg :99 + xdotool required):
//   docker exec -e PT_TW_SOURCE_COMMIT=$(git rev-parse HEAD) \
//     tw-d1-cell sh -lc 'cd /workspace/run/tw && node tw-o12-browser.mjs'
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';

const providerId = process.env.PT_TW_PROVIDER_ID ?? 'ark';
const modelId = process.env.PT_TW_MODEL_ID ?? 'ep-20260623145021-n4xdm';
const DISPLAY = ':99';

// Crockford base32 ULID (128 bits, 26 chars), matching the worker id format.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  let now = Date.now();
  let time = '';
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[now % 32] + time;
    now = Math.floor(now / 32);
  }
  let rand = '';
  for (let i = 0; i < 16; i += 1) {
    rand += CROCKFORD[crypto.randomInt(32)];
  }
  return time + rand;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function xdo(args) {
  return execFileSync('xdotool', args, {
    env: { ...process.env, DISPLAY },
    encoding: 'utf8',
  }).trim();
}
function xdoShell(script) {
  return execSync(`export DISPLAY=${DISPLAY}; ${script}`, { encoding: 'utf8' }).trim();
}

const checks = new CheckCollector();
const evidence = {};

try {
  const gw = new Gateway();
  const { account, password } = envActor();
  await gw.login(account, password);
  await gw.deviceEngineActivate();
  await gw.executorSupervisorStart();
  let sessions = [];
  for (let i = 0; i < 20 && sessions.length === 0; i += 1) {
    await sleep(1000);
    sessions = await gw.capabilitySessions();
  }
  const deviceId = sessions[0]?.device_id;
  checks.record('B0', !!deviceId, `device identity=${deviceId ?? 'missing'}`);

  // ---- B1: real Chrome host available -------------------------------------
  const host = await gw.browserHostInfo();
  checks.record('B1', host?.available === true && /chrome|chromium/i.test(host.engine),
    `available=${host?.available} engine=${host?.engine} path=${host?.path ? 'set' : 'missing'}`);
  evidence.host = { available: host.available, engine: host.engine };

  // Deterministic window stack: remove browsers from earlier runs.
  execSync("pkill -f '[c]hrome/chrome' 2>/dev/null || true", { shell: true });
  await sleep(1000);

  // ---- Real local site served inside the cell -----------------------------
  const marker = `d6${Date.now().toString(36).slice(-6)}`;
  const port = 18000 + (Date.now() % 900);
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
  const server = http.createServer((req, res) => {
    if ((req.url ?? '').startsWith('/page2.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(page2Html);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(indexHtml);
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${port}/`;
  evidence.site = { url, marker };

  const conversation = await gw.conversationCreate((await gw.agentsList())?.agents?.[0]?.id, {
    providerId,
    modelName: modelId,
    title: `TW O12 browser ${crypto.randomUUID().slice(0, 8)}`,
  });

  // ---- B2: worker + Station session for the task conversation --------------
  const sessionId = `brows-${ulid()}`;
  const worker = await gw.browserSessionCreate(sessionId);
  const initialTab = worker?.tabs?.[0];
  const stationRow = await gw.browserStationCreate({
    session_id: sessionId,
    conversation_id: conversation.conversation_id,
    turn_id: '',
    device_id: deviceId,
    engine: worker?.engine ?? '',
  });
  await gw.browserNavigate(sessionId, initialTab.tabId, url);
  let meta = await gw.browserInspect(sessionId);
  await gw.browserStationUpdate({
    session_id: sessionId,
    status: 1,
    lease: 1,
    tabs: meta.tabs,
  });
  const sessionOk =
    /^brows-[0-9A-Z]{26}$/.test(sessionId)
    && worker?.status === 'active' && worker?.lease === 'agent'
    && !!initialTab?.tabId
    && stationRow?.session_id === sessionId
    && stationRow?.conversation_id === conversation.conversation_id;
  checks.record('B2', sessionOk,
    `session=${sessionId} worker=${worker?.status}/${worker?.lease} stationBound=${stationRow?.conversation_id === conversation.conversation_id} tabs=${worker?.tabs?.length ?? 0}`);
  evidence.session_id = sessionId;

  const findElement = (snapshot, nameIncludes) =>
    snapshot.elements?.find((el) => String(el.name ?? '').includes(nameIncludes)) ?? null;

  // ---- B3: agent observes the real page ------------------------------------
  let snap = await gw.browserSnapshot(sessionId, initialTab.tabId);
  const generationBefore = snap.tab?.generation;
  const observedBrand = String(snap.text ?? '').includes(`D6 Portal ${marker}`);
  checks.record('B3', observedBrand && snap.lease === 'agent',
    `lease=${snap.lease} brandObserved=${observedBrand} elements=${snap.elements?.length ?? 0}`);

  // ---- B4: agent fills and submits through CDP; result page is real --------
  const searchRef = findElement(snap, 'Search terms');
  await gw.browserFill(sessionId, initialTab.tabId, searchRef.ref, `query-${marker}`);
  const submitRef = findElement(snap, 'Search');
  await gw.browserSubmit(sessionId, initialTab.tabId, submitRef.ref);
  await sleep(1500);
  snap = await gw.browserSnapshot(sessionId, initialTab.tabId);
  const tabAfterSubmit = snap.tab;
  const resultObserved = String(snap.text ?? '').includes(`query=query-${marker}`)
    && String(tabAfterSubmit?.url ?? '').includes('page2.html');
  checks.record('B4', resultObserved,
    `url=${tabAfterSubmit?.url ?? 'n/a'} queryObserved=${String(snap.text ?? '').includes(`query=query-${marker}`)} gen=${snap.tab?.generation}`);
  // Re-report Station metadata with the post-navigation tab truth.
  await gw.browserStationUpdate({
    session_id: sessionId,
    status: 1,
    lease: 1,
    tabs: [snap.tab],
  });

  // ---- B5: HUMAN takeover refuses ALL agent actions (fail-closed) ----------
  const taken = await gw.browserTakeover(sessionId);
  const browserCode = (error) =>
    error?.details?.code
    ?? error?.details?.body?.code
    ?? (error?.code === 'CONFLICT' ? `CONFLICT:${error.message}` : error?.code);
  let takeoverSnapshotError = null;
  try {
    await gw.browserSnapshot(sessionId, initialTab.tabId);
  } catch (error) {
    takeoverSnapshotError = error;
  }
  let takeoverClickError = null;
  try {
    await gw.browserSubmit(sessionId, initialTab.tabId, submitRef.ref);
  } catch (error) {
    takeoverClickError = error;
  }
  const snapshotRefusedCode = browserCode(takeoverSnapshotError);
  const clickRefusedCode = browserCode(takeoverClickError);
  const failClosed =
    taken?.lease === 'human'
    && takeoverSnapshotError?.code === 'CONFLICT'
    && snapshotRefusedCode === 'BROWSER_HUMAN_TAKEOVER_HELD'
    && takeoverClickError?.code === 'CONFLICT'
    && clickRefusedCode === 'BROWSER_HUMAN_TAKEOVER_HELD';
  checks.record('B5', failClosed,
    `lease=${taken?.lease} snapshotRefused=${snapshotRefusedCode ?? 'NO'} clickRefused=${clickRefusedCode ?? 'NO'}`);

  // ---- B6: physical input through the real visible window (xdotool) --------
  const stateBox = findElement(snap, 'State');
  const checkbox = findElement(snap, 'on');
  const saveButton = findElement(snap, 'Save state');
  const targetsPresent = stateBox && checkbox && saveButton && snap.viewport;
  // Chrome screenX/screenY is the OUTER window origin; viewport is inset by
  // borders (x) and tab/address chrome (y). Same geometry the UI uses.
  const v = snap.viewport ?? {};
  const borderX = Math.round(((v.outerWidth ?? 0) - (v.innerWidth ?? 0)) / 2);
  const chromeTop = (v.outerHeight ?? 0) - (v.innerHeight ?? 0);
  const screenOf = (el) => ({
    x: (v.screenX ?? 0) + borderX + el.x,
    y: (v.screenY ?? 0) + chromeTop + el.y,
  });
  if (targetsPresent) {
    xdoShell('WID=$(xdotool search --onlyvisible --class chrome | head -1); xdotool windowactivate --sync $WID || true');
    await sleep(400);
    const physicalClick = (el) => {
      const point = screenOf(el);
      xdo(['mousemove', '--sync', String(point.x), String(point.y)]);
      xdo(['click', '1']);
    };
    physicalClick(stateBox);
    await sleep(200);
    xdo(['type', '--delay', '40', `human-${marker}`]);
    await sleep(300);
    physicalClick(checkbox);
    await sleep(200);
    physicalClick(saveButton);
    await sleep(800);
  }
  checks.record('B6', !!targetsPresent,
    `physical targets state=${!!stateBox} checkbox=${!!checkbox} save=${!!saveButton} typed=human-${marker}`);

  // ---- B7: release; old observation refs are stale ------------------------
  const released = await gw.browserRelease(sessionId);
  let staleError = null;
  try {
    await gw.browserSubmit(sessionId, initialTab.tabId, `g${generationBefore}-e0`);
  } catch (error) {
    staleError = error;
  }
  const staleOk =
    released?.lease === 'agent'
    && staleError?.code === 'CONFLICT'
    && /BROWSER_SNAPSHOT_REF_STALE|older observation|STALE/i.test(
      staleError?.details?.body?.code ?? staleError?.message ?? '',
    );
  checks.record('B7', staleOk,
    `lease=${released?.lease} staleRejected=${staleError?.details?.body?.code ?? staleError?.code ?? 'NO'}`);

  // ---- B8: fresh observe sees the human-entered state ----------------------
  const reSnap = await gw.browserSnapshot(sessionId, initialTab.tabId);
  const humanState = `saved:human-${marker}:checked`;
  const reObserved = String(reSnap.text ?? '').includes(humanState);
  checks.record('B8', reObserved && reSnap.lease === 'agent',
    `lease=${reSnap.lease} humanStateObserved=${reObserved}`);

  // ---- B9: real PNG screenshot of the post-takeover window ----------------
  const shot = await gw.browserScreenshot(sessionId, initialTab.tabId);
  const png = Buffer.from(shot?.data_b64 ?? '', 'base64');
  const pngHeader = png.subarray(0, 8).toString('hex');
  const screenshotOk = png.length > 3000 && pngHeader === '89504e470d0a1a0a';
  checks.record('B9', screenshotOk, `pngBytes=${png.length} header=${pngHeader}`);
  evidence.screenshot = { bytes: png.length, sha256: sha256(png) };

  // ---- B10: Station metadata truth -----------------------------------------
  const stationSessions = await gw.browserStationList(conversation.conversation_id);
  const row = stationSessions.find((s) => s.session_id === sessionId);
  const stationOk =
    row?.status === 1
    && row?.lease === 1
    && String(row.engine ?? '').length > 0
    && row.device_id === deviceId
    && (row.tabs ?? []).some((t) => String(t.url ?? '').includes('page2.html'));
  checks.record('B10', stationOk,
    `status=${row?.status} lease=${row?.lease} engine=${String(row?.engine ?? '').slice(0, 24)} device=${row?.device_id === deviceId} tabs=${(row?.tabs ?? []).length}`);

  // ---- B11: end session kills Chrome and removes the Station row -----------
  await gw.browserRemove(sessionId);
  await gw.browserStationRemove(sessionId);
  await sleep(1500);
  const workersLeft = (await gw.browserSessionListWorkers())
    .some((s) => s.session_id === sessionId);
  const stationLeft = (await gw.browserStationList(conversation.conversation_id))
    .some((s) => s.session_id === sessionId);
  let chromeProcs = '';
  try {
    // Bracketed first char prevents the pgrep command line from matching
    // itself.
    chromeProcs = execSync(`pgrep -f "[u]ser-data-dir=.*/${sessionId}" | wc -l`, {
      encoding: 'utf8',
    }).trim();
  } catch {
    chromeProcs = '0';
  }
  const removedOk = !workersLeft && !stationLeft && chromeProcs === '0';
  checks.record('B11', removedOk,
    `workerGone=${!workersLeft} stationGone=${!stationLeft} chromeProcs=${chromeProcs}`);

  server.close();
  evidence.human_state = humanState;
  evidence.conversation_id = conversation.conversation_id;
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  evidence.fatal_detail = error?.details ?? null;
  checks.record('FATAL', false, evidence.fatal);
}

const report = writeReport(path.join(reportDir, 'tw-o12-browser.json'), {
  plan: 'TW-20261102',
  closure: 'tw-o12-browser',
  outcome: 'O12-browser-takeover',
  source_commit: process.env.PT_TW_SOURCE_COMMIT ?? gitRev(root),
  station_url: process.env.PEERS_STATION_URL ?? 'persisted-active',
  physical_input: 'xdotool@Xorg:99 (OS-level mouse/keyboard, no CDP/DOM)',
  pass: checks.passCount,
  fail: checks.failCount,
  results: checks.results,
  evidence,
});
console.log(`PASS=${report.pass} FAIL=${report.fail}`);
process.exit(report.fail === 0 ? 0 : 1);
