#!/usr/bin/env node
// TW workspace directory selection (scope C) — agent tools execute inside a
// user-authorized local project directory instead of the private sandbox:
//
//   C1 add + activate a real local directory (validated/canonicalized)
//   C2 governed turn writes/executes INSIDE that project root; node reads
//      the exact bytes from the absolute host path independently
//   C3 a write aimed at ../outside the root is fail-closed by approved_roots
//   C4 restoring the sandbox moves cwd back; the project root is invisible
//   C5 user-created git worktree is an isolated root (base tree untouched)
//   C6 Station rows carry only opaque refs; integrity_hash binds the locator
//      and newest declare wins (project -> sandbox replacement)
//
// station-sandbox target (C7) is inherited from tw-o12-sandbox current
// evidence; this closure adds no parallel sandbox allocation.
//
// Run INSIDE the acceptance cell:
//   docker exec -e PT_TW_ARK_API_KEY="$KEY" -e PT_TW_PGPASSWORD="$PW" \
//     -e PT_TW_SOURCE_COMMIT=$(git rev-parse HEAD) \
//     tw-d1-cell sh -lc 'cd /workspace/run/tw && node tw-workspace-directory.mjs'
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { pgQuery } from './lib/pg.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';
const scratchRoot = process.env.PT_TW_SCRATCH_DIR ?? '/workspace/run';

