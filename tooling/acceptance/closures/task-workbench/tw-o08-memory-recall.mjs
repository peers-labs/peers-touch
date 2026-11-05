#!/usr/bin/env node
// TW-O08 — confirmed memory actually affects the NEXT task, headless native.
//
// Strong-model journey over the real gateway (no GUI):
//   1. Task 1 tells the agent a unique project codename. Post-turn heuristic
//      extraction produces a CANDIDATE memory (never auto-confirmed).
//   2. Before confirmation the candidate is not retrievable as confirmed.
//   3. The human review gate confirms it (agent_memory_review status=2).
//   4. A brand-new task (new conversation) asks for the codename with no prior
//      context; the only way the model can answer is retrieval+injection of
//      the now-confirmed agent-scoped memory.
//
// Requires a strong provider (default ARK Seed2.1-Pro). The 0.5B local model
// cannot reliably trigger extraction or recall, hence env overrides:
//   PT_TW_PROVIDER_ID=ark PT_TW_MODEL_ID=ep-...
//
// Run INSIDE the acceptance cell.
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
// MemoryStatus enum (memory.proto): unspecified 0, candidate 1, confirmed 2.
const STATUS_CANDIDATE = 1;
const STATUS_CONFIRMED = 2;

const checks = new CheckCollector();
const evidence = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollCandidate(gw, agentId, marker, { timeoutMs = 60_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const items = await gw.agentMemoryList(agentId, STATUS_CANDIDATE);
    const hit = items.find((m) => String(m.content ?? '').includes(marker));
    if (hit) return hit;
    await sleep(2000);
  }
  return null;
}

try {
  const gw = new Gateway();
  const { account, password } = envActor();
  await gw.login(account, password);

  const provider = await gw.providerGet(providerId);
  if (provider?.credential_status !== 'configured' || provider?.enabled !== true) {
    throw new Error(`strong provider ${providerId} not ready: ${provider?.credential_status}`);
  }
  const agents = await gw.agentsList();
  const agentId = agents?.agents?.[0]?.id;
  if (!agentId) throw new Error('no agent available');

  const marker = `ZEPHYR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  evidence.marker = marker;

  // ---- M1: task 1 plants a fact; extraction yields a CANDIDATE --------------
  const task1 = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: `O08 plant ${marker}`,
  });
  const plant = await gw.runTurn({
    client_idempotency_key: crypto.randomUUID(),
    conversation_id: task1.conversation_id,
    agent_id: agentId,
    user_input: `Please remember this stable fact for future conversations: the secret project codename is ${marker}. Reply with one short sentence confirming you noted it.`,
    attachments: [], stream: true, effort: 'medium',
    context_window_size: 8192, max_retries: 0,
    provider: providerId, model: modelId,
  }, { timeoutMs: 120_000 });
  checks.record('M1-turn', plant.done?.stage === 'turn_completed',
    `plant turn stage=${plant.done?.stage ?? 'failed'} err=${plant.error?.error_type ?? plant.error ?? null}`);

  const candidate = await pollCandidate(gw, agentId, marker);
  checks.record('M1', !!candidate,
    candidate
      ? `candidate memoryId=${candidate.memoryId} status=${candidate.status} agentScoped=${!candidate.sessionId}`
      : 'no candidate extracted within timeout');
  if (!candidate) throw new Error('candidate memory not produced');
  evidence.candidate = { id: candidate.memoryId, status: candidate.status, sourceTurnId: candidate.sourceTurnId };

  // ---- M2: candidate is not confirmed/retrievable before review ------------
  const confirmedBefore = await gw.agentMemoryList(agentId, STATUS_CONFIRMED);
  const leakedBefore = confirmedBefore.some((m) => String(m.content ?? '').includes(marker));
  checks.record('M2', !leakedBefore,
    `confirmed memories containing marker before review=${leakedBefore} (must be false)`);

  // ---- M3: human confirms through the review gate --------------------------
  const reviewed = await gw.agentMemoryReview(candidate.memoryId, agentId, STATUS_CONFIRMED);
  const confirmedAfter = await gw.agentMemoryList(agentId, STATUS_CONFIRMED);
  const nowConfirmed = confirmedAfter.some(
    (m) => m.memoryId === candidate.memoryId && String(m.content ?? '').includes(marker),
  );
  checks.record('M3', reviewed?.status === 'confirmed' && nowConfirmed,
    `review status=${reviewed?.status} nowConfirmed=${nowConfirmed}`);

  // ---- M4: a brand-new task recalls the fact with no prior context ---------
  const task2 = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: `O08 recall ${marker}`,
  });
  const recall = await gw.runTurn({
    client_idempotency_key: crypto.randomUUID(),
    conversation_id: task2.conversation_id,
    agent_id: agentId,
    user_input: 'What is the secret project codename I previously told you? Answer with only the codename.',
    attachments: [], stream: true, effort: 'medium',
    context_window_size: 8192, max_retries: 0,
    provider: providerId, model: modelId,
  }, { timeoutMs: 120_000 });
  const answer = recall.text ?? '';
  const recalled = recall.done?.stage === 'turn_completed' && answer.includes(marker);
  checks.record('M4', recalled,
    `new task recall completed=${recall.done?.stage === 'turn_completed'} answer=${JSON.stringify(answer.trim().slice(0, 80))}`);
  evidence.recall = { conversation_id: task2.conversation_id, answer: answer.trim().slice(0, 160) };

  // Task 2 had its own fresh conversation with no planted message: prove the
  // codename is absent from its own history, so it could only come from memory.
  const task2Messages = await gw.conversationMessages(task2.conversation_id);
  const plantedInTask2 = task2Messages.some(
    (m) => m.role === 'user' && String(m.content ?? '').includes(marker),
  );
  checks.record('M4b', !plantedInTask2 && recalled,
    `marker absent from task2 own user history=${!plantedInTask2}; recall therefore via injected memory`);
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
}

const report = writeReport(path.join(reportDir, 'tw-o08-memory-recall.json'), {
  plan: 'TW-20261102',
  closure: 'tw-o08-memory-recall',
  outcome: 'O08',
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
