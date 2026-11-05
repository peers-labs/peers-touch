#!/usr/bin/env node
// TW O12 (single-run service + browser verification) — long-running local
// service started from a device PTY, verified in a real Chrome tab, failed
// first, then repaired by the strong model and re-verified green.
//
// One continuous run joins the three resource/model surfaces that tw-d5 and
// tw-o12-browser proved separately:
//   1. a device-held PTY (the desktop Rust terminal worker) starts a
//      long-running `python3 -m http.server` serving the agent workspace,
//      detached so it outlives the PTY interaction itself;
//   2. the real managed Chrome (CDP) opens the served page and observes the
//      failing build marker;
//   3. a governed strong-model turn (DESKTOP_DEVICE tools, MANUAL approvals)
//      edits the served source file; Chrome reloads and observes the fixed
//      marker;
//   4. teardown kills the service (exit code read) and removes resources.
//
// Run INSIDE the acceptance cell:
//   docker exec -e PT_TW_SOURCE_COMMIT=$(git rev-parse HEAD) \
//     tw-d1-cell sh -lc 'cd /workspace/run/tw && node tw-o12-service.mjs'
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';

const providerId = process.env.PT_TW_PROVIDER_ID ?? 'ark';
const modelId = process.env.PT_TW_MODEL_ID ?? 'ep-20260623145021-n4xdm';
const APPROVAL_MANUAL = 1;
const DEVICE_SCOPE = [
  'clipboard.read', 'clipboard.write',
  'filesystem.read', 'filesystem.list', 'filesystem.write', 'filesystem.edit',
  'shell.execute', 'shell.allowlist',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const curl = (url) => new Promise((resolve, reject) => {
  const req = http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
  });
  req.on('error', reject);
  req.setTimeout(5000, () => req.destroy(new Error('timeout')));
});
const pollHttp = async (url, token, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const r = await curl(url);
      if (r.status === 200 && r.body.includes(token)) return r;
    } catch {
      // service not up yet
    }
    await sleep(400);
  } while (Date.now() < deadline);
  return null;
};

// Device PTY reads return the bounded ring as chunkB64 plus a cursor.
const readPtyUntil = async (sessionId, marker, timeoutMs = 10_000) => {
  let cursor = 0;
  let aggregate = '';
  let meta = null;
  const deadline = Date.now() + timeoutMs;
  do {
    const r = await gw.terminalRead(sessionId, cursor);
    cursor = Number(r.nextCursor ?? cursor);
    meta = r.meta ?? meta;
    aggregate += Buffer.from(r.chunkB64 ?? '', 'base64').toString('utf8');
    if (aggregate.includes(marker)) {
      return { text: aggregate, found: true, meta, cursor };
    }
    await sleep(400);
  } while (Date.now() < deadline);
  return { text: aggregate, found: false, meta, cursor };
};

const checks = new CheckCollector();
const gw = new Gateway();
const { account, password } = envActor();
const evidence = { provider_id: providerId, model_id: modelId };
let terminalId = null;
let browserSessionId = null;
let servicePort = 0;
let cleanupPid = null;

