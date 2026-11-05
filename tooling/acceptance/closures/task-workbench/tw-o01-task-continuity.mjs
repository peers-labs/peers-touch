#!/usr/bin/env node
// TW-O01 — one task is one continuous conversation line, headless native.
//
// Proves the product-level continuity contract without a GUI: two task lines
// are two distinct canonical conversations with stable ids; a follow-up is a
// NEW TURN on the SAME conversation (history accumulates, id unchanged);
// switching to the other line and back neither merges nor loses history; each
// line's messages stay isolated. Internal executor threads are never user
// sessions — only persisted conversations are observable here.
//
// Run INSIDE the acceptance cell:
//   docker exec -i tw-d1-cell node --input-type=module - < this-file
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';

const providerId = process.env.PT_TW_PROVIDER_ID ?? 'ollama-local';
const providerBaseUrl = process.env.PT_TW_PROVIDER_BASE_URL ?? 'http://ollama:11434/v1';
const modelId = process.env.PT_TW_MODEL_ID ?? 'qwen-tw';

const checks = new CheckCollector();
const gw = new Gateway();
const { account, password } = envActor();
const evidence = { lines: [] };

const turnBody = (conversationId, agentId, marker) => ({
  client_idempotency_key: crypto.randomUUID(),
  conversation_id: conversationId,
  agent_id: agentId,
  user_input: `Reply with exactly one word. Marker ${marker}.`,
  attachments: [],
  stream: true,
  effort: 'medium',
  context_window_size: 8192,
  max_retries: 0,
  provider: providerId,
  model: modelId,
});

async function runRealTurn(conversationId, agentId, marker) {
  const result = await gw.runTurn(turnBody(conversationId, agentId, marker));
  return {
    ok: result.ok && result.done?.stage === 'turn_completed',
    turnId: result.done?.turnId ?? result.frames.find((f) => f.turnId)?.turnId ?? null,
  };
}

try {
  await gw.login(account, password);
  await gw.ensureProvider({ id: providerId, name: 'Ollama Local', baseUrl: providerBaseUrl });
  await gw.ensureProviderModel(providerId, { id: modelId });

  const agents = await gw.agentsList();
  const agentId = agents?.agents?.[0]?.id;
  if (!agentId) throw new Error('no agent available');

  const run = crypto.randomUUID().slice(0, 8);

  // ---- L1: two task lines are two distinct canonical conversations ---------
  const lineA = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: `O01 line A ${run}`,
  });
  const lineB = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: `O01 line B ${run}`,
  });
  const distinct =
    lineA?.conversation_id && lineB?.conversation_id &&
    lineA.conversation_id !== lineB.conversation_id;
  checks.record('L1', !!distinct,
    `lineA=${lineA?.conversation_id} lineB=${lineB?.conversation_id} distinct=${!!distinct}`);

  // ---- L2: first + follow-up turns accumulate on the SAME line -------------
  const t1 = await runRealTurn(lineA.conversation_id, agentId, `A1-${run}`);
  const t2 = await runRealTurn(lineA.conversation_id, agentId, `A2-${run}`);
  const msgsA = await gw.conversationMessages(lineA.conversation_id);
  const turnIdsA = [...new Set(msgsA.map((m) => m.turn_id).filter(Boolean))];
  const l2 =
    t1.ok && t2.ok &&
    t1.turnId !== t2.turnId &&
    msgsA.length === 4 &&
    turnIdsA.length === 2 &&
    msgsA.filter((m) => m.role === 'user').length === 2 &&
    msgsA.filter((m) => m.role === 'assistant').length === 2;
  checks.record('L2', l2,
    `lineA two-turn history msgs=${msgsA.length} distinctTurns=${turnIdsA.length} turns=[${t1.turnId},${t2.turnId}]`);

  // ---- L3: the other line is independent; run its own turn -----------------
  const tb1 = await runRealTurn(lineB.conversation_id, agentId, `B1-${run}`);
  const msgsB = await gw.conversationMessages(lineB.conversation_id);
  const isolated =
    tb1.ok &&
    msgsB.length === 2 &&
    !msgsB.some((m) => m.turn_id === t1.turnId || m.turn_id === t2.turnId) &&
    !msgsA.some((m) => m.turn_id === tb1.turnId);
  checks.record('L3', isolated,
    `lineB msgs=${msgsB.length} noTurnLeak=${!msgsB.some((m) => [t1.turnId, t2.turnId].includes(m.turn_id))}`);

  // ---- L4: "switch back" re-reads stable canonical ids + preserved history -
  const listed = await gw.conversationList(agentId);
  const listedA = listed.find((c) => c.conversation_id === lineA.conversation_id);
  const listedB = listed.find((c) => c.conversation_id === lineB.conversation_id);
  const againA = await gw.conversationMessages(lineA.conversation_id);
  const againB = await gw.conversationMessages(lineB.conversation_id);
  const stable =
    listedA?.conversation_id === lineA.conversation_id &&
    listedB?.conversation_id === lineB.conversation_id &&
    againA.length === 4 && againB.length === 2;
  checks.record('L4', stable,
    `after switch-back: listKeepsBoth=${!!listedA && !!listedB} lineA=${againA.length}msgs lineB=${againB.length}msgs`);

  evidence.lines = [
    { line: 'A', conversation_id: lineA.conversation_id, messages: againA.length, turns: turnIdsA.length },
    { line: 'B', conversation_id: lineB.conversation_id, messages: againB.length, turns: 1 },
  ];
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
}

const report = writeReport(path.join(reportDir, 'tw-o01-task-continuity.json'), {
  plan: 'TW-20261102',
  closure: 'tw-o01-task-continuity',
  outcome: 'O01',
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
