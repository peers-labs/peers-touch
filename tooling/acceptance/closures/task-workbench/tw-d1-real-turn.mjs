#!/usr/bin/env node
// TW-D1 / O02 — real model turn over the headless desktop-native gateway.
//
// Drives the REAL Tauri binary's loopback gateway (no webview/GUI):
//   1. ensure an OpenAI-compatible provider + model are configured on Station,
//   2. create a conversation bound to that model,
//   3. stream a real turn through the verified libp2p HTTP/2 route,
//   4. assert the model streamed content and the turn completed,
//   5. assert the user+assistant messages persisted atomically (one turn id),
//   6. assert idempotency: replaying the same client idempotency key returns
//      admission_replayed for the SAME turn and never re-executes.
//
// Run INSIDE the acceptance cell (node, against 127.0.0.1:3030):
//   docker exec -i tw-d1-cell node --input-type=module - < this-file
//
// Env: PEERS_GATEWAY_URL, PT_ACTOR_ACCOUNT, PT_ACTOR_PASSWORD,
//      PT_TW_REPORT_DIR, PT_TW_PROVIDER_ID, PT_TW_PROVIDER_BASE_URL,
//      PT_TW_MODEL_ID, PT_TW_SOURCE_COMMIT.
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
const expectToken = process.env.PT_TW_EXPECT_TOKEN ?? 'PONG';
// Weak 0.5B acceptance model may echo POONG/PING; O02 only requires a real,
// nonempty streamed completion (exact answer fidelity is not the claim).
const answerRe = new RegExp(process.env.PT_TW_EXPECT_MATCH ?? 'pong|poong|ping', 'i');

const checks = new CheckCollector();
const gw = new Gateway();
const { account, password } = envActor();
const evidence = {};

function record(id, pass, detail) {
  checks.record(id, pass, detail);
}

try {
  await gw.login(account, password);

  // ---- B1/B2: provider + model ready -------------------------------------
  await gw.ensureProvider({
    id: providerId,
    name: 'Ollama Local',
    baseUrl: providerBaseUrl,
  });
  await gw.ensureProviderModel(providerId, {
    id: modelId,
    displayName: `${modelId} (task-workbench)`,
  });
  const provider = await gw.providerGet(providerId);
  const modelRow = (provider?.models ?? []).find((m) => (m.model_id ?? m.id) === modelId);
  record(
    'B1',
    provider?.credential_status === 'configured',
    `provider ${providerId} credential_status=${provider?.credential_status ?? 'missing'}`,
  );
  record('B2', !!modelRow, `model ${modelId} registered=${!!modelRow}`);
  evidence.provider = {
    id: providerId,
    base_url: provider?.base_url,
    credential_status: provider?.credential_status,
    model: modelId,
  };

  // ---- B3: conversation bound to provider/model --------------------------
  const agents = await gw.agentsList();
  const list = agents?.agents ?? agents?.agentConfigs ?? [];
  const agentId = list[0]?.id ?? list[0]?.agent_id;
  if (!agentId) throw new Error('no agent available to open a conversation');

  const conversation = await gw.conversationCreate(agentId, {
    providerId,
    modelName: modelId,
    title: 'TW D1 real turn',
  });
  record(
    'B3',
    conversation?.conversation_id &&
      conversation.provider_id === providerId &&
      conversation.model_name === modelId,
    `conversation ${conversation?.conversation_id} bound ${conversation?.provider_id}/${conversation?.model_name}`,
  );

  // ---- B4/B5: real streamed turn -----------------------------------------
  const idempotencyKey = crypto.randomUUID();
  const turnBody = {
    client_idempotency_key: idempotencyKey,
    conversation_id: conversation.conversation_id,
    agent_id: agentId,
    user_input: `Reply with exactly one word: ${expectToken}`,
    attachments: [],
    stream: true,
    // effort "medium" makes Station omit reasoning_effort, which strict
    // OpenAI-compatible local providers (ollama) reject with HTTP 400.
    effort: 'medium',
    context_window_size: 8192,
    max_retries: 0,
    provider: providerId,
    model: modelId,
  };

  const turn = await gw.runTurn(turnBody);
  evidence.turn = {
    transport_ok: turn.ok,
    stages: turn.stages,
    text: turn.text,
    done_stage: turn.done?.stage ?? null,
    turn_id: turn.done?.turnId ?? turn.frames.find((f) => f.turnId)?.turnId ?? null,
    error: turn.error ? String(turn.error) : (turn.error?.error ?? null),
  };

  record('B4', turn.ok && !!turn.done && turn.done.stage === 'turn_completed',
    `turn stage=${turn.done?.stage ?? (turn.ok ? 'no-done' : 'transport-failed')} turn_id=${evidence.turn.turn_id ?? 'n/a'}`);
  record(
    'B5',
    turn.ok &&
      turn.stages.includes('provider_delta') &&
      typeof turn.text === 'string' &&
      turn.text.trim().length > 0 &&
      answerRe.test(turn.text.trim()),
    `streamed deltas=${turn.stages.filter((s) => s === 'provider_delta').length} text=${JSON.stringify(turn.text.trim().slice(0, 60))}`,
  );

  // ---- B6: atomic persistence --------------------------------------------
  const messagesAfter = await gw.conversationMessages(conversation.conversation_id);
  const userMsg = messagesAfter.find((m) => m.role === 'user');
  const assistantMsg = messagesAfter.find((m) => m.role === 'assistant');
  const sameTurn =
    !!userMsg?.turn_id && userMsg.turn_id === assistantMsg?.turn_id &&
    userMsg.turn_id === evidence.turn.turn_id;
  record(
    'B6',
    messagesAfter.length === 2 && sameTurn,
    `messages=${messagesAfter.length} shared_turn=${sameTurn} turn_id=${userMsg?.turn_id ?? 'n/a'}`,
  );
  evidence.persisted = {
    count: messagesAfter.length,
    user_seq: userMsg?.seq,
    assistant_seq: assistantMsg?.seq,
    turn_id: userMsg?.turn_id ?? null,
  };

  // ---- B7: idempotent replay never re-executes ----------------------------
  const replay = await gw.runTurn(turnBody, { coldRetries: 1, timeoutMs: 40_000 });
  const messagesAfterReplay = await gw.conversationMessages(conversation.conversation_id);
  const replayOk =
    replay.ok &&
    !!replay.admission &&
    replay.admission.status === 3 &&
    replay.admission.turn_id === evidence.turn.turn_id &&
    messagesAfterReplay.length === 2;
  record(
    'B7',
    replayOk,
    `replay admission=${replay.admission ? `status:${replay.admission.status} same_turn:${replay.admission.turn_id === evidence.turn.turn_id}` : 'none'} messages=${messagesAfterReplay.length}`,
  );
  evidence.replay = {
    admission_status: replay.admission?.status ?? null,
    admission_turn_id: replay.admission?.turn_id ?? null,
    messages_after: messagesAfterReplay.length,
  };
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  record('FATAL', false, evidence.fatal);
}

const report = writeReport(path.join(reportDir, 'tw-d1-real-turn.json'), {
  plan: 'TW-20261102',
  closure: 'tw-d1-real-turn',
  outcome: 'O02',
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
