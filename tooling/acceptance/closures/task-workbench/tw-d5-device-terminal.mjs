#!/usr/bin/env node
// TW-D5 / O06 — device-held persistent terminal session, headless native.
//
// Drives the REAL Tauri worker (no GUI): provisions an authorized actor
// workspace, spawns a long-lived PTY process, proves the Station metadata row
// and the worker handle share one resource id with live pid/status, replays
// bounded output by cursor with the process still alive (viewer-close only
// unsubscribes — there is no viewer here, yet the process keeps running),
// kills it and reads back exit code, syncs the Station row to killed, then
// removes both sides. Raw output never leaves the worker; Station keeps
// metadata only.
//
// Run INSIDE the acceptance cell:
//   docker exec -i tw-d1-cell node --input-type=module - < this-file
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';
import { TERMINAL_STATUS, EXECUTION_TARGET } from './lib/proto.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';

// Stable device identity for the headless cell; Station rows are scoped by
// (actor, device) and reconciled against live worker handles.
const deviceId = process.env.PT_TW_DEVICE_ID ?? 'headless-cell-device';
const marker = `D5_READY_${crypto.randomUUID().slice(0, 8)}`;

const checks = new CheckCollector();
const gw = new Gateway();
const { account, password } = envActor();
const evidence = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64decode = (b64) => Buffer.from(b64 ?? '', 'base64').toString('utf8');

// Polls the bounded ring until `predicate(text)` holds or timeout elapses.
async function readUntil(sessionId, predicate, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  let cursor = 0;
  let text = '';
  let lastMeta = null;
  while (Date.now() - start < timeoutMs) {
    const read = await gw.terminalRead(sessionId, cursor);
    lastMeta = read?.meta ?? null;
    text += b64decode(read?.chunkB64 ?? read?.chunk_b64 ?? '');
    cursor = Number(read?.nextCursor ?? read?.next_cursor ?? cursor);
    if (predicate(text)) return { found: true, text, cursor, meta: lastMeta };
    await sleep(250);
  }
  return { found: false, text, cursor, meta: lastMeta };
}

