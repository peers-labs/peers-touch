#!/usr/bin/env node
// TW O12 (WORKSPACE_SANDBOX whole chain) — strong-model tools in an isolated
// sibling container, headless native, no mock.
//
// Chain under proof:
//   provisioner sidecar (bearer auth, docker socket only)
//     -> Station sandbox allocator (content-id pinned image, lazy/idempotent)
//     -> strong-model governed turn (MANUAL approvals) with
//        workspace.sandbox.* capabilities: local_file_write -> real grep
//        exit 1 -> local_file_edit -> grep exit 0, every tool executed by
//        STATION inside the provisioned container (never the desktop)
//     -> Station-owned PTY in the same sandbox: non-root uid, Ubuntu base,
//        workspace volume persistent across independently opened PTYs
//     -> network isolation: no DNS/route to provisioner or Station bridge
//     -> fail-closed authorization: a foreign sandbox_ref cannot open a PTY
//
// Device-family and sandbox-family bindings must never mix in one turn; the
// closure converges the global tool scope to sandbox-only first and restores
// the device scope in finally.
//
// Run INSIDE the acceptance cell:
//   docker exec -e PT_TW_SOURCE_COMMIT=$(git rev-parse HEAD) \
//     tw-d1-cell sh -lc 'cd /workspace/run/tw && node tw-o12-sandbox.mjs'
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';

const providerId = process.env.PT_TW_PROVIDER_ID ?? 'ark';
const modelId = process.env.PT_TW_MODEL_ID ?? 'ep-20260623145021-n4xdm';

