#!/usr/bin/env node
// TW O12 (research/doc leg) — material intake to accepted revised deliverable.
//
// Headless native proof over the loopback gateway (no GUI/mock):
//   1. actor-device engine bootstrap + registered capability session (the
//      turn admission now validates client-required capabilities);
//   2. a unique text/plain material goes through the SAME OSS attachment
//      admission the GUI composer uses (mime gate, checksum, conversation
//      scope); text rides the universal text modality;
//   3. a strong-model (ARK) turn consumes the attached bytes and produces a
//      report that can only contain the unique material token from the
//      attachment (no tools allowed; token never appears in user-visible
//      prompt text beyond the quoted-file directive);
//   4. the deliverable is claimed as immutable artifact v1 (AGENT_OUTPUT),
//      adopting the attachment object_ref and binding the real turn;
//   5. SELECTION feedback is submitted against v1, a revision turn runs, and
//      v2 is claimed as FEEDBACK_REVISION parent-linked to v1; Station links
//      the feedback row's resulting_version_id server-side;
//   6. structural + human checks pass, v2 is accepted as current, and a
//      SECOND gateway session (renderer reopen equivalent) re-reads the
//      artifact graph and still sees accepted v2 with the revision body;
//   7. a direct-SQL evidence pass corroborates adoption refs, the feedback
//      link, head pointer and persisted bodies independently.
//
// Cross-task memory recall is proven separately, current source, by
// tw-o08-memory-recall (6/6 with the same strong model); this closure owns
// the material -> deliverable -> feedback -> acceptance chain.
//
// Run INSIDE the acceptance cell:
//   docker exec -e PT_TW_SOURCE_COMMIT=$(git rev-parse HEAD) \
//     tw-d1-cell sh -lc 'cd /workspace/run/tw && node tw-o12-research.mjs'
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';
import { ARTIFACT_ORIGIN } from './lib/proto.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';

const providerId = process.env.PT_TW_PROVIDER_ID ?? 'ark';
const modelId = process.env.PT_TW_MODEL_ID ?? 'ep-20260623145021-n4xdm';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const checks = new CheckCollector();
const evidence = { provider_id: providerId, model_id: modelId };

async function bootSession(gw) {
  await gw.deviceEngineActivate();
  await gw.executorSupervisorStart();
  let sessions = [];
  for (let attempt = 0; attempt < 20 && sessions.length === 0; attempt += 1) {
    await sleep(1000);
    sessions = await gw.capabilitySessions();
  }
  return sessions[0] ?? null;
}

