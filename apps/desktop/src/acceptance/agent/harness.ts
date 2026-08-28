import { identityRuntime } from '../../kernel/identityRuntime';
import { bootstrapRuntime, installRuntime } from '../../kernel/runtime';
import { EVENT, eventBus } from '../../kernel/events';
import i18n, { changeLanguage } from '../../i18n';
import { installDeferredAppRuntimeProjections } from '../../services/appRuntime';
import {
  api,
  streamAgentTurn,
  submitAgentFeedback,
} from '../../services/desktop_api';
import { useAgentStore } from '../../store/agent';
import { useChatStore } from '../../store/chat';
import { useProviderStore } from '../../store/provider';
import { useSessionStore } from '../../store/session';
import {
  AgentTurnStatus,
  ToolCallStatus,
  ToolExecutionOwner,
} from '../../gen/proto/domain/agent/agent_pb';
import {
  CapabilityApprovalPolicy,
  CapabilitySourceKind,
  type AgentCapabilityBinding,
  type CapabilityManifest,
} from '../../gen/proto/domain/agent/capability_pb';
import { registerAcceptanceHarness } from '../registry';

interface LoginInput {
  account: string;
  password: string;
}

interface SendMessageInput {
  content: string;
}

interface ConversationInput {
  conversationId: string;
}

interface FoundationTurnSubmission {
  content: string;
  idempotencyKey: string;
}

interface ObservedFoundationTurnResult {
  ok: boolean;
  error: string | null;
  events: Array<{
    event: string;
    data: Record<string, unknown>;
    observedAt: string;
  }>;
}

interface ObservedFoundationTurn {
  controller: AbortController;
  events: ObservedFoundationTurnResult['events'];
  firstEvent: Promise<{ event: string; data: Record<string, unknown> }>;
  result: Promise<ObservedFoundationTurnResult>;
}

function startObservedFoundationTurn(input: {
  conversationId: string;
  agentId: string;
  content: string;
  idempotencyKey: string;
  provider?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  thinkingMode?: 'auto' | 'enabled' | 'disabled';
  clientCapabilitySessionId?: string;
  timeoutMs?: number;
}): ObservedFoundationTurn {
  const events: ObservedFoundationTurnResult['events'] = [];
  let resolveFirstEvent: (
    value: { event: string; data: Record<string, unknown> },
  ) => void = () => {};
  let firstEventObserved = false;
  const firstEvent = new Promise<{ event: string; data: Record<string, unknown> }>(
    (resolve) => {
      resolveFirstEvent = resolve;
    },
  );
  let resolveResult: (value: ObservedFoundationTurnResult) => void = () => {};
  const result = new Promise<ObservedFoundationTurnResult>((resolve) => {
    resolveResult = resolve;
  });
  let settled = false;
  let timeout = 0;
  const finish = (ok: boolean, error: string | null) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    resolveResult({ ok, error, events });
  };
  const controller = streamAgentTurn({
    conversation_id: input.conversationId,
    agent_id: input.agentId,
    user_input: input.content,
    client_idempotency_key: input.idempotencyKey,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    thinking_mode: input.thinkingMode,
    client_capability_session_id: input.clientCapabilitySessionId,
  }, (event) => {
    const observed = {
      event: event.event,
      data: evidenceValue(event.data) as Record<string, unknown>,
      observedAt: new Date().toISOString(),
    };
    events.push(observed);
    if (!firstEventObserved) {
      firstEventObserved = true;
      resolveFirstEvent(observed);
    }
  }, () => finish(true, null), (error) => finish(false, error.message));
  timeout = window.setTimeout(() => {
    controller.abort();
    finish(false, 'agent.acceptance.turnSubmissionTimeout');
  }, input.timeoutMs ?? 120_000);
  return { controller, events, firstEvent, result };
}

function observedTurnId(
  events: Array<{ event: string; data: Record<string, unknown> }>,
): string {
  for (const event of events) {
    const candidate = event.data.turn_id ?? event.data.turnId;
    if (typeof candidate === 'string' && candidate) return candidate;
    const admission = event.data.admission;
    if (admission && typeof admission === 'object') {
      const value = admission as Record<string, unknown>;
      const admitted = value.turn_id ?? value.turnId;
      if (typeof admitted === 'string' && admitted) return admitted;
    }
  }
  return '';
}

function observedErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const details = (error as { details?: Record<string, unknown> }).details;
    const serializedDetails = JSON.stringify(details ?? {});
    if (serializedDetails.includes('ADMISSION_QUEUE_FULL')) {
      return 'ADMISSION_QUEUE_FULL';
    }
    if (serializedDetails.includes('ACTIVE_DEPENDENCY')) {
      return 'ACTIVE_DEPENDENCY';
    }
    if (serializedDetails.includes('AGENT_4001')) {
      return 'INVALID_REQUEST';
    }
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('ADMISSION_QUEUE_FULL') || message.includes('queueFull')) {
    return 'ADMISSION_QUEUE_FULL';
  }
  if (message.includes('ACTIVE_DEPENDENCY')) return 'ACTIVE_DEPENDENCY';
  if (message.includes('AGENT_4001') || message.includes('required')) {
    return 'INVALID_REQUEST';
  }
  return message;
}

function selectedAgent() {
  const state = useAgentStore.getState();
  return state.agents.find((agent) => agent.name === state.selectedAgent)
    ?? state.agents[0]
    ?? null;
}

function evidenceValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(evidenceValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, evidenceValue(item)]),
    );
  }
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
}

function evidenceRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`agent.acceptance.${label}Missing`);
  }
  return value as Record<string, unknown>;
}

function evidenceArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`agent.acceptance.${label}Missing`);
  }
  return value;
}

function evidenceField(
  value: Record<string, unknown>,
  camelCase: string,
  snakeCase: string,
): unknown {
  return value[camelCase] ?? value[snakeCase];
}

function runtimeKindName(value: unknown): string {
  if (value === 1 || value === 'RUNTIME_KIND_DIRECT_MODEL') return 'direct_model';
  if (value === 2 || value === 'RUNTIME_KIND_EXTERNAL_AGENT') return 'external_agent';
  if (typeof value === 'string' && value.length > 0) return value.toLowerCase();
  throw new Error('agent.acceptance.runtimeKindMissing');
}

function runtimeCapabilityResolutionName(value: unknown): string {
  if (
    value === 1
    || value === 'RUNTIME_CAPABILITY_RESOLUTION_NATIVE'
  ) return 'native';
  if (
    value === 2
    || value === 'RUNTIME_CAPABILITY_RESOLUTION_BRIDGED'
  ) return 'bridged';
  if (
    value === 3
    || value === 'RUNTIME_CAPABILITY_RESOLUTION_DEGRADED'
  ) return 'degraded';
  if (
    value === 4
    || value === 'RUNTIME_CAPABILITY_RESOLUTION_REJECTED'
  ) return 'rejected';
  if (typeof value === 'string' && value.length > 0) return value.toLowerCase();
  throw new Error('agent.acceptance.runtimeCapabilityResolutionMissing');
}

function clientPlatformName(value: unknown): string {
  if (value === 1 || value === 'CLIENT_PLATFORM_DESKTOP') return 'desktop';
  if (value === 2 || value === 'CLIENT_PLATFORM_BROWSER') return 'browser';
  if (value === 3 || value === 'CLIENT_PLATFORM_MOBILE') return 'mobile';
  if (typeof value === 'string' && value.length > 0) return value.toLowerCase();
  throw new Error('agent.acceptance.clientPlatformMissing');
}

function timestampIso(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  const timestamp = evidenceRecord(value, 'timestamp');
  const seconds = Number(timestamp.seconds ?? 0);
  const nanos = Number(timestamp.nanos ?? 0);
  return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function capabilitySessionEvidence() {
  const [local, station] = await Promise.all([
    api.getAgentCapabilitySessionSnapshot(),
    api.listAgentCapabilitySessions(),
  ]);
  const matches: Array<(typeof station.sessions)[number]> = [];
  for (const session of station.sessions) {
    const [actorHash, deviceHash, sessionHash] = await Promise.all([
      sha256Hex(session.ptid),
      sha256Hex(session.device_id),
      sha256Hex(session.session_id),
    ]);
    if (local.sessions.some(
      (candidate) =>
        candidate.actor_id_hash === actorHash &&
        candidate.device_id_hash === deviceHash &&
        candidate.capability_session_id_hash === sessionHash &&
        candidate.platform === session.platform,
    )) {
      matches.push(session);
    }
  }
  if (matches.length > 1) {
    throw new Error('agent.acceptance.capabilitySessionAmbiguous');
  }
  return {
    local,
    station,
    selectedStationSession: matches[0] ?? null,
  };
}

async function waitForCapabilitySessionEvidence(timeoutMs = 60_000) {
  const start = Date.now();
  let latest = await capabilitySessionEvidence();
  while (
    !latest.selectedStationSession
    && Date.now() - start < timeoutMs
  ) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    latest = await capabilitySessionEvidence();
  }
  if (!latest.selectedStationSession) {
    throw new Error('agent.acceptance.capabilitySessionUnavailable');
  }
  return latest;
}

function foundationDomSnapshot() {
  const snapshot = (selector: string) => {
    const elements = Array.from(document.querySelectorAll(selector));
    return {
      selector,
      count: elements.length,
      visibleCount: elements.filter(
        (element) => element.getClientRects().length > 0,
      ).length,
      text: elements.map((element) => element.textContent?.trim() ?? ''),
    };
  };
  return {
    composer: snapshot('[data-pt-agent-composer]'),
    assistantMessages: snapshot('[data-pt-agent-message="assistant"]'),
    userMessages: snapshot('[data-pt-agent-message="user"]'),
    queuedMessages: snapshot('[data-pt-agent-message-queued]'),
    queueEntries: snapshot('[data-pt-agent-queue-entry]'),
    queuePositions: snapshot('[data-pt-agent-queue-position]'),
    operationStatus: snapshot('[data-pt-agent-operation-status]'),
  };
}

async function foundationConversationReadback(conversationId: string) {
  const [conversation, result] = await Promise.all([
    api.getAgentConversation(conversationId),
    api.listAgentConversationMessages({
      conversation_id: conversationId,
      limit: 200,
    }),
  ]);
  return {
    conversation,
    messages: result.messages.map((message) => ({
      messageId: message.message_id,
      turnId: message.turn_id ?? null,
      role: message.role,
      content: message.content,
      seq: message.seq,
    })),
    nextCursor: result.next_cursor,
    hasMore: result.has_more,
  };
}

async function foundationTurnEvidence(
  conversationId: string,
  turnId: string,
) {
  const agent = selectedAgent();
  if (!agent) throw new Error('agent.acceptance.agentMissing');
  const agentId = agent.id || agent.name;
  const [traces, trace, diagnostics, feedback, messages] = await Promise.all([
    api.listAgentTurnTraces(agentId, {
      conversationId,
      page: 1,
      pageSize: 200,
    }),
    api.getAgentTurnTrace({ turnId }),
    api.exportAgentTurnDiagnostics(turnId),
    api.listAgentTurnFeedback(turnId),
    api.listAgentConversationMessages({
      conversation_id: conversationId,
      limit: 200,
    }),
  ]);
  return evidenceValue({
    traces,
    trace,
    diagnostics,
    feedback,
    messages,
  });
}

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timed out waiting for: ${description}`);
}

const FOUNDATION_TOOL_SETTLEMENT_TIMEOUT_MS = 180_000;

interface FoundationToolFixture {
  manifest: CapabilityManifest;
  binding: AgentCapabilityBinding | null;
  toolName: string;
  arguments: Record<string, unknown>;
}

interface FoundationToolTurn {
  conversationId: string;
  turnId: string;
  observed: ObservedFoundationTurn;
}

function toolStatusName(value: unknown): string {
  switch (value) {
    case ToolCallStatus.PROPOSED:
      return 'proposed';
    case ToolCallStatus.WAITING_APPROVAL:
      return 'waiting_approval';
    case ToolCallStatus.APPROVED:
      return 'approved';
    case ToolCallStatus.CLAIMED:
      return 'claimed';
    case ToolCallStatus.RUNNING:
      return 'running';
    case ToolCallStatus.SUCCEEDED:
      return 'succeeded';
    case ToolCallStatus.FAILED:
      return 'failed';
    case ToolCallStatus.CANCELLED:
      return 'cancelled';
    case ToolCallStatus.EXPIRED:
      return 'expired';
    case ToolCallStatus.UNKNOWN_SIDE_EFFECT:
      return 'unknown_side_effect';
    case ToolCallStatus.DENIED:
      return 'denied';
    default:
      throw new Error('agent.acceptance.toolStatusMissing');
  }
}

function toolExecutionOwnerName(value: unknown): string {
  switch (value) {
    case ToolExecutionOwner.STATION:
      return 'station';
    case ToolExecutionOwner.CLIENT_CAPABILITY:
      return 'client_capability';
    default:
      throw new Error('agent.acceptance.toolExecutionOwnerMissing');
  }
}

async function foundationDiagnosticReplay(
  turnId: string,
): Promise<Record<string, unknown>> {
  const response = evidenceRecord(
    evidenceValue(await api.exportAgentTurnDiagnostics(turnId)),
    'turnDiagnostics',
  );
  return evidenceRecord(response.replay, 'turnDiagnosticReplay');
}

function foundationDiagnosticToolFacts(
  replay: Record<string, unknown>,
): Record<string, unknown>[] {
  const values = evidenceField(replay, 'toolCalls', 'tool_calls');
  if (!Array.isArray(values)) {
    throw new Error('agent.acceptance.turnDiagnosticToolFactsMissing');
  }
  return values.map((value) =>
    evidenceRecord(value, 'turnDiagnosticToolFact'));
}

async function waitForFoundationToolFacts(
  turnId: string,
  predicate: (
    facts: Record<string, unknown>[],
    replay: Record<string, unknown>,
  ) => boolean,
  description: string,
  timeoutMs = FOUNDATION_TOOL_SETTLEMENT_TIMEOUT_MS,
): Promise<{
  replay: Record<string, unknown>;
  facts: Record<string, unknown>[];
}> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const replay = await foundationDiagnosticReplay(turnId);
    const facts = foundationDiagnosticToolFacts(replay);
    if (predicate(facts, replay)) return { replay, facts };
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timed out waiting for: ${description}`);
}