try {
  await gw.login(account, password);
  const agents = await gw.agentsList();
  const agent = agents?.agents?.[0];
  if (!agent) throw new Error('no agent available');
  evidence.agent = { id: agent.id, version: Number(agent.version) };

  // Device engine + capability session (file edits run on the desktop worker).
  await gw.deviceEngineActivate();
  await gw.executorSupervisorStart();
  let sessions = [];
  for (let i = 0; i < 20 && sessions.length === 0; i += 1) {
    await sleep(1000);
    sessions = await gw.capabilitySessions();
  }
  const deviceId = sessions[0]?.device_id;
  checks.record('V0', !!deviceId, `device=${deviceId ?? 'missing'}`);

  // Desktop-device tool scope (mixed sandbox/device families forbidden).
  await gw.convergeToolScope(agent.id, DEVICE_SCOPE, {
    policy: APPROVAL_MANUAL,
    agentVersion: Number(agent.version),
  });

  const workspaceRoot = await gw.terminalDefaultWorkspace(deviceId);
  const stamp = crypto.randomBytes(3).toString('hex');
  const pageName = `svc-${stamp}.html`;
  const pagePath = path.join(workspaceRoot, pageName);
  const title = `SVC ${stamp.toUpperCase()}`;
  servicePort = 18000 + (Date.now() % 900);
  const url = `http://127.0.0.1:${servicePort}/${pageName}`;
  evidence.workspace_root = workspaceRoot;
  evidence.page = pageName;
  evidence.url = url;

  // ---- V1: long-running service started from a device-held PTY ------------
  // Harness pre-stages a FAILING build page; the model's job is to fix it.
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(pagePath, [
    '<!doctype html><html><head><title>build</title></head><body>',
    `<h1 id="title">${title}</h1>`,
    '<div id="build">BUILD_STATUS:FAIL</div>',
    '</body></html>',
  ].join('\n'), 'utf8');

  const createdTerm = await gw.terminalCreate(workspaceRoot, {
    command: '/bin/bash',
    args: ['-i'],
    cols: 100,
    rows: 30,
  });
  // The worker mints the session id; adopt it for subsequent calls.
  terminalId = createdTerm.sessionId ?? createdTerm.session_id;
  // Detached long-running service. Under bash job control $! can point at a
  // nohup wrapper rather than the python process, so teardown identifies the
  // listener by its unique port argument instead of a pid file.
  await gw.terminalWrite(terminalId,
    `cd ${JSON.stringify(workspaceRoot)} && nohup python3 -m http.server ${servicePort} --bind 127.0.0.1 >svc-${stamp}.log 2>&1 & echo SERVICE_STARTED\n`);
  await sleep(1500);
  const started = await pollHttp(url, 'BUILD_STATUS:FAIL', 20_000);
  const ptyStart = await readPtyUntil(terminalId, 'SERVICE_STARTED', 8000);
  cleanupPid = `port:${servicePort}`;
  const terminalMeta = await gw.terminalList();
  const termRow = terminalMeta.find((s) => (s.sessionId ?? s.session_id) === terminalId);
  checks.record('V1',
    !!started && ptyStart.found && ptyStart.meta?.status === 'running',
    `http200=${!!started} terminal=${ptyStart.meta?.status ?? termRow?.status} started=${ptyStart.found} port=${servicePort}`,
  );
  evidence.terminal_session_id = terminalId;
  evidence.service_pid = cleanupPid;

  // ---- V2: real Chrome observes the FAILING build ------------------------
  const host = await gw.browserHostInfo();
  if (host.available !== true) throw new Error('managed Chrome host unavailable');
  // Deterministic window stack.
  execFileSync('bash', ['-c', "pkill -f '[c]hrome/chrome' 2>/dev/null || true"]);
  await sleep(1000);
  browserSessionId = `brows-${crypto.randomBytes(13).toString('hex').toUpperCase()}`;
  await gw.browserSessionCreate(browserSessionId);
  const tab = (await gw.browserSessionListWorkers())
    .find((s) => s.sessionId === browserSessionId)?.tabs?.[0];
  await gw.browserNavigate(browserSessionId, tab.tabId, url);
  await sleep(1200);
  let snap = await gw.browserSnapshot(browserSessionId, tab.tabId);
  const failObserved = String(snap.text ?? '').includes('BUILD_STATUS:FAIL')
    && String(snap.tab?.url ?? '').includes(pageName);
  checks.record('V2', failObserved,
    `snapshotUrl=${String(snap.tab?.url ?? '').slice(-40)} failObserved=${String(snap.text ?? '').includes('BUILD_STATUS:FAIL')}`,
  );

  // ---- V3: strong model repairs the served source (governed tools) --------
  const conversation = await gw.conversationCreate(agent.id, {
    providerId,
    modelName: modelId,
    title: `TW O12 service ${crypto.randomUUID().slice(0, 8)}`,
  });
  const governed = await gw.runGovernedTurn({
    client_idempotency_key: crypto.randomUUID(),
    conversation_id: conversation.conversation_id,
    agent_id: agent.id,
    user_input:
      'A local web server is serving the file at workspace root named '
      + `"${pageName}". It currently contains the literal text "BUILD_STATUS:FAIL" inside a div. `
      + `Use local_file_edit on "${pageName}" to replace exactly "BUILD_STATUS:FAIL" with "BUILD_STATUS:PASS". `
      + 'Do not change anything else. After the edit, reply with one short sentence.',
    attachments: [],
    stream: true,
    effort: 'medium',
    context_window_size: 32768,
    max_retries: 0,
    provider: providerId,
    model: modelId,
    client_capability_session_id: sessions[0].session_id,
    requested_budget: { wall_time_ms: 240_000 },
  }, {
    timeoutMs: 300_000,
    decide: () => ({ approved: true }),
  });
  const editCall = governed.calls?.find((c) => c.toolName === 'local_file_edit');
  const editResult = governed.results
    ?.find((r) => r.toolCallId === editCall?.toolCallId);
  const editEnvelopeChanged = editResult?.parsed?.changed
    ?? editResult?.output?.changed
    ?? editResult?.output?.artifacts?.[0]?.change_type === 'modified';
  const diskAfter = fs.readFileSync(pagePath, 'utf8');
  const diskPass = diskAfter.includes('BUILD_STATUS:PASS')
    && !diskAfter.includes('BUILD_STATUS:FAIL');
  const editOk = governed.ok && !!editCall && diskPass;
  checks.record('V3', editOk,
    `terminal=${governed.terminalStage ?? 'none'} editCall=${!!editCall} envelopeChanged=${editEnvelopeChanged} diskPass=${diskPass}`,
  );
  evidence.turn_id = governed.turnId;
  evidence.conversation_id = conversation.conversation_id;

  // ---- V4: Chrome re-verifies the now-PASS build on the SAME service ------
  await gw.browserNavigate(browserSessionId, tab.tabId, url);
  await sleep(1000);
  snap = await gw.browserSnapshot(browserSessionId, tab.tabId);
  const passObserved = String(snap.text ?? '').includes('BUILD_STATUS:PASS')
    && !String(snap.text ?? '').includes('BUILD_STATUS:FAIL');
  const liveHttp = await curl(url);
  checks.record('V4',
    passObserved && liveHttp.status === 200 && liveHttp.body.includes('BUILD_STATUS:PASS'),
    `browserPass=${passObserved} http200=${liveHttp.status === 200} generation=${snap.tab?.generation}`,
  );

  // ---- V5: service teardown — SIGKILL the exact listener, port proves it ---
  await gw.terminalWrite(terminalId,
    `pkill -9 -f "http.server ${servicePort} --bind"; echo KILL_SENT\n`);
  const killRead = await readPtyUntil(terminalId, 'KILL_SENT', 6000);
  const gone = await pollHttp(url, 'BUILD_STATUS', 10_000) === null;
  await gw.terminalKill(terminalId).catch(() => undefined);
  checks.record('V5',
    killRead.found && gone,
    `killSent=${killRead.found} serviceDown=${gone}`,
  );
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
} finally {
  // Best-effort resource cleanup (browser + stray service).
  try {
    if (browserSessionId) {
      await gw.browserRemove(browserSessionId).catch(() => undefined);
    }
  } catch { /* best effort */ }
  try {
    if (servicePort) {
      execFileSync('bash', ['-c', `pkill -9 -f "http.server ${servicePort} --bind" 2>/dev/null || true`]);
    }
    if (terminalId) await gw.terminalRemove(terminalId).catch(() => undefined);
  } catch { /* best effort */ }
}

const report = writeReport(path.join(reportDir, 'tw-o12-service.json'), {
  plan: 'TW-20261102',
  closure: 'tw-o12-service',
  outcome: 'O12-service-browser-single-run',
  source_commit: process.env.PT_TW_SOURCE_COMMIT ?? gitRev(root),
  station_url: process.env.PEERS_STATION_URL ?? 'persisted-active',
  provider_id: providerId,
  model_id: modelId,
  strong_model: true,
  pass: checks.passCount,
  fail: checks.failCount,
  results: checks.results,
  evidence,
});
console.log(`PASS=${report.pass} FAIL=${report.fail}`);
process.exit(report.fail === 0 ? 0 : 1);