try {
  await gw.login(account, password);

  // A real bound conversation so the Station row JOINs to persisted context.
  const agents = await gw.agentsList();
  const agentId = agents?.agents?.[0]?.id;
  if (!agentId) throw new Error('no agent available');
  const providerId = process.env.PT_TW_PROVIDER_ID ?? 'ollama-local';
  const modelId = process.env.PT_TW_MODEL_ID ?? 'qwen-tw';
  await gw.ensureProvider({ id: providerId, name: 'Ollama Local', baseUrl: 'http://ollama:11434/v1' });
  await gw.ensureProviderModel(providerId, { id: modelId });
  const conversation = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: 'TW D5 terminal',
  });

  // ---- T1: authorized workspace provisioned --------------------------------
  const workspaceRoot = await gw.terminalDefaultWorkspace(deviceId);
  const t1 = typeof workspaceRoot === 'string' && workspaceRoot.length > 0;
  checks.record('T1', t1, `workspaceRoot=${workspaceRoot}`);
  evidence.workspaceRoot = workspaceRoot;

  // ---- T2: spawn a long-lived PTY process in the worker --------------------
  const meta = await gw.terminalCreate(workspaceRoot, {
    command: 'sh',
    args: ['-c', `echo ${marker}; sleep 300`],
    allowedRoots: [workspaceRoot],
    cols: 100,
    rows: 30,
  });
  const sessionId = meta?.sessionId ?? meta?.session_id;
  const t2 =
    typeof sessionId === 'string' && sessionId.startsWith('terms-') &&
    meta.status === 'running' && Number(meta.pid) > 0 &&
    (meta.cwd ?? '').startsWith(workspaceRoot);
  checks.record('T2', t2,
    `session=${sessionId} pid=${meta?.pid} status=${meta?.status} cwd=${meta?.cwd}`);
  evidence.session = { id: sessionId, pid: meta?.pid, cwd: meta?.cwd };

  // ---- T3: output becomes readable and process stays alive -----------------
  const ready = await readUntil(sessionId, (t) => t.includes(marker));
  checks.record('T3', ready.found, `marker observed=${ready.found} bytes=${ready.text.length}`);

  // Simulated viewer close/reopen: wait, then read again from cursor 0. The
  // process must still be running and the ring replays history.
  await sleep(1200);
  const replay = await readUntil(sessionId, (t) => t.includes(marker), { timeoutMs: 5000 });
  const listAfterClose = await gw.terminalList();
  const liveRow = listAfterClose.find((s) => (s.sessionId ?? s.session_id) === sessionId);
  const t3b = replay.found && liveRow?.status === 'running';
  checks.record('T3b', t3b,
    `after viewer-close: process status=${liveRow?.status} ring-replay=${replay.found}`);

  // ---- T4: Station metadata row shares the worker resource id --------------
  const created = await gw.stationTerminalCreate({
    session_id: sessionId,
    conversation_id: conversation.conversation_id,
    turn_id: '',
    device_id: deviceId,
    cwd: meta.cwd,
    command: 'sh',
    args: ['-c', 'long-lived'],
    pid: Number(meta.pid),
    execution_target: EXECUTION_TARGET.DESKTOP_DEVICE,
    sandbox_ref: '',
  });
  const stationRows = await gw.stationTerminalList(conversation.conversation_id);
  const row = stationRows.find((s) => s.session_id === sessionId);
  const t4 =
    created?.session?.session_id === sessionId &&
    row?.session_id === sessionId &&
    row?.device_id === deviceId &&
    Number(row.pid) === Number(meta.pid) &&
    row.status === TERMINAL_STATUS.RUNNING &&
    (row.cwd ?? '').startsWith(workspaceRoot) &&
    row.execution_target === EXECUTION_TARGET.DESKTOP_DEVICE;
  checks.record('T4', t4,
    `station row id=${row?.session_id} pid=${row?.pid} status=${row?.status} target=${row?.execution_target} cwd=${row?.cwd}`);

  // ---- T5: kill in worker, read back terminal truth ------------------------
  await gw.terminalKill(sessionId);
  // Child reaping is asynchronous: poll the live worker handle until it
  // reports a terminal status and an exit code rather than assuming the
  // kill response already reflects the reaped process.
  let killedMeta = null;
  const killDeadline = Date.now() + 8000;
  while (Date.now() < killDeadline) {
    const rows = await gw.terminalList();
    killedMeta = rows.find((s) => (s.sessionId ?? s.session_id) === sessionId) ?? null;
    if (killedMeta && killedMeta.status !== 'running') break;
    await sleep(200);
  }
  const outputBytes = Number(killedMeta?.outputBytes ?? 0);
  const t5 =
    killedMeta?.status === 'killed' &&
    typeof killedMeta.exitCode === 'number' &&
    Number(killedMeta.pid) === Number(meta.pid) &&
    outputBytes >= marker.length;
  checks.record('T5', t5,
    `killed status=${killedMeta?.status} exit=${killedMeta?.exitCode} pid=${killedMeta?.pid} outputBytes=${outputBytes}`);

  // ---- T6: Station row synced to killed with exit code + output bytes ------
  await gw.stationTerminalUpdate({
    session_id: sessionId,
    status: 'TERMINAL_SESSION_STATUS_KILLED',
    exit_code: Number(killedMeta.exitCode ?? -1),
    output_bytes: outputBytes,
  });
  const rowsAfterKill = await gw.stationTerminalList(conversation.conversation_id);
  const deadRow = rowsAfterKill.find((s) => s.session_id === sessionId);
  const t6 =
    deadRow?.status === TERMINAL_STATUS.KILLED &&
    Number(deadRow.output_bytes) === outputBytes &&
    Number(deadRow.pid) === Number(meta.pid);
  checks.record('T6', t6,
    `station killed status=${deadRow?.status} outputBytes=${deadRow?.output_bytes} pid=${deadRow?.pid}`);
  evidence.stationFinal = deadRow;

  // ---- T7: remove on both sides leaves no row/handle -----------------------
  await gw.stationTerminalRemove(sessionId);
  await gw.terminalRemove(sessionId);
  const stationGone = (await gw.stationTerminalList(conversation.conversation_id))
    .every((s) => s.session_id !== sessionId);
  const workerGone = (await gw.terminalList())
    .every((s) => (s.sessionId ?? s.session_id) !== sessionId);
  // Reading a removed handle must be a NotFound failure (no fake session).
  let readRejected = false;
  try {
    await gw.terminalRead(sessionId, 0);
  } catch {
    readRejected = true;
  }
  checks.record('T7', stationGone && workerGone && readRejected,
    `stationGone=${stationGone} workerGone=${workerGone} readRejected=${readRejected}`);
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
}

const report = writeReport(path.join(reportDir, 'tw-d5-device-terminal.json'), {
  plan: 'TW-20261102',
  closure: 'tw-d5-device-terminal',
  outcome: 'O06',
  source_commit: process.env.PT_TW_SOURCE_COMMIT ?? gitRev(root),
  station_url: process.env.PEERS_STATION_URL ?? 'persisted-active',
  device_id: deviceId,
  pass: checks.passCount,
  fail: checks.failCount,
  results: checks.results,
  evidence,
});
console.log(`PASS=${report.pass} FAIL=${report.fail}`);
process.exit(report.fail === 0 ? 0 : 1);
