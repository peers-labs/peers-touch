#!/usr/bin/env node
// TW-O09 — credential revoke / restore-deep-link headless desktop-native
// journey over the real Tauri loopback gateway (no GUI, no mock).
//
// The enable/disable leg lives in tw-o09-provider-revoke-restore.mjs. This
// closure proves the credential half of the O09 recovery contract:
//   1. conversation selects the FULL provider id + upstream model id;
//   2. the strong model answers (secret currently vaulted on Station);
//   3. deleting the Station-held credential (optimistic version) makes the
//      next turn fail CLOSED at admission with PROVIDER_CREDENTIAL_MISSING
//      carrying details.provider_id — the exact payload the Desktop renderer
//      maps to resolution { type: 'openProviderSettings' } (see
//      apps/desktop/src/services/desktop_api.ts deriveResolution);
//   4. re-setting the secret restores service and a new turn completes.
// The plaintext key is injected ONLY through PT_TW_ARK_API_KEY (host env),
// sent once to Station, and never written into evidence or reports.
//
// Run INSIDE the acceptance cell:
//   docker exec -e PT_TW_ARK_API_KEY="$KEY" tw-d1-cell \
//     sh -c 'cd /workspace/run/tw && node tw-o09-credential-revoke-restore.mjs'
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';

const providerId = process.env.PT_TW_PROVIDER_ID ?? 'ark';
const modelId = process.env.PT_TW_MODEL_ID ?? 'ep-20260623145021-n4xdm';
const apiKey = process.env.PT_TW_ARK_API_KEY ?? '';

const checks = new CheckCollector();
const gw = new Gateway();
const { account, password } = envActor();
const evidence = { legs: [], conversations: {}, turns: {} };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const marker = (tag) => `${tag}-${randomBytes(3).toString('hex').toUpperCase()}`;

// The acceptance agent has client-anchored device capabilities bound in its
// tool scope, so admission requires a pinned client capability session on
// every turn (same preflight as the O12 headless closures).
async function bootSession() {
  await gw.deviceEngineActivate();
  await gw.executorSupervisorStart();
  let sessions = [];
  for (let attempt = 0; attempt < 20 && sessions.length === 0; attempt += 1) {
    await sleep(1000);
    sessions = await gw.capabilitySessions();
  }
  return sessions[0] ?? null;
}

const turnBody = (conversation, agentId, token, sessionId) => ({
  client_idempotency_key: crypto.randomUUID(),
  conversation_id: conversation,
  agent_id: agentId,
  user_input: `Reply with exactly this token and nothing else: ${token}`,
  attachments: [],
  stream: true,
  effort: 'medium',
  context_window_size: 8192,
  max_retries: 0,
  provider: providerId,
  model: modelId,
  client_capability_session_id: sessionId,
});

// Mirror of the Desktop renderer predicate in
// services/desktop_api.ts deriveResolution(): error_type + details.provider_id
// is the sole trigger for the Settings deep link. Proving the gateway payload
// satisfies it proves the deep-link mechanism; the webview click itself is a
// renderer-only concern outside a headless native closure.
function deriveProviderSettingsResolution(error) {
  if (error?.error_type === 'PROVIDER_CREDENTIAL_MISSING' && error?.details?.provider_id) {
    return {
      type: 'openProviderSettings',
      providerId: error.details.provider_id,
      label: 'agent.recovery.configureCredential',
    };
  }
  return undefined;
}

