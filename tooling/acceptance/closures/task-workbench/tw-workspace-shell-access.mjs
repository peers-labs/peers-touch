#!/usr/bin/env node
// TW workspace shell authorization — headless desktop-native.
//
// Proves the machine-local shell authorization gate:
//   S1 Standard mode rejects a command outside the hard allowlist (pwd)
//      with CLIENT_CAPABILITY_COMMAND_NOT_ALLOWED (batch blocked).
//   S2 Full Access (user-granted per session) runs the same command and a
//      git WRITE subcommand (commit) successfully, with AUTO approvals.
//   S3 restoring Standard re-locks the gate (pwd denied again).
//
// The grant is set through the same gateway command the production composer
// calls; Station/tool policy is converged to AUTO alongside it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';
import { pgQuery } from './lib/pg.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';
const scratchRoot = process.env.PT_TW_SCRATCH_DIR ?? '/workspace/run';
const providerId = process.env.PT_TW_PROVIDER_ID ?? 'ark';
const modelId = process.env.PT_TW_MODEL_ID ?? 'ep-20260623145021-n4xdm';
const APPROVAL_AUTO = 3;
const APPROVAL_MANUAL = 1;
const READINESS_READY = 1;
const LOCAL_CAPS = [
  'filesystem.read', 'filesystem.list', 'filesystem.write', 'filesystem.edit',
  'shell.execute', 'shell.allowlist',
];
const COMMAND_DENIED = 'CLIENT_CAPABILITY_COMMAND_NOT_ALLOWED';

const checks = new CheckCollector();
const evidence = { provider_id: providerId, model_id: modelId };
let projectReal = null;
let locator = null;
let session = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logRetry = (error) => {
  console.log(`activation retry after: ${error?.message ?? error}`);
};
const safeJson = (v) => { try { return JSON.parse(v); } catch { return null; } };
function callArgs(call) {
  if (typeof call?.arguments === 'string') return call.arguments;
  try { return JSON.stringify(call?.arguments ?? {}); } catch { return ''; }
}

async function governedTurn(gw, conversationId, agentId, userInput) {
  return gw.runGovernedTurn(
    {
      client_idempotency_key: crypto.randomUUID(),
      conversation_id: conversationId,
      agent_id: agentId,
      user_input: userInput,
      attachments: [],
      stream: true,
      effort: 'medium',
      context_window_size: 32768,
      max_retries: 0,
      provider: providerId,
      model: modelId,
      client_capability_session_id: session.session_id,
      requested_budget: { wall_time_ms: 300_000 },
    },
    { timeoutMs: 360_000, decide: () => ({ approved: true }) },
  );
}

async function newConversation(gw, title) {
  const c = await gw.conversationCreate(evidence.agent.id, { providerId, modelName: modelId, title });
  return c.conversation_id;
}

// Retry benign command turns until the model emits the wanted command.
async function commandTurn(gw, label, userInput, wanted, tries = 3) {
  const attempts = [];
  let turn = null;
  let conversation = null;
  for (let i = 1; i <= tries; i += 1) {
    conversation = await newConversation(gw, `${label} ${i}`);
    turn = await governedTurn(gw, conversation, evidence.agent.id, userInput);
    const hit = (turn.calls ?? []).some((c) =>
      c.toolName === 'local_shell_exec' && callArgs(c).includes(wanted));
    attempts.push({ i, stage: turn.terminalStage, hit, calls: (turn.calls ?? []).map((c) => c.toolName) });
    if (hit) break;
    await sleep(1500);
  }
  return { turn, conversation, attempts };
}