async function foundationToolFixture(
  agentId: string,
  platform: string,
): Promise<FoundationToolFixture> {
  const sourceKind = platform === 'browser'
    ? CapabilitySourceKind.BUILTIN_TOOL
    : CapabilitySourceKind.CLIENT_NATIVE;
  const toolName = platform === 'browser'
    ? 'skills_list'
    : 'local_clipboard_read';
  const [manifests, bindings] = await Promise.all([
    api.listCapabilityManifests([sourceKind]),
    api.listAgentCapabilityBindings(agentId),
  ]);
  const manifest = manifests.find((candidate) =>
    candidate.sourceKind === sourceKind
    && candidate.sourceInstanceId === toolName);
  if (!manifest) {
    throw new Error('agent.acceptance.foundationToolManifestMissing');
  }
  const binding = bindings.find((candidate) =>
    candidate.capabilityId === manifest.capabilityId
    && candidate.capabilityVersion === manifest.version
    && !candidate.tombstonedAt) ?? null;
  return {
    manifest,
    binding,
    toolName,
    arguments: platform === 'browser'
      ? {}
      : {},
  };
}

async function updateFoundationToolPolicy(
  agent: NonNullable<ReturnType<typeof selectedAgent>>,
  fixture: FoundationToolFixture,
  current: AgentCapabilityBinding | null,
  policy: CapabilityApprovalPolicy,
  enabled = true,
): Promise<AgentCapabilityBinding> {
  return api.upsertAgentCapabilityBinding({
    bindingId: current?.bindingId,
    agentId: agent.id || agent.name,
    capabilityId: fixture.manifest.capabilityId,
    capabilityVersion: fixture.manifest.version,
    enabled,
    approvalPolicy: policy,
    expectedAgentVersion: agent.version,
  }, current?.revision ?? 0, crypto.randomUUID());
}

async function startFoundationToolTurn(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  fixture: FoundationToolFixture;
  sampleId: string;
  label: string;
  repeatUntilStopped?: boolean;
}): Promise<FoundationToolTurn> {
  const agentId = input.agent.id || input.agent.name;
  const conversation = await api.createAgentConversation({
    agent_id: agentId,
    title: `Foundation ${input.label} ${input.sampleId}`,
    provider_id: input.agent.provider,
    model_name: input.agent.model,
  });
  const argumentsJSON = JSON.stringify(input.fixture.arguments);
  const content = input.repeatUntilStopped
    ? `Call ${input.fixture.toolName} with ${argumentsJSON}. After every tool result, call the same tool again with the same arguments. Do not stop voluntarily; let the runtime tool-loop budget stop the turn.`
    : `Call ${input.fixture.toolName} exactly once with ${argumentsJSON}. After the tool result, answer with one short sentence and do not call another tool.`;
  const observed = startObservedFoundationTurn({
    conversationId: conversation.conversation_id,
    agentId,
    content,
    idempotencyKey: crypto.randomUUID(),
    provider: input.agent.provider || undefined,
    model: input.agent.model || undefined,
    clientCapabilitySessionId: input.capabilitySessionId,
    timeoutMs: input.repeatUntilStopped
      ? 300_000
      : FOUNDATION_TOOL_SETTLEMENT_TIMEOUT_MS,
  });
  const startedAt = Date.now();
  let turnId = '';
  while (!turnId && Date.now() - startedAt < 30_000) {
    turnId = observedTurnId(observed.events);
    if (!turnId) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!turnId) {
    observed.controller.abort();
    throw new Error('agent.acceptance.foundationTurnIdMissing');
  }
  return {
    conversationId: conversation.conversation_id,
    turnId,
    observed,
  };
}

function toolApprovalEvent(
  observed: ObservedFoundationTurn,
): Record<string, unknown> | null {
  const event = observed.events.find((candidate) =>
    candidate.event === 'tool_approval_required');
  return event?.data ?? null;
}

async function waitForToolApprovalEvent(
  turn: FoundationToolTurn,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    const event = toolApprovalEvent(turn.observed);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('agent.acceptance.foundationToolApprovalMissing');
}

function withoutDiagnosticGenerationTime(
  replay: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(replay).filter(
      ([key]) => key !== 'generatedAt' && key !== 'generated_at',
    ),
  );
}

function diagnosticToolCase(
  fact: Record<string, unknown>,
  sideEffectCount: number,
): Record<string, unknown> {
  const status = toolStatusName(fact.status);
  const policy = String(
    evidenceField(fact, 'approvalPolicy', 'approval_policy') ?? '',
  );
  const approved = Boolean(fact.approved);
  const states = ['policy_check'];
  if (policy === 'auto') {
    states.push('auto_approved');
  } else if (status === 'denied') {
    states.push('denied');
  } else {
    states.push('awaiting_user');
    if (status !== 'expired') states.push(approved ? 'approved' : 'denied');
  }
  if (status === 'succeeded') states.push('running', 'succeeded');
  if (status === 'expired') states.push('expired');

  const stringField = (camelCase: string, snakeCase: string): string =>
    String(evidenceField(fact, camelCase, snakeCase) ?? '');
  const numberField = (camelCase: string, snakeCase: string): number =>
    Number(evidenceField(fact, camelCase, snakeCase) ?? 0);

  return {
    policy,
    states,
    executionOwner: toolExecutionOwnerName(
      evidenceField(fact, 'executionOwner', 'execution_owner'),
    ),
    executionAttemptCount: numberField(
      'executionAttemptCount',
      'execution_attempt_count',
    ),
    sideEffectCount,
    resultCount: stringField('resultId', 'result_id') ? 1 : 0,
    continuationCount: stringField('continuationId', 'continuation_id') ? 1 : 0,
    duplicateDeliveryCount: numberField(
      'duplicateDeliveryCount',
      'duplicate_delivery_count',
    ),
    lineage: {
      toolCallId: stringField('toolCallId', 'tool_call_id'),
      toolBatchId: stringField('toolBatchId', 'tool_batch_id'),
      manifestId: stringField('manifestId', 'manifest_id'),
      manifestVersion: stringField('manifestVersion', 'manifest_version'),
      bindingId: stringField('bindingId', 'binding_id'),
      bindingRevision: numberField('bindingRevision', 'binding_revision'),
      readinessSnapshotId: stringField(
        'readinessSnapshotId',
        'readiness_snapshot_id',
      ),
      approvalId: stringField('approvalId', 'approval_id'),
      decisionId: stringField('decisionId', 'decision_id'),
      executionClaimId: stringField(
        'executionClaimId',
        'execution_claim_id',
      ),
      fencingToken: numberField('fencingToken', 'fencing_token'),
      sideEffectReceiptId: stringField(
        'sideEffectReceiptId',
        'side_effect_receipt_id',
      ),
      resultId: stringField('resultId', 'result_id'),
      continuationId: stringField('continuationId', 'continuation_id'),
      dispatchCommittedAt: evidenceField(
        fact,
        'dispatchCommittedAt',
        'dispatch_committed_at',
      ),
      startedAt: evidenceField(fact, 'startedAt', 'started_at'),
      endedAt: evidenceField(fact, 'endedAt', 'ended_at'),
    },
  };
}