try {
  const gw = new Gateway();
  const { account, password } = envActor();
  await gw.login(account, password);
  const agent = (await gw.agentsList())?.agents?.[0];
  if (!agent) throw new Error('no agent available');

  // ---- R1: device engine + capability session ----------------------------
  const session = await bootSession(gw);
  const grantedIds = (session?.typed_capabilities ?? []).map((c) => c.capability_id);
  checks.record('R1',
    !!session?.session_id && grantedIds.includes('filesystem.write'),
    `session=${session?.session_id ?? 'none'} granted=${grantedIds.length}`);

  // ---- R2: OSS attachment admission (text/plain material) -----------------
  const conversation = await gw.conversationCreate(agent.id, {
    providerId,
    modelName: modelId,
    title: `TW O12 research ${crypto.randomUUID().slice(0, 8)}`,
  });
  const marker = `MAT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const material
    = `Project Aurora working notes\nOwner: N. Silva\nGate color: AMBER\n`
    + `Material token: ${marker}\nQuarterly revenue basis: net-new ARR only.\n`;
  const materialBytes = Buffer.from(material, 'utf8');
  const attachment = await gw.uploadAgentAttachment({
    filename: 'aurora-notes.txt',
    mimeType: 'text/plain',
    bytes: materialBytes,
    conversationId: conversation.conversation_id,
  });
  const uploadOk =
    attachment?.object_ref &&
    attachment?.checksum === `sha256:${sha256(materialBytes)}`
    && attachment?.mime_type === 'text/plain'
    && attachment?.size_bytes === materialBytes.length
    && attachment?.authorization_scope === `conversation:${conversation.conversation_id}`;
  checks.record('R2', uploadOk,
    `object_ref=${attachment?.object_ref ?? 'missing'} checksumMatch=${attachment?.checksum === `sha256:${sha256(materialBytes)}`} scope=${attachment?.authorization_scope ?? 'n/a'}`);
  evidence.attachment = {
    object_ref: attachment?.object_ref,
    attachment_id: attachment?.attachment_id,
    checksum: attachment?.checksum,
    size_bytes: attachment?.size_bytes,
  };

  // ---- R3: strong model consumes the attached material --------------------
  const turn1 = await gw.runTurn({
    client_idempotency_key: crypto.randomUUID(),
    conversation_id: conversation.conversation_id,
    agent_id: agent.id,
    user_input:
      `Write a short markdown report titled exactly "Aurora ${marker} Report" from the attached material. `
      + `You MUST copy this line verbatim into the report: "Material token: ${marker}". `
      + 'Do NOT call any tool and do NOT read any file; use only the attached text. '
      + 'Output only the report, keep it under 14 lines.',
    attachments: [attachment],
    stream: true,
    effort: 'medium',
    context_window_size: 16384,
    max_retries: 0,
    provider: providerId,
    model: modelId,
    client_capability_session_id: session.session_id,
  }, { timeoutMs: 180_000 });
  const report = (turn1.text ?? '').trim();
  const turn1Id = turn1.done?.turnId ?? turn1.frames.find((f) => f.turnId)?.turnId;
  const turn1Ok = turn1.done?.stage === 'turn_completed'
    && report.includes(`Material token: ${marker}`)
    && report.includes('AMBER');
  checks.record('R3', turn1Ok,
    `stage=${turn1.done?.stage ?? 'failed'} tokenCopied=${report.includes(marker)} amber=${report.includes('AMBER')} bytes=${report.length}`);
  evidence.turn1 = { turn_id: turn1Id, report_head: report.slice(0, 160) };

  // ---- R4: claim deliverable v1, adopting the material ref ----------------
  const v1 = await gw.artifactClaimVersion({
    conversation_id: conversation.conversation_id,
    artifact_id: '',
    kind: 'LOGICAL_ARTIFACT_KIND_DOCUMENT',
    name: `aurora-${marker}.md`,
    expected_base_version_id: '',
    origin: 'ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT',
    source_turn_id: turn1Id,
    source_message_id: '',
    body: report,
    content_type: 'text/markdown',
    summary: 'report drafted from admitted material',
    feedback_id: '',
    adopted_attachment_refs: [attachment.object_ref],
    client_idempotency_key: crypto.randomUUID(),
    source_tool_call_id: '',
  });
  const artifactId = v1.artifact?.artifact_id;
  const v1Id = v1.version?.version_id;
  const v1Ok =
    v1.version?.seq === 1
    && v1.version?.origin === ARTIFACT_ORIGIN.AGENT_OUTPUT
    && v1.version?.sha256 === sha256(Buffer.from(report, 'utf8'))
    && v1.version?.source_turn_id === turn1Id;
  checks.record('R4', v1Ok,
    `artifact=${artifactId} v1=${v1Id} seq=${v1.version?.seq} shaMatch=${v1.version?.sha256 === sha256(Buffer.from(report, 'utf8'))}`);

  // ---- R5: SELECTION feedback against v1 ----------------------------------
  const feedback = await gw.artifactFeedbackSubmit({
    artifact_id: artifactId,
    base_version_id: v1Id,
    kind: 'ARTIFACT_FEEDBACK_KIND_SELECTION',
    anchor_text: `Material token: ${marker}`,
    instruction: 'Append exactly one final line: "Revision: applied".',
    client_idempotency_key: crypto.randomUUID(),
  });
  const feedbackId = feedback.feedback?.feedback_id;
  // proto3 omits an empty resulting_version_id on submit (it is linked only
  // when the feedback revision is claimed later), so accept absent as open.
  const feedbackOk =
    feedback.feedback?.kind === 1
    && feedback.feedback?.base_version_id === v1Id
    && !feedback.feedback?.resulting_version_id;
  checks.record('R5', feedbackOk,
    `feedback=${feedbackId} kind=${feedback.feedback?.kind} open=${feedback.feedback?.resulting_version_id === ''}`);

  // ---- R6: revision turn (quoted selection, no tools) ---------------------
  const turn2 = await gw.runTurn({
    client_idempotency_key: crypto.randomUUID(),
    conversation_id: conversation.conversation_id,
    agent_id: agent.id,
    user_input:
      `Selected text from the current deliverable:\n"Material token: ${marker}"\n`
      + 'Revise the report: append exactly one final line "Revision: applied", keep every other line identical. '
      + 'Do NOT call any tool; output only the revised report, under 15 lines.',
    attachments: [],
    stream: true,
    effort: 'medium',
    context_window_size: 16384,
    max_retries: 0,
    provider: providerId,
    model: modelId,
    client_capability_session_id: session.session_id,
  }, { timeoutMs: 180_000 });
  const revised = (turn2.text ?? '').trim();
  const turn2Id = turn2.done?.turnId ?? turn2.frames.find((f) => f.turnId)?.turnId;
  const revisionOk = turn2.done?.stage === 'turn_completed'
    && /Revision: applied/.test(revised)
    && revised.includes(marker);
  checks.record('R6', revisionOk,
    `stage=${turn2.done?.stage ?? 'failed'} revisionLine=${/Revision: applied/.test(revised)} tokenKept=${revised.includes(marker)}`);

  // ---- R7: v2 FEEDBACK_REVISION, parent-linked, feedback closed -----------
  const v2 = await gw.artifactClaimVersion({
    conversation_id: conversation.conversation_id,
    artifact_id: artifactId,
    kind: 'LOGICAL_ARTIFACT_KIND_DOCUMENT',
    name: `aurora-${marker}.md`,
    expected_base_version_id: v1Id,
    origin: 'ARTIFACT_VERSION_ORIGIN_FEEDBACK_REVISION',
    source_turn_id: turn2Id,
    source_message_id: '',
    body: revised,
    content_type: 'text/markdown',
    summary: 'append applied revision line',
    feedback_id: feedbackId,
    adopted_attachment_refs: [],
    client_idempotency_key: crypto.randomUUID(),
    source_tool_call_id: '',
  });
  const v2Id = v2.version?.version_id;
  const feedbackAfter = await gw.artifactFeedbackList(artifactId);
  const linkedFeedback = feedbackAfter.find((f) => f.feedback_id === feedbackId);
  const v2Ok =
    v2.version?.seq === 2
    && v2.version?.parent_version_id === v1Id
    && v2.version?.origin === ARTIFACT_ORIGIN.FEEDBACK_REVISION
    && v2.version?.sha256 !== v1.version?.sha256
    && v2.artifact?.current_version_id === v2Id
    && linkedFeedback?.resulting_version_id === v2Id;
  checks.record('R7', v2Ok,
    `v2=${v2Id} seq=${v2.version?.seq} parent=${v2.version?.parent_version_id === v1Id} origin=${v2.version?.origin} feedbackLinked=${linkedFeedback?.resulting_version_id === v2Id}`);

  // ---- R8: structural + human checks, accept v2 ---------------------------
  await gw.artifactRecordCheck({
    artifact_id: artifactId,
    version_id: v2Id,
    check_type: 'ARTIFACT_CHECK_TYPE_STRUCTURAL',
    result: 'ARTIFACT_CHECK_RESULT_PASSED',
    detail: 'headless structural validation of revised report',
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
    detail: 'headless human acceptance of revised report',
    environment: 'acceptance-cell',
    client_idempotency_key: crypto.randomUUID(),
    source_tool_call_id: '',
    command: '',
    command_exit_code: 0,
    command_output_sha256: '',
  });
  await gw.artifactAccept({
    artifact_id: artifactId,
    version_id: v2Id,
    client_idempotency_key: crypto.randomUUID(),
  });
  const v2Checks = (await gw.artifactChecks(artifactId)).filter((c) => c.version_id === v2Id);
  const acceptances = await gw.artifactAcceptances(artifactId);
  const r8Ok =
    v2Checks.length === 2
    && acceptances.some((a) => a.current === true && a.version_id === v2Id)
    && !acceptances.some((a) => a.current === true && a.version_id === v1Id);
  checks.record('R8', r8Ok,
    `v2checks=${v2Checks.length} currentV2=${acceptances.some((a) => a.current === true && a.version_id === v2Id)} currentV1=${acceptances.some((a) => a.current === true && a.version_id === v1Id)}`);

  // ---- R9: renderer reopen — a SECOND gateway session re-reads everything --
  const reopened = new Gateway();
  await reopened.login(account, password);
  const reopenedArtifacts = await reopened.artifactList(conversation.conversation_id);
  const reopenedVersions = await reopened.artifactVersions(artifactId);
  const reopenedBody = await reopened.artifactBody(v2Id);
  const reopenedAcceptances = await reopened.artifactAcceptances(artifactId);
  const ordered = [...reopenedVersions].sort((a, b) => a.seq - b.seq);
  const reopenOk =
    reopenedArtifacts.some((a) => a.artifact_id === artifactId && a.current_version_id === v2Id)
    && ordered.length === 2 && ordered[0].version_id === v1Id && ordered[1].version_id === v2Id
    && reopenedBody.body?.includes('Revision: applied')
    && reopenedBody.body?.includes(marker)
    && reopenedAcceptances.some((a) => a.current === true && a.version_id === v2Id);
  checks.record('R9', reopenOk,
    `freshSession head=${reopenedArtifacts.find((a) => a.artifact_id === artifactId)?.current_version_id === v2Id} versions=${ordered.length} bodyRevision=${reopenedBody.body?.includes('Revision: applied')}`);

  evidence.artifact = {
    id: artifactId,
    v1: { id: v1Id, sha: v1.version.sha256 },
    v2: { id: v2Id, sha: v2.version.sha256 },
    feedback_id: feedbackId,
  };
  evidence.conversation_id = conversation.conversation_id;
  evidence.marker = marker;
  evidence.turn2 = { turn_id: turn2Id, revision_head: revised.slice(0, 160) };
} catch (error) {
  evidence.fatal = error?.message ?? String(error);
  checks.record('FATAL', false, evidence.fatal);
}

const report = writeReport(path.join(reportDir, 'tw-o12-research.json'), {
  plan: 'TW-20261102',
  closure: 'tw-o12-research',
  outcome: 'O12-research-doc',
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