async function sqlToolErrors(turnId) {
  if (!turnId) return '';
  const id = turnId.replace(/'/g, "''");
  const rows = await pgQuery(
    `SELECT error_code FROM agent_tool_results WHERE turn_id = '${id}'`,
  );
  return rows.rows.map((r) => r.error_code ?? '').join(',');
}

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
  session = sessions[0];
  evidence.session_id = session?.session_id;
  const agentList = await gw.agentsList();
  const agent = agentList?.agents?.[0];
  if (!agent) throw new Error('no agent available');
  evidence.agent = { id: agent.id, version: Number(agent.version) };

  await gw.convergeToolScope(agent.id, LOCAL_CAPS, {
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
    await sleep(1000);
  }
  readiness = await gw.capabilityReadiness(agent.id, {
    clientCapabilitySessionId: session.session_id, providerId, modelId,
  });
  const readyCaps = (readiness?.capabilities ?? []).filter((c) => c.state === READINESS_READY)
    .map((c) => c.capability_id);
  const standardReady = LOCAL_CAPS.every((id) => readyCaps.includes(id));
  checks.record('S1-readiness', standardReady, `ready=${readyCaps.join(',')}`, readiness?.selected_client_session_id ?? null);

  // Reset any state left by an earlier interrupted run (missing root, old
  // choices, full access) before preparing this run's project.
  try {
    const prior = await gw.workspaceList();
    await Promise.all((prior.choices ?? []).map((c) => gw.workspaceRemove(c.locator).catch(() => null)));
    await gw.workspaceSetShellAccess(false);
    await gw.workspaceActivate(null);
    await sleep(1000);
  } catch { /* best effort */ }

  // Prepare a temp git project and activate it.
  const stamp = crypto.randomBytes(3).toString('hex');
  const projectDir = path.join(scratchRoot, `shacc-${stamp}`);
  fs.mkdirSync(projectDir, { recursive: true });
  const added = await gw.workspaceAddDirectory(projectDir);
  projectReal = added.choices?.find((c) => c.locator.endsWith(`shacc-${stamp}`))?.locator ?? projectDir;
  let activated = null;
  for (let i = 0; i < 3 && !activated; i += 1) {
    try {
      activated = await gw.workspaceActivate(projectReal);
    } catch (error) {
      logRetry(error);
      await sleep(2000);
    }
  }
  if (!activated) throw new Error('workspace activation failed after retries');
  await sleep(1000);
  // Seed a git repo with one commit (headless env).
  {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init'], { cwd: projectDir });
    execFileSync('git', ['config', 'user.email', 'tw@example.invalid'], { cwd: projectDir });
    execFileSync('git', ['config', 'user.name', 'TW'], { cwd: projectDir });
    fs.writeFileSync(path.join(projectDir, 'seed.txt'), 'seed\n');
    execFileSync('git', ['add', 'seed.txt'], { cwd: projectDir });
    execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: projectDir });
    fs.writeFileSync(path.join(projectDir, 'work.txt'), 'pending\n');
  }
  locator = projectReal;

  // S1: Standard rejects pwd.
  const s1 = await commandTurn(
    gw,
    'TW shell S1',
    `Call local_shell_exec with command "pwd" and tell me the working directory it prints. Use no other tools.`,
    'pwd',
  );
  const s1Errors = await sqlToolErrors(s1.turn.turnId);
  const s1Denied = s1Errors.includes(COMMAND_DENIED);
  checks.record(
    'S1-standard-denies-pwd',
    s1.turn.terminalStage === 'tool_batch_blocked' && s1Denied,
    `stage=${s1.turn.terminalStage} sqlDenied=${s1Denied}`,
    s1Errors,
  );
  evidence.s1 = { attempts: s1.attempts, errors: s1Errors };

  // Grant Full Access + AUTO policy.
  const full = await gw.workspaceSetShellAccess(true);
  checks.record('S2-grant-full', full.shellAccess === 'full', `shellAccess=${full.shellAccess}`);
  await gw.convergeToolScope(agent.id, LOCAL_CAPS, {
    policy: APPROVAL_AUTO,
    agentVersion: Number(agent.version),
  });
  await sleep(3000);

  // S2a: pwd now runs (AUTO, no batch block).
  const s2a = await commandTurn(
    gw,
    'TW shell S2a',
    `Call local_shell_exec with command "pwd" and tell me the working directory it prints. Use no other tools.`,
    'pwd',
  );
  const s2aOk = s2a.turn.ok && s2a.turn.terminalStage === 'turn_completed';
  checks.record(
    'S2-full-allows-pwd',
    s2aOk,
    `stage=${s2a.turn.terminalStage} ok=${s2a.turn.ok}`,
  );

  // S2b: git WRITE (add+commit) now runs end to end.
  const s2b = await commandTurn(
    gw,
    'TW shell S2b',
    `Commit the pending change using tools, in order:
1. Call local_shell_exec with command "git" and args ["add","work.txt"].
2. Call local_shell_exec with command "git" and args ["commit","-m","tw-full-access"].
3. Call local_shell_exec with command "git" and args ["log","--oneline"].
Use no other tools and report the log.`,
    'commit',
  );
  const { execFileSync } = await import('node:child_process');
  const gitLog = execFileSync('git', ['log', '--oneline'], { cwd: projectReal }).toString();
  const s2bOk = s2b.turn.ok
    && s2b.turn.terminalStage === 'turn_completed'
    && gitLog.includes('tw-full-access');
  checks.record(
    'S2-full-allows-git-commit',
    s2bOk,
    `stage=${s2b.turn.terminalStage} committed=${gitLog.includes('tw-full-access')}`,
    gitLog.trim().split('\n').slice(0, 3).join(' | '),
  );
  evidence.s2 = {
    pwd: s2aOk,
    git_commit: s2bOk,
    s2a_attempts: s2a.attempts,
    s2b_attempts: s2b.attempts,
  };

  // S3: restore Standard re-locks pwd.
  await gw.workspaceSetShellAccess(false);
  await gw.convergeToolScope(agent.id, LOCAL_CAPS, {
    policy: APPROVAL_MANUAL,
    agentVersion: Number(agent.version),
  });
  await sleep(3000);
  const s3 = await commandTurn(
    gw,
    'TW shell S3',
    `Call local_shell_exec with command "pwd" and tell me the working directory it prints. Use no other tools.`,
    'pwd',
    4,
  );
  const s3Errors = await sqlToolErrors(s3.turn.turnId);
  const s3Denied = s3Errors.includes(COMMAND_DENIED);
  checks.record(
    'S3-restore-relocks',
    s3.turn.terminalStage === 'tool_batch_blocked' && s3Denied,
    `stage=${s3.turn.terminalStage} sqlDenied=${s3Denied}`,
    s3Errors,
  );
  evidence.s3 = { attempts: s3.attempts, errors: s3Errors };
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
} finally {
  try {
    await gw.workspaceSetShellAccess(false);
    await gw.workspaceActivate(null);
    if (locator) await gw.workspaceRemove(locator);
  } catch { /* best effort */ }
  try { fs.rmSync(projectReal ?? '', { recursive: true, force: true }); } catch { /* */ }

  const report = writeReport(path.join(reportDir, 'tw-workspace-shell-access.json'), {
    plan: 'TW-20261106-workspace-shell-access',
    closure: 'tw-workspace-shell-access',
    outcome: 'shell-authorization-gate',
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
}