try {
  if (!apiKey) {
    throw new Error('PT_TW_ARK_API_KEY is required for the restore leg (host env injection only)');
  }
  await gw.login(account, password);

  const agents = await gw.agentsList();
  const agentId = agents?.agents?.[0]?.id;
  if (!agentId) throw new Error('no agent available');

  const session = await bootSession();
  evidence.capability_session = session?.session_id ?? null;
  if (!session?.session_id) throw new Error('device capability session did not come online');

  // ---- C1: credential precondition (restore-first makes reruns deterministic)
  let status = (await gw.cmd('provider_credential_status', { id: providerId }))?.data?.status ?? null;
  if (!status?.configured) {
    await gw.cmd('provider_set_credential', { id: providerId, api_key: apiKey });
    status = (await gw.cmd('provider_credential_status', { id: providerId }))?.data?.status ?? null;
  }
  const versionBefore = Number(status?.version ?? 0);
  evidence.legs.push({ leg: 'precondition', status: { configured: status?.configured, version: versionBefore } });
  checks.record('C1', status?.configured === true && versionBefore >= 1,
    `ark credential configured=${status?.configured} version=${versionBefore}`);

  // ---- C2: FULL provider id + upstream model id selection ------------------
  const tokenA = marker('KAIROS');
  const convA = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: `O09 credential ${tokenA}`,
  });
  evidence.conversations.A = { id: convA?.conversation_id, provider_id: convA?.provider_id, model_name: convA?.model_name };
  const fullSelection =
    convA?.provider_id === providerId && convA?.model_name === modelId;
  checks.record('C2', fullSelection,
    `conversation binds full ids provider=${convA?.provider_id} model=${convA?.model_name}`);

  // ---- C3: real strong-model answer while credential is present -----------
  const turnA = await gw.runTurn(turnBody(convA.conversation_id, agentId, tokenA, session.session_id), { timeoutMs: 120_000 });
  evidence.turns.A = { turn_id: turnA.turnId, stage: turnA.done?.stage ?? null };
  const textA = (turnA.text ?? '').trim();
  const answeredA =
    turnA.done?.stage === 'turn_completed' &&
    textA.includes(tokenA);
  checks.record('C3', answeredA,
    `strong model completed=${turnA.done?.stage === 'turn_completed'} tokenEchoed=${textA.includes(tokenA)} text=${JSON.stringify(textA.slice(0, 48))}`);
  evidence.legs.push({ leg: 'select_use', stages: turnA.stages, text: textA.slice(0, 120) });

  // ---- C4: optimistic-version credential delete ---------------------------
  const del = await gw.providerCredentialDelete(providerId, versionBefore);
  const statusRevoked = (await gw.cmd('provider_credential_status', { id: providerId }))?.data?.status ?? null;
  evidence.legs.push({
    leg: 'credential_delete',
    deleted: del?.deleted === true,
    submitted_version: versionBefore,
    status_after: { configured: statusRevoked?.configured, version: Number(statusRevoked?.version ?? -1) },
  });
  checks.record('C4',
    del?.deleted === true && statusRevoked?.configured === false && Number(statusRevoked?.version ?? -1) === 0,
    `delete ack=${del?.deleted === true} status configured=${statusRevoked?.configured} version=${statusRevoked?.version}`);

  // ---- C5/C6: next turn fails closed with deep-link trigger payload --------
  const convB = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: `O09 revoked ${tokenA}`,
  });
  evidence.conversations.B = { id: convB?.conversation_id, provider_id: convB?.provider_id, model_name: convB?.model_name };
  const turnB = await gw.runTurn(turnBody(convB.conversation_id, agentId, marker('NOANSWER'), session.session_id), { coldRetries: 0, timeoutMs: 60_000 });
  evidence.turns.B = {
    turn_id: turnB.turnId,
    stage: turnB.done?.stage ?? null,
    error: turnB.error ? {
      error_type: turnB.error.error_type ?? null,
      reason_code: turnB.error?.details?.reason_code ?? null,
      provider_id: turnB.error?.details?.provider_id ?? null,
      locale_key: turnB.error.locale_key ?? null,
      terminal: turnB.error.terminal ?? null,
      retryable: turnB.error.retryable ?? null,
    } : null,
  };
  const errB = turnB.error ?? {};
  const failClosed =
    !turnB.done &&
    errB.error_type === 'PROVIDER_CREDENTIAL_MISSING' &&
    errB.details?.provider_id === providerId &&
    (turnB.text ?? '').length === 0;
  checks.record('C5', failClosed,
    `revoked ⇒ error_type=${errB.error_type} provider_id=${errB.details?.provider_id ?? null} answer_emitted=${(turnB.text ?? '').length > 0}`);

  const resolution = deriveProviderSettingsResolution(errB);
  evidence.legs.push({ leg: 'revoke_fail_closed', resolution });
  checks.record('C6',
    resolution?.type === 'openProviderSettings' && resolution.providerId === providerId,
    `renderer derives resolution=${JSON.stringify(resolution ?? null)}`);

  // ---- C7/C8: restore secret ⇒ service resumes -----------------------------
  const setResult = (await gw.cmd('provider_set_credential', { id: providerId, api_key: apiKey }))?.data?.status ?? null;
  const statusRestored = (await gw.cmd('provider_credential_status', { id: providerId }))?.data?.status ?? null;
  const versionAfter = Number(statusRestored?.version ?? 0);
  evidence.legs.push({
    leg: 'credential_restore',
    set_status: setResult ? { configured: setResult.configured, version: Number(setResult.version ?? -1) } : null,
    status_after: { configured: statusRestored?.configured, status: statusRestored?.status ?? null, version: versionAfter },
  });
  // Delete is a hard delete (credential_config_service.go), so the recreated
  // row starts a fresh optimistic version lineage (1); the monotonic claim
  // applies within a row lifetime, not across delete/recreate.
  checks.record('C7',
    statusRestored?.configured === true && statusRestored?.status === 'active' && versionAfter >= 1,
    `restored configured=${statusRestored?.configured} status=${statusRestored?.status} version ${versionBefore} ->(hard delete)-> ${versionAfter}`);

  const tokenC = marker('KAIROS');
  const convC = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: `O09 restored ${tokenC}`,
  });
  evidence.conversations.C = { id: convC?.conversation_id, provider_id: convC?.provider_id, model_name: convC?.model_name };
  const turnC = await gw.runTurn(turnBody(convC.conversation_id, agentId, tokenC, session.session_id), { timeoutMs: 120_000 });
  evidence.turns.C = { turn_id: turnC.turnId, stage: turnC.done?.stage ?? null };
  const textC = (turnC.text ?? '').trim();
  const answeredC = turnC.done?.stage === 'turn_completed' && textC.includes(tokenC);
  checks.record('C8', answeredC,
    `post-restore completed=${turnC.done?.stage === 'turn_completed'} tokenEchoed=${textC.includes(tokenC)} text=${JSON.stringify(textC.slice(0, 48))}`);
  evidence.legs.push({ leg: 'restore_use', stages: turnC.stages, text: textC.slice(0, 120) });

  // ---- C9: secret hygiene — the key never reaches evidence/report ----------
  const serialized = JSON.stringify({ evidence, results: checks.results });
  checks.record('C9', !serialized.includes(apiKey),
    `report payload contains injected api key=${serialized.includes(apiKey)} (must be false)`);
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
} finally {
  // Never leave the shared strong provider without a usable credential: later
  // closures (O08/O12) depend on ARK. Key stays in process env only.
  try {
    const s = (await gw.cmd('provider_credential_status', { id: providerId }))?.data?.status;
    if (s && !s.configured && apiKey) {
      await gw.cmd('provider_set_credential', { id: providerId, api_key: apiKey });
    }
  } catch {
    // best-effort; a failed restore surfaces in subsequent closures
  }
}

const report = writeReport(path.join(reportDir, 'tw-o09-credential-revoke-restore.json'), {
  plan: 'TW-20261102',
  closure: 'tw-o09-credential-revoke-restore',
  outcome: 'O09-credential-recovery',
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