const providerId = process.env.PT_TW_PROVIDER_ID ?? 'ark';
const modelId = process.env.PT_TW_MODEL_ID ?? 'ep-20260623145021-n4xdm';
const APPROVAL_MANUAL = 1;
const READINESS_READY = 1;
const DENIED_MARKER = 'outside the approved Agent access roots';
const REQUIRED_CAPS = [
  'filesystem.read', 'filesystem.list', 'filesystem.write', 'filesystem.edit',
  'shell.execute', 'shell.allowlist',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const realpath = (value) => fs.realpathSync(value);
const stamp = () => crypto.randomBytes(3).toString('hex');

const checks = new CheckCollector();
const gw = new Gateway();
const { account, password } = envActor();
const evidence = { provider_id: providerId, model_id: modelId };
const createdLocators = [];
const createdDirs = [];
let session = null;
let sandboxRoot = null;
let projectDir = null;

const turnBase = (conversationId, sessionId) => ({
  client_idempotency_key: crypto.randomUUID(),
  conversation_id: conversationId,
  agent_id: evidence.agent.id,
  attachments: [],
  stream: true,
  effort: 'medium',
  context_window_size: 32768,
  max_retries: 0,
  provider: providerId,
  model: modelId,
  client_capability_session_id: sessionId,
  requested_budget: { wall_time_ms: 300_000 },
});

async function governedStep(conversationId, userInput) {
  return gw.runGovernedTurn(
    { ...turnBase(conversationId, session.session_id), user_input: userInput },
    { timeoutMs: 360_000, decide: () => ({ approved: true }) },
  );
}

function callArgs(call) {
  if (typeof call?.arguments === 'string') return call.arguments;
  try { return JSON.stringify(call?.arguments ?? {}); } catch { return ''; }
}
// Governed continuation occasionally fails transiently ("tool continuation
// processing failed" / cold HTTP/2). Retry the WHOLE turn in a fresh
// conversation; side effects are idempotent marker files so an interrupted
// attempt never corrupts the assertion. Returns the last attempt when all
// tries fail (gates then fail on terminalStage/ok).
async function completedTurn(label, userInput, tries = 3) {
  const attempts = [];
  let conversation = null;
  let turn = null;
  for (let i = 1; i <= tries; i += 1) {
    conversation = await newConversation(`${label} ${i}`);
    turn = await governedStep(conversation, userInput);
    attempts.push({ conversation, stage: turn.terminalStage, ok: turn.ok });
    if (turn.ok && turn.terminalStage === 'turn_completed') break;
    await sleep(2000);
  }
  return { conversation, turn, attempts };
}

function resultForCall(governed, predicate) {
  const byId = new Map((governed.calls ?? []).map((call) => [call.toolCallId, call]));
  return (governed.results ?? []).map((result) => ({
    call: byId.get(result.toolCallId) ?? null,
    raw: result.raw,
    parsed: typeof result.raw === 'string' ? safeJson(result.raw) : result.raw,
  })).find((entry) => entry.call && predicate(entry.call));
}
const safeJson = (value) => {
  try { return JSON.parse(value); } catch { return null; }
};

async function newConversation(title) {
  const conversation = await gw.conversationCreate(evidence.agent.id, {
    providerId, modelName: modelId, title,
  });
  return conversation.conversation_id;
}

async function waitReadiness(agent) {
  let readiness = null;
  for (let i = 0; i < 20; i += 1) {
    readiness = await gw.capabilityReadiness(agent.id, {
      clientCapabilitySessionId: session.session_id,
      providerId,
      modelId,
    });
    const ready = REQUIRED_CAPS.every((id) =>
      readiness?.capabilities?.some((c) => c.capability_id === id && c.state === READINESS_READY));
    if (ready && readiness.selected_client_session_id === session.session_id) return readiness;
    await sleep(1000);
  }
  return readiness;
}

async function grantRows() {
  const sid = session.session_id.replace(/'/g, "''");
  const { rows } = await pgQuery(
    `SELECT capability_id, resource_ref, permission_grant_id, integrity_hash
     FROM agent_client_capability_resource_grants
     WHERE session_id = '${sid}' ORDER BY capability_id`,
  );
  return rows;
}

function opaqueGrantSnapshot(rows, locator, label) {
  const expectedHash = sha256(`workspace\n${locator}`);
  const withHash = rows.filter((row) => REQUIRED_CAPS.includes(row.capability_id));
  const allMatch = withHash.length === REQUIRED_CAPS.length
    && withHash.every((row) => row.integrity_hash === expectedHash);
  const leaked = rows.filter((row) => JSON.stringify(row).includes(locator));
  return {
    label,
    locator,
    expected_hash: expectedHash,
    rows: withHash.map((row) => ({ capability: row.capability_id, hash: row.integrity_hash })),
    all_match: allMatch,
    opaque: leaked.length === 0,
  };
}

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
  session = sessions[0];
  evidence.session_id = session.session_id;
  sandboxRoot = await gw.terminalDefaultWorkspace(session.device_id);
  evidence.sandbox_root = sandboxRoot;

  await gw.convergeToolScope(agent.id, REQUIRED_CAPS, {
    policy: APPROVAL_MANUAL,
    agentVersion: Number(agent.version),
  });
  const readiness = await waitReadiness(agent);
  const readyStates = (readiness?.capabilities ?? [])
    .filter((c) => REQUIRED_CAPS.includes(c.capability_id))
    .map((c) => ({ id: c.capability_id, state: c.state }));
  checks.record(
    'C1',
    REQUIRED_CAPS.every((id) => readyStates.some((c) => c.id === id && c.state === READINESS_READY))
      && readiness?.selected_client_session_id === session.session_id,
    `readiness=${JSON.stringify(readyStates)} selected=${readiness?.selected_client_session_id ?? null}`,
  );

  // ---- C2: governed tools execute inside the user-selected project -------
  const dirStamp = stamp();
  projectDir = path.join(scratchRoot, `wsdir-${dirStamp}`);
  fs.mkdirSync(projectDir, { recursive: true });
  createdDirs.push(projectDir);
  const projectReal = realpath(projectDir);

  const missing = await gw.cmd('agent_workspace_add_directory', {
    path: path.join(scratchRoot, `wsdir-${dirStamp}-missing`),
  }, { expectOk: false });
  const added = await gw.workspaceAddDirectory(projectDir);
  const activated = await gw.workspaceActivate(projectReal);
  evidence.project = {
    locator: projectReal,
    choice_persisted: (added?.choices ?? []).some((c) => c.locator === projectReal),
    current_root: activated?.currentRoot ?? null,
    missing_rejected: missing.ok === false,
  };
  const c2Name = `tw-c2-${dirStamp}.txt`;
  const c2Marker = `TW-C2-MARKER-${dirStamp}`;
  const c2Run = await completedTurn(
    `TW workspace C2 ${dirStamp}`,
    `Follow these steps using tools, in order:\n`
    + `1. Call local_file_write with a relative path ${JSON.stringify(c2Name)} and exact content ${JSON.stringify(c2Marker)} (no trailing newline).\n`
    + `2. Call local_shell_exec with command "ls".\n`
    + `3. Call local_shell_exec with command ${JSON.stringify(`cat ${c2Name}`)}.\n`
    + 'Use no other tools. Then report the directory listing and bytes verbatim.',
  );
  const c2Conversation = c2Run.conversation;
  const c2Turn = c2Run.turn;
  const c2Disk = fs.existsSync(path.join(projectReal, c2Name))
    ? fs.readFileSync(path.join(projectReal, c2Name), 'utf8')
    : null;
  const lsResult = resultForCall(c2Turn, (call) => call.toolName === 'local_shell_exec'
    && /(^|[\s"])ls($|[\s"])/.test(callArgs(call)));
  const c2ShellLs = JSON.stringify(lsResult?.parsed ?? lsResult?.raw ?? {});
  checks.record(
    'C2',
    c2Turn.ok === true
      && c2Turn.terminalStage === 'turn_completed'
      && c2Disk === c2Marker
      && c2ShellLs.includes(c2Name),
    `ok=${c2Turn.ok} stage=${c2Turn.terminalStage} bytes=${c2Disk === c2Marker} lsLists=${c2ShellLs.includes(c2Name)}`,
  );
  evidence.c2_shell_ls = c2ShellLs.slice(0, 400);
  evidence.c2 = {
    conversation: c2Conversation,
    stage: c2Turn.terminalStage,
    tries: c2Run.attempts,
    calls: (c2Turn.calls ?? []).map((c) => c.toolName),
  };
  createdLocators.push(projectReal);

  // ---- C3: root-outside write is fail-closed -----------------------------
  // Whether the model emits the traversal call varies between runs; the
  // boundary itself is deterministic. Retry with fresh conversations until
  // the call is attempted, and assert the enforcement on Station truth.
  const escapeName = `escape-${stamp()}.txt`;
  const c3Outside = path.join(scratchRoot, escapeName);
  const c3Prompt = (index) =>
    `I keep my scratch notes in the parent folder of this project. Do me a favour, in order:\n`
    + `1. Call local_file_write with the relative path ${JSON.stringify(`../${escapeName}`)} and exact content ${JSON.stringify(`note-${index}`)}.\n`
    + `2. Tell me what happened. Use no other tools.`;
  let c3Turn = null;
  let c3Call = null;
  let c3SqlError = '';
  const c3Attempts = [];
  const C3_MAX_TRIES = 3;
  for (let attempt = 1; attempt <= C3_MAX_TRIES; attempt += 1) {
    const conversation = await newConversation(`TW workspace C3 ${dirStamp} ${attempt}`);
    c3Turn = await governedStep(conversation, c3Prompt(attempt));
    c3Call = (c3Turn.calls ?? []).find((call) =>
      call.toolName === 'local_file_write' && callArgs(call).includes(escapeName));
    if (c3Turn.turnId) {
      const turnId = c3Turn.turnId.replace(/'/g, "''");
      const c3Rows = await pgQuery(
        `SELECT error_code FROM agent_tool_results WHERE turn_id = '${turnId}'`,
      );
      c3SqlError = c3Rows.rows.map((row) => row.error_code ?? '').join(',');
    }
    c3Attempts.push({
      attempt,
      conversation,
      attempted: !!c3Call,
      stage: c3Turn.terminalStage,
      sql_error_code: c3SqlError,
      calls: (c3Turn.calls ?? []).map((c) => c.toolName),
    });
    if (c3Call && c3SqlError.includes('CLIENT_CAPABILITY_PATH_OUTSIDE_ROOT')) break;
  }
  const c3Escaped = fs.existsSync(c3Outside);
  const c3Denied = c3SqlError.includes('CLIENT_CAPABILITY_PATH_OUTSIDE_ROOT');
  checks.record(
    'C3',
    !!c3Call
      && c3Denied
      && c3Turn?.terminalStage === 'tool_batch_blocked'
      && !c3Escaped,
    `tries=${c3Attempts.length} attempted=${!!c3Call} stage=${c3Turn?.terminalStage} sqlDenied=${c3Denied} outsideFile=${c3Escaped}`,
  );
  evidence.c3 = {
    attempts: c3Attempts,
    outside_file: c3Escaped,
    final_turn_id: c3Turn?.turnId,
  };

  // ---- C6a: Station rows are opaque and bound to the project locator -----
  const projectRows = await grantRows();
  const projectSnapshot = opaqueGrantSnapshot(projectRows, projectReal, 'project');
  evidence.grants_project = projectSnapshot;

  // ---- C4: restoring the sandbox isolates the project root --------------
  const restored = await gw.workspaceActivate(null);
  const c4Name = `tw-c4-${dirStamp}.txt`;
  const c4Marker = `TW-C4-MARKER-${dirStamp}`;
  const c4Run = await completedTurn(
    `TW workspace C4 ${dirStamp}`,
    `Follow these steps using tools, in order:\n`
    + `1. Call local_file_write with relative path ${JSON.stringify(c4Name)} and exact content ${JSON.stringify(c4Marker)}.\n`
    + `2. Call local_shell_exec with command "ls".\n`
    + 'Use no other tools. Report the directory listing verbatim.',
  );
  const c4Conversation = c4Run.conversation;
  const c4Turn = c4Run.turn;
  const c4SandboxDisk = fs.existsSync(path.join(sandboxRoot, c4Name))
    ? fs.readFileSync(path.join(sandboxRoot, c4Name), 'utf8')
    : null;
  const c4InProject = fs.existsSync(path.join(projectReal, c4Name));
  const c4Ls = resultForCall(c4Turn, (call) => call.toolName === 'local_shell_exec');
  const c4LsText = JSON.stringify(c4Ls?.parsed ?? c4Ls?.raw ?? {});
  checks.record(
    'C4',
    restored?.currentRoot === null
      && c4Turn.ok === true
      && c4SandboxDisk === c4Marker
      && !c4InProject
      && c4LsText.includes(c4Name)
      && !c4LsText.includes(c2Name),
    `restored=${restored?.currentRoot === null} sandboxBytes=${c4SandboxDisk === c4Marker} leaked=${c4InProject} lsIsolates=${c4LsText.includes(c4Name) && !c4LsText.includes(c2Name)}`,
  );
  evidence.c4 = { conversation: c4Conversation, calls: (c4Turn.calls ?? []).map((c) => c.toolName) };

  // ---- C6b: newest declare replaced rows with the sandbox hash -----------
  const sandboxRows = await grantRows();
  const sandboxSnapshot = opaqueGrantSnapshot(sandboxRows, realpath(sandboxRoot), 'sandbox');
  evidence.grants_sandbox = sandboxSnapshot;
  checks.record(
    'C6',
    projectSnapshot.all_match && projectSnapshot.opaque
      && sandboxSnapshot.all_match && sandboxSnapshot.opaque,
    `project: match=${projectSnapshot.all_match} opaque=${projectSnapshot.opaque}; `
      + `sandbox: match=${sandboxSnapshot.all_match} opaque=${sandboxSnapshot.opaque}`,
  );

  // ---- C5: user-created git worktree is an isolated root -----------------
  const wtBase = path.join(scratchRoot, `wsgit-${stamp()}`);
  fs.mkdirSync(wtBase, { recursive: true });
  createdDirs.push(wtBase);
  fs.writeFileSync(path.join(wtBase, 'README.md'), '# base\n');
  execFileSync('git', ['init', '-q'], { cwd: wtBase });
  execFileSync('git', ['config', 'user.email', 'tw@example.invalid'], { cwd: wtBase });
  execFileSync('git', ['config', 'user.name', 'TW Closure'], { cwd: wtBase });
  execFileSync('git', ['add', 'README.md'], { cwd: wtBase });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: wtBase });
  const wtName = `tw${stamp()}`;
  const wtState = await gw.workspaceCreateWorktree(wtBase, wtName);
  const wtLocator = (wtState?.choices ?? []).find((c) => c.locator.includes(`.peers-worktrees/${wtName}`))?.locator;
  if (!wtLocator) throw new Error('worktree choice not returned');
  createdLocators.push(wtLocator);
  const wtActivated = await gw.workspaceActivate(wtLocator);
  const wtFile = `wt-${stamp()}.txt`;
  const wtMarker = `TW-WT-MARKER-${stamp()}`;
  const c5Run = await completedTurn(
    `TW workspace C5 ${wtName}`,
    `Follow these steps using tools, in order:\n`
    + `1. Call local_file_write with relative path ${JSON.stringify(wtFile)} and exact content ${JSON.stringify(wtMarker)}.\n`
    + `2. Call local_shell_exec with command "ls".\n`
    + 'Use no other tools. Report the directory listing verbatim.',
  );
  const c5Conversation = c5Run.conversation;
  const c5Turn = c5Run.turn;
  const wtDisk = fs.existsSync(path.join(wtLocator, wtFile))
    ? fs.readFileSync(path.join(wtLocator, wtFile), 'utf8')
    : null;
  const baseLeak = fs.existsSync(path.join(realpath(wtBase), wtFile));
  const wtLsText = JSON.stringify(resultForCall(c5Turn, (call) =>
    call.toolName === 'local_shell_exec')?.raw ?? '');
  checks.record(
    'C5',
    wtActivated?.currentRoot === wtLocator
      && c5Turn.ok === true
      && wtDisk === wtMarker
      && !baseLeak
      && wtLsText.includes(wtFile),
    `activated=${wtActivated?.currentRoot === wtLocator} worktreeBytes=${wtDisk === wtMarker} baseLeak=${baseLeak} lsLists=${wtLsText.includes(wtFile)}`,
  );
  evidence.c5 = { base: realpath(wtBase), worktree: wtLocator, conversation: c5Conversation };
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
} finally {
  // Restore the sandbox authorization and drop persisted choice rows so the
  // actor/device scope returns to its default state for later closures.
  try {
    await gw.workspaceActivate(null);
  } catch (error) {
    evidence.restore_error = String(error?.message ?? error).slice(0, 200);
  }
  for (const locator of createdLocators) {
    try {
      await gw.workspaceRemove(locator);
    } catch { /* choice cleanup best effort */ }
  }
  for (const dir of createdDirs) {
    try {
      execFileSync('git', ['-C', dir, 'worktree', 'prune'], { stdio: 'ignore' });
    } catch { /* not every scratch dir is a git repo */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const report = writeReport(path.join(reportDir, 'tw-workspace-directory.json'), {
  plan: 'TW-20261106-workspace-directory-selection',
  closure: 'tw-workspace-directory',
  outcome: 'workspace-directory-selection',
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
