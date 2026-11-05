#!/usr/bin/env node
// TW O12 (device leg) — strong-model governed local-ops loop, headless native.
//
// Proves the full Agent-Native device tool chain without a GUI, a mock, or a
// stubbed executor:
//   1. headless password login boots the SAME actor-device engine the GUI
//      activates post-login, then starts the capability supervisor and waits
//      for a real registered client capability session with GRANTED caps;
//   2. MANUAL approval bindings are converged idempotently and capability
//      readiness resolves READY against the strong-model runtime admission;
//   3. one strong-model (ARK) turn performs a repair loop across FOUR tool
//      iterations: local_file_write -> local_shell_exec(grep, MUST fail with
//      exit 1) -> local_file_edit -> local_shell_exec(grep, MUST pass exit 0);
//   4. every tool call parks on tool_approval_required; the harness submits a
//      real human decision and the Station continuation worker dispatches to
//      the desktop-rust executor (no AUTO policy anywhere);
//   5. truth is cross-checked on three independent channels: device fs bytes,
//      device-produced shell exit codes/stdout in tool_result frames, and the
//      Station-authoritative turn trace;
//   6. the final file is claimed as an AGENT_OUTPUT artifact version bound to
//      the real turn/tool-call, a COMMAND check records the real grep exit 0
//      and stdout hash, and the version is accepted as current.
//
// Run INSIDE the acceptance cell:
//   docker exec -e PT_TW_SOURCE_COMMIT=$(git rev-parse HEAD) \
//     tw-d1-cell sh -lc 'cd /workspace/run/tw && node tw-o12-ops.mjs'
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';
import { ARTIFACT_ORIGIN, ARTIFACT_CHECK_TYPE, ARTIFACT_CHECK_RESULT } from './lib/proto.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';