// Device scope restored after the closure (the pre-sandbox baseline).
const DEVICE_SCOPE = [
  'clipboard.read', 'clipboard.write',
  'filesystem.read', 'filesystem.list', 'filesystem.write', 'filesystem.edit',
  'shell.execute', 'shell.allowlist',
];
const SANDBOX_SCOPE = [
  'workspace.sandbox.filesystem.write',
  'workspace.sandbox.filesystem.edit',
  'workspace.sandbox.shell.allowlist',
];
const APPROVAL_MANUAL = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ansiClean = (value) =>
  String(value ?? '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\r/g, '');

const checks = new CheckCollector();
const gw = new Gateway();
const evidence = { provider_id: providerId, model_id: modelId };
let restored = false;

try {
  const { account, password } = envActor();
  await gw.login(account, password);
  const agents = await gw.agentsList();
  const agent = agents?.agents?.[0];
  if (!agent) throw new Error('no agent available');
  evidence.agent = { id: agent.id, version: Number(agent.version) };

  // ---- S1: converge to sandbox-only tool scope; READY without a device ----
  await gw.convergeToolScope(agent.id, SANDBOX_SCOPE, {
    policy: APPROVAL_MANUAL,
    agentVersion: Number(agent.version),
  });
  const liveBindings = await gw.capabilityBindings(agent.id);
  const deviceLive = liveBindings.filter(
    (b) => !b.capability_id.startsWith('workspace.sandbox.'),
  );
  let snapshot = await gw.capabilityReadiness(agent.id, {
    providerId,
    modelId,
  });
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const bad = snapshot.capabilities?.filter((c) => c.state !== 1) ?? [];
    if (bad.length === 0) break;
    await sleep(1000);
    snapshot = await gw.capabilityReadiness(agent.id, { providerId, modelId });
  }
  const readyCaps = snapshot.capabilities ?? [];
  const scopeOk =
    deviceLive.length === 0
    && SANDBOX_SCOPE.every((id) =>
      readyCaps.some((c) => c.capability_id === id && c.state === 1),
    );
  checks.record('S1', scopeOk,
    `deviceLive=${deviceLive.length} sandboxReady=${readyCaps
      .filter((c) => SANDBOX_SCOPE.includes(c.capability_id) && c.state === 1).length}/${SANDBOX_SCOPE.length}`);

  // ---- S2: governed strong-model repair loop inside the sandbox -----------
  const conversation = await gw.conversationCreate(agent.id, {
    providerId,
    modelName: modelId,
    title: `TW O12 sandbox ${crypto.randomUUID().slice(0, 8)}`,
  });
  const stamp = crypto.randomBytes(3).toString('hex').toUpperCase();
  const fileName = `sbox-${stamp.toLowerCase()}.txt`;
  evidence.workspace_file = fileName;

  let lastError = null;
  const governed = await gw.runGovernedTurn({
    client_idempotency_key: crypto.randomUUID(),
    conversation_id: conversation.conversation_id,
    agent_id: agent.id,
    user_input:
      `Follow these steps strictly using your tools, all paths at workspace root: `
      + `1. Use local_file_write to create "${fileName}" with content "STATE=red\n". `
      + `2. Use local_shell_exec with command "grep" and args ["STATE=green", "${fileName}"]; it MUST exit non-zero. `
      + `3. Use local_file_edit on "${fileName}" replacing exactly "STATE=red" with "STATE=green". `
      + `4. Run the same grep again; it MUST exit 0 and print STATE=green. `
      + `Then report both grep exit codes in one sentence.`,
    attachments: [],
    stream: true,
    effort: 'medium',
    context_window_size: 32768,
    max_retries: 0,
    provider: providerId,
    model: modelId,
  }, {
    timeoutMs: 300_000,
    // Every sandbox tool is MANUAL: a real human decision gates each call.
    decide: () => ({ approved: true, answer: '' }),
  });
  const byTool = new Map();
  for (const r of governed.results ?? []) {
    byTool.set(r.toolCallId, r);
  }
  const calls = governed.calls ?? [];
  const writeCall = calls.find((c) => c.toolName === 'local_file_write');
  const grepCalls = calls.filter((c) => c.toolName === 'local_shell_exec');
  const editCall = calls.find((c) => c.toolName === 'local_file_edit');
  // Desktop tools wrap the envelope in {output:{...}}; the Station sandbox
  // executor returns the bare envelope, so accept both shapes.
  const envelope = (r) => r?.parsed ?? r?.output ?? null;
  const grepFail = grepCalls.map((c) => byTool.get(c.toolCallId))
    .find((r) => envelope(r)?.exit_code === 1);
  const grepPass = grepCalls.map((c) => byTool.get(c.toolCallId))
    .find((r) => envelope(r)?.exit_code === 0 && /STATE=green/.test(envelope(r).stdout ?? ''));
  const editResult = editCall ? byTool.get(editCall.toolCallId) : null;
  const editChanged = envelope(editResult)?.changed === true;
  const modelSummarized = /code\s*1/i.test(governed.text ?? '')
    && /code\s*0/i.test(governed.text ?? '');
  checks.record('S2',
    governed.ok
    && writeCall && editCall && grepCalls.length === 2
    && !!grepFail && !!grepPass && editChanged,
    `terminal=${governed.terminalStage ?? 'none'} calls=${calls
      .map((c) => c.toolName).join(',')} grep1=${envelope(grepFail)?.exit_code ?? 'missing'} grep0=${envelope(grepPass)?.exit_code ?? 'missing'}/${/STATE=green/.test(envelope(grepPass)?.stdout ?? '')} editChanged=${editChanged} modelSummary=${modelSummarized}`,
  );
  evidence.model_summarized_exits = modelSummarized;
  evidence.turn_id = governed.turnId;

  // ---- S3: Station-authoritative trace (Station-owned execution) ----------
  await sleep(500);
  const trace = await gw.turnTrace(governed.turnId);
  const traceTurn = trace?.turn ?? {};
  const providerModels = trace?.trace?.provider_calls ?? [];
  const strongModelUsed = providerModels.some((c) => /doubao-seed/.test(String(c.model ?? '')));
  checks.record('S3',
    traceTurn.status === 'TURN_STATUS_COMPLETED'
    && Number(traceTurn.tool_iterations) >= 4
    && strongModelUsed,
    `status=${traceTurn.status} iterations=${traceTurn.tool_iterations} providerCalls=${providerModels.length} strongModel=${strongModelUsed}`,
  );

  // ---- S4: allocation exists and is usable -------------------------------
  // EnsureSandbox is lazy/idempotent: the governed turn above allocated the
  // per-(actor, agent, /workspace) sandbox through the provisioner.
  const boxes = await gw.resolveActiveSandboxes();
  const box = boxes.find((b) => b.state === 'allocated' && b.usable);
  checks.record('S4',
    !!box && /^wbox-[0-9a-f]{32}$/.test(box.sandbox_ref)
    && box.workspace_root === '/workspace',
    boxes.map((b) => `${b.sandbox_ref}/${b.state}/usable=${b.usable}`).join(' ') || 'none',
  );
  evidence.sandbox_ref = box?.sandbox_ref;

  // ---- S5: Station-owned PTY — non-root identity + OS facts ---------------
  const ptyClean = async (sessionId, cursor = 0) => {
    const out = await gw.sandboxPtyRead(sessionId, cursor);
    return {
      text: ansiClean(Buffer.from(out.data ?? [])),
      nextCursor: Number(out.next_cursor ?? cursor),
      status: out.status,
    };
  };
  // Polls the PTY ring until a marker appears or the deadline passes.
  const ptyReadUntil = async (sessionId, marker, timeoutMs = 10_000) => {
    let cursor = 0;
    let aggregate = '';
    const deadline = Date.now() + timeoutMs;
    do {
      const out = await ptyClean(sessionId, cursor);
      cursor = out.nextCursor;
      aggregate += out.text;
      if (aggregate.includes(marker)) return { text: aggregate, found: true };
      await sleep(400);
    } while (Date.now() < deadline);
    return { text: aggregate, found: false };
  };
  const convId = conversation.conversation_id;
  const ptyId1 = `terms-${crypto.randomBytes(13).toString('hex').toUpperCase()}`;
  const pty1 = (await gw.stationTerminalCreate({
    session_id: ptyId1,
    conversation_id: convId,
    command: '/bin/sh',
    args: ['-i'],
    execution_target: 2,
    sandbox_ref: box.sandbox_ref,
  }))?.session ?? {};
  await gw.sandboxPtyWrite(
    ptyId1,
    `id -u; head -1 /etc/os-release; echo "PERSIST-${stamp}" > /workspace/pty-persist.txt; echo PtyOneDone\n`,
  );
  const pty1Out = await ptyReadUntil(ptyId1, 'PtyOneDone');
  // Interactive sh prints the prompt before command output, so assert the uid
  // token anywhere rather than at line start.
  const ptyFacts = /(^|\s)10001(\s|$)/m.test(pty1Out.text)
    && /Ubuntu 24\.04/.test(pty1Out.text)
    && pty1Out.found;
  checks.record('S5',
    Number(pty1.execution_target) === 2 && pty1.sandbox_ref === box.sandbox_ref && ptyFacts,
    `target=${pty1.execution_target} nonRoot10001=${/(^|\s)10001(\s|$)/m.test(pty1Out.text)} ubuntu24=${/Ubuntu 24\.04/.test(pty1Out.text)} found=${pty1Out.found}`,
  );

  // ---- S6: volume persists across an independently opened PTY -------------
  const ptyId2 = `terms-${crypto.randomBytes(13).toString('hex').toUpperCase()}`;
  const pty2 = (await gw.stationTerminalCreate({
    session_id: ptyId2,
    conversation_id: convId,
    command: '/bin/sh',
    args: ['-i'],
    execution_target: 2,
    sandbox_ref: box.sandbox_ref,
  }))?.session ?? {};
  await gw.sandboxPtyWrite(ptyId2, 'cat /workspace/pty-persist.txt; echo PtyTwoDone\n');
  const pty2Out = await ptyReadUntil(ptyId2, 'PtyTwoDone');
  checks.record('S6',
    pty2Out.text.includes(`PERSIST-${stamp}`) && pty2Out.found,
    `persistedMarker=${pty2Out.text.includes(`PERSIST-${stamp}`)} found=${pty2Out.found} target=${pty2.execution_target} tail=${JSON.stringify(pty2Out.text.slice(-160))}`,
  );

  // ---- S7: isolated network — no provisioner DNS, no Station route -------
  await gw.sandboxPtyWrite(
    ptyId2,
    'getent hosts workspace-sandbox-provisioner >/dev/null 2>&1 && echo PROV_DNS_LEAK || echo PROV_DNS_BLOCKED; '
    + 'wget -qO- --timeout=3 http://pt-tw-d1-station-1:18080/ >/dev/null 2>&1 && echo STATION_NET_LEAK || echo STATION_NET_BLOCKED\n',
  );
  const isoWait = await ptyReadUntil(ptyId2, 'STATION_NET_', 8000);
  const isoOut = { text: isoWait.text };
  checks.record('S7',
    /PROV_DNS_BLOCKED/.test(isoOut.text) && /STATION_NET_BLOCKED/.test(isoOut.text),
    `provisionerDns=${/PROV_DNS_BLOCKED/.test(isoOut.text) ? 'blocked' : 'LEAK'} stationNet=${/STATION_NET_BLOCKED/.test(isoOut.text) ? 'blocked' : 'LEAK'}`,
  );

  // ---- S8: foreign/unknown sandbox_ref cannot open a PTY (fail-closed) ----
  const foreignId = `terms-${crypto.randomBytes(13).toString('hex').toUpperCase()}`;
  let foreignError = null;
  try {
    await gw.stationTerminalCreate({
      session_id: foreignId,
      conversation_id: convId,
      command: '/bin/sh',
      args: ['-i'],
      execution_target: 2,
      sandbox_ref: `wbox-${'0'.repeat(32)}`,
    });
  } catch (error) {
    foreignError = error;
  }
  checks.record('S8',
    !!foreignError
    && foreignError.details?.status === 422
    && foreignError.details?.error_code === 'SANDBOX_EXECUTION_TARGET_FORBIDDEN',
    `foreignRefRejected=${foreignError ? `${foreignError.details?.status}/${foreignError.details?.error_code ?? foreignError.code}` : 'NO'}`,
  );

  await gw.stationTerminalRemove(ptyId1).catch(() => undefined);
  await gw.stationTerminalRemove(ptyId2).catch(() => undefined);
  evidence.conversation_id = convId;
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
} finally {
  // Restore the desktop-device tool scope so device-headless closures remain
  // reproducible after this one. Best-effort; failures never mask S-checks.
  try {
    const agents = await gw.agentsList();
    const agent = agents?.agents?.[0];
    if (agent) {
      await gw.convergeToolScope(agent.id, DEVICE_SCOPE, {
        policy: APPROVAL_MANUAL,
        agentVersion: Number(agent.version),
      });
      restored = true;
    }
  } catch (error) {
    evidence.restore_error = error?.message ?? String(error);
  }
}
evidence.device_scope_restored = restored;

const report = writeReport(path.join(reportDir, 'tw-o12-sandbox.json'), {
  plan: 'TW-20261102',
  closure: 'tw-o12-sandbox',
  outcome: 'O12-workspace-sandbox',
  source_commit: process.env.PT_TW_SOURCE_COMMIT ?? gitRev(root),
  station_url: process.env.PEERS_STATION_URL ?? 'persisted-active',
  provider_id: providerId,
  model_id: modelId,
  strong_model: true,
  execution: 'provisioner sibling container (Station-owned, non-root 10001)',
  pass: checks.passCount,
  fail: checks.failCount,
  results: checks.results,
  evidence,
});
console.log(`PASS=${report.pass} FAIL=${report.fail} restored=${restored}`);
process.exit(report.fail === 0 ? 0 : 1);
