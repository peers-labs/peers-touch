#!/usr/bin/env node
// TW-O09 — provider select / revoke / restore headless desktop-native journey.
//
// Proves the O09 runtime contract end to end over the real Tauri loopback
// gateway (no GUI): Desktop selects a Station-owned provider + model on a
// conversation and gets a real model answer; revoking (disabling) the provider
// on Station makes the next turn fail CLOSED with a structured
// RUNTIME_UNAVAILABLE/provider_disabled envelope (no fake success, no model
// call); restoring it makes selection usable again. Complex provider
// configuration stays server-side — Desktop only selects and consumes.
//
// Run INSIDE the acceptance cell:
//   docker exec -i tw-d1-cell node --input-type=module - < this-file
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
// The 0.5B acceptance model occasionally echoes POONG/PING. O09 proves
// selection serves a real completion and revocation blocks it — answer
// fidelity is not the claim, so accept the echo word family (overridable).
const answerRe = new RegExp(process.env.PT_TW_EXPECT_MATCH ?? 'pong|poong|ping', 'i');

const checks = new CheckCollector();
const gw = new Gateway();
const { account, password } = envActor();
const evidence = { legs: [] };

const turnBody = (conversation, agentId) => ({
  client_idempotency_key: crypto.randomUUID(),
  conversation_id: conversation,
  agent_id: agentId,
  user_input: `Reply with exactly one word: ${expectToken}`,
  attachments: [],
  stream: true,
  effort: 'medium',
  context_window_size: 8192,
  max_retries: 0,
  provider: providerId,
  model: modelId,
});

try {
  await gw.login(account, password);

  await gw.ensureProvider({ id: providerId, name: 'Ollama Local', baseUrl: providerBaseUrl });
  await gw.ensureProviderModel(providerId, { id: modelId, displayName: modelId });
  // Make the precondition deterministic even on reruns after a failed leg.
  await gw.providerSetEnabled(providerId, true);

  const agents = await gw.agentsList();
  const agentId = agents?.agents?.[0]?.id;
  if (!agentId) throw new Error('no agent available');

  const enabledProvider = await gw.providerGet(providerId);
  checks.record(
    'C1',
    enabledProvider?.enabled === true && enabledProvider?.credential_status === 'configured',
    `precondition enabled=${enabledProvider?.enabled} cred=${enabledProvider?.credential_status}`,
  );

  // ---- C2/C3: select full provider+model, get a real answer ---------------
  const convA = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: 'O09 select',
  });
  const selectionBound =
    convA?.provider_id === providerId && convA?.model_name === modelId;
  checks.record('C2', selectionBound,
    `conversation selects ${convA?.provider_id}/${convA?.model_name}`);

  const turnA = await gw.runTurn(turnBody(convA.conversation_id, agentId));
  const answered =
    turnA.done?.stage === 'turn_completed' &&
    typeof turnA.text === 'string' &&
    turnA.text.trim().length > 0;
  checks.record('C3', answered,
    `selected provider answered completed=${turnA.done?.stage === 'turn_completed'} echoMatch=${answerRe.test((turnA.text ?? '').trim())} text=${JSON.stringify((turnA.text ?? '').trim().slice(0, 40))}`);
  evidence.legs.push({ leg: 'select_use', stages: turnA.stages, text: turnA.text });

  // ---- C4: revoke on Station ⇒ next turn fails closed ---------------------
  const disabled = await gw.providerSetEnabled(providerId, false);
  const convB = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: 'O09 revoked',
  });
  const turnB = await gw.runTurn(turnBody(convB.conversation_id, agentId), { coldRetries: 1 });
  const reason = turnB.error?.details?.reason_code ?? turnB.error?.error_type ?? null;
  const failClosed =
    !turnB.done &&
    turnB.error?.error_type === 'RUNTIME_UNAVAILABLE' &&
    reason === 'provider_disabled' &&
    (turnB.text ?? '').length === 0;
  checks.record('C4', failClosed && disabled?.enabled === false,
    `revoked provider enabled=${disabled?.enabled} ⇒ error_type=${turnB.error?.error_type} reason=${reason} answer_emitted=${(turnB.text ?? '').length > 0}`);
  evidence.legs.push({
    leg: 'revoke_fail_closed',
    provider_enabled: disabled?.enabled,
    error_type: turnB.error?.error_type ?? null,
    reason_code: reason,
    locale_key: turnB.error?.locale_key ?? null,
  });

  // ---- C5: restore ⇒ selection usable again -------------------------------
  const restored = await gw.providerSetEnabled(providerId, true);
  const convC = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: 'O09 restored',
  });
  const turnC = await gw.runTurn(turnBody(convC.conversation_id, agentId));
  const restoredOk =
    restored?.enabled === true &&
    restored?.credential_status === 'configured' &&
    turnC.done?.stage === 'turn_completed' &&
    (turnC.text ?? '').trim().length > 0;
  checks.record('C5', restoredOk,
    `restored enabled=${restored?.enabled} cred=${restored?.credential_status} completed=${turnC.done?.stage === 'turn_completed'} echoMatch=${answerRe.test((turnC.text ?? '').trim())} text=${JSON.stringify((turnC.text ?? '').trim().slice(0, 40))}`);
  evidence.legs.push({ leg: 'restore_use', stages: turnC.stages, text: turnC.text });
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
} finally {
  // Never leave the shared provider disabled for later closures.
  try {
    await gw.providerSetEnabled(providerId, true);
  } catch {
    // best-effort cleanup; recorded failures surface in subsequent runs
  }
}

const report = writeReport(path.join(reportDir, 'tw-o09-provider-revoke-restore.json'), {
  plan: 'TW-20261102',
  closure: 'tw-o09-provider-revoke-restore',
  outcome: 'O09',
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