const providerId = process.env.PT_TW_PROVIDER_ID ?? 'ark';
const modelId = process.env.PT_TW_MODEL_ID ?? 'ep-20260623145021-n4xdm';
const APPROVAL_MANUAL = 1;
const READINESS_READY = 1;
const REQUIRED_CAPS = [
  'filesystem.write',
  'filesystem.edit',
  'filesystem.read',
  'filesystem.list',
  'shell.allowlist',
];
const EXPECTED_TOOLS = [
  'local_file_write',
  'local_shell_exec',
  'local_file_edit',
  'local_shell_exec',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const checks = new CheckCollector();
const gw = new Gateway();
const { account, password } = envActor();
const evidence = { provider_id: providerId, model_id: modelId };

try {
  await gw.login(account, password);
  const agents = await gw.agentsList();
  const agent = agents?.agents?.[0];
  if (!agent) throw new Error('no agent available');
  evidence.agent = { id: agent.id, version: Number(agent.version) };

  // ---- G1: actor-device engine + registered capability session -----------
  await gw.deviceEngineActivate();
  await gw.executorSupervisorStart();
  let sessions = [];
  for (let attempt = 0; attempt < 20 && sessions.length === 0; attempt += 1) {
    await sleep(1000);
    sessions = await gw.capabilitySessions();
  }
  const session = sessions[0];
  const grantedIds = (session?.typed_capabilities ?? []).map((c) => c.capability_id);
  const sessionOk =
    !!session?.session_id &&
    !!session?.device_id &&
    session?.lease_id &&
    ['filesystem.write', 'filesystem.edit', 'shell.allowlist']
      .every((id) => grantedIds.includes(id)) &&
    (session?.typed_capabilities ?? []).every(
      (c) => c.permission === 'CAPABILITY_PERMISSION_STATE_GRANTED',
    );
  checks.record('G1', sessionOk,
    `session=${session?.session_id ?? 'none'} device=${session?.device_id ?? 'n/a'} `
    + `lease=${session?.lease_id ?? 'n/a'} granted=[${grantedIds.join(',')}]`);
  evidence.capability_session = {
    id: session?.session_id ?? null,
    device_id: session?.device_id ?? null,
    lease_id: session?.lease_id ?? null,
    granted: grantedIds,
  };

  // ---- G2: converge MANUAL bindings + READY readiness --------------------
  const existing = await gw.capabilityBindings(agent.id);
  const bindings = [];
  for (const capabilityId of REQUIRED_CAPS) {
    const current = existing.find((b) => b.capability_id === capabilityId && b.enabled);
    const binding = await gw.capabilityBindingUpsert({
      binding_id: current?.binding_id ?? '',
      agent_id: agent.id,
      capability_id: capabilityId,
      capability_version: current?.capability_version ?? '1',
      enabled: true,
      approval_policy: APPROVAL_MANUAL,
      expected_agent_version: Number(agent.version),
    }, current?.revision ?? 0);
    bindings.push(binding);
  }
  const bindingsManual = bindings.every((b) => b.enabled && b.approval_policy === APPROVAL_MANUAL);
  checks.record('G2a', bindingsManual,
    `bindings=${bindings.map((b) => `${b.capability_id}:policy${b.approval_policy}:rev${b.revision}`).join(' ')}`);

  let snapshot = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await sleep(1000);
    snapshot = await gw.capabilityReadiness(agent.id, {
      clientCapabilitySessionId: session.session_id,
      providerId,
      modelId,
    });
    const requiredReady = REQUIRED_CAPS.every((capabilityId) =>
      snapshot.capabilities?.some(
        (c) => c.capability_id === capabilityId && c.state === READINESS_READY,
      ));
    if (requiredReady && snapshot.selected_client_session_id === session.session_id) break;
  }
  const readyCaps = (snapshot?.capabilities ?? [])
    .filter((c) => REQUIRED_CAPS.includes(c.capability_id));
  const readinessOk =
    snapshot?.selected_client_session_id === session.session_id &&
    readyCaps.length === REQUIRED_CAPS.length &&
    readyCaps.every((c) => c.state === READINESS_READY);
  checks.record('G2b', readinessOk,
    `snapshot=${snapshot?.snapshot_id ?? 'none'} selected=${snapshot?.selected_client_session_id ?? 'n/a'} `
    + `ready=[${readyCaps.map((c) => `${c.capability_id}:${c.state}`).join(',')}]`);
  evidence.readiness = {
    snapshot_id: snapshot?.snapshot_id ?? null,
    runtime_snapshot_id: snapshot?.runtime_snapshot_id ?? null,
    capabilities: readyCaps.map((c) => ({
      capability_id: c.capability_id,
      state: c.state,
      binding_id: c.binding_id,
      binding_revision: c.binding_revision,
      reason_code: c.reason_code,
    })),
  };

  // ---- G3-G8: governed repair loop in one strong-model turn ---------------
  const workspaceRoot = await gw.terminalDefaultWorkspace(session.device_id);
  const conversation = await gw.conversationCreate(agent.id, {
    providerId,
    modelName: modelId,
    title: `TW O12 ops ${crypto.randomUUID().slice(0, 8)}`,
  });
  const stamp = crypto.randomBytes(3).toString('hex');
  const fileName = `o12ops-${stamp}.txt`;
  evidence.workspace_root = workspaceRoot;
  evidence.file_name = fileName;

  let expectedCursor = 0;
  const governed = await gw.runGovernedTurn({
    client_idempotency_key: crypto.randomUUID(),
    conversation_id: conversation.conversation_id,
    agent_id: agent.id,
    user_input:
      'Follow these steps strictly using your tools, all paths at workspace root:\n'
      + `1. Use local_file_write to create file "${fileName}" with content "STATE=red\\n".\n`
      + `2. Use local_shell_exec with command "grep" and args ["STATE=green", "${fileName}"]; `
      + 'it MUST exit non-zero because the line does not exist yet.\n'
      + `3. Use local_file_edit on "${fileName}" replacing exactly "STATE=red" with "STATE=green".\n`
      + '4. Run the same grep again; it MUST exit 0 and print STATE=green.\n'
      + 'Then report both grep exit codes in one short sentence.',
    attachments: [],
    stream: true,
    effort: 'medium',
    context_window_size: 32768,
    max_retries: 0,
    provider: providerId,
    model: modelId,
    client_capability_session_id: session.session_id,
  }, {
    decide: (frame) => {
      const expected = EXPECTED_TOOLS[expectedCursor];
      expectedCursor += 1;
      // fail-closed: any tool outside the governed repair plan is never
      // auto-approved; leave it parked and let the closure fail.
      if (frame.toolName !== expected) return null;
      return { approved: true };
    },
  });
  evidence.turn_id = governed.turnId;
  evidence.terminal_stage = governed.terminalStage;

  const callNames = governed.calls.map((c) => c.toolName);
  checks.record('G3',
    governed.ok && callNames.length === EXPECTED_TOOLS.length
      && EXPECTED_TOOLS.every((name, index) => callNames[index] === name),
    `terminal=${governed.terminalStage} calls=[${callNames.join(',')}]`);

  const decisionsAccepted = governed.decisions.every(
    (d) => d?.accepted === true && d?.approved === true,
  );
  const approvalsCoverCalls = governed.approvals.length === EXPECTED_TOOLS.length
    && governed.approvals.every((frame, index) => frame.toolName === EXPECTED_TOOLS[index]);
  checks.record('G4',
    approvalsCoverCalls && decisionsAccepted
      && governed.decisions.every((d) => Number(d.decision_revision) === 1),
    `approvals=${governed.approvals.length} decisions=[${governed.decisions
      .map((d) => `${d.approved ? 'ok' : 'denied'}:rev${d.decision_revision}`).join(',')}]`);
  evidence.governance = {
    approvals: governed.approvals.map((frame) => ({
      seq: frame.seq,
      tool: frame.toolName,
      approval_id: frame.approvalId,
      decision_revision: frame.decisionRevision,
    })),
    decisions: governed.decisions.map((d) => ({
      accepted: d.accepted,
      approved: d.approved,
      decision_revision: Number(d.decision_revision),
      error_code: d.error_code,
    })),
  };

  const byCall = new Map();
  for (const call of governed.calls) byCall.set(call.toolCallId, call);
  const resultsByTool = governed.results.map((r) => ({
    tool: byCall.get(r.toolCallId)?.toolName ?? 'unknown',
    output: r.parsed?.output ?? null,
    wrapperOk: r.parsed?.ok ?? false,
  }));
  const writeResult = resultsByTool.find((r) => r.tool === 'local_file_write');
  const grepFail = resultsByTool.filter((r) => r.tool === 'local_shell_exec')[0];
  const editResult = resultsByTool.find((r) => r.tool === 'local_file_edit');
  const grepPass = resultsByTool.filter((r) => r.tool === 'local_shell_exec')[1];
  const realExitLoop =
    writeResult?.wrapperOk === true
    && writeResult.output?.artifacts?.[0]?.change_type === 'created'
    && editResult?.wrapperOk === true
    && grepFail?.output?.exit_code === 1
    && grepPass?.output?.exit_code === 0
    && String(grepPass.output?.stdout ?? '').includes('STATE=green');
  checks.record('G5', realExitLoop,
    `write=${writeResult?.output?.artifacts?.[0]?.change_type ?? 'missing'} `
    + `grep1.exit=${grepFail?.output?.exit_code ?? 'missing'} `
    + `edit=${editResult?.wrapperOk ?? false} `
    + `grep2.exit=${grepPass?.output?.exit_code ?? 'missing'} `
    + `grep2.stdout=${JSON.stringify(String(grepPass?.output?.stdout ?? '').trim())}`);
  evidence.tool_results = resultsByTool.map((r) => ({
    tool: r.tool,
    ok: r.wrapperOk,
    exit_code: r.output?.exit_code ?? null,
    stdout: r.output?.stdout ?? null,
    failure_reason: r.output?.failure_reason ?? null,
    artifact_sha: r.output?.artifacts?.[0]?.sha256 ?? null,
    duration_ms: r.output?.duration_ms ?? null,
  }));

  // ---- G6: Station-authoritative trace (independent server channel) -------
  await sleep(500);
  const trace = await gw.turnTrace(governed.turnId);
  const traceTurn = trace?.turn ?? {};
  const traceOk =
    /TURN_STATUS_COMPLETED/.test(String(traceTurn.status)) &&
    Number(traceTurn.tool_iterations) >= EXPECTED_TOOLS.length;
  checks.record('G6', traceOk,
    `trace.status=${traceTurn.status} tool_iterations=${traceTurn.tool_iterations} provider_calls=${trace?.trace?.provider_calls?.length ?? 0}`);
  evidence.trace = {
    status: traceTurn.status,
    tool_iterations: traceTurn.tool_iterations,
    trace_id: trace?.trace?.trace_id ?? null,
    provider_calls: trace?.trace?.provider_calls ?? [],
  };

  // ---- G7: device-fs truth, independent of SSE ----------------------------
  const finalBytes = await fs.readFile(path.join(workspaceRoot, fileName), 'utf8');
  const finalSha = sha256(Buffer.from(finalBytes, 'utf8'));
  const deviceWriteSha = writeResult.output?.artifacts?.[0]?.sha256;
  const deviceEditSha = editResult.output?.artifacts?.[0]?.sha256;
  const fsOk = finalBytes.trim() === 'STATE=green'
    && deviceEditSha === finalSha
    && deviceWriteSha !== finalSha;
  checks.record('G7', fsOk,
    `bytes=${JSON.stringify(finalBytes)} sha=${finalSha.slice(0, 12)} `
    + `writeShaDiffer=${deviceWriteSha !== finalSha} editHashMatches=${deviceEditSha === finalSha}`);

  // ---- G8: model final answer acknowledges both real exit codes -----------
  const messages = await gw.conversationMessages(conversation.conversation_id);
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  const finalText = String(
    assistantMessages.at(-1)?.content ?? assistantMessages.at(-1)?.text ?? '',
  );
  const summaryOk = /first grep[^.,\n]*\b1\b/i.test(finalText)
    && /second grep[^.,\n]*\b0\b/i.test(finalText);
  checks.record('G8', summaryOk, `final=${JSON.stringify(finalText.slice(0, 220))}`);
  evidence.final_assistant_text = finalText;

  // ---- G9: artifact claim + real COMMAND check + acceptance ---------------
  const editCallId = governed.calls.find((c) => c.toolName === 'local_file_edit')?.toolCallId;
  const claim = await gw.artifactClaimVersion({
    conversation_id: conversation.conversation_id,
    artifact_id: '',
    kind: 'LOGICAL_ARTIFACT_KIND_DOCUMENT',
    name: fileName,
    expected_base_version_id: '',
    origin: 'ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT',
    source_turn_id: governed.turnId,
    source_message_id: '',
    body: finalBytes,
    content_type: 'text/plain',
    summary: 'governed local-ops repair: red -> green after failing then passing grep',
    feedback_id: '',
    adopted_attachment_refs: [],
    client_idempotency_key: crypto.randomUUID(),
    source_tool_call_id: editCallId,
  });
  const artifactId = claim.artifact?.artifact_id;
  const versionId = claim.version?.version_id;
  const claimOk =
    claim.version?.seq === 1
    && claim.version?.origin === ARTIFACT_ORIGIN.AGENT_OUTPUT
    && claim.version?.sha256 === finalSha
    && claim.version?.source_tool_call_id === editCallId
    && claim.version?.source_turn_id === governed.turnId;

  // Station verifies command checks against the PERSISTED bounded tool-result
  // envelope: digest, command echo and exit code must all match the row the
  // device worker settled. The SSE tool_result `result` string is exactly
  // that envelope, so hash it verbatim (never the stdout alone).
  const grepPassCallId = governed.calls.at(-1)?.toolCallId;
  const grepPassRaw = governed.results.find((r) => r.toolCallId === grepPassCallId)?.raw ?? '';
  const commandOutputSha = sha256(Buffer.from(grepPassRaw, 'utf8'));
  await gw.artifactRecordCheck({
    artifact_id: artifactId,
    version_id: versionId,
    check_type: 'ARTIFACT_CHECK_TYPE_COMMAND',
    result: 'ARTIFACT_CHECK_RESULT_PASSED',
    detail: `grep STATE=green ${fileName} (device executor, governed turn)`,
    environment: 'acceptance-cell',
    client_idempotency_key: crypto.randomUUID(),
    source_tool_call_id: grepPassCallId,
    command: 'grep',
    command_exit_code: 0,
    command_output_sha256: commandOutputSha,
  });
  const recordedChecks = await gw.artifactChecks(artifactId);
  const commandCheck = recordedChecks.find(
    (c) => c.check_type === ARTIFACT_CHECK_TYPE.COMMAND,
  );
  // proto3 omits int32 zero on the wire, so a passing exit-code-0 check reads
  // back as an absent field: normalize undefined to 0.
  const checkOk =
    commandCheck?.result === ARTIFACT_CHECK_RESULT.PASSED
    && Number(commandCheck?.command_exit_code ?? 0) === 0
    && commandCheck?.command_output_sha256 === commandOutputSha
    && commandCheck?.command === 'grep'
    && commandCheck?.sha256 === finalSha;

  await gw.artifactAccept({
    artifact_id: artifactId,
    version_id: versionId,
    client_idempotency_key: crypto.randomUUID(),
  });
  const acceptances = await gw.artifactAcceptances(artifactId);
  const acceptedCurrent = acceptances.some(
    (a) => a.current === true && a.version_id === versionId,
  );
  checks.record('G9', claimOk && checkOk && acceptedCurrent,
    `artifact=${artifactId} v=${versionId} claim=${claimOk} `
    + `commandCheck=${checkOk} (stdoutSha=${commandOutputSha.slice(0, 12)}) accepted=${acceptedCurrent}`);
  evidence.artifact = {
    id: artifactId,
    version_id: versionId,
    sha256: finalSha,
    source_tool_call_id: editCallId,
    command_output_sha256: commandOutputSha,
  };
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
}

const report = writeReport(path.join(reportDir, 'tw-o12-ops.json'), {
  plan: 'TW-20261102',
  closure: 'tw-o12-ops',
  outcome: 'O12-device-ops',
  source_commit: process.env.PT_TW_SOURCE_COMMIT ?? gitRev(root),
  station_url: process.env.PEERS_STATION_URL ?? 'persisted-active',
  provider_id: providerId,
  model_id: modelId,
  pass: checks.passCount,
  fail: checks.failCount,
  results: checks.results,
  evidence,
});
console.log(`PASS=${report.pass} FAIL=${report.fail}`);
process.exit(report.fail === 0 ? 0 : 1);