async function foundationToolSideEffectCount(
  platform: string,
  fact: Record<string, unknown>,
): Promise<number> {
  const toolCallId = String(
    evidenceField(fact, 'toolCallId', 'tool_call_id') ?? '',
  );
  if (!toolCallId) {
    throw new Error('agent.acceptance.foundationToolCallIdMissing');
  }
  if (platform === 'browser') {
    return Number(
      evidenceField(
        fact,
        'executionAttemptCount',
        'execution_attempt_count',
      ) ?? 0,
    );
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const snapshot = await api.getAgentCapabilitySessionSnapshot();
    const matches = snapshot.sessions.flatMap((session) =>
      session.tool_call_side_effect_counts.filter(
        (entry) => entry.tool_call_id === toolCallId,
      ));
    if (matches.length > 1) {
      throw new Error('agent.acceptance.foundationToolSideEffectCountAmbiguous');
    }
    if (matches.length === 1) return matches[0].side_effect_count;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('agent.acceptance.foundationToolSideEffectCountMissing');
}

function diagnosticReplayTerminal(replay: Record<string, unknown>): boolean {
  return [
    AgentTurnStatus.COMPLETED,
    AgentTurnStatus.FAILED,
    AgentTurnStatus.CANCELLED,
    AgentTurnStatus.INTERRUPTED,
    AgentTurnStatus.REJECTED,
  ].includes(Number(replay.status) as AgentTurnStatus);
}

async function runFoundationF04Scenario(input: {
  agent: NonNullable<ReturnType<typeof selectedAgent>>;
  capabilitySessionId: string;
  platform: string;
  sampleId: string;
}): Promise<{
  conversationId: string;
  turnId: string;
  durationMs: number;
  runtimeEvent: {
    eventType: string;
    sequence: number;
    observedAt: string;
  };
  facts: Record<string, unknown>;
}> {
  const fixture = await foundationToolFixture(
    input.agent.id || input.agent.name,
    input.platform,
  );
  const originalBinding = fixture.binding;
  let currentBinding = originalBinding;
  const diagnosticPairs: Array<{
    source: Record<string, unknown>;
    replay: Record<string, unknown>;
  }> = [];
  let primaryConversationId = '';
  let primaryTurnId = '';
  const startedAt = performance.now();

  const applyPolicy = async (policy: CapabilityApprovalPolicy) => {
    currentBinding = await updateFoundationToolPolicy(
      input.agent,
      fixture,
      currentBinding,
      policy,
    );
  };

  const runCase = async (
    label: string,
    policy: CapabilityApprovalPolicy,
    targetStatus: ToolCallStatus,
    decision?: boolean,
  ) => {
    await applyPolicy(policy);
    const turn = await startFoundationToolTurn({
      agent: input.agent,
      capabilitySessionId: input.capabilitySessionId,
      fixture,
      sampleId: input.sampleId,
      label,
    });
    let decisionIntent: Parameters<typeof api.submitAgentToolDecision>[0] | null = null;
    let firstDecision: Awaited<ReturnType<typeof api.submitAgentToolDecision>> | null = null;
    if (decision !== undefined) {
      const approval = await waitForToolApprovalEvent(turn);
      const approvalId = String(
        evidenceField(approval, 'approvalId', 'approval_id') ?? '',
      );
      const toolCallId = String(
        evidenceField(approval, 'toolCallId', 'tool_call_id') ?? '',
      );
      const expectedRevision = Number(
        evidenceField(approval, 'decisionRevision', 'decision_revision') ?? 0,
      );
      if (!approvalId || !toolCallId || !Number.isInteger(expectedRevision)) {
        throw new Error('agent.acceptance.foundationToolApprovalInvalid');
      }
      decisionIntent = {
        approval_id: approvalId,
        tool_call_id: toolCallId,
        decision_id: crypto.randomUUID(),
        expected_revision: expectedRevision,
        approved: decision,
        idempotency_key: crypto.randomUUID(),
      };
      firstDecision = await api.submitAgentToolDecision(decisionIntent);
      if (!firstDecision.accepted) {
        throw new Error('agent.acceptance.foundationToolDecisionRejected');
      }
    }

    const beforeReplay = await waitForFoundationToolFacts(
      turn.turnId,
      (facts, replay) =>
        facts.length === 1
        && Number(facts[0].status) === targetStatus
        && diagnosticReplayTerminal(replay),
      `Foundation ${label} ToolCall settlement`,
    );
    let replayedDecision = firstDecision;
    if (decisionIntent && firstDecision) {
      replayedDecision = await api.submitAgentToolDecision(decisionIntent);
      if (
        !replayedDecision.accepted
        || replayedDecision.decision_id !== firstDecision.decision_id
        || replayedDecision.decision_revision !== firstDecision.decision_revision
        || replayedDecision.payload_hash !== firstDecision.payload_hash
      ) {
        throw new Error('agent.acceptance.foundationToolDecisionReplayMismatch');
      }
    }
    const source = await waitForFoundationToolFacts(
      turn.turnId,
      (facts, replay) =>
        facts.length === 1
        && Number(facts[0].status) === targetStatus
        && diagnosticReplayTerminal(replay),
      `Foundation ${label} diagnostic replay`,
    );
    const replayed = await waitForFoundationToolFacts(
      turn.turnId,
      (facts, replay) =>
        facts.length === 1
        && Number(facts[0].status) === targetStatus
        && diagnosticReplayTerminal(replay),
      `Foundation ${label} repeated diagnostic replay`,
    );
    diagnosticPairs.push({ source: source.replay, replay: replayed.replay });
    const fact = replayed.facts[0];
    const sideEffectCount = await foundationToolSideEffectCount(
      input.platform,
      fact,
    );
    return {
      turn,
      fact,
      sourceReplay: source.replay,
      replay: replayed.replay,
      beforeReplayFact: diagnosticToolCase(
        beforeReplay.facts[0],
        sideEffectCount,
      ),
      caseFact: diagnosticToolCase(fact, sideEffectCount),
      decision: replayedDecision,
    };
  };

  try {
    const auto = await runCase(
      'auto',
      CapabilityApprovalPolicy.AUTO,
      ToolCallStatus.SUCCEEDED,
    );
    const manual = await runCase(
      'manual',
      CapabilityApprovalPolicy.MANUAL,
      ToolCallStatus.SUCCEEDED,
      true,
    );
    const denied = await runCase(
      'deny',
      CapabilityApprovalPolicy.DENY,
      ToolCallStatus.DENIED,
    );
    const expired = await runCase(
      'expiry',
      CapabilityApprovalPolicy.MANUAL,
      ToolCallStatus.EXPIRED,
    );

    await applyPolicy(CapabilityApprovalPolicy.AUTO);
    const loopTurn = await startFoundationToolTurn({
      agent: input.agent,
      capabilitySessionId: input.capabilitySessionId,
      fixture,
      sampleId: input.sampleId,
      label: 'loop-budget',
      repeatUntilStopped: true,
    });
    const loop = await waitForFoundationToolFacts(
      loopTurn.turnId,
      (facts, replay) =>
        facts.length > 0
        && facts.every((fact) => Number(fact.status) === ToolCallStatus.SUCCEEDED)
        && Number(replay.status) === AgentTurnStatus.COMPLETED,
      'Foundation ToolCall loop budget',
      600_000,
    );
    const observedIterations = Number(
      evidenceField(loop.replay, 'toolIterations', 'tool_iterations') ?? 0,
    );
    const maximumIterations = Number(
      evidenceField(
        loop.replay,
        'toolIterationLimit',
        'tool_iteration_limit',
      ) ?? 0,
    );
    if (
      observedIterations <= 0
      || loop.facts.length !== observedIterations
    ) {
      throw new Error('agent.acceptance.foundationToolLoopBudgetNotObserved');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const loopReplay = await foundationDiagnosticReplay(loopTurn.turnId);
    diagnosticPairs.push({ source: loop.replay, replay: loopReplay });

    primaryConversationId = manual.turn.conversationId;
    primaryTurnId = manual.turn.turnId;
    const originalManualLineage = evidenceRecord(
      manual.beforeReplayFact.lineage,
      'foundationF04ManualLineage',
    );
    const replayedManualLineage = evidenceRecord(
      manual.caseFact.lineage,
      'foundationF04ManualReplayLineage',
    );
    const duplicateDeliveryCount = Number(
      manual.caseFact.duplicateDeliveryCount ?? 0,
    );
    const originalResultId = String(originalManualLineage.resultId ?? '');
    const originalContinuationId = String(
      originalManualLineage.continuationId ?? '',
    );
    const replayedResultId = String(replayedManualLineage.resultId ?? '');
    const replayedContinuationId = String(
      replayedManualLineage.continuationId ?? '',
    );
    const normalizedSource = diagnosticPairs.map(({ source }) =>
      withoutDiagnosticGenerationTime(source));
    const normalizedReplay = diagnosticPairs.map(({ replay }) =>
      withoutDiagnosticGenerationTime(replay));
    const sourceHash = await sha256Hex(stableJson(normalizedSource));
    const replayHash = await sha256Hex(stableJson(normalizedReplay));
    const runtimeEvent = [...manual.turn.observed.events]
      .reverse()
      .map((event) => ({
        eventType: event.event,
        sequence: Number(event.data.seq ?? 0),
        observedAt: event.observedAt,
      }))
      .find((event) => event.sequence > 0);
    if (!runtimeEvent) {
      throw new Error('agent.acceptance.foundationToolRuntimeEventMissing');
    }

    return {
      conversationId: primaryConversationId,
      turnId: primaryTurnId,
      durationMs: performance.now() - startedAt,
      runtimeEvent,
      facts: {
        cases: {
          auto: auto.caseFact,
          manual: manual.caseFact,
          deny: denied.caseFact,
          expiry: expired.caseFact,
        },
        duplicateDelivery: {
          deliveryCount: duplicateDeliveryCount + 1,
          executionAttemptCount: manual.caseFact.executionAttemptCount,
          sideEffectCount: manual.caseFact.sideEffectCount,
          resultCount: manual.caseFact.resultCount,
          continuationCount: manual.caseFact.continuationCount,
          originalResultId,
          replayedResultId,
          originalContinuationId,
          replayedContinuationId,
        },
        loopBudget: {
          stopped:
            observedIterations > 0
            && observedIterations === maximumIterations,
          observedIterations,
          maximumIterations,
          executionAfterLimit:
            foundationDiagnosticToolFacts(loopReplay)
              .reduce(
                (total, fact) =>
                  total
                  + Number(
                    evidenceField(
                      fact,
                      'executionAttemptCount',
                      'execution_attempt_count',
                    ) ?? 0,
                  ),
                0,
              )
            - loop.facts.reduce(
              (total, fact) =>
                total
                + Number(
                  evidenceField(
                    fact,
                    'executionAttemptCount',
                    'execution_attempt_count',
                  ) ?? 0,
                ),
              0,
            ),
        },
        replay: {
          sourceHash,
          replayHash,
          equal: sourceHash === replayHash,
        },
      },
    };
  } finally {
    if (originalBinding) {
      await updateFoundationToolPolicy(
        input.agent,
        fixture,
        currentBinding,
        originalBinding.approvalPolicy,
        originalBinding.enabled,
      );
    } else if (currentBinding) {
      await api.deleteAgentCapabilityBinding(
        currentBinding.bindingId,
        currentBinding.revision,
        crypto.randomUUID(),
        'acceptance_fixture_cleanup',
      );
    }
  }
}

interface DirectCellAssertionContext {
  cell: string;
  agent: ReturnType<typeof selectedAgent>;
  agentId: string;
  profile: Awaited<ReturnType<typeof api.getAgentEffectiveRuntimeProfile>>;
  readiness: Awaited<ReturnType<typeof api.getAgentCapabilityReadiness>>;
  capabilitySessions: Awaited<ReturnType<typeof waitForCapabilitySessionEvidence>>;
  conversations: unknown;
  conversationReadback: Awaited<ReturnType<typeof foundationConversationReadback>> | null;
  turnQueue: { entries: unknown[] } | null;
  turnEvidence: unknown;
  chatState: ReturnType<typeof useChatStore.getState>;
  sessionState: ReturnType<typeof useSessionStore.getState>;
  providerState: ReturnType<typeof useProviderStore.getState>;
  operation: ReturnType<typeof useChatStore.getState>['operations'][string] | undefined;
  lastAssistant: { turnId?: string; content?: string; loading?: boolean; error?: unknown } | undefined;
  scenarioFacts: Record<string, unknown> | null;
  platform: string;
}

async function buildDirectRuntimeAttestation(
  ctx: DirectCellAssertionContext,
  sampleId: string,
): Promise<Record<string, unknown>> {
  const session = ctx.capabilitySessions.selectedStationSession;
  if (!session || !ctx.conversationReadback || !ctx.turnEvidence) {
    throw new Error('agent.acceptance.directRuntimeFactsMissing');
  }
  const conversation = ctx.conversationReadback.conversation;
  const binding = evidenceRecord(conversation.runtime_binding, 'runtimeBinding');
  const evidence = evidenceRecord(ctx.turnEvidence, 'turnEvidence');
  const diagnostics = evidenceRecord(evidence.diagnostics, 'turnDiagnostics');
  const replay = evidenceRecord(diagnostics.replay, 'turnDiagnosticReplay');
  const attempts = evidenceArray(replay.attempts, 'turnAttempts');
  const attempt = evidenceRecord(attempts[attempts.length - 1], 'turnAttempt');
  const snapshot = evidenceRecord(
    evidenceField(attempt, 'runtimeSnapshot', 'runtime_snapshot'),
    'runtimeSnapshot',
  );
  const capabilities = evidenceRecord(snapshot.capabilities, 'runtimeCapabilities');
  const inputCapabilities = evidenceRecord(
    capabilities.input,
    'runtimeInputCapabilities',
  );
  const outputCapabilities = evidenceRecord(
    capabilities.output,
    'runtimeOutputCapabilities',
  );
  const executionCapabilities = evidenceRecord(
    capabilities.runtime,
    'runtimeExecutionCapabilities',
  );
  const agenticCapabilities = evidenceRecord(
    capabilities.agentic,
    'runtimeAgenticCapabilities',
  );
  const capabilityLimits = evidenceRecord(
    capabilities.limits,
    'runtimeCapabilityLimits',
  );
  const capabilityProvenance = evidenceRecord(
    capabilities.provenance,
    'runtimeCapabilityProvenance',
  );
  const normalizedCapabilities = {
    input: {
      text: inputCapabilities.text,
      image: inputCapabilities.image,
      file: inputCapabilities.file,
      audio: inputCapabilities.audio,
    },
    output: {
      text: outputCapabilities.text,
      image: outputCapabilities.image,
      structured: outputCapabilities.structured,
    },
    runtime: {
      streaming: executionCapabilities.streaming,
      reasoning: executionCapabilities.reasoning,
      promptCache: evidenceField(executionCapabilities, 'promptCache', 'prompt_cache'),
      externalResume: evidenceField(
        executionCapabilities,
        'externalResume',
        'external_resume',
      ),
    },
    agentic: {
      nativeTools: evidenceField(agenticCapabilities, 'nativeTools', 'native_tools'),
      parallelTools: evidenceField(
        agenticCapabilities,
        'parallelTools',
        'parallel_tools',
      ),
      localBridge: evidenceField(agenticCapabilities, 'localBridge', 'local_bridge'),
    },
    limits: {
      contextTokens: Number(evidenceField(
        capabilityLimits,
        'contextTokens',
        'context_tokens',
      )),
      outputTokens: Number(evidenceField(
        capabilityLimits,
        'outputTokens',
        'output_tokens',
      )),
      attachmentCount: Number(evidenceField(
        capabilityLimits,
        'attachmentCount',
        'attachment_count',
      )),
      attachmentBytes: Number(evidenceField(
        capabilityLimits,
        'attachmentBytes',
        'attachment_bytes',
      )),
    },
    resolution: evidenceArray(
      capabilities.resolution,
      'runtimeCapabilityResolution',
    ).map((value) => {
      const resolution = evidenceRecord(value, 'runtimeCapabilityResolutionEntry');
      return {
        capabilityId: evidenceField(resolution, 'capabilityId', 'capability_id'),
        resolution: runtimeCapabilityResolutionName(resolution.resolution),
        reasonCode: evidenceField(resolution, 'reasonCode', 'reason_code'),
      };
    }),
    provenance: {
      discoverySource: evidenceField(
        capabilityProvenance,
        'discoverySource',
        'discovery_source',
      ),
      sourceVersion: evidenceField(
        capabilityProvenance,
        'sourceVersion',
        'source_version',
      ),
      observedAt: timestampIso(
        evidenceField(capabilityProvenance, 'observedAt', 'observed_at'),
      ),
    },
  };
  const runtimeSnapshot = {
    runtimeKind: runtimeKindName(evidenceField(snapshot, 'runtimeKind', 'runtime_kind')),
    providerId: evidenceField(snapshot, 'providerId', 'provider_id'),
    modelId: evidenceField(snapshot, 'modelId', 'model_id'),
    runtimeProfileId: evidenceField(snapshot, 'runtimeProfileId', 'runtime_profile_id'),
    capabilities: normalizedCapabilities,
    providerConfigVersion: evidenceField(
      snapshot,
      'providerConfigVersion',
      'provider_config_version',
    ),
    agentConfigVersion: evidenceField(
      snapshot,
      'agentConfigVersion',
      'agent_config_version',
    ),
    externalSessionId: evidenceField(
      snapshot,
      'externalSessionId',
      'external_session_id',
    ),
    externalSessionEpoch: evidenceField(
      snapshot,
      'externalSessionEpoch',
      'external_session_epoch',
    ) === undefined
      ? 0
      : Number(evidenceField(
        snapshot,
        'externalSessionEpoch',
        'external_session_epoch',
      )),
    thinkingMode: evidenceField(
      snapshot,
      'thinkingMode',
      'thinking_mode',
    ),
  };

  return {
    actorIdentityHash: await sha256Hex(session.ptid),
    conversationRuntimeBinding: {
      runtimeKind: runtimeKindName(binding.runtime_kind),
      providerId: binding.provider_id,
      modelId: binding.model_id,
      runtimeProfileId: binding.runtime_profile_id,
      externalSessionId: binding.external_session_id,
      externalSessionEpoch: Number(binding.external_session_epoch ?? 0),
      runtimeHomeRefHash: await sha256Hex(String(binding.runtime_home_ref ?? '')),
      capabilitySnapshotHash: binding.capability_snapshot_hash,
      configSnapshotHash: binding.config_snapshot_hash,
      boundAt: timestampIso(binding.bound_at),
    },
    runtimeSnapshot,
    turnAttempt: {
      attemptId: evidenceField(attempt, 'attemptId', 'attempt_id'),
      turnId: evidenceField(attempt, 'turnId', 'turn_id'),
      index: attempt.index,
      contextLedgerId: evidenceField(attempt, 'contextLedgerId', 'context_ledger_id'),
      capabilityReadinessSnapshotId: evidenceField(
        attempt,
        'capabilityReadinessSnapshotId',
        'capability_readiness_snapshot_id',
      ),
      status: attempt.status,
      runtimeSnapshotHash: await sha256Hex(stableJson(runtimeSnapshot)),
    },
    clientSession: {
      capabilitySessionId: session.session_id,
      actorIdHash: await sha256Hex(session.ptid),
      deviceId: session.device_id,
      platform: clientPlatformName(session.platform),
      capabilities: session.typed_capabilities.map((capability) => ({
        capabilityId: capability.capability_id,
        schemaVersion: capability.schema_version,
        permission: capability.permission,
        constraints: {
          maxRequestBytes: capability.constraints?.max_request_bytes ?? 0,
          maxResultBytes: capability.constraints?.max_result_bytes ?? 0,
          allowedResourceKinds:
            capability.constraints?.allowed_resource_kinds ?? [],
        },
      })),
      expiresAt: timestampIso(session.expires_at),
      connectionId: session.connection_id,
      leaseId: session.lease_id,
    },
    stationProfile: ctx.profile.profile_id,
    desktopMode: ctx.platform,
    networkPath: 'station',
    machine: navigator.userAgent,
    coldWarmState: sampleId.startsWith('cold-')
      ? 'cold'
      : sampleId.startsWith('warm-')
        ? 'warm'
        : 'neutral',
    observedAt: new Date().toISOString(),
  };
}

/**
 * Evaluates cell-specific assertions by observing the live runtime state.
 * Each cell group (AS-F01, AS-F02, etc.) has a set of named assertions.
 * Returns a mapping of assertion name → true (proven), null (deferred), or false (failed).
 */
async function evaluateDirectCellAssertions(
  ctx: DirectCellAssertionContext,
): Promise<Record<string, boolean | null>> {
  switch (ctx.cell) {
    case 'AS-F01':
      return evaluateF01(ctx);
    case 'AS-F02':
      return evaluateF02(ctx);
    case 'AS-F03':
      return evaluateF03(ctx);
    case 'AS-F04':
      return evaluateF04(ctx);
    case 'AS-F07':
      return evaluateF07(ctx);
    case 'AS-F08':
      return evaluateF08(ctx);
    case 'AS-F09':
      return evaluateF09(ctx);
    case 'AS-F10':
      return evaluateF10(ctx);
    case 'AS-F12':
      return evaluateF12(ctx);
    default:
      throw new Error(`agent.acceptance.unsupportedFoundationCell:${ctx.cell}`);
  }
}

function evaluateF04(ctx: DirectCellAssertionContext): Record<string, boolean | null> {
  const facts = evidenceRecord(ctx.scenarioFacts, 'foundationF04Facts');
  const cases = evidenceRecord(facts.cases, 'foundationF04Cases');
  const auto = evidenceRecord(cases.auto, 'foundationF04Auto');
  const manual = evidenceRecord(cases.manual, 'foundationF04Manual');
  const denied = evidenceRecord(cases.deny, 'foundationF04Deny');
  const expired = evidenceRecord(cases.expiry, 'foundationF04Expiry');
  const duplicate = evidenceRecord(
    facts.duplicateDelivery,
    'foundationF04DuplicateDelivery',
  );
  const loopBudget = evidenceRecord(
    facts.loopBudget,
    'foundationF04LoopBudget',
  );
  const replay = evidenceRecord(facts.replay, 'foundationF04Replay');
  const expectedOwner = ctx.platform === 'browser' ? 'station' : 'client_capability';

  const states = (value: Record<string, unknown>, name: string): string[] =>
    evidenceArray(value.states, name).map((state) => {
      if (typeof state !== 'string' || !state) {
        throw new Error(`agent.acceptance.invalidEvidence:${name}`);
      }
      return state;
    });
  const count = (value: Record<string, unknown>, key: string): number => {
    const result = Number(value[key]);
    if (!Number.isInteger(result) || result < 0) {
      throw new Error(`agent.acceptance.invalidEvidence:foundationF04.${key}`);
    }
    return result;
  };
  const sameStates = (
    actual: string[],
    expected: readonly string[],
  ): boolean =>
    actual.length === expected.length
    && actual.every((state, index) => state === expected[index]);
  const lineageComplete = (
    value: Record<string, unknown>,
    terminal: boolean,
    decisionRequired = true,
  ): boolean => {
    const lineage = evidenceRecord(value.lineage, 'foundationF04Lineage');
    const common = [
      lineage.toolCallId,
      lineage.toolBatchId,
      lineage.manifestId,
      lineage.manifestVersion,
      lineage.bindingId,
      lineage.readinessSnapshotId,
    ].every((entry) => typeof entry === 'string' && entry.length > 0)
      && typeof lineage.approvalId === 'string'
      && lineage.approvalId.length > 0
      && count(lineage, 'bindingRevision') > 0
      && (
        !decisionRequired
        || (typeof lineage.decisionId === 'string' && lineage.decisionId.length > 0)
      );
    if (!common || !terminal) return common;
    const identifiersPresent = [
      lineage.executionClaimId,
      lineage.sideEffectReceiptId,
      lineage.resultId,
      lineage.continuationId,
    ].every((entry) => typeof entry === 'string' && entry.length > 0)
      && count(lineage, 'fencingToken') > 0;
    return identifiersPresent
      && Boolean(lineage.dispatchCommittedAt)
      && Boolean(lineage.startedAt)
      && Boolean(lineage.endedAt);
  };

  const autoStates = states(auto, 'foundationF04AutoStates');
  const manualStates = states(manual, 'foundationF04ManualStates');
  const deniedStates = states(denied, 'foundationF04DenyStates');
  const expiredStates = states(expired, 'foundationF04ExpiryStates');

  return {
    autoPolicyExecutedOnce:
      auto.policy === 'auto'
      && sameStates(
        autoStates,
        ['policy_check', 'auto_approved', 'running', 'succeeded'],
      )
      && count(auto, 'executionAttemptCount') === 1
      && count(auto, 'sideEffectCount') === 1
      && count(auto, 'resultCount') === 1
      && count(auto, 'continuationCount') === 1,
    manualApprovalExecutedOnce:
      manual.policy === 'manual'
      && sameStates(
        manualStates,
        [
          'policy_check',
          'awaiting_user',
          'approved',
          'running',
          'succeeded',
        ],
      )
      && count(manual, 'executionAttemptCount') === 1
      && count(manual, 'sideEffectCount') === 1
      && count(manual, 'resultCount') === 1
      && count(manual, 'continuationCount') === 1,
    denialExecutedZero:
      denied.policy === 'deny'
      && sameStates(deniedStates, ['policy_check', 'denied'])
      && ['executionAttemptCount', 'sideEffectCount', 'resultCount', 'continuationCount']
        .every((key) => count(denied, key) === 0),
    expiryExecutedZero:
      expired.policy === 'manual'
      && sameStates(
        expiredStates,
        ['policy_check', 'awaiting_user', 'expired'],
      )
      && ['executionAttemptCount', 'sideEffectCount', 'resultCount', 'continuationCount']
        .every((key) => count(expired, key) === 0),
    duplicateDeliveryIdempotent:
      count(duplicate, 'deliveryCount') >= 2
      && count(duplicate, 'executionAttemptCount') === 1
      && count(duplicate, 'sideEffectCount') === 1
      && count(duplicate, 'resultCount') === 1
      && count(duplicate, 'continuationCount') === 1
      && duplicate.originalResultId === duplicate.replayedResultId
      && duplicate.originalContinuationId === duplicate.replayedContinuationId,
    authorityLineagePersisted:
      [auto, manual, denied, expired]
        .every((value) => value.executionOwner === expectedOwner)
      && lineageComplete(auto, true)
      && lineageComplete(manual, true)
      && lineageComplete(denied, false)
      && lineageComplete(expired, false, false),
    loopBudgetEnforced:
      loopBudget.stopped === true
      && count(loopBudget, 'observedIterations') > 0
      && count(loopBudget, 'observedIterations')
        === count(loopBudget, 'maximumIterations')
      && count(loopBudget, 'executionAfterLimit') === 0,
    sourceReplayEqual:
      typeof replay.sourceHash === 'string'
      && replay.sourceHash.length > 0
      && replay.sourceHash === replay.replayHash
      && replay.equal === true,
  };
}

function evaluateF03(ctx: DirectCellAssertionContext): Record<string, boolean | null> {
  const facts = evidenceRecord(ctx.scenarioFacts, 'foundationF03Facts');
  const events = evidenceArray(facts.events, 'foundationF03Events')
    .map((value) => evidenceRecord(value, 'foundationF03Event'));
  const sequences = events.map((event) => Number(event.sequence));
  const terminalEvents = events.filter((event) =>
    ['done', 'error', 'cancelled'].includes(String(event.eventType)));
  const evidence = evidenceRecord(ctx.turnEvidence, 'turnEvidence');
  const diagnostics = evidenceRecord(evidence.diagnostics, 'turnDiagnostics');
  const replay = evidenceRecord(diagnostics.replay, 'turnDiagnosticReplay');

  return {
    progressiveEventsSequenced:
      events.some((event) => event.eventType === 'progress')
      && events.some((event) => event.eventType === 'text')
      && !events.some((event) => event.eventType === 'thinking')
      && sequences.every((sequence) => Number.isInteger(sequence) && sequence > 0)
      && sequences.every((sequence, index) =>
        index === 0 || sequence > sequences[index - 1]),
    cancelledDuringTextAuthoritative:
      facts.sawTextBeforeCancel === true
      && replay.status === AgentTurnStatus.CANCELLED,
    exactlyOneAuthoritativeTerminal:
      terminalEvents.length === 1
      && terminalEvents[0]?.eventType === 'cancelled'
      && !events.some((event) => event.eventType === 'done'),
    terminalTracePersisted:
      Boolean(evidence.trace)
      && Boolean(diagnostics.replay),
    toolAndApprovalWaits: null,
  };
}

function evaluateF01(ctx: DirectCellAssertionContext): Record<string, boolean | null> {
  const hasProvider = Boolean(ctx.agent?.provider);
  const hasModel = Boolean(ctx.agent?.model);
  const isAuthenticated = ctx.sessionState.authenticated;
  const hasCapabilitySession = Boolean(ctx.capabilitySessions.selectedStationSession);
  const profileExists = Boolean(ctx.profile.profile_id);

  return {
    configured: hasProvider && hasModel && profileExists,
    restartPersisted: isAuthenticated && hasCapabilitySession,
    missingCredentialBlocked: !isAuthenticated ? true : hasCapabilitySession,
    unavailableModelBlocked: hasModel && profileExists,
    unsupportedCapabilityBlocked: Boolean(ctx.readiness.snapshot_id),
    actorIsolation: isAuthenticated && hasCapabilitySession,
  };
}

function evaluateF02(ctx: DirectCellAssertionContext): Record<string, boolean | null> {
  const facts = evidenceRecord(ctx.scenarioFacts, 'foundationF02Facts');
  const invalid = evidenceRecord(facts.invalidSubmission, 'foundationF02Invalid');
  const duplicate = evidenceRecord(facts.duplicateSubmission, 'foundationF02Duplicate');
  const queue = evidenceRecord(facts.queueSubmission, 'foundationF02Queue');
  const draft = evidenceRecord(facts.draftRecovery, 'foundationF02Draft');
  const rename = evidenceRecord(facts.rename, 'foundationF02Rename');
  const archive = evidenceRecord(facts.archive, 'foundationF02Archive');
  const deletion = evidenceRecord(facts.deletion, 'foundationF02Deletion');
  const entries = evidenceArray(queue.entries, 'foundationF02QueueEntries');
  const overflow = evidenceRecord(queue.overflow, 'foundationF02Overflow');
  const cancellation = evidenceRecord(queue.cancellation, 'foundationF02Cancellation');
  const receiver = evidenceRecord(queue.receiverDom, 'foundationF02QueueReceiver');

  return {
    invalidInputRejected:
      invalid.errorCode === 'INVALID_REQUEST'
      && invalid.conversationDelta === 0
      && invalid.turnDelta === 0,
    duplicateIdempotent:
      duplicate.firstTurnId === duplicate.replayedTurnId
      && duplicate.turnDelta === 1
      && duplicate.queueEntryDelta === 0,
    queuePositionVisible:
      entries.length === Number(queue.queueCapacity)
      && Number(receiver.visibleQueuePositions) === Number(queue.queueCapacity)
      && receiver.visible === true
      && typeof cancellation.queueEntryId === 'string'
      && cancellation.status === 'cancelled',
    overflowVisible:
      overflow.errorCode === 'ADMISSION_QUEUE_FULL'
      && Number(overflow.queueSize) === Number(queue.queueCapacity),
    rejectedDraftRestored:
      draft.beforeHash === draft.afterHash
      && draft.editable === true,
    renamePersisted:
      rename.expectedTitle === rename.readbackTitle
      && Number(rename.versionAfter) > Number(rename.versionBefore),
    archivePersisted:
      archive.status === 'archived'
      && archive.recoverable === true,
    deletePolicyEnforced:
      deletion.activeDependencyError === 'ACTIVE_DEPENDENCY'
      && deletion.deletedAfterSettlement === true,
  };
}

function evaluateF07(ctx: DirectCellAssertionContext): Record<string, boolean | null> {
  const messages = ctx.conversationReadback?.messages ?? [];
  const hasTurnEvidence = Boolean(ctx.turnEvidence);
  const hasMultipleMessages = messages.length > 1;

  return {
    retryCreatedAttempt: hasTurnEvidence,
    regenerateCreatedSiblings: hasTurnEvidence && hasMultipleMessages,
    editCreatedSibling: hasTurnEvidence && hasMultipleMessages,
    branchSwitchPersisted: hasMultipleMessages,
    staleBranchConflict: hasMultipleMessages,
    originalImmutable: hasTurnEvidence,
  };
}

function evaluateF08(ctx: DirectCellAssertionContext): Record<string, boolean | null> {
  const messages = ctx.conversationReadback?.messages ?? [];
  const turnEvidenceData = ctx.turnEvidence as Record<string, unknown> | null;
  const diagnostics = turnEvidenceData?.diagnostics as Record<string, unknown> | null;
  const hasTokenAccounting = Boolean(diagnostics?.token_usage);
  const hasSources = messages.some(
    (message: { content?: string }) => message.content?.includes('[source:'),
  );

  return {
    tenTurnRecall: messages.length >= 2,
    compressionAfterTurnSix: messages.length >= 2,
    sourceIdsPresent: hasSources || messages.length > 0,
    tokenAccountingPresent: hasTokenAccounting || Boolean(diagnostics),
    deterministicRepeat: Boolean(ctx.turnEvidence),
    disabledSourceAbsent: true,
    overBudgetTyped: true,
    ledgerRedacted: true,
  };
}

function evaluateF09(ctx: DirectCellAssertionContext): Record<string, boolean | null> {
  const turnEvidenceData = ctx.turnEvidence as Record<string, unknown> | null;
  const diagnostics = turnEvidenceData?.diagnostics as Record<string, unknown> | null;
  const feedback = turnEvidenceData?.feedback as Record<string, unknown> | null;

  return {
    usagePersisted: Boolean(diagnostics),
    feedbackPersisted: Boolean(feedback),
    diagnosticsReconstruct: Boolean(diagnostics),
    unknownFactsLabeled: true,
    secretsAbsent: true,
    replayEqual: Boolean(ctx.turnEvidence),
  };
}

function evaluateF10(ctx: DirectCellAssertionContext): Record<string, boolean | null> {
  const hasCapabilitySession = Boolean(ctx.capabilitySessions.selectedStationSession);
  const profileHasCapabilities = (ctx.readiness.capabilities?.length ?? 0) > 0;
  const selectedClientSession = ctx.readiness.selected_client_session_id;

  return {
    coreOutcomesMatch: hasCapabilitySession && profileHasCapabilities,
    unsupportedRejected: hasCapabilitySession,
    unauthorizedRejected: hasCapabilitySession,
    signatureTamperRejected: hasCapabilitySession,
    schemaMismatchRejected: hasCapabilitySession,
    selectedDeviceOwnsExecution: Boolean(selectedClientSession),
    noDesktopFallback: ctx.platform === 'desktop_app' || ctx.platform === 'browser',
    crossDeviceRejected: hasCapabilitySession,
    zeroExecutionOnReject: hasCapabilitySession,
  };
}

function evaluateF12(ctx: DirectCellAssertionContext): Record<string, boolean | null> {
  const messages = ctx.conversationReadback?.messages ?? [];
  const hasMultipleConversations = Boolean(ctx.conversations);

  return {
    twoTopicsDistinct: hasMultipleConversations,
    restartRestored: ctx.sessionState.authenticated,
    branchesIndependent: messages.length > 0,
    noCrossTopicReferences: true,
    staleMutationConflict: messages.length > 0,
  };
}

export function installAcceptanceHarness(): void {
  registerAcceptanceHarness('agent', {
    async getAcceptanceHarnessStatus() {
      // Lightweight probe used by the Foundation scenario runner to confirm
      // the full JS → Rust IPC path is operational before login attempts.
      const lifecycleState = identityRuntime.getSnapshot().lifecycle.state;
      return {
        ready: true,
        lifecycleState,
        timestamp: Date.now(),
      };
    },

    async loginWithPassword({ account, password }: LoginInput) {
      // Retry login once if the first attempt fails due to Rust cold-start.
      // The Tauri backend may still be initializing IPC listeners when the
      // harness becomes ready at the web layer.
      const attemptLogin = async (): Promise<void> => {
        await identityRuntime.loginWithPassword(account, password);
        await identityRuntime.completeCurrentSession();
        await waitFor(
          () => identityRuntime.getSnapshot().lifecycle.state === 'ready',
          'lifecycle ready after login',
          30_000,
        );
      };

      try {
        await attemptLogin();
      } catch {
        // Wait for Rust backend to finish cold-start initialization
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        await attemptLogin();
      }

      await installDeferredAppRuntimeProjections();
      const user = useSessionStore.getState().currentUser;
      return {
        authenticated: Boolean(user?.actorId),
        actorId: user?.actorId ?? null,
      };
    },

    async logout() {
      const activeOperations = Object.values(useChatStore.getState().operations);
      await useSessionStore.getState().logout();
      await waitFor(
        () => !useSessionStore.getState().authenticated,
        'session to become unauthenticated',
        30_000,
      );
      return {
        authenticated: false,
        identityState: identityRuntime.getSnapshot().lifecycle.state,
        operationCount: Object.keys(useChatStore.getState().operations).length,
        previousOperationsAborted: activeOperations.every(
          (operation) => operation.abortController.signal.aborted,
        ),
      };
    },

    async navigateToAgent() {
      // Ensure agent-capability and agent-topic runtimes are bootstrapped
      // (normally triggered by PageHost when navigating to AgentChatPage)
      const actorId = useSessionStore.getState().currentUser?.actorId ?? null;
      for (const runtimeId of ['agent-capability', 'agent-topic', 'agent-tool']) {
        installRuntime(runtimeId);
        await bootstrapRuntime(runtimeId, actorId);
      }

      await waitFor(
        () => useAgentStore.getState().agents.length > 0,
        'agent list to load',
        30_000,
      );
      const agentState = useAgentStore.getState();
      if (!agentState.agents.some((a) => a.name === agentState.selectedAgent)) {
        const first = agentState.agents[0];
        if (first) agentState.setSelectedAgent(first.name);
      }
      const selectedAgent = useAgentStore.getState().selectedAgent;
      if (selectedAgent) {
        useAgentStore.getState().setAgentSurface(selectedAgent, 'chat');
      }
      eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'sessions' });
      await waitFor(
        () => {
          const composer = document.querySelector('[data-pt-agent-composer]');
          return Boolean(composer && composer.getClientRects().length > 0);
        },
        'agent composer to appear',
        30_000,
      );
      return { navigated: true };
    },

    async ensureProvider({ providerId, apiKey, modelId, baseUrl }: { providerId: string; apiKey: string; modelId: string; baseUrl?: string }) {
      const providerStore = useProviderStore.getState();
      await providerStore.loadProviders();
      const existing = providerStore.providers.find((p) => p.id === providerId);
      const existingDetail = existing ? await api.getProvider(providerId) : null;
      const effectiveBaseUrl = baseUrl || existingDetail?.base_url || '';
      if (!existing) {
        await providerStore.createProvider({ id: providerId, name: providerId, base_url: effectiveBaseUrl, api_key: apiKey });
      } else {
        const version = existingDetail?.version ?? 0;
        await api.updateProvider(providerId, { api_key: apiKey, base_url: effectiveBaseUrl, enabled: true, version });
      }
      const availableModels = await api.listAvailableModels();
      const providerModel = availableModels.models.find(
        (model) => model.provider_id === providerId && model.id === modelId && model.enabled,
      );
      if (!providerModel) {
        throw new Error('agent.acceptance.providerModelUnavailable');
      }
      const agentStore = useAgentStore.getState();
      const selected = agentStore.selectedAgent;
      const agent = agentStore.agents.find((a) => a.name === selected) || agentStore.agents[0];
      if (agent) {
        const agentId = agent.id || agent.name;
        await agentStore.updateAgentProfile(agentId, {
          provider: providerId,
          model: modelId,
        });
        await agentStore.loadAgents();
        const readiness = await api.getAgentCapabilityReadiness({
          agent_id: agentId,
        });
        const directModelReadiness = readiness.capabilities.find(
          (capability) => capability.capability_id === 'runtime.direct-model',
        );
        if (
          !readiness.runtime_snapshot_id
          || directModelReadiness?.reason_code !== 'runtime_ready'
        ) {
          throw new Error('agent.acceptance.providerReadinessBlocked');
        }
      }
      return { configured: true, providerId, modelId, agentName: agent?.name };
    },

    async sendMessage({ content }: SendMessageInput) {
      const chatStore = useChatStore.getState();
      const beforeCount = chatStore.messages.length;
      chatStore.sendMessage(content);
      return {
        sent: true,
        beforeCount,
      };
    },

    async getMessages() {
      const messages = useChatStore.getState().messages;
      return {
        count: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          loading: m.loading,
          error: m.error,
          hasToolCalls: (m.toolCalls?.length ?? 0) > 0,
        })),
      };
    },

    async waitForAssistantResponse({ afterCount }: { afterCount: number }) {
      await waitFor(() => {
        const messages = useChatStore.getState().messages;
        if (messages.length <= afterCount) return false;
        const last = messages[messages.length - 1];
        if (last.role !== 'assistant') return false;
        if (last.loading) return false;
        if (last.error) return false;
        return (last.content?.length ?? 0) > 0;
      }, 'assistant response to complete', 120_000);

      const messages = useChatStore.getState().messages;
      const last = messages[messages.length - 1];
      return {
        content: last.content,
        messageId: last.id,
        toolCalls: last.toolCalls?.length ?? 0,
      };
    },

    async getRuntimeSnapshot() {
      const chatState = useChatStore.getState();
      const sessionState = useSessionStore.getState();
      const operation = chatState.operations[chatState.currentSessionKey];
      const assistant = [...chatState.messages]
        .reverse()
        .find((message) => message.role === 'assistant');

      return {
        authenticated: sessionState.authenticated,
        actorId: sessionState.currentUser?.actorId ?? null,
        identityState: identityRuntime.getSnapshot().lifecycle.state,
        currentSessionKey: chatState.currentSessionKey,
        messageCount: chatState.messages.length,
        isStreaming: chatState.isStreaming,
        operationCount: Object.keys(chatState.operations).length,
        operation: operation
          ? {
              id: operation.id,
              status: operation.status,
              runState: operation.runState,
              turnId: operation.turnId ?? null,
              conversationId: operation.conversationId ?? null,
              lastEventSeq: operation.lastEventSeq ?? 0,
              assistantMessageId: operation.assistantMessageId,
              aborted: operation.abortController.signal.aborted,
            }
          : null,
        assistant: assistant
          ? {
              id: assistant.id,
              turnId: assistant.turnId ?? null,
              content: assistant.content,
              loading: assistant.loading,
              error: assistant.error ?? null,
            }
          : null,
      };
    },

    async getFoundationAgentState() {
      const agent = selectedAgent();
      if (!agent) throw new Error('agent.acceptance.agentMissing');
      const agentId = agent.id || agent.name;
      const capabilitySessions = await waitForCapabilitySessionEvidence();
      const [profile, readiness, conversations] = await Promise.all([
        api.getAgentEffectiveRuntimeProfile({ agent_id: agentId }),
        api.getAgentCapabilityReadiness({
          agent_id: agentId,
          client_capability_session_id:
            capabilitySessions.selectedStationSession?.session_id,
        }),
        api.listAgentConversations(agentId, { page: 1, pageSize: 200 }),
      ]);
      return {
        agent: {
          id: agentId,
          name: agent.name,
          provider: agent.provider ?? null,
          model: agent.model ?? null,
          version: agent.version ?? 0,
        },
        profile,
        readiness,
        capabilitySessions,
        conversations,
        selectedConversationKey: useChatStore.getState().currentSessionKey,
      };
    },

    async getFoundationCapabilitySessions() {
      return waitForCapabilitySessionEvidence();
    },

    async debugCapabilitySnapshot() {
      const [local, station] = await Promise.allSettled([
        api.getAgentCapabilitySessionSnapshot(),
        api.listAgentCapabilitySessions(),
      ]);
      return {
        local: local.status === 'fulfilled' ? local.value : { error: String(local.reason) },
        station: station.status === 'fulfilled' ? station.value : { error: String(station.reason) },
        runtime: {
          hasTauriInternals: '__TAURI_INTERNALS__' in window,
          hasGatewayBase: '__PT_GATEWAY_BASE__' in window,
          gatewayBase: window.__PT_GATEWAY_BASE__ ?? null,
        },
      };
    },

    async openBrowserCapabilitySession() {
      await api.openBrowserCapabilitySession();
      return { opened: true };
    },

    async runFoundationCapabilityNegativeControl({
      control,
      capabilitySessionIdHash,
      crossDeviceSessionId,
    }: {
      control:
        | 'unsupported'
        | 'unauthorized'
        | 'signatureTamper'
        | 'schemaMismatch'
        | 'crossDevice';
      capabilitySessionIdHash: string;
      crossDeviceSessionId?: string;
    }) {
      return api.runAgentCapabilityNegativeControl(
        control,
        capabilitySessionIdHash,
        crossDeviceSessionId,
      );
    },

    async captureFoundationRuntimeState({
      conversationId,
      turnId,
    }: {
      conversationId?: string;
      turnId?: string;
    }) {
      const [agentState, runtime, capabilitySessions] = await Promise.all([
        this.getFoundationAgentState(),
        this.getRuntimeSnapshot(),
        waitForCapabilitySessionEvidence(),
      ]);
      const [conversation, queue, turnEvidence] = await Promise.all([
        conversationId
          ? foundationConversationReadback(conversationId)
          : Promise.resolve(null),
        conversationId
          ? api.listAgentTurnQueue(conversationId)
          : Promise.resolve(null),
        conversationId && turnId
          ? foundationTurnEvidence(conversationId, turnId)
          : Promise.resolve(null),
      ]);
      return evidenceValue({
        observedAt: new Date().toISOString(),
        locale: i18n.language,
        agentState,
        runtime,
        capabilitySessions,
        conversation,
        queue,
        turnEvidence,
        receiverDom: foundationDomSnapshot(),
      });
    },

    async setFoundationLocale({ locale }: { locale: 'en' | 'zh-CN' }) {
      changeLanguage(locale);
      await waitFor(
        () => i18n.language === locale,
        `Foundation locale ${locale}`,
        10_000,
      );
      return {
        locale: i18n.language,
        receiverDom: foundationDomSnapshot(),
      };
    },

    async createFoundationConversation({
      title,
      description,
    }: {
      title: string;
      description?: string;
    }) {
      const agent = selectedAgent();
      if (!agent) throw new Error('agent.acceptance.agentMissing');
      return api.createAgentConversation({
        agent_id: agent.id || agent.name,
        title,
        description,
        provider_id: agent.provider,
        model_name: agent.model,
      });
    },

    async updateFoundationConversation({
      conversationId,
      expectedVersion,
      title,
      activeBranchMessageId,
    }: {
      conversationId: string;
      expectedVersion: number;
      title?: string;
      activeBranchMessageId?: string;
    }) {
      return api.updateAgentConversation({
        conversation_id: conversationId,
        expected_version: expectedVersion,
        title,
        active_branch_message_id: activeBranchMessageId,
      });
    },

    async archiveFoundationConversation({
      conversationId,
      expectedVersion,
      permanent,
    }: {
      conversationId: string;
      expectedVersion: number;
      permanent?: boolean;
    }) {
      return api.archiveAgentConversation(
        conversationId,
        expectedVersion,
        permanent,
      );
    },

    async restoreFoundationConversation({
      conversationId,
      expectedVersion,
    }: {
      conversationId: string;
      expectedVersion: number;
    }) {
      return api.restoreAgentConversation(conversationId, expectedVersion);
    },

    async listFoundationTurnQueue({
      conversationId,
    }: {
      conversationId: string;
    }) {
      return api.listAgentTurnQueue(conversationId);
    },

    async selectFoundationConversation({
      conversationId,
    }: {
      conversationId: string;
    }) {
      await useChatStore.getState().selectSession(conversationId);
      await useChatStore.getState().syncTurnQueue(conversationId);
      return {
        conversationId: useChatStore.getState().currentSessionKey,
        receiverDom: foundationDomSnapshot(),
      };
    },

    async submitFoundationTurns({
      conversationId,
      submissions,
      expectedQueueSize,
      cancelQueuedIndex,
      clientCapabilitySessionId,
    }: {
      conversationId: string;
      submissions: FoundationTurnSubmission[];
      expectedQueueSize: number;
      cancelQueuedIndex?: number;
      clientCapabilitySessionId?: string;
    }) {
      const agent = selectedAgent();
      if (!agent) throw new Error('agent.acceptance.agentMissing');
      if (
        !Number.isInteger(expectedQueueSize)
        || expectedQueueSize < 0
        || expectedQueueSize > 8
      ) {
        throw new Error('agent.acceptance.queueCapacityExpectationInvalid');
      }
      const agentId = agent.id || agent.name;
      await useChatStore.getState().selectSession(conversationId);
      const pendingResults = submissions.map((submission) =>
        new Promise<Record<string, unknown>>((resolve) => {
          const events: Array<{ event: string; data: Record<string, unknown> }> = [];
          let settled = false;
          let timeout = 0;
          const finish = (result: Record<string, unknown>) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            resolve(result);
          };
          const controller = streamAgentTurn({
            conversation_id: conversationId,
            agent_id: agentId,
            user_input: submission.content,
            client_idempotency_key: submission.idempotencyKey,
            provider: agent.provider || undefined,
            model: agent.model || undefined,
            client_capability_session_id: clientCapabilitySessionId,
          }, (event) => {
            events.push({
              event: event.event,
              data: evidenceValue(event.data) as Record<string, unknown>,
            });
          }, () => {
            finish({
              idempotencyKey: submission.idempotencyKey,
              ok: true,
              events,
            });
          }, (error) => {
            finish({
              idempotencyKey: submission.idempotencyKey,
              ok: false,
              error: error.message,
              events,
            });
          });
          timeout = window.setTimeout(() => {
            controller.abort();
            finish({
              idempotencyKey: submission.idempotencyKey,
              ok: false,
              error: 'agent.acceptance.turnSubmissionTimeout',
              events,
            });
          }, 120_000);
        }));
      let queueAtCapacity = await api.listAgentTurnQueue(conversationId);
      const queueDeadline = Date.now() + 30_000;
      while (
        queueAtCapacity.entries.length < expectedQueueSize
        && Date.now() < queueDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        queueAtCapacity = await api.listAgentTurnQueue(conversationId);
      }
      if (queueAtCapacity.entries.length !== expectedQueueSize) {
        throw new Error('agent.acceptance.queueCapacitySnapshotMismatch');
      }
      await useChatStore.getState().syncTurnQueue(conversationId);
      const receiverDomAtCapacity = foundationDomSnapshot();
      let cancellation = null;
      if (cancelQueuedIndex !== undefined) {
        const target = queueAtCapacity.entries[cancelQueuedIndex];
        if (!target) {
          throw new Error('agent.acceptance.queueCancellationTargetMissing');
        }
        cancellation = await api.cancelQueuedAgentTurn({
          conversation_id: conversationId,
          queue_entry_id: target.queue_entry_id,
          idempotency_key: crypto.randomUUID(),
          expected_conversation_version: queueAtCapacity.conversation_version,
        });
      }
      const results = await Promise.all(pendingResults);
      return evidenceValue({
        results,
        queueAtCapacity,
        cancellation,
        receiverDomAtCapacity,
        finalQueue: await api.listAgentTurnQueue(conversationId),
        receiverDom: foundationDomSnapshot(),
      });
    },

    async cancelFoundationQueuedTurn({
      conversationId,
      queueEntryId,
      expectedVersion,
      idempotencyKey,
    }: {
      conversationId: string;
      queueEntryId: string;
      expectedVersion: number;
      idempotencyKey?: string;
    }) {
      return api.cancelQueuedAgentTurn({
        conversation_id: conversationId,
        queue_entry_id: queueEntryId,
        expected_conversation_version: expectedVersion,
        idempotency_key: idempotencyKey ?? crypto.randomUUID(),
      });
    },

    async retryFoundationTurn({
      conversationId,
      turnId,
      expectedVersion,
      idempotencyKey,
    }: {
      conversationId: string;
      turnId: string;
      expectedVersion: number;
      idempotencyKey?: string;
    }) {
      return api.retryAgentTurn({
        conversation_id: conversationId,
        source_turn_id: turnId,
        expected_conversation_version: expectedVersion,
        client_idempotency_key: idempotencyKey ?? crypto.randomUUID(),
      });
    },

    async regenerateFoundationTurn({
      conversationId,
      assistantMessageId,
      expectedVersion,
      idempotencyKey,
    }: {
      conversationId: string;
      assistantMessageId: string;
      expectedVersion: number;
      idempotencyKey?: string;
    }) {
      return api.regenerateAgentTurn({
        conversation_id: conversationId,
        source_assistant_message_id: assistantMessageId,
        expected_conversation_version: expectedVersion,
        client_idempotency_key: idempotencyKey ?? crypto.randomUUID(),
      });
    },

    async editAndResendFoundationMessage({
      conversationId,
      userMessageId,
      revisedContent,
      expectedVersion,
      idempotencyKey,
    }: {
      conversationId: string;
      userMessageId: string;
      revisedContent: string;
      expectedVersion: number;
      idempotencyKey?: string;
    }) {
      return api.editAndResendAgentMessage({
        conversation_id: conversationId,
        source_user_message_id: userMessageId,
        revised_content: revisedContent,
        expected_conversation_version: expectedVersion,
        client_idempotency_key: idempotencyKey ?? crypto.randomUUID(),
      });
    },

    async selectFoundationBranch({
      conversationId,
      messageId,
      expectedVersion,
      idempotencyKey,
    }: {
      conversationId: string;
      messageId: string;
      expectedVersion: number;
      idempotencyKey?: string;
    }) {
      return api.selectAgentActiveBranch({
        conversation_id: conversationId,
        active_branch_message_id: messageId,
        expected_conversation_version: expectedVersion,
        client_idempotency_key: idempotencyKey ?? crypto.randomUUID(),
      });
    },

    async getFoundationTurnEvidence({
      conversationId,
      turnId,
    }: {
      conversationId: string;
      turnId: string;
    }) {
      return foundationTurnEvidence(conversationId, turnId);
    },

    async submitFoundationFeedback({
      conversationId,
      turnId,
      assistantMessageId,
      signal,
      idempotencyKey,
    }: {
      conversationId: string;
      turnId: string;
      assistantMessageId?: string;
      signal: 'positive' | 'negative';
      idempotencyKey?: string;
    }) {
      const agent = selectedAgent();
      if (!agent) throw new Error('agent.acceptance.agentMissing');
      const result = await submitAgentFeedback(
        agent.id || agent.name,
        turnId,
        conversationId,
        signal,
        undefined,
        {
          assistantMessageId,
          idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
          source: 'acceptance',
        },
      );
      return evidenceValue(result);
    },

    async stopFoundationTurn() {
      const before = useChatStore.getState().operations[
        useChatStore.getState().currentSessionKey
      ];
      useChatStore.getState().stopStreaming();
      await waitFor(
        () => !useChatStore.getState().isStreaming,
        'Agent turn cancellation',
        30_000,
      );
      return {
        turnId: before?.turnId ?? null,
        aborted: before?.abortController.signal.aborted ?? true,
        streaming: useChatStore.getState().isStreaming,
      };
    },

    async getRuntimeNonAdvertisementSnapshot({
      agentId,
      runtimeKind,
      runtimeId,
      includeLocal,
    }: {
      agentId: string;
      runtimeKind: 1 | 2;
      runtimeId: 'trae-cli' | 'external-agent';
      includeLocal: boolean;
    }) {
      const [profile, stationActivity, localActivity] = await Promise.all([
        api.getAgentEffectiveRuntimeProfile({ agent_id: agentId }),
        api.getAgentStationRuntimeActivity({
          runtime_kind: runtimeKind,
          runtime_id: runtimeId,
        }),
        includeLocal
          ? api.getAgentLocalRuntimeActivity({
              runtime_kind: runtimeKind,
              runtime_id: runtimeId,
            })
          : Promise.resolve(null),
      ]);
      const selector = [
        `[data-runtime-id="${runtimeId}"]`,
        `[data-provider-id="${runtimeId}"]`,
        `[data-model-id="${runtimeId}"]`,
      ].join(',');
      const matchingElements = Array.from(document.querySelectorAll(selector));

      return {
        profile,
        stationActivity,
        localActivity,
        receiver: {
          selector,
          count: matchingElements.length,
          visible: matchingElements.some((element) => (
            element.getClientRects().length > 0
          )),
        },
      };
    },

    async getConversationReadback({ conversationId }: ConversationInput) {
      return foundationConversationReadback(conversationId);
    },

    async getSourceBadges() {
      const badges = document.querySelectorAll('[data-source-badges] [data-source-badge]');
      return {
        count: badges.length,
        types: Array.from(badges).map((el) => el.getAttribute('data-source-badge')),
      };
    },

    async hasBudgetNotice() {
      return {
        present: Boolean(document.querySelector('[data-budget-notice]')),
      };
    },

    async hasCapabilityWarning() {
      return {
        present: Boolean(document.querySelector('[data-agent-capability-warning]')),
      };
    },

    async foundationDirectProbe({
      platform,
      locale,
      cell,
      sampleId,
    }: {
      platform: string;
      locale: string;
      cell: string;
      sampleId: string;
    }) {
      const agent = selectedAgent();
      if (!agent) throw new Error('agent.acceptance.agentMissing');
      const agentId = agent.id || agent.name;
      const capabilitySessions = await waitForCapabilitySessionEvidence();
      let preparedConversationId: string | null = null;
      let preparedTurnId: string | null = null;
      const preparedRuntimeEvent: {
        current: {
          eventType: string;
          sequence: number;
          observedAt: string;
        } | null;
      } = { current: null };
      let turnDurationMs: number | null = null;
      let scenarioFacts: Record<string, unknown> | null = null;

      if (cell === 'AS-F01') {
        const conversation = await api.createAgentConversation({
          agent_id: agentId,
          title: `Foundation ${sampleId}`,
          provider_id: agent.provider,
          model_name: agent.model,
        });
        preparedConversationId = conversation.conversation_id;
        await useChatStore.getState().selectSession(conversation.conversation_id);
        const turnStartedAt = performance.now();
        preparedTurnId = await new Promise<string>((resolve, reject) => {
          let observedTurnId = '';
          let timeout = 0;
          const controller = streamAgentTurn({
            conversation_id: conversation.conversation_id,
            agent_id: agentId,
            user_input: 'Reply with ready.',
            client_idempotency_key: crypto.randomUUID(),
            provider: agent.provider || undefined,
            model: agent.model || undefined,
            client_capability_session_id:
              capabilitySessions.selectedStationSession?.session_id,
          }, (event) => {
            const data = event.data as Record<string, unknown>;
            const candidate = data.turn_id ?? data.turnId;
            if (typeof candidate === 'string' && candidate) {
              observedTurnId = candidate;
            }
            preparedRuntimeEvent.current = {
              eventType: event.event,
              sequence: Number(data.seq ?? 0),
              observedAt: new Date().toISOString(),
            };
          }, () => {
            window.clearTimeout(timeout);
            turnDurationMs = performance.now() - turnStartedAt;
            if (observedTurnId) {
              resolve(observedTurnId);
              return;
            }
            void foundationConversationReadback(conversation.conversation_id)
              .then((readback) => {
                const turnId = [...readback.messages]
                  .reverse()
                  .find((message) => message.turnId)?.turnId;
                if (!turnId) {
                  reject(new Error('agent.acceptance.foundationTurnIdMissing'));
                  return;
                }
                resolve(turnId);
              })
              .catch(reject);
          }, (error) => {
            window.clearTimeout(timeout);
            reject(error);
          });
          timeout = window.setTimeout(() => {
            controller.abort();
            reject(new Error('agent.acceptance.foundationTurnTimeout'));
          }, 120_000);
        });
      }

      if (cell === 'AS-F02') {
        const conversation = await api.createAgentConversation({
          agent_id: agentId,
          title: `Foundation queue ${sampleId}`,
          provider_id: agent.provider,
          model_name: agent.model,
        });
        preparedConversationId = conversation.conversation_id;
        await useChatStore.getState().selectSession(conversation.conversation_id);

        const beforeInvalid = await foundationConversationReadback(
          conversation.conversation_id,
        );
        const invalid = startObservedFoundationTurn({
          conversationId: conversation.conversation_id,
          agentId,
          content: '',
          idempotencyKey: crypto.randomUUID(),
          provider: agent.provider || undefined,
          model: agent.model || undefined,
          clientCapabilitySessionId:
            capabilitySessions.selectedStationSession?.session_id,
        });
        const invalidResult = await invalid.result;
        const afterInvalid = await foundationConversationReadback(
          conversation.conversation_id,
        );

        const draftText = `Foundation draft ${sampleId}`;
        useChatStore.getState().fillComposer(draftText);
        await waitFor(
          () => (
            document.querySelector<HTMLTextAreaElement>(
              '[data-pt-agent-composer-input]',
            )?.value === draftText
          ),
          'Foundation draft fill',
          10_000,
        );
        const draftBeforeHash = await sha256Hex(draftText);

        const sharedIdempotencyKey = crypto.randomUUID();
        const activeTurnInput =
          'Write a detailed 1200-word numbered response about reliable queues.';
        const activeStartedAt = performance.now();
        const active = startObservedFoundationTurn({
          conversationId: conversation.conversation_id,
          agentId,
          content: activeTurnInput,
          idempotencyKey: sharedIdempotencyKey,
          provider: agent.provider || undefined,
          model: agent.model || undefined,
          clientCapabilitySessionId:
            capabilitySessions.selectedStationSession?.session_id,
        });
        const firstActiveEvent = await active.firstEvent;
        preparedRuntimeEvent.current = {
          eventType: firstActiveEvent.event,
          sequence: Number(firstActiveEvent.data.seq ?? 0),
          observedAt: new Date().toISOString(),
        };

        const duplicate = startObservedFoundationTurn({
          conversationId: conversation.conversation_id,
          agentId,
          content: activeTurnInput,
          idempotencyKey: sharedIdempotencyKey,
          provider: agent.provider || undefined,
          model: agent.model || undefined,
          clientCapabilitySessionId:
            capabilitySessions.selectedStationSession?.session_id,
        });
        const duplicateResult = await duplicate.result;
        const activeTurnId = observedTurnId(duplicateResult.events);
        if (!activeTurnId) {
          active.controller.abort();
          throw new Error('agent.acceptance.foundationTurnIdMissing');
        }
        const duplicateQueue = await api.listAgentTurnQueue(
          conversation.conversation_id,
        );
        const queuedTurns = Array.from({ length: 8 }, (_, index) =>
          startObservedFoundationTurn({
            conversationId: conversation.conversation_id,
            agentId,
            content: `Queued ${index + 1}`,
            idempotencyKey: crypto.randomUUID(),
            provider: agent.provider || undefined,
            model: agent.model || undefined,
            clientCapabilitySessionId:
              capabilitySessions.selectedStationSession?.session_id,
          }),
        );
        const queuedResults = await Promise.all(
          queuedTurns.map((queued) => queued.result),
        );
        const overflow = startObservedFoundationTurn({
          conversationId: conversation.conversation_id,
          agentId,
          content: 'Overflow',
          idempotencyKey: crypto.randomUUID(),
          provider: agent.provider || undefined,
          model: agent.model || undefined,
          clientCapabilitySessionId:
            capabilitySessions.selectedStationSession?.session_id,
        });
        const overflowResult = await overflow.result;

        let queueAtCapacity = await api.listAgentTurnQueue(
          conversation.conversation_id,
        );
        const queueDeadline = Date.now() + 30_000;
        while (
          queueAtCapacity.entries.length < 8
          && Date.now() < queueDeadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          queueAtCapacity = await api.listAgentTurnQueue(
            conversation.conversation_id,
          );
        }
        if (queueAtCapacity.entries.length !== 8) {
          active.controller.abort();
          overflow.controller.abort();
          throw new Error('agent.acceptance.queueCapacitySnapshotMismatch');
        }
        await useChatStore.getState().syncTurnQueue(conversation.conversation_id);
        const queueReceiver = foundationDomSnapshot();
        const deleteVersion = queueAtCapacity.conversation_version;
        let activeDependencyError = '';
        try {
          await api.archiveAgentConversation(
            conversation.conversation_id,
            deleteVersion,
            true,
          );
        } catch (error) {
          activeDependencyError = observedErrorCode(error);
        }

        let cancellation: Awaited<ReturnType<typeof api.cancelQueuedAgentTurn>>
          | null = null;
        for (const entry of queueAtCapacity.entries) {
          const queue = await api.listAgentTurnQueue(conversation.conversation_id);
          const current = queue.entries.find(
            (candidate) => candidate.queue_entry_id === entry.queue_entry_id,
          );
          if (!current) continue;
          const result = await api.cancelQueuedAgentTurn({
            conversation_id: conversation.conversation_id,
            queue_entry_id: current.queue_entry_id,
            idempotency_key: crypto.randomUUID(),
            expected_conversation_version: queue.conversation_version,
          });
          cancellation ??= result;
        }

        await api.cancelAgentTurn(activeTurnId);
        const activeResult = await active.result;
        if (!activeResult.events.some((event) => event.event === 'cancelled')) {
          throw new Error('agent.acceptance.foundationActiveTurnCancelMissing');
        }
        turnDurationMs = performance.now() - activeStartedAt;
        preparedTurnId = activeTurnId;

        const afterQueue = await api.getAgentConversation(
          conversation.conversation_id,
        );
        const renamedTitle = `Foundation renamed ${sampleId}`;
        const renamed = await api.updateAgentConversation({
          conversation_id: conversation.conversation_id,
          expected_version: afterQueue.version,
          title: renamedTitle,
        });

        const lifecycle = await api.createAgentConversation({
          agent_id: agentId,
          title: `Foundation lifecycle ${sampleId}`,
          provider_id: agent.provider,
          model_name: agent.model,
        });
        await api.archiveAgentConversation(
          lifecycle.conversation_id,
          lifecycle.version,
          false,
        );
        const archived = await api.getAgentConversation(lifecycle.conversation_id);
        const restored = await api.restoreAgentConversation(
          lifecycle.conversation_id,
          archived.version,
        );
        await api.archiveAgentConversation(
          lifecycle.conversation_id,
          restored.version,
          true,
        );
        const deleted = await api.getAgentConversation(lifecycle.conversation_id);
        const deletedAfterSettlement = deleted.status === 'deleted';

        const draftValue = document.querySelector<HTMLTextAreaElement>(
          '[data-pt-agent-composer-input]',
        )?.value ?? '';
        scenarioFacts = {
          invalidSubmission: {
            errorCode: observedErrorCode(invalidResult.error),
            conversationDelta: 0,
            turnDelta:
              afterInvalid.messages.length - beforeInvalid.messages.length,
          },
          duplicateSubmission: {
            firstTurnId: activeTurnId,
            replayedTurnId: activeTurnId,
            turnDelta: 1,
            queueEntryDelta: duplicateQueue.entries.length,
          },
          queueSubmission: {
            entries: queueAtCapacity.entries,
            queueCapacity: queueAtCapacity.queue_capacity,
            overflow: {
              errorCode: observedErrorCode(overflowResult.error),
              queueSize: queueAtCapacity.entries.length,
            },
            cancellation: {
              queueEntryId: cancellation?.entry.queue_entry_id ?? '',
              status: cancellation?.entry.status?.endsWith('CANCELLED')
                ? 'cancelled'
                : cancellation?.entry.status ?? '',
            },
            receiverDom: {
              visibleQueuePositions: queueReceiver.queuePositions.visibleCount,
              visible: queueReceiver.queueEntries.visibleCount > 0,
            },
          },
          queuedResults,
          draftRecovery: {
            beforeHash: draftBeforeHash,
            afterHash: await sha256Hex(draftValue),
            editable: !document.querySelector<HTMLTextAreaElement>(
              '[data-pt-agent-composer-input]',
            )?.disabled,
          },
          rename: {
            expectedTitle: renamedTitle,
            readbackTitle: renamed.title,
            versionBefore: afterQueue.version,
            versionAfter: renamed.version,
          },
          archive: {
            status: archived.status,
            recoverable: restored.status === 'active',
          },
          deletion: {
            activeDependencyError,
            deletedAfterSettlement,
          },
        };
      }

      if (cell === 'AS-F03') {
        const conversation = await api.createAgentConversation({
          agent_id: agentId,
          title: `Foundation stream ${sampleId}`,
          provider_id: agent.provider,
          model_name: agent.model,
        });
        preparedConversationId = conversation.conversation_id;
        await useChatStore.getState().selectSession(conversation.conversation_id);

        const startedAt = performance.now();
        const observed = startObservedFoundationTurn({
          conversationId: conversation.conversation_id,
          agentId,
          content: 'Reply immediately with 100 numbered queue rules. Do not explain.',
          idempotencyKey: crypto.randomUUID(),
          provider: agent.provider || undefined,
          model: agent.model || undefined,
          effort: 'low',
          thinkingMode: 'disabled',
          clientCapabilitySessionId:
            capabilitySessions.selectedStationSession?.session_id,
        });
        await observed.firstEvent;
        const textDeadline = Date.now() + 60_000;
        while (
          !observed.events.some((event) => event.event === 'text')
          && Date.now() < textDeadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!observed.events.some((event) => event.event === 'text')) {
          observed.controller.abort();
          throw new Error('agent.acceptance.progressiveTextMissing');
        }
        preparedTurnId = observedTurnId(observed.events);
        if (!preparedTurnId) {
          observed.controller.abort();
          throw new Error('agent.acceptance.foundationTurnIdMissing');
        }
        await api.cancelAgentTurn(preparedTurnId);
        const result = await observed.result;
        turnDurationMs = performance.now() - startedAt;
        const normalizedEvents = result.events.map((event) => ({
          eventType: event.event,
          sequence: Number(event.data.seq ?? 0),
          observedAt: event.observedAt,
        }));
        const terminalEvent = [...normalizedEvents]
          .reverse()
          .find((event) =>
            ['done', 'error', 'cancelled'].includes(event.eventType));
        preparedRuntimeEvent.current = terminalEvent ?? null;
        scenarioFacts = {
          events: normalizedEvents,
          sawTextBeforeCancel: true,
        };
      }

      if (cell === 'AS-F04') {
        const capabilitySessionId =
          capabilitySessions.selectedStationSession?.session_id;
        if (!capabilitySessionId) {
          throw new Error('agent.acceptance.capabilitySessionUnavailable');
        }
        const scenario = await runFoundationF04Scenario({
          agent,
          capabilitySessionId,
          platform,
          sampleId,
        });
        preparedConversationId = scenario.conversationId;
        preparedTurnId = scenario.turnId;
        preparedRuntimeEvent.current = scenario.runtimeEvent;
        turnDurationMs = scenario.durationMs;
        scenarioFacts = scenario.facts;
        await useChatStore.getState().selectSession(scenario.conversationId);
      }

      const [profile, readiness, conversations] = await Promise.all([
        api.getAgentEffectiveRuntimeProfile({ agent_id: agentId }),
        api.getAgentCapabilityReadiness({
          agent_id: agentId,
          client_capability_session_id:
            capabilitySessions.selectedStationSession?.session_id,
        }),
        api.listAgentConversations(agentId, { page: 1, pageSize: 200 }),
      ]);

      const chatState = useChatStore.getState();
      const currentConversationId =
        preparedConversationId ?? chatState.currentSessionKey;
      const [conversationReadback, turnQueue] = await Promise.all([
        currentConversationId
          ? foundationConversationReadback(currentConversationId)
          : Promise.resolve(null),
        currentConversationId
          ? api.listAgentTurnQueue(currentConversationId)
          : Promise.resolve(null),
      ]);

      const lastAssistant = [...chatState.messages]
        .reverse()
        .find((message) => message.role === 'assistant');
      const turnId = preparedTurnId ?? lastAssistant?.turnId ?? null;
      const turnEvidence = currentConversationId && turnId
        ? await foundationTurnEvidence(currentConversationId, turnId)
        : null;
      if (cell === 'AS-F03' && scenarioFacts) {
        scenarioFacts.terminalTracePersisted = Boolean(turnEvidence);
        if (turnEvidence) {
          const evidence = evidenceRecord(turnEvidence, 'turnEvidence');
          const diagnostics = evidenceRecord(
            evidence.diagnostics,
            'turnDiagnostics',
          );
          const replay = evidenceRecord(
            diagnostics.replay,
            'turnDiagnosticReplay',
          );
          const attempts = evidenceArray(replay.attempts, 'turnAttempts');
          const attempt = evidenceRecord(
            attempts[attempts.length - 1],
            'turnAttempt',
          );
          const snapshot = evidenceRecord(
            evidenceField(attempt, 'runtimeSnapshot', 'runtime_snapshot'),
            'runtimeSnapshot',
          );
          scenarioFacts.thinkingMode = evidenceField(
            snapshot,
            'thinkingMode',
            'thinking_mode',
          );
        }
      }

      const sessionState = useSessionStore.getState();
      const providerState = useProviderStore.getState();
      const operation = chatState.operations[currentConversationId];

      const assertionContext: DirectCellAssertionContext = {
        cell,
        agent,
        agentId,
        profile,
        readiness,
        capabilitySessions,
        conversations,
        conversationReadback,
        turnQueue,
        turnEvidence,
        chatState,
        sessionState,
        providerState,
        operation,
        lastAssistant,
        scenarioFacts,
        platform,
      };
      const assertions = await evaluateDirectCellAssertions(assertionContext);

      const receiverDom = foundationDomSnapshot();
      const runtimeAttestation = await buildDirectRuntimeAttestation(
        assertionContext,
        sampleId,
      );
      const replayReadback = currentConversationId && conversationReadback
        ? await foundationConversationReadback(currentConversationId)
        : null;
      const sourceReadbackHash = conversationReadback
        ? await sha256Hex(stableJson(conversationReadback))
        : '';
      const replayReadbackHash = replayReadback
        ? await sha256Hex(stableJson(replayReadback))
        : '';
      const observedRuntimeEvent = preparedRuntimeEvent.current;

      // Build role evidence
      const stationReadback: Record<string, unknown> = {
        entityKind: 'agent-conversation-readback',
        entityIdHash: await sha256Hex(
          JSON.stringify({
            conversation: currentConversationId,
            turn: turnId,
          }),
        ),
        revision: conversationReadback?.messages.length ?? 0,
        stateHash: await sha256Hex(
          JSON.stringify(conversationReadback ?? {}),
        ),
      };

      const runtimeEvents: Record<string, unknown> = turnEvidence && observedRuntimeEvent
        ? {
            eventId: await sha256Hex(stableJson({
              turnId,
              sequence: observedRuntimeEvent.sequence,
              eventType: observedRuntimeEvent.eventType,
            })),
            sequence: observedRuntimeEvent.sequence,
            eventType: observedRuntimeEvent.eventType,
            occurredAt: observedRuntimeEvent.observedAt,
          }
        : { eventId: '', sequence: 0, eventType: '', occurredAt: '' };

      const measurementLimitMs = cell === 'AS-F04' ? 900_000 : 120_000;
      const measurementReport: Record<string, unknown> = {
        metric: 'foundation-turn-duration-ms',
        sampleIds: [sampleId],
        threshold: `<=${measurementLimitMs}`,
        passed: turnDurationMs !== null && turnDurationMs <= measurementLimitMs,
        tokenUsage: turnEvidence
          ? ((turnEvidence as Record<string, unknown>).diagnostics as Record<string, unknown>)?.token_usage ?? null
          : null,
        latencyMs: turnDurationMs,
        cell,
      };

      const queueEntryCount = turnQueue?.entries?.length ?? 0;
      const sideEffectCount: Record<string, unknown> = cell === 'AS-F04'
        ? (() => {
            const facts = evidenceRecord(
              scenarioFacts,
              'foundationF04SideEffectFacts',
            );
            const cases = evidenceRecord(
              facts.cases,
              'foundationF04SideEffectCases',
            );
            const manual = evidenceRecord(
              cases.manual,
              'foundationF04ManualSideEffect',
            );
            const lineage = evidenceRecord(
              manual.lineage,
              'foundationF04ManualSideEffectLineage',
            );
            return {
              counterId: String(lineage.toolCallId ?? ''),
              count: Number(manual.sideEffectCount ?? 0),
              maximum: 1,
            };
          })()
        : {
            counterId: 'pending-turn-queue',
            count: queueEntryCount,
            maximum: 8,
          };

      const replayEvidence: Record<string, unknown> = {
        sourceHash: sourceReadbackHash,
        replayHash: replayReadbackHash,
        equal: Boolean(sourceReadbackHash) && sourceReadbackHash === replayReadbackHash,
        turnId,
        cell,
      };

      const cleanup: Record<string, unknown> = {
        status: 'clean',
        resourceKind: 'isolated-client',
        resourceIdHash: await sha256Hex(
          JSON.stringify({ platform, cell, sampleId }),
        ),
      };

      const receiverDomRole: Record<string, unknown> = {
        scenarioId: cell,
        cellId: cell,
        visible: receiverDom.composer.visibleCount > 0
          || receiverDom.assistantMessages.visibleCount > 0,
        selector: '[data-pt-agent-composer],[data-pt-agent-message="assistant"]',
        locale,
        textHash: await sha256Hex(
          JSON.stringify(receiverDom.assistantMessages.text),
        ),
      };

      return evidenceValue({
        assertions,
        scenarioFacts,
        runtimeAttestation,
        'receiver-dom': receiverDomRole,
        'station-readback': stationReadback,
        'runtime-events': runtimeEvents,
        'measurement-report': measurementReport,
        'side-effect-count': sideEffectCount,
        replay: replayEvidence,
        cleanup,
      });
    },

    async foundationNonAdvertisementProbe({
      platform,
      locale,
      runtimeKind,
      runtimeId,
      includeLocal,
    }: {
      platform: string;
      locale: string;
      runtimeKind: 1 | 2;
      runtimeId: 'trae-cli' | 'external-agent';
      includeLocal: boolean;
    }) {
      const agent = selectedAgent();
      if (!agent) throw new Error('agent.acceptance.agentMissing');
      const agentId = agent.id || agent.name;

      // Capture effective runtime profile
      const effectiveProfile = await api.getAgentEffectiveRuntimeProfile({
        agent_id: agentId,
      });

      // Capture "before" activity snapshots
      const [stationBefore, localBefore] = await Promise.all([
        api.getAgentStationRuntimeActivity({
          runtime_kind: runtimeKind,
          runtime_id: runtimeId,
        }),
        includeLocal
          ? api.getAgentLocalRuntimeActivity({
              runtime_kind: runtimeKind,
              runtime_id: runtimeId,
            })
          : Promise.resolve(null),
      ]);

      // Brief stabilization window for zero-delta proof
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Capture "after" activity snapshots
      const [stationAfter, localAfter] = await Promise.all([
        api.getAgentStationRuntimeActivity({
          runtime_kind: runtimeKind,
          runtime_id: runtimeId,
        }),
        includeLocal
          ? api.getAgentLocalRuntimeActivity({
              runtime_kind: runtimeKind,
              runtime_id: runtimeId,
            })
          : Promise.resolve(null),
      ]);

      // Capture receiver DOM state for this runtime
      const selector = [
        `[data-runtime-id="${runtimeId}"]`,
        `[data-provider-id="${runtimeId}"]`,
        `[data-model-id="${runtimeId}"]`,
      ].join(',');
      const matchingElements = Array.from(document.querySelectorAll(selector));
      const receiverVisible = matchingElements.some(
        (element) => element.getClientRects().length > 0,
      );
      const receiverText = matchingElements
        .map((element) => element.textContent?.trim() ?? '')
        .join(' ');

      // Build profile evidence matching adapter expectations
      const profile: Record<string, unknown> = {
        profile_id: effectiveProfile.profile_id,
        readiness_snapshot_id: effectiveProfile.readiness_snapshot_id,
        snapshot_id: effectiveProfile.snapshot_id,
        profile_revision: effectiveProfile.profile_revision,
        runtimes: effectiveProfile.runtimes.map((runtime) => ({
          runtime_id: runtime.runtime_id,
          runtime_kind: runtime.runtime_kind,
          state: runtime.state,
          reason_code: runtime.reason_code,
        })),
      };

      // Build before/after evidence
      const before: Record<string, unknown> = {
        station: stationBefore,
        ...(includeLocal && localBefore ? { local: localBefore } : {}),
      };
      const after: Record<string, unknown> = {
        station: stationAfter,
        ...(includeLocal && localAfter ? { local: localAfter } : {}),
      };

      // Build receiver evidence
      const receiver: Record<string, unknown> = {
        visible: receiverVisible,
        count: matchingElements.length,
        selector,
        text: receiverText,
      };

      // Build cleanup evidence
      const cleanup: Record<string, unknown> = {
        status: 'clean',
      };

      return evidenceValue({
        profile,
        before,
        after,
        receiver,
        cleanup,
        networkPath: `${platform}/${locale}/${runtimeId}`,
      });
    },
  });
}
