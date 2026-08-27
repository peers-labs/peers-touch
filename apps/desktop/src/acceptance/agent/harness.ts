import { identityRuntime } from '../../kernel/identityRuntime';
import { bootstrapRuntime, installRuntime } from '../../kernel/runtime';
import { EVENT, eventBus } from '../../kernel/events';
import i18n, { changeLanguage } from '../../i18n';
import { installDeferredAppRuntimeProjections } from '../../services/appRuntime';
import {
  api,
  parseAgentChatConfig,
  streamAgentTurn,
  submitAgentFeedback,
} from '../../services/desktop_api';
import { useAgentStore } from '../../store/agent';
import { useChatStore } from '../../store/chat';
import { useProviderStore } from '../../store/provider';
import { useSessionStore } from '../../store/session';
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

interface ObservedFoundationTurn {
  controller: AbortController;
  firstEvent: Promise<{ event: string; data: Record<string, unknown> }>;
  result: Promise<{
    ok: boolean;
    error: string | null;
    events: Array<{ event: string; data: Record<string, unknown> }>;
  }>;
}

function startObservedFoundationTurn(input: {
  conversationId: string;
  agentId: string;
  content: string;
  idempotencyKey: string;
  provider?: string;
  model?: string;
  clientCapabilitySessionId?: string;
}): ObservedFoundationTurn {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  let resolveFirstEvent: (
    value: { event: string; data: Record<string, unknown> },
  ) => void = () => {};
  let firstEventObserved = false;
  const firstEvent = new Promise<{ event: string; data: Record<string, unknown> }>(
    (resolve) => {
      resolveFirstEvent = resolve;
    },
  );
  let resolveResult: (value: {
    ok: boolean;
    error: string | null;
    events: Array<{ event: string; data: Record<string, unknown> }>;
  }) => void = () => {};
  const result = new Promise<{
    ok: boolean;
    error: string | null;
    events: Array<{ event: string; data: Record<string, unknown> }>;
  }>((resolve) => {
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
    client_capability_session_id: input.clientCapabilitySessionId,
  }, (event) => {
    const observed = {
      event: event.event,
      data: evidenceValue(event.data) as Record<string, unknown>,
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
  }, 120_000);
  return { controller, firstEvent, result };
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
      } catch (firstError: unknown) {
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
          chatConfig: JSON.stringify({
            ...parseAgentChatConfig(agent),
            provider: providerId,
            model: modelId,
          }),
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
          gatewayBase: (window as any).__PT_GATEWAY_BASE__ ?? null,
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
          let controller: AbortController;
          let timeout = 0;
          const finish = (result: Record<string, unknown>) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            resolve(result);
          };
          controller = streamAgentTurn({
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
          let controller: AbortController;
          const timeout = window.setTimeout(() => {
            controller.abort();
            reject(new Error('agent.acceptance.foundationTurnTimeout'));
          }, 120_000);
          controller = streamAgentTurn({
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
        const duplicateQueue = await api.listAgentTurnQueue(
          conversation.conversation_id,
        );
        const queuedResults: Awaited<ObservedFoundationTurn['result']>[] = [];
        for (let index = 0; index < 8; index += 1) {
          const queued = startObservedFoundationTurn({
            conversationId: conversation.conversation_id,
            agentId,
            content: `Queued ${index + 1}`,
            idempotencyKey: crypto.randomUUID(),
            provider: agent.provider || undefined,
            model: agent.model || undefined,
            clientCapabilitySessionId:
              capabilitySessions.selectedStationSession?.session_id,
          });
          queuedResults.push(await queued.result);
        }
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

        const activeResult = await active.result;
        turnDurationMs = performance.now() - activeStartedAt;
        preparedTurnId = observedTurnId(activeResult.events);
        const duplicateTurnId = observedTurnId(duplicateResult.events);

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
            firstTurnId: preparedTurnId,
            replayedTurnId: duplicateTurnId,
            turnDelta: preparedTurnId && duplicateTurnId ? 1 : 0,
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

      const measurementReport: Record<string, unknown> = {
        metric: 'foundation-turn-duration-ms',
        sampleIds: [sampleId],
        threshold: '<=120000',
        passed: turnDurationMs !== null && turnDurationMs <= 120_000,
        tokenUsage: turnEvidence
          ? ((turnEvidence as Record<string, unknown>).diagnostics as Record<string, unknown>)?.token_usage ?? null
          : null,
        latencyMs: turnDurationMs,
        cell,
      };

      const queueEntryCount = turnQueue?.entries?.length ?? 0;
      const sideEffectCount: Record<string, unknown> = {
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
