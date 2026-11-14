#!/usr/bin/env node
// TW-D3 / O04 — immutable logical artifact version ring, headless native.
//
// Drives the REAL Station over the native gateway using the proto contract
// (decoded in lib/proto.mjs): claims v1 agent output and a v2 feedback
// revision, asserts an immutable parent-linked version sequence with distinct
// bytes/sha, reads exact body bytes back, proves optimistic concurrency (a
// stale base is rejected, no new version), binds structural + human checks to
// the exact version, and accepts v2 as current. Messages reference
// artifact/version; nothing is parsed out of message text here.
//
// Run INSIDE the acceptance cell:
//   docker exec -i tw-d1-cell node --input-type=module - < this-file
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';
import { ARTIFACT_ORIGIN, ARTIFACT_KIND, ARTIFACT_CHECK_TYPE, ARTIFACT_CHECK_RESULT } from './lib/proto.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';

const checks = new CheckCollector();
const gw = new Gateway();
const { account, password } = envActor();
const evidence = {};

const run = crypto.randomUUID().slice(0, 8);
const phrase1 = `D3-v1-unique-${run}`;
const phrase2 = `D3-v2-revised-${run}`;

try {
  await gw.login(account, password);

  const agents = await gw.agentsList();
  const agentId = agents?.agents?.[0]?.id;
  if (!agentId) throw new Error('no agent available');
  const providerId = process.env.PT_TW_PROVIDER_ID ?? 'ollama-local';
  const modelId = process.env.PT_TW_MODEL_ID ?? 'qwen-tw';
  await gw.ensureProvider({ id: providerId, name: 'Ollama Local', baseUrl: 'http://ollama:11434/v1' });
  await gw.ensureProviderModel(providerId, { id: modelId });
  const conversation = await gw.conversationCreate(agentId, {
    providerId, modelName: modelId, title: 'TW D3 artifacts',
  });
  const conversationId = conversation.conversation_id;

  // ---- V1: claim agent output as first immutable version ------------------
  const v1 = await gw.artifactClaimVersion({
    conversation_id: conversationId,
    artifact_id: '',
    kind: 'LOGICAL_ARTIFACT_KIND_DOCUMENT',
    name: `tw-d3-${run}.md`,
    expected_base_version_id: '',
    origin: 'ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT',
    source_turn_id: '',
    source_message_id: '',
    body: `# Title\n${phrase1}\n`,
    content_type: 'text/plain',
    summary: 'first draft',
    feedback_id: '',
    adopted_attachment_refs: [],
    client_idempotency_key: crypto.randomUUID(),
    source_tool_call_id: '',
  });
  const artifactId = v1.artifact?.artifact_id;
  const v1Id = v1.version?.version_id;
  const checks1 =
    !!artifactId && !!v1Id &&
    v1.version?.seq === 1 &&
    v1.version?.origin === ARTIFACT_ORIGIN.AGENT_OUTPUT &&
    v1.version?.sha256?.length === 64 &&
    v1.artifact?.current_version_id === v1Id &&
    v1.artifact?.current_seq === 1;
  checks.record('V1', checks1,
    `artifact=${artifactId} v1=${v1Id} seq=${v1.version?.seq} origin=${v1.version?.origin} sha=${String(v1.version?.sha256).slice(0, 12)}`);

  // ---- V2: feedback revision parent-linked to v1 --------------------------
  const v2 = await gw.artifactClaimVersion({
    conversation_id: conversationId,
    artifact_id: artifactId,
    kind: 'LOGICAL_ARTIFACT_KIND_DOCUMENT',
    name: `tw-d3-${run}.md`,
    expected_base_version_id: v1Id,
    origin: 'ARTIFACT_VERSION_ORIGIN_FEEDBACK_REVISION',
    source_turn_id: '',
    source_message_id: '',
    body: `# Title revised\n${phrase2}\n`,
    content_type: 'text/plain',
    summary: 'revised after feedback',
    feedback_id: '',
    adopted_attachment_refs: [],
    client_idempotency_key: crypto.randomUUID(),
    source_tool_call_id: '',
  });
  const v2Id = v2.version?.version_id;
  const checks2 =
    v2.version?.seq === 2 &&
    v2.version?.parent_version_id === v1Id &&
    v2.version?.origin === ARTIFACT_ORIGIN.FEEDBACK_REVISION &&
    v2.version?.sha256 !== v1.version?.sha256 &&
    v2.artifact?.current_version_id === v2Id;
  checks.record('V2', checks2,
    `v2=${v2Id} seq=${v2.version?.seq} parent=${v2.version?.parent_version_id === v1Id} origin=${v2.version?.origin} shaChanged=${v2.version?.sha256 !== v1.version?.sha256}`);

  // ---- V3: immutable sequence + exact body bytes --------------------------
  const versions = await gw.artifactVersions(artifactId);
  const ordered = [...versions].sort((a, b) => a.seq - b.seq);
  const seqOk =
    ordered.length === 2 &&
    ordered[0].seq === 1 && ordered[1].seq === 2 &&
    ordered[1].parent_version_id === ordered[0].version_id &&
    ordered[0].sha256 !== ordered[1].sha256 &&
    ordered.every((x) => x.sha256?.length === 64);
  checks.record('V3', seqOk,
    `versions=${ordered.length} seqs=[${ordered.map((x) => x.seq).join(',')}] parentChain=${ordered[1]?.parent_version_id === ordered[0]?.version_id}`);

  const body2 = await gw.artifactBody(v2Id);
  const bodyOk =
    body2.body?.includes(phrase2) && !body2.body?.includes(phrase1) &&
    body2.version?.version_id === v2Id;
  checks.record('V3b', bodyOk,
    `v2 body exact includes=${phrase2} excludesV1=${!body2.body?.includes(phrase1)}`);

  // ---- V4: optimistic concurrency — stale base rejected, no version --------
  let staleRejected = false;
  let staleCode = null;
  try {
    await gw.artifactClaimVersion({
      conversation_id: conversationId,
      artifact_id: artifactId,
      kind: 'LOGICAL_ARTIFACT_KIND_DOCUMENT',
      name: `tw-d3-${run}.md`,
      expected_base_version_id: v1Id, // stale: current is v2
      origin: 'ARTIFACT_VERSION_ORIGIN_HUMAN_EDIT',
      body: 'should-not-commit',
      content_type: 'text/plain',
      summary: 'stale edit',
      adopted_attachment_refs: [],
      client_idempotency_key: crypto.randomUUID(),
    });
  } catch (error) {
    staleRejected = true;
    staleCode = error.code ?? null;
    evidence.staleError = error.message;
  }
  const versionsAfterStale = await gw.artifactVersions(artifactId);
  const checks4 = staleRejected && versionsAfterStale.length === 2;
  checks.record('V4', checks4,
    `stale base rejected=${staleRejected} code=${staleCode} versionsStill=${versionsAfterStale.length}`);

  // ---- V5/V6: structural + human checks bound to exact v2 -----------------
  await gw.artifactRecordCheck({
    artifact_id: artifactId,
    version_id: v2Id,
    check_type: 'ARTIFACT_CHECK_TYPE_STRUCTURAL',
    result: 'ARTIFACT_CHECK_RESULT_PASSED',
    detail: 'headless structural validation',
    environment: 'acceptance-cell',
    client_idempotency_key: crypto.randomUUID(),
    source_tool_call_id: '',
    command: '',
    command_exit_code: 0,
    command_output_sha256: '',
  });
  await gw.artifactRecordCheck({
    artifact_id: artifactId,
    version_id: v2Id,
    check_type: 'ARTIFACT_CHECK_TYPE_HUMAN_REVIEW',
    result: 'ARTIFACT_CHECK_RESULT_PASSED',
    detail: 'headless human acceptance',
    environment: 'acceptance-cell',
    client_idempotency_key: crypto.randomUUID(),
    source_tool_call_id: '',
    command: '',
    command_exit_code: 0,
    command_output_sha256: '',
  });
  const checksList = await gw.artifactChecks(artifactId);
  const v2Checks = checksList.filter((c) => c.version_id === v2Id);
  const checks5 =
    v2Checks.length === 2 &&
    v2Checks.some((c) => c.check_type === ARTIFACT_CHECK_TYPE.STRUCTURAL && c.result === ARTIFACT_CHECK_RESULT.PASSED) &&
    v2Checks.some((c) => c.check_type === ARTIFACT_CHECK_TYPE.HUMAN_REVIEW && c.result === ARTIFACT_CHECK_RESULT.PASSED) &&
    v2Checks.every((c) => c.sha256 === v2.version.sha256);
  checks.record('V5', checks5,
    `v2 checks=${v2Checks.length} bound-to-v2-sha=${v2Checks.every((c) => c.sha256 === v2.version.sha256)}`);

  // ---- V7: accept v2 as current --------------------------------------------
  const accept = await gw.artifactAccept({
    artifact_id: artifactId,
    version_id: v2Id,
    client_idempotency_key: crypto.randomUUID(),
  });
  const acceptances = await gw.artifactAcceptances(artifactId);
  const current = acceptances.find((a) => a.current === true);
  const checks7 =
    accept?.acceptance?.version_id === v2Id &&
    current?.version_id === v2Id &&
    current?.current === true;
  checks.record('V6', checks7,
    `accepted v2 current=${current?.version_id === v2Id} acceptanceCount=${acceptances.length}`);

  evidence.artifact = {
    id: artifactId,
    v1: { id: v1Id, sha: v1.version.sha256, origin: v1.version.origin },
    v2: { id: v2Id, sha: v2.version.sha256, origin: v2.version.origin },
    stale_code: staleCode,
    checks: v2Checks.length,
  };
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
}

const report = writeReport(path.join(reportDir, 'tw-d3-artifact-versions.json'), {
  plan: 'TW-20261102',
  closure: 'tw-d3-artifact-versions',
  outcome: 'O04',
  source_commit: process.env.PT_TW_SOURCE_COMMIT ?? gitRev(root),
  station_url: process.env.PEERS_STATION_URL ?? 'persisted-active',
  pass: checks.passCount,
  fail: checks.failCount,
  results: checks.results,
  evidence,
});
console.log(`PASS=${report.pass} FAIL=${report.fail}`);
process.exit(report.fail === 0 ? 0 : 1);
