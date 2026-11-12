#!/usr/bin/env node
// TW-O12 browser-as-model-tool — the STRONG MODEL itself drives the managed
// browser through capability-dispatched tools (no harness-side page driving):
//
//   browser_navigate -> browser_snapshot (BUILD_STATUS:FAIL)
//   local_file_edit (served source)
//   browser_navigate/snapshot again (BUILD_STATUS:PASS)
//
// Every browser_* tool call is a normal admitted/approved/executed tool call
// owned by the desktop client capability session (browser.observe /
// browser.interact), exactly like local_file_edit. A second turn proves the
// human-takeover lease pauses the model with a bounded
// BROWSER_HUMAN_TAKEOVER_HELD result, and release resumes it.
//
// Run INSIDE the acceptance cell:
//   docker exec -e PT_TW_ARK_API_KEY="$KEY" -e PT_TW_SOURCE_COMMIT=$(git rev-parse HEAD) \
//     tw-d1-cell sh -lc 'cd /workspace/run/tw && node tw-o12-browser-tool.mjs'
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
const READINESS_READY = 1;
const BROWSER_SESSION_ACTIVE = 1;
const REQUIRED_CAPS = [
  'filesystem.read', 'filesystem.write', 'filesystem.edit',
  'browser.observe', 'browser.interact',
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
const readPtyUntil = async (gw, sessionId, marker, timeoutMs = 10_000) => {
  let cursor = 0;
  let aggregate = '';
  let meta = null;
  const deadline = Date.now() + timeoutMs;
  do {
    const r = await gw.terminalRead(sessionId, cursor);
    cursor = Number(r.nextCursor ?? cursor);
    meta = r.meta ?? meta;
    aggregate += Buffer.from(r.chunkB64 ?? '', 'base64').toString('utf8');
    if (aggregate.includes(marker)) return { found: true, meta, cursor };
    await sleep(400);
  } while (Date.now() < deadline);
  return { found: false, meta, cursor };
};

const safeParse = (value) => {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
};

const checks = new CheckCollector();
const gw = new Gateway();
const { account, password } = envActor();
const evidence = { provider_id: providerId, model_id: modelId };
let terminalId = null;
let servicePort = 0;
let modelSessionId = null;
let mainGoverned = null;
let pageName = null;

try {
  await gw.login(account, password);
  const agents = await gw.agentsList();
  const agent = agents?.agents?.[0];
  if (!agent) throw new Error('no agent available');
  evidence.agent = { id: agent.id, version: Number(agent.version) };

  await gw.deviceEngineActivate();
  await gw.executorSupervisorStart();
  let sessions = [];
  for (let i = 0; i < 20 && sessions.length === 0; i += 1) {
    await sleep(1000);
    sessions = await gw.capabilitySessions();
  }
  const session = sessions[0];
  const deviceId = session?.device_id;
  const grants = (session?.typed_capabilities ?? []).map((c) => c.capability_id);
  evidence.capability_grants = grants;
  checks.record(
    'C1',
    REQUIRED_CAPS.every((id) => grants.includes(id)),
    `grants include filesystem+browser: ${REQUIRED_CAPS.every((id) => grants.includes(id))}`,
  );

  await gw.convergeToolScope(agent.id, REQUIRED_CAPS, {
    policy: APPROVAL_MANUAL,
    agentVersion: Number(agent.version),
  });

  let readiness = null;
  for (let i = 0; i < 20; i += 1) {
    readiness = await gw.capabilityReadiness(agent.id, {
      clientCapabilitySessionId: session.session_id,
      providerId,
      modelId,
    });
    const ready = REQUIRED_CAPS.every((id) =>
      readiness.capabilities?.some((c) => c.capability_id === id && c.state === READINESS_READY),
    );
    if (ready && readiness.selected_client_session_id === session.session_id) break;
    await sleep(1000);
  }
  const readyCaps = (readiness?.capabilities ?? [])
    .filter((c) => REQUIRED_CAPS.includes(c.capability_id))
    .map((c) => ({ id: c.capability_id, state: c.state }));
  evidence.readiness = readyCaps;
  checks.record(
    'C2',
    REQUIRED_CAPS.every((id) => readyCaps.some((c) => c.id === id && c.state === READINESS_READY)),
    `readiness=${JSON.stringify(readyCaps)}`,
  );

  // ---- Harness stages a FAILING page on a local device-held service -------
  const workspaceRoot = await gw.terminalDefaultWorkspace(deviceId);
  const stamp = crypto.randomBytes(3).toString('hex');
  pageName = `brw-${stamp}.html`;
  const pagePath = path.join(workspaceRoot, pageName);
  servicePort = 19000 + (Date.now() % 900);
  const url = `http://127.0.0.1:${servicePort}/${pageName}`;
  evidence.workspace_root = workspaceRoot;
  evidence.page = pageName;
  evidence.url = url;
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(pagePath, [
    '<!doctype html><html><head><title>build</title></head><body>',
    '<div id="build">BUILD_STATUS:FAIL</div>',
    '<form method="get"><input name="q" id="q"><button id="go" type="submit">Go</button></form>',
    '</body></html>',
  ].join('\n'), 'utf8');

  const createdTerm = await gw.terminalCreate(workspaceRoot, {
    command: '/bin/bash', args: ['-i'], cols: 100, rows: 30,
  });
  terminalId = createdTerm.sessionId ?? createdTerm.session_id;
  await gw.terminalWrite(terminalId,
    `cd ${JSON.stringify(workspaceRoot)} && nohup python3 -m http.server ${servicePort} --bind 127.0.0.1 >brw-${stamp}.log 2>&1 & echo SERVICE_STARTED\n`);
  const started = await pollHttp(url, 'BUILD_STATUS:FAIL', 20_000);
  const ptyStart = await readPtyUntil(gw, terminalId, 'SERVICE_STARTED', 8000);
  checks.record(
    'C3',
    !!started && ptyStart.found && ptyStart.meta?.status === 'running',
    `http200=${!!started} pty=${ptyStart.meta?.status ?? 'none'} started=${ptyStart.found}`,
  );

  // ---- Main model-driven browser repair turn -----------------------------
  execFileSync('bash', ['-c', "pkill -f '[c]hrome/chrome' 2>/dev/null || true"]);
  await sleep(1000);
  const conversation = await gw.conversationCreate(agent.id, {
    providerId, modelName: modelId,
    title: `TW O12 browser tool ${crypto.randomUUID().slice(0, 8)}`,
  });
  evidence.conversation_id = conversation.conversation_id;
  const governed = await gw.runGovernedTurn({
    client_idempotency_key: crypto.randomUUID(),
    conversation_id: conversation.conversation_id,
    agent_id: agent.id,
    user_input:
      `Follow these steps using tools, in order:\n`
      + `1. Call browser_navigate with url ${JSON.stringify(url)} (omit session_id; remember the returned session_id and tab_id).\n`
      + `2. Call browser_snapshot and confirm the page contains BUILD_STATUS:FAIL.\n`
      + `3. Call local_file_edit on ${JSON.stringify(pageName)} replacing exactly "BUILD_STATUS:FAIL" with "BUILD_STATUS:PASS".\n`
      + `4. Call browser_navigate again on the same session/tab with the same URL, then browser_snapshot, and confirm BUILD_STATUS:PASS.\n`
      + 'Use no other tools. When done, state the final marker you observed.',
    attachments: [],
    stream: true,
    effort: 'medium',
    context_window_size: 32768,
    max_retries: 0,
    provider: providerId,
    model: modelId,
    client_capability_session_id: session.session_id,
    requested_budget: { wall_time_ms: 300_000 },
  }, { timeoutMs: 360_000, decide: () => ({ approved: true }) });
  mainGoverned = governed;

  const callNames = (governed.calls ?? []).map((c) => c.toolName);
  evidence.tool_calls = callNames;
  const navigateCount = callNames.filter((n) => n === 'browser_navigate').length;
  const snapshotCount = callNames.filter((n) => n === 'browser_snapshot').length;
  const editCall = (governed.calls ?? []).find((c) => c.toolName === 'local_file_edit');
  checks.record(
    'C4',
    governed.ok === true
      && governed.terminalStage === 'turn_completed'
      && navigateCount >= 2
      && !!editCall,
    `ok=${governed.ok} stage=${governed.terminalStage} navigates=${navigateCount} explicitSnapshots=${snapshotCount} edit=${!!editCall}`,
  );

  // Attribute every result to its ordered tool call. C5 must prove the model
  // OBSERVED both markers through browser tools in the right order — the
  // local_file_edit bounded result itself echoes "BUILD_STATUS:PASS" in its
  // unified diff, so a naive search across all results would pass even when
  // the model skips the post-edit re-navigation (a real false positive seen
  // on a merge-stamped rerun: calls were [navigate, edit] only).
  const orderedCalls = governed.calls ?? [];
  const resultName = new Map(orderedCalls.map((c) => [c.toolCallId, c.toolName]));
  const resultIndex = new Map(orderedCalls.map((c, i) => [c.toolCallId, i]));
  const editIndex = orderedCalls.findIndex((c) => c.toolName === 'local_file_edit');
  const attributedResults = (governed.results ?? []).map((r) => ({
    name: resultName.get(r.toolCallId) ?? 'unknown',
    index: resultIndex.get(r.toolCallId) ?? -1,
    rawJson: safeParse(r.raw),
  }));
  const markerSeen = (entry, marker) => JSON.stringify(entry.rawJson ?? {}).includes(marker);
  const browserObservationBefore = attributedResults.some((r) =>
    r.name.startsWith('browser_')
    && (editIndex < 0 || r.index < editIndex)
    && markerSeen(r, 'BUILD_STATUS:FAIL')
    && !markerSeen(r, 'BUILD_STATUS:PASS'));
  const browserObservationAfter = attributedResults.some((r) =>
    r.name.startsWith('browser_')
    && editIndex >= 0
    && r.index > editIndex
    && markerSeen(r, 'BUILD_STATUS:PASS')
    && !markerSeen(r, 'BUILD_STATUS:FAIL'));
  checks.record(
    'C5',
    browserObservationBefore && browserObservationAfter,
    `model observed via browser tools only: FAIL before edit=${browserObservationBefore}, PASS after edit=${browserObservationAfter}`,
  );

  const disk = fs.readFileSync(pagePath, 'utf8');
  checks.record(
    'C6',
    disk.includes('BUILD_STATUS:PASS') && !disk.includes('BUILD_STATUS:FAIL'),
    `served source flipped PASS=${disk.includes('BUILD_STATUS:PASS')} failGone=${!disk.includes('BUILD_STATUS:FAIL')}`,
  );

  // The model-created session is Station truth bound to THIS conversation.
  modelSessionId = attributedResults
    .map((r) => r.rawJson?.session_id)
    .find((id) => typeof id === 'string' && id.startsWith('brows-')) ?? null;
  evidence.model_browser_session_id = modelSessionId;
  const stationSessions = await gw.browserStationList(conversation.conversation_id);
  const bound = stationSessions.find((s) => s.session_id === modelSessionId);
  checks.record(
    'C7',
    !!bound && bound.status === BROWSER_SESSION_ACTIVE && bound.engine && bound.engine.length > 0,
    `station row bound to conversation: ${!!bound} status=${bound?.status ?? 'missing'} engine=${String(bound?.engine ?? '').slice(0, 30)}`,
  );

  // ---- Human takeover pauses the agent with a bounded result --------------
  if (modelSessionId) {
    await gw.browserTakeover(modelSessionId);
    await sleep(500);
    const heldConversation = await gw.conversationCreate(agent.id, {
      providerId, modelName: modelId,
      title: `TW O12 browser held ${crypto.randomUUID().slice(0, 8)}`,
    });
    const heldTurn = await gw.runGovernedTurn({
      client_idempotency_key: crypto.randomUUID(),
      conversation_id: heldConversation.conversation_id,
      agent_id: agent.id,
      user_input:
        `Call browser_navigate exactly once with url ${JSON.stringify(url)} and session_id ${JSON.stringify(modelSessionId)}; `
        + 'then report the returned error_code verbatim. You must call the tool before answering. Use no other tools.',
      attachments: [],
      stream: true,
      effort: 'medium',
      context_window_size: 32768,
      max_retries: 0,
      provider: providerId,
      model: modelId,
      client_capability_session_id: session.session_id,
      requested_budget: { wall_time_ms: 180_000 },
    }, { timeoutMs: 240_000, decide: () => ({ approved: true }) });
    const heldRaw = JSON.stringify((heldTurn.results ?? []).map((r) => safeParse(r.raw)));
    const heldToolNames = (heldTurn.calls ?? []).map((c) => c.toolName);
    const heldAttempted = heldToolNames.includes('browser_navigate');
    checks.record(
      'C8',
      heldAttempted && heldRaw.includes('BROWSER_HUMAN_TAKEOVER_HELD'),
      `held navigate attempted=${heldAttempted} calls=${JSON.stringify(heldToolNames)} bounded HELD=${heldRaw.includes('BROWSER_HUMAN_TAKEOVER_HELD')}`,
    );
    evidence.held_conversation_id = heldConversation.conversation_id;
    evidence.held_turn_id = heldTurn.turnId;

    await gw.browserRelease(modelSessionId);
    await sleep(500);
    const resumedNav = await gw.browserNavigate(modelSessionId, bound?.tabs?.[0]?.tab_id, url);
    const resumedSnap = await gw.browserSnapshot(modelSessionId, resumedNav.tab_id ?? bound?.tabs?.[0]?.tab_id);
    checks.record(
      'C9',
      String(resumedSnap.text ?? '').includes('BUILD_STATUS:PASS'),
      `after release agent lease restored, page still PASS: ${String(resumedSnap.text ?? '').includes('BUILD_STATUS:PASS')}`,
    );
  } else {
    checks.record('C8', false, 'no model browser session to take over');
    checks.record('C9', false, 'no model browser session to release');
  }
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
} finally {
  // The browser resource contract is a two-step removal, exactly like the
  // physical-takeover closure B11: browser_remove kills the device worker /
  // Chrome, while browser_station_remove deletes the Station truth row. The
  // model-created session is a user-visible resource (BrowserDock), so the
  // product deliberately keeps the two sides independent; the closure must
  // perform both to leave zero residue. Errors are surfaced into evidence
  // instead of swallowed so a cleanup regression cannot pass silently.
  const cleanupErrors = [];
  try {
    // Recover the session even when the body threw before modelSessionId was
    // assigned — a failed assertion must never leak a browser resource.
    if (!modelSessionId && mainGoverned) {
      modelSessionId = (mainGoverned.results ?? [])
        .map((r) => safeParse(r.raw)?.session_id)
        .find((id) => typeof id === 'string' && id.startsWith('brows-')) ?? null;
    }
    if (modelSessionId) {
      await gw.browserRelease(modelSessionId).catch((error) => {
        cleanupErrors.push(`release: ${String(error?.message ?? error).slice(0, 200)}`);
      });
      await gw.browserRemove(modelSessionId).catch((error) => {
        cleanupErrors.push(`device_remove: ${String(error?.message ?? error).slice(0, 200)}`);
      });
      await gw.browserStationRemove(modelSessionId).catch((error) => {
        cleanupErrors.push(`station_remove: ${String(error?.message ?? error).slice(0, 200)}`);
      });
      await sleep(1000);
      const stationLeft = (await gw.browserStationList(evidence.conversation_id ?? ''))
        .some((s) => s.session_id === modelSessionId);
      const workerLeft = (await gw.browserSessionListWorkers())
        .some((s) => s.session_id === modelSessionId);
      if (stationLeft) cleanupErrors.push('station row still present after two-step remove');
      if (workerLeft) cleanupErrors.push('device worker still present after remove');
      if (cleanupErrors.length > 0) evidence.cleanup_errors = cleanupErrors;
      checks.record(
        'C10',
        !stationLeft && !workerLeft,
        `stationLeft=${stationLeft} workerLeft=${workerLeft} errors=${JSON.stringify(cleanupErrors)}`,
      );
    }
  } catch (error) {
    evidence.cleanup_errors = [...cleanupErrors, `cleanup: ${String(error?.message ?? error).slice(0, 200)}`];
  }
  try {
    if (servicePort) {
      execFileSync('bash', ['-c', `pkill -9 -f "http.server ${servicePort} --bind" 2>/dev/null || true`]);
    }
    if (terminalId) {
      await gw.terminalKill(terminalId).catch(() => undefined);
      await gw.terminalRemove(terminalId).catch(() => undefined);
    }
  } catch { /* best effort */ }
}

const report = writeReport(path.join(reportDir, 'tw-o12-browser-tool.json'), {
  plan: 'TW-20261102',
  closure: 'tw-o12-browser-tool',
  outcome: 'O12-browser-model-tool',
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
