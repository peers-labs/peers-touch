#!/usr/bin/env node
// TW-O03 — durable history is replayable; live fragments never corrupt it.
//
// Headless proof over the native gateway against Station durable truth (no
// GUI): a multi-turn conversation has contiguous per-conversation seq and
// stable message identities; a watermark cursor (after_seq) replays only the
// tail; replaying from a watermark and identity-deduplicating against the
// prefix reconstructs the exact full set with no duplicate and no gap; a
// fresh authenticated session (app restart equivalent) reads the identical
// history.
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
const evidence = {};

async function withGateway() {
  const gw = new Gateway();
  const { account, password } = envActor();
  await gw.login(account, password);
  return gw;
}

try {
  let gw = await withGateway();
  await gw.ensureProvider({ id: providerId, name: 'Ollama Local', baseUrl: providerBaseUrl });
  await gw.ensureProviderModel(providerId, { id: modelId });
  const agents = await gw.agentsList();
  const agentId = agents?.agents?.[0]?.id;
  if (!agentId) throw new Error('no agent available');

  // Deterministic runtime: the local Ollama runtime runs no tools, so bring
  // up the device capability engine and converge the agent to empty tool
  // scope (plain chat), matching the real Desktop with the session selected.
  await gw.deviceEngineActivate();
  await gw.executorSupervisorStart();
  let sessions = [];
  for (let i = 0; i < 20 && sessions.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    sessions = await gw.capabilitySessions();
  }
  const capabilitySessionId = sessions[0]?.session_id;
  if (!capabilitySessionId) throw new Error('no capability session after engine activation');
  evidence.capability_session_id = capabilitySessionId;
  const agentVersion = Number(agents?.agents?.[0]?.version ?? 0);
  await gw.convergeToolScope(agentId, [], { policy: 1, agentVersion });

  const run = crypto.randomUUID().slice(0, 8);
  const conversation = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: `O03 replay ${run}`,
  });
  const cid = conversation.conversation_id;

  // Two real turns → four durable messages.
  for (const marker of [`R1-${run}`, `R2-${run}`]) {
    const r = await gw.runTurn({
      client_idempotency_key: crypto.randomUUID(),
      conversation_id: cid, agent_id: agentId,
      user_input: `Reply with one word. Marker ${marker}.`,
      attachments: [], stream: true, effort: 'medium',
      context_window_size: 8192, max_retries: 0,
      provider: providerId, model: modelId,
      client_capability_session_id: capabilitySessionId,
    });
    if (!r.ok || r.done?.stage !== 'turn_completed') {
      throw new Error(`setup turn failed: ${r.error ?? r.done?.stage}`);
    }
  }

  // ---- R1: contiguous seq + stable ids in durable full read ----------------
  const full = await gw.conversationMessages(cid, { limit: 50 });
  const seqs = full.map((m) => Number(m.seq)).sort((a, b) => a - b);
  const contiguous = seqs.length === 4 && seqs.every((s, i) => s === i + 1);
  const idsStable = full.every((m) => typeof (m.message_id ?? m.id) === 'string');
  checks.record('R1', contiguous && idsStable,
    `messages=${full.length} seqs=[${seqs.join(',')}] contiguous=${contiguous} ids=${idsStable}`);

  // ---- R2: watermark cursor replays only the tail --------------------------
  const watermark = 2;
  const tail = await gw.conversationMessages(cid, { afterSeq: watermark, limit: 50 });
  const tailSeqs = tail.map((m) => Number(m.seq)).sort((a, b) => a - b);
  const cursorOk = tail.length === 2 && tailSeqs.every((s) => s > watermark) &&
    tailSeqs[0] === 3 && tailSeqs[1] === 4;
  checks.record('R2', cursorOk,
    `after_seq=${watermark} tailSeqs=[${tailSeqs.join(',')}] count=${tail.length}`);

  // ---- R3: replay + identity dedup ⇒ exact full set, no dup/no gap ----------
  const prefix = await gw.conversationMessages(cid, { beforeSeq: watermark + 1, limit: 50 });
  const keyOf = (m) => m.message_id ?? m.id;
  const merged = new Map();
  for (const m of [...prefix, ...tail]) merged.set(keyOf(m), m);
  const fullIds = new Set(full.map(keyOf));
  const noDup = merged.size === full.length;
  const sameSet = merged.size === fullIds.size && [...merged.keys()].every((k) => fullIds.has(k));
  const mergedSeqs = [...merged.values()].map((m) => Number(m.seq)).sort((a, b) => a - b);
  const noGap = mergedSeqs.every((s, i) => s === i + 1);
  checks.record('R3', noDup && sameSet && noGap,
    `replay+dedup size=${merged.size} noDup=${noDup} sameSet=${sameSet} noGap=${noGap}`);

  // ---- R4: fresh authenticated session (restart) reads identical history ----
  const gw2 = await withGateway();
  const afterRestart = await gw2.conversationMessages(cid, { limit: 50 });
  const sameAfterRestart =
    afterRestart.length === full.length &&
    afterRestart.every((m, i) => keyOf(m) === keyOf(full[i]) && Number(m.seq) === Number(full[i].seq));
  checks.record('R4', sameAfterRestart,
    `fresh-session read identical=${sameAfterRestart} messages=${afterRestart.length}`);

  evidence.conversation_id = cid;
  evidence.seqs = seqs;
  evidence.watermark = watermark;
  evidence.tailSeqs = tailSeqs;
  evidence.replayMergedCount = merged.size;
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
}

const report = writeReport(path.join(reportDir, 'tw-o03-replay-watermark.json'), {
  plan: 'TW-20261102',
  closure: 'tw-o03-replay-watermark',
  outcome: 'O03',
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
